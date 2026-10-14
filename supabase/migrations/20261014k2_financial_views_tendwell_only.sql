-- 20261014k2 — financial clean counts: only Tendwell's Trellis cleans.
--
-- The Trellis fallback branches of the financial views (used for properties
-- with no Breezeway history) counted EVERY Trellis task in a cleaning
-- department at the property, whoever did it. Until 2026-10-14 the snapshot
-- only held ~30 days of other people's completed workspace-B tasks, so this
-- was small (13 tasks at 2 properties); the WS1 history backfill now keeps
-- every completed workspace-B Cleaning task back to 2025-06 (attribution
-- needs "the last clean by anyone"), which would have added ~200 Haven-crew
-- tasks at 9 properties to Tendwell's historical clean counts.
--
-- Fix: those branches also require trellis_task_snapshot.is_tendwell
-- (NULL still counts, as before, for a row not yet classified). Everything
-- else in each view is the live definition, untouched (patched in place from
-- pg_get_viewdef, so columns, types and grants are identical). Idempotent.
-- WS5 rewrites these views: keep the is_tendwell condition.

do $$
declare
  v text;
  def text;
  patched text;
begin
  foreach v in array array['financial_monthly_cleans', 'property_monthly_cleans', 'financial_task_load',
                           'property_clean_stats', 'property_month_financials']
  loop
    def := pg_get_viewdef(('public.' || v)::regclass, false);
    if def like '%is_tendwell%' then
      raise notice '% already filters is_tendwell', v;
      continue;
    end if;
    patched := replace(def, '(t.department_name ~~* ''%clean%''::text)',
                       '(t.department_name ~~* ''%clean%''::text) AND COALESCE(t.is_tendwell, true)');
    if patched = def then
      raise exception 'view % has no Trellis cleaning-department branch to patch', v;
    end if;
    execute format('create or replace view public.%I as %s', v, patched);
  end loop;
end
$$;
