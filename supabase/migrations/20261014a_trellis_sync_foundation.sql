-- 20261014a — Trellis API expansion WS1: schema foundation.
--
-- Additive only. Applied live via Supabase MCP on 2026-10-14.
--
--  1. trellis_task_snapshot: clean_kind / is_tendwell / task_category, written
--     by the sync at upsert time from shared/trellis-sync-rules.ts (which wraps
--     classifyAuxTask / isTendwellTask), so views filter plain indexed columns.
--  2. trellis_sync_log: status may now be 'partial' (run hit its deadline and
--     stopped cleanly) and 'canceled' (sync-now already wrote it; the old CHECK
--     silently rejected that update and left the row 'running').
--  3. trellis_roster: last_seen_at / removed_at / missed_runs for safe
--     deactivation (2 consecutive complete pulls, <=10% per run).
--  4. cleaners: trellis_user_id (unique), status active|offboarded,
--     offboarded_at, offboarded_by, source manual|trellis. is_active is kept in
--     step with status by a trigger. cleaner_grant_app_access skips
--     source='trellis' rows: sync-created cleaners never get a login on their own.
--  5. app_settings.trellis_cleaner_sync_enabled = 'false' (WS3 flips it).
--  6. trellis_aux_sync_log: state for the reviews / assignee / history jobs
--     (kept out of trellis_sync_log, whose CHECK + skip logic the hourly sync
--     depends on).
--  7. trellis_review_snapshot: Haven guest reviews from Trellis workspace B,
--     same alias canonicalization as the task snapshot, readable only with the
--     'reviews' view grant.

-- ── 1. Task classification columns ─────────────────────────────────────────
alter table public.trellis_task_snapshot
  add column if not exists clean_kind text,
  add column if not exists is_tendwell boolean,
  add column if not exists task_category text;

comment on column public.trellis_task_snapshot.clean_kind is
  'Clean sub-kind (turn, departure, deep, onboarding, last, arrival, double, owner_stay, clean) from cleanKindForTitle() in shared/trellis-sync-rules.ts; NULL = not a clean (vacancy / touch-up / inspection / aux work). Written by the sync.';
comment on column public.trellis_task_snapshot.is_tendwell is
  'isTendwellTask(): workspace A, or assigned to Tendwell Cleaning Co. / a workspace-A roster member (incl. assignees[]). Written by the sync.';
comment on column public.trellis_task_snapshot.task_category is
  'classifyAuxTask() category, except rating inspections are always ''inspection'' (trellisTaskCategory). Written by the sync.';

create index if not exists trellis_task_snapshot_status_sched_idx
  on public.trellis_task_snapshot (status, scheduled_date);
create index if not exists trellis_task_snapshot_assigned_idx
  on public.trellis_task_snapshot (assigned_to_id);
-- (trellis_property_id, scheduled_date) already exists as trellis_task_snapshot_property_day_idx.
create index if not exists trellis_task_snapshot_completed_clean_idx
  on public.trellis_task_snapshot (trellis_property_id, scheduled_date desc)
  where status = 'COMPLETED' and clean_kind is not null;
create index if not exists trellis_task_snapshot_category_idx
  on public.trellis_task_snapshot (task_category, scheduled_date)
  where task_category = 'inspection';

-- ── 2. Sync log statuses ──────────────────────────────────────────────────
alter table public.trellis_sync_log drop constraint if exists trellis_sync_log_status_check;
alter table public.trellis_sync_log add constraint trellis_sync_log_status_check
  check (status = any (array['requested','running','done','partial','error','canceled']));

-- ── 3. Roster lifecycle ───────────────────────────────────────────────────
alter table public.trellis_roster
  add column if not exists last_seen_at timestamptz,
  add column if not exists removed_at timestamptz,
  add column if not exists missed_runs integer not null default 0;

-- synced_at only moves when a full pull returns the member, so it is the
-- last time they were seen. Members not seen for more than a day and a half
-- have already been missed by at least two nightly pulls.
update public.trellis_roster
   set last_seen_at = coalesce(last_seen_at, synced_at),
       missed_runs = case when synced_at < now() - interval '36 hours' then greatest(missed_runs, 2) else missed_runs end
 where last_seen_at is null;

-- ── 4. Cleaners ↔ Trellis ─────────────────────────────────────────────────
alter table public.cleaners
  add column if not exists trellis_user_id uuid,
  add column if not exists status text not null default 'active',
  add column if not exists offboarded_at timestamptz,
  add column if not exists offboarded_by text,
  add column if not exists source text not null default 'manual';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cleaners_status_check') then
    alter table public.cleaners add constraint cleaners_status_check check (status in ('active','offboarded'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cleaners_source_check') then
    alter table public.cleaners add constraint cleaners_source_check check (source in ('manual','trellis'));
  end if;
end $$;

create unique index if not exists cleaners_trellis_user_id_key
  on public.cleaners (trellis_user_id) where trellis_user_id is not null;

comment on column public.cleaners.trellis_user_id is 'Trellis user id (trellis_roster.user_id) this cleaner is linked to. Unique.';
comment on column public.cleaners.offboarded_by is
  'Who offboarded: ''trellis-sync'' (left the Trellis roster; the sync reactivates them if they return) or a staff label (manual; never undone by the sync).';

-- Existing inactive rows are offboarded.
update public.cleaners set status = 'offboarded', offboarded_at = coalesce(offboarded_at, now())
 where is_active = false and status = 'active';

create or replace function public.cleaners_status_consistency()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' and new.is_active = false then
    new.status := 'offboarded';
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'offboarded' then
      new.is_active := false;
      new.offboarded_at := coalesce(new.offboarded_at, now());
    else
      new.is_active := true;
      new.offboarded_at := null;
      new.offboarded_by := null;
    end if;
  elsif new.is_active is distinct from old.is_active then
    -- Legacy writers that only flip is_active keep status in step.
    if new.is_active then
      new.status := 'active';
      new.offboarded_at := null;
      new.offboarded_by := null;
    else
      new.status := 'offboarded';
      new.offboarded_at := coalesce(new.offboarded_at, now());
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists cleaners_status_consistency on public.cleaners;
create trigger cleaners_status_consistency
  before insert or update of status, is_active on public.cleaners
  for each row execute function public.cleaners_status_consistency();

-- Live body (verified 2026-10-14) + the source='trellis' skip.
create or replace function public.cleaner_grant_app_access()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  normalized_email text;
BEGIN
  -- Cleaners created by the Trellis sync never get an app login on their own;
  -- staff grant it deliberately with the Invite button (plan decision 3).
  IF NEW.source = 'trellis' THEN
    RETURN NEW;
  END IF;

  normalized_email := lower(trim(NEW.email));
  IF normalized_email IS NULL OR normalized_email = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.app_users (role, label, google_email)
  VALUES ('cleaning', NEW.full_name, normalized_email)
  ON CONFLICT (google_email) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- ── 5. Auto-create gate ───────────────────────────────────────────────────
insert into public.app_settings (key, value) values ('trellis_cleaner_sync_enabled', 'false')
on conflict (key) do nothing;

-- ── 6. Aux job log ────────────────────────────────────────────────────────
create table if not exists public.trellis_aux_sync_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('reviews','review_backfill','assignees','task_backfill','inspections','run')),
  status text not null default 'running' check (status in ('running','done','partial','error','skipped')),
  trigger text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  counts jsonb,
  state jsonb,
  error text
);
create index if not exists trellis_aux_sync_log_kind_started_idx on public.trellis_aux_sync_log (kind, started_at desc);
alter table public.trellis_aux_sync_log enable row level security;
revoke all on public.trellis_aux_sync_log from anon;
drop policy if exists trellis_aux_sync_log_admin_read on public.trellis_aux_sync_log;
create policy trellis_aux_sync_log_admin_read on public.trellis_aux_sync_log
  for select to authenticated using ((select public.current_user_role()) = 'admin');

-- ── 7. Reviews ────────────────────────────────────────────────────────────
create table if not exists public.trellis_review_snapshot (
  trellis_review_id text primary key,
  workspace text not null check (workspace in ('A','B')),
  trellis_property_id uuid,
  property_name text,
  reservation_id text,
  checkin_date date,
  checkout_date date,
  guest_name text,
  reviewer_name text,
  overall_rating numeric,
  max_rating numeric,
  -- Trellis's own 0..1 (overall / max).
  normalized_rating numeric,
  -- On the review's own scale (max_rating).
  cleanliness_rating numeric,
  cleanliness_5 numeric generated always as (
    case when cleanliness_rating is not null and max_rating > 0
         then round(cleanliness_rating * 5 / max_rating, 2) end
  ) stored,
  category_ratings jsonb,
  content text,
  title text,
  source text,
  review_date timestamptz,
  host_response_status text,
  synced_at timestamptz not null default now()
);
comment on table public.trellis_review_snapshot is
  'Guest reviews from Trellis workspace B (read_reviews), written by api/cron/trellis-aux-sync.ts. Ratings on the review scale (max_rating); normalized_rating 0..1; cleanliness_5 = cleanliness on 0..5. No amounts.';

create index if not exists trellis_review_snapshot_prop_checkin_idx on public.trellis_review_snapshot (trellis_property_id, checkin_date);
create index if not exists trellis_review_snapshot_review_date_idx on public.trellis_review_snapshot (review_date desc);

drop trigger if exists trg_trellis_review_canonicalize on public.trellis_review_snapshot;
create trigger trg_trellis_review_canonicalize
  before insert or update on public.trellis_review_snapshot
  for each row execute function public.trellis_task_snapshot_canonicalize();

alter table public.trellis_review_snapshot enable row level security;
revoke all on public.trellis_review_snapshot from anon;
drop policy if exists trellis_review_snapshot_reviews_read on public.trellis_review_snapshot;
create policy trellis_review_snapshot_reviews_read on public.trellis_review_snapshot
  for select to authenticated using ((select public.current_user_can_view('reviews')));
