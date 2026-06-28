-- Fix: GET /trellis_exceptions returned 500 (Postgres 57014, statement timeout)
-- for the authenticated admin user, while service_role ran the same view in
-- ~2.6ms. Root cause: the view was security_invoker=true, so it read the
-- underlying snapshot tables under RLS. Each RLS policy calls the non-leakproof
-- current_user_role(), which the planner treats as a security barrier. That
-- barrier defeats optimization of this view's expensive double
-- tendwell_normalize_name() anti-join (~243 properties x ~326 enriched rows of
-- regexp work), pushing the query past the authenticated role's 8s
-- statement_timeout. (trellis_reconciliation is unaffected because its plan
-- never hits that anti-join.)
--
-- Fix: run the view as its owner (postgres) via security_invoker=off so the
-- underlying RLS is bypassed (postgres owns those tables and they are not
-- FORCE ROW LEVEL SECURITY), restoring the fast plan. Access stays admin-only
-- via an explicit current_user_role() = 'admin' guard in the view body
-- (current_user_role() reads the per-request JWT regardless of view security
-- mode, so anon / non-admin callers get zero rows, exactly as before).

create or replace view public.trellis_exceptions as
select
  e.trellis_id,
  e.name,
  e.workspace,
  e.status,
  e.tendwell_task_count
from trellis_property_enriched e
where current_user_role() = 'admin'
  and e.is_tendwell_property
  and not exists (
    select 1 from properties pr
    where pr.trellis_id = e.trellis_id::text
  )
  and not exists (
    select 1 from properties pr
    where pr.trellis_id is null
      and tendwell_normalize_name(pr.name) = tendwell_normalize_name(e.name)
  );

alter view public.trellis_exceptions set (security_invoker = off);
