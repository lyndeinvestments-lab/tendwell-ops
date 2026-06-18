-- Tendwell ↔ Trellis sync & reconciliation.
-- Snapshot tables are written by the nightly/on-demand sync (service role).
-- All Tendwell-attribution + reconciliation logic lives in views below so it
-- is testable with plain SQL and the sync stays a dumb ingest.

-- ── Snapshot tables ─────────────────────────────────────────────────────────
create table if not exists public.trellis_property_snapshot (
  trellis_id   uuid primary key,
  workspace    text not null check (workspace in ('A','B')),
  name         text not null,
  status       text,
  city         text,
  synced_at    timestamptz not null default now()
);

create table if not exists public.trellis_task_snapshot (
  trellis_task_id     uuid primary key,
  workspace           text not null check (workspace in ('A','B')),
  trellis_property_id uuid,
  property_name       text,
  title               text,
  department_name     text,
  status              text,
  priority            text,
  assigned_to_id      uuid,
  assigned_to_name    text,
  scheduled_date      date,
  completed_at        timestamptz,
  synced_at           timestamptz not null default now()
);
create index if not exists trellis_task_snapshot_prop_idx on public.trellis_task_snapshot(trellis_property_id);
create index if not exists trellis_task_snapshot_sched_idx on public.trellis_task_snapshot(scheduled_date);

create table if not exists public.trellis_roster (
  user_id     uuid primary key,
  member_id   uuid,
  workspace   text not null default 'A',
  name        text,
  email       text,
  role        text,
  departments text[] not null default '{}',
  is_active   boolean not null default true,
  synced_at   timestamptz not null default now()
);

create table if not exists public.trellis_sync_log (
  id          uuid primary key default gen_random_uuid(),
  status      text not null check (status in ('requested','running','done','error')),
  trigger     text not null default 'manual' check (trigger in ('manual','nightly','poller')),
  requested_by text,
  started_at  timestamptz,
  finished_at timestamptz,
  counts      jsonb,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists trellis_sync_log_status_idx on public.trellis_sync_log(status);

-- ── Name normalization: strip trailing "(XXX)" area code, lowercase, collapse ─
create or replace function public.tendwell_normalize_name(p text)
returns text language sql immutable as $$
  select nullif(
    trim(regexp_replace(
      lower(regexp_replace(coalesce(p,''), '\s*\([^)]*\)\s*$', '')),
      '\s+', ' ', 'g')),
    '')
$$;

-- ── Task-level Tendwell attribution ─────────────────────────────────────────
create or replace view public.trellis_task_attributed
with (security_invoker = true) as
select t.*,
  (t.workspace = 'A'
   or t.assigned_to_name = 'Tendwell Cleaning Co.'
   or t.assigned_to_id in (select user_id from public.trellis_roster))
   as is_tendwell
from public.trellis_task_snapshot t;

-- ── Property enrichment: task counts + Tendwell flags ───────────────────────
create or replace view public.trellis_property_enriched
with (security_invoker = true) as
select p.*,
  coalesce(tc.tendwell_task_count, 0) as tendwell_task_count,
  (p.workspace = 'A' or coalesce(tc.tendwell_task_count, 0) > 0) as is_tendwell_property
from public.trellis_property_snapshot p
left join (
  select trellis_property_id, count(*) as tendwell_task_count
  from public.trellis_task_attributed
  where is_tendwell and trellis_property_id is not null
  group by trellis_property_id
) tc on tc.trellis_property_id = p.trellis_id;

-- ── Reconciliation from the Ops-property perspective ────────────────────────
create or replace view public.trellis_reconciliation
with (security_invoker = true) as
select
  pr.id          as ops_property_id,
  pr.name        as ops_name,
  pr.trellis_id  as linked_trellis_id,
  ts.name        as linked_trellis_name,
  ts.workspace   as linked_workspace,
  ts.is_tendwell_property,
  ts.tendwell_task_count,
  sug.trellis_id as suggested_trellis_id,
  sug.name       as suggested_trellis_name,
  sug.workspace  as suggested_workspace,
  case
    when pr.trellis_id is not null and ts.trellis_id is not null then 'matched'
    when pr.trellis_id is not null and ts.trellis_id is null     then 'stale'
    when pr.trellis_id is null and sug.trellis_id is not null    then 'suggested'
    else 'unmatched'
  end as match_status
from public.properties pr
left join public.trellis_property_enriched ts on ts.trellis_id = pr.trellis_id
left join lateral (
  select e.* from public.trellis_property_enriched e
  where pr.trellis_id is null
    and public.tendwell_normalize_name(e.name) = public.tendwell_normalize_name(pr.name)
  order by e.workspace
  limit 1
) sug on true;

-- ── Exceptions: Tendwell properties in Trellis with no Ops home ─────────────
create or replace view public.trellis_exceptions
with (security_invoker = true) as
select e.trellis_id, e.name, e.workspace, e.status, e.tendwell_task_count
from public.trellis_property_enriched e
where e.is_tendwell_property
  and not exists (select 1 from public.properties pr where pr.trellis_id = e.trellis_id)
  and not exists (
    select 1 from public.properties pr
    where pr.trellis_id is null
      and public.tendwell_normalize_name(pr.name) = public.tendwell_normalize_name(e.name)
  );

-- ── RLS: admin-only read; service role (sync) bypasses RLS ──────────────────
alter table public.trellis_property_snapshot enable row level security;
alter table public.trellis_task_snapshot    enable row level security;
alter table public.trellis_roster           enable row level security;
alter table public.trellis_sync_log         enable row level security;

drop policy if exists trellis_prop_admin_read on public.trellis_property_snapshot;
create policy trellis_prop_admin_read on public.trellis_property_snapshot
  for select to authenticated using (public.current_user_role() = 'admin');

drop policy if exists trellis_task_admin_read on public.trellis_task_snapshot;
create policy trellis_task_admin_read on public.trellis_task_snapshot
  for select to authenticated using (public.current_user_role() = 'admin');

drop policy if exists trellis_roster_admin_read on public.trellis_roster;
create policy trellis_roster_admin_read on public.trellis_roster
  for select to authenticated using (public.current_user_role() = 'admin');

-- Sync log: admins read + insert (the "Refresh" enqueue); updates come from
-- the service-role sync, which bypasses RLS.
drop policy if exists trellis_synclog_admin_read on public.trellis_sync_log;
create policy trellis_synclog_admin_read on public.trellis_sync_log
  for select to authenticated using (public.current_user_role() = 'admin');
drop policy if exists trellis_synclog_admin_insert on public.trellis_sync_log;
create policy trellis_synclog_admin_insert on public.trellis_sync_log
  for insert to authenticated with check (public.current_user_role() = 'admin');

grant select on public.trellis_task_attributed   to authenticated;
grant select on public.trellis_property_enriched to authenticated;
grant select on public.trellis_reconciliation    to authenticated;
grant select on public.trellis_exceptions        to authenticated;
