// Pure logic for the /reviews page (guest reviews from Haven's Trellis,
// joined to the Tendwell clean that prepared each stay). No I/O here so the
// filters, stats and attribution labels are unit-tested (reviews.test.ts).
//
// Data source: the `review_clean_attribution` view (trellis_review_snapshot
// + the last completed clean at the property within 14 days before
// check-in). Ratings carry their own scale (overall_rating / max_rating);
// cleanliness_5 is already on 0-5.

export type Attribution =
  | 'cleaner'
  | 'tendwell_crew'
  | 'not_tendwell'
  | 'no_clean_found'
  | 'no_checkin'
  | 'no_ops_property'

export const ATTRIBUTIONS: readonly Attribution[] = [
  'cleaner',
  'tendwell_crew',
  'not_tendwell',
  'no_clean_found',
  'no_checkin',
  'no_ops_property',
]

export interface ReviewRow {
  trellis_review_id: string
  review_date: string | null
  source: string | null
  reviewer_name: string | null
  guest_name: string | null
  reservation_id: string | null
  checkin_date: string | null
  checkout_date: string | null
  overall_rating: number | null
  max_rating: number | null
  normalized_rating: number | null
  cleanliness_5: number | null
  category_ratings: Record<string, number> | null
  content: string | null
  title: string | null
  host_response_status: string | null
  trellis_property_name: string | null
  property_id: number | null
  property_name: string | null
  clean_date: string | null
  clean_kind: string | null
  clean_title: string | null
  cleaner_id: string | null
  cleaner_name: string | null
  attribution: Attribution
}

/** Columns read from review_clean_attribution (keep in step with ReviewRow). */
export const REVIEW_SELECT =
  'trellis_review_id, review_date, source, reviewer_name, guest_name, reservation_id, checkin_date, checkout_date, overall_rating, max_rating, normalized_rating, cleanliness_5, category_ratings, content, title, host_response_status, trellis_property_name, property_id, property_name, clean_date, clean_kind, clean_title, cleaner_id, cleaner_name, attribution'

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

/** Normalize a raw PostgREST row (numerics may arrive as strings). */
export function toReviewRow(raw: Record<string, unknown>): ReviewRow {
  const attr = str(raw.attribution)
  const cats: Record<string, number> = {}
  if (raw.category_ratings && typeof raw.category_ratings === 'object' && !Array.isArray(raw.category_ratings)) {
    for (const [k, v] of Object.entries(raw.category_ratings as Record<string, unknown>)) {
      const n = num(v)
      if (n != null) cats[k.toLowerCase().replace(/[^a-z]/g, '')] = n
    }
  }
  return {
    trellis_review_id: String(raw.trellis_review_id ?? ''),
    review_date: str(raw.review_date),
    source: str(raw.source),
    reviewer_name: str(raw.reviewer_name),
    guest_name: str(raw.guest_name),
    reservation_id: raw.reservation_id == null ? null : String(raw.reservation_id),
    checkin_date: str(raw.checkin_date),
    checkout_date: str(raw.checkout_date),
    overall_rating: num(raw.overall_rating),
    max_rating: num(raw.max_rating),
    normalized_rating: num(raw.normalized_rating),
    cleanliness_5: num(raw.cleanliness_5),
    category_ratings: Object.keys(cats).length ? cats : null,
    content: str(raw.content),
    title: str(raw.title),
    host_response_status: str(raw.host_response_status),
    trellis_property_name: str(raw.trellis_property_name),
    property_id: num(raw.property_id),
    property_name: str(raw.property_name),
    clean_date: str(raw.clean_date),
    clean_kind: str(raw.clean_kind),
    clean_title: str(raw.clean_title),
    cleaner_id: str(raw.cleaner_id),
    cleaner_name: str(raw.cleaner_name),
    attribution: (ATTRIBUTIONS as readonly string[]).includes(attr ?? '')
      ? (attr as Attribution)
      : 'no_ops_property',
  }
}

/** Overall rating on a 0-5 scale, whatever scale the channel used. */
export function rating5(r: Pick<ReviewRow, 'normalized_rating' | 'overall_rating' | 'max_rating'>): number | null {
  if (r.normalized_rating != null) return r.normalized_rating * 5
  if (r.overall_rating != null && r.max_rating) return (r.overall_rating / r.max_rating) * 5
  return null
}

/** A category sub-score on 0-5 (categories share the review's max_rating). */
export function category5(r: Pick<ReviewRow, 'category_ratings' | 'max_rating'>, key: string): number | null {
  const v = r.category_ratings?.[key]
  if (v == null) return null
  const max = r.max_rating && r.max_rating > 0 ? r.max_rating : 5
  return (v / max) * 5
}

/** Cleanliness below 4 of 5 counts as a low-cleanliness review. */
export const LOW_CLEANLINESS_BELOW = 4

export function isLowCleanliness(r: Pick<ReviewRow, 'cleanliness_5'>): boolean {
  return r.cleanliness_5 != null && r.cleanliness_5 < LOW_CLEANLINESS_BELOW
}

export function isTendwellClean(a: Attribution): boolean {
  return a === 'cleaner' || a === 'tendwell_crew'
}

// ---------------------------------------------------------------------------
// Attribution label (what the review card says about the clean)
// ---------------------------------------------------------------------------

export type AttributionTone = 'success' | 'info' | 'neutral' | 'warning'

export interface AttributionLabel {
  /** i18n key under `reviews.attribution.*` */
  key: Attribution
  tone: AttributionTone
  /** Named cleaner, only for `cleaner`. */
  cleanerName: string | null
  /** Date of the clean that prepared the stay, when one was found. */
  cleanDate: string | null
}

const ATTRIBUTION_TONE: Record<Attribution, AttributionTone> = {
  cleaner: 'success',
  tendwell_crew: 'info',
  not_tendwell: 'neutral',
  no_clean_found: 'warning',
  no_checkin: 'warning',
  no_ops_property: 'neutral',
}

export function attributionLabel(r: Pick<ReviewRow, 'attribution' | 'cleaner_name' | 'clean_date'>): AttributionLabel {
  // A missing name on a "cleaner" row reads as crew rather than a blank name.
  const key: Attribution = r.attribution === 'cleaner' && !r.cleaner_name ? 'tendwell_crew' : r.attribution
  return {
    key,
    tone: ATTRIBUTION_TONE[key],
    cleanerName: key === 'cleaner' ? r.cleaner_name : null,
    cleanDate: key === 'no_clean_found' || key === 'no_checkin' || key === 'no_ops_property' ? null : r.clean_date,
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * `ops` = every review at an Ops property (the default view);
 * `tendwell` = the stay was prepared by a Tendwell clean (named or crew);
 * `no_clean` = no clean found or no check-in date;
 * `not_in_ops` = Haven properties Tendwell does not service in Ops.
 */
export type AttributionFilter =
  | 'ops'
  | 'tendwell'
  | 'cleaner'
  | 'tendwell_crew'
  | 'not_tendwell'
  | 'no_clean'
  | 'not_in_ops'
  | 'all'

export const ATTRIBUTION_FILTERS: readonly AttributionFilter[] = [
  'ops',
  'tendwell',
  'cleaner',
  'tendwell_crew',
  'not_tendwell',
  'no_clean',
  'not_in_ops',
  'all',
]

export type RatingBand = 'all' | 'r5' | 'r4plus' | 'below4' | 'below3'

export interface ReviewFilters {
  search: string
  propertyId: number | null
  source: string | 'all'
  rating: RatingBand
  attribution: AttributionFilter
  lowCleanlinessOnly: boolean
}

export const DEFAULT_REVIEW_FILTERS: ReviewFilters = {
  search: '',
  propertyId: null,
  source: 'all',
  rating: 'all',
  attribution: 'ops',
  lowCleanlinessOnly: false,
}

export function matchesAttribution(a: Attribution, f: AttributionFilter): boolean {
  switch (f) {
    case 'all':
      return true
    case 'ops':
      return a !== 'no_ops_property'
    case 'tendwell':
      return isTendwellClean(a)
    case 'cleaner':
      return a === 'cleaner'
    case 'tendwell_crew':
      return a === 'tendwell_crew'
    case 'not_tendwell':
      return a === 'not_tendwell'
    case 'no_clean':
      return a === 'no_clean_found' || a === 'no_checkin'
    case 'not_in_ops':
      return a === 'no_ops_property'
  }
}

export function matchesRating(r: ReviewRow, band: RatingBand): boolean {
  if (band === 'all') return true
  const v = rating5(r)
  if (v == null) return false
  switch (band) {
    case 'r5':
      return v >= 4.995
    case 'r4plus':
      return v >= 4
    case 'below4':
      return v < 4
    case 'below3':
      return v < 3
  }
}

export function filterReviews(rows: readonly ReviewRow[], f: ReviewFilters): ReviewRow[] {
  const needle = f.search.trim().toLowerCase()
  return rows.filter((r) => {
    if (!matchesAttribution(r.attribution, f.attribution)) return false
    if (f.propertyId != null && r.property_id !== f.propertyId) return false
    if (f.source !== 'all' && r.source !== f.source) return false
    if (!matchesRating(r, f.rating)) return false
    if (f.lowCleanlinessOnly && !isLowCleanliness(r)) return false
    if (needle) {
      const hay = [
        r.property_name,
        r.trellis_property_name,
        r.guest_name,
        r.reviewer_name,
        r.content,
        r.title,
        r.cleaner_name,
        r.reservation_id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!hay.includes(needle)) return false
    }
    return true
  })
}

export type ReviewSort = 'newest' | 'oldest' | 'lowest_rating' | 'lowest_cleanliness' | 'property'

export function sortReviews(rows: readonly ReviewRow[], sort: ReviewSort): ReviewRow[] {
  const date = (v: string | null) => (v ? Date.parse(v) || 0 : 0)
  const asc = (v: number | null) => (v == null ? Infinity : v)
  return [...rows].sort((a, b) => {
    switch (sort) {
      case 'oldest':
        return date(a.review_date) - date(b.review_date)
      case 'lowest_rating':
        return asc(rating5(a)) - asc(rating5(b)) || date(b.review_date) - date(a.review_date)
      case 'lowest_cleanliness':
        return asc(a.cleanliness_5) - asc(b.cleanliness_5) || date(b.review_date) - date(a.review_date)
      case 'property':
        return (a.property_name ?? a.trellis_property_name ?? '').localeCompare(
          b.property_name ?? b.trellis_property_name ?? '',
          'en',
          { sensitivity: 'base' },
        )
      case 'newest':
      default:
        return date(b.review_date) - date(a.review_date)
    }
  })
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface GroupStats {
  count: number
  avgCleanliness: number | null
}

export interface ReviewSummary {
  count: number
  avgRating: number | null
  ratedCount: number
  avgCleanliness: number | null
  cleanlinessCount: number
  lowCleanlinessCount: number
  /** low / cleanliness-rated, 0-1; null when nothing has a cleanliness score. */
  lowCleanlinessShare: number | null
  tendwellCount: number
  namedCleanerCount: number
  properties: number
  tendwell: GroupStats
  notTendwell: GroupStats
}

function mean(vals: number[]): number | null {
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
}

function groupStats(rows: readonly ReviewRow[]): GroupStats {
  return {
    count: rows.length,
    avgCleanliness: mean(rows.map((r) => r.cleanliness_5).filter((v): v is number => v != null)),
  }
}

export function summarizeReviews(rows: readonly ReviewRow[]): ReviewSummary {
  const ratings = rows.map(rating5).filter((v): v is number => v != null)
  const clean = rows.map((r) => r.cleanliness_5).filter((v): v is number => v != null)
  const low = rows.filter(isLowCleanliness).length
  const props = new Set(rows.map((r) => (r.property_id != null ? `p${r.property_id}` : `t${r.trellis_property_name ?? '?'}`)))
  const tendwellRows = rows.filter((r) => isTendwellClean(r.attribution))
  return {
    count: rows.length,
    avgRating: mean(ratings),
    ratedCount: ratings.length,
    avgCleanliness: mean(clean),
    cleanlinessCount: clean.length,
    lowCleanlinessCount: low,
    lowCleanlinessShare: clean.length ? low / clean.length : null,
    tendwellCount: tendwellRows.length,
    namedCleanerCount: rows.filter((r) => r.attribution === 'cleaner').length,
    properties: props.size,
    tendwell: groupStats(tendwellRows),
    notTendwell: groupStats(rows.filter((r) => r.attribution === 'not_tendwell')),
  }
}

// ---------------------------------------------------------------------------
// Date window
// ---------------------------------------------------------------------------

export type WindowPreset = '30d' | '90d' | '180d' | '365d' | 'custom'

export const WINDOW_DAYS: Record<Exclude<WindowPreset, 'custom'>, number> = {
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
}

/** Local YYYY-MM-DD for `today` minus `days`. */
export function isoDaysBefore(today: Date, days: number): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}
