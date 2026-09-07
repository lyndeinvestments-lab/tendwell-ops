-- Property aliases: one Ops property can be known by other names and by more
-- than one Trellis property record.
--
-- Why (2026-09-07, Jordan): "The Stillwood House" in Trellis is Farrah Dalal
-- 1559 in Ops; "Senthilkumar Davudkadirkamasundram 3725 (PF)" is a Trellis
-- duplicate of the record that actually carries his tasks; "Cristina Turcan
-- 8540 (BC)" is Antonio Michaelis 8540 after an ownership change. Each showed
-- up under "In Trellis, not in Ops" and, worse, invoicing/financials attribute
-- Trellis cleans by properties.trellis_id, so cleans logged against the alias
-- record were silently dropped.
--
-- Design: instead of teaching nine views about aliases, canonicalize at the
-- source. A BEFORE trigger on trellis_task_snapshot rewrites an aliased
-- trellis_property_id to the Ops property's primary trellis_id as tasks are
-- synced, so every existing join (invoice generation, property_monthly_cleans,
-- owner portal task feed, auto-stage) keeps working unchanged. Name aliases
-- mirror into vendor_property_aliases (vendor_id NULL = any vendor) so vendor
-- CSV lines naming the alias resolve too.

create table if not exists public.property_aliases (
  id          uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties(id) on delete cascade,
  alias       text   not null,
  trellis_id  uuid,                 -- an alternate Trellis property record, if any
  note        text,
  created_by  text,
  created_at  timestamptz default now()
);

create unique index if not exists idx_property_aliases_alias
  on public.property_aliases (lower(btrim(alias)));
create unique index if not exists idx_property_aliases_trellis
  on public.property_aliases (trellis_id) where trellis_id is not null;
create index if not exists idx_property_aliases_property
  on public.property_aliases (property_id);

alter table public.property_aliases enable row level security;
drop policy if exists "property_aliases_all_staff" on public.property_aliases;
create policy "property_aliases_all_staff"
  on public.property_aliases for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── Canonical Trellis id for a (possibly aliased) Trellis property id ────────
-- properties.trellis_id is TEXT; only trust it when it parses as a uuid.
create or replace function public.canonical_trellis_property_id(p uuid)
returns uuid language sql stable as $$
  select coalesce(
    (select pr.trellis_id::uuid
       from public.property_aliases a
       join public.properties pr on pr.id = a.property_id
      where a.trellis_id = p
        and pr.trellis_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      limit 1),
    p)
$$;

-- ── Rewrite aliased task rows to the canonical record on every sync write ───
create or replace function public.trellis_task_snapshot_canonicalize()
returns trigger language plpgsql as $$
begin
  if new.trellis_property_id is not null then
    new.trellis_property_id := public.canonical_trellis_property_id(new.trellis_property_id);
  end if;
  return new;
end
$$;

drop trigger if exists trg_trellis_task_canonicalize on public.trellis_task_snapshot;
create trigger trg_trellis_task_canonicalize
  before insert or update of trellis_property_id on public.trellis_task_snapshot
  for each row execute function public.trellis_task_snapshot_canonicalize();

-- ── Mirror name aliases into the vendor-invoice alias map ───────────────────
create or replace function public.property_aliases_mirror_vendor()
returns trigger language plpgsql as $$
begin
  insert into public.vendor_property_aliases (vendor_id, alias_raw, property_id, confidence, confirmed_by)
  values (null, btrim(new.alias), new.property_id, null, coalesce(new.created_by, 'property_aliases'))
  on conflict do nothing;
  return new;
end
$$;

drop trigger if exists trg_property_aliases_mirror_vendor on public.property_aliases;
create trigger trg_property_aliases_mirror_vendor
  after insert on public.property_aliases
  for each row execute function public.property_aliases_mirror_vendor();

-- ── Exceptions: skip aliased records and same-name duplicates ───────────────
-- Keeps the 20260628 shape (security_invoker off + admin guard). Two new
-- exclusions: (1) the Trellis id is a known alias; (2) an Ops property with
-- the same normalized name exists even if it is already linked to a different
-- Trellis record (the "3725" vs "3725 (PF)" case).
create or replace view public.trellis_exceptions as
select
  e.trellis_id,
  e.name,
  e.workspace,
  e.status,
  e.tendwell_task_count
from trellis_property_enriched e
where current_user_role() = 'admin'
  and e.is_tendwell_property
  and not exists (
    select 1 from properties pr
    where pr.trellis_id = e.trellis_id::text
  )
  and not exists (
    select 1 from property_aliases a
    where a.trellis_id = e.trellis_id
  )
  and not exists (
    select 1 from properties pr
    where pr.deleted_at is null
      and tendwell_normalize_name(pr.name) = tendwell_normalize_name(e.name)
  )
  and not exists (
    select 1 from property_aliases a
    where tendwell_normalize_name(a.alias) = tendwell_normalize_name(e.name)
  );

alter view public.trellis_exceptions set (security_invoker = off);

-- ── Backfill: any tasks already sitting on an aliased record ────────────────
-- (No-op until alias rows exist; safe to re-run.)
update public.trellis_task_snapshot t
   set trellis_property_id = public.canonical_trellis_property_id(t.trellis_property_id)
 where t.trellis_property_id in (select trellis_id from public.property_aliases where trellis_id is not null);
