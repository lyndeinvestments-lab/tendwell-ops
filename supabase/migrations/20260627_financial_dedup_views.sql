-- Property-level single-source dedup for cleans/tasks across Breezeway + Trellis.
-- A property is counted from Breezeway if it has ANY breezeway_tasks rows;
-- otherwise from Trellis. Never both. (Breezeway is system-of-record.)

create or replace view financial_breezeway_property_ids as
  select distinct property_id from breezeway_tasks where property_id is not null;

-- Monthly cleans, deduped, trailing 12 months, no future dates.
create or replace view financial_monthly_cleans as
with bz as (
  select to_char(date_trunc('month', coalesce(completed_date, due_date)), 'YYYY-MM') as month,
         count(*) as cleans
  from breezeway_tasks
  where is_clean = true
    and coalesce(completed_date, due_date) is not null
    and coalesce(completed_date, due_date) <= current_date
    and coalesce(completed_date, due_date) >= (current_date - interval '12 months')
  group by 1
),
-- Trellis cleans ONLY for properties absent from Breezeway (Trellis-only).
trel as (
  select to_char(date_trunc('month', t.scheduled_date), 'YYYY-MM') as month,
         count(*) as cleans
  from trellis_task_snapshot t
  join properties p on p.trellis_id = t.trellis_property_id::text
  where t.department_name ilike '%clean%'
    and t.scheduled_date is not null
    and t.scheduled_date <= current_date
    and t.scheduled_date >= (current_date - interval '12 months')
    and p.id not in (select property_id from financial_breezeway_property_ids)
  group by 1
)
select month, sum(cleans)::bigint as cleans
from (select * from bz union all select * from trel) u
group by month
order by month;

-- Current open task load, deduped (same single-source rule).
create or replace view financial_task_load as
with bz as (
  select
    count(*) filter (where due_date < current_date) as overdue,
    count(*) filter (where due_date = current_date) as today,
    count(*) filter (where due_date > current_date and due_date <= current_date + interval '7 days') as week
  from breezeway_tasks
  where is_clean = true and status is distinct from 'Completed' and due_date is not null
),
trel as (
  select
    count(*) filter (where t.scheduled_date < current_date) as overdue,
    count(*) filter (where t.scheduled_date = current_date) as today,
    count(*) filter (where t.scheduled_date > current_date and t.scheduled_date <= current_date + interval '7 days') as week
  from trellis_task_snapshot t
  join properties p on p.trellis_id = t.trellis_property_id::text
  where t.department_name ilike '%clean%'
    and t.completed_at is null
    and t.scheduled_date is not null
    and p.id not in (select property_id from financial_breezeway_property_ids)
)
select 'overdue' as bucket, (bz.overdue + trel.overdue)::bigint as tasks from bz, trel
union all select 'today', (bz.today + trel.today)::bigint from bz, trel
union all select 'week', (bz.week + trel.week)::bigint from bz, trel;

grant select on financial_monthly_cleans, financial_task_load, financial_breezeway_property_ids to authenticated;
