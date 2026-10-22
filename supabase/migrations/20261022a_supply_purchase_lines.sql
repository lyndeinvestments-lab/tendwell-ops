-- supply_purchase_lines: every supply bill paid through Ramp, itemized.
--
-- Synced nightly by api/cron/ramp-bills-sync.ts. Ramp is where QuickBooks'
-- Cleaning Supplies bills come from (monthly totals match to the cent), but
-- QuickBooks only keeps the bill total. Each bill is itemized from Ramp's own
-- line items, else the invoice PDF, else the vendor statement's invoice rows,
-- else one line from the memo (api/ramp/_supplies.ts); a bill's lines always
-- sum to the bill amount, tax and shipping spread over its items.
--
-- `category` separates per-clean consumables from linens (onboarding stock,
-- billed to owners through linen_charges), so Per-Property can take linens
-- out of the consumables pool by `bill_month` (Ramp accounting date = the
-- QuickBooks month).
--
-- Access: finance-only SELECT (can_view_financials()); the cron writes with
-- the service role, replacing a bill's rows wholesale.

create table if not exists public.supply_purchase_lines (
  ramp_bill_id text not null,
  line_no integer not null,
  bill_date date not null,
  bill_month date not null check (extract(day from bill_month) = 1),
  bill_amount numeric(14,2) not null,
  vendor text not null,
  gl_account text,
  invoice_number text,
  source text not null check (source in ('ramp_line', 'invoice_pdf', 'statement', 'bill_memo')),
  sku text,
  description text not null default '',
  quantity numeric,
  uom text,
  amount numeric(14,2) not null,
  category text not null check (category in ('paper', 'trash_bags', 'amenities', 'cleaning', 'hot_tub_chem', 'linens', 'mixed', 'other')),
  synced_at timestamptz not null default now(),
  primary key (ramp_bill_id, line_no)
);

create index if not exists supply_purchase_lines_month_idx on public.supply_purchase_lines (bill_month, category);

alter table public.supply_purchase_lines enable row level security;

drop policy if exists supply_purchase_lines_finance_select on public.supply_purchase_lines;
create policy supply_purchase_lines_finance_select on public.supply_purchase_lines
  for select to authenticated
  using ((select public.can_view_financials()));

revoke all on table public.supply_purchase_lines from anon, public;
grant select on table public.supply_purchase_lines to authenticated;
grant all on table public.supply_purchase_lines to service_role;
