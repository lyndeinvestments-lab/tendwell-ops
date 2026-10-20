// Hostaway listing -> Ops property matching.
//
// TypeScript mirror of the `hostaway_reconciliation` view
// (supabase/migrations/20261020a_hostaway_match_by_name.sql). The view is what
// the app reads; this module is the unit-tested statement of its rules, so a
// change to one must change the other. KEEP IN SYNC.
//
// Why name first: Haven names every Hostaway listing "<owner> <house
// number>[-unit] (<area>)", the same convention Ops uses for property names.
// Matching on street address alone gave each listing to the lowest property id
// at that address (condo units lost), and missed any address spelled
// differently on each side ("Rdg Wy" vs "Ridge Way", "East Pkwy" vs "E Pkwy").
//
// Order (first hit wins; a tie at a step is ambiguous and falls through):
//   1. manual   matched_property_id set by an admin
//   2. name     listing internal name == Ops name or alias
//   3. name     the listing carries a unit the Ops name lacks
//   4. name     the Ops name carries a unit the listing lacks (listing unique)
//   5. address  normalized street, only when exactly one live property has it
//               and no other listing claimed that property by name
//
// Dependency-free: safe for the client bundle and serverless functions.

export type HostawayMatchMethod = 'manual' | 'name' | 'address'

export interface HostawayListingInput {
  hostaway_id: number
  internal_name: string | null
  address_norm?: string | null
  matched_property_id?: number | null
}

export interface HostawayPropertyInput {
  id: number
  name: string | null
  address_norm?: string | null
  archived?: boolean
}

export interface HostawayAliasInput {
  property_id: number
  alias: string | null
}

export interface HostawayMatch {
  property_id: number
  method: HostawayMatchMethod
}

/** Matching key for a Hostaway internal listing name or an Ops property name:
 *  lower case, dash variants unified, a trailing area tag such as "(SCounty)"
 *  dropped, whitespace collapsed. Mirrors SQL `hostaway_name_key()`. */
export function hostawayNameKey(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "...1619-14" -> "...1619": drop a trailing "-<digits>" unit after a digit. */
function baseKey(k: string): string {
  return k.replace(/(\d)-\d+$/, '$1')
}

/** name key -> the single property that owns it: a live property wins over
 *  archived duplicates; two live owners of one name is ambiguous (no entry). */
function ownerByKey(
  properties: ReadonlyArray<HostawayPropertyInput>,
  aliases: ReadonlyArray<HostawayAliasInput>,
): Map<string, number> {
  const archivedById = new Map(properties.map((p) => [p.id, !!p.archived]))
  const byKey = new Map<string, Set<number>>()
  const add = (k: string, id: number) => {
    if (!k) return
    const s = byKey.get(k)
    if (s) s.add(id)
    else byKey.set(k, new Set([id]))
  }
  for (const p of properties) add(hostawayNameKey(p.name), p.id)
  for (const a of aliases) {
    if (archivedById.has(a.property_id)) add(hostawayNameKey(a.alias), a.property_id)
  }
  const out = new Map<string, number>()
  for (const [k, idSet] of Array.from(byKey.entries())) {
    const ids = Array.from(idSet)
    const live = ids.filter((id) => !archivedById.get(id))
    if (live.length === 1) out.set(k, live[0])
    else if (live.length === 0 && ids.length === 1) out.set(k, ids[0])
  }
  return out
}

export function matchListingsToProperties(
  listings: ReadonlyArray<HostawayListingInput>,
  properties: ReadonlyArray<HostawayPropertyInput>,
  aliases: ReadonlyArray<HostawayAliasInput> = [],
): Map<number, HostawayMatch> {
  const result = new Map<number, HostawayMatch>()

  const nk = new Map<number, string>()
  const listingCount = new Map<string, number>()
  for (const l of listings) {
    const k = hostawayNameKey(l.internal_name)
    nk.set(l.hostaway_id, k)
    if (k) listingCount.set(k, (listingCount.get(k) ?? 0) + 1)
  }
  const owner = ownerByKey(properties, aliases)

  const cand = new Map<number, Array<{ pid: number; prio: number }>>()
  const push = (listingId: number, pid: number, prio: number) => {
    const arr = cand.get(listingId)
    if (arr) arr.push({ pid, prio })
    else cand.set(listingId, [{ pid, prio }])
  }

  // 2. exact name
  for (const l of listings) {
    const pid = owner.get(nk.get(l.hostaway_id) ?? '')
    if (pid != null) push(l.hostaway_id, pid, 2)
  }

  // 3. the listing carries a unit the Ops name lacks. One listing per property,
  //    and only when the Ops name has no exact listing of its own.
  const step3 = new Map<number, number[]>() // pid -> listing ids
  for (const l of listings) {
    const k = nk.get(l.hostaway_id) ?? ''
    const b = baseKey(k)
    if (!k || b === k) continue
    const pid = owner.get(b)
    if (pid == null || listingCount.has(b)) continue
    const arr = step3.get(pid)
    if (arr) arr.push(l.hostaway_id)
    else step3.set(pid, [l.hostaway_id])
  }
  for (const [pid, ids] of Array.from(step3.entries())) if (ids.length === 1) push(ids[0], pid, 3)

  // 4. the Ops name carries a unit the listing lacks; the shorter listing name
  //    must be unique, and the full Ops name must have no exact listing.
  const listingByKey = new Map<string, number>()
  for (const l of listings) {
    const k = nk.get(l.hostaway_id) ?? ''
    if (k) listingByKey.set(k, l.hostaway_id)
  }
  for (const [k, pid] of Array.from(owner.entries())) {
    const b = baseKey(k)
    if (b === k || listingCount.has(k)) continue
    if (listingCount.get(b) === 1) push(listingByKey.get(b)!, pid, 4)
  }

  // best step per listing; the property at that step must be unique
  const nameWinner = new Map<number, number>()
  for (const [listingId, arr] of Array.from(cand.entries())) {
    const best = Math.min(...arr.map((c) => c.prio))
    const pids = Array.from(new Set(arr.filter((c) => c.prio === best).map((c) => c.pid)))
    if (pids.length === 1) nameWinner.set(listingId, pids[0])
  }

  // address fallback inputs
  const byAddress = new Map<string, HostawayPropertyInput[]>()
  for (const p of properties) {
    const a = p.address_norm ?? ''
    if (!a) continue
    const arr = byAddress.get(a)
    if (arr) arr.push(p)
    else byAddress.set(a, [p])
  }
  const claimedByName = new Map<number, number>() // property id -> claiming listing
  nameWinner.forEach((pid, listingId) => claimedByName.set(pid, listingId))

  for (const l of listings) {
    if (l.matched_property_id != null) {
      result.set(l.hostaway_id, { property_id: l.matched_property_id, method: 'manual' })
      continue
    }
    const byName = nameWinner.get(l.hostaway_id)
    if (byName != null) {
      result.set(l.hostaway_id, { property_id: byName, method: 'name' })
      continue
    }
    const addr = l.address_norm ?? ''
    const props = addr ? byAddress.get(addr) ?? [] : []
    const live = props.filter((p) => !p.archived)
    const pick = live.length === 1 ? live[0] : live.length === 0 && props.length === 1 ? props[0] : null
    if (!pick) continue
    const claimer = claimedByName.get(pick.id)
    if (claimer != null && claimer !== l.hostaway_id) continue
    result.set(l.hostaway_id, { property_id: pick.id, method: 'address' })
  }
  return result
}

/** Properties that no Hostaway listing matched. */
export function propertiesWithoutListing<P extends { id: number }>(
  properties: ReadonlyArray<P>,
  matches: ReadonlyMap<number, HostawayMatch>,
): P[] {
  const have = new Set(Array.from(matches.values()).map((m) => m.property_id))
  return properties.filter((p) => !have.has(p.id))
}
