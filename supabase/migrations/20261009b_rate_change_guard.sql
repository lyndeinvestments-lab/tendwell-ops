-- Rate change guard: an audit trail for the three prices that drive invoicing.
--
-- NOT YET APPLIED. Must be reviewed and applied by Jordan. The app code that
-- ships with it works with or without this migration: the invoicing engine's
-- "charge changed since last invoice" check compares against previously
-- approved invoice lines, not against this table.
--
-- Why: properties.ce_charged (what the client pays per clean), cleaner_pay
-- (what the vendor is paid) and deep_clean_3x_ce (deep clean income, derived
-- from ce_charged unless custom_deep_clean_income is set) are edited inline
-- on Master List, in the property modal, by CSV import and by quote
-- acceptance, and until now a change left no record of who moved the number
-- or why. A price that moves between invoices should be a decision somebody
-- wrote down.
--
-- What it adds (all additive, idempotent, no existing data touched):
--   1. public.property_rate_history: one row per changed field per update.
--   2. An AFTER UPDATE trigger on public.properties that writes those rows.
--      It is SECURITY DEFINER, so history can only be written by the trigger:
--      authenticated users get SELECT only, and only when they can see client
--      money (can_view_financials(), the finance-only gate from
--      20261008g_crew_financial_lockdown.sql).
--   3. public.set_rate_with_reason(): the way a caller attaches a reason. It
--      sets a transaction-local setting (app.rate_change_reason) and updates
--      the property in the same transaction, so the trigger records the
--      reason. A plain UPDATE still works and records a NULL reason.
--
-- History rows cascade with the property: the permanent-delete functions
-- (20261008c_permanent_delete.sql) already write a full row snapshot to
-- activity_log, and a NO ACTION foreign key here would block them.
--
-- Follow-up (not in this change): the Master List inline edit still calls a
-- plain UPDATE, so its reason is NULL until that screen prompts for one and
-- calls set_rate_with_reason().

-- 1. History table ----------------------------------------------------------
create table if not exists public.property_rate_history (
  id          uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties(id) on delete cascade,
  field       text not null check (field in ('ce_charged', 'cleaner_pay', 'deep_clean_3x_ce')),
  old_value   numeric,
  new_value   numeric,
  reason      text,
  changed_by  text,
  changed_at  timestamptz not null default now()
);

create index if not exists property_rate_history_property_idx
  on public.property_rate_history (property_id, changed_at desc);

-- RLS first, so the table is never exposed.
alter table public.property_rate_history enable row level security;

drop policy if exists property_rate_history_finance_select on public.property_rate_history;
create policy property_rate_history_finance_select on public.property_rate_history
  for select to authenticated
  using ((select public.can_view_financials()));

-- Read-only for clients: no insert/update/delete policy exists, and the
-- privileges are revoked as well. Only the SECURITY DEFINER trigger writes.
revoke all on table public.property_rate_history from anon;
revoke insert, update, delete, truncate on table public.property_rate_history from authenticated;
grant select on table public.property_rate_history to authenticated;

-- 2. Trigger ----------------------------------------------------------------
create or replace function public.log_property_rate_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(coalesce(current_setting('app.rate_change_reason', true), '')), '');
  v_by     text := coalesce(nullif(public.current_auth_email(), ''), current_user);
begin
  if new.ce_charged is distinct from old.ce_charged then
    insert into public.property_rate_history (property_id, field, old_value, new_value, reason, changed_by)
    values (new.id, 'ce_charged', old.ce_charged, new.ce_charged, v_reason, v_by);
  end if;
  if new.cleaner_pay is distinct from old.cleaner_pay then
    insert into public.property_rate_history (property_id, field, old_value, new_value, reason, changed_by)
    values (new.id, 'cleaner_pay', old.cleaner_pay, new.cleaner_pay, v_reason, v_by);
  end if;
  if new.deep_clean_3x_ce is distinct from old.deep_clean_3x_ce then
    insert into public.property_rate_history (property_id, field, old_value, new_value, reason, changed_by)
    values (new.id, 'deep_clean_3x_ce', old.deep_clean_3x_ce, new.deep_clean_3x_ce, v_reason, v_by);
  end if;
  return null;
end $$;

revoke all on function public.log_property_rate_change() from public, anon, authenticated;

-- AFTER (not "UPDATE OF"): recalc_property_formulas() rewrites deep_clean_3x_ce
-- in a BEFORE trigger, so it can change without being in the SET list.
drop trigger if exists trg_properties_log_rate_change on public.properties;
create trigger trg_properties_log_rate_change
  after update on public.properties
  for each row
  when (
    old.ce_charged is distinct from new.ce_charged
    or old.cleaner_pay is distinct from new.cleaner_pay
    or old.deep_clean_3x_ce is distinct from new.deep_clean_3x_ce
  )
  execute function public.log_property_rate_change();

-- 3. Update a rate with a reason --------------------------------------------
-- SECURITY INVOKER on purpose: the caller's own RLS on properties decides
-- whether the update is allowed. deep_clean_3x_ce is derived (3x ce_charged,
-- or custom_deep_clean_income), so it is not settable here.
create or replace function public.set_rate_with_reason(
  p_property_id bigint,
  p_field       text,
  p_value       numeric,
  p_reason      text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  if p_field not in ('ce_charged', 'cleaner_pay') then
    raise exception 'Unsupported rate field: %', p_field;
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A reason is required to change a rate';
  end if;

  -- Transaction-local (third argument true): gone when this call returns.
  perform set_config('app.rate_change_reason', btrim(p_reason), true);
  execute format('update public.properties set %I = $1 where id = $2', p_field)
    using p_value, p_property_id;
  get diagnostics v_rows = row_count;
  perform set_config('app.rate_change_reason', '', true);

  if v_rows = 0 then
    raise exception 'Property % not found, or you cannot edit it', p_property_id;
  end if;
end $$;

revoke all on function public.set_rate_with_reason(bigint, text, numeric, text) from public, anon;
grant execute on function public.set_rate_with_reason(bigint, text, numeric, text) to authenticated, service_role;
