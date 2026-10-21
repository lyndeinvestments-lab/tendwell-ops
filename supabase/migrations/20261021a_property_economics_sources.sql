-- 20261021a — Per-Property economics sources + real-invoices-only financials.
--
-- 1. property_month_financials counted every non-void, non-archived invoice
--    run, so unarchived TEST uploads (status review_needed) doubled invoiced
--    pay/charges for June–September and pushed dozens of properties negative.
--    Only approved/exported runs are real Busy Bee bills. It also counted
--    excluded split rows, which repeat part of their base line's amount.
--    Patched in place from pg_get_viewdef (columns, types, grants unchanged).
--    The TEST runs were also archived on 2026-10-21.
--
-- 2. financial_clean_days — one row per property per clean day, the same
--    sources and rules as property_monthly_cleans (Breezeway before the
--    clean_source_cutover, the Trellis fallback for properties Breezeway never
--    saw, trellis_era_clean_days from the cutover). Lets the Per-Property tab
--    work in Busy Bee weeks (inspection pay is split across the properties
--    cleaned that week) instead of whole months.
--
-- 3. financial_invoice_lines — Busy Bee invoice lines from approved/exported,
--    non-archived runs only, with a single work_date
--    (service_date → raw_date_mentioned → run period_end). Excluded rows are
--    dropped: they are slices of a base line already carrying the amount.
--
-- Both views are finance-only (can_view_financials) and revoke anon.

-- ── 1. property_month_financials: approved/exported runs only ─────────────
do $$
declare
  def text;
  patched text;
begin
  def := pg_get_viewdef('public.property_month_financials'::regclass, false);
  patched := def;
  if def not like '%''approved''::text, ''exported''::text%' then
    patched := replace(patched, '(r.status <> ''void''::text)',
                       '(r.status = ANY (ARRAY[''approved''::text, ''exported''::text]))');
    if patched = def then
      raise exception 'property_month_financials: run status filter not found';
    end if;
  end if;
  if def not like '%review_status%' then
    def := patched;
    patched := replace(patched, '(il.property_id IS NOT NULL)',
                       '(il.property_id IS NOT NULL) AND (il.line_kind IS DISTINCT FROM ''excluded''::text) AND (il.review_status IS DISTINCT FROM ''excluded''::text)');
    if patched = def then
      raise exception 'property_month_financials: invoice line filter not found';
    end if;
  end if;
  execute format('create or replace view public.property_month_financials as %s', patched);
end
$$;

-- ── 2. financial_clean_days ────────────────────────────────────────────────
create or replace view public.financial_clean_days as
select property_id, d, deep, source
from (
  with cut as (
    select public.clean_source_cutover() as c
  ), lo as (
    select date_trunc('month', current_date - interval '15 months')::date as d
  )
  select b.property_id, b.due_date as d, bool_or(b.is_deep_clean) as deep, 'breezeway'::text as source
  from public.breezeway_tasks b, cut, lo
  where b.property_id is not null
    and (b.is_clean or b.is_deep_clean)
    and b.due_date is not null
    and b.due_date >= lo.d
    and b.due_date <= current_date
    and b.due_date < cut.c
  group by b.property_id, b.due_date
  union all
  select m.property_id, t.scheduled_date, bool_or(t.clean_kind = 'deep'), 'trellis'::text
  from public.trellis_task_snapshot t
  join public.trellis_ops_property_map m on m.trellis_id = t.trellis_property_id
  cross join cut
  cross join lo
  where t.clean_kind is not null
    and t.status = 'COMPLETED'
    and coalesce(t.is_tendwell, true)
    and t.scheduled_date is not null
    and t.scheduled_date >= lo.d
    and t.scheduled_date <= current_date
    and t.scheduled_date < cut.c
    and m.property_id not in (select f.property_id from public.financial_breezeway_property_ids f)
  group by m.property_id, t.scheduled_date
  union all
  select e.property_id, e.d, e.deep, e.source
  from public.trellis_era_clean_days e, lo
  where e.d >= lo.d
) _gated
where (select public.can_view_financials());

revoke all on public.financial_clean_days from anon;
grant select on public.financial_clean_days to authenticated, service_role;

comment on view public.financial_clean_days is
  'One row per property per clean day (last ~15 months), same sources as property_monthly_cleans: Breezeway before clean_source_cutover (Trellis fallback for properties Breezeway never saw), trellis_era_clean_days from it. Finance only. 2026-10-21.';

-- ── 3. financial_invoice_lines ─────────────────────────────────────────────
create or replace view public.financial_invoice_lines as
select id, run_id, invoice_number, period_start, period_end, property_id,
  line_kind, service_type, description, work_date, cleaner_pay_amount, client_charge_amount
from (
  select l.id,
    l.run_id,
    r.invoice_number,
    r.period_start,
    r.period_end,
    l.property_id,
    l.line_kind,
    l.service_type,
    l.raw_property_text as description,
    coalesce(l.service_date, l.raw_date_mentioned, r.period_end, r.invoice_date) as work_date,
    coalesce(l.cleaner_pay_amount, 0)::numeric as cleaner_pay_amount,
    coalesce(l.client_charge_amount, 0)::numeric as client_charge_amount
  from public.invoice_lines l
  join public.invoice_runs r on r.id = l.run_id
  where r.archived_at is null
    and r.status = any (array['approved', 'exported'])
    and l.line_kind is distinct from 'excluded'
    and l.review_status is distinct from 'excluded'
) _gated
where (select public.can_view_financials());

revoke all on public.financial_invoice_lines from anon;
grant select on public.financial_invoice_lines to authenticated, service_role;

comment on view public.financial_invoice_lines is
  'Busy Bee invoice lines (not excluded) from approved/exported, non-archived runs, with work_date = service_date → raw_date_mentioned → run period_end. Finance only. 2026-10-21.';
