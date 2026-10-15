-- 20261014h — Trellis API expansion WS5: sync freshness for every staff role,
-- and the clean-source cutover switched on.
--
-- Applied live via Supabase MCP on 2026-10-14.
--
-- 1. trellis_sync_freshness(): the data-freshness alert now watches the Trellis
--    sync (the source behind every financial clean count from the cutover on).
--    trellis_sync_log is admin-read, so non-admin staff read it through this
--    definer function, which returns timestamps and statuses only (no counts,
--    errors or requester emails). Staff only; anon revoked.
--    A 'partial' run (hit its deadline and stopped cleanly, WS1) counts as a
--    successful sync, same as 'done'.
--
-- 2. clean_source_cutover = 2026-10-01. Validated on the overlap months before
--    switching (see the WS5 PR for the numbers): for Aug, Sep and Oct 2026 every
--    Breezeway-finished clean at a Trellis-linked property has a Tendwell
--    completed Trellis clean within 3 days (Sep: 202 of 203 property-months
--    within 1 clean), and the only Breezeway cleans Trellis does not have are at
--    15 properties that are not linked to Trellis yet (CTN-*, two Kathryn Hunt
--    units, Michael Peralta 1563). Those keep counting from Breezeway through
--    the property-month fallback in trellis_era_clean_days until they are linked
--    and have a full month of Trellis history.

-- ── 1. Freshness ────────────────────────────────────────────────────────────
create or replace function public.trellis_sync_freshness()
returns table(
  last_success_at timestamptz,
  last_success_status text,
  last_success_trigger text,
  last_full_success_at timestamptz,
  last_run_at timestamptz,
  last_run_status text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    s.finished_at,
    s.status,
    s.trigger,
    (select max(f.finished_at) from public.trellis_sync_log f
      where f.status in ('done', 'partial') and f.trigger <> 'hourly'),
    l.created_at,
    l.status
  from (select 1) one
  left join lateral (
    select finished_at, status, trigger from public.trellis_sync_log
    where status in ('done', 'partial') and finished_at is not null
    order by finished_at desc limit 1
  ) s on true
  left join lateral (
    select created_at, status from public.trellis_sync_log
    order by created_at desc limit 1
  ) l on true
  -- current_user is the owner inside a definer function, so is_staff_or_server()
  -- would pass everyone; check the caller's SET ROLE instead (PostgREST sets it).
  where public.is_staff()
     or coalesce(nullif(current_setting('role', true), ''), 'none') not in ('anon', 'authenticated')
$$;

revoke all on function public.trellis_sync_freshness() from public, anon;
grant execute on function public.trellis_sync_freshness() to authenticated, service_role;

comment on function public.trellis_sync_freshness() is
  'Last successful (done or partial) Trellis sync, last non-hourly success and the latest run status, for the data-freshness alert. Staff/server only; no counts or errors. WS5, 2026-10-14.';

-- ── 2. Switch financial clean counts to Trellis from October 2026 ──────────
update public.app_settings set value = '2026-10-01' where key = 'clean_source_cutover';
