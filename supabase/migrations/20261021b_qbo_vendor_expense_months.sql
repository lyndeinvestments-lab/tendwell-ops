-- qbo_vendor_expense_months: QuickBooks spend per vendor per account per month.
--
-- Synced nightly by api/cron/qbo-pl-sync.ts from the QBO ProfitAndLossDetail
-- report (one call per month), aggregating transaction rows by
-- (month, top-level P&L section, innermost account, vendor/name). Answers
-- "how much did we spend with Blessed on Laundry in August" without a live
-- QBO call. Blank vendors are stored as '(no vendor)'.
--
-- Access: company money, so SELECT is finance-only (can_view_financials(),
-- the 20261008g rule). There is NO write policy: the sync cron writes with
-- the service role (replacing each month wholesale). anon gets nothing.

create table if not exists public.qbo_vendor_expense_months (
  month date not null,
  section text not null check (section in ('Income', 'COGS', 'Expenses', 'OtherIncome', 'OtherExpenses')),
  account text not null,
  vendor text not null, -- '(no vendor)' when the transaction has no name
  amount numeric(14,2) not null,
  txn_count integer not null default 0,
  synced_at timestamptz not null default now(),
  primary key (month, section, account, vendor)
);

alter table public.qbo_vendor_expense_months enable row level security;

drop policy if exists qbo_vendor_expense_months_finance_select on public.qbo_vendor_expense_months;
create policy qbo_vendor_expense_months_finance_select on public.qbo_vendor_expense_months
  for select to authenticated
  using ((select public.can_view_financials()));

revoke all on table public.qbo_vendor_expense_months from anon, public;
grant select on table public.qbo_vendor_expense_months to authenticated;
grant all on table public.qbo_vendor_expense_months to service_role;
