-- Migration: trellis_reconciliation_dismissals
-- Adds a dismissal table so admins can snooze noise rows in the Trellis
-- Reconciliation and Exceptions panels without losing the underlying data.
-- Also refines trellis_reconciliation to exclude deleted properties and
-- Lead/Quote properties that have no Trellis link (pre-onboarding noise).

-- ── 1. Create dismissals table ─────────────────────────────────────────────

create table if not exists public.trellis_reconciliation_dismissals (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null,
  trellis_property_id text,
  ops_property_id  bigint,
  dismissed_by     text,
  created_at       timestamptz not null default now()
);

comment on table public.trellis_reconciliation_dismissals is
  'Admin-controlled dismissals for Trellis reconciliation / exception rows. '
  'kind = ''trellis_not_in_ops'' (trellis_property_id set) or '
  '''ops_not_in_trellis'' (ops_property_id set).';

-- ── 2. Row-level security ──────────────────────────────────────────────────

alter table public.trellis_reconciliation_dismissals enable row level security;

create policy "trellis_dismissals_admin_read"
  on public.trellis_reconciliation_dismissals
  for select to authenticated
  using (current_user_role() = 'admin');

create policy "trellis_dismissals_admin_insert"
  on public.trellis_reconciliation_dismissals
  for insert to authenticated
  with check (current_user_role() = 'admin');

create policy "trellis_dismissals_admin_delete"
  on public.trellis_reconciliation_dismissals
  for delete to authenticated
  using (current_user_role() = 'admin');

-- ── 3. Refine trellis_reconciliation view ─────────────────────────────────
-- Changes from previous version:
--   a) WHERE pr.deleted_at IS NULL  — skip soft-deleted Ops properties
--   b) Exclude unmatched/suggested rows for Lead or Quote properties —
--      Trellis links are not expected until Onboarding, so those rows add
--      noise without being actionable.
--
-- Note: the view deliberately does NOT filter by dismissals. The client
-- fetches dismissals separately (trellis_reconciliation_dismissals) and
-- applies the hide/show toggle in JS, which lets the "Show dismissed"
-- toggle work without a view parameter.

create or replace view public.trellis_reconciliation
with (security_invoker = true) as
select
  pr.id            as ops_property_id,
  pr.name          as ops_name,
  pr.trellis_id    as linked_trellis_id,
  ts.name          as linked_trellis_name,
  ts.workspace     as linked_workspace,
  ts.is_tendwell_property,
  ts.tendwell_task_count,
  sug.trellis_id   as suggested_trellis_id,
  sug.name         as suggested_trellis_name,
  sug.workspace    as suggested_workspace,
  case
    when pr.trellis_id is not null and ts.trellis_id is not null then 'matched'
    when pr.trellis_id is not null and ts.trellis_id is null     then 'stale'
    when pr.trellis_id is null and sug.trellis_id is not null    then 'suggested'
    else 'unmatched'
  end as match_status
from public.properties pr
left join public.trellis_property_enriched ts
  on ts.trellis_id::text = pr.trellis_id
left join lateral (
  select
    e.trellis_id, e.workspace, e.name, e.status, e.city,
    e.synced_at, e.tendwell_task_count, e.is_tendwell_property
  from public.trellis_property_enriched e
  where pr.trellis_id is null
    and tendwell_normalize_name(e.name) = tendwell_normalize_name(pr.name)
  order by e.workspace
  limit 1
) sug on true
left join public.pipeline_stages ps on ps.id = pr.stage_id
where pr.deleted_at is null
  -- Exclude Lead/Quote properties that have no Trellis link yet.
  -- Trellis is not expected for pre-onboarding properties, so these rows
  -- would always be 'unmatched'/'suggested' and create noise.
  and not (
    ps.name in ('Lead', 'Quote')
    and pr.trellis_id is null
  );
