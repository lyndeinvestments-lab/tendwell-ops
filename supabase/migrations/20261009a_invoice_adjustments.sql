-- Client credits and adjustments for invoicing (2026-10-09).
--
-- REVIEW REQUIRED: this migration must be reviewed and applied by Jordan. It
-- was written without a database connection and has not been run anywhere.
-- The app code that uses it degrades gracefully until it is applied: approve
-- skips credits, the exports skip the client lookup, and the Invoice
-- Reconciliation page shows a "not set up yet" note instead of the panel.
--
-- What it does (strictly additive, idempotent):
--   1. New table public.invoice_adjustments: one row per credit owed to a
--      client (a refund for a bad clean, a goodwill discount, an overcharge on
--      an earlier invoice). Amounts are NEGATIVE. Lifecycle open -> applied
--      (or open -> void). Finance-only RLS: the `invoicing` grant AND
--      can_view_financials() (the 20261008g lockdown helper), so a crew login
--      can never read it.
--   2. public.invoice_apply_open_credits(run_id, actor): called by
--      api/invoices/approve.ts right after a run is approved. For every
--      client with billable lines on the run it adds one credit line per OPEN
--      adjustment (line_kind 'extra', service_type 'Credit', flag 'credit',
--      negative client charge, zero cleaner pay) and marks the adjustment
--      applied. Rows are locked FOR UPDATE, so a credit can never be applied
--      twice even when two runs for the same client are approved at once.
--      A credit never takes the client's invoice below zero: it is capped at
--      what the client is billed in that run (in the client's latest service
--      month, since exports cut one invoice per client per month), the
--      applied row is reduced to the capped amount and the rest becomes a new
--      OPEN adjustment (parent_adjustment_id points at the original) that
--      goes on the client's next approved run.
--      Mirrored by planCreditApplication() in api/invoices/_credits.ts, which
--      is unit-tested. KEEP THE TWO IN SYNC.
--   3. Release triggers: voiding a run, archiving a run that was not yet
--      exported, deleting a run, or deleting a credit line puts the applied
--      credit back to OPEN (and excludes the credit line on that run), so a
--      credit is never lost with an invoice that never went out.
--   4. Audit trigger in the style of client_fee_overrides_audit: every
--      add / apply / void / reopen / change is written to activity_log.
--
-- Nothing existing is altered: no column, constraint, policy or row of any
-- existing table changes. Credit lines are ordinary invoice_lines rows that
-- satisfy the existing CHECKs (source 'manual', line_kind 'extra').

-- ─── 1. Table ────────────────────────────────────────────────────────────────

create table if not exists public.invoice_adjustments (
  id                   uuid primary key default gen_random_uuid(),
  -- Required on insert (trigger below). SET NULL on delete so a client can be
  -- permanently deleted; its credits keep their history with no client and
  -- can no longer be applied.
  contact_id           uuid null references public.contacts(id) on delete set null,
  original_line_id     uuid null references public.invoice_lines(id) on delete set null,
  amount               numeric(12,2) not null check (amount < 0),
  reason               text not null check (btrim(reason) <> ''),
  evidence_url         text,
  status               text not null default 'open' check (status in ('open', 'applied', 'void')),
  applied_run_id       uuid null references public.invoice_runs(id) on delete set null,
  applied_line_id      uuid null,
  applied_at           timestamptz,
  parent_adjustment_id uuid null references public.invoice_adjustments(id) on delete set null,
  created_by           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  voided_by            text,
  voided_at            timestamptz,
  void_reason          text,
  constraint invoice_adjustments_applied_has_run check (status <> 'applied' or applied_run_id is not null),
  constraint invoice_adjustments_void_has_reason check (status <> 'void' or nullif(btrim(void_reason), '') is not null),
  constraint invoice_adjustments_evidence_is_link check (evidence_url is null or evidence_url ~* '^https?://')
);

create index if not exists invoice_adjustments_open_contact_idx
  on public.invoice_adjustments (contact_id) where status = 'open';
create index if not exists invoice_adjustments_applied_run_idx
  on public.invoice_adjustments (applied_run_id) where applied_run_id is not null;
create index if not exists invoice_adjustments_applied_line_idx
  on public.invoice_adjustments (applied_line_id) where applied_line_id is not null;

create or replace function public.invoice_adjustments_touch()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  if new.status = 'void' and old.status is distinct from 'void' and new.voided_at is null then
    new.voided_at := now();
  end if;
  return new;
end $fn$;

drop trigger if exists invoice_adjustments_touch on public.invoice_adjustments;
create trigger invoice_adjustments_touch
  before update on public.invoice_adjustments
  for each row execute function public.invoice_adjustments_touch();

create or replace function public.invoice_adjustments_require_client()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if new.contact_id is null then
    raise exception 'A client credit needs a client' using errcode = '23502';
  end if;
  return new;
end $fn$;

revoke execute on function public.invoice_adjustments_require_client() from public;

drop trigger if exists invoice_adjustments_require_client on public.invoice_adjustments;
create trigger invoice_adjustments_require_client
  before insert on public.invoice_adjustments
  for each row execute function public.invoice_adjustments_require_client();

-- ─── 2. Audit ────────────────────────────────────────────────────────────────
-- Every change moves money on a client invoice, so it leaves a trail whichever
-- path wrote it (UI, SQL, the approve function).
create or replace function public.invoice_adjustments_audit()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_client text;
  v_actor  text;
  v_email  text;
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'credit_added';
  elsif new.status = 'applied' and old.status = 'open' then
    v_action := 'credit_applied';
  elsif new.status = 'void' and old.status <> 'void' then
    v_action := 'credit_voided';
  elsif new.status = 'open' and old.status = 'applied' then
    v_action := 'credit_reopened';
  elsif new.amount is distinct from old.amount or new.reason is distinct from old.reason
        or new.evidence_url is distinct from old.evidence_url then
    v_action := 'credit_changed';
  else
    return new;
  end if;

  select coalesce(nullif(btrim(company), ''), full_name) into v_client
    from public.contacts where id = new.contact_id;
  v_email := public.current_auth_email();
  select label into v_actor from public.app_users where lower(google_email) = lower(v_email);
  v_actor := coalesce(v_actor, v_email,
                      case when v_action = 'credit_voided' then new.voided_by else new.created_by end,
                      'System');

  insert into public.activity_log (entity_type, entity_id, entity_name, action, field_name,
                                   old_value, new_value, changed_by, metadata)
  values ('contact', new.contact_id::text, v_client, v_action, 'credit',
          case when tg_op = 'UPDATE' then '$' || to_char(old.amount, 'FM9999999990.00') || ' ' || old.status end,
          '$' || to_char(new.amount, 'FM9999999990.00') || ' ' || new.status,
          v_actor,
          jsonb_build_object('adjustment_id', new.id, 'reason', new.reason,
                             'applied_run_id', new.applied_run_id, 'parent_adjustment_id', new.parent_adjustment_id,
                             'void_reason', new.void_reason));
  return new;
end $fn$;

revoke execute on function public.invoice_adjustments_audit() from public;
revoke execute on function public.invoice_adjustments_touch() from public;

drop trigger if exists invoice_adjustments_audit on public.invoice_adjustments;
create trigger invoice_adjustments_audit
  after insert or update on public.invoice_adjustments
  for each row execute function public.invoice_adjustments_audit();

-- ─── 3. RLS: finance-only ────────────────────────────────────────────────────
-- Read: the `invoicing` view AND can_view_financials() (client money; the
-- 20261008g rule). Write: the `invoicing` edit grant. A browser may only
-- create an OPEN credit and may only move an open credit to open/void: the
-- applied state is written exclusively by invoice_apply_open_credits (service
-- role, which bypasses RLS). No DELETE policy: credits are voided, never erased.
alter table public.invoice_adjustments enable row level security;
revoke all on public.invoice_adjustments from anon;

drop policy if exists invoice_adjustments_select_finance on public.invoice_adjustments;
create policy invoice_adjustments_select_finance
  on public.invoice_adjustments for select to authenticated
  using ((select public.can_view_financials()) and public.current_user_can_view('invoicing'));

drop policy if exists invoice_adjustments_insert_finance on public.invoice_adjustments;
create policy invoice_adjustments_insert_finance
  on public.invoice_adjustments for insert to authenticated
  with check (
    (select public.can_view_financials()) and public.current_user_can_edit('invoicing')
    and status = 'open' and applied_run_id is null and applied_line_id is null and applied_at is null
  );

drop policy if exists invoice_adjustments_update_finance on public.invoice_adjustments;
create policy invoice_adjustments_update_finance
  on public.invoice_adjustments for update to authenticated
  using ((select public.can_view_financials()) and public.current_user_can_edit('invoicing') and status = 'open')
  with check (
    (select public.can_view_financials()) and public.current_user_can_edit('invoicing')
    and status in ('open', 'void') and applied_run_id is null and applied_line_id is null and applied_at is null
  );

-- ─── 4. Apply open credits to an approved run ────────────────────────────────
-- KEEP IN SYNC with planCreditApplication() in api/invoices/_credits.ts.
create or replace function public.invoice_apply_open_credits(p_run_id uuid, p_actor text default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_run       record;
  v_client    record;
  v_adj       record;
  v_remaining numeric(12,2);
  v_apply     numeric(12,2);
  v_line_no   int;
  v_line_id   uuid;
  v_prop      bigint;
  v_applied   jsonb := '[]'::jsonb;
  v_split     int := 0;
begin
  select id, status, invoice_date into v_run from public.invoice_runs where id = p_run_id for update;
  if not found then
    raise exception 'Run % not found', p_run_id using errcode = 'P0002';
  end if;
  if v_run.status <> 'approved' then
    raise exception 'Run is %; credits are applied when a run is approved', v_run.status using errcode = '55000';
  end if;

  select coalesce(max(line_no), 0) into v_line_no from public.invoice_lines where run_id = p_run_id;

  for v_client in
    with lines as (
      -- What the client is billed on this run, on their own billing channel.
      select p.contact_id, l.billing_channel as channel, l.client_charge_amount as amt,
             coalesce(l.service_date, l.raw_date_mentioned, v_run.invoice_date) as d
      from public.invoice_lines l
      join public.properties p on p.id = l.property_id
      join public.contacts c on c.id = p.contact_id
      where l.run_id = p_run_id
        and l.line_kind not in ('excluded', 'operating_expense')
        and l.review_status <> 'excluded'
        and coalesce(l.client_charge_amount, 0) <> 0
        and c.billing_channel in ('qbo_haven', 'bill_com')
        and l.billing_channel = c.billing_channel
        and not ('credit' = any (coalesce(l.flags, '{}'::text[])))
      union all
      -- Credits already on this run (a repeat call nets them out).
      select a.contact_id, l.billing_channel, l.client_charge_amount,
             coalesce(l.service_date, l.raw_date_mentioned, v_run.invoice_date)
      from public.invoice_lines l
      join public.invoice_adjustments a on a.applied_line_id = l.id
      join public.contacts c on c.id = a.contact_id
      where l.run_id = p_run_id
        and l.review_status <> 'excluded'
        and l.billing_channel = c.billing_channel
    ), months as (
      -- Exports cut one invoice per client per service month: the credit goes
      -- on the client's latest month and is capped by that month's total.
      select contact_id, max(coalesce(to_char(d, 'YYYY-MM'), '')) as month
      from lines group by contact_id
    )
    select l.contact_id, min(l.channel) as channel, round(sum(l.amt), 2) as total, max(l.d) as last_date
    from lines l
    join months m on m.contact_id = l.contact_id
    where coalesce(to_char(l.d, 'YYYY-MM'), '') = m.month
      and exists (select 1 from public.invoice_adjustments a where a.contact_id = l.contact_id and a.status = 'open')
    group by l.contact_id
    order by l.contact_id
  loop
    v_remaining := v_client.total;
    continue when v_remaining is null or v_remaining <= 0;

    for v_adj in
      select * from public.invoice_adjustments
      where contact_id = v_client.contact_id and status = 'open'
      order by created_at, id
      for update
    loop
      exit when v_remaining <= 0;
      v_apply := least(-v_adj.amount, v_remaining);
      v_line_no := v_line_no + 1;

      -- The original line's property, only when it belongs to this client.
      v_prop := null;
      if v_adj.original_line_id is not null then
        select l.property_id into v_prop
        from public.invoice_lines l
        join public.properties p on p.id = l.property_id
        where l.id = v_adj.original_line_id and p.contact_id = v_client.contact_id;
      end if;

      insert into public.invoice_lines (
        run_id, line_no, split_group, source, raw_property_text, raw_note_text, raw_amount,
        property_id, service_type, line_kind, cleaner_pay_amount, client_charge_amount,
        billing_channel, flags, review_status, review_note, resolved_by, resolved_at,
        engine_note, service_date
      ) values (
        p_run_id, v_line_no, null, 'manual', 'Client credit', v_adj.reason, 0,
        v_prop, 'Credit', 'extra', 0, -v_apply,
        v_client.channel, array['credit'], 'ok',
        concat_ws(' ', v_adj.reason, v_adj.evidence_url), coalesce(p_actor, 'System'), now(),
        'Client credit ' || v_adj.id::text
          || case when v_apply < -v_adj.amount
                  then ' (partly applied: $' || to_char(-v_adj.amount - v_apply, 'FM9999999990.00') || ' carried to the next invoice)'
                  else '' end,
        v_client.last_date
      ) returning id into v_line_id;

      if v_apply < -v_adj.amount then
        -- Remainder stays owed; keeps its place in line (same created_at).
        insert into public.invoice_adjustments (
          contact_id, original_line_id, amount, reason, evidence_url, status,
          created_by, created_at, parent_adjustment_id
        ) values (
          v_adj.contact_id, v_adj.original_line_id, v_adj.amount + v_apply, v_adj.reason, v_adj.evidence_url, 'open',
          coalesce(p_actor, 'System'), v_adj.created_at, v_adj.id
        );
        v_split := v_split + 1;
      end if;

      update public.invoice_adjustments
      set status = 'applied', amount = -v_apply, applied_run_id = p_run_id,
          applied_line_id = v_line_id, applied_at = now()
      where id = v_adj.id;

      v_applied := v_applied || jsonb_build_object(
        'adjustment_id', v_adj.id, 'line_id', v_line_id, 'contact_id', v_adj.contact_id, 'amount', -v_apply);
      v_remaining := v_remaining - v_apply;
    end loop;
  end loop;

  return jsonb_build_object('applied', v_applied, 'remainders', v_split);
end;
$$;

revoke all on function public.invoice_apply_open_credits(uuid, text) from public, anon, authenticated;
grant execute on function public.invoice_apply_open_credits(uuid, text) to service_role;

-- ─── 5. Release a credit whose invoice never went out ────────────────────────
-- SECURITY DEFINER: the browser archives runs, and its own RLS (update only
-- OPEN credits) would otherwise silently skip the applied rows.
create or replace function public.invoice_adjustments_release_run()
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

  update public.invoice_adjustments
  set status = 'open', applied_run_id = null, applied_line_id = null, applied_at = null
  where applied_run_id = v_run and status = 'applied';

  if tg_op <> 'DELETE' then
    update public.invoice_lines
    set review_status = 'excluded',
        review_note = concat_ws(' ', review_note, '(credit released: the run was voided or archived before export)')
    where run_id = v_run and 'credit' = any (coalesce(flags, '{}'::text[])) and review_status <> 'excluded';
    return new;
  end if;
  return old;
end $fn$;

create or replace function public.invoice_adjustments_release_line()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  update public.invoice_adjustments
  set status = 'open', applied_run_id = null, applied_line_id = null, applied_at = null
  where applied_line_id = old.id and status = 'applied';
  return old;
end $fn$;

revoke execute on function public.invoice_adjustments_release_run() from public;
revoke execute on function public.invoice_adjustments_release_line() from public;

drop trigger if exists invoice_runs_release_credits on public.invoice_runs;
create trigger invoice_runs_release_credits
  after update of status, archived_at on public.invoice_runs
  for each row execute function public.invoice_adjustments_release_run();

-- BEFORE DELETE: the credit must be reopened before the FK's SET NULL runs,
-- or the "applied needs a run" CHECK would refuse the delete.
drop trigger if exists invoice_runs_release_credits_delete on public.invoice_runs;
create trigger invoice_runs_release_credits_delete
  before delete on public.invoice_runs
  for each row execute function public.invoice_adjustments_release_run();

drop trigger if exists invoice_lines_release_credit on public.invoice_lines;
create trigger invoice_lines_release_credit
  after delete on public.invoice_lines
  for each row when ('credit' = any (coalesce(old.flags, '{}'::text[])))
  execute function public.invoice_adjustments_release_line();
