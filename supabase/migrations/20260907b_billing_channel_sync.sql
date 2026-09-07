-- Billing channel follows the client's Payment Method.
--
-- Why (2026-09-07, Jordan): Busy Bee invoice I260906806 could not be approved
-- because Morgan Hogg's lines had "No billing channel". Her contact said
-- Payment Method = Bill.com on the Clients page, but the invoicing engine
-- routes AR by contacts.billing_channel, a separate column that no screen
-- edited (only the 20260814 backfill ever set it). Three more clients were in
-- the same state (Julie Anthony, Marsha Paladino, Shanna Scruggs).
--
-- Fix: a BEFORE trigger derives billing_channel whenever payment_method is
-- set or changed, so the Clients page (and the new channel picker in the
-- invoice review dialog, which writes both columns) keeps the two in step.
-- Mapping is deliberately narrow: Bill.com -> bill_com; QuickBooks -> qbo_haven
-- only for Haven Vacation Rentals itself (the QBO channel is Haven's import,
-- not "the client uses QuickBooks"); anything else leaves the channel alone.

create or replace function public.contacts_sync_billing_channel()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.payment_method is distinct from old.payment_method then
    if new.payment_method = 'Bill.com' then
      new.billing_channel := 'bill_com';
    elsif new.payment_method = 'QuickBooks'
      and (new.full_name ilike 'haven vacation rentals%' or new.company ilike 'haven vacation rentals%') then
      new.billing_channel := 'qbo_haven';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_contacts_sync_billing_channel on public.contacts;
create trigger trg_contacts_sync_billing_channel
  before insert or update of payment_method on public.contacts
  for each row execute function public.contacts_sync_billing_channel();

-- ── Backfill: clients already marked Bill.com but never routed ──────────────
update public.contacts
   set billing_channel = 'bill_com'
 where payment_method = 'Bill.com'
   and billing_channel = 'none';

-- ── Heal open runs: billable lines still unrouted whose client now has a
--    channel. Reconcile preserves human-resolved rows, so a fix on the client
--    never reached these lines before. Never downgrades a routed line.
update public.invoice_lines l
   set billing_channel = c.billing_channel,
       flags = array_remove(coalesce(l.flags, '{}'), 'no_billing_channel')
  from public.invoice_runs r, public.properties p, public.contacts c
 where r.id = l.run_id
   and p.id = l.property_id
   and c.id = p.contact_id
   and r.status not in ('approved', 'exported', 'void')
   and l.line_kind not in ('operating_expense', 'excluded')
   and l.review_status <> 'excluded'
   and (l.billing_channel is null or l.billing_channel = 'none')
   and c.billing_channel <> 'none';
