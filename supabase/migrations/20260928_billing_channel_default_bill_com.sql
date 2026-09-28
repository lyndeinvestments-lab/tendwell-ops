-- Every client defaults to bill.com unless it is Haven Vacation Rentals or the
-- channel was set on purpose.
--
-- Why (2026-09-28, Jordan): "make all billing channels default by client and
-- all of them default to bill.com unless it's Haven Vacation Rentals or I've
-- changed it in their client info." Clients with no Payment Method sat at
-- billing_channel='none', so every one of their invoice lines blocked Approve
-- ("No billing channel") until someone picked a channel by hand (Smokies Edge
-- 3129 on Busy Bee I260926817 was the trigger; 25 contacts were in that state).
--
-- Rule, applied on insert and whenever Payment Method changes:
--   Payment Method = Bill.com            -> bill_com
--   Haven Vacation Rentals (name/company) -> qbo_haven
--   anything else still unrouted          -> bill_com
-- A channel chosen explicitly (e.g. the invoice review dialog's picker, or a
-- non-Haven QuickBooks client already routed) is left alone, as before.

alter table public.contacts alter column billing_channel set default 'bill_com';

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
    elsif new.billing_channel is null or new.billing_channel = 'none' then
      new.billing_channel := 'bill_com';
    end if;
  end if;
  return new;
end
$$;

-- Backfill: clients still unrouted get the same default.
update public.contacts
   set billing_channel = case
         when full_name ilike 'haven vacation rentals%' or company ilike 'haven vacation rentals%' then 'qbo_haven'
         else 'bill_com'
       end
 where billing_channel is null or billing_channel = 'none';
