// Linen pricing — one-time onboarding fee and the recurring program cost.
//
// Source: Dzee Textiles contracted + bulk pricing, order #000029074 (June 2026).
// All unit costs below are COST, not fee. Markup is applied separately via
// `linen_markup_pct` so the quoted fee can carry margin without re-deriving
// the cost table. All values are read from app_settings, same as amenity-costs.
//
// A "set" of bed linens = fitted + flat + top sheet + pillowcases + that bed's
// towels (triple-sheeted, so no duvet cover). The default onboarding par level
// is 3 sets: one on the bed, one in the wash, one on the shelf.
//
// Two things deliberately do NOT scale with the sets stepper, because they are
// already whole-property quantities rather than per-set ones:
//   - duvet inserts: 2 per bed, full stop
//   - pool towels:   3 per guest, priced as one per-guest figure
//
// Rounding note: the source doc rounds its per-set and 3-set columns
// independently, so they disagree by a cent or two (full bath: 15.13 x 3 =
// 45.39, the doc's 3-set column says 45.38). Per-set is treated as
// authoritative here, so totals can differ from that table by a few cents.

export interface LinenCosts {
  /** Per-set bed linen cost, by bed size. Full beds use queen bedding. */
  setKing: number
  setQueen: number
  setTwin: number
  /** Per-set bathroom linen cost, by bathroom type. */
  setFullBath: number
  setHalfBath: number
  /** Duvet inserts, 2 per bed. Not affected by par level. */
  duvetKing: number
  duvetQueen: number
  duvetTwin: number
  /** Pool towels, 3 per guest, priced per guest. */
  poolTowelPerGuest: number
  /** Markup applied to the onboarding subtotal, as a percentage. */
  markupPct: number
  /** Replacement sets per bed per year, for the recurring program cost. */
  recurringSetsPerYear: number
  /** Per-set cost for beds with no size breakdown recorded. */
  blendedPerSet: number
}

export const DEFAULT_LINEN_COSTS: LinenCosts = {
  setKing: 48.02,
  setQueen: 43.59,
  setTwin: 29.21,
  setFullBath: 15.13,
  setHalfBath: 2.32,
  duvetKing: 42.6,
  duvetQueen: 40.82,
  duvetTwin: 31.52,
  poolTowelPerGuest: 11.8,
  markupPct: 0,
  recurringSetsPerYear: 2,
  // Portfolio-weighted average across the 148 beds in the Hostimo reference
  // set (67 king, 36 queen, 5 full, 40 twin).
  blendedPerSet: 41.71,
}

// Setting keys in app_settings.
export const LINEN_SETTINGS_KEYS = {
  setKing: 'linen_set_king',
  setQueen: 'linen_set_queen',
  setTwin: 'linen_set_twin',
  setFullBath: 'linen_set_full_bath',
  setHalfBath: 'linen_set_half_bath',
  duvetKing: 'linen_duvet_king',
  duvetQueen: 'linen_duvet_queen',
  duvetTwin: 'linen_duvet_twin',
  poolTowelPerGuest: 'linen_pool_towel_guest',
  markupPct: 'linen_markup_pct',
  recurringSetsPerYear: 'linen_recur_sets_year',
  blendedPerSet: 'linen_blended_per_set',
} as const

/** The default onboarding par level: on the bed, in the wash, on the shelf. */
export const DEFAULT_LINEN_SETS = 3

/** Cleans per year the recurring cost is spread across: 12 months x 4 cleans. */
const CLEANS_PER_YEAR = 12 * 4

export interface LinenProperty {
  guest_count?: number | string | null
  king_beds?: number | string | null
  queen_beds?: number | string | null
  full_beds?: number | string | null
  twin_beds?: number | string | null
  number_of_beds?: number | string | null
  full_baths?: number | string | null
  half_baths?: number | string | null
  hot_tub?: boolean | null
  pool?: boolean | null
}

export interface LinenOnboardingOptions {
  /** Par level. Defaults to 3. Clamped to at least 1. */
  sets?: number | string | null
  /** Include duvet inserts at 2 per bed. */
  comforters?: boolean
  /** Override the configured markup percentage. */
  markupPct?: number | string | null
}

export interface LinenOnboardingBreakdown {
  beds: number
  baths: number
  comforters: number
  poolTowels: number
  subtotal: number
  markup: number
  total: number
}

/** Coerce to a non-negative finite number; anything else counts as zero. */
function n(v: number | string | null | undefined): number {
  const x = typeof v === 'string' ? parseFloat(v) : v
  if (!Number.isFinite(x as number)) return 0
  return (x as number) > 0 ? (x as number) : 0
}

/** Guests the property sleeps. Falls back to the bed mix when unset. */
export function linenSleepCount(p: LinenProperty): number {
  const guests = n(p.guest_count)
  if (guests > 0) return guests
  return n(p.king_beds) * 2 + n(p.queen_beds) * 2 + n(p.full_beds) * 2 + n(p.twin_beds)
}

/** Beds with a recorded size. Full beds are priced as queen. */
function sizedBeds(p: LinenProperty) {
  const king = n(p.king_beds)
  const queen = n(p.queen_beds) + n(p.full_beds)
  const twin = n(p.twin_beds)
  return { king, queen, twin, total: king + queen + twin }
}

/**
 * One-time cost to stock a property at onboarding.
 * Beds and bathrooms scale with `sets`; duvets and pool towels do not.
 */
export function calcLinenOnboarding(
  costs: LinenCosts,
  property: LinenProperty,
  opts: LinenOnboardingOptions = {}
): LinenOnboardingBreakdown {
  // A blank/absent value means "use the default par level"; an explicit number
  // that is too low clamps to 1, so a stepper at 0 never zeroes out the quote.
  const sets =
    opts.sets == null || opts.sets === '' ? DEFAULT_LINEN_SETS : Math.max(1, n(opts.sets))
  const { king, queen, twin } = sizedBeds(property)

  const beds = sets * (king * costs.setKing + queen * costs.setQueen + twin * costs.setTwin)
  const baths =
    sets * (n(property.full_baths) * costs.setFullBath + n(property.half_baths) * costs.setHalfBath)

  const comforters = opts.comforters
    ? king * costs.duvetKing + queen * costs.duvetQueen + twin * costs.duvetTwin
    : 0

  // One kind of water towel: a hot tub and a pool get the same stock, never both.
  const hasWater = Boolean(property.hot_tub) || Boolean(property.pool)
  const poolTowels = hasWater ? linenSleepCount(property) * costs.poolTowelPerGuest : 0

  const subtotal = beds + baths + comforters + poolTowels
  const pct = opts.markupPct == null ? costs.markupPct : n(opts.markupPct)
  const markup = subtotal * (pct / 100)

  return { beds, baths, comforters, poolTowels, subtotal, markup, total: subtotal + markup }
}

/**
 * Recurring linen program cost per clean.
 *
 * Replaces the old flat `(beds * 300) / 12 / 4`. Keeps the same 12 months and
 * 4 cleans per month, but derives the annual figure from each bed's real
 * replacement cost: `sets per year x that bed size's per-set cost`.
 * Properties with a bed count but no size breakdown use the blended rate.
 */
export function calcLinenRecurringPerClean(costs: LinenCosts, property: LinenProperty): number {
  const { king, queen, twin, total } = sizedBeds(property)

  const annualPerSet =
    total > 0
      ? king * costs.setKing + queen * costs.setQueen + twin * costs.setTwin
      : n(property.number_of_beds) * costs.blendedPerSet

  return (annualPerSet * costs.recurringSetsPerYear) / CLEANS_PER_YEAR
}

export interface LinenFeeResult extends LinenOnboardingBreakdown {
  /** The calculated figure, always shown even when overridden. */
  suggested: number
  /** What to actually quote: the override when set, else the suggestion. */
  effective: number
  isOverridden: boolean
}

/**
 * Resolve the onboarding fee to quote. A blank or unparseable override falls
 * back to the suggestion; an explicit 0 is a real override (a waived fee), so
 * the suggested figure stays visible alongside it.
 */
export function suggestedLinenFee(
  costs: LinenCosts,
  property: LinenProperty,
  opts: LinenOnboardingOptions & { override?: number | string | null } = {}
): LinenFeeResult {
  const breakdown = calcLinenOnboarding(costs, property, opts)
  const suggested = breakdown.total

  const raw = opts.override
  const parsed = typeof raw === 'string' ? parseFloat(raw) : raw
  const isOverridden =
    raw !== null && raw !== undefined && raw !== '' && Number.isFinite(parsed as number)

  return {
    ...breakdown,
    suggested,
    effective: isOverridden ? (parsed as number) : suggested,
    isOverridden,
  }
}
