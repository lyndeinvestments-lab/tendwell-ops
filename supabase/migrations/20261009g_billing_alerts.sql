-- Billing alerts: record when a client invoice was paid.
--
-- REVIEW AND APPLY: Jordan. Not applied by the PR that adds it.
--
-- The in-app "Invoices unpaid > 30 days" alert (Alerts page + dashboard,
-- api/invoices/billing-alerts.ts) needs to know whether an exported invoice
-- has been paid, and nothing in the schema records that today: invoice_runs
-- has no payment fields, there is no QBO invoice / payment sync table, and
-- bill.com payments never come back into Ops. This adds the one field the
-- alert needs. It is set by hand from Invoice Reconciliation ("Mark client
-- paid" on an exported run) and cleared the same way.
--
-- Strictly additive and idempotent: one nullable column, no data rewritten,
-- no constraint on existing rows. No new table and no policy change:
-- invoice_runs is already readable only with the `invoicing` grant (a
-- finance view, see staff_has_financial_view in 20261008g) and writable only
-- with the `invoicing` edit grant (20260817c), so paid_at inherits exactly
-- that access.
--
-- Until this is applied the code falls back: the alert treats every exported
-- run as unpaid (it can still be dismissed per run) and the Mark paid button
-- stays hidden.

alter table public.invoice_runs
  add column if not exists paid_at timestamptz;

comment on column public.invoice_runs.paid_at is
  'When the client paid this run''s invoice(s), recorded by hand in Invoice Reconciliation. NULL = no payment recorded. Drives the in-app "Invoices unpaid > 30 days" billing alert.';
