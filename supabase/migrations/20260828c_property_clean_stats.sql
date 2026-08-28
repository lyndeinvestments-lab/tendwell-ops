-- Pricing tab: auto-calculated first clean date + frequency.
--
-- property_clean_stats supersedes property_breezeway_stats for the Pricing
-- (pro-forma) tab. Differences:
--   - Breezeway ∪ Trellis (Trellis only for properties absent from
--     Breezeway — same dedup rule as everywhere else), so Trellis-only
--     properties get stats at all.
--   - first_clean_date: the earliest real clean task on record — the page
--     previously relied on a manually-entered properties.first_clean_date.
--   - avg_cleans_per_month is a RECENT rate (last 90 days), not an all-time
--     average: a property that churned months ago reads 0/mo instead of its
--     historical rate. New properties (< 3 months old) divide by their
--     actual active window (floored at half a month) so week-one properties
--     don't read as 30/mo.
create or replace view property_clean_stats as
with all_cleans as (
  select property_id, due_date as d, is_deep_clean as deep
  from breezeway_tasks
  where property_id is not null
    and (is_clean or is_deep_clean)
    and due_date is not null
    and due_date <= current_date
  union all
  select p.id, t.scheduled_date, (t.title ilike '%deep%')
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

grant select on property_clean_stats to authenticated;
