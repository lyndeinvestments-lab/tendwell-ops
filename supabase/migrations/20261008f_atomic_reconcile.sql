-- Reconcile applies its result in ONE transaction (2026-10-08).
--
-- reconcileRun (api/invoices/_lib.ts) used to delete the rows it rebuilds,
-- then insert the new ones, then sync task lines (delete + insert), then
-- update the run — five separate requests. A function killed or failing
-- between them (Vercel timeout, a claim-index refusal on the insert, a
-- network blip) left the run with its rebuilt rows DELETED and nothing put
-- back: a vendor-added extra or missing clean, or an uploaded CSV line,
-- simply gone. Now the engine computes everything in memory and this
-- function applies it atomically: all of it lands, or none of it does.
--
-- Optimistic concurrency: the caller passes the exact row ids it read and
-- rebuilt. If any of them is no longer on the run (someone else changed the
-- run meanwhile), the whole call aborts and the caller re-reads. Service role
-- only — the API is the only caller.

create or replace function public.invoice_apply_reconcile(
  p_run_id uuid,
  p_delete_ids uuid[],
  p_rows jsonb,
  p_run jsonb
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_status text;
  v_deleted int;
  v_inserted int;
begin
  select status into v_status from public.invoice_runs where id = p_run_id for update;
  if not found then
    raise exception 'Run % not found', p_run_id using errcode = 'P0002';
  end if;
  if v_status in ('approved', 'exported') then
    raise exception 'Run is %; void it before re-reconciling', v_status using errcode = '55000';
  end if;

  delete from public.invoice_lines
  where run_id = p_run_id and id = any(coalesce(p_delete_ids, '{}'::uuid[]));
  get diagnostics v_deleted = row_count;
  if v_deleted <> coalesce(cardinality(p_delete_ids), 0) then
    raise exception 'Invoice lines changed while reconciling (% of % still there); re-run reconcile',
      v_deleted, cardinality(p_delete_ids) using errcode = 'P0001';
  end if;

  insert into public.invoice_lines (
    run_id, line_no, split_group, source, raw_property_text, raw_note_text, raw_amount,
    raw_date_mentioned, property_id, alias_confidence, matched_task_id, service_type, line_kind,
    cleaner_pay_amount, client_charge_amount, billing_channel, flags, review_status, review_note,
    resolved_by, resolved_at, engine_note, service_date, vendor_category, vendor_detail, receipt_path
  )
  select
    p_run_id, r.line_no, r.split_group, coalesce(r.source, 'vendor'), r.raw_property_text, r.raw_note_text,
    coalesce(r.raw_amount, 0), r.raw_date_mentioned, r.property_id, r.alias_confidence, r.matched_task_id,
    r.service_type, coalesce(r.line_kind, 'clean'), r.cleaner_pay_amount, r.client_charge_amount,
    r.billing_channel, coalesce(r.flags, '{}'::text[]), coalesce(r.review_status, 'ok'), r.review_note,
    r.resolved_by, r.resolved_at, r.engine_note, r.service_date, r.vendor_category, r.vendor_detail, r.receipt_path
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    line_no int, split_group int, source text, raw_property_text text, raw_note_text text, raw_amount numeric,
    raw_date_mentioned date, property_id bigint, alias_confidence numeric, matched_task_id text,
    service_type text, line_kind text, cleaner_pay_amount numeric, client_charge_amount numeric,
    billing_channel text, flags text[], review_status text, review_note text, resolved_by text,
    resolved_at timestamptz, engine_note text, service_date date, vendor_category text, vendor_detail jsonb,
    receipt_path text
  );
  get diagnostics v_inserted = row_count;

  update public.invoice_runs
  set computed_subtotal = coalesce((p_run ->> 'computed_subtotal')::numeric, computed_subtotal),
      status = coalesce(p_run ->> 'status', status)
  where id = p_run_id;

  return jsonb_build_object('deleted', v_deleted, 'inserted', v_inserted);
end;
$$;

revoke all on function public.invoice_apply_reconcile(uuid, uuid[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.invoice_apply_reconcile(uuid, uuid[], jsonb, jsonb) to service_role;
