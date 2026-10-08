// Vendor invoicing portal — the rules a cleaning company's own invoice must
// follow before Tendwell will look at it (Operations → Invoicing).
//
// One source of truth for the form (client) and the API (serverless): the
// client uses it to show errors as the vendor types, the server re-runs it on
// every write, so a hand-crafted request cannot slip a vague reimbursement or
// an undated charge past the form.
//
// Rules (Jordan 2026-10-08, and Haven's AP rules in the busybee-invoice-prep
// skill):
//   * Every line carries a date, except inspection hours (a block of hours
//     across the period, not one visit).
//   * Reimbursements name the property, what was bought or shipped, who asked
//     for it (guest + reservation, owner, or Tendwell staff) and carry a
//     receipt. Haven recovers guest shipping from the guest, so "who" matters.
//   * Extras (pet hair, trash, double/extra cleans) carry a reason, and the
//     ones Haven disputes most carry evidence (photo or Slack/Quo link).
//   * A missing clean (done, but not in Breezeway/Trellis) bills the
//     property's Cleaner Pay rate, never a typed amount, and says why.
//
// Error values are stable codes; the client translates them (en/es).
//
// Keep this file dependency-free — imported by the Vite client bundle and the
// NodeNext serverless functions alike.

export type VendorItemCategory = 'missing_clean' | 'extra' | 'reimbursement' | 'inspection' | 'labor'
export type VendorLineCategory = 'clean' | VendorItemCategory

export const VENDOR_ITEM_CATEGORIES: readonly VendorItemCategory[] = [
  'missing_clean', 'extra', 'reimbursement', 'inspection', 'labor',
]

/** Clean types a vendor may bill as a missing clean. Onboarding is decided by
 *  Ops (first Tendwell clean only), never claimed by the vendor. */
export const VENDOR_CLEAN_TYPES = [
  'Turn Clean',
  'Departure Clean',
  'Last Clean',
  'Last Clean & Linen Pull',
  'Deep Clean',
] as const

/** Extras a vendor may add. Mirrors APPROVED_EXTRA_SERVICES + the standalone
 *  base services in api/invoices/_engine.ts (PRESET_STANDALONE_EXTRAS) minus
 *  Reimbursement, which has its own category. */
export const VENDOR_EXTRA_TYPES = [
  'Hot Tub Refresh Requested by Guest',
  'Excessive Trash Pickup',
  'Pet Fee',
  'Trip Fee',
  'Vacancy Clean / Touch Up Clean',
  'Linen Pull',
  'Double Clean',
  'Extra Cleaning',
  'Mailed Left Items by the Guest',
] as const

/** Extras Haven disputes without proof (Jordan 2026-08-11: "photos and the
 *  #cleaning-tendwell link"). A photo upload or an evidence link is required. */
export const EVIDENCE_REQUIRED_EXTRAS: ReadonlySet<string> = new Set([
  'Excessive Trash Pickup',
  'Pet Fee',
  'Double Clean',
  'Extra Cleaning',
])

export const LIMITS = {
  extraMax: 1000,
  reimbursementMax: 2500,
  hoursMax: 80,
  rateMax: 100,
  reasonMin: 10,
  descriptionMin: 10,
  requestedByMin: 3,
  workerMin: 2,
  textMax: 500,
  periodMaxDays: 31,
  // A purchase or extra can be invoiced up to this many days after it
  // happened (it is flagged as late for Tendwell to double-check).
  lateWindowDays: 30,
} as const

export type ItemErrorCode =
  | 'required'
  | 'invalid_date'
  | 'date_in_future'
  | 'date_outside_period'
  | 'date_too_old'
  | 'amount_positive'
  | 'amount_too_high'
  | 'hours_range'
  | 'rate_range'
  | 'too_short'
  | 'too_long'
  | 'invalid_url'
  | 'receipt_required'
  | 'evidence_required'
  | 'unknown_type'
  | 'no_rate'

export interface VendorItemInput {
  category: VendorItemCategory
  property_id?: number | null
  date?: string | null
  service_type?: string | null
  amount?: number | null
  hours?: number | null
  rate?: number | null
  worker?: string | null
  description?: string | null
  requested_by?: string | null
  evidence_url?: string | null
  receipt_path?: string | null
}

export interface ItemContext {
  periodStart: string
  periodEnd: string
  today: string
  /** Cleaner Pay of the chosen property (missing cleans bill exactly this). */
  propertyCleanerPay?: number | null
}

export interface NormalizedItem {
  category: VendorItemCategory
  property_id: number | null
  date: string | null
  service_type: string | null
  amount: number
  hours: number | null
  rate: number | null
  worker: string | null
  description: string | null
  requested_by: string | null
  evidence_url: string | null
  receipt_path: string | null
  /** Dated before the period start (allowed inside the late window, flagged). */
  late: boolean
}

export type ItemErrors = Partial<Record<keyof VendorItemInput, ItemErrorCode>>

export type ItemValidation =
  | { ok: true; item: NormalizedItem; errors: ItemErrors }
  | { ok: false; item: null; errors: ItemErrors }

const ISO = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function clean(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length ? t : null
}

function num(n: unknown): number | null {
  if (n === null || n === undefined || n === '') return null
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) ? v : null
}

/** https only — a Slack/Quo/Trellis/Drive link. */
export function isEvidenceUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'https:' && u.hostname.includes('.')
  } catch {
    return false
  }
}

export type PeriodError = 'invalid_date' | 'period_order' | 'date_in_future' | 'period_too_long'

/** The invoice period a vendor may create: real dates, start <= end, ending
 *  no later than today (you cannot invoice work that has not happened yet),
 *  at most 31 days long. */
export function validatePeriod(start: unknown, end: unknown, today: string): PeriodError | null {
  if (!isIsoDate(start) || !isIsoDate(end)) return 'invalid_date'
  if (start > end) return 'period_order'
  if (end > today) return 'date_in_future'
  if (daysBetween(start, end) + 1 > LIMITS.periodMaxDays) return 'period_too_long'
  return null
}

export function validateVendorItem(input: VendorItemInput, ctx: ItemContext): ItemValidation {
  const errors: ItemErrors = {}
  const category = input.category
  if (!VENDOR_ITEM_CATEGORIES.includes(category)) {
    return { ok: false, item: null, errors: { category: 'unknown_type' } }
  }

  const propertyId = num(input.property_id)
  const date = clean(input.date)
  const serviceType = clean(input.service_type)
  const worker = clean(input.worker)
  const description = clean(input.description)
  const requestedBy = clean(input.requested_by)
  const evidenceUrl = clean(input.evidence_url)
  const receiptPath = clean(input.receipt_path)

  for (const [k, v] of [['worker', worker], ['description', description], ['requested_by', requestedBy], ['evidence_url', evidenceUrl]] as const) {
    if (v && v.length > LIMITS.textMax) errors[k] = 'too_long'
  }

  // ── Property ──
  const needsProperty = category === 'missing_clean' || category === 'extra' || category === 'reimbursement'
  const propertyOk = propertyId != null && Number.isInteger(propertyId) && propertyId > 0
  if (needsProperty && !propertyOk) errors.property_id = 'required'

  // ── Date ──
  let late = false
  const needsDate = category !== 'inspection'
  if (!date) {
    if (needsDate) errors.date = 'required'
  } else if (!isIsoDate(date)) {
    errors.date = 'invalid_date'
  } else if (date > ctx.today) {
    errors.date = 'date_in_future'
  } else if (date > ctx.periodEnd) {
    errors.date = 'date_outside_period'
  } else if (category === 'missing_clean') {
    // A clean belongs to the invoice that covers its day — no late cleans.
    if (date < ctx.periodStart) errors.date = 'date_outside_period'
  } else if (date < ctx.periodStart) {
    if (daysBetween(date, ctx.periodStart) > LIMITS.lateWindowDays) errors.date = 'date_too_old'
    else late = true
  }

  // ── Type ──
  if (category === 'missing_clean' && !(VENDOR_CLEAN_TYPES as readonly string[]).includes(serviceType ?? '')) {
    errors.service_type = serviceType ? 'unknown_type' : 'required'
  }
  if (category === 'extra' && !(VENDOR_EXTRA_TYPES as readonly string[]).includes(serviceType ?? '')) {
    errors.service_type = serviceType ? 'unknown_type' : 'required'
  }

  const requireText = (key: 'description' | 'worker' | 'requested_by', value: string | null, min: number) => {
    if (!value || value.length < min) errors[key] = errors[key] ?? (value ? 'too_short' : 'required')
  }

  // ── Amount ──
  let amount = 0
  let hours: number | null = null
  let rate: number | null = null
  if (category === 'inspection' || category === 'labor') {
    hours = num(input.hours)
    rate = num(input.rate)
    if (hours == null || hours <= 0 || hours > LIMITS.hoursMax) errors.hours = 'hours_range'
    if (rate == null || rate <= 0 || rate > LIMITS.rateMax) errors.rate = 'rate_range'
    requireText('worker', worker, LIMITS.workerMin)
    if (hours != null && rate != null) amount = round2(round2(hours) * round2(rate))
    if (category === 'labor') requireText('description', description, LIMITS.descriptionMin)
  } else if (category === 'missing_clean') {
    const pay = ctx.propertyCleanerPay
    if (propertyOk && (pay == null || !(pay > 0))) errors.amount = 'no_rate'
    amount = pay != null && pay > 0 ? round2(pay) : 0
    // Deep cleans have no stored vendor rate: 3x Cleaner Pay, reviewed by Ops.
    if (serviceType === 'Deep Clean' && amount > 0) amount = round2(amount * 3)
    requireText('description', description, LIMITS.reasonMin)
  } else {
    const a = num(input.amount)
    const max = category === 'reimbursement' ? LIMITS.reimbursementMax : LIMITS.extraMax
    if (a == null || a <= 0) errors.amount = 'amount_positive'
    else if (a > max) errors.amount = 'amount_too_high'
    else amount = round2(a)
    requireText('description', description, category === 'reimbursement' ? LIMITS.descriptionMin : LIMITS.reasonMin)
  }

  // ── Reimbursement detail ──
  if (category === 'reimbursement') {
    requireText('requested_by', requestedBy, LIMITS.requestedByMin)
    if (!receiptPath) errors.receipt_path = 'receipt_required'
  }

  // ── Evidence ──
  if (evidenceUrl && !isEvidenceUrl(evidenceUrl)) errors.evidence_url = 'invalid_url'
  if (category === 'extra' && serviceType && EVIDENCE_REQUIRED_EXTRAS.has(serviceType) && !evidenceUrl && !receiptPath) {
    errors.evidence_url = errors.evidence_url ?? 'evidence_required'
  }

  if (Object.keys(errors).length > 0) return { ok: false, item: null, errors }
  return {
    ok: true,
    errors: {},
    item: {
      category,
      property_id: propertyOk ? propertyId : null,
      date,
      service_type: category === 'missing_clean' || category === 'extra' ? serviceType : null,
      amount,
      hours,
      rate,
      worker: category === 'inspection' || category === 'labor' ? worker : null,
      description,
      requested_by: category === 'reimbursement' ? requestedBy : null,
      evidence_url: evidenceUrl,
      receipt_path: receiptPath,
      late,
    },
  }
}

// ─── What the vendor sees about a line ──────────────────────────────────────

/** Engine flags the vendor is told about, as stable notice codes. Everything
 *  else (owner stays, billing channels, client pricing) is Tendwell-internal
 *  and never leaves the server. */
const VENDOR_NOTICE_BY_FLAG: Record<string, string> = {
  task_not_completed: 'task_not_completed',
  date_mismatch: 'date_mismatch',
  already_billed: 'already_billed',
  unmatched_task: 'no_task',
  missing_rate: 'missing_rate',
  possible_duplicate: 'possible_duplicate',
  deep_rate_assumed: 'deep_rate',
  onboarding_not_first_clean: 'onboarding_not_first',
  discrepancy_unexplained: 'amount_review',
  late_item: 'late_item',
  completed_off_date: 'completed_off_date',
}

export const VENDOR_NOTICE_CODES = Object.values(VENDOR_NOTICE_BY_FLAG)

export function vendorNotices(flags: readonly string[] | null | undefined): string[] {
  const out: string[] = []
  for (const f of flags ?? []) {
    const n = VENDOR_NOTICE_BY_FLAG[f]
    if (n && !out.includes(n)) out.push(n)
  }
  return out
}

/** Flags that always send a vendor-portal line to Tendwell's review queue. */
export const PORTAL_REVIEW_FLAGS: ReadonlySet<string> = new Set([
  'vendor_added',
  'possible_duplicate',
  'deep_rate_assumed',
  'late_item',
  'completed_off_date',
])

export type VendorRunStatus = 'draft' | 'returned' | 'submitted' | 'approved' | 'void'

/** The vendor's view of a run's lifecycle. A returned run is a draft again,
 *  with Tendwell's note, until it is re-submitted. */
export function vendorRunStatus(run: {
  status: string
  submitted_at?: string | null
  returned_at?: string | null
}): VendorRunStatus {
  if (run.status === 'void') return 'void'
  if (run.status === 'approved' || run.status === 'exported') return 'approved'
  if (run.status === 'draft') {
    if (run.returned_at && (!run.submitted_at || run.returned_at > run.submitted_at)) return 'returned'
    return 'draft'
  }
  return 'submitted'
}
