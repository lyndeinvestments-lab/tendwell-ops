-- Linen onboarding charges (2026-10-19).
--
-- Stocking a property for the linen program is a one-time charge to the
-- client. Until now nothing recorded it: the quote sheet shows a suggested
-- fee that recalculates whenever Dzee rates or bed counts change, so the
-- figure billed could drift from the figure the owner agreed to, and billing
-- it was remembered by hand (Hostimo's first third went on invoice 1360 by
-- hand; no linen fee had ever been billed through Ops).
--
-- What it does (additive, idempotent; modelled on 20261009a_invoice_adjustments):
--   1. public.linen_charges: one row per agreed charge, the amount locked when
--      it is recorded. Either one property's fee (property_id set) or a
--      client-wide deal (property_id null, e.g. Hostimo's portfolio quote).
--      Waived = a recorded decision not to charge, with a reason.
--   2. public.linen_charge_installments: the payments a charge is billed in
--      (1 by default, 3 for a thirds deal). Each payment is pending until a
--      run bills it; `bill_from` holds a payment back until a date;
--      'billed_external' records a payment invoiced outside Ops.
--   3. public.linen_charge_save / linen_charge_void (SECURITY INVOKER, so the
--      caller's own RLS applies): record or change a charge and (re)split its
--      unbilled payments in one statement.
--   4. public.invoice_apply_linen_charges(run_id, actor): called by
--      api/invoices/approve.ts when a run is approved, before credits. For
--      each scheduled charge whose property (or, for a client-wide charge,
--      whose client) is billed on the run, it adds the next pending payment
--      as a client-only line (source 'manual', line_kind 'extra',
--      service_type 'Linen Onboarding', flag 'linen_charge', no cleaner pay)
--      on the client's billing channel. A payment with no `bill_from` is
--      billed at most once per service month per charge; a dated one bills on
--      the first approved run on or after its date. Mirrored by
--      planLinenInstallments() in shared/linen-charges.ts. KEEP IN SYNC.
--   5. Release triggers: voiding a run, archiving it before export, deleting
--      it, or deleting the line puts the payment back to pending.
--   6. public.linen_charge_decisions(property_ids): staff-readable yes/no per
--      property (no amounts) for the onboarding checklist and the alert,
--      which non-finance staff also see.
--   7. Audit to activity_log.

-- ─── 1. Tables ───────────────────────────────────────────────────────────────

create table if not exists public.linen_charges (
  id               uuid primary key default gen_random_uuid(),
  -- Required on insert (trigger). SET NULL so a client can be permanently
  -- deleted without losing the charge's history.
  contact_id       uuid null references public.contacts(id) on delete set null,
  -- Null = a client-wide charge (covers every property of the client that has
  -- no charge of its own).
  property_id      bigint null references public.properties(id) on delete set null,
  label            text,
  sets             int null check (sets is null or sets between 1 and 10),
  suggested_amount numeric(12,2) null check (suggested_amount is null or suggested_amount >= 0),
  amount           numeric(12,2) not null default 0 check (amount >= 0),
  payments         int not null default 1 check (payments between 0 and 12),
  status           text not null default 'scheduled' check (status in ('scheduled', 'billed', 'waived', 'void')),
  waive_reason     text,
  note             text,
  source_link      text,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  voided_by        text,
  voided_at        timestamptz,
  void_reason      text,
  constraint linen_charges_waived_has_reason check (status <> 'waived' or nullif(btrim(waive_reason), '') is not null),
  constraint linen_charges_void_has_reason check (status <> 'void' or nullif(btrim(void_reason), '') is not null),
  constraint linen_charges_billed_has_amount check (status not in ('scheduled', 'billed') or (amount > 0 and payments >= 1)),
  constraint linen_charges_source_is_link check (source_link is null or source_link ~* '^https?://')
);

-- One live decision per property.
create unique index if not exists linen_charges_one_live_per_property
  on public.linen_charges (property_id) where property_id is not null and status <> 'void';
create index if not exists linen_charges_contact_idx on public.linen_charges (contact_id) where status <> 'void';

create table if not exists public.linen_charge_installments (
  id            uuid primary key default gen_random_uuid(),
  charge_id     uuid not null references public.linen_charges(id) on delete cascade,
  seq           int not null check (seq >= 1),
  amount        numeric(12,2) not null check (amount > 0),
  bill_from     date,
  status        text not null default 'pending' check (status in ('pending', 'billed', 'billed_external')),
  run_id        uuid null references public.invoice_runs(id) on delete set null,
  line_id       uuid null,
  service_month text null check (service_month is null or service_month ~ '^\d{4}-\d{2}$'),
  billed_at     timestamptz,
  external_ref  text,
  created_at    timestamptz not null default now(),
  unique (charge_id, seq),
  constraint linen_installments_billed_has_run check (status <> 'billed' or run_id is not null),
  constraint linen_installments_external_has_ref check (status <> 'billed_external' or nullif(btrim(external_ref), '') is not null)
);

create index if not exists linen_installments_pending_idx on public.linen_charge_installments (charge_id) where status = 'pending';
create index if not exists linen_installments_run_idx on public.linen_charge_installments (run_id) where run_id is not null;
create index if not exists linen_installments_line_idx on public.linen_charge_installments (line_id) where line_id is not null;

create or replace function public.linen_charges_touch()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if tg_op = 'INSERT' and new.contact_id is null then
    raise exception 'A linen charge needs a client' using errcode = '23502';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.status = 'void' and old.status is distinct from 'void' and new.voided_at is null then
      new.voided_at := now();
    end if;
  end if;
  return new;
end $fn$;

revoke execute on function public.linen_charges_touch() from public;

drop trigger if exists linen_charges_touch on public.linen_charges;
create trigger linen_charges_touch
  before insert or update on public.linen_charges
  for each row execute function public.linen_charges_touch();

-- A scheduled charge becomes billed once no payment is pending, and back
-- when a payment is released. Waived/void charges are left alone.
create or replace function public.linen_installments_sync_charge()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_charge uuid := coalesce(new.charge_id, old.charge_id);
  v_pending boolean;
begin
  select exists (select 1 from public.linen_charge_installments where charge_id = v_charge and status = 'pending')
    into v_pending;
  update public.linen_charges
  set status = case when v_pending then 'scheduled' else 'billed' end
  where id = v_charge and status in ('scheduled', 'billed')
    and status is distinct from (case when v_pending then 'scheduled' else 'billed' end);
  return null;
end $fn$;

revoke execute on function public.linen_installments_sync_charge() from public;

drop trigger if exists linen_installments_sync_charge on public.linen_charge_installments;
create trigger linen_installments_sync_charge
  after insert or update of status or delete on public.linen_charge_installments
  for each row execute function public.linen_installments_sync_charge();

-- ─── 2. Audit ────────────────────────────────────────────────────────────────

create or replace function public.linen_charges_audit()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_action text;
  v_client text;
  v_actor  text;
  v_email  text;
begin
  if tg_op = 'INSERT' then
    v_action := case when new.status = 'waived' then 'linen_charge_waived' else 'linen_charge_added' end;
  elsif new.status = 'void' and old.status <> 'void' then
    v_action := 'linen_charge_voided';
  elsif new.status = 'waived' and old.status <> 'waived' then
    v_action := 'linen_charge_waived';
  elsif new.amount is distinct from old.amount or new.payments is distinct from old.payments
        or new.property_id is distinct from old.property_id then
    v_action := 'linen_charge_changed';
  else
    return new;
  end if;

  select coalesce(nullif(btrim(company), ''), full_name) into v_client from public.contacts where id = new.contact_id;
  v_email := public.current_auth_email();
  select label into v_actor from public.app_users where lower(google_email) = lower(v_email);
  v_actor := coalesce(v_actor, v_email, case when v_action = 'linen_charge_voided' then new.voided_by else new.created_by end, 'System');

  insert into public.activity_log (entity_type, entity_id, entity_name, action, field_name,
                                   old_value, new_value, changed_by, metadata)
  values ('contact', new.contact_id::text, v_client, v_action, 'linen_charge',
          case when tg_op = 'UPDATE' then '$' || to_char(old.amount, 'FM9999999990.00') || ' x' || old.payments || ' ' || old.status end,
          '$' || to_char(new.amount, 'FM9999999990.00') || ' x' || new.payments || ' ' || new.status,
          v_actor,
          jsonb_build_object('linen_charge_id', new.id, 'property_id', new.property_id, 'label', new.label,
                             'waive_reason', new.waive_reason, 'void_reason', new.void_reason));
  return new;
end $fn$;

revoke execute on function public.linen_charges_audit() from public;

drop trigger if exists linen_charges_audit on public.linen_charges;
create trigger linen_charges_audit
  after insert or update on public.linen_charges
  for each row execute function public.linen_charges_audit();

-- ─── 3. RLS: finance-only ────────────────────────────────────────────────────
-- Read: the `invoicing` view AND can_view_financials() (client money, the
-- 20261008g rule). Write: the `invoicing` edit grant. A browser can create and
-- change charges, and add/remove PENDING payments; marking a payment billed is
-- done only by invoice_apply_linen_charges (service role). No DELETE on
-- charges: they are voided, never erased.
alter table public.linen_charges enable row level security;
alter table public.linen_charge_installments enable row level security;
revoke all on public.linen_charges from anon;
revoke all on public.linen_charge_installments from anon;

drop policy if exists linen_charges_select_finance on public.linen_charges;
create policy linen_charges_select_finance on public.linen_charges for select to authenticated
  using ((select public.can_view_financials()) and public.current_user_can_view('invoicing'));

drop policy if exists linen_charges_insert_finance on public.linen_charges;
create policy linen_charges_insert_finance on public.linen_charges for insert to authenticated
  with check ((select public.can_view_financials()) and public.current_user_can_edit('invoicing') and status in ('scheduled', 'waived'));

drop policy if exists linen_charges_update_finance on public.linen_charges;
create policy linen_charges_update_finance on public.linen_charges for update to authenticated
  using ((select public.can_view_financials()) and public.current_user_can_edit('invoicing') and status <> 'void')
  with check ((select public.can_view_financials()) and public.current_user_can_edit('invoicing'));

drop policy if exists linen_installments_select_finance on public.linen_charge_installments;
create policy linen_installments_select_finance on public.linen_charge_installments for select to authenticated
  using ((select public.can_view_financials()) and public.current_user_can_view('invoicing'));

drop policy if exists linen_installments_insert_finance on public.linen_charge_installments;
create policy linen_installments_insert_finance on public.linen_charge_installments for insert to authenticated
  with check ((select public.can_view_financials()) and public.current_user_can_edit('invoicing')
              and status = 'pending' and run_id is null and line_id is null);

drop policy if exists linen_installments_delete_finance on public.linen_charge_installments;
create policy linen_installments_delete_finance on public.linen_charge_installments for delete to authenticated
  using ((select public.can_view_financials()) and public.current_user_can_edit('invoicing') and status = 'pending');

-- ─── 4. Save / void (run as the caller, so the policies above apply) ─────────

-- Splits an amount into n payments to the cent; the last carries the
-- remainder. KEEP IN SYNC with splitInstallments() in shared/linen-charges.ts.
create or replace function public.linen_split_amount(p_amount numeric, p_n int)
returns numeric[] language sql immutable set search_path = public as $fn$
  select array_agg(case when i < p_n then floor(p_amount * 100 / p_n) / 100
                        else p_amount - (p_n - 1) * (floor(p_amount * 100 / p_n) / 100) end order by i)
  from generate_series(1, p_n) i
$fn$;

-- Record a new charge (p_id null) or change one. Amount, payments and the
-- first payment's date can change only while nothing has been billed; the
-- unbilled payments are re-split. A waived charge has no payments.
create or replace function public.linen_charge_save(
  p_id uuid,
  p_contact_id uuid,
  p_property_id bigint,
  p_amount numeric,
  p_payments int,
  p_waived boolean,
  p_waive_reason text,
  p_label text,
  p_sets int,
  p_suggested numeric,
  p_note text,
  p_source_link text,
  p_bill_from date,
  p_actor text
) returns uuid
language plpgsql security invoker set search_path = public as $fn$
declare
  v_id uuid := p_id;
  v_billed int;
  v_parts numeric[];
  v_status text := case when p_waived then 'waived' else 'scheduled' end;
begin
  if not p_waived and (p_amount is null or p_amount <= 0 or p_payments is null or p_payments < 1) then
    raise exception 'A linen charge needs an amount above $0 and at least one payment (or waive it)' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.linen_charges (contact_id, property_id, label, sets, suggested_amount, amount, payments,
                                      status, waive_reason, note, source_link, created_by)
    values (p_contact_id, p_property_id, nullif(btrim(p_label), ''), p_sets, p_suggested,
            case when p_waived then 0 else round(p_amount, 2) end,
            case when p_waived then 0 else p_payments end,
            v_status, nullif(btrim(p_waive_reason), ''), nullif(btrim(p_note), ''), nullif(btrim(p_source_link), ''), p_actor)
    returning id into v_id;
  else
    select count(*) into v_billed from public.linen_charge_installments where charge_id = v_id and status <> 'pending';
    if v_billed > 0 then
      -- Partly billed: only the notes can change.
      update public.linen_charges
      set label = nullif(btrim(p_label), ''), note = nullif(btrim(p_note), ''), source_link = nullif(btrim(p_source_link), '')
      where id = v_id;
      if not found then raise exception 'Linen charge not found' using errcode = 'P0002'; end if;
      return v_id;
    end if;
    update public.linen_charges
    set contact_id = p_contact_id, property_id = p_property_id, label = nullif(btrim(p_label), ''), sets = p_sets,
        suggested_amount = p_suggested,
        amount = case when p_waived then 0 else round(p_amount, 2) end,
        payments = case when p_waived then 0 else p_payments end,
        status = v_status, waive_reason = nullif(btrim(p_waive_reason), ''),
        note = nullif(btrim(p_note), ''), source_link = nullif(btrim(p_source_link), '')
    where id = v_id;
    if not found then raise exception 'Linen charge not found' using errcode = 'P0002'; end if;
    delete from public.linen_charge_installments where charge_id = v_id and status = 'pending';
  end if;

  if not p_waived then
    v_parts := public.linen_split_amount(round(p_amount, 2), p_payments);
    insert into public.linen_charge_installments (charge_id, seq, amount, bill_from)
    select v_id, i, v_parts[i], case when i = 1 then p_bill_from end
    from generate_series(1, p_payments) i;
  end if;
  return v_id;
end $fn$;

revoke all on function public.linen_charge_save(uuid, uuid, bigint, numeric, int, boolean, text, text, int, numeric, text, text, date, text) from public, anon;
grant execute on function public.linen_charge_save(uuid, uuid, bigint, numeric, int, boolean, text, text, int, numeric, text, text, date, text) to authenticated, service_role;

-- Stop billing a charge. Payments already billed stay billed; pending ones
-- are removed.
create or replace function public.linen_charge_void(p_id uuid, p_reason text, p_actor text)
returns void language plpgsql security invoker set search_path = public as $fn$
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Say why the linen charge is being voided' using errcode = '22023';
  end if;
  delete from public.linen_charge_installments where charge_id = p_id and status = 'pending';
  update public.linen_charges set status = 'void', void_reason = btrim(p_reason), voided_by = p_actor where id = p_id;
  if not found then raise exception 'Linen charge not found' using errcode = 'P0002'; end if;
end $fn$;

revoke all on function public.linen_charge_void(uuid, text, text) from public, anon;
grant execute on function public.linen_charge_void(uuid, text, text) to authenticated, service_role;

-- ─── 5. Bill pending payments on an approved run ─────────────────────────────
-- KEEP IN SYNC with planLinenInstallments() in shared/linen-charges.ts.
create or replace function public.invoice_apply_linen_charges(p_run_id uuid, p_actor text default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_run     record;
  v_charge  record;
  v_hit     record;
  v_inst    record;
  v_line_no int;
  v_line_id uuid;
  v_prop    text;
  v_billed  jsonb := '[]'::jsonb;
begin
  select id, status, invoice_date into v_run from public.invoice_runs where id = p_run_id for update;
  if not found then
    raise exception 'Run % not found', p_run_id using errcode = 'P0002';
  end if;
  if v_run.status <> 'approved' then
    raise exception 'Run is %; linen charges are billed when a run is approved', v_run.status using errcode = '55000';
  end if;

  select coalesce(max(line_no), 0) into v_line_no from public.invoice_lines where run_id = p_run_id;

  for v_charge in
    select c.* from public.linen_charges c
    where c.status = 'scheduled'
      and exists (select 1 from public.linen_charge_installments i where i.charge_id = c.id and i.status = 'pending')
    order by c.created_at, c.id
    for update of c
  loop
    -- Where this charge's property (or client) is billed on the run, on the
    -- client's own channel: the latest service month and its last date.
    select l.billing_channel as channel,
           max(coalesce(to_char(coalesce(l.service_date, l.raw_date_mentioned, v_run.invoice_date), 'YYYY-MM'), '')) as month
    into v_hit
    from public.invoice_lines l
    join public.properties p on p.id = l.property_id
    join public.contacts ct on ct.id = p.contact_id
    where l.run_id = p_run_id
      and l.line_kind not in ('excluded', 'operating_expense')
      and l.review_status <> 'excluded'
      and coalesce(l.client_charge_amount, 0) <> 0
      and ct.billing_channel in ('qbo_haven', 'qbo_client', 'bill_com')
      and l.billing_channel = ct.billing_channel
      and not (coalesce(l.flags, '{}'::text[]) && array['credit', 'linen_charge'])
      and (case when v_charge.property_id is not null then l.property_id = v_charge.property_id
                else p.contact_id = v_charge.contact_id end)
    group by l.billing_channel
    order by 2 desc
    limit 1;
    continue when not found or v_hit.month = '';

    -- The next payment, in order.
    select * into v_inst from public.linen_charge_installments
    where charge_id = v_charge.id and status = 'pending'
    order by seq limit 1
    for update;
    continue when not found;
    -- Held until a date.
    continue when v_inst.bill_from is not null and v_inst.bill_from > current_date;
    -- An undated payment waits for a month with no other payment of this charge.
    continue when v_inst.bill_from is null and exists (
      select 1 from public.linen_charge_installments i
      where i.charge_id = v_charge.id and i.status = 'billed' and i.service_month = v_hit.month);

    select name into v_prop from public.properties where id = v_charge.property_id;
    v_line_no := v_line_no + 1;

    insert into public.invoice_lines (
      run_id, line_no, split_group, source, raw_property_text, raw_note_text, raw_amount,
      property_id, service_type, line_kind, cleaner_pay_amount, client_charge_amount,
      billing_channel, flags, review_status, review_note, resolved_by, resolved_at,
      engine_note, service_date
    ) values (
      p_run_id, v_line_no, null, 'manual', coalesce(v_prop, 'Linen program'),
      concat_ws(', ', nullif(v_charge.label, ''),
                case when v_charge.payments > 1 then 'payment ' || v_inst.seq || ' of ' || v_charge.payments end),
      0, v_charge.property_id, 'Linen Onboarding', 'extra', null, v_inst.amount,
      v_hit.channel, array['linen_charge'], 'ok', null, coalesce(p_actor, 'System'), now(),
      'Linen charge ' || v_charge.id::text || ' payment ' || v_inst.seq || ' of ' || v_charge.payments,
      (select max(coalesce(l.service_date, l.raw_date_mentioned, v_run.invoice_date))
         from public.invoice_lines l join public.properties p on p.id = l.property_id
        where l.run_id = p_run_id and l.billing_channel = v_hit.channel
          and to_char(coalesce(l.service_date, l.raw_date_mentioned, v_run.invoice_date), 'YYYY-MM') = v_hit.month
          and (case when v_charge.property_id is not null then l.property_id = v_charge.property_id
                    else p.contact_id = v_charge.contact_id end))
    ) returning id into v_line_id;

    update public.linen_charge_installments
    set status = 'billed', run_id = p_run_id, line_id = v_line_id, service_month = v_hit.month, billed_at = now()
    where id = v_inst.id;

    v_billed := v_billed || jsonb_build_object('charge_id', v_charge.id, 'installment_id', v_inst.id,
                                               'line_id', v_line_id, 'amount', v_inst.amount);
  end loop;

  return jsonb_build_object('billed', v_billed);
end;
$$;

revoke all on function public.invoice_apply_linen_charges(uuid, text) from public, anon, authenticated;
grant execute on function public.invoice_apply_linen_charges(uuid, text) to service_role;

-- ─── 6. Release a payment whose invoice never went out ───────────────────────

create or replace function public.linen_installments_release_run()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_run uuid;
begin
  if tg_op = 'DELETE' then
    v_run := old.id;
  elsif (new.status = 'void' and old.status is distinct from 'void')
        or (new.archived_at is not null and old.archived_at is null and new.status <> 'exported') then
    v_run := new.id;
  else
    return new;
  end if;

  update public.linen_charge_installments
  set status = 'pending', run_id = null, line_id = null, service_month = null, billed_at = null
  where run_id = v_run and status = 'billed';

  if tg_op <> 'DELETE' then
    update public.invoice_lines
    set review_status = 'excluded',
        review_note = concat_ws(' ', review_note, '(linen charge released: the run was voided or archived before export)')
    where run_id = v_run and 'linen_charge' = any (coalesce(flags, '{}'::text[])) and review_status <> 'excluded';
    return new;
  end if;
  return old;
end $fn$;

create or replace function public.linen_installments_release_line()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  update public.linen_charge_installments
  set status = 'pending', run_id = null, line_id = null, service_month = null, billed_at = null
  where line_id = old.id and status = 'billed';
  return old;
end $fn$;

revoke execute on function public.linen_installments_release_run() from public;
revoke execute on function public.linen_installments_release_line() from public;

drop trigger if exists invoice_runs_release_linen on public.invoice_runs;
create trigger invoice_runs_release_linen
  after update of status, archived_at on public.invoice_runs
  for each row execute function public.linen_installments_release_run();

-- BEFORE DELETE: release before the FK's SET NULL runs, or the "billed needs
-- a run" CHECK would refuse the delete.
drop trigger if exists invoice_runs_release_linen_delete on public.invoice_runs;
create trigger invoice_runs_release_linen_delete
  before delete on public.invoice_runs
  for each row execute function public.linen_installments_release_run();

drop trigger if exists invoice_lines_release_linen on public.invoice_lines;
create trigger invoice_lines_release_linen
  after delete on public.invoice_lines
  for each row when ('linen_charge' = any (coalesce(old.flags, '{}'::text[])))
  execute function public.linen_installments_release_line();

-- ─── 7. Decisions, for staff without financial access ────────────────────────
-- Per property: 'scheduled' | 'billed' | 'waived' from its own live charge, or
-- 'portfolio' when it has none but its client has a live client-wide charge;
-- no row = no decision. No amounts leave this function.
create or replace function public.linen_charge_decisions(p_property_ids bigint[])
returns table (property_id bigint, decision text)
language sql stable security definer set search_path = public as $fn$
  select p.id,
         coalesce(own.status,
                  case when exists (select 1 from public.linen_charges cw
                                    where cw.property_id is null and cw.contact_id = p.contact_id
                                      and cw.status in ('scheduled', 'billed', 'waived'))
                       then 'portfolio' end)
  from public.properties p
  left join lateral (
    select c.status from public.linen_charges c
    where c.property_id = p.id and c.status <> 'void'
    limit 1
  ) own on true
  where p.id = any (p_property_ids)
    and public.is_staff()
    and (own.status is not null or exists (select 1 from public.linen_charges cw
                                           where cw.property_id is null and cw.contact_id = p.contact_id
                                             and cw.status in ('scheduled', 'billed', 'waived')))
$fn$;

revoke all on function public.linen_charge_decisions(bigint[]) from public, anon;
grant execute on function public.linen_charge_decisions(bigint[]) to authenticated, service_role;
