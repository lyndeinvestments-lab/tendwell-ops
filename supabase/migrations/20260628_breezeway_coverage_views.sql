-- Phase 1.5: Breezeway coverage for the Trellis Sync property-source map.
-- Two small read-only views. The Trellis Sync page merges
-- breezeway_property_coverage into its existing trellis_reconciliation rows
-- by ops_property_id (a trivial id->row map, no dedup logic duplicated), and
-- shows breezeway_exceptions as a symmetric "In Breezeway, not in Ops" panel
-- (parallel to the existing "In Trellis, not in Ops").

-- Per-Ops-property Breezeway clean coverage (matched tasks only).
create or replace view breezeway_property_coverage as
select
  property_id,
  count(*) filter (where is_clean) as clean_count,
  count(*) as task_count,
  max(due_date) filter (where is_clean) as last_clean_due
from breezeway_tasks
where property_id is not null
group by property_id;

-- Breezeway tasks that never matched an Ops property (property_id is null),
-- grouped by the raw Breezeway property string — the orphans to reconcile.
create or replace view breezeway_exceptions as
select
  property_raw,
  count(*) filter (where is_clean) as clean_count,
  count(*) as task_count,
  min(due_date) as first_due,
  max(due_date) as last_due
from breezeway_tasks
where property_id is null and property_raw is not null
group by property_raw
order by count(*) filter (where is_clean) desc;

grant select on breezeway_property_coverage, breezeway_exceptions to authenticated;
