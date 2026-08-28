-- Billing-coverage check: expected revenue is now deep-clean-aware.
--
-- est_revenue was cleans × ce_charged; a deep clean bills at the property's
-- deep rate (deep_clean_3x_ce = custom override or 3× CE), so months with
-- deep cleans understated expectations and a missed billing could hide.
-- New: est_revenue = (cleans − deep_cleans) × ce_charged
--                  + deep_cleans × deep_clean_3x_ce.
-- The UI surfaces revenue − est_revenue as the "vs expected" billing gap.
create or replace view property_month_financials as
with cleans as (
  select * from property_monthly_cleans
),
inv as (
  select il.property_id,
         date_trunc('month', coalesce(il.raw_date_mentioned, r.period_end, r.invoice_date))::date as month,
         sum(coalesce(il.client_charge_amount, 0)) as invoiced_revenue,
         sum(coalesce(il.cleaner_pay_amount, 0)) as invoiced_pay,
         count(*) as invoiced_lines
  from invoice_lines il
  join invoice_runs r on r.id = il.run_id
  where r.archived_at is null
    and r.status <> 'void'
    and il.property_id is not null
  group by 1, 2
),
qcls as (
  select coalesce(c.matched_property_id, pm.id) as property_id,
         q.month,
         sum(q.income) as qbo_income
  from qbo_class_pl_months q
  join qbo_classes c on c.qbo_id = q.qbo_class_id
  left join properties pm on pm.deleted_at is null and lower(pm.name) = lower(c.name)
  where coalesce(c.matched_property_id, pm.id) is not null
  group by 1, 2
),
keys as (
  select property_id, month from cleans
  union
  select property_id, month from inv
),
company as (
  select month, sum(cleans) as company_cleans from property_monthly_cleans group by 1
),
formula_totals as (
  select c.month,
         sum(c.cleans * (coalesce(p2.est_laundry, 0) + coalesce(p2.est_consumables, 0))) as formula_total
  from property_monthly_cleans c
  join properties p2 on p2.id = c.property_id
  group by 1
),
qvar as (
  select month,
         coalesce((cogs_breakdown->>'Laundry')::numeric, 0)
         + coalesce((cogs_breakdown->>'Cleaning Supplies')::numeric, 0)
         + coalesce((cogs_breakdown->>'Supplies Expense')::numeric, 0) as qbo_variable
  from qbo_pl_months
),
pool as (
  select month,
         greatest(0,
           coalesce(total_cogs, 0)
           - coalesce((cogs_breakdown->>'Cleaning Contractor Pay')::numeric, 0)
           - coalesce((cogs_breakdown->>'Laundry')::numeric, 0)
           - coalesce((cogs_breakdown->>'Cleaning Supplies')::numeric, 0)
           - coalesce((cogs_breakdown->>'Supplies Expense')::numeric, 0)
         ) + coalesce(total_expenses, 0) as overhead_pool
  from qbo_pl_months
)
select
  k.property_id,
  p.name as property_name,
  ps.name as stage_name,
  k.month,
  coalesce(c.cleans, 0) as cleans,
  coalesce(c.deep_cleans, 0) as deep_cleans,
  round(coalesce(i.invoiced_revenue, 0)::numeric, 2) as invoiced_revenue,
  round(coalesce(i.invoiced_pay, 0)::numeric, 2) as invoiced_pay,
  round(coalesce(q.qbo_income, 0)::numeric, 2) as qbo_income,
  round(coalesce(nullif(q.qbo_income, 0), nullif(i.invoiced_revenue, 0),
                 coalesce(c.cleans, 0) * coalesce(p.ce_charged, 0))::numeric, 2) as revenue,
  case when coalesce(q.qbo_income, 0) <> 0 then 'qbo'
       when coalesce(i.invoiced_revenue, 0) <> 0 then 'invoiced'
       else 'estimate' end as revenue_source,
  round(coalesce(nullif(i.invoiced_pay, 0),
                 coalesce(c.cleans, 0) * coalesce(p.cleaner_pay, 0))::numeric, 2) as cleaner_pay,
  case when coalesce(i.invoiced_pay, 0) <> 0 then 'invoiced' else 'estimate' end as pay_source,
  round((
    coalesce(c.cleans, 0) * (coalesce(p.est_laundry, 0) + coalesce(p.est_consumables, 0))
    * coalesce(
        case when qv.qbo_variable > 0 and ft.formula_total > 0
             then qv.qbo_variable / ft.formula_total end,
        1
      )
  )::numeric, 2) as variable_costs,
  round(coalesce(
    pool.overhead_pool * coalesce(c.cleans, 0) / nullif(co.company_cleans, 0),
    coalesce(c.cleans, 0) * (coalesce(p.inspection_cost, 0) + coalesce(p.trash_cost, 0))
  )::numeric, 2) as allocated_overhead,
  case when pool.month is not null and coalesce(co.company_cleans, 0) > 0 then 'actual' else 'average' end as overhead_source,
  -- Expected revenue from real task counts at sheet rates, deep-aware:
  -- regular cleans at CE, deep cleans at the deep rate.
  round((
    greatest(0, coalesce(c.cleans, 0) - coalesce(c.deep_cleans, 0)) * coalesce(p.ce_charged, 0)
    + coalesce(c.deep_cleans, 0) * coalesce(p.deep_clean_3x_ce, 3 * coalesce(p.ce_charged, 0))
  )::numeric, 2) as est_revenue,
  round((coalesce(c.cleans, 0) * coalesce(p.cleaner_pay, 0))::numeric, 2) as est_cleaner_pay
from keys k
join properties p on p.id = k.property_id and p.deleted_at is null
left join pipeline_stages ps on ps.id = p.stage_id
left join cleans c on c.property_id = k.property_id and c.month = k.month
left join inv i on i.property_id = k.property_id and i.month = k.month
left join qcls q on q.property_id = k.property_id and q.month = k.month
left join company co on co.month = k.month
left join formula_totals ft on ft.month = k.month
left join qvar qv on qv.month = k.month
left join pool on pool.month = k.month
where public.is_staff();
