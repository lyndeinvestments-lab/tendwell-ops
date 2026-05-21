// Linen par-level calculator. Derives the target towel/mat counts for a
// property from its guest count (or bed configuration as fallback).
// Haven's internal rules (2026-05-21):
//
//   sleep_count   = guest_count when set, else king×2 + queen×2 + full×2 + twin×1
//   hand_towels   = sleep_count
//   washcloths    = sleep_count
//   bath_towels   = sleep_count + full_baths
//   bathmats      = full_baths
//   pool_towels   = sleep_count when property has a hot tub or pool, else 0
//
// Sleep count and guest count are the same number — if the property stores a
// guest_count, that always wins. The bed-based formula is only a fallback for
// properties that haven't filled in the Guests column yet.

export interface LinenInputs {
  guest_count?: number | string | null
  king_beds?: number | string | null
  queen_beds?: number | string | null
  full_beds?: number | string | null
  twin_beds?: number | string | null
  sofa_beds?: number | string | null   // optional — counted as queen
  full_baths?: number | string | null
  hot_tub?: boolean | null
  has_pool?: boolean | null            // optional — treat same as hot tub
}

export interface LinenCounts {
  bath_towels: number
  hand_towels: number
  washcloths: number
  bathmats: number
  pool_towels: number
}

function n(v: number | string | null | undefined): number {
  const x = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(x as number) ? (x as number) : 0
}

export function sleepCount(p: LinenInputs): number {
  const guest = n(p.guest_count)
  if (guest > 0) return guest
  const king = n(p.king_beds)
  const queen = n(p.queen_beds) + n(p.sofa_beds)   // sofas count as queen
  const full = n(p.full_beds)
  const twin = n(p.twin_beds)
  return king * 2 + queen * 2 + full * 2 + twin * 1
}

export function calculateLinens(p: LinenInputs): LinenCounts {
  const sleep = sleepCount(p)
  const fullBaths = n(p.full_baths)
  const hasWater = Boolean(p.hot_tub) || Boolean(p.has_pool)
  return {
    hand_towels: sleep,
    washcloths: sleep,
    bath_towels: sleep + fullBaths,
    bathmats: fullBaths,
    pool_towels: hasWater ? sleep : 0,
  }
}
