-- Trellis sync page speed (2026-10-20). Wrap per-row RLS helper calls in scalar subqueries so
-- Postgres evaluates them once per statement (InitPlan) instead of once per row.
-- Semantics are identical; only the plan changes.
--
-- Why: trellis_task_snapshot has ~34.5k rows after the 2026-10-14 history backfill and its
-- SELECT policy was bare is_staff() (SECURITY DEFINER, app_users + auth lookup, ~0.14 ms/call).
-- trellis_reconciliation / trellis_exceptions aggregate the whole table through the
-- security_invoker views, so the page paid 34.5k is_staff() calls twice (7.5 s + 4.8 s).

alter policy trellis_task_staff_read on public.trellis_task_snapshot
  using ((select public.is_staff()));

alter policy trellis_prop_admin_read on public.trellis_property_snapshot
  using (((select public.current_user_role()) = 'admin'));

alter policy trellis_roster_admin_read on public.trellis_roster
  using (((select public.current_user_role()) = 'admin'));

alter policy trellis_synclog_admin_read on public.trellis_sync_log
  using (((select public.current_user_role()) = 'admin'));

alter policy trellis_dismissals_admin_read on public.trellis_reconciliation_dismissals
  using (((select public.current_user_role()) = 'admin'));

-- Same pattern on the big Breezeway table (13k rows; used by invoicing and the Breezeway tab).
alter policy breezeway_tasks_select_authenticated on public.breezeway_tasks
  using ((select public.is_staff()));

-- Optional, small win: the lateral "suggested match" in trellis_reconciliation re-runs the
-- regexp normalizer over every Trellis property for each unlinked Ops property.
-- tendwell_normalize_name() is IMMUTABLE, so an expression index is allowed.
create index if not exists trellis_property_snapshot_normname_idx
  on public.trellis_property_snapshot (public.tendwell_normalize_name(name));

-- Optional: History tab / lastSync order by created_at with no index (1.1k rows, grows ~24/day).
create index if not exists trellis_sync_log_created_at_idx
  on public.trellis_sync_log (created_at desc);
