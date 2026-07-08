-- Fix: hostaway_reconciliation timed out under the API role's 8s statement
-- timeout. The view normalized every address with a 20-regex plpgsql function
-- inside a 446×308 lateral join (~270k function calls per query). Precompute
-- the normalized street as stored generated columns on both tables, index
-- them, and join on the columns instead (63ms after, 8s+ timeout before).

alter table public.hostaway_listing_snapshot
  add column if not exists address_norm text
  generated always as (public.tendwell_normalize_street(address)) stored;

alter table public.properties
  add column if not exists address_norm text
  generated always as (public.tendwell_normalize_street(address)) stored;

create index if not exists hostaway_snapshot_address_norm_idx
  on public.hostaway_listing_snapshot(address_norm);
create index if not exists properties_address_norm_idx
  on public.properties(address_norm);

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
    where h.address_norm <> ''
      and p.address_norm = h.address_norm
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
    and m.address_norm <> ''
    and coalesce(p.address_norm, '') <> m.address_norm) as address_mismatch
from matched m
left join public.properties p on p.id = m.property_id;
