-- The bill.com invoice(s) Ops created for a client invoice through the API
-- (api/invoices/billcom-create.ts): [{ id: "00e…", number, total, property }].
-- One element normally; HomeTeam gets one per property. Mark sent emails these
-- from bill.com, and a later paid-status check reads them back.
--
-- Written only by the service role. client_invoices RLS (finance + invoicing)
-- already covers reads.

alter table public.client_invoices
  add column if not exists billcom_invoices jsonb,
  add column if not exists billcom_created_at timestamptz,
  add column if not exists billcom_created_by text;

alter table public.client_invoices
  drop constraint if exists client_invoices_billcom_invoices_array;
alter table public.client_invoices
  add constraint client_invoices_billcom_invoices_array
  check (billcom_invoices is null or jsonb_typeof(billcom_invoices) = 'array');
