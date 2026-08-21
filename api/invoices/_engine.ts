// Pure reconciliation engine for vendor invoicing. NO I/O in this file —
// callers (api/invoices/*.ts endpoints) fetch rows and pass them in, which is
// what makes the golden-fixture and unit tests possible without a live DB.
//
// Business rules source of truth: Nina's reconciliation skill (see the
// invoicing dev plan). The engine never guesses: anything ambiguous gets a
// flag + review_status='needs_review' and surfaces in the review queue.

// ─── Types ────────────────────────────────────────────────────────────────────

export type BillingChannel = 'qbo_haven' | 'bill_com' | 'none'

export interface PropertyRates {
  id: number
  name: string
  ceCharged: number | null
  cleanerPay: number | null
  deepClean3xCe: number | null
  billingChannel: BillingChannel | null // null = property has no client contact
}

export interface AliasRow {
  aliasRaw: string
  propertyId: number
  vendorId: string | null // null = global alias
}

export interface TaskRow {
  externalId: string
  propertyId: number | null
  dueDate: string | null // yyyy-mm-dd
  title: string
  isClean: boolean
  isDeepClean: boolean
  totalCostRef: number | null // Breezeway raw "Total cost" — reference only, never authoritative
}

export interface RawLine {
  lineNo: number
  source: 'vendor' | 'generated' | 'manual'
  rawPropertyText: string | null
  rawNoteText: string | null
  rawAmount: number
  rawDateMentioned: string | null
}

export type LineKind =
  | 'clean'
  | 'deep_clean'
  | 'extra'
  | 'combined_split'
  | 'operating_expense'
  | 'excluded'

export interface EngineLine extends RawLine {
  splitGroup: number | null
  propertyId: number | null
  aliasConfidence: number | null
  matchedTaskId: string | null
  serviceType: string | null
  lineKind: LineKind
  cleanerPayAmount: number | null
  clientChargeAmount: number | null
  billingChannel: BillingChannel | null
  flags: string[]
  reviewStatus: 'ok' | 'needs_review' | 'excluded'
}

export interface RunSummary {
  totalInvoiced: number
  totalCleanerPay: number
  totalClientCharge: number
  netDiscrepancy: number // invoiced − expected cleaner pay across matched lines
  needsReviewCount: number
  operatingExpenseTotal: number
}

export interface EngineInput {
  vendorId: string | null
  lines: RawLine[]
  aliases: AliasRow[]
  properties: PropertyRates[]
  tasks: TaskRow[]
  periodStart: string | null
  periodEnd: string | null
  fuzzyThreshold?: number // default FUZZY_CONFIRM_THRESHOLD
}

// ─── Flag taxonomy (client renders badges from these) ───────────────────────

export const FLAGS = {
  SUBTOTAL_MISMATCH: 'subtotal_mismatch',
  UNRESOLVED_PROPERTY: 'unresolved_property',
  LOW_CONFIDENCE_ALIAS: 'low_confidence_alias',
  NEGATIVE_SPLIT_STANDALONE: 'negative_split_standalone',
  RELABELED_AS_CLEAN: 'relabeled_as_clean',
  DISCREPANCY_UNEXPLAINED: 'discrepancy_unexplained',
  NO_BILLING_CHANNEL: 'no_billing_channel',
  UNMATCHED_TASK: 'unmatched_task',
  MISSING_RATE: 'missing_rate',
  COMBINED_SPLIT: 'combined_split',
  BILLED_WHOLE: 'billed_whole',
  DEEP_RATE_ASSUMED: 'deep_rate_assumed',
  OPERATING_EXPENSE: 'operating_expense',
  RATE_STALE: 'rate_stale',
  DEEP_MISMATCH: 'deep_mismatch',
  CREDIT_LINE: 'credit_line',
  REASON_REQUIRED: 'reason_required',
  // The vendor billed LESS than the property's Cleaner Pay rate, so AP pays
  // the rate instead. Distinct from discrepancy_unexplained because it is the
  // reason the Ramp total exceeds the vendor's invoice total — without it that
  // gap looks like a parsing error.
  PAID_AT_RATE: 'paid_at_rate',
} as const

export const FUZZY_CONFIRM_THRESHOLD = 0.82

// Amounts within this tolerance are "equal to the penny" (float guard).
const PENNY = 0.005

// Self-inspection / air-filter lines are excluded UNLESS within this many
// dollars of the property's clean rate (mislabeled real clean).
const RELABEL_TOLERANCE = 5

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// ─── Approved service titles ─────────────────────────────────────────────────

export const APPROVED_BASE_SERVICES = [
  'Departure Clean',
  'Turn Clean',
  'Cleaning Inspection',
  'Vacancy Clean / Touch Up Clean',
  'Deep Clean',
  'Last Clean',
  'Linen Pull',
  'Last Clean & Linen Pull',
  'Onboarding Clean',
  'Pre-Owner Stay Inspection',
] as const

export const APPROVED_EXTRA_SERVICES = [
  'Double Clean',
  'Extra Cleaning',
  'Reimbursement',
  'Trip Fee',
  'Excessive Trash Pickup',
  'Mailed Left Items by the Guest',
  'Hot Tub Refresh Requested by Guest',
  'Pet Fee',
] as const

// Task titles that are never owner-billable (unless mislabeled — see
// RELABEL_TOLERANCE above).
const EXCLUDED_TITLE_PATTERNS = [/cleaner\s*self.?inspection/i, /air\s*filter\s*change/i]

// Bulk / non-property line detector — routed to the operating-expense flag
// list, never onto a client invoice.
const OPERATING_EXPENSE_PATTERNS = [
  /toilet\s*paper/i,
  /paper\s*towel/i,
  /suppl(y|ies)/i,
  /facilit/i,
  /office/i,
  /warehouse/i,
  /inspection\s*work/i,
  /bulk/i,
  // Labor lines are a Tendwell expense: paid to the vendor via Ramp, never
  // invoiced to Haven or bill.com, and need no property (Jordan 2026-08-17).
  // Busy Bee phrases them "<name> Work" ("Irma Work", "Joshua Work") — safe
  // to match broadly because this list only applies to lines whose property
  // could NOT be resolved.
  /\blabou?r\b/i,
  /\bwork\b/i,
]

interface TitleRule {
  re: RegExp
  title: string
  extra?: boolean
  // The matched phrase IS the evidence ("dog hair") — keep it in the
  // extracted reason instead of stripping it as a service keyword.
  keepInReason?: boolean
}

// Order matters — first match wins. Deep/double checked before generic clean.
const TITLE_RULES: TitleRule[] = [
  { re: /double\s*clean/i, title: 'Double Clean', extra: true },
  { re: /deep\s*clean/i, title: 'Deep Clean' },
  { re: /onboarding\s*clean/i, title: 'Onboarding Clean' },
  { re: /last\s*clean\s*(&|and)\s*linen\s*pull/i, title: 'Last Clean & Linen Pull' },
  { re: /linen\s*pull/i, title: 'Linen Pull' },
  { re: /last\s*clean/i, title: 'Last Clean' },
  { re: /pre.?owner\s*stay/i, title: 'Pre-Owner Stay Inspection' },
  { re: /cleaning\s*inspection/i, title: 'Cleaning Inspection' },
  { re: /departure\s*clean/i, title: 'Departure Clean' },
  { re: /(turn\s*clean|same\s*day\s*turn|arrival\s*clean)/i, title: 'Turn Clean' },
  { re: /(vacancy\s*clean|touch\s*up)/i, title: 'Vacancy Clean / Touch Up Clean' },
]

// Extra-charge keywords found in note text. First match wins. Kept
// deliberately tight (word-bounded, fee/charge-anchored where the bare noun
// is common in benign notes like "no pets seen") — a spurious keyword match
// here would auto-relabel a real payment discrepancy as an extra charge.
const EXTRA_RULES: TitleRule[] = [
  { re: /double\s*clean/i, title: 'Double Clean' },
  { re: /trash/i, title: 'Excessive Trash Pickup' },
  { re: /hot\s*tub/i, title: 'Hot Tub Refresh Requested by Guest' },
  { re: /\bpet\s*(fee|charge)\b/i, title: 'Pet Fee' },
  // "Regular clean plus dog hair charge" (real Busy Bee note) — pet evidence
  // without the word "pet"; must split as a Pet Fee line for QBO.
  { re: /\bdog\s*hair\b/i, title: 'Pet Fee', keepInReason: true },
  { re: /trip\s*fee/i, title: 'Trip Fee' },
  { re: /reimburse/i, title: 'Reimbursement' },
  { re: /\b(left\s*items?|mailed)\b/i, title: 'Mailed Left Items by the Guest' },
  // "Regular clean plus onboarding" (real Busy Bee note, I260810797 Luning
  // Wang) — the onboarding surcharge splits off the base clean like any other
  // note-explained overage. A note that is ENTIRELY an onboarding clean hits
  // the TITLE_RULES whole-line branch first (CE + $50, two rows).
  { re: /\bonboarding\b/i, title: 'Onboarding Clean' },
  { re: /touch\s*up/i, title: 'Vacancy Clean / Touch Up Clean' },
  { re: /\bextra\b/i, title: 'Extra Cleaning' },
]

export function isExcludedTitle(text: string | null): boolean {
  if (!text) return false
  return EXCLUDED_TITLE_PATTERNS.some(re => re.test(text))
}

export function isOperatingExpenseText(text: string | null): boolean {
  if (!text) return false
  return OPERATING_EXPENSE_PATTERNS.some(re => re.test(text))
}

export function standardizeTitle(text: string | null): { title: string; isExtra: boolean } | null {
  if (!text) return null
  for (const rule of TITLE_RULES) {
    if (rule.re.test(text)) return { title: rule.title, isExtra: rule.extra ?? false }
  }
  return null
}

export function extraTitleFromNote(note: string | null): string | null {
  if (!note) return null
  for (const rule of EXTRA_RULES) {
    if (rule.re.test(note)) return rule.title
  }
  return null
}

// Extras whose invoice title must carry the vendor's stated reason (Finance
// requirement, 2026-08-17) — e.g. "Pet Fee (excess dog hair)" on Nina's real
// QBO sheet. A line with one of these titles and no derivable reason goes to
// the review queue so a human supplies one (review_note).
export const REASON_REQUIRED_EXTRAS: ReadonlySet<string> = new Set([
  'Double Clean',
  'Extra Cleaning',
  'Reimbursement',
  'Trip Fee',
  'Pet Fee',
])

// The vendor note minus the service keyword itself is the vendor's own stated
// reason ("pet fee — excess dog hair" → "excess dog hair"). Dollar amounts are
// stripped (they're already the line amount); bare counts ("2 boxes") are kept.
// Returns null when nothing meaningful remains — never fabricates a reason.
export function extraReasonFromNote(note: string | null, title: string): string | null {
  if (!note) return null
  let rest = note
  for (const rule of [...EXTRA_RULES, ...TITLE_RULES]) {
    // Consume the whole surrounding word(s), not just the matched stem —
    // /reimburse/ must strip "reimbursement", not leave "ment" behind.
    if (rule.title === title && !rule.keepInReason) rest = rest.replace(new RegExp(`\\w*(?:${rule.re.source})\\w*`, 'gi'), ' ')
  }
  rest = rest
    .replace(/\$\s*\d+(?:,\d{3})*(?:\.\d{1,2})?/g, ' ')
    .replace(/[\s\-–—:;,.()]+/g, ' ')
    .trim()
  return rest.length >= 3 ? rest : null
}

// ─── Property resolution ─────────────────────────────────────────────────────

export function normalizeText(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // WTN → CTN. The whole CTN group was renamed from WTN (Jordan 2026-08-21):
  // "Wtn-Mountain View 1615" is now "CTN-Mountain View". Vendor invoices and
  // Breezeway exports still say WTN, which was sinking those lines below the
  // fuzzy threshold and into the unresolved-property queue. Ops has zero WTN
  // properties, so rewriting a LEADING wtn token is lossless — and only
  // leading, so a name that happens to contain "wtn" elsewhere is untouched.
  // Every caller of normalizeText is a property-name comparison, which is why
  // this belongs here rather than at each call site.
  return base.replace(/^wtn\b/, 'ctn')
}

// Small in-repo Levenshtein — the alias list plus ~300 property names don't
// justify a dependency.
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = new Array(b.length + 1)
  let curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

export function similarity(a: string, b: string): number {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const dist = levenshtein(na, nb)
  const ratio = 1 - dist / Math.max(na.length, nb.length)
  // Token containment: vendor often writes a subset of the canonical name
  // ("Brandi Tropf" for "Brandi Tropf 2505", "Rohwer" for "Michael Rohwer 2455").
  const aTokens = na.split(' ')
  const bTokens = new Set(nb.split(' '))
  const shared = aTokens.filter(t => bTokens.has(t)).length
  const containment = shared / aTokens.length
  // Containment only counts when most of what the vendor wrote appears in the
  // canonical name — weight it slightly below exact-string similarity.
  return Math.max(ratio, containment >= 1 ? 0.95 : containment * 0.9)
}

export interface PropertyResolution {
  propertyId: number | null
  confidence: number | null
  via: 'alias' | 'exact' | 'fuzzy' | null
}

export function resolveProperty(
  rawText: string | null,
  aliases: AliasRow[],
  properties: PropertyRates[],
  vendorId: string | null,
  threshold: number = FUZZY_CONFIRM_THRESHOLD,
): PropertyResolution {
  if (!rawText || !normalizeText(rawText)) return { propertyId: null, confidence: null, via: null }
  const needle = normalizeText(rawText)

  // 1. Alias table — vendor-scoped rows win over global rows.
  const aliasHit =
    aliases.find(a => a.vendorId != null && a.vendorId === vendorId && normalizeText(a.aliasRaw) === needle) ??
    aliases.find(a => a.vendorId == null && normalizeText(a.aliasRaw) === needle)
  if (aliasHit) return { propertyId: aliasHit.propertyId, confidence: 1, via: 'alias' }

  // 2. Exact canonical-name match.
  const exact = properties.find(p => normalizeText(p.name) === needle)
  if (exact) return { propertyId: exact.id, confidence: 1, via: 'exact' }

  // 3. Fuzzy — best score wins, but only above threshold, and never when the
  // runner-up is within 0.03 (ambiguous match is a review case, not a guess).
  let best: { id: number; score: number } | null = null
  let second = 0
  for (const p of properties) {
    const score = similarity(rawText, p.name)
    if (!best || score > best.score) {
      second = best?.score ?? 0
      best = { id: p.id, score }
    } else if (score > second) {
      second = score
    }
  }
  if (best && best.score >= threshold && best.score - second > 0.03) {
    return { propertyId: best.id, confidence: round2(best.score), via: 'fuzzy' }
  }
  return { propertyId: null, confidence: best ? round2(best.score) : null, via: null }
}

// ─── Note-date extraction ─────────────────────────────────────────────────────

// Pull the first m/d/yy or m/d/yyyy date out of free text ("Deep clean on
// 8/7/26"). Two-digit years are 20xx.
export function extractDateFromText(text: string | null): string | null {
  if (!text) return null
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (!m) return null
  const [, mm, dd, yy] = m
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy)
  const month = Number(mm)
  const day = Number(dd)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// ─── Task matching ────────────────────────────────────────────────────────────

export function matchToTask(
  propertyId: number | null,
  targetDate: string | null,
  tasks: TaskRow[],
  preferDeep: boolean,
): TaskRow | null {
  if (propertyId == null) return null
  const forProperty = tasks.filter(t => t.propertyId === propertyId && (t.isClean || t.isDeepClean))
  if (forProperty.length === 0) return null
  const scored = forProperty
    .map(t => {
      let dateGap = Number.MAX_SAFE_INTEGER
      if (targetDate && t.dueDate) {
        dateGap = Math.abs(
          (Date.parse(t.dueDate) - Date.parse(targetDate)) / 86_400_000,
        )
      } else if (!targetDate) {
        dateGap = 0 // no date to compare — any task in the window is a candidate
      }
      return { t, dateGap }
    })
    .filter(s => s.dateGap <= 3)
    .sort((a, b) => {
      if (a.dateGap !== b.dateGap) return a.dateGap - b.dateGap
      // Same-day tie: prefer the deep clean when the note says deep.
      const aDeep = a.t.isDeepClean ? 1 : 0
      const bDeep = b.t.isDeepClean ? 1 : 0
      return preferDeep ? bDeep - aDeep : aDeep - bDeep
    })
  return scored[0]?.t ?? null
}

// ─── AP amount ────────────────────────────────────────────────────────────────

/**
 * What we actually pay the cleaner for a line that HAS a Cleaner Pay rate.
 *
 * The rate in Tendwell Ops is the contract, so it is the floor: a vendor who
 * under-bills still gets paid the full rate (`paid_at_rate`). When the vendor
 * bills ABOVE the rate we pay what they billed rather than unilaterally cutting
 * their invoice — the gap stays flagged for a human instead.
 *
 * Net effect: AP = max(rate, invoiced). This intentionally breaks the older
 * "the Ramp file must sum to the vendor's invoice" rule (see I260810797) in the
 * under-billed direction only, so any Ramp-vs-invoice gap is always a top-up to
 * contract and is always flagged.
 *
 * Lines with no rate to compare against — extras, deep cleans, Double Cleans,
 * labor/operating expense, credits — are NOT routed through here; there is no
 * contract amount for them, so they keep paying the invoiced figure.
 */
export function apPayForRatedLine(rawAmount: number, cleanerPay: number): { amount: number; toppedUp: boolean } {
  if (round2(cleanerPay - rawAmount) > PENNY) {
    return { amount: round2(cleanerPay), toppedUp: true }
  }
  return { amount: round2(rawAmount), toppedUp: false }
}

// ─── Subtotal gate ────────────────────────────────────────────────────────────

export function validateSubtotal(
  lines: Array<{ rawAmount: number }>,
  statedSubtotal: number | null,
): { ok: boolean; sum: number; diff: number } {
  const sum = round2(lines.reduce((acc, l) => acc + l.rawAmount, 0))
  if (statedSubtotal == null) return { ok: true, sum, diff: 0 }
  const diff = round2(sum - statedSubtotal)
  return { ok: Math.abs(diff) <= PENNY, sum, diff }
}

// ─── Classification + money math ─────────────────────────────────────────────

function needsReview(line: EngineLine, flag: string): EngineLine {
  return {
    ...line,
    flags: line.flags.includes(flag) ? line.flags : [...line.flags, flag],
    reviewStatus: 'needs_review',
  }
}

function flag(line: EngineLine, f: string): EngineLine {
  return { ...line, flags: line.flags.includes(f) ? line.flags : [...line.flags, f] }
}

// Reason-required extras with no derivable reason go to review so a human
// supplies one (review_note is appended to the exported service title).
function requireReason(line: EngineLine, note: string | null): EngineLine {
  if (
    line.serviceType != null &&
    REASON_REQUIRED_EXTRAS.has(line.serviceType) &&
    extraReasonFromNote(note, line.serviceType) == null
  ) {
    return needsReview(line, FLAGS.REASON_REQUIRED)
  }
  return line
}

function baseLine(raw: RawLine): EngineLine {
  return {
    ...raw,
    splitGroup: null,
    propertyId: null,
    aliasConfidence: null,
    matchedTaskId: null,
    serviceType: null,
    lineKind: 'clean',
    cleanerPayAmount: null,
    clientChargeAmount: null,
    billingChannel: null,
    flags: [],
    reviewStatus: 'ok',
  }
}

function withChannel(line: EngineLine, property: PropertyRates | null): EngineLine {
  const channel = property?.billingChannel ?? null
  const out = { ...line, billingChannel: channel ?? 'none' as BillingChannel }
  if (line.lineKind === 'operating_expense' || line.lineKind === 'excluded') return out
  if (!channel || channel === 'none') return needsReview(out, FLAGS.NO_BILLING_CHANNEL)
  return out
}

// Classify one resolved vendor line into 1–2 output lines. `splitSeq` supplies
// the split_group id when a combined line splits into base + extra.
export function classifyLine(
  raw: RawLine,
  resolution: PropertyResolution,
  property: PropertyRates | null,
  matchedTask: TaskRow | null,
  splitSeq: () => number,
): EngineLine[] {
  let line = baseLine(raw)
  line.propertyId = resolution.propertyId
  line.aliasConfidence = resolution.via === 'fuzzy' ? resolution.confidence : null
  line.matchedTaskId = matchedTask?.externalId ?? null
  if (resolution.via === 'fuzzy' && (resolution.confidence ?? 0) < 0.9) {
    line = flag(line, FLAGS.LOW_CONFIDENCE_ALIAS)
  }

  const text = `${raw.rawPropertyText ?? ''} ${raw.rawNoteText ?? ''}`

  // Credits/refunds (negative amounts) — the spec doesn't define how a vendor
  // credit maps to AR, so never guess: pass the amount through to the AP side
  // and force human review.
  if (raw.rawAmount < 0) {
    line.lineKind = 'extra'
    line.serviceType = 'Reimbursement'
    line.cleanerPayAmount = round2(raw.rawAmount)
    line.clientChargeAmount = null
    return [withChannel(requireReason(needsReview(line, FLAGS.CREDIT_LINE), raw.rawNoteText), property)]
  }

  // Unresolved property: bulk/ops-expense text → operating expense list;
  // anything else is a probable misspelling → review queue.
  if (resolution.propertyId == null || property == null) {
    if (isOperatingExpenseText(text)) {
      line.lineKind = 'operating_expense'
      line.serviceType = null
      line.cleanerPayAmount = round2(raw.rawAmount) // still owed to the vendor
      line.clientChargeAmount = null
      return [withChannel(flag(line, FLAGS.OPERATING_EXPENSE), null)]
    }
    line.lineKind = 'clean'
    return [withChannel(needsReview(line, FLAGS.UNRESOLVED_PROPERTY), null)]
  }

  const cleanerPay = property.cleanerPay ?? null
  const ceCharged = property.ceCharged ?? null

  // Excluded task types — unless the amount is within $5 of the property's
  // clean rate (mislabeled real clean on the same date).
  const excludedText = isExcludedTitle(raw.rawNoteText) || isExcludedTitle(raw.rawPropertyText) ||
    (matchedTask ? isExcludedTitle(matchedTask.title) : false)
  if (excludedText) {
    if (cleanerPay != null && Math.abs(raw.rawAmount - cleanerPay) <= RELABEL_TOLERANCE) {
      line = flag(line, FLAGS.RELABELED_AS_CLEAN)
      // falls through to normal clean handling below
    } else {
      line.lineKind = 'excluded'
      line.reviewStatus = 'excluded'
      line.cleanerPayAmount = null
      line.clientChargeAmount = null
      return [withChannel(line, property)]
    }
  }

  // Service title: task title wins (property+date matched), else note text.
  const std =
    (matchedTask ? standardizeTitle(matchedTask.title) : null) ??
    standardizeTitle(raw.rawNoteText) ??
    standardizeTitle(raw.rawPropertyText)
  const noteExtra = extraTitleFromNote(raw.rawNoteText)
  if (!matchedTask && line.lineKind !== 'operating_expense') {
    line = flag(line, FLAGS.UNMATCHED_TASK)
  }

  // Deep classification: the matched task's verdict wins over note text —
  // "deep clean of the fridge" in a note must not silently 3× the client
  // charge on a regular clean. Note-vs-task conflicts and deep cleans with no
  // task at all are review cases (large money swing), never silent.
  const noteSaysDeep = /deep\s*clean/i.test(text)
  const taskSaysDeep = matchedTask?.isDeepClean ?? false
  const deepConflict = matchedTask != null && !taskSaysDeep && noteSaysDeep
  const isDeep = matchedTask ? taskSaysDeep : noteSaysDeep
  const isDouble = /double\s*clean/i.test(text)
  const isOnboarding = std?.title === 'Onboarding Clean'

  // Deep / Double / Onboarding: billed whole, never split.
  if (isDeep || deepConflict || isDouble || isOnboarding) {
    const asDeep = isDeep || deepConflict
    line.lineKind = asDeep ? 'deep_clean' : 'extra'
    line.serviceType = asDeep ? 'Deep Clean' : isDouble ? 'Double Clean' : 'Onboarding Clean'
    line.cleanerPayAmount = round2(raw.rawAmount)
    if (asDeep) {
      const deepCe = property.deepClean3xCe ?? (ceCharged != null ? round2(ceCharged * 3) : null)
      line.clientChargeAmount = deepCe
      if (deepCe == null) line = needsReview(line, FLAGS.MISSING_RATE)
      if (deepConflict) line = needsReview(line, FLAGS.DEEP_MISMATCH)
      if (!matchedTask) line = needsReview(line, FLAGS.UNMATCHED_TASK)
    } else if (isOnboarding) {
      // Onboarding Clean: client billed at Client Charged + $50 AND the
      // cleaner paid at Cleaner Pay + $50 (Jordan 2026-08-17 — the surcharge
      // flows through both sides). Rendered as TWO rows — base plus a $50
      // surcharge line, both titled "Onboarding Clean" — because Finance
      // requires extras broken out (Nina's real QBO sheet #1085 shape).
      if (ceCharged == null || cleanerPay == null) {
        line.clientChargeAmount = null
        line = needsReview(line, FLAGS.MISSING_RATE)
        return [withChannel(line, property)]
      }
      // A vendor amount at or under the $50 surcharge can't be split sanely.
      if (raw.rawAmount <= 50) {
        line.clientChargeAmount = round2(ceCharged + 50)
        line.cleanerPayAmount = round2(raw.rawAmount)
        return [withChannel(needsReview(line, FLAGS.DISCREPANCY_UNEXPLAINED), property)]
      }
      const group = splitSeq()
      // The $50 surcharge rides its own row, so the base row is an ordinary
      // rated clean: pay max(rate, invoiced − 50), same floor as above. The
      // group therefore sums to the vendor's amount only when they billed at
      // or above rate + 50; a top-up is flagged rather than absorbed.
      const baseAp = apPayForRatedLine(round2(raw.rawAmount - 50), cleanerPay)
      let base: EngineLine = {
        ...line,
        splitGroup: group,
        lineKind: 'combined_split',
        cleanerPayAmount: baseAp.amount,
        clientChargeAmount: round2(ceCharged),
        flags: [...line.flags, FLAGS.COMBINED_SPLIT, ...(baseAp.toppedUp ? [FLAGS.PAID_AT_RATE] : [])],
      }
      if (Math.abs(raw.rawAmount - (cleanerPay + 50)) > PENNY) {
        base = needsReview(base, FLAGS.DISCREPANCY_UNEXPLAINED)
      }
      // The surcharge row carries the $50 on BOTH sides. rawAmount 0: the
      // base row keeps the vendor's whole stated amount for the subtotal sum
      // (split extras are excluded from it).
      const surcharge: EngineLine = {
        ...baseLine(raw),
        splitGroup: group,
        propertyId: line.propertyId,
        aliasConfidence: line.aliasConfidence,
        matchedTaskId: line.matchedTaskId,
        lineKind: 'extra',
        serviceType: 'Onboarding Clean',
        rawAmount: 0,
        rawNoteText: 'Onboarding surcharge',
        cleanerPayAmount: 50,
        clientChargeAmount: 50,
        flags: [FLAGS.COMBINED_SPLIT],
        reviewStatus: 'ok',
      }
      return [withChannel(base, property), withChannel(surcharge, property)]
    } else {
      // Double Clean client rate still unconfirmed — bill whole at the
      // invoiced amount and mark it so the review UI shows it. Finance also
      // requires a stated reason on Double Clean lines.
      line.clientChargeAmount = round2(raw.rawAmount)
      line = requireReason(flag(line, FLAGS.BILLED_WHOLE), raw.rawNoteText)
    }
    return [withChannel(line, property)]
  }

  // Standalone extra (Touch Up, Hot Tub Refresh, Trash Pickup… no base bundled).
  const stdIsExtra = std?.isExtra ?? false
  const looksLikeStandaloneExtra =
    stdIsExtra || (noteExtra != null && std == null)
  if (looksLikeStandaloneExtra) {
    line.lineKind = 'extra'
    line.serviceType = noteExtra ?? std?.title ?? 'Extra Cleaning'
    line.cleanerPayAmount = round2(raw.rawAmount)
    line.clientChargeAmount = round2(raw.rawAmount)
    // A bare "onboarding" note with no matched task is ambiguous: a WHOLE
    // onboarding clean should bill at Client Charged + $50 (two rows), not at
    // the vendor amount. Never guess between the two — review decides.
    if (line.serviceType === 'Onboarding Clean') {
      return [withChannel(needsReview(line, FLAGS.UNMATCHED_TASK), property)]
    }
    return [withChannel(requireReason(line, raw.rawNoteText), property)]
  }

  // Base clean path.
  line.serviceType = std?.title ?? (matchedTask ? 'Turn Clean' : null)
  if (line.serviceType == null) line = needsReview(line, FLAGS.UNMATCHED_TASK)

  if (cleanerPay == null || ceCharged == null || cleanerPay <= 0 || ceCharged <= 0) {
    line.lineKind = 'clean'
    // The rate is the authority for AP, so with no rate on file there is no
    // authoritative amount — leave pay blank rather than copying the invoice.
    // approve.ts already refuses to approve a billed line with no pay, so this
    // must be resolved by hand (set the property's rate, or set the pay on the
    // line) before it can export.
    line.cleanerPayAmount = null
    line.clientChargeAmount = ceCharged != null && ceCharged > 0 ? round2(ceCharged) : null
    return [withChannel(needsReview(line, FLAGS.MISSING_RATE), property)]
  }

  const diff = round2(raw.rawAmount - cleanerPay)

  // Exact match: simple base clean at Client Charged.
  if (Math.abs(diff) <= PENNY) {
    line.lineKind = 'clean'
    line.cleanerPayAmount = round2(cleanerPay)
    line.clientChargeAmount = round2(ceCharged)
    return [withChannel(line, property)]
  }

  // Overage WITH an explaining note → combined line: split into base @ Client
  // Charged + extra = invoiced − Cleaner Pay.
  if (diff > 0 && noteExtra != null) {
    const group = splitSeq()
    const base: EngineLine = {
      ...line,
      splitGroup: group,
      lineKind: 'combined_split',
      cleanerPayAmount: round2(cleanerPay),
      clientChargeAmount: round2(ceCharged),
      flags: [...line.flags, FLAGS.COMBINED_SPLIT],
    }
    const extra: EngineLine = {
      ...baseLine(raw),
      splitGroup: group,
      propertyId: line.propertyId,
      aliasConfidence: line.aliasConfidence,
      matchedTaskId: line.matchedTaskId,
      lineKind: 'extra',
      serviceType: noteExtra,
      rawAmount: diff,
      cleanerPayAmount: diff,
      clientChargeAmount: diff,
      flags: [FLAGS.COMBINED_SPLIT],
      reviewStatus: 'ok',
    }
    return [withChannel(base, property), withChannel(requireReason(extra, raw.rawNoteText), property)]
  }

  // Underage WITH an explaining extra-note → the base clean was billed
  // elsewhere; treat this line as a standalone extra (never a negative
  // split). Still a review case: a spurious keyword hit here would otherwise
  // silently underpay the vendor and bill the client a fabricated extra.
  if (diff < 0 && noteExtra != null) {
    line.lineKind = 'extra'
    line.serviceType = noteExtra
    line.cleanerPayAmount = round2(raw.rawAmount)
    line.clientChargeAmount = round2(raw.rawAmount)
    return [withChannel(requireReason(needsReview(line, FLAGS.NEGATIVE_SPLIT_STANDALONE), raw.rawNoteText), property)]
  }

  // Amount differs from Cleaner Pay with NO explaining note → discrepancy.
  // AP pays max(rate, invoiced) via apPayForRatedLine: the Ops rate is the
  // contract and acts as a floor, so an under-billing vendor is still paid in
  // full (flagged `paid_at_rate`), while an over-billing one is paid what they
  // asked rather than having their invoice silently cut. Either way the gap is
  // the review question and stays visible; the client side bills at Client
  // Charged regardless.
  line.lineKind = 'clean'
  const ap = apPayForRatedLine(raw.rawAmount, cleanerPay)
  line.cleanerPayAmount = ap.amount
  line.clientChargeAmount = round2(ceCharged)
  if (ap.toppedUp) line = flag(line, FLAGS.PAID_AT_RATE)
  return [withChannel(needsReview(line, FLAGS.DISCREPANCY_UNEXPLAINED), property)]
}

// ─── Draft generation (the "suggested invoice" path — no vendor file at all) ──

export function generateDraftLines(
  tasks: TaskRow[],
  propertiesById: Map<number, PropertyRates>,
): RawLine[] {
  const out: RawLine[] = []
  let lineNo = 1
  const sorted = [...tasks]
    .filter(t => (t.isClean || t.isDeepClean) && t.propertyId != null)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || (a.propertyId! - b.propertyId!))
  for (const t of sorted) {
    const p = propertiesById.get(t.propertyId!)
    const pay = p?.cleanerPay ?? null
    if (t.isDeepClean) {
      // No stored deep-clean pay rate — default to 3× cleaner pay, flagged for
      // review downstream (DEEP_RATE_ASSUMED is applied in reconcile()).
      out.push({
        lineNo: lineNo++,
        source: 'generated',
        rawPropertyText: p?.name ?? String(t.propertyId),
        rawNoteText: `Deep clean on ${t.dueDate ?? 'unknown date'} (${t.title})`,
        rawAmount: pay != null ? round2(pay * 3) : 0,
        rawDateMentioned: t.dueDate,
      })
    } else {
      // Onboarding cleans pay the cleaner $50 above Cleaner Pay — the draft
      // must state that amount or reconcile would flag its own suggestion.
      const isOnboardingTask = standardizeTitle(t.title)?.title === 'Onboarding Clean'
      out.push({
        lineNo: lineNo++,
        source: 'generated',
        rawPropertyText: p?.name ?? String(t.propertyId),
        rawNoteText: `${t.title} on ${t.dueDate ?? 'unknown date'}`,
        rawAmount: pay != null ? round2(isOnboardingTask ? pay + 50 : pay) : 0,
        rawDateMentioned: t.dueDate,
      })
    }
  }
  return out
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export function reconcile(input: EngineInput): { lines: EngineLine[]; summary: RunSummary } {
  const threshold = input.fuzzyThreshold ?? FUZZY_CONFIRM_THRESHOLD
  const propsById = new Map(input.properties.map(p => [p.id, p]))
  let splitCounter = 0
  const splitSeq = () => ++splitCounter

  const outLines: EngineLine[] = []
  for (const raw of input.lines) {
    const resolution = resolveProperty(
      raw.rawPropertyText,
      input.aliases,
      input.properties,
      input.vendorId,
      threshold,
    )
    const property = resolution.propertyId != null ? propsById.get(resolution.propertyId) ?? null : null
    const noteDate = raw.rawDateMentioned ?? extractDateFromText(raw.rawNoteText)
    const preferDeep = /deep\s*clean/i.test(`${raw.rawNoteText ?? ''}`)
    const task = matchToTask(resolution.propertyId, noteDate ?? null, input.tasks, preferDeep)
    let classified = classifyLine({ ...raw, rawDateMentioned: noteDate }, resolution, property, task, splitSeq)
    if (raw.source === 'generated') {
      classified = classified.map(l =>
        l.lineKind === 'deep_clean' ? { ...l, flags: [...l.flags, FLAGS.DEEP_RATE_ASSUMED] } : l,
      )
    }
    outLines.push(...classified)
  }

  const active = outLines.filter(l => l.lineKind !== 'excluded')
  const matched = active.filter(l => l.lineKind !== 'operating_expense')
  const totalInvoiced = round2(input.lines.reduce((a, l) => a + l.rawAmount, 0))
  const totalCleanerPay = round2(active.reduce((a, l) => a + (l.cleanerPayAmount ?? 0), 0))
  const totalClientCharge = round2(matched.reduce((a, l) => a + (l.clientChargeAmount ?? 0), 0))
  // Net over/under vs what we owe: each original vendor line counted once
  // (split base rows carry the full raw amount; split extras only add their
  // pay side, which is how a fully-explained split nets to zero).
  const activeRawTotal = round2(
    active.reduce((a, l) => (l.splitGroup != null && l.lineKind === 'extra' ? a : a + l.rawAmount), 0),
  )
  const netDiscrepancy = round2(activeRawTotal - totalCleanerPay)
  const summary: RunSummary = {
    totalInvoiced,
    totalCleanerPay,
    totalClientCharge,
    netDiscrepancy,
    needsReviewCount: outLines.filter(l => l.reviewStatus === 'needs_review').length,
    operatingExpenseTotal: round2(
      outLines.filter(l => l.lineKind === 'operating_expense').reduce((a, l) => a + l.rawAmount, 0),
    ),
  }
  return { lines: outLines, summary }
}
