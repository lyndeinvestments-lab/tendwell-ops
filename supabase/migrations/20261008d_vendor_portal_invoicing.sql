-- Vendor invoicing portal (2026-10-08).
--
-- Busy Bee builds its own invoice inside Ops (Operations → Invoicing) from the
-- completed Breezeway/Trellis cleans, adds its own billable items (inspection
-- hours, labor, reimbursements, extras, missing cleans) and submits it. The
-- submitted run lands in the admin Invoice Reconciliation queue, where Tendwell
-- reviews, approves and exports the Ramp / QBO / bill.com files exactly as for
-- an uploaded CSV.
--
-- The vendor never reads invoice_runs / invoice_lines directly (their RLS
-- stays on the `invoicing` grant). Every vendor read and write goes through
-- api/vendor-invoices/*, which uses the service role and returns an
-- allow-listed set of columns (no client charge, billing channel or engine
-- note ever leaves the server).
--
-- Duplicate protection lives HERE, not only in application code:
--   * invoice_lines.clean_claim_key + a unique index: a property-day clean can
--     sit on at most one active vendor-portal invoice. The key is computed by
--     a trigger, so no code path can forget to set it.
--   * invoice_runs overlap guard: one vendor cannot have two active portal
--     invoices covering the same day.

-- ─── 1. Vendor logins ────────────────────────────────────────────────────────

create table if not exists public.vendor_users (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  created_by text,
  created_at timestamptz not null default now()
);
create unique index if not exists vendor_users_email_key on public.vendor_users (email);

alter table public.vendor_users enable row level security;
drop policy if exists vendor_users_select on public.vendor_users;
create policy vendor_users_select on public.vendor_users for select to authenticated
  using (public.current_user_can_view('invoicing') or email = public.current_auth_email());
drop policy if exists vendor_users_insert on public.vendor_users;
create policy vendor_users_insert on public.vendor_users for insert to authenticated
  with check (public.current_user_can_edit('invoicing'));
drop policy if exists vendor_users_delete on public.vendor_users;
create policy vendor_users_delete on public.vendor_users for delete to authenticated
  using (public.current_user_can_edit('invoicing'));
revoke all on public.vendor_users from anon;

-- ─── 2. Runs: portal source, draft status, submission trail ─────────────────

alter table public.invoice_runs drop constraint if exists invoice_runs_source_check;
alter table public.invoice_runs add constraint invoice_runs_source_check
  check (source = any (array['vendor_csv', 'generated', 'vendor_portal']));

alter table public.invoice_runs drop constraint if exists invoice_runs_status_check;
alter table public.invoice_runs add constraint invoice_runs_status_check
  check (status = any (array['draft', 'ingested', 'reconciled', 'review_needed', 'approved', 'exported', 'void']));

alter table public.invoice_runs
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by text,
  add column if not exists returned_at timestamptz,
  add column if not exists returned_by text,
  add column if not exists returned_note text,
  add column if not exists vendor_reference text,
  add column if not exists vendor_total numeric(12, 2);

-- Only a vendor-portal run can be a draft (admin runs start at ingested).
alter table public.invoice_runs drop constraint if exists invoice_runs_draft_portal_check;
alter table public.invoice_runs add constraint invoice_runs_draft_portal_check
  check (status <> 'draft' or source = 'vendor_portal');

create or replace function public.invoice_runs_portal_overlap_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source <> 'vendor_portal' or new.archived_at is not null or new.status = 'void' then
    return new;
  end if;
  if new.vendor_id is null or new.period_start is null or new.period_end is null
     or new.period_start > new.period_end then
    raise exception 'A vendor invoice needs a vendor and a valid period (start <= end)'
      using errcode = '23514';
  end if;
  -- Serialize per vendor so two concurrent creates cannot both pass the check.
  perform pg_advisory_xact_lock(hashtext('invoice_runs_portal:' || new.vendor_id::text));
  if exists (
    select 1 from public.invoice_runs r
    where r.id <> new.id
      and r.source = 'vendor_portal'
      and r.vendor_id = new.vendor_id
      and r.archived_at is null
      and r.status <> 'void'
      and daterange(r.period_start, r.period_end, '[]') && daterange(new.period_start, new.period_end, '[]')
  ) then
    raise exception 'This vendor already has an invoice covering part of % to %', new.period_start, new.period_end
      using errcode = '23P01';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoice_runs_portal_overlap on public.invoice_runs;
create trigger trg_invoice_runs_portal_overlap
  before insert or update of period_start, period_end, archived_at, status, source, vendor_id
  on public.invoice_runs
  for each row execute function public.invoice_runs_portal_overlap_guard();

-- ─── 3. Lines: vendor detail + clean claim ──────────────────────────────────

alter table public.invoice_lines
  add column if not exists vendor_category text,
  add column if not exists vendor_detail jsonb,
  add column if not exists receipt_path text,
  add column if not exists clean_claim_key text;

alter table public.invoice_lines drop constraint if exists invoice_lines_vendor_category_check;
alter table public.invoice_lines add constraint invoice_lines_vendor_category_check
  check (vendor_category is null or vendor_category = any (array[
    'clean', 'missing_clean', 'extra', 'reimbursement', 'inspection', 'labor'
  ]));

create unique index if not exists invoice_lines_clean_claim_key
  on public.invoice_lines (clean_claim_key) where clean_claim_key is not null;

-- The claim key is derived, never written by callers: property|service date
-- for an active clean row on an active vendor-portal run, else NULL.
create or replace function public.invoice_lines_set_clean_claim()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r record;
  d date;
begin
  new.clean_claim_key := null;
  select source, status, archived_at into r from public.invoice_runs where id = new.run_id;
  if r.source is distinct from 'vendor_portal' or r.archived_at is not null or r.status = 'void' then
    return new;
  end if;
  d := coalesce(new.service_date, new.raw_date_mentioned);
  if new.line_kind in ('clean', 'deep_clean', 'combined_split')
     and new.review_status <> 'excluded'
     and new.property_id is not null
     and d is not null then
    new.clean_claim_key := new.property_id::text || '|' || d::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoice_lines_clean_claim on public.invoice_lines;
create trigger trg_invoice_lines_clean_claim
  before insert or update on public.invoice_lines
  for each row execute function public.invoice_lines_set_clean_claim();

-- Archiving / voiding a run releases its claims (and un-archiving re-claims,
-- failing loudly if the days were invoiced elsewhere in the meantime).
create or replace function public.invoice_runs_refresh_claims()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source = 'vendor_portal'
     and (new.archived_at is distinct from old.archived_at or new.status is distinct from old.status) then
    update public.invoice_lines set clean_claim_key = clean_claim_key where run_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoice_runs_refresh_claims on public.invoice_runs;
create trigger trg_invoice_runs_refresh_claims
  after update of archived_at, status on public.invoice_runs
  for each row execute function public.invoice_runs_refresh_claims();

-- ─── 4. View grant ──────────────────────────────────────────────────────────
-- New view id `vendor-invoicing` (Operations → Invoicing). Admin always (repo
-- rule: every new page is granted to admin); supervisors (Busy Bee's leads)
-- get view + edit. The API additionally requires a vendor_users row, so a
-- supervisor who is not linked to a vendor sees an explanation, not data.
update public.app_settings s
set value = (
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          v.j,
          '{admin,views}',
          (v.j -> 'admin' -> 'views') || case when (v.j -> 'admin' -> 'views') ? 'vendor-invoicing' then '[]'::jsonb else '["vendor-invoicing"]'::jsonb end,
          true),
        '{admin,permissions,vendor-invoicing}', '{"view": true, "edit": true}'::jsonb, true),
      '{supervisor,views}',
      coalesce(v.j -> 'supervisor' -> 'views', '[]'::jsonb) || case when (v.j -> 'supervisor' -> 'views') ? 'vendor-invoicing' then '[]'::jsonb else '["vendor-invoicing"]'::jsonb end,
      true),
    '{supervisor,permissions,vendor-invoicing}', '{"view": true, "edit": true}'::jsonb, true)
)::text
from (select key, value::jsonb as j from public.app_settings where key = 'role_permissions') v
where s.key = v.key and v.j ? 'supervisor';

-- ─── 5. Draft summary ───────────────────────────────────────────────────────
-- What the last task pull found but did NOT bill (property-days already on
-- another invoice, tasks on properties Ops doesn't know), shown to the vendor
-- so a missing clean is never a mystery.
alter table public.invoice_runs add column if not exists vendor_draft_meta jsonb;
