-- Fix financial_task_load "open task" definition.
-- Breezeway's done statuses are 'Finished' and 'Closed' (not 'Completed'), so
-- the original `status is distinct from 'Completed'` counted ALL backfilled
-- historical cleans as open (3,400+ false "overdue"). Open = not-done statuses
-- only; and bound "overdue" to the last 30 days so year-old un-finalized
-- 'Created' backfill rows don't read as current overdue work.

create or replace view financial_task_load as
with bz as (
  select
    count(*) filter (where due_date < current_date and due_date >= current_date - interval '30 days') as overdue,
    count(*) filter (where due_date = current_date) as today,
    count(*) filter (where due_date > current_date and due_date <= current_date + interval '7 days') as week
  from breezeway_tasks
  where is_clean
    and lower(status) in ('created','overdue','in progress')
    and due_date is not null
),
trel as (
  select
    count(*) filter (where t.scheduled_date < current_date and t.scheduled_date >= current_date - interval '30 days') as overdue,
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
