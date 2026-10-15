-- 20261014g — Trellis API expansion WS5: Trellis-first financial clean counts.
--
-- Applied live via Supabase MCP on 2026-10-14. Rebuilt from pg_get_viewdef of
-- the live views (the migrations folder is not the live DB).
--
-- Every financial clean-count view was Breezeway-first: Breezeway rows for any
-- property that ever had one, Trellis only for properties Breezeway never saw.
-- This migration adds a configurable cutover month:
--
--   app_settings.clean_source_cutover (YYYY-MM-01, default '9999-12-01')
--
--   * days BEFORE the cutover: unchanged Breezeway logic (the archive), with the
--     Trellis fallback branch fixed (see below).
--   * days ON/AFTER the cutover: Trellis. Tendwell's completed cleans
--     (status COMPLETED, clean_kind IS NOT NULL, is_tendwell), one per property
--     per day, mapped to Ops properties through trellis_ops_property_map (so
--     property_aliases count). Breezeway fills in a property-month only when the
--     property has no Trellis history yet at the start of that month (unlinked
--     properties, or properties added to Trellis mid-month) and Breezeway has
--     cleans for it. That fallback retires itself as properties get linked.
--
-- With the default '9999-12-01' nothing switches; the only change on apply is
-- the Trellis fallback branch fix WS1 flagged: it counted every status and
-- non-clean titles (self-inspections etc.) by department_name ILIKE '%clean%'.
-- It now counts only Tendwell's completed cleans (clean_kind IS NOT NULL,
-- status COMPLETED) via trellis_ops_property_map.
--
-- CREATE OR REPLACE with identical column names / types / order so dependents
-- (property_month_financials -> property_monthly_cleans, the API areas) keep
-- working. Grants are unchanged (CREATE OR REPLACE keeps ACLs); every view
-- keeps its staff / finance gate. New objects revoke anon.

-- ── 1. Setting + accessor ──────────────────────────────────────────────────
insert into public.app_settings (key, value)
values ('clean_source_cutover', '9999-12-01')
on conflict (key) do nothing;

-- Definer so invoker-rights callers (compute_monthly_estimate, the client)
-- can read the cutover even though app_settings is finance-gated. Returns the
-- first of the configured month; anything malformed means "never" (Breezeway
-- logic everywhere), never an error that would break every financial page.
create or replace function public.clean_source_cutover()
returns date
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v text;
begin
  select s.value into v from public.app_settings s where s.key = 'clean_source_cutover';
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' then
    return date '9999-12-01';
  end if;
  return date_trunc('month', v::date)::date;
exception when others then
  return date '9999-12-01';
end;
$$;

revoke all on function public.clean_source_cutover() from public, anon;
grant execute on function public.clean_source_cutover() to authenticated, service_role;

comment on function public.clean_source_cutover() is
  'First day of the month from which financial clean counts come from Trellis instead of Breezeway (app_settings.clean_source_cutover; 9999-12-01 = never). WS5, 2026-10-14.';

-- ── 2. Trellis-era clean days (shared by every view below) ─────────────────
-- One row per property per clean day, for days >= cutover and <= today.
-- source = 'trellis' normally; 'breezeway' for a property-month where the
-- property had no Trellis history at the month start and Breezeway has cleans.
create or replace view public.trellis_era_clean_days as
select property_id, d, deep, source
from (
  with cut as (
    select public.clean_source_cutover() as c
  ), tr as (
    select m.property_id, t.scheduled_date as d, bool_or(t.clean_kind = 'deep') as deep
    from public.trellis_task_snapshot t
    join public.trellis_ops_property_map m on m.trellis_id = t.trellis_property_id
    cross join cut
    where t.clean_kind is not null
      and t.status = 'COMPLETED'
      and coalesce(t.is_tendwell, false)
      and t.scheduled_date >= cut.c
      and t.scheduled_date <= current_date
    group by m.property_id, t.scheduled_date
  ), since as (
    select m.property_id, min(t.scheduled_date) as trellis_since
    from public.trellis_task_snapshot t
    join public.trellis_ops_property_map m on m.trellis_id = t.trellis_property_id
    group by m.property_id
  ), bz as (
    select b.property_id, b.due_date as d, bool_or(b.is_deep_clean) as deep
    from public.breezeway_tasks b
    cross join cut
    where b.property_id is not null
      and (b.is_clean or b.is_deep_clean)
      and b.due_date >= cut.c
      and b.due_date <= current_date
    group by b.property_id, b.due_date
  ), bz_months as (
    select distinct bz.property_id, date_trunc('month', bz.d)::date as m
    from bz
    left join since s on s.property_id = bz.property_id
    where s.trellis_since is null
       or s.trellis_since > date_trunc('month', bz.d)::date
  )
  select tr.property_id, tr.d, tr.deep, 'trellis'::text as source
  from tr
  where not exists (
    select 1 from bz_months x
    where x.property_id = tr.property_id and x.m = date_trunc('month', tr.d)::date
  )
  union all
  select bz.property_id, bz.d, bz.deep, 'breezeway'::text as source
  from bz
  join bz_months x on x.property_id = bz.property_id and x.m = date_trunc('month', bz.d)::date
) _gated
where public.is_staff_or_server();

revoke all on public.trellis_era_clean_days from anon;
grant select on public.trellis_era_clean_days to authenticated, service_role;

comment on view public.trellis_era_clean_days is
  'Clean days per property from the clean_source_cutover month on: Tendwell completed Trellis cleans (one per property-day), with Breezeway only for property-months that predate the property''s Trellis history. Staff/server only. WS5, 2026-10-14.';

-- ── 3. property_monthly_cleans ─────────────────────────────────────────────
create or replace view public.property_monthly_cleans as
select property_id, month, cleans, deep_cleans
from (
  with cut as (
    select public.clean_source_cutover() as c
  ), bz as (
    select breezeway_tasks.property_id,
      date_trunc('month', breezeway_tasks.due_date::timestamptz)::date as month,
      count(distinct breezeway_tasks.due_date) filter (where breezeway_tasks.is_clean or breezeway_tasks.is_deep_clean) as cleans,
      count(distinct breezeway_tasks.due_date) filter (where breezeway_tasks.is_deep_clean) as deep_cleans
    from public.breezeway_tasks, cut
    where breezeway_tasks.property_id is not null
      and breezeway_tasks.due_date is not null
      and breezeway_tasks.due_date <= current_date
      and breezeway_tasks.due_date >= date_trunc('month', current_date - interval '1 year 2 mons')
      and breezeway_tasks.due_date < cut.c
    group by breezeway_tasks.property_id, (date_trunc('month', breezeway_tasks.due_date::timestamptz)::date)
  ), trel as (
    -- Pre-cutover fallback: properties Breezeway never saw.
    select m.property_id,
      date_trunc('month', t.scheduled_date::timestamptz)::date as month,
      count(distinct t.scheduled_date) as cleans,
      count(distinct t.scheduled_date) filter (where t.clean_kind = 'deep') as deep_cleans
    from public.trellis_task_snapshot t
    join public.trellis_ops_property_map m on m.trellis_id = t.trellis_property_id
    cross join cut
    where t.clean_kind is not null
      and t.status = 'COMPLETED'
      and coalesce(t.is_tendwell, true)
      and t.scheduled_date is not null
      and t.scheduled_date <= current_date
      and t.scheduled_date < cut.c
      and not (m.property_id in (select financial_breezeway_property_ids.property_id from public.financial_breezeway_property_ids))
    group by m.property_id, (date_trunc('month', t.scheduled_date::timestamptz)::date)
  ), era as (
    select e.property_id,
      date_trunc('month', e.d::timestamptz)::date as month,
      count(*) as cleans,
      count(*) filter (where e.deep) as deep_cleans
    from public.trellis_era_clean_days e
    group by e.property_id, (date_trunc('month', e.d::timestamptz)::date)
  )
  select u.property_id, u.month,
    sum(u.cleans)::integer as cleans,
    sum(u.deep_cleans)::integer as deep_cleans
  from (
    select bz.property_id, bz.month, bz.cleans, bz.deep_cleans from bz
    union all
    select trel.property_id, trel.month, trel.cleans, trel.deep_cleans from trel
    union all
    select era.property_id, era.month, era.cleans, era.deep_cleans from era
  ) u
  where public.is_staff()
  group by u.property_id, u.month
) _gated
where public.is_staff_or_server();

-- ── 4. financial_monthly_cleans ────────────────────────────────────────────
create or replace view public.financial_monthly_cleans as
select month, cleans
from (
  with cut as (
    select public.clean_source_cutover() as c
  ), bz as (
    select to_char(date_trunc('month', breezeway_tasks.due_date::timestamptz), 'YYYY-MM') as month,
      count(*) as cleans
    from public.breezeway_tasks, cut
    where breezeway_tasks.is_clean = true
      and breezeway_tasks.due_date is not null
      and breezeway_tasks.due_date <= current_date
      and breezeway_tasks.due_date >= (current_date - interval '1 year')
      and breezeway_tasks.due_date < cut.c
    group by (to_char(date_trunc('month', breezeway_tasks.due_date::timestamptz), 'YYYY-MM'))
  ), trel as (
    select to_char(date_trunc('month', t.scheduled_date::timestamptz), 'YYYY-MM') as month,
      count(*) as cleans
    from public.trellis_task_snapshot t
    join public.trellis_ops_property_map m on m.trellis_id = t.trellis_property_id
    cross join cut
    where t.clean_kind is not null
      and t.status = 'COMPLETED'
      and coalesce(t.is_tendwell, true)
      and t.scheduled_date is not null
      and t.scheduled_date <= current_date
      and t.scheduled_date >= (current_date - interval '1 year')
      and t.scheduled_date < cut.c
      and not (m.property_id in (select financial_breezeway_property_ids.property_id from public.financial_breezeway_property_ids))
    group by (to_char(date_trunc('month', t.scheduled_date::timestamptz), 'YYYY-MM'))
  ), era as (
    select to_char(date_trunc('month', e.d::timestamptz), 'YYYY-MM') as month,
      count(*) as cleans
    from public.trellis_era_clean_days e
    where e.d >= (current_date - interval '1 year')
    group by (to_char(date_trunc('month', e.d::timestamptz), 'YYYY-MM'))
  )
  select u.month, sum(u.cleans)::bigint as cleans
  from (
    select bz.month, bz.cleans from bz
    union all
    select trel.month, trel.cleans from trel
    union all
    select era.month, era.cleans from era
  ) u
  group by u.month
  order by u.month
) _gated
where public.can_view_financials();

-- ── 5. property_clean_stats ────────────────────────────────────────────────
create or replace view public.property_clean_stats as
select property_id, first_clean_date, latest_task, total_cleans, months_with_data,
  cleans_90d, avg_cleans_per_month, avg_deep_cleans_per_month
from (
  with cut as (
    select public.clean_source_cutover() as c
  ), all_cleans as (
    select distinct breezeway_tasks.property_id,
      breezeway_tasks.due_date as d,
      bool_or(breezeway_tasks.is_deep_clean) over (partition by breezeway_tasks.property_id, breezeway_tasks.due_date) as deep
    from public.breezeway_tasks, cut
    where breezeway_tasks.property_id is not null
      and (breezeway_tasks.is_clean or breezeway_tasks.is_deep_clean)
      and breezeway_tasks.due_date is not null
      and breezeway_tasks.due_date <= current_date
      and breezeway_tasks.due_date < cut.c
    union
    select m.property_id, t.scheduled_date, bool_or(t.clean_kind = 'deep')
    from public.trellis_task_snapshot t
    join public.trellis_ops_property_map m on m.trellis_id = t.trellis_property_id
    cross join cut
    where t.clean_kind is not null
      and t.status = 'COMPLETED'
      and coalesce(t.is_tendwell, true)
      and t.scheduled_date is not null
      and t.scheduled_date <= current_date
      and t.scheduled_date < cut.c
      and not (m.property_id in (select financial_breezeway_property_ids.property_id from public.financial_breezeway_property_ids))
    group by m.property_id, t.scheduled_date
    union
    select e.property_id, e.d, e.deep
    from public.trellis_era_clean_days e
  )
  select all_cleans.property_id,
    min(all_cleans.d) as first_clean_date,
    max(all_cleans.d) as latest_task,
    count(*) as total_cleans,
    count(distinct date_trunc('month', all_cleans.d::timestamptz)) as months_with_data,
    count(*) filter (where all_cleans.d >= (current_date - 90)) as cleans_90d,
    round(count(*) filter (where all_cleans.d >= (current_date - 90))::numeric
      / greatest(0.5, least(3::numeric, (current_date - min(all_cleans.d))::numeric / 30.44)), 1) as avg_cleans_per_month,
    round(count(*) filter (where all_cleans.deep and all_cleans.d >= (current_date - 90))::numeric
      / greatest(0.5, least(3::numeric, (current_date - min(all_cleans.d))::numeric / 30.44)), 1) as avg_deep_cleans_per_month
  from all_cleans
  where public.is_staff()
  group by all_cleans.property_id
) _gated
where public.is_staff_or_server();

-- ── 6. financial_task_load ─────────────────────────────────────────────────
-- Open cleans (overdue in the last 30 days / today / next 7 days). Before the
-- cutover: Breezeway + Trellis for properties Breezeway never saw (now only
-- real Tendwell cleans). From the cutover: Trellis open Tendwell cleans, plus
-- Breezeway only for properties with no Trellis link at all.
create or replace view public.financial_task_load as
select bucket, tasks
from (
  with cut as (
    select public.clean_source_cutover() as c, current_date >= public.clean_source_cutover() as trellis_era
  ), bz as (
    select count(*) filter (where breezeway_tasks.due_date < current_date and breezeway_tasks.due_date >= (current_date - interval '30 days')) as overdue,
      count(*) filter (where breezeway_tasks.due_date = current_date) as today,
      count(*) filter (where breezeway_tasks.due_date > current_date and breezeway_tasks.due_date <= (current_date + interval '7 days')) as week
    from public.breezeway_tasks, cut
    where breezeway_tasks.is_clean
      and (lower(breezeway_tasks.status) = any (array['created', 'overdue', 'in progress']))
      and breezeway_tasks.due_date is not null
      and (not cut.trellis_era
           or not exists (select 1 from public.trellis_ops_property_map mm where mm.property_id = breezeway_tasks.property_id))
  ), trel as (
    select count(*) filter (where t.scheduled_date < current_date and t.scheduled_date >= (current_date - interval '30 days')) as overdue,
      count(*) filter (where t.scheduled_date = current_date) as today,
      count(*) filter (where t.scheduled_date > current_date and t.scheduled_date <= (current_date + interval '7 days')) as week
    from public.trellis_task_snapshot t
    join public.trellis_ops_property_map m on m.trellis_id = t.trellis_property_id
    cross join cut
    where t.clean_kind is not null
      and t.status <> 'COMPLETED'
      and t.completed_at is null
      and coalesce(t.is_tendwell, true)
      and t.scheduled_date is not null
      and (cut.trellis_era
           or not (m.property_id in (select financial_breezeway_property_ids.property_id from public.financial_breezeway_property_ids)))
  )
  select 'overdue'::text as bucket, bz.overdue + trel.overdue as tasks from bz, trel
  union all
  select 'today'::text as bucket, bz.today + trel.today as tasks from bz, trel
  union all
  select 'week'::text as bucket, bz.week + trel.week as tasks from bz, trel
) _gated
where public.can_view_financials();

-- ── 7. property_month_financials (only the `tail` CTE reads raw sources) ───
create or replace view public.property_month_financials as
select property_id, property_name, stage_name, month, cleans, deep_cleans,
  invoiced_revenue, invoiced_pay, qbo_income, revenue, revenue_source,
  cleaner_pay, pay_source, variable_costs, allocated_overhead, overhead_source,
  est_revenue, est_cleaner_pay
from (
  with cut as (
    select public.clean_source_cutover() as c
  ), inv_coverage as (
    select coalesce(max(r.period_end), '1900-01-01'::date) as through_date
    from public.invoice_runs r
    where r.archived_at is null and r.status <> 'void'
  ), cleans as (
    select property_monthly_cleans.property_id, property_monthly_cleans.month,
      property_monthly_cleans.cleans, property_monthly_cleans.deep_cleans
    from public.property_monthly_cleans
  ), tail as (
    select u.property_id, u.month,
      sum(u.cleans)::integer as tail_cleans,
      sum(u.deep_cleans)::integer as tail_deep
    from (
      select breezeway_tasks.property_id,
        date_trunc('month', breezeway_tasks.due_date::timestamptz)::date as month,
        count(distinct breezeway_tasks.due_date) filter (where breezeway_tasks.is_clean or breezeway_tasks.is_deep_clean) as cleans,
        count(distinct breezeway_tasks.due_date) filter (where breezeway_tasks.is_deep_clean) as deep_cleans
      from public.breezeway_tasks, inv_coverage, cut
      where breezeway_tasks.property_id is not null
        and breezeway_tasks.due_date > inv_coverage.through_date
        and breezeway_tasks.due_date <= current_date
        and breezeway_tasks.due_date < cut.c
      group by breezeway_tasks.property_id, (date_trunc('month', breezeway_tasks.due_date::timestamptz)::date)
      union all
      select m.property_id,
        date_trunc('month', t.scheduled_date::timestamptz)::date as date_trunc,
        count(distinct t.scheduled_date) as count,
        count(distinct t.scheduled_date) filter (where t.clean_kind = 'deep') as count
      from public.trellis_task_snapshot t
      join public.trellis_ops_property_map m on m.trellis_id = t.trellis_property_id
      cross join inv_coverage
      cross join cut
      where t.clean_kind is not null
        and t.status = 'COMPLETED'
        and coalesce(t.is_tendwell, true)
        and t.scheduled_date > inv_coverage.through_date
        and t.scheduled_date <= current_date
        and t.scheduled_date < cut.c
        and not (m.property_id in (select financial_breezeway_property_ids.property_id from public.financial_breezeway_property_ids))
      group by m.property_id, (date_trunc('month', t.scheduled_date::timestamptz)::date)
      union all
      select e.property_id,
        date_trunc('month', e.d::timestamptz)::date,
        count(*),
        count(*) filter (where e.deep)
      from public.trellis_era_clean_days e, inv_coverage
      where e.d > inv_coverage.through_date
      group by e.property_id, (date_trunc('month', e.d::timestamptz)::date)
    ) u
    group by u.property_id, u.month
  ), inv as (
    select il.property_id,
      date_trunc('month', coalesce(il.raw_date_mentioned, r.period_end, r.invoice_date)::timestamptz)::date as month,
      sum(coalesce(il.client_charge_amount, 0::numeric)) as invoiced_revenue,
      sum(coalesce(il.cleaner_pay_amount, 0::numeric)) as invoiced_pay,
      count(*) as invoiced_lines
    from public.invoice_lines il
    join public.invoice_runs r on r.id = il.run_id
    where r.archived_at is null and r.status <> 'void' and il.property_id is not null
    group by il.property_id, (date_trunc('month', coalesce(il.raw_date_mentioned, r.period_end, r.invoice_date)::timestamptz)::date)
  ), qcls as (
    select coalesce(c_1.matched_property_id::bigint, pm.id) as property_id,
      q_1.month,
      sum(q_1.income) as qbo_income
    from public.qbo_class_pl_months q_1
    join public.qbo_classes c_1 on c_1.qbo_id = q_1.qbo_class_id
    left join public.properties pm on pm.deleted_at is null and lower(pm.name) = lower(c_1.name)
    where coalesce(c_1.matched_property_id::bigint, pm.id) is not null
    group by (coalesce(c_1.matched_property_id::bigint, pm.id)), q_1.month
  ), keys as (
    select cleans.property_id, cleans.month from cleans
    union
    select inv.property_id, inv.month from inv
  ), company as (
    select property_monthly_cleans.month, sum(property_monthly_cleans.cleans) as company_cleans
    from public.property_monthly_cleans
    group by property_monthly_cleans.month
  ), formula_totals as (
    select c_1.month,
      sum(c_1.cleans::numeric * (coalesce(p2.est_laundry, 0::numeric) + coalesce(p2.est_consumables, 0::numeric))) as formula_total
    from public.property_monthly_cleans c_1
    join public.properties p2 on p2.id = c_1.property_id
    group by c_1.month
  ), qvar as (
    select qbo_pl_months.month,
      coalesce((qbo_pl_months.cogs_breakdown ->> 'Laundry')::numeric, 0::numeric)
        + coalesce((qbo_pl_months.cogs_breakdown ->> 'Cleaning Supplies')::numeric, 0::numeric)
        + coalesce((qbo_pl_months.cogs_breakdown ->> 'Supplies Expense')::numeric, 0::numeric) as qbo_variable
    from public.qbo_pl_months
  ), pool as (
    select qbo_pl_months.month,
      greatest(0::numeric, coalesce(qbo_pl_months.total_cogs, 0::numeric)
        - coalesce((qbo_pl_months.cogs_breakdown ->> 'Cleaning Contractor Pay')::numeric, 0::numeric)
        - coalesce((qbo_pl_months.cogs_breakdown ->> 'Laundry')::numeric, 0::numeric)
        - coalesce((qbo_pl_months.cogs_breakdown ->> 'Cleaning Supplies')::numeric, 0::numeric)
        - coalesce((qbo_pl_months.cogs_breakdown ->> 'Supplies Expense')::numeric, 0::numeric))
        + coalesce(qbo_pl_months.total_expenses, 0::numeric) as overhead_pool
    from public.qbo_pl_months
  )
  select k.property_id,
    p.name as property_name,
    ps.name as stage_name,
    k.month,
    coalesce(c.cleans, 0) as cleans,
    coalesce(c.deep_cleans, 0) as deep_cleans,
    round(coalesce(i.invoiced_revenue, 0::numeric), 2) as invoiced_revenue,
    round(coalesce(i.invoiced_pay, 0::numeric), 2) as invoiced_pay,
    round(coalesce(q.qbo_income, 0::numeric), 2) as qbo_income,
    round(coalesce(nullif(q.qbo_income, 0::numeric), nullif(i.invoiced_revenue, 0::numeric),
        (coalesce(c.cleans, 0) - coalesce(tl.tail_cleans, 0))::numeric * coalesce(p.ce_charged, 0::numeric))
      + greatest(0, coalesce(tl.tail_cleans, 0) - coalesce(tl.tail_deep, 0))::numeric * coalesce(p.ce_charged, 0::numeric)
      + coalesce(tl.tail_deep, 0)::numeric * coalesce(p.deep_clean_3x_ce, 3::numeric * coalesce(p.ce_charged, 0::numeric)), 2) as revenue,
    case
      when coalesce(q.qbo_income, 0::numeric) <> 0::numeric then 'qbo'::text
      when coalesce(i.invoiced_revenue, 0::numeric) <> 0::numeric then 'invoiced'::text
      else 'estimate'::text
    end as revenue_source,
    round(coalesce(nullif(i.invoiced_pay, 0::numeric),
        (coalesce(c.cleans, 0) - coalesce(tl.tail_cleans, 0))::numeric * coalesce(p.cleaner_pay, 0::numeric))
      + coalesce(tl.tail_cleans, 0)::numeric * coalesce(p.cleaner_pay, 0::numeric), 2) as cleaner_pay,
    case
      when coalesce(i.invoiced_pay, 0::numeric) <> 0::numeric then 'invoiced'::text
      else 'estimate'::text
    end as pay_source,
    round(coalesce(c.cleans, 0)::numeric * (coalesce(p.est_laundry, 0::numeric) + coalesce(p.est_consumables, 0::numeric))
      * coalesce(case when qv.qbo_variable > 0::numeric and ft.formula_total > 0::numeric then qv.qbo_variable / ft.formula_total else null::numeric end, 1::numeric), 2) as variable_costs,
    round(coalesce(pool.overhead_pool * coalesce(c.cleans, 0)::numeric / nullif(co.company_cleans, 0)::numeric,
        coalesce(c.cleans, 0)::numeric * (coalesce(p.inspection_cost, 0::numeric) + coalesce(p.trash_cost, 0::numeric))), 2) as allocated_overhead,
    case
      when pool.month is not null and coalesce(co.company_cleans, 0::bigint) > 0 then 'actual'::text
      else 'average'::text
    end as overhead_source,
    round(greatest(0, coalesce(c.cleans, 0) - coalesce(c.deep_cleans, 0))::numeric * coalesce(p.ce_charged, 0::numeric)
      + coalesce(c.deep_cleans, 0)::numeric * coalesce(p.deep_clean_3x_ce, 3::numeric * coalesce(p.ce_charged, 0::numeric)), 2) as est_revenue,
    round(coalesce(c.cleans, 0)::numeric * coalesce(p.cleaner_pay, 0::numeric), 2) as est_cleaner_pay
  from keys k
  join public.properties p on p.id = k.property_id and p.deleted_at is null
  left join public.pipeline_stages ps on ps.id = p.stage_id
  left join cleans c on c.property_id = k.property_id and c.month = k.month
  left join tail tl on tl.property_id = k.property_id and tl.month = k.month
  left join inv i on i.property_id = k.property_id and i.month = k.month
  left join qcls q on q.property_id = k.property_id and q.month = k.month
  left join company co on co.month = k.month
  left join formula_totals ft on ft.month = k.month
  left join qvar qv on qv.month = k.month
  left join pool on pool.month = k.month
  where public.is_staff()
) _gated
where public.can_view_financials();

-- ── 8. property_breezeway_stats ────────────────────────────────────────────
-- Name kept for compatibility. Breezeway rows before the cutover, Trellis-era
-- clean days after it (one pseudo-row per clean day).
create or replace view public.property_breezeway_stats as
select property_id, total_cleans, total_deep_cleans, months_with_data,
  avg_cleans_per_month, avg_deep_cleans_per_month, earliest_task, latest_task
from (
  with cut as (
    select public.clean_source_cutover() as c
  ), src as (
    select bt.id::text as id, bt.property_id, bt.due_date, bt.is_clean, bt.is_deep_clean
    from public.breezeway_tasks bt, cut
    where bt.due_date is null or bt.due_date < cut.c
    union all
    select 'era:' || e.property_id || ':' || e.d, e.property_id, e.d, not e.deep, e.deep
    from public.trellis_era_clean_days e
  )
  select p.id as property_id,
    coalesce(count(bt.id) filter (where bt.is_clean), 0::bigint) as total_cleans,
    coalesce(count(bt.id) filter (where bt.is_deep_clean), 0::bigint) as total_deep_cleans,
    count(distinct to_char(bt.due_date::timestamptz, 'YYYY-MM')) as months_with_data,
    case
      when count(distinct to_char(bt.due_date::timestamptz, 'YYYY-MM')) > 0
        then round(count(bt.id) filter (where bt.is_clean)::numeric / count(distinct to_char(bt.due_date::timestamptz, 'YYYY-MM'))::numeric, 1)
      else 0::numeric
    end as avg_cleans_per_month,
    case
      when count(distinct to_char(bt.due_date::timestamptz, 'YYYY-MM')) > 0
        then round(count(bt.id) filter (where bt.is_deep_clean)::numeric / count(distinct to_char(bt.due_date::timestamptz, 'YYYY-MM'))::numeric, 2)
      else 0::numeric
    end as avg_deep_cleans_per_month,
    min(bt.due_date) as earliest_task,
    max(bt.due_date) as latest_task
  from public.properties p
  left join src bt on bt.property_id = p.id
  group by p.id
) _gated
where public.is_staff_or_server();

-- ── 9. compute_monthly_estimate(target_month) ──────────────────────────────
-- Before the cutover month: unchanged (Breezeway rows due in the month).
-- From the cutover month: Tendwell Trellis cleans in the month that are
-- completed or still upcoming (scheduled today or later), one per property
-- per day, split clean vs deep by clean_kind; Breezeway only for properties
-- with no Trellis history at the month start (same rule as
-- trellis_era_clean_days).
create or replace function public.compute_monthly_estimate(target_month date)
returns table(est_revenue numeric, est_cogs numeric, est_opex numeric, est_profit numeric,
  cleans_count integer, deep_cleans_count integer, active_properties integer, per_property jsonb)
language sql
stable
set search_path = public, pg_catalog
as $function$
  WITH cut AS (
    SELECT public.clean_source_cutover() AS c
  ),
  bz_rows AS (
    SELECT bt.property_id, bt.is_clean, bt.is_deep_clean
    FROM breezeway_tasks bt
    WHERE bt.due_date >= target_month
      AND bt.due_date <  (target_month + INTERVAL '1 month')::date
      AND bt.property_id IS NOT NULL
  ),
  since AS (
    SELECT m.property_id, min(t.scheduled_date) AS trellis_since
    FROM trellis_task_snapshot t
    JOIN trellis_ops_property_map m ON m.trellis_id = t.trellis_property_id
    GROUP BY m.property_id
  ),
  bz_mode AS (
    SELECT DISTINCT b.property_id
    FROM bz_rows b
    LEFT JOIN since s ON s.property_id = b.property_id
    WHERE (b.is_clean OR b.is_deep_clean)
      AND (s.trellis_since IS NULL OR s.trellis_since > date_trunc('month', target_month)::date)
  ),
  tr_days AS (
    SELECT m.property_id, t.scheduled_date AS d, bool_or(t.clean_kind = 'deep') AS deep
    FROM trellis_task_snapshot t
    JOIN trellis_ops_property_map m ON m.trellis_id = t.trellis_property_id
    WHERE t.clean_kind IS NOT NULL
      AND coalesce(t.is_tendwell, false)
      AND (t.status = 'COMPLETED' OR t.scheduled_date >= current_date)
      AND t.scheduled_date >= target_month
      AND t.scheduled_date <  (target_month + INTERVAL '1 month')::date
    GROUP BY m.property_id, t.scheduled_date
  ),
  tasks AS (
    -- Breezeway era (unchanged).
    SELECT
      bt.property_id,
      COUNT(*) FILTER (WHERE bt.is_clean)      AS cleans,
      COUNT(*) FILTER (WHERE bt.is_deep_clean) AS deep_cleans
    FROM bz_rows bt, cut
    WHERE target_month < cut.c
    GROUP BY bt.property_id
    UNION ALL
    -- Trellis era.
    SELECT
      d.property_id,
      COUNT(*) FILTER (WHERE NOT d.deep) AS cleans,
      COUNT(*) FILTER (WHERE d.deep)     AS deep_cleans
    FROM tr_days d, cut
    WHERE target_month >= cut.c
      AND d.property_id NOT IN (SELECT property_id FROM bz_mode)
    GROUP BY d.property_id
    UNION ALL
    -- Trellis era, property-months that predate the property's Trellis history.
    SELECT
      bt.property_id,
      COUNT(*) FILTER (WHERE bt.is_clean)      AS cleans,
      COUNT(*) FILTER (WHERE bt.is_deep_clean) AS deep_cleans
    FROM bz_rows bt, cut
    WHERE target_month >= cut.c
      AND bt.property_id IN (SELECT property_id FROM bz_mode)
    GROUP BY bt.property_id
  ),
  rolled AS (
    SELECT
      t.property_id,
      p.name AS property_name,
      t.cleans,
      t.deep_cleans,
      (t.cleans      * COALESCE(op.ce_charged, 0)
       + t.deep_cleans * COALESCE(op.deep_clean_3x_ce, op.ce_charged * 3, 0))    AS revenue,
      (t.cleans      * COALESCE(op.total_estimated_cost, 0)
       + t.deep_cleans * COALESCE(op.estimated_deep_clean_cost, op.total_estimated_cost, 0))
                                                                                  AS cogs
    FROM tasks t
    LEFT JOIN operational_properties op ON op.id = t.property_id
    LEFT JOIN properties             p  ON p.id  = t.property_id
  )
  SELECT
    COALESCE(SUM(revenue), 0)::numeric                                AS est_revenue,
    COALESCE(SUM(cogs), 0)::numeric                                   AS est_cogs,
    0::numeric                                                        AS est_opex,
    (COALESCE(SUM(revenue), 0) - COALESCE(SUM(cogs), 0))::numeric     AS est_profit,
    COALESCE(SUM(cleans), 0)::integer                                 AS cleans_count,
    COALESCE(SUM(deep_cleans), 0)::integer                            AS deep_cleans_count,
    COUNT(DISTINCT property_id)::integer                              AS active_properties,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
         'property_id',   r.property_id,
         'property_name', r.property_name,
         'cleans',        r.cleans,
         'deep_cleans',   r.deep_cleans,
         'revenue',       r.revenue,
         'cogs',          r.cogs
       ) ORDER BY r.revenue DESC)
       FROM rolled r WHERE r.property_id IS NOT NULL),
      '[]'::jsonb
    )                                                                 AS per_property
  FROM rolled;
$function$;
