-- property_first_tendwell_clean: a billed line is evidence of WHEN Tendwell
-- first cleaned only through the task it matched.
--
-- The 20261008 view took min(service_date) over every billed clean line, so a
-- billed clean with no Breezeway/Trellis task — exactly the lines Haven
-- rejected — set the "first clean" date. Nirav Patel 2266 read 9/3 (a Turn on
-- 1089 with no task); his real first clean is the 9/10 Onboarding (BW Closed +
-- Trellis COMPLETED), so the 9/10 onboarding fee would have been refused.
--
-- Now:
--   * a billed line counts at its matched task's date, and only when that
--     task is completed (Breezeway external_id, or 'trellis:<id>');
--   * a billed line with no task counts only for a property that has no
--     task-backed evidence at all (Ops still knows Tendwell was there, so a
--     later "plus onboarding" is still caught).

create or replace view public.property_first_tendwell_clean as
with billed as (
  select l.property_id, coalesce(l.service_date, l.raw_date_mentioned) as d, l.matched_task_id
  from public.invoice_lines l
  join public.invoice_runs r on r.id = l.run_id
  where r.status in ('approved', 'exported')
    and r.archived_at is null
    and l.property_id is not null
    and l.line_kind in ('clean', 'combined_split', 'deep_clean')
    and l.review_status <> 'excluded'
),
strong as (
  -- Billed cleans, dated by the completed task they matched.
  select b.property_id, coalesce(bt.due_date, tt.scheduled_date) as d
  from billed b
  left join public.breezeway_tasks bt
    on bt.external_id = b.matched_task_id
   and (bt.completed_date is not null or lower(coalesce(bt.status, '')) in ('closed', 'finished', 'completed', 'done'))
  left join public.trellis_task_snapshot tt
    on 'trellis:' || tt.trellis_task_id = b.matched_task_id
   and upper(coalesce(tt.status, '')) = 'COMPLETED'
  where b.matched_task_id is not null
  union all
  -- Completed Breezeway cleans done by Tendwell / Busy Bee crews.
  select bw.property_id, bw.due_date
  from public.breezeway_tasks bw
  where bw.property_id is not null
    and (bw.is_clean or bw.is_deep_clean)
    and (bw.completed_date is not null or lower(coalesce(bw.status, '')) in ('closed', 'finished', 'completed', 'done'))
    and bw.assignees ~* '(busy\s*bee|tendwell|norma|oniel)'
  union all
  -- Completed Trellis cleans attributed to Tendwell.
  select p.id, t.scheduled_date
  from public.trellis_task_attributed t
  join public.properties p on p.trellis_id = t.trellis_property_id::text
  where t.is_tendwell
    and upper(coalesce(t.status, '')) = 'COMPLETED'
    and t.title ~* '(clean|turn|departure|onboarding)'
    and t.title !~* '(self.?in?spection|inspection|touch.?up|vacancy|hot\s*tub|trash)'
),
ev as (
  select property_id, d from strong where d is not null
  union all
  select b.property_id, b.d
  from billed b
  where b.d is not null
    and not exists (select 1 from strong s where s.property_id = b.property_id and s.d is not null)
)
select property_id, min(d) as first_clean_date
from ev
where public.is_staff_or_server()
group by property_id;

revoke all on public.property_first_tendwell_clean from anon;
grant select on public.property_first_tendwell_clean to authenticated, service_role;
