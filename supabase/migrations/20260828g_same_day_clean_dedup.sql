-- Same-day dedup: a Departure Clean + Turn Clean logged the same day at the
-- same property is ONE physical clean (the invoicing engine already matches
-- per (property, day)). Count DISTINCT days, not tasks — real case: Lou and
-- Elva Romano 2556 showed 6 August cleans for 5 changeovers, inflating
-- expected revenue by one $665 clean and flagging a phantom billing gap.
create or replace view property_monthly_cleans as
with bz as (
  select property_id,
         date_trunc('month', due_date)::date as month,
         count(distinct due_date) filter (where is_clean or is_deep_clean) as cleans,
         count(distinct due_date) filter (where is_deep_clean) as deep_cleans
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
         count(distinct t.scheduled_date) as cleans,
         count(distinct t.scheduled_date) filter (where t.title ilike '%deep%') as deep_cleans
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

-- Same rule for the pricing tab's auto first-clean/frequency stats.
create or replace view property_clean_stats as
with all_cleans as (
  select distinct property_id, due_date as d,
         bool_or(is_deep_clean) over (partition by property_id, due_date) as deep
  from breezeway_tasks
  where property_id is not null
    and (is_clean or is_deep_clean)
    and due_date is not null
    and due_date <= current_date
  union
  select distinct p.id, t.scheduled_date,
         bool_or(t.title ilike '%deep%') over (partition by p.id, t.scheduled_date)
  from trellis_task_snapshot t
  join properties p on p.trellis_id = t.trellis_property_id::text
  where t.department_name ilike '%clean%'
    and t.scheduled_date is not null
    and t.scheduled_date <= current_date
    and p.id not in (select property_id from financial_breezeway_property_ids)
)
select
  property_id,
  min(d) as first_clean_date,
  max(d) as latest_task,
  count(*) as total_cleans,
  count(distinct date_trunc('month', d)) as months_with_data,
  count(*) filter (where d >= current_date - 90) as cleans_90d,
  round(
    (count(*) filter (where d >= current_date - 90))::numeric
      / greatest(0.5, least(3, (current_date - min(d))::numeric / 30.44)),
    1
  ) as avg_cleans_per_month,
  round(
    (count(*) filter (where deep and d >= current_date - 90))::numeric
      / greatest(0.5, least(3, (current_date - min(d))::numeric / 30.44)),
    1
  ) as avg_deep_cleans_per_month
from all_cleans
where public.is_staff()
group by property_id;
