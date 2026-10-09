// Pure CSV formatters over one reconciled dataset. No I/O — export.ts joins
// names and passes plain rows in, so each formatter is snapshot-testable.
//
// Three destinations:
//   Ramp     — AP: pay the vendor (cleaner_pay_amount lines)
//   QBO      — AR: bill Haven (billing_channel='qbo_haven', client_charge_amount)
//   bill.com — AR: bill non-Haven clients (billing_channel='bill_com') — the
//              real template is TBD; this emitter is a placeholder so those
//              lines are never silently dropped.

import Papa from 'papaparse'
import { extraReasonFromNote, REASON_REQUIRED_EXTRAS } from './_engine.js'
import type { BillingChannel, LineKind } from './_engine.js'
import { billComLineSendable, heldLineNumbers, stateMap, type ClientInvoiceState } from '../../shared/billcom-send.js'
import { CREDIT_SERVICE_TYPE, isCreditLine } from './_credits.js'

export interface ExportRun {
  vendorName: string
  vendorInvoiceNumber: string | null // the vendor's own invoice number
  invoiceDate: string | null // yyyy-mm-dd
  dueDate: string | null // yyyy-mm-dd (Due On Receipt → same as invoice date)
  qboInvoiceNo: number | null // OUR sequential AR invoice number
  // One AR invoice number per service month ("2026-09" → 1096). Haven books
  // every vendor by month and rejects an invoice mixing two (Jo, 2026-10-06).
  // Absent → every row uses qboInvoiceNo (single-month runs, old runs).
  qboInvoiceNos?: Readonly<Record<string, number>> | null
  periodEnd: string | null
  // bill.com send control (shared/billcom-send.ts): the run's stored client
  // invoices. Present → the bill.com worksheet lists only lines whose client
  // invoice is APPROVED (not held, not already sent) and that carry no hold
  // reason. Absent/null → the client_invoices table isn't there yet
  // (migration pending) and the worksheet lists every bill.com line, as before.
  billComInvoices?: ReadonlyArray<ClientInvoiceState> | null
}

export interface ExportLine {
  lineKind: LineKind
  serviceType: string | null
  serviceDate: string | null // yyyy-mm-dd
  propertyName: string | null
  // The vendor's own property-cell text — the only identity a line has when
  // no Ops property resolved (labor blocks, unresolved names).
  rawPropertyText?: string | null
  propertyId?: number | null // needed for manual QBO class links
  clientName: string | null
  billingChannel: BillingChannel | null
  cleanerPayAmount: number | null
  clientChargeAmount: number | null
  note: string | null
  reviewNote?: string | null // human review note — doubles as the stated reason
  reviewStatus: string
  splitGroup?: number | null // links base+extra rows split from one vendor line
  flags?: string[] | null
  lineNo?: number | null // vendor line number (split rows share it)
  contactId?: string | null // the property's client: who the bill.com invoice is for
  billHoldReason?: string | null // non-blank → held back from bill.com
}

// ─── Month split ──────────────────────────────────────────────────────────────

export function serviceMonth(l: Pick<ExportLine, 'serviceDate'>, fallback: string | null): string {
  return (l.serviceDate ?? fallback ?? '').slice(0, 7)
}

/** Last calendar day of a yyyy-mm month. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0))
  return d.toISOString().slice(0, 10)
}

/** Invoice date for one month's slice of a run: the run's invoice date, but
 *  never later than the end of the service month — September's cleans are
 *  dated in September so they land in September's books (cf. Inv 1090, which
 *  Haven had to move into August by hand). */
export function invoiceDateForMonth(runInvoiceDate: string | null, month: string): string | null {
  if (!month) return runInvoiceDate
  const end = monthEnd(month)
  if (!runInvoiceDate) return end
  return runInvoiceDate < end ? runInvoiceDate : end
}

/** The distinct service months among a set of lines, ascending. */
export function monthsOf(lines: ExportLine[], fallback: string | null): string[] {
  return [...new Set(lines.map(l => serviceMonth(l, fallback)).filter(Boolean))].sort()
}

function invoiceNoFor(run: ExportRun, month: string): string {
  const n = run.qboInvoiceNos?.[month] ?? run.qboInvoiceNo
  return n != null ? String(n) : ''
}

// Charges Haven has to assign either to the OWNER or to itself. Their title
// carries the reason AND the property so Finance can decide from the line
// alone (Christine, 2026-10-08) — a UPS reimbursement or a towel run that
// doesn't say where or why can't be booked.
export const PROPERTY_IN_TITLE: ReadonlySet<string> = new Set([
  'Reimbursement',
  'Trip Fee',
  'Mailed Left Items by the Guest',
])

const URL_RE = /https?:\/\/[^\s)]+/gi

/** Slack / Quo / receipt links in a review note — they go in the
 *  description (Haven follows them to see who the guest was), never the title. */
export function linksIn(text: string | null | undefined): string[] {
  return text ? [...new Set(text.match(URL_RE) ?? [])] : []
}

/** A reason fit for a client-facing title: links removed (they go in the
 *  description), our own bookkeeping — "(orig: Deliver towel)", "(Jordan,
 *  2026-10-05)" — removed, whitespace and stray punctuation tidied. */
export function cleanReason(text: string | null | undefined): string | null {
  if (!text) return null
  const out = text
    .replace(URL_RE, ' ')
    .replace(/\(\s*orig:[^)]*\)/gi, ' ')
    .replace(/\(\s*[A-Z][a-z]+,?\s*\d{4}-\d{2}-\d{2}\s*\)/g, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:;,.]+|[\s\-–—:;,.]+$/g, '')
    .trim()
  return out.length >= 3 ? out : null
}

/** The stated reason for an extra that must carry one: the human review note
 *  wins, else the reason derived from the vendor note. */
export function lineReason(l: Pick<ExportLine, 'serviceType' | 'reviewNote' | 'note'>): string | null {
  const t = l.serviceType
  if (!t || !(REASON_REQUIRED_EXTRAS.has(t) || PROPERTY_IN_TITLE.has(t))) return null
  return cleanReason(l.reviewNote) ?? cleanReason(extraReasonFromNote(cleanReason(l.note), t))
}

/** A credit line's reason: the adjustment's reason is stored as the line note
 *  (the review note carries the same reason plus the evidence link). */
function creditReason(l: Pick<ExportLine, 'note' | 'reviewNote'>): string | null {
  return cleanReason(l.note) ?? cleanReason(l.reviewNote)
}

const isOwnerStay = (l: Pick<ExportLine, 'flags'>) => !!l.flags?.includes('owner_stay')

/** Client-facing description. An owner-stay line LEADS with "Owner Stay -
 *  <service>" (Christine's wording, 2026-10-08) so Haven's QBO class rules
 *  can book it to the owner from the description alone; then the property,
 *  then what else sets the line apart (mid-stay trash, a valid onboarding
 *  fee) and, for owner-or-Haven charges, the evidence link. Haven's AP bot
 *  copies this text straight into Ramp, so it has to be right on its own. */
export function clientDescription(l: ExportLine): string {
  // A client credit (invoice_adjustments) says what it is for and links the
  // evidence, so the client can match it to the complaint or overcharge.
  if (isCreditLine(l)) {
    return ['Credit', l.propertyName ?? '', creditReason(l) ?? '', ...linksIn(l.reviewNote)].filter(Boolean).join(' – ')
  }
  const parts: string[] = []
  if (isOwnerStay(l)) parts.push(`Owner Stay - ${l.serviceType ?? 'Clean'}`)
  parts.push(l.propertyName ?? '')
  // Mid-stay trash is an OWNER charge; trash left at checkout is the guest's
  // (Jordan, 2026-07-15). Haven needs to tell them apart to bill the right party.
  if (l.serviceType === 'Excessive Trash Pickup' && /mid.?stay/i.test(l.note ?? '')) parts.push('Mid-Stay pickup')
  if (l.serviceType === 'Onboarding Clean' && l.lineKind === 'extra' && /first tendwell clean/i.test(l.note ?? '')) {
    parts.push('onboarding fee, first Tendwell clean')
  }
  if (l.serviceType && PROPERTY_IN_TITLE.has(l.serviceType)) parts.push(...linksIn(l.reviewNote))
  return parts.filter(Boolean).join(' – ')
}

// Line-item splits exist for QBO only (Jordan 2026-08-18): the vendor billed
// ONE line, so Ramp pays one line and the bill.com worksheet shows one line.
// Collapses each split group back onto its base row (the non-'extra' member),
// summing the given amount field across the group. Order is preserved.
function collapseSplits(
  lines: ExportLine[],
  pick: (l: ExportLine) => number | null,
  assign: (l: ExportLine, total: number) => ExportLine,
): ExportLine[] {
  const groupTotals = new Map<number, number>()
  for (const l of lines) {
    if (l.splitGroup == null) continue
    groupTotals.set(l.splitGroup, (groupTotals.get(l.splitGroup) ?? 0) + (pick(l) ?? 0))
  }
  const emitted = new Set<number>()
  const out: ExportLine[] = []
  for (const l of lines) {
    if (l.splitGroup == null) { out.push(l); continue }
    if (emitted.has(l.splitGroup)) continue
    const members = lines.filter(m => m.splitGroup === l.splitGroup)
    const base = members.find(m => m.lineKind !== 'extra') ?? members[0]
    emitted.add(l.splitGroup)
    out.push(assign(base, Math.round(groupTotals.get(l.splitGroup)! * 100) / 100))
  }
  return out
}

// Finance requires certain extras to carry their reason IN the title —
// "Pet Fee (excess dog hair)" — exactly as Nina's real QBO sheet (#1085) does.
// Owner-or-Haven charges also name the property: "Trip Fee (extra towels
// delivered) – John Bryan 4144". An owner charge leads with "Owner Stay - ".
// A missing reason was already flagged for review upstream, so a bare title
// here means a human explicitly approved it without one.
export function serviceTitle(l: ExportLine): string {
  if (isCreditLine(l)) {
    const reason = creditReason(l)
    return reason ? `${CREDIT_SERVICE_TYPE} (${reason})` : CREDIT_SERVICE_TYPE
  }
  const title = l.serviceType ?? ''
  if (!title) return title
  let out = title
  const reason = lineReason(l)
  if (reason) out = `${out} (${reason})`
  const prop = l.propertyName?.trim()
  if (prop && PROPERTY_IN_TITLE.has(title) && !(reason ?? '').toLowerCase().includes(prop.toLowerCase())) {
    out = `${out} – ${prop}`
  }
  return isOwnerStay(l) ? `Owner Stay - ${out}` : out
}

// CSV formula-injection guard: vendor-authored free text (notes, invoice
// numbers, property strings) flows into files Nina opens in Excel before
// importing. Any text cell starting with =, +, @, tab, or CR — or a '-' that
// isn't just a negative number — gets a leading SPACE so spreadsheet apps
// treat it as text instead of executing it. A space (not the classic
// apostrophe prefix) because these same files also get fed directly to the
// Ramp/QBO importers, which parse raw CSV: an apostrophe would be baked
// verbatim into the imported field, while a leading space is trimmed or
// harmless. Our own generated numeric strings (amounts, dates) never hit
// this path.
export function sanitizeCell(v: string): string {
  if (!v) return v
  const first = v[0]
  if (first === '=' || first === '+' || first === '@' || first === '\t' || first === '\r') return ` ${v}`
  if (first === '-' && !/^-\d+(\.\d+)?$/.test(v)) return ` ${v}`
  return v
}

// $#,##0.00 — QBO flat template requires the currency-formatted string.
export function fmtUsd(n: number): string {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const [int, dec] = abs.toFixed(2).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}$${grouped}.${dec}`
}

// yyyy-mm-dd → MM/DD/YYYY (QBO US-locale company files).
export function fmtUsDate(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return ''
  return `${m}/${d}/${y}`
}

function isApLine(l: ExportLine): boolean {
  // Everything we actually owe the vendor: cleans, extras, operating expenses.
  // Checks BOTH exclusion signals — line_kind='excluded' is the engine's own
  // (self-inspection/air-filter) exclusion, review_status='excluded' is a
  // human excluding a line (e.g. a caught duplicate) in review without the
  // engine ever reclassifying line_kind. A line excluded only the second way
  // used to still export at full amount (real case, 2026-09: four Aug 18
  // duplicate lines Nina marked excluded in review still went out on Ramp/QBO
  // because this check only ever looked at line_kind) — keep both checks.
  return (
    l.lineKind !== 'excluded' &&
    l.reviewStatus !== 'excluded' &&
    l.cleanerPayAmount != null &&
    l.cleanerPayAmount !== 0
  )
}

function isArLine(l: ExportLine, channel: BillingChannel): boolean {
  return (
    l.billingChannel === channel &&
    l.lineKind !== 'excluded' &&
    l.reviewStatus !== 'excluded' &&
    l.lineKind !== 'operating_expense' &&
    l.clientChargeAmount != null &&
    l.clientChargeAmount !== 0
  )
}

// Description cells never repeat what another column already carries
// (Jordan 2026-08-18: Ramp descriptions showed "Turn Clean — Property (note)"
// while the property was already in the Class column). Each format composes
// its own: Ramp = service, QBO multiline = property (Nina's flat-sheet
// Description convention), bill.com = just the note. The vendor note rides
// along in parentheses where present.
function withNote(base: string, note: string | null): string {
  return sanitizeCell(note ? (base ? `${base} (${note})` : note) : base)
}

// QBO Class resolution: the Class column must name a class that actually
// exists in QBO — an unknown value fails or auto-creates classes on import.
// Nina's own sheets leave Class blank for unmapped properties and sometimes
// use a shorter class name ("Brian Albaum" for property "Brian Albaum 442").
// Resolution: MANUAL link (qbo_classes.matched_property_id, set on the API
// Sync → QuickBooks tab) → exact case-insensitive match → unique word-boundary
// prefix match → blank. With no class list at all (the nightly
// qbo-classes-sync has never populated qbo_classes), fall back to the
// property name as before.
export interface QboClassRef {
  name: string
  matchedPropertyId?: number | null
}

export function qboClassFor(
  propertyName: string | null,
  propertyId: number | null,
  knownClasses?: ReadonlyArray<QboClassRef>,
): string {
  const prop = propertyName ?? ''
  if (!knownClasses) return prop
  if (propertyId != null) {
    const manual = knownClasses.find(k => k.matchedPropertyId === propertyId)
    if (manual) return manual.name
  }
  if (!prop) return ''
  const norm = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim()
  const p = norm(prop)
  const exact = knownClasses.find(k => norm(k.name) === p)
  if (exact) return exact.name
  const prefixes = knownClasses.filter(k => {
    const n = norm(k.name)
    return n.length > 0 && p.startsWith(`${n} `)
  })
  return prefixes.length === 1 ? prefixes[0].name : '' // ambiguous/unknown → never guess
}

const s = sanitizeCell

// ─── Ramp Bill Import ────────────────────────────────────────────────────────
// Header fields repeat on every line-item row (Ramp groups by invoice number).
const RAMP_HEADERS = [
  'Vendor name',
  'Description (optional)',
  'Invoice number',
  'Invoice date',
  'Accounting date (optional)',
  'Due date',
  'Currency',
  'Line item amount',
  'QuickBooks Category (optional)',
  'QuickBooks Billable (optional)',
  'QuickBooks Class (optional)',
  'QuickBooks Customer/Job (optional)',
  'Line item description',
  'Inventory line item quantity',
  'Inventory line item rate',
  'QuickBooks Inventory Item (optional)',
  'Vendor memo (optional)',
  'Payment method (optional)',
]

export function toRampCsv(run: ExportRun, lines: ExportLine[], knownClasses?: ReadonlyArray<QboClassRef>): string {
  const collapsed = collapseSplits(lines, l => l.cleanerPayAmount, (l, total) => ({ ...l, cleanerPayAmount: total }))
  const ap = collapsed.filter(isApLine)
  // A run spanning two months becomes one Ramp bill per month (invoice
  // number suffixed with the month) so each month's cost lands in that
  // month's books. Labor/expense lines carry the run's date → its month.
  const multiMonth = monthsOf(ap, run.invoiceDate).length > 1
  const rows = ap.map(l => {
    const month = serviceMonth(l, run.invoiceDate)
    const acctDate = multiMonth ? invoiceDateForMonth(run.invoiceDate, month) ?? '' : run.invoiceDate ?? ''
    return {
    'Vendor name': s(run.vendorName),
    'Description (optional)': `Cleaning services${run.periodEnd ? ` — week ending ${run.periodEnd}` : ''}${multiMonth ? ` (${month} services)` : ''}`,
    'Invoice number': s(multiMonth ? `${run.vendorInvoiceNumber ?? ''}-${month}` : run.vendorInvoiceNumber ?? ''),
    'Invoice date': run.invoiceDate ?? '',
    'Accounting date (optional)': acctDate,
    'Due date': run.dueDate ?? run.invoiceDate ?? '',
    'Currency': 'USD',
    'Line item amount': (l.cleanerPayAmount ?? 0).toFixed(2),
    'QuickBooks Category (optional)': '',
    'QuickBooks Billable (optional)': '',
    'QuickBooks Class (optional)': s(qboClassFor(l.propertyName, l.propertyId ?? null, knownClasses)),
    'QuickBooks Customer/Job (optional)': '',
    // The property name rides IN the description, not only in Class: Class is
    // deliberately blank when no QBO class matches (an unknown value fails or
    // auto-creates classes on import), and without the name here such a line
    // is anonymous in Ramp (real case: invoice I260819800 had 19 class-less
    // lines showing just "Departure Clean $100"). Labor/unresolved lines fall
    // back to the vendor's own text ("Irma Ispection 62.18x20") for the same
    // reason.
    'Line item description': withNote(
      [l.serviceType, l.propertyName ?? l.rawPropertyText].filter(Boolean).join(' — '),
      l.note,
    ),
    'Inventory line item quantity': '',
    'Inventory line item rate': '',
    'QuickBooks Inventory Item (optional)': '',
    'Vendor memo (optional)': '',
    'Payment method (optional)': '',
  }})
  return Papa.unparse({ fields: RAMP_HEADERS, data: rows.map(r => RAMP_HEADERS.map(h => (r as Record<string, string>)[h])) }, { newline: '\r\n' })
}

// ─── QBO flat template (Nina's current import mapping) ──────────────────────
const QBO_FLAT_HEADERS = [
  'Service',
  'Service Date',
  'Description',
  'Amount',
  'Class',
  'Invoice No.',
  'Customer',
  'Invoice Date',
  'Due Date',
]

export function toQboFlatCsv(run: ExportRun, lines: ExportLine[], knownClasses?: ReadonlyArray<QboClassRef>): string {
  const rows = lines.filter(l => isArLine(l, 'qbo_haven')).map(l => {
    const month = serviceMonth(l, run.invoiceDate)
    const invDate = fmtUsDate(invoiceDateForMonth(run.invoiceDate, month))
    return [
      s(serviceTitle(l)),
      fmtUsDate(l.serviceDate),
      s(clientDescription(l)),
      fmtUsd(l.clientChargeAmount ?? 0),
      s(qboClassFor(l.propertyName, l.propertyId ?? null, knownClasses)),
      invoiceNoFor(run, month),
      'Haven',
      invDate,
      invDate,
    ]
  })
  return Papa.unparse({ fields: QBO_FLAT_HEADERS, data: rows }, { newline: '\r\n' })
}

// ─── QBO official multi-line template ────────────────────────────────────────
// One invoice per run: InvoiceNo repeats on every row; Customer/dates/terms
// appear only on the first row of the invoice group (QBO's documented shape).
const QBO_ML_HEADERS = [
  '*InvoiceNo',
  '*Customer',
  '*InvoiceDate',
  '*DueDate',
  'Terms',
  'Location',
  'Memo',
  'Item(Product/Service)',
  'ItemDescription',
  'ItemQuantity',
  'ItemRate',
  '*ItemAmount',
  'Service Date',
]

export function toQboMultilineCsv(run: ExportRun, lines: ExportLine[]): string {
  const arLines = lines.filter(l => isArLine(l, 'qbo_haven'))
  // One invoice per service month, months in order, lines in run order.
  const months = monthsOf(arLines, run.invoiceDate)
  const rows: string[][] = []
  for (const month of months) {
    const group = arLines.filter(l => serviceMonth(l, run.invoiceDate) === month)
    const invDate = fmtUsDate(invoiceDateForMonth(run.invoiceDate, month))
    group.forEach((l, i) => rows.push([
      invoiceNoFor(run, month),
      i === 0 ? 'Haven' : '',
      i === 0 ? invDate : '',
      i === 0 ? invDate : '',
      i === 0 ? 'Due on receipt' : '',
      '',
      i === 0 ? s(`${run.vendorName} ${run.vendorInvoiceNumber ?? ''}`.trim()) : '',
      s(l.serviceType ?? ''),
      // Client-facing description: property (+ owner stay / onboarding
      // reason). Vendor notes are internal pricing chatter ("Regular clean
      // plus 205") — the ONLY note that belongs on the client invoice is a
      // reason-required extra's reason. Note-only lines still surface the note.
      withNote(
        clientDescription(l),
        lineReason(l) ?? (!l.propertyName && !l.serviceType ? l.note : null),
      ),
      '1',
      (l.clientChargeAmount ?? 0).toFixed(2),
      (l.clientChargeAmount ?? 0).toFixed(2),
      fmtUsDate(l.serviceDate),
    ]))
  }
  return Papa.unparse({ fields: QBO_ML_HEADERS, data: rows }, { newline: '\r\n' })
}

// ─── bill.com manual-entry worksheet ─────────────────────────────────────────
// bill.com has no CSV import (confirmed by Jordan 2026-08-14) — non-Haven
// lines are emitted as a worksheet grouped by client with everything needed
// to create the invoices manually in bill.com: client, dates, service,
// property, description, amount.
const BILLCOM_HEADERS = [
  'Customer',
  'Invoice Date',
  'Due Date',
  'Service',
  'Service Date',
  'Property',
  'Description',
  'Amount',
]

export function toBillComCsv(run: ExportRun, lines: ExportLine[]): string {
  // A hold set on any row of a split vendor line holds the whole line, so it
  // has to be read before the rows collapse onto their base.
  const held = heldLineNumbers(lines.filter(l => l.lineNo != null).map(l => ({ lineNo: l.lineNo!, billHoldReason: l.billHoldReason })))
  const collapsed = collapseSplits(lines, l => l.clientChargeAmount, (l, total) => ({ ...l, clientChargeAmount: total }))
  const states = run.billComInvoices ? stateMap(run.billComInvoices) : null
  const rows = collapsed
    .filter(l => isArLine(l, 'bill_com'))
    .filter(l => !states || billComLineSendable({
      contactId: l.contactId,
      serviceMonth: serviceMonth(l, run.invoiceDate),
      billHoldReason: l.billHoldReason ?? (l.lineNo != null && held.has(l.lineNo) ? 'held' : null),
    }, states))
    // Client, then MONTH (one bill.com invoice per client per month), then date.
    .sort((a, b) => (a.clientName ?? '').localeCompare(b.clientName ?? '') ||
      serviceMonth(a, run.invoiceDate).localeCompare(serviceMonth(b, run.invoiceDate)) ||
      (a.serviceDate ?? '').localeCompare(b.serviceDate ?? ''))
    .map(l => [
      s(l.clientName ?? ''),
      fmtUsDate(invoiceDateForMonth(run.invoiceDate, serviceMonth(l, run.invoiceDate))),
      fmtUsDate(invoiceDateForMonth(run.invoiceDate, serviceMonth(l, run.invoiceDate))),
      s(serviceTitle(l)),
      fmtUsDate(l.serviceDate),
      s(l.propertyName ?? ''),
      withNote('', l.note),
      (l.clientChargeAmount ?? 0).toFixed(2),
    ])
  return Papa.unparse({ fields: BILLCOM_HEADERS, data: rows }, { newline: '\r\n' })
}
