-- What Ops calculated for an invoice line before anyone edited it, so the run
-- page can show "changed by hand" lines with the original next to the new
-- value (Jordan, 2026-10-20). Written once, on insert, by trigger: every path
-- that creates a line (reconcile's rebuild, Add line, task lines, credits and
-- linen fees on approve, the vendor portal) gets it without code changes, and
-- later UPDATEs never touch it. Reconcile deletes and re-inserts the rows it
-- rebuilds, so an engine row's snapshot always matches the latest engine
-- result; human-touched rows are preserved by reconcile and keep theirs.
-- Rows created before this migration have no snapshot (NULL = unknown).

alter table public.invoice_lines add column if not exists engine_snapshot jsonb;

create or replace function public.invoice_lines_engine_snapshot()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.engine_snapshot is null then
    new.engine_snapshot := jsonb_build_object(
      'property_id', new.property_id,
      'service_type', new.service_type,
      'line_kind', new.line_kind,
      'cleaner_pay_amount', new.cleaner_pay_amount,
      'client_charge_amount', new.client_charge_amount,
      'billing_channel', new.billing_channel
    );
  end if;
  return new;
end
$$;

revoke all on function public.invoice_lines_engine_snapshot() from public;

drop trigger if exists invoice_lines_engine_snapshot on public.invoice_lines;
create trigger invoice_lines_engine_snapshot
  before insert on public.invoice_lines
  for each row execute function public.invoice_lines_engine_snapshot();
