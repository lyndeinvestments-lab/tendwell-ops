-- Soft-archive for invoice runs: hides a run from the default Invoicing list
-- without voiding it (history/audit stays intact; a "Show archived" toggle
-- reveals + unarchives). Set/cleared from the runs list by invoicing editors.
alter table public.invoice_runs add column if not exists archived_at timestamptz;
