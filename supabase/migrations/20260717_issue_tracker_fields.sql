-- Issues Tracker overhaul, part 1: priority scale, due dates, acknowledgment,
-- status canonicalization, completed_at consistency, staff-scoped RLS, and
-- digest preference toggles.
--
-- Companion migrations: 20260717b_issue_reads.sql (catch-up read state),
-- 20260717c_issue_translations.sql (translation cache).

-- ── 1. Canonical statuses ───────────────────────────────────────────────────
-- The bot API (api/issues/index.ts) used to default status to 'Open', which
-- the UI never renders. Fold any off-vocabulary status into 'Needs Attention'
-- and constrain the column so it can't drift again.
update cleaning_issues set status = 'Needs Attention', updated_at = now()
  where status not in ('Needs Attention', 'In Progress', 'Completed');

alter table cleaning_issues drop constraint if exists cleaning_issues_status_chk;
alter table cleaning_issues add constraint cleaning_issues_status_chk
  check (status in ('Needs Attention', 'In Progress', 'Completed'));

-- ── 2. issue_type: required + constrained ───────────────────────────────────
update cleaning_issues set issue_type = 'needs_attention' where issue_type is null;
alter table cleaning_issues alter column issue_type set not null;
alter table cleaning_issues drop constraint if exists cleaning_issues_issue_type_chk;
alter table cleaning_issues add constraint cleaning_issues_issue_type_chk
  check (issue_type in ('needs_attention', 'guest_feedback'));

-- ── 3. Priority scale: low < normal < high < urgent ─────────────────────────
-- Existing values are only 'normal'/'urgent' (binary checkbox era) — both valid.
alter table cleaning_issues drop constraint if exists cleaning_issues_priority_chk;
alter table cleaning_issues add constraint cleaning_issues_priority_chk
  check (priority in ('low', 'normal', 'high', 'urgent'));

-- ── 4. Due dates, acknowledgment, share-link kill switch ────────────────────
-- guest_feedback items are FYI: acknowledged (by any one person, recorded
-- with name + timestamp), never "resolved". needs_attention items are
-- actionable: due dates drive the overdue digest.
alter table cleaning_issues
  add column if not exists due_date date,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by text,
  add column if not exists share_link_disabled boolean not null default false;

create index if not exists idx_cleaning_issues_due_date
  on cleaning_issues (due_date) where status <> 'Completed';
create index if not exists idx_cleaning_issues_unacked_feedback
  on cleaning_issues (issue_type) where issue_type = 'guest_feedback' and acknowledged_at is null;

-- ── 5. completed_at consistency on every write path ─────────────────────────
-- Previously only the share endpoint's "complete" action stamped completed_at;
-- the in-app status dropdown and the bot PATCH never did. Derive it in a
-- trigger so all paths agree.
update cleaning_issues set completed_at = null
  where status <> 'Completed' and completed_at is not null;
update cleaning_issues set completed_at = coalesce(completed_at, updated_at)
  where status = 'Completed' and completed_at is null;

create or replace function public.cleaning_issues_completed_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'Completed' then
    if new.completed_at is null then new.completed_at := now(); end if;
  else
    new.completed_at := null;
  end if;
  return new;
end $$;
revoke execute on function public.cleaning_issues_completed_at() from public, anon, authenticated;

drop trigger if exists trg_cleaning_issues_completed_at on cleaning_issues;
create trigger trg_cleaning_issues_completed_at
  before insert or update on cleaning_issues
  for each row execute function public.cleaning_issues_completed_at();

-- ── 6. Default due_date from priority (needs_attention only) ────────────────
-- Bot- and quick-add-created issues rarely set a due date; without one the
-- overdue digest can never flag them. Guest feedback is FYI — no due date.
create or replace function public.cleaning_issues_default_due_date()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.issue_type = 'needs_attention' and new.due_date is null then
    new.due_date := coalesce(new.report_date, current_date) + case new.priority
      when 'urgent' then 1
      when 'high'   then 2
      when 'low'    then 10
      else 5 -- normal
    end;
  end if;
  return new;
end $$;
revoke execute on function public.cleaning_issues_default_due_date() from public, anon, authenticated;

drop trigger if exists trg_cleaning_issues_default_due_date on cleaning_issues;
create trigger trg_cleaning_issues_default_due_date
  before insert on cleaning_issues
  for each row execute function public.cleaning_issues_default_due_date();

-- ── 7. RLS: staff only ───────────────────────────────────────────────────────
-- These three tables kept blanket authenticated policies through the 20260626
-- staff-scoping sweep, meaning owner-role tokens passed RLS. Owners have no
-- business in the issues tracker; the public cleaner share link goes through
-- the service-role endpoint (api/issues/share/[token].ts), not RLS.
drop policy if exists "cleaning_issues_authenticated" on cleaning_issues;
create policy "cleaning_issues_authenticated" on cleaning_issues
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists issue_comments_auth_all on issue_comments;
create policy issue_comments_auth_all on issue_comments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists issue_photos_auth_all on issue_photos;
create policy issue_photos_auth_all on issue_photos
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ── 8. Digest preference toggles ─────────────────────────────────────────────
-- Two new daily-digest sections: overdue needs_attention issues and
-- unacknowledged guest feedback. Default on, per-user opt-out, mirrored in
-- NotifPrefs/DEFAULT_NOTIF_PREFS (api/notify/_lib.ts).
alter table notification_preferences
  add column if not exists notify_issue_overdue boolean not null default true,
  add column if not exists notify_feedback_unacknowledged boolean not null default true;
