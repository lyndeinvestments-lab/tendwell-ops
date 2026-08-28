-- Pro Forma rebuild: real P&L + per-property profitability foundation.
--
-- 1. qbo_pl_months        — company P&L per month, synced nightly from the
--                           QBO ProfitAndLoss report (replaces the
--                           app_settings.qbo_pl_data blob as the source of
--                           truth; the blob had no in-repo writer and its
--                           month keys broke the client parser).
-- 2. qbo_class_pl_months  — P&L per QBO Class per month (Classes ≈
--                           properties via qbo_classes matching) — the
--                           "what QuickBooks says this property earned".
-- 3. property_monthly_cleans — per (property, month) clean counts,
--                           Breezeway ∪ Trellis with the same
--                           Breezeway-wins property-level dedup as
--                           financial_monthly_cleans.
-- 4. property_month_financials — the per-property monthly P&L: revenue and
--                           cleaner pay from actuals when available (QBO
--                           class income → invoicing → sheet estimate),
--                           laundry/consumables from the per-clean formula
--                           columns, and company overhead (inspection,
--                           trash, leadership, opex) allocated across
--                           properties by task share.
--
-- Both views embed WHERE public.is_staff(): they are definer-style views
-- over tables with mixed RLS (invoice_lines is permission-gated), so the
-- guard keeps aggregate financials staff-only without depending on the
-- caller having every underlying grant.

create table if not exists qbo_pl_months (
  month date primary key,
  total_income numeric not null default 0,
  total_cogs numeric not null default 0,
  gross_profit numeric not null default 0,
  total_expenses numeric not null default 0,
  net_income numeric not null default 0,
  income_breakdown jsonb not null default '{}'::jsonb,
  cogs_breakdown jsonb not null default '{}'::jsonb,
  expense_breakdown jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists qbo_class_pl_months (
  month date not null,
  qbo_class_id text not null, -- qbo_classes.qbo_id, or '__unspecified' for QBO's "Not Specified" column
  class_name text not null,
  income numeric not null default 0,
  cogs numeric not null default 0,
  expenses numeric not null default 0,
  net_income numeric not null default 0,
  synced_at timestamptz not null default now(),
  primary key (month, qbo_class_id)
);

alter table qbo_pl_months enable row level security;
alter table qbo_class_pl_months enable row level security;

drop policy if exists qbo_pl_months_staff_select on qbo_pl_months;
create policy qbo_pl_months_staff_select on qbo_pl_months
  for select using (public.is_staff());

drop policy if exists qbo_class_pl_months_staff_select on qbo_class_pl_months;
create policy qbo_class_pl_months_staff_select on qbo_class_pl_months
  for select using (public.is_staff());

-- Writes happen only via the service role (sync cron) which bypasses RLS.

-- ── Per-property monthly clean counts ──────────────────────────────────────
-- Same dedup rule as financial_monthly_cleans: Breezeway is system-of-record
-- for any property that appears in Breezeway at all; Trellis fills in only
-- Trellis-only properties. Counts by due/scheduled date (not completed_date —
-- the 2026-03 bulk mark-complete corrupted completed_date on the backfill).
-- Window: trailing 14 months, capped at today.
create or replace view property_monthly_cleans as
with bz as (
  select property_id,
         date_trunc('month', due_date)::date as month,
         count(*) filter (where is_clean or is_deep_clean) as cleans,
         count(*) filter (where is_deep_clean) as deep_cleans
  from breezeway_tasks
  where property_id is not null
    and due_date is not null
    and due_date <= current_date
    and due_date >= date_trunc('month', current_date - interval '14 months')
  group by 1, 2
),
trel as (
  select p.id as property_id,
         date_trunc('month', t.scheduled_date)::date as month,
         count(*) as cleans,
         count(*) filter (where t.title ilike '%deep%') as deep_cleans
  from trellis_task_snapshot t
  join properties p on p.trellis_id = t.trellis_property_id::text
  where t.department_name ilike '%clean%'
    and t.scheduled_date is not null
    and t.scheduled_date <= current_date
    and p.id not in (select property_id from financial_breezeway_property_ids)
  group by 1, 2
)
select property_id, month,
       sum(cleans)::int as cleans,
       sum(deep_cleans)::int as deep_cleans
from (select * from bz union all select * from trel) u
where public.is_staff()
group by 1, 2;

-- ── Per-property monthly P&L ───────────────────────────────────────────────
create or replace view property_month_financials as
with cleans as (
  select * from property_monthly_cleans
),
inv as (
  -- Invoicing actuals: exact client charges + cleaner pay per property-month.
  -- Month attribution: the line's own service date, else the run period end.
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
  -- QBO class income per property-month. Manual link wins, else exact
  -- case-insensitive name match (mirrors qboClassFor in the exporters).
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
pool as (
  -- Monthly overhead to allocate across tasks: everything in COGS that is
  -- not directly attributed per property (contractor pay → invoicing;
  -- laundry + supplies → the per-clean formula columns), plus all operating
  -- expenses. Unknown new COGS accounts fall INTO the pool by construction,
  -- so nothing silently escapes allocation.
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
  -- Revenue: QBO class actual → invoicing actual → sheet estimate
  round(coalesce(nullif(q.qbo_income, 0), nullif(i.invoiced_revenue, 0),
                 coalesce(c.cleans, 0) * coalesce(p.ce_charged, 0))::numeric, 2) as revenue,
  case when coalesce(q.qbo_income, 0) <> 0 then 'qbo'
       when coalesce(i.invoiced_revenue, 0) <> 0 then 'invoiced'
       else 'estimate' end as revenue_source,
  -- Cleaner pay: invoicing actual → rate × cleans
  round(coalesce(nullif(i.invoiced_pay, 0),
                 coalesce(c.cleans, 0) * coalesce(p.cleaner_pay, 0))::numeric, 2) as cleaner_pay,
  case when coalesce(i.invoiced_pay, 0) <> 0 then 'invoiced' else 'estimate' end as pay_source,
  -- Formula-driven variable costs (per-clean laundry + consumables × cleans)
  round((coalesce(c.cleans, 0) * (coalesce(p.est_laundry, 0) + coalesce(p.est_consumables, 0)))::numeric, 2) as variable_costs,
  -- Overhead: actual monthly pool allocated by task share when QBO has the
  -- month; otherwise the sheet's per-clean inspection+trash averages.
  round(coalesce(
    pool.overhead_pool * coalesce(c.cleans, 0) / nullif(co.company_cleans, 0),
    coalesce(c.cleans, 0) * (coalesce(p.inspection_cost, 0) + coalesce(p.trash_cost, 0))
  )::numeric, 2) as allocated_overhead,
  case when pool.month is not null and coalesce(co.company_cleans, 0) > 0 then 'actual' else 'average' end as overhead_source,
  -- Pure sheet estimates (rates × cleans), for estimate-vs-actual rollups
  round((coalesce(c.cleans, 0) * coalesce(p.ce_charged, 0))::numeric, 2) as est_revenue,
  round((coalesce(c.cleans, 0) * coalesce(p.cleaner_pay, 0))::numeric, 2) as est_cleaner_pay
from keys k
join properties p on p.id = k.property_id and p.deleted_at is null
left join pipeline_stages ps on ps.id = p.stage_id
left join cleans c on c.property_id = k.property_id and c.month = k.month
left join inv i on i.property_id = k.property_id and i.month = k.month
left join qcls q on q.property_id = k.property_id and q.month = k.month
left join company co on co.month = k.month
left join pool on pool.month = k.month
where public.is_staff();

grant select on property_monthly_cleans, property_month_financials to authenticated;
