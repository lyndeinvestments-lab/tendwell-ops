// Auxiliary (non-clean) task vocabulary shared by the invoicing engine, the
// Task Audit view and the MCP tools.
//
// Why this exists (Jordan 2026-09-22): Busy Bee stopped billing auxiliary
// work — hot tub refreshes, trash pickups, lockbox checks, deliveries — so it
// no longer arrives on the vendor CSV, but it is still done (the tasks exist
// in Breezeway and Trellis) and is still owed by the client. These tasks must
// be BILLED to the client (QBO / bill.com) and NOT PAID to the vendor. Cleans
// (onboarding, turn, departure, deep) are untouched: they still flow through
// the vendor invoice and the existing engine.
//
// Every title in the live vocabulary (90 days of breezeway_tasks +
// trellis_task_snapshot, 2026-09-22) is exercised in shared/aux-tasks.test.ts.
// Order matters — first match wins — and the list is deliberately explicit:
// a title the classifier does not recognise is `unclassified`, which is never
// auto-billed. It surfaces in the Task Audit view for a human to bill in one
// click instead.
//
// Keep this file dependency-free — it is imported from both the Vite client
// bundle and the NodeNext serverless functions.

export type AuxCategory =
  // Billable by default (Jordan: "everything else that's not a task like
  // that we would charge for")
  | 'hot_tub'
  | 'trash'
  | 'linen_pull'
  | 'delivery'
  | 'lockbox'
  | 'touch_up'
  | 'pet'
  | 'extra_cleaning'
  // Not billable by default
  | 'air_filter'        // separate AC-filter program; excluded by the engine too
  | 'vacancy_clean'     // unbooked tidy — "intentionally EXCLUDED per the operator" (breezeway-import.ts)
  | 'self_inspection'   // Jordan: never charged
  | 'owner_walkthrough' // pre-/post-owner-stay walkthrough — Jordan: never charged
  | 'inspection'
  | 'callback'          // a cleaner fixing their own work is not the client's cost
  // Not auxiliary at all
  | 'clean'             // handled by the clean path (vendor invoice + engine)
  | 'no_clean'          // "DO NOT CLEAN", "NO CLEAN NEEDED", test rows
  | 'unclassified'

export interface AuxCategoryDef {
  id: AuxCategory
  label: string
  /** Approved invoice service title (invoice_lines.service_type); null when the category never bills. */
  serviceType: string | null
  /** Whether a completed task in this category is added to the run as a client charge. */
  billableDefault: boolean
  /** Why it is (or is not) billable — shown in the Task Audit view. */
  blurb: string
}

export const AUX_CATEGORIES: Record<AuxCategory, AuxCategoryDef> = {
  hot_tub: {
    id: 'hot_tub', label: 'Hot tub refresh', serviceType: 'Hot Tub Refresh Requested by Guest', billableDefault: true,
    blurb: 'Drain / refill / sediment / refresh of a hot tub, usually guest-requested.',
  },
  trash: {
    id: 'trash', label: 'Trash pickup', serviceType: 'Excessive Trash Pickup', billableDefault: true,
    blurb: 'Mid-stay or excessive trash pickup; scattered-trash cleanup.',
  },
  linen_pull: {
    id: 'linen_pull', label: 'Linen pull (standalone)', serviceType: 'Linen Pull', billableDefault: true,
    blurb: 'Collecting dirty linens without a clean. A Last Clean & Linen Pull is a clean, not this.',
  },
  delivery: {
    id: 'delivery', label: 'Delivery / supply run', serviceType: 'Reimbursement', billableDefault: true,
    blurb: 'Dropping off pillows, blankets, covers, batteries, tabs or other supplies requested at the property.',
  },
  lockbox: {
    id: 'lockbox', label: 'Lockbox / key check', serviceType: 'Trip Fee', billableDefault: true,
    blurb: 'A trip to check a lockbox, a key, or a lock battery.',
  },
  touch_up: {
    id: 'touch_up', label: 'Touch-up clean', serviceType: 'Vacancy Clean / Touch Up Clean', billableDefault: true,
    blurb: 'A guest-requested or pre-arrival touch-up — not a full clean.',
  },
  pet: {
    id: 'pet', label: 'Pet fee', serviceType: 'Pet Fee', billableDefault: true,
    blurb: 'Pet hair / pet fee work.',
  },
  extra_cleaning: {
    id: 'extra_cleaning', label: 'Extra cleaning', serviceType: 'Extra Cleaning', billableDefault: true,
    blurb: 'Odor, mold, flea, balcony, or other one-off cleaning work that is not a scheduled clean. Needs a price.',
  },
  air_filter: {
    id: 'air_filter', label: 'Air filter change', serviceType: null, billableDefault: false,
    blurb: 'Covered by the AC filter program — never billed per task.',
  },
  vacancy_clean: {
    id: 'vacancy_clean', label: 'Vacancy clean', serviceType: null, billableDefault: false,
    blurb: 'Unbooked tidy between stays — not a revenue event.',
  },
  self_inspection: {
    id: 'self_inspection', label: 'Cleaner self-inspection', serviceType: null, billableDefault: false,
    blurb: 'Never charged.',
  },
  owner_walkthrough: {
    id: 'owner_walkthrough', label: 'Owner-stay walkthrough', serviceType: null, billableDefault: false,
    blurb: 'Pre-/post-owner-stay walkthrough — never charged.',
  },
  inspection: {
    id: 'inspection', label: 'Inspection', serviceType: null, billableDefault: false,
    blurb: 'Inspections are covered by the per-clean inspection cost.',
  },
  callback: {
    id: 'callback', label: 'Cleaner callback', serviceType: null, billableDefault: false,
    blurb: "A cleaner returning to fix their own work is not the client's cost.",
  },
  clean: {
    id: 'clean', label: 'Clean', serviceType: null, billableDefault: false,
    blurb: 'Billed through the vendor invoice — not an auxiliary task.',
  },
  no_clean: {
    id: 'no_clean', label: 'No clean / placeholder', serviceType: null, billableDefault: false,
    blurb: 'DO NOT CLEAN / NO CLEAN NEEDED markers and test rows.',
  },
  unclassified: {
    id: 'unclassified', label: 'Unclassified', serviceType: null, billableDefault: false,
    blurb: 'Not recognised — never auto-billed. Bill it by hand from the Task Audit view if it was real work.',
  },
}

/** Categories that put a line on the invoice when billable. */
export const BILLABLE_AUX_CATEGORIES: AuxCategory[] = (Object.keys(AUX_CATEGORIES) as AuxCategory[])
  .filter(c => AUX_CATEGORIES[c].serviceType != null)

// Ordered rules; first match wins. Every regex here is anchored on a real
// title from the live vocabulary — see the test file for the full list.
const RULES: Array<{ re: RegExp; category: AuxCategory }> = [
  // Markers and placeholders first, so "NO CLEAN NEEDED - Departure Clean"
  // does not read as a clean.
  { re: /do\s*not\s*clean|no\s*clean\s*needed|\[test\b|test\s*tecnico/i, category: 'no_clean' },

  // The scheduled clean family — everything the vendor invoice already
  // covers. "Post-Owner Stay Clean - HT" and "Owner Stay - Turn Clean" are
  // cleans, which is why this runs before the owner-walkthrough rule.
  {
    re: /(departure|turn|arrival|last|onboarding|deep|double|post.?owner\s*stay|pre.?check.?in|early\s*check.?in)\s*-?\s*(deep\s*)?clean|same\s*day\s*turn|last\s*clean\s*(&|and|\/)\s*linen\s*pull|^onboarding$|htlr\s*onboarding/i,
    category: 'clean',
  },

  // Non-revenue cleans and inspections.
  { re: /vacancy\s*clean/i, category: 'vacancy_clean' },
  { re: /self.?in?spection/i, category: 'self_inspection' },
  { re: /pre.?owner|owner\s*stay|property\s*walkthrough|\bwalkthrough\b/i, category: 'owner_walkthrough' },
  { re: /\bcall\s*back\b|\bcallback\b/i, category: 'callback' },

  // Specific billable work. Delivery verbs before hot_tub so "Drop off
  // bromine tabs for hot tub" is a supply run, not a refresh.
  { re: /air\s*filter|a\/?c\s*filters?|\bfilters?\b/i, category: 'air_filter' },
  { re: /\bdeliver(y|ed|ies)?\b|\bdrop\s*-?\s*off\b|\bmailed\b|left\s*items?/i, category: 'delivery' },
  { re: /\b(hot|cool)\s*tub\b|\btub\s*(refresh|refill)/i, category: 'hot_tub' },
  { re: /trash\s*pick|mid.?stay.*trash|remove\s*trash|trash\s*removal|excessive\s*trash|scattered\s*trash|^trash\s*pickup$/i, category: 'trash' },
  { re: /linen\s*pull|dirty\s*linens?|linen\s*back|grab\s*(dirty\s*)?linens?/i, category: 'linen_pull' },
  { re: /\bpet\s*(fee|hair|charge)\b|\bd(og|oh)\s*hair\b/i, category: 'pet' },
  { re: /lock\s*box|\blockbox\b|key\s*check|lock\s*batter/i, category: 'lockbox' },
  // "Needs 6 king pillows", "Need 4 pillow replacements", "Needs 3 king bed
  // bug covers", "Baterias pequeñas para control" — a cleaner asking for
  // supplies to be brought to the property.
  {
    re: /\bneeds?\b.*\b(pillow|cover|curtain|blanket|towel|suppl|batter|dubai|comforter|sheet)|\bbater[ií]as?\b|\bbatter(y|ies)\b|\bsupply\s*run\b|\bsupplies\s*request/i,
    category: 'delivery',
  },
  { re: /touch\s*-?\s*up/i, category: 'touch_up' },
  // One-off remediation work — odor, mold, pests. Before the inspection rule
  // so "Inspect cigarette-smoke odor and deodorize" is the deodorizing work.
  { re: /odou?r|deodori[sz]|\bmou?ld\b|\bsmoke\b|\bflea|cobweb|spider/i, category: 'extra_cleaning' },
  { re: /in?spection|\binspect\b/i, category: 'inspection' },
  // Anything else that says "clean" but is not a scheduled clean title
  // ("Clean Balconies", "Subbed Out: Washer Cleaning") — billable, unpriced.
  { re: /\bclean(ing)?\b/i, category: 'extra_cleaning' },
]

export function classifyAuxTask(title: string | null | undefined): AuxCategory {
  const t = (title ?? '').trim()
  if (!t) return 'unclassified'
  for (const r of RULES) if (r.re.test(t)) return r.category
  return 'unclassified'
}

// ─── Pricing & billability settings ────────────────────────────────────────
//
// Defaults mirror STANDARD_EXTRA_PRICING in api/invoices/_engine.ts (the
// client charge column, plus its hot-tub variant) — a test in
// _engine.test.ts pins the two together. A service type with no price still
// gets ADDED to the run, flagged missing_rate and queued for review so a
// human sets one — it is never silently dropped. Both maps are overridable
// from app_settings (`invoicing_extra_pricing`, `invoicing_aux_billable`) so
// a price change never needs a deploy.

export const DEFAULT_EXTRA_PRICING: Readonly<Record<string, number>> = {
  'Hot Tub Refresh Requested by Guest': 50,
  'Excessive Trash Pickup': 50,
  'Vacancy Clean / Touch Up Clean': 50,
  'Linen Pull': 50,
  'Reimbursement': 50,
  'Pet Fee': 45,
}

// Price on a property WITH a hot tub, for fees whose work includes the tub
// (Jordan, 2026-09-24: a touch-up is $65 with a hot tub, $50 without). A type
// absent here costs the same either way.
export const DEFAULT_HOT_TUB_PRICING: Readonly<Record<string, number>> = {
  'Vacancy Clean / Touch Up Clean': 65,
}

export const APP_SETTING_EXTRA_PRICING = 'invoicing_extra_pricing'
export const APP_SETTING_AUX_BILLABLE = 'invoicing_aux_billable'

/** A client's agreed price for one fee. `hotTubCharge` null = same price
 *  whether or not the property has a hot tub. */
export interface FeeOverride {
  charge: number
  hotTubCharge: number | null
}

/** What a price lookup needs to know about the property. */
export interface FeePricingContext {
  hotTub?: boolean
  /** The property's CLIENT's overrides, keyed by service type. */
  feeOverrides?: Readonly<Record<string, FeeOverride>>
}

export interface AuxBillingSettings {
  /** service_type → client charge. */
  pricing: Record<string, number>
  /** service_type → client charge on a property with a hot tub. */
  hotTubPricing: Record<string, number>
  /** category → billable override. Absent = the category default. */
  billable: Partial<Record<AuxCategory, boolean>>
}

function parseJson(raw: unknown): unknown {
  if (raw == null) return null
  if (typeof raw === 'object') return raw
  if (typeof raw !== 'string') return null
  try { return JSON.parse(raw) } catch { return null }
}

function toPrice(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null
}

/** Merge stored overrides over the defaults. Malformed values are ignored, never fatal.
 *
 *  A stored price is either a number (one price, hot tub or not) or
 *  `{ charge, hot_tub_charge }`. An explicit null (or blank) clears a default
 *  so the type queues for review. */
export function resolveAuxSettings(raw: { pricing?: unknown; billable?: unknown } = {}): AuxBillingSettings {
  const pricing: Record<string, number> = { ...DEFAULT_EXTRA_PRICING }
  const hotTubPricing: Record<string, number> = { ...DEFAULT_HOT_TUB_PRICING }
  const p = parseJson(raw.pricing)
  if (p && typeof p === 'object') {
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (v === null || v === '') {
        delete pricing[k]
        delete hotTubPricing[k]
        continue
      }
      if (typeof v === 'object') {
        const o = v as Record<string, unknown>
        const charge = toPrice(o.charge)
        if (charge == null) {
          if (o.charge === null || o.charge === '') { delete pricing[k]; delete hotTubPricing[k] }
          continue
        }
        pricing[k] = charge
        const hot = toPrice(o.hot_tub_charge)
        if (hot != null) hotTubPricing[k] = hot
        else delete hotTubPricing[k]
        continue
      }
      const n = toPrice(v)
      if (n != null) {
        pricing[k] = n
        delete hotTubPricing[k] // a bare number means one price either way
      }
    }
  }
  const billable: Partial<Record<AuxCategory, boolean>> = {}
  const b = parseJson(raw.billable)
  if (b && typeof b === 'object') {
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
      if (k in AUX_CATEGORIES && typeof v === 'boolean') billable[k as AuxCategory] = v
    }
  }
  return { pricing, hotTubPricing, billable }
}

export function isBillableCategory(category: AuxCategory, settings: AuxBillingSettings): boolean {
  const def = AUX_CATEGORIES[category]
  if (!def.serviceType) return false // nothing to put on an invoice
  return settings.billable[category] ?? def.billableDefault
}

export interface AuxPrice {
  charge: number
  source: 'standard' | 'client'
}

/** Client charge for a service type on one property, or null when no price is
 *  on file. The property's client override wins over the standard price; each
 *  resolves its hot-tub variant when the property has a tub. Overrides only
 *  apply to types that have a standard price — an unpriced type keeps queuing
 *  for review (same rule as the vendor-invoice engine). */
export function auxPrice(
  serviceType: string,
  settings: AuxBillingSettings,
  property: FeePricingContext | null = null,
): AuxPrice | null {
  const base = settings.pricing[serviceType]
  if (typeof base !== 'number' || !Number.isFinite(base)) return null
  const hot = property?.hotTub === true
  const ov = property?.feeOverrides?.[serviceType]
  if (ov) return { charge: hot && ov.hotTubCharge != null ? ov.hotTubCharge : ov.charge, source: 'client' }
  const hotPrice = settings.hotTubPricing[serviceType]
  return { charge: hot && typeof hotPrice === 'number' ? hotPrice : base, source: 'standard' }
}

/** Just the number from auxPrice. */
export function auxCharge(
  serviceType: string,
  settings: AuxBillingSettings,
  property: FeePricingContext | null = null,
): number | null {
  return auxPrice(serviceType, settings, property)?.charge ?? null
}

/** Build the per-contact override map from client_fee_overrides rows. */
export function feeOverridesByContact(
  rows: ReadonlyArray<{ contact_id: string | null; service_type: string; charge: number | string | null; hot_tub_charge: number | string | null }>,
): Map<string, Record<string, FeeOverride>> {
  const out = new Map<string, Record<string, FeeOverride>>()
  for (const r of rows) {
    if (!r.contact_id || !r.service_type) continue
    const charge = toPrice(r.charge)
    if (charge == null) continue
    const m = out.get(r.contact_id) ?? {}
    m[r.service_type] = { charge, hotTubCharge: toPrice(r.hot_tub_charge) }
    out.set(r.contact_id, m)
  }
  return out
}

// ─── Completion evidence ───────────────────────────────────────────────────
//
// Only DONE work bills. Breezeway exports carry `Closed` / `Finished` with a
// completed date (`Created` / `Overdue` are open); Trellis uses COMPLETED.

export type AuxTaskSource = 'breezeway' | 'trellis'

export function isTaskCompleted(
  source: AuxTaskSource,
  status: string | null | undefined,
  completedAt: string | null | undefined,
): boolean {
  if (completedAt) return true
  const s = (status ?? '').trim().toLowerCase()
  if (!s) return false
  if (source === 'trellis') return s === 'completed' || s === 'complete' || s === 'done'
  return s === 'closed' || s === 'finished' || s === 'completed' || s === 'done'
}

export function isTaskCancelled(status: string | null | undefined): boolean {
  return /cancel/i.test(status ?? '')
}

// ─── Observation matching ──────────────────────────────────────────────────
//
// A Slack/Quo observation ("Norma refreshed the hot tub at Tara Rao 116 on
// the 19th") matches a task when the property agrees, the date is within a
// day, and the category agrees — or the observation's category is unknown,
// in which case any billable auxiliary task that day counts.

export function daysBetween(a: string, b: string): number {
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
  return Math.abs(Math.round((da - db) / 86_400_000))
}

export interface MatchableTask {
  externalId: string
  propertyId: number | null
  date: string | null
  category: AuxCategory
}

export function matchObservationToTask(
  obs: { propertyId: number | null; date: string; category: AuxCategory },
  tasks: MatchableTask[],
  toleranceDays = 1,
): MatchableTask | null {
  if (obs.propertyId == null) return null
  const candidates = tasks.filter(t =>
    t.propertyId === obs.propertyId &&
    t.date != null &&
    daysBetween(t.date, obs.date) <= toleranceDays &&
    (obs.category === 'unclassified'
      ? AUX_CATEGORIES[t.category].serviceType != null
      : t.category === obs.category),
  )
  if (candidates.length === 0) return null
  // Same-day beats adjacent-day.
  candidates.sort((a, b) => daysBetween(a.date!, obs.date) - daysBetween(b.date!, obs.date))
  return candidates[0]
}
