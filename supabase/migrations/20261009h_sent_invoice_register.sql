-- Sent-invoices register + pre-send check (2026-10-09). REVIEW AND APPLY: Jordan.
--
-- Builds on 20261009c_billcom_send_control.sql (client_invoices: held /
-- approved / sent). Until now "sent" lived only on client_invoices, a row
-- that cascades away with its run, and nothing stopped a client invoice with
-- open questions from being marked sent. This migration adds:
--
--   1. public.sent_invoices: an APPEND-ONLY register of every client invoice
--      that went out (number, channel, client snapshot, period, total,
--      recipient, who/when, optional SHA-256 of the PDF). It covers client
--      invoices from every run source (vendor CSV, generated draft, vendor
--      portal), and it survives deletion of the run, the client_invoices row
--      and the contact: those links are ON DELETE SET NULL, and the client
--      name and run source are snapshots. A trigger refuses every UPDATE and
--      DELETE except the FK nulling those deletions perform. A correction is a
--      NEW row whose voids_id points at the row it cancels (with a note).
--   2. The one-month rule for CLIENT invoices: a register row's period must
--      sit inside one calendar month (CHECK), and when it records a
--      client_invoices row, inside that row's service_month (trigger). No
--      such rule is added to invoice_runs: a vendor run may span months.
--   3. public.client_invoice_mark_sent(...): runs the pre-send check (mirror
--      of preSendExceptions in shared/sent-invoice-register.ts, KEEP IN SYNC)
--      and, only when it finds nothing, marks the client invoice sent and
--      writes the register row in the same transaction. Service role only;
--      api/invoices/billcom.ts is the caller.
--
-- Contact link: ON DELETE SET NULL plus the client_name snapshot, not
-- RESTRICT. The register is history: it must never block a permanent client
-- delete, and it must still say who was billed after one. (client_invoices
-- and invoice_adjustments also use ON DELETE SET NULL, from 20261009c and
-- 20261009a.)
--
-- Recipient: what the user typed in the Mark sent dialog, else the client's
-- contacts.email (bill.com sends to the customer's email on file). There is
-- no separate Haven billing address in the app or settings today.
--
-- PDF hash: the app does not generate client invoice PDFs (bill.com does).
-- The Mark sent dialog lets the user pick the bill.com PDF; the browser hashes
-- it (SHA-256) and only the hex digest is sent and stored. The file itself is
-- never uploaded.
--
-- Access: client money, so SELECT is finance-only (can_view_financials(),
-- 20261008g) AND needs the invoicing view, exactly like client_invoices.
-- There is NO write policy: rows are written only by the service-role
-- function. anon gets nothing.
--
-- Strictly additive and idempotent: new table, new functions, new triggers.
-- No existing table, column or row is changed. The app runs without it: until
-- this is applied, Mark sent behaves exactly as in 20261009c and the register
-- view stays hidden.

-- Needs 20261009a (invoice_adjustments: credits join their client's invoice)
-- and 20261009c (client_invoices). Apply after both.
do $$
begin
  if to_regclass('public.invoice_adjustments') is null or to_regclass('public.client_invoices') is null then
    raise exception '20261009h needs 20261009a and 20261009c applied first';
  end if;
end
$$;

-- ─── sent_invoices ───────────────────────────────────────────────────────────
create table if not exists public.sent_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null check (btrim(invoice_number) <> ''),
  billing_channel text not null check (billing_channel in ('bill_com', 'qbo_haven')),
  contact_id uuid references public.contacts(id) on delete set null,
  client_name text not null check (btrim(client_name) <> ''),
  period_start date not null,
  period_end date not null,
  total numeric(12,2) not null,
  recipient text,
  sent_at timestamptz not null default now(),
  sent_by text,
  pdf_sha256 text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  run_id uuid references public.invoice_runs(id) on delete set null,
  client_invoice_id uuid references public.client_invoices(id) on delete set null,
  run_source text,
  -- A correction: this row cancels the row it points at (same channel and
  -- number). NULL on every ordinary row.
  voids_id uuid references public.sent_invoices(id) on delete restrict,
  note text,
  created_at timestamptz not null default now(),
  constraint sent_invoices_period_order check (period_start <= period_end),
  constraint sent_invoices_one_month check (date_trunc('month', period_start) = date_trunc('month', period_end)),
  constraint sent_invoices_void_not_self check (voids_id is null or voids_id <> id),
  constraint sent_invoices_void_needs_note check (voids_id is null or (note is not null and btrim(note) <> ''))
);

-- UNIQUE (billing_channel, invoice_number) over the ORIGINAL rows; a void row
-- repeats its original's number, and one row can be voided only once.
create unique index if not exists sent_invoices_channel_number_uniq
  on public.sent_invoices (billing_channel, invoice_number) where voids_id is null;
create unique index if not exists sent_invoices_voids_uniq
  on public.sent_invoices (voids_id) where voids_id is not null;
create index if not exists sent_invoices_contact_idx on public.sent_invoices (contact_id);
create index if not exists sent_invoices_run_idx on public.sent_invoices (run_id);
create index if not exists sent_invoices_client_invoice_idx on public.sent_invoices (client_invoice_id);
create index if not exists sent_invoices_sent_at_idx on public.sent_invoices (sent_at desc);

-- ─── Append-only ─────────────────────────────────────────────────────────────
-- The only UPDATE allowed is the FK nulling done by ON DELETE SET NULL when a
-- run, client invoice or contact is deleted; everything else is refused.
create or replace function public.sent_invoices_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'run_id' - 'client_invoice_id' - 'contact_id')
         = (to_jsonb(old) - 'run_id' - 'client_invoice_id' - 'contact_id')
     and (new.run_id is not distinct from old.run_id or new.run_id is null)
     and (new.client_invoice_id is not distinct from old.client_invoice_id or new.client_invoice_id is null)
     and (new.contact_id is not distinct from old.contact_id or new.contact_id is null) then
    return new;
  end if;
  raise exception 'sent_invoices is append-only; record a correction as a new row with voids_id'
    using errcode = '55000';
end;
$$;

revoke all on function public.sent_invoices_append_only() from public, anon, authenticated;

drop trigger if exists sent_invoices_append_only on public.sent_invoices;
create trigger sent_invoices_append_only
  before update or delete on public.sent_invoices
  for each row execute function public.sent_invoices_append_only();

-- ─── One-month rule against client_invoices.service_month ────────────────────
-- A register row that records a client invoice must match it: same client,
-- same channel, the invoice already marked sent under this number, and the
-- period inside its service month. A void row must match its original.
create or replace function public.sent_invoices_check_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ci record;
  orig record;
begin
  if new.voids_id is not null then
    select s.billing_channel, s.invoice_number, s.voids_id into orig
    from public.sent_invoices s where s.id = new.voids_id;
    if not found or orig.voids_id is not null then
      raise exception 'voids_id must point at an original register row' using errcode = '23514';
    end if;
    if orig.billing_channel <> new.billing_channel or orig.invoice_number <> new.invoice_number then
      raise exception 'A void row must repeat the channel and number of the row it voids' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.client_invoice_id is not null then
    select x.contact_id, x.billing_channel, x.service_month, x.status, x.billcom_invoice_number
      into ci from public.client_invoices x where x.id = new.client_invoice_id;
    if not found then
      raise exception 'Client invoice % not found', new.client_invoice_id using errcode = '23503';
    end if;
    if ci.status <> 'sent' or ci.billcom_invoice_number is distinct from new.invoice_number then
      raise exception 'Client invoice % is not marked sent as %', new.client_invoice_id, new.invoice_number
        using errcode = '23514';
    end if;
    if ci.billing_channel <> new.billing_channel or ci.contact_id is distinct from new.contact_id then
      raise exception 'Register row does not match client invoice % (client or channel differs)', new.client_invoice_id
        using errcode = '23514';
    end if;
    if to_char(new.period_start, 'YYYY-MM') <> ci.service_month or to_char(new.period_end, 'YYYY-MM') <> ci.service_month then
      raise exception 'A client invoice cannot span months: period % to % is outside service month %',
        new.period_start, new.period_end, ci.service_month using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.sent_invoices_check_insert() from public, anon, authenticated;

drop trigger if exists sent_invoices_check_insert on public.sent_invoices;
create trigger sent_invoices_check_insert
  before insert on public.sent_invoices
  for each row execute function public.sent_invoices_check_insert();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.sent_invoices enable row level security;

drop policy if exists sent_invoices_finance_select on public.sent_invoices;
create policy sent_invoices_finance_select on public.sent_invoices
  for select to authenticated
  using ((select public.can_view_financials()) and public.current_user_can_view('invoicing'));

revoke all on table public.sent_invoices from anon, public, authenticated;
grant select on table public.sent_invoices to authenticated;
grant all on table public.sent_invoices to service_role;

-- ─── client_invoice_mark_sent ────────────────────────────────────────────────
-- Pre-send check + mark sent + register row, atomically. Returns
--   { ok: false, exceptions: [{code, message, line_no?}, ...] }  nothing written
--   { ok: true, client_invoice: {...}, sent_invoice: {...} }
-- Exception codes and messages mirror preSendExceptions()
-- (shared/sent-invoice-register.ts); keep the two in sync.
--
-- The client invoice's lines: the run's lines on its channel whose property
-- belongs to its client, billable (same filter as isBillComArLine), in the
-- service month of coalesce(service_date, raw_date_mentioned, run invoice
-- date), as groupBillComInvoices groups them. Held lines are included (they
-- are an exception); the total counts only lines that are not held.
create or replace function public.client_invoice_mark_sent(
  p_client_invoice_id uuid,
  p_number text,
  p_recipient text default null,
  p_pdf_sha256 text default null,
  p_actor text default null,
  p_total numeric default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_ci public.client_invoices%rowtype;
  v_run record;
  v_contact record;
  v_reg record;
  v_line record;
  v_number text := nullif(btrim(regexp_replace(coalesce(p_number, ''), '\s+', ' ', 'g')), '');
  v_hash text := nullif(lower(btrim(coalesce(p_pdf_sha256, ''))), '');
  v_recipient text := left(nullif(btrim(regexp_replace(coalesce(p_recipient, ''), '\s+', ' ', 'g')), ''), 320);
  v_lines jsonb;
  v_exc jsonb := '[]'::jsonb;
  v_total numeric(12,2);
  v_line_count int;
  v_min_date date;
  v_max_date date;
  v_month_start date;
  v_month_end date;
  v_start date;
  v_end date;
  v_ci_out jsonb;
  v_si_out jsonb;
begin
  if v_number is null or length(v_number) > 64 then
    raise exception 'Enter the invoice number (up to 64 characters)' using errcode = '22023';
  end if;
  if v_hash is not null and v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'pdf_sha256 must be a SHA-256 hex digest' using errcode = '22023';
  end if;

  select * into v_ci from public.client_invoices where id = p_client_invoice_id for update;
  if not found then
    raise exception 'Client invoice % not found', p_client_invoice_id using errcode = 'P0002';
  end if;
  select ir.id, ir.status, ir.archived_at, ir.source, ir.invoice_date, ir.period_start, ir.period_end
    into v_run from public.invoice_runs ir where ir.id = v_ci.run_id for share;

  v_month_start := to_date(v_ci.service_month || '-01', 'YYYY-MM-DD');
  v_month_end := (v_month_start + interval '1 month' - interval '1 day')::date;

  if v_ci.status <> 'approved' then
    v_exc := v_exc || jsonb_build_object('code', 'client_invoice_not_approved', 'message',
      case when v_ci.status = 'sent' then 'This client invoice was already sent' else 'Approve this client invoice first (it is held)' end);
  end if;
  if v_run.status not in ('approved', 'exported') then
    v_exc := v_exc || jsonb_build_object('code', 'run_not_approved', 'message',
      format('The run is %s; only an approved or exported run can be billed', v_run.status));
  end if;
  if v_run.archived_at is not null then
    v_exc := v_exc || jsonb_build_object('code', 'run_archived', 'message',
      'The run is archived; restore it before sending its client invoices');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_no', il.line_no,
           'review_status', il.review_status,
           'hold', nullif(btrim(regexp_replace(coalesce(il.bill_hold_reason, ''), '\s+', ' ', 'g')), ''),
           -- Only the flags that need a written resolution (NOTE_REQUIRED_FLAGS).
           'note_flags', to_jsonb(array(
             select f from unnest(coalesce(il.flags, '{}'::text[])) as f
             where f in ('charge_changed_since_last_invoice', 'not_haven_listing', 'redo_pending', 'price_mismatch_agreement'))),
           'has_note', coalesce(btrim(il.review_note), '') <> '',
           'line_date', coalesce(il.service_date, il.raw_date_mentioned),
           'charge', il.client_charge_amount)), '[]'::jsonb)
    into v_lines
  from public.invoice_lines il
  left join public.properties p on p.id = il.property_id
  -- A client credit (#624) usually has no property; its client is on the
  -- adjustment it was applied from (lineClient in shared/billcom-send.ts).
  left join public.invoice_adjustments adj on adj.applied_line_id = il.id
  where il.run_id = v_ci.run_id
    and il.billing_channel = v_ci.billing_channel
    and coalesce(adj.contact_id, p.contact_id) = v_ci.contact_id
    and il.line_kind not in ('excluded', 'operating_expense')
    and il.review_status <> 'excluded'
    and il.client_charge_amount is not null
    and il.client_charge_amount <> 0
    and to_char(coalesce(il.service_date, il.raw_date_mentioned, v_run.invoice_date), 'YYYY-MM') = v_ci.service_month;

  select count(*), min((x ->> 'line_date')::date), max((x ->> 'line_date')::date),
         round(coalesce(sum((x ->> 'charge')::numeric) filter (where x ->> 'hold' is null), 0), 2)
    into v_line_count, v_min_date, v_max_date, v_total
  from jsonb_array_elements(v_lines) as x;

  if v_line_count = 0 then
    v_exc := v_exc || jsonb_build_object('code', 'no_lines', 'message', 'No billable lines for this client and month');
  end if;

  -- Per vendor line (split rows share line_no): one entry per line per problem.
  for v_line in
    select (x ->> 'line_no')::int as line_no,
           bool_or(x ->> 'review_status' = 'needs_review') as needs_review,
           max(x ->> 'hold') as hold,
           coalesce(array_agg(distinct f order by f) filter (where f is not null), '{}'::text[]) as note_flags,
           bool_and(not (x ->> 'has_note')::boolean) as no_note,
           min((x ->> 'line_date')::date) filter (
             where to_char((x ->> 'line_date')::date, 'YYYY-MM') <> v_ci.service_month) as outside_date
    -- The lateral unnest repeats a row per flag; every aggregate above is
    -- unaffected by repeats (or, and, max, min, distinct).
    from jsonb_array_elements(v_lines) as x
    left join lateral jsonb_array_elements_text(x -> 'note_flags') as f on true
    group by (x ->> 'line_no')::int
    order by 1
  loop
    if v_line.needs_review then
      v_exc := v_exc || jsonb_build_object('code', 'needs_review', 'line_no', v_line.line_no,
        'message', format('Line %s still needs review', v_line.line_no));
    end if;
    if v_line.hold is not null then
      v_exc := v_exc || jsonb_build_object('code', 'held_line', 'line_no', v_line.line_no,
        'message', format('Line %s is held from billing (%s); release it before sending', v_line.line_no, v_line.hold));
    end if;
    if cardinality(v_line.note_flags) > 0 and v_line.no_note then
      v_exc := v_exc || jsonb_build_object('code', 'note_required', 'line_no', v_line.line_no,
        'message', format('Line %s is flagged %s and needs a review note saying how it was resolved',
          v_line.line_no, array_to_string(v_line.note_flags, ', ')));
    end if;
    if v_line.outside_date is not null then
      v_exc := v_exc || jsonb_build_object('code', 'line_outside_month', 'line_no', v_line.line_no,
        'message', format('Line %s is dated %s, outside %s', v_line.line_no, v_line.outside_date, v_ci.service_month));
    end if;
  end loop;

  if v_line_count > 0 and v_total <= 0 then
    v_exc := v_exc || jsonb_build_object('code', 'total_not_positive', 'message',
      format('The invoice total is $%s; a client invoice must be more than $0', to_char(v_total, 'FM999999990.00')));
  end if;
  if p_total is not null and abs(round(p_total, 2) - v_total) >= 0.005 then
    v_exc := v_exc || jsonb_build_object('code', 'total_mismatch', 'message',
      format('The total shown ($%s) differs from the lines ($%s); refresh and check again',
        to_char(round(p_total, 2), 'FM999999990.00'), to_char(v_total, 'FM999999990.00')));
  end if;

  select s.client_name, s.sent_at into v_reg from public.sent_invoices s
  where s.billing_channel = v_ci.billing_channel and s.invoice_number = v_number and s.voids_id is null
  limit 1;
  if found then
    v_exc := v_exc || jsonb_build_object('code', 'already_registered', 'message',
      format('This invoice number was already recorded as sent%s%s',
        case when v_reg.client_name is not null then ' to ' || v_reg.client_name else '' end,
        case when v_reg.sent_at is not null then ' on ' || to_char(v_reg.sent_at, 'YYYY-MM-DD') else '' end));
  end if;

  if jsonb_array_length(v_exc) > 0 then
    return jsonb_build_object('ok', false, 'exceptions', v_exc);
  end if;

  -- Period: service month intersected with the run period, widened to the
  -- lines' own dates, never leaving the month (registerPeriod in the shared
  -- module). least() / greatest() ignore NULLs.
  v_start := greatest(v_month_start, least(v_run.period_start, v_min_date));
  v_end := least(v_month_end, greatest(v_run.period_end, v_max_date));
  if v_start > v_end then
    v_start := v_month_start;
    v_end := v_month_end;
  end if;

  select ct.full_name, ct.company, ct.email into v_contact from public.contacts ct where ct.id = v_ci.contact_id;

  update public.client_invoices ci
  set status = 'sent',
      billcom_invoice_number = v_number,
      total = v_total,
      sent_at = now(),
      sent_by = p_actor,
      updated_by = p_actor,
      hold_reason = null
  where ci.id = v_ci.id and ci.status = 'approved'
  returning to_jsonb(ci.*) into v_ci_out;

  insert into public.sent_invoices as si (
    invoice_number, billing_channel, contact_id, client_name, period_start, period_end, total,
    recipient, sent_by, pdf_sha256, run_id, client_invoice_id, run_source
  ) values (
    v_number, v_ci.billing_channel, v_ci.contact_id,
    coalesce(nullif(btrim(v_contact.full_name), ''), nullif(btrim(v_contact.company), ''), 'Unknown client'),
    v_start, v_end, v_total,
    coalesce(v_recipient, nullif(btrim(v_contact.email), '')), p_actor, v_hash, v_ci.run_id, v_ci.id, v_run.source
  )
  returning to_jsonb(si.*) into v_si_out;

  return jsonb_build_object('ok', true, 'client_invoice', v_ci_out, 'sent_invoice', v_si_out);
end;
$$;

revoke all on function public.client_invoice_mark_sent(uuid, text, text, text, text, numeric) from public, anon, authenticated;
grant execute on function public.client_invoice_mark_sent(uuid, text, text, text, text, numeric) to service_role;
