-- Raise (never lower) the Haven QBO invoice counter to at least p_min.
--
-- Why (2026-10-13): our counter fell behind QuickBooks (it would have handed
-- out 1098, which QuickBooks already had). api/invoices/_qbo-numbers.ts reads
-- Haven's highest invoice number from QuickBooks before each QBO export and
-- nightly (qbo-classes-sync cron), and calls this to move the counter past it.
-- One statement, so it can't race next_qbo_invoice_no(). Service role only.

create or replace function public.raise_qbo_invoice_counter(p_min int)
returns int
language sql
set search_path = public
as $$
  update public.app_settings
     set value = greatest(value::int, p_min)::text
   where key = 'invoicing_qbo_next_number'
  returning value::int;
$$;

revoke all on function public.raise_qbo_invoice_counter(int) from public, anon, authenticated;
