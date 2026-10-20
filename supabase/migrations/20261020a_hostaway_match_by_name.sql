-- Hostaway listing matching: name first, address only when unambiguous.
--
-- Problem (Jordan, 2026-10-20): the API Sync -> Hostaway tab listed 43 Haven
-- properties as "Expected in Hostaway" with no listing, but every one of them
-- has a Hostaway listing. The sync is healthy (497 listings); the matcher was
-- the bug. hostaway_reconciliation only matched on normalized street address
-- and gave each listing to the LOWEST property id at that address, so:
--   * condo units that share a building address (326 Shooting Star Loop,
--     1260 Ski View Dr, 513 McCarter Rd, 410 Big Bear Way ...) lost to
--     whichever unit had the lowest id, and many listings were attached to the
--     wrong unit (all six 1260 Ski View listings went to property 31);
--   * the same address written differently on each side ("Rdg Wy" vs "Ridge
--     Way", "East Pkwy" vs "E Pkwy", "Geneva Ln" vs "Geneva Dr", "Spg Creek")
--     or with the city glued onto the street ("621 Olde Carriage Way,
--     Gatlinburg" vs "...Way Gatlinburg, TN") never matched;
--   * Ops address typos ("91 TN-32" for 191) never matched.
-- Haven names every listing "<owner> <house number>[-unit] (<area>)", the same
-- convention Ops uses for property names, so the name is the reliable key.
--
-- New order (first hit wins; a tie at a step is "ambiguous" and falls through):
--   1. manual   hostaway_listing_snapshot.matched_property_id (unchanged)
--   2. name     listing internal name == Ops property name or property_aliases
--               alias, ignoring case, dash variants, spacing and the trailing
--               "(SCounty)" area tag
--   3. name     the listing carries a unit the Ops name lacks
--               ("Eric Fleming 1260-6203" -> "Eric Fleming 1260")
--   4. name     the Ops name carries a unit the listing lacks
--               ("Amanda Dolce-McCormack 191-32" -> "...191"), only when that
--               shorter listing name is unique
--   5. address  normalized street, only when exactly ONE live property has that
--               address and no other listing claimed it by name
-- Steps 3 and 4 only apply when the full Ops name has no exact listing, and
-- never when more than one listing/property would share the result.
--
-- Mirrored by matchListingsToProperties() in shared/hostaway-match.ts (tested).
-- KEEP IN SYNC.

create or replace function public.hostaway_name_key(p text)
returns text
language sql immutable
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(p, '')), '[‐-―]', '-', 'g'),
        '\s*\([^)]*\)\s*$', ''),
      '\s+', ' ', 'g'))
$$;

create or replace view public.hostaway_reconciliation
with (security_invoker = true) as
with lk as (
  select h.hostaway_id,
         public.hostaway_name_key(h.internal_name) as nk,
         regexp_replace(public.hostaway_name_key(h.internal_name), '(\d)-\d+$', '\1') as nk_base
  from public.hostaway_listing_snapshot h
),
lk_count as (
  select nk, count(*) as c from lk where nk <> '' group by nk
),
pk as (
  select p.id, (p.archived_at is not null) as archived, public.hostaway_name_key(p.name) as k
  from public.properties p
  union all
  select a.property_id, (p.archived_at is not null), public.hostaway_name_key(a.alias)
  from public.property_aliases a
  join public.properties p on p.id = a.property_id
),
-- name key -> the single property that owns it (live properties win over
-- archived duplicates; two live owners of one name is ambiguous -> null)
pk_one as (
  select k,
    case
      when count(distinct id) filter (where not archived) = 1 then min(id) filter (where not archived)
      when count(distinct id) filter (where not archived) = 0 and count(distinct id) = 1 then min(id)
    end as pid
  from pk
  where k <> ''
  group by k
),
cand as (
  -- 2. exact name
  select l.hostaway_id, o.pid, 2 as prio
  from lk l
  join pk_one o on o.k = l.nk and o.pid is not null
  union all
  -- 3. the listing carries a unit the Ops name lacks
  select x.hostaway_id, x.pid, 3
  from (
    select l.hostaway_id, o.pid,
           count(*) over (partition by o.pid) as per_property
    from lk l
    join pk_one o on o.k = l.nk_base and o.pid is not null
    where l.nk_base <> l.nk
      and not exists (select 1 from lk_count c where c.nk = o.k)
  ) x
  where x.per_property = 1
  union all
  -- 4. the Ops name carries a unit the listing lacks (listing name unique)
  select l.hostaway_id, o.pid, 4
  from pk_one o
  join lk l on l.nk = regexp_replace(o.k, '(\d)-\d+$', '\1')
  join lk_count c on c.nk = l.nk and c.c = 1
  where o.pid is not null
    and regexp_replace(o.k, '(\d)-\d+$', '\1') <> o.k
    and not exists (select 1 from lk_count c2 where c2.nk = o.k)
),
best as (
  select hostaway_id, min(prio) as prio from cand group by hostaway_id
),
name_pick as (
  select c.hostaway_id, min(c.pid) as pid
  from cand c
  join best b on b.hostaway_id = c.hostaway_id and b.prio = c.prio
  group by c.hostaway_id
  having count(distinct c.pid) = 1
),
-- address fallback: only an unambiguous street address, and never a property
-- another listing already claimed by name
addr as (
  select h.hostaway_id,
    case
      when count(p.id) filter (where p.archived_at is null) = 1 then min(p.id) filter (where p.archived_at is null)
      when count(p.id) filter (where p.archived_at is null) = 0 and count(p.id) = 1 then min(p.id)
    end as pid
  from public.hostaway_listing_snapshot h
  join public.properties p on h.address_norm <> '' and p.address_norm = h.address_norm
  group by h.hostaway_id
),
matched as (
  select h.*,
    coalesce(h.matched_property_id, np.pid, ad.pid) as property_id,
    case
      when h.matched_property_id is not null then 'manual'
      when np.pid is not null then 'name'
      when ad.pid is not null then 'address'
    end as match_method
  from public.hostaway_listing_snapshot h
  left join name_pick np on np.hostaway_id = h.hostaway_id
  left join lateral (
    select a.pid
    from addr a
    where a.hostaway_id = h.hostaway_id
      and a.pid is not null
      and not exists (select 1 from name_pick n2 where n2.pid = a.pid and n2.hostaway_id <> h.hostaway_id)
  ) ad on true
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
