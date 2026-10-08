-- Invoice accuracy (2026-10-08, Haven review of invoice 1096).
--
-- 1. invoice_lines.service_date — the day the work actually happened (the
--    matched completed task's date when the vendor is a day off). Printed on
--    the client invoice and used to split invoices by month. NULL on old rows
--    means "use raw_date_mentioned".
-- 2. invoice_runs.qbo_invoice_nos — one QBO invoice number PER SERVICE MONTH
--    ({"2026-09": 1096, "2026-10": 1097}). Haven books every vendor by month
--    and rejected 1096 for mixing September and October (Jo, 2026-10-06).
--    qbo_invoice_no stays as the first month's number for back-compat.
-- 3. property_first_tendwell_clean — earliest date Tendwell is known to have
--    cleaned each property. An onboarding charge is only valid on that first
--    clean (Jordan, 2026-10-08).

alter table public.invoice_lines add column if not exists service_date date;
alter table public.invoice_runs add column if not exists qbo_invoice_nos jsonb;

create or replace view public.property_first_tendwell_clean as
with ev as (
  -- Cleans we billed on an approved/exported run.
  select l.property_id, coalesce(l.service_date, l.raw_date_mentioned) as d
  from public.invoice_lines l
  join public.invoice_runs r on r.id = l.run_id
  where r.status in ('approved', 'exported')
    and r.archived_at is null
    and l.property_id is not null
    and l.line_kind in ('clean', 'combined_split', 'deep_clean')
    and l.review_status <> 'excluded'
  union all
  -- Completed Breezeway cleans done by Tendwell / Busy Bee crews.
  select b.property_id, b.due_date
  from public.breezeway_tasks b
  where b.property_id is not null
    and (b.is_clean or b.is_deep_clean)
    and (b.completed_date is not null or lower(coalesce(b.status, '')) in ('closed', 'finished', 'completed', 'done'))
    and b.assignees ~* '(busy\s*bee|tendwell|norma|oniel)'
  union all
  -- Completed Trellis cleans attributed to Tendwell.
  select p.id, t.scheduled_date
  from public.trellis_task_attributed t
  join public.properties p on p.trellis_id = t.trellis_property_id::text
  where t.is_tendwell
    and upper(coalesce(t.status, '')) = 'COMPLETED'
    and t.title ~* '(clean|turn|departure|onboarding)'
    and t.title !~* '(self.?in?spection|inspection|touch.?up|vacancy|hot\s*tub|trash)'
)
select property_id, min(d) as first_clean_date
from ev
where d is not null and public.is_staff_or_server()
group by property_id;

revoke all on public.property_first_tendwell_clean from anon;
grant select on public.property_first_tendwell_clean to authenticated, service_role;
