-- Email admins when a cleaning company submits its invoice from
-- Operations → Invoicing (api/vendor-invoices/runs.ts → notifyStaff
-- 'vendor_invoice_submitted'). Per-user toggle, on by default; the event is
-- admin-only (EVENT_ROLE_REQUIREMENT in api/notify/_lib.ts).
alter table public.notification_preferences
  add column if not exists notify_vendor_invoice_submitted boolean not null default true;
