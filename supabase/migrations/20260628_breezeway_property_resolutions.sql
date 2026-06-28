-- Durable resolutions for "In Breezeway, not in Ops" orphans (Trellis Sync).
-- Each Breezeway property string (property_raw) that didn't match an Ops
-- property can be either MATCHED to an Ops property (an alias the weekly
-- Breezeway import consults, so it stays matched) or IGNORED (hidden as a
-- known non-Ops property). Admin-only writes; authenticated read.

create table if not exists breezeway_property_resolutions (
  property_raw text primary key,
  status       text not null check (status in ('matched','ignored')),
  property_id  bigint references properties(id) on delete set null,
  resolved_by  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table breezeway_property_resolutions enable row level security;

drop policy if exists bpr_read on breezeway_property_resolutions;
create policy bpr_read on breezeway_property_resolutions
  for select to authenticated using (true);

drop policy if exists bpr_write on breezeway_property_resolutions;
create policy bpr_write on breezeway_property_resolutions
  for all to authenticated
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

grant select, insert, update, delete on breezeway_property_resolutions to authenticated;

-- Hide 'ignored' orphans from the exceptions panel. (Matched orphans drop out
-- automatically once their breezeway_tasks rows get property_id set.)
create or replace view breezeway_exceptions as
select
  property_raw,
  count(*) filter (where is_clean) as clean_count,
  count(*) as task_count,
  min(due_date) as first_due,
  max(due_date) as last_due
from breezeway_tasks
where property_id is null and property_raw is not null
  and property_raw not in (
    select property_raw from breezeway_property_resolutions where status = 'ignored'
  )
group by property_raw
order by count(*) filter (where is_clean) desc;
