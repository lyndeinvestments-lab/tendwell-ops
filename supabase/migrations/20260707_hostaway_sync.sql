-- Hostaway listing sync & verification.
-- The nightly/on-demand sync (service role) snapshots Hostaway listings into
-- hostaway_listing_snapshot; all matching + field-diff logic lives in the
-- hostaway_reconciliation view so the sync stays a dumb ingest (same pattern
-- as the Trellis sync). Surfaced on the admin /trellis-sync page (Hostaway tab).

-- ── Snapshot tables ─────────────────────────────────────────────────────────
create table if not exists public.hostaway_listing_snapshot (
  hostaway_id         bigint primary key,
  name                text,
  internal_name       text,
  address             text,
  city                text,
  state               text,
  zipcode             text,
  bedrooms            numeric,
  bathrooms           numeric,
  beds                numeric,
  person_capacity     integer,
  raw                 jsonb,
  -- Admin-set manual match; overrides the address-based auto-match in the view.
  matched_property_id bigint references public.properties(id) on delete set null,
  synced_at           timestamptz not null default now()
);
create index if not exists hostaway_snapshot_match_idx
  on public.hostaway_listing_snapshot(matched_property_id);

create table if not exists public.hostaway_sync_log (
  id           uuid primary key default gen_random_uuid(),
  status       text not null check (status in ('requested','running','done','error')),
  trigger      text not null default 'manual' check (trigger in ('manual','nightly')),
  requested_by text,
  started_at   timestamptz,
  finished_at  timestamptz,
  counts       jsonb,
  error        text,
  created_at   timestamptz not null default now()
);
create index if not exists hostaway_sync_log_status_idx on public.hostaway_sync_log(status);

-- ── Street normalization for address matching ───────────────────────────────
-- Takes the street segment (before the first comma), lowercases, strips
-- punctuation/units, and canonicalizes common suffix words so
-- "1115 Old Cartertown Road" matches "1115 Old Cartertown Rd".
create or replace function public.tendwell_normalize_street(p text)
returns text
language plpgsql immutable as $$
declare s text;
begin
  s := lower(coalesce(p, ''));
  s := split_part(s, ',', 1);
  s := regexp_replace(s, '[^a-z0-9 ]', ' ', 'g');
  -- drop unit designators ("unit 2", "apt 6203", "lot 49", "ste 4", "c303")
  s := regexp_replace(s, '\m(unit|apt|apartment|lot|suite|ste)\M\s*[a-z0-9]+', ' ', 'g');
  s := regexp_replace(s, '\m[a-z][0-9]{2,4}\M', ' ', 'g');
  -- canonicalize suffixes
  s := regexp_replace(s, '\mdrive\M', 'dr', 'g');
  s := regexp_replace(s, '\mlane\M', 'ln', 'g');
  s := regexp_replace(s, '\mroad\M', 'rd', 'g');
  s := regexp_replace(s, '\mcourt\M', 'ct', 'g');
  s := regexp_replace(s, '\mcircle\M', 'cir', 'g');
  s := regexp_replace(s, '\mtrail\M', 'trl', 'g');
  s := regexp_replace(s, '\mwy\M', 'way', 'g');
  s := regexp_replace(s, '\mstreet\M', 'st', 'g');
  s := regexp_replace(s, '\mboulevard\M', 'blvd', 'g');
  s := regexp_replace(s, '\mhighway\M', 'hwy', 'g');
  s := regexp_replace(s, '\mplace\M', 'pl', 'g');
  s := regexp_replace(s, '\mavenue\M', 'ave', 'g');
  s := regexp_replace(s, '\m(terrace|ter)\M', 'trce', 'g');
  s := regexp_replace(s, '\mparkway\M', 'pkwy', 'g');
  s := regexp_replace(s, '\s+', ' ', 'g');
  s := trim(s);
  -- drop a trailing bare number left over from "#4205"-style units
  s := regexp_replace(s, '^([0-9]+ .*[a-z])\s[0-9]+$', '\1');
  return s;
end $$;

-- ── Reconciliation view ─────────────────────────────────────────────────────
-- One row per Hostaway listing: the matched Ops property (manual match wins,
-- else normalized-address equality) plus per-field mismatch flags. A flag is
-- true only when BOTH sides have a value and they differ — missing data on
-- either side is not a mismatch.
create or replace view public.hostaway_reconciliation
with (security_invoker = true) as
with matched as (
  select h.*,
    coalesce(h.matched_property_id, am.pid) as property_id,
    case
      when h.matched_property_id is not null then 'manual'
      when am.pid is not null then 'address'
    end as match_method
  from public.hostaway_listing_snapshot h
  left join lateral (
    select p.id as pid
    from public.properties p
    where public.tendwell_normalize_street(h.address) <> ''
      and public.tendwell_normalize_street(p.address) = public.tendwell_normalize_street(h.address)
    order by p.id
    limit 1
  ) am on true
)
select
  m.hostaway_id,
  m.name           as hostaway_name,
  m.internal_name,
  m.property_id,
  p.name           as property_name,
  m.address        as hostaway_address,
  p.address        as ops_address,
  m.bedrooms       as ha_bedrooms,
  p.bedrooms       as ops_bedrooms,
  m.bathrooms      as ha_bathrooms,
  p.full_baths     as ops_full_baths,
  p.half_baths     as ops_half_baths,
  m.beds           as ha_beds,
  p.number_of_beds as ops_beds,
  m.person_capacity as ha_guests,
  p.guest_count    as ops_guests,
  m.match_method,
  m.synced_at,
  (m.property_id is not null and m.bedrooms is not null and p.bedrooms is not null
    and m.bedrooms <> p.bedrooms) as bedrooms_mismatch,
  (m.property_id is not null and m.bathrooms is not null
    and (p.full_baths is not null or p.half_baths is not null)
    and m.bathrooms <> (coalesce(p.full_baths, 0) + 0.5 * coalesce(p.half_baths, 0))) as bathrooms_mismatch,
  (m.property_id is not null and m.beds is not null and p.number_of_beds is not null
    and m.beds <> p.number_of_beds) as beds_mismatch,
  (m.property_id is not null and m.person_capacity is not null and p.guest_count is not null
    and m.person_capacity <> p.guest_count) as guests_mismatch,
  (m.property_id is not null
    and public.tendwell_normalize_street(m.address) <> ''
    and public.tendwell_normalize_street(coalesce(p.address, '')) <> public.tendwell_normalize_street(m.address)) as address_mismatch
from matched m
left join public.properties p on p.id = m.property_id;

-- ── RLS: admin-only, like the Trellis snapshot tables ───────────────────────
alter table public.hostaway_listing_snapshot enable row level security;
alter table public.hostaway_sync_log         enable row level security;

drop policy if exists hostaway_snapshot_admin_read on public.hostaway_listing_snapshot;
create policy hostaway_snapshot_admin_read on public.hostaway_listing_snapshot
  for select to authenticated using (public.current_user_role() = 'admin');

-- Admins can set/clear the manual property match from the UI.
drop policy if exists hostaway_snapshot_admin_update on public.hostaway_listing_snapshot;
create policy hostaway_snapshot_admin_update on public.hostaway_listing_snapshot
  for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists hostaway_sync_log_admin_read on public.hostaway_sync_log;
create policy hostaway_sync_log_admin_read on public.hostaway_sync_log
  for select to authenticated using (public.current_user_role() = 'admin');
