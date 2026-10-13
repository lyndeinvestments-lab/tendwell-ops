-- QuickBooks as a billing channel for a client's OWN invoices ('qbo_client').
--
-- Why (2026-10-13, Jordan): "Kristy Horn 220 wants her invoices via
-- QuickBooks, so that needs to be fixed in the invoicing process." Her client
-- record already said Payment Method = QuickBooks, but the only QuickBooks
-- channel was 'qbo_haven' (Haven's CSV import, customer "Haven"), so the
-- 20260928 default sent her lines to bill.com. Nobody sent those, and her
-- September work was billed by hand in QuickBooks instead (#1361, 2026-10-09).
--
-- 'qbo_client' = invoiced to the client itself from QuickBooks, created by
-- hand. It reuses bill.com send control (client_invoices): approve, create the
-- invoice in QuickBooks, mark it sent with QuickBooks' own invoice number, so
-- it never takes a number from the Haven import counter.

-- ── Allowed values ───────────────────────────────────────────────────────────
alter table public.contacts drop constraint if exists contacts_billing_channel_check;
alter table public.contacts add constraint contacts_billing_channel_check
  check (billing_channel in ('qbo_haven', 'qbo_client', 'bill_com', 'none'));

alter table public.invoice_lines drop constraint if exists invoice_lines_billing_channel_check;
alter table public.invoice_lines add constraint invoice_lines_billing_channel_check
  check (billing_channel in ('qbo_haven', 'qbo_client', 'bill_com', 'none'));

alter table public.organizations drop constraint if exists organizations_billing_channel_check;
alter table public.organizations add constraint organizations_billing_channel_check
  check (billing_channel in ('qbo_haven', 'qbo_client', 'bill_com', 'none'));

alter table public.client_invoices drop constraint if exists client_invoices_billing_channel_check;
alter table public.client_invoices add constraint client_invoices_billing_channel_check
  check (billing_channel in ('bill_com', 'qbo_client', 'qbo_haven'));

alter table public.sent_invoices drop constraint if exists sent_invoices_billing_channel_check;
alter table public.sent_invoices add constraint sent_invoices_billing_channel_check
  check (billing_channel in ('bill_com', 'qbo_client', 'qbo_haven'));

-- ── Payment Method → channel ─────────────────────────────────────────────────
-- Setting a non-Haven client's Payment Method to QuickBooks now routes them to
-- qbo_client. A QuickBooks channel already chosen on purpose (the invoice
-- review dialog writes both columns) is left alone.
create or replace function public.contacts_sync_billing_channel()
returns trigger language plpgsql as $$
declare
  is_haven boolean := new.full_name ilike 'haven vacation rentals%'
                   or new.company ilike 'haven vacation rentals%';
begin
  if tg_op = 'INSERT' or new.payment_method is distinct from old.payment_method then
    if new.payment_method = 'Bill.com' then
      new.billing_channel := 'bill_com';
    elsif is_haven and (new.payment_method = 'QuickBooks' or new.billing_channel is null or new.billing_channel = 'none') then
      new.billing_channel := 'qbo_haven';
    elsif new.payment_method = 'QuickBooks' and coalesce(new.billing_channel, 'none') not in ('qbo_haven', 'qbo_client') then
      new.billing_channel := 'qbo_client';
    elsif new.billing_channel is null or new.billing_channel = 'none' then
      new.billing_channel := 'bill_com';
    end if;
  end if;
  return new;
end
$$;

-- ── Open credits apply to QuickBooks clients too ─────────────────────────────
do $$
declare
  d text := pg_get_functiondef('public.invoice_apply_open_credits'::regproc);
  old_list constant text := $q$c.billing_channel in ('qbo_haven', 'bill_com')$q$;
begin
  if position(old_list in d) = 0 then
    raise exception 'invoice_apply_open_credits changed; update this migration';
  end if;
  execute replace(d, old_list, $q$c.billing_channel in ('qbo_haven', 'bill_com', 'qbo_client')$q$);
end
$$;

-- ── Kristy Horn (Kristy Horn 220) ────────────────────────────────────────────
update public.contacts
   set billing_channel = 'qbo_client'
 where id = 'f69c4f27-356f-45ed-b6b5-1c6d92c086a2'
   and payment_method = 'QuickBooks';

-- Her lines still routed to bill.com (none was ever sent there) move to
-- QuickBooks, on every run, so the bill.com list never shows them again.
update public.invoice_lines l
   set billing_channel = 'qbo_client'
  from public.properties p
 where p.id = l.property_id
   and p.contact_id = 'f69c4f27-356f-45ed-b6b5-1c6d92c086a2'
   and l.billing_channel = 'bill_com'
   and not exists (
     select 1 from public.client_invoices ci
      where ci.run_id = l.run_id and ci.contact_id = p.contact_id
        and ci.billing_channel = 'bill_com' and ci.status = 'sent');

-- September (runs I260915813 and 1261003821) was already billed by hand in
-- QuickBooks as #1361 on 2026-10-09 ($780). Held with that reason so nobody
-- bills it twice. October (I261009823, the 10/10 clean) is left to approve.
insert into public.client_invoices (run_id, contact_id, billing_channel, service_month, status, hold_reason, total, updated_by)
select r.id, 'f69c4f27-356f-45ed-b6b5-1c6d92c086a2', 'qbo_client', '2026-09', 'held',
       'Already billed in QuickBooks: invoice #1361 (Oct 9, $780.00, covers Sep 17 to Sep 30). Do not bill again.',
       t.total, 'System (20261013a)'
  from public.invoice_runs r
  cross join lateral (
    select round(sum(l.client_charge_amount), 2) as total
      from public.invoice_lines l
      join public.properties p on p.id = l.property_id
     where l.run_id = r.id and p.contact_id = 'f69c4f27-356f-45ed-b6b5-1c6d92c086a2'
       and l.billing_channel = 'qbo_client' and l.review_status <> 'excluded'
       and l.line_kind not in ('excluded', 'operating_expense')
  ) t
 where r.id in ('0bb84f92-6a45-44ea-a0c0-b0d22deb8e65', '01dd8a32-a286-4cdb-bcb4-26aa8f4d2eaa')
on conflict (run_id, contact_id, billing_channel, service_month) do nothing;
