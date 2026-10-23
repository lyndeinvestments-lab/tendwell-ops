-- Link an Ops client to its bill.com customer (the `0cu…` id from the bill.com
-- v3 API), so Ops can create that client's invoices in bill.com directly.
--
-- Written only by api/billcom/customers.ts (service role), which checks the id
-- exists in bill.com first; api/data's write denylist keeps API keys from
-- setting it. One bill.com customer belongs to at most one Ops client.
-- contacts RLS (finance-only) already covers reads.

alter table public.contacts
  add column if not exists billcom_customer_id text;

alter table public.contacts
  drop constraint if exists contacts_billcom_customer_id_format;
alter table public.contacts
  add constraint contacts_billcom_customer_id_format
  check (billcom_customer_id is null or billcom_customer_id ~ '^0cu[A-Za-z0-9]+$');

create unique index if not exists contacts_billcom_customer_id_key
  on public.contacts (billcom_customer_id)
  where billcom_customer_id is not null;
