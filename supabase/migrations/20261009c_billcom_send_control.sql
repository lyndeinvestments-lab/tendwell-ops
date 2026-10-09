-- bill.com send control (2026-10-09). REVIEW AND APPLY: Jordan.
--
-- Until now an approved run's bill.com worksheet listed every bill.com line,
-- and nothing recorded which client invoices had actually been entered in
-- bill.com, which were waiting on a question, or what number bill.com gave
-- them. This migration adds the bookkeeping for that, nothing else:
--
--   1. public.client_invoices: one row per bill.com invoice, i.e. one
--      CLIENT's bill.com lines on one run for one SERVICE MONTH. The
--      worksheet already splits a client's lines by month (one bill.com
--      invoice per client per month), so the month is part of the key:
--      without it a two-month run would have two bill.com invoices sharing
--      one status and one bill.com number. Status held / approved / sent;
--      "sent" requires the bill.com invoice number and is final (a trigger
--      refuses to move a sent invoice back or change its number). A client
--      invoice with NO row is treated as held by the app, so nothing goes out
--      until someone approves it.
--   2. invoice_lines.bill_hold_reason: a non-blank reason holds that one line
--      back from the bill.com worksheet while the rest of the client's
--      invoice goes out.
--
-- Why a table and not a status column on invoice_lines: the status, the
-- bill.com number, who sent it and when belong to the client invoice, not to
-- each of its lines. A per-line status would let two lines of one invoice
-- disagree, and the number would be copied onto every line.
--
-- Access: client_invoices holds client money (per-client totals), so SELECT
-- is finance-only (can_view_financials(), 20261008g) AND needs the
-- invoicing view, like the other invoice tables. There is NO write policy:
-- writes go only through api/invoices/billcom.ts (service role), which
-- enforces the held / approved / sent rules. anon gets nothing.
--
-- Strictly additive and idempotent. No existing data is changed. The app
-- runs without it: until this is applied the bill.com export lists every
-- bill.com line exactly as before and the send-control panel stays hidden.
--
-- Note: invoice_apply_reconcile (20261008f) does not carry bill_hold_reason
-- through a rebuild. That is fine because holds can only be set on approved
-- or exported runs, and reconcile refuses those.

-- ─── invoice_lines.bill_hold_reason ──────────────────────────────────────────
alter table public.invoice_lines add column if not exists bill_hold_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoice_lines_bill_hold_reason_not_blank'
      and conrelid = 'public.invoice_lines'::regclass
  ) then
    -- NOT VALID: new writes are checked; the column is new, so every existing
    -- row is NULL anyway.
    alter table public.invoice_lines
      add constraint invoice_lines_bill_hold_reason_not_blank
      check (bill_hold_reason is null or btrim(bill_hold_reason) <> '') not valid;
  end if;
end $$;

-- ─── client_invoices ─────────────────────────────────────────────────────────
create table if not exists public.client_invoices (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.invoice_runs(id) on delete cascade,
  -- RESTRICT: a client with a recorded bill.com invoice cannot be
  -- permanently deleted out from under it.
  contact_id uuid not null references public.contacts(id) on delete restrict,
  billing_channel text not null default 'bill_com'
    check (billing_channel in ('bill_com', 'qbo_haven')),
  service_month text not null check (service_month ~ '^\d{4}-\d{2}$'),
  status text not null default 'held' check (status in ('held', 'approved', 'sent')),
  hold_reason text check (hold_reason is null or btrim(hold_reason) <> ''),
  billcom_invoice_number text,
  sent_at timestamptz,
  sent_by text,
  total numeric(12,2),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_invoices_sent_needs_number
    check (status <> 'sent' or (billcom_invoice_number is not null and btrim(billcom_invoice_number) <> '')),
  constraint client_invoices_unique unique (run_id, contact_id, billing_channel, service_month)
);

create index if not exists client_invoices_run_idx on public.client_invoices (run_id);
create index if not exists client_invoices_contact_idx on public.client_invoices (contact_id);

-- updated_at, sent_at, and "sent is final".
create or replace function public.client_invoices_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'sent' then
    if new.status <> 'sent' or new.billcom_invoice_number is distinct from old.billcom_invoice_number then
      raise exception 'Client invoice % was already sent to bill.com as %; it cannot be changed',
        old.id, old.billcom_invoice_number using errcode = '55000';
    end if;
  end if;
  if new.status = 'sent' and new.sent_at is null then
    new.sent_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.client_invoices_guard() from public, anon, authenticated;

drop trigger if exists client_invoices_guard on public.client_invoices;
create trigger client_invoices_guard
  before insert or update on public.client_invoices
  for each row execute function public.client_invoices_guard();

alter table public.client_invoices enable row level security;

drop policy if exists client_invoices_finance_select on public.client_invoices;
create policy client_invoices_finance_select on public.client_invoices
  for select to authenticated
  using ((select public.can_view_financials()) and public.current_user_can_view('invoicing'));

revoke all on table public.client_invoices from anon, public;
grant select on table public.client_invoices to authenticated;
grant all on table public.client_invoices to service_role;
