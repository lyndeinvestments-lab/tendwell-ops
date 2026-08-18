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

export interface ExportRun {
  vendorName: string
  vendorInvoiceNumber: string | null // the vendor's own invoice number
  invoiceDate: string | null // yyyy-mm-dd
  dueDate: string | null // yyyy-mm-dd (Due On Receipt → same as invoice date)
  qboInvoiceNo: number | null // OUR sequential AR invoice number
  periodEnd: string | null
}

export interface ExportLine {
  lineKind: LineKind
  serviceType: string | null
  serviceDate: string | null // yyyy-mm-dd
  propertyName: string | null
  propertyId?: number | null // needed for manual QBO class links
  clientName: string | null
  billingChannel: BillingChannel | null
  cleanerPayAmount: number | null
  clientChargeAmount: number | null
  note: string | null
  reviewNote?: string | null // human review note — doubles as the stated reason
  reviewStatus: string
}

// Finance requires certain extras to carry their reason IN the title —
// "Pet Fee (excess dog hair)" — exactly as Nina's real QBO sheet (#1085) does.
// Precedence: the human review note, else the reason derived from the vendor
// note. A missing reason was already flagged for review upstream, so a bare
// title here means a human explicitly approved it without one.
export function serviceTitle(l: ExportLine): string {
  const title = l.serviceType ?? ''
  if (!title || !REASON_REQUIRED_EXTRAS.has(title)) return title
  const reason = l.reviewNote?.trim() || extraReasonFromNote(l.note, title)
  return reason ? `${title} (${reason})` : title
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
  return l.lineKind !== 'excluded' && l.cleanerPayAmount != null && l.cleanerPayAmount !== 0
}

function isArLine(l: ExportLine, channel: BillingChannel): boolean {
  return (
    l.billingChannel === channel &&
    l.lineKind !== 'excluded' &&
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
  const rows = lines.filter(isApLine).map(l => ({
    'Vendor name': s(run.vendorName),
    'Description (optional)': `Cleaning services${run.periodEnd ? ` — week ending ${run.periodEnd}` : ''}`,
    'Invoice number': s(run.vendorInvoiceNumber ?? ''),
    'Invoice date': run.invoiceDate ?? '',
    'Accounting date (optional)': run.invoiceDate ?? '',
    'Due date': run.dueDate ?? run.invoiceDate ?? '',
    'Currency': 'USD',
    'Line item amount': (l.cleanerPayAmount ?? 0).toFixed(2),
    'QuickBooks Category (optional)': '',
    'QuickBooks Billable (optional)': '',
    'QuickBooks Class (optional)': s(qboClassFor(l.propertyName, l.propertyId ?? null, knownClasses)),
    'QuickBooks Customer/Job (optional)': '',
    'Line item description': withNote(l.serviceType ?? '', l.note),
    'Inventory line item quantity': '',
    'Inventory line item rate': '',
    'QuickBooks Inventory Item (optional)': '',
    'Vendor memo (optional)': '',
    'Payment method (optional)': '',
  }))
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
  const invoiceDate = fmtUsDate(run.invoiceDate)
  const dueDate = fmtUsDate(run.dueDate ?? run.invoiceDate)
  const rows = lines.filter(l => isArLine(l, 'qbo_haven')).map(l => [
    s(serviceTitle(l)),
    fmtUsDate(l.serviceDate),
    s(l.propertyName ?? ''),
    fmtUsd(l.clientChargeAmount ?? 0),
    s(qboClassFor(l.propertyName, l.propertyId ?? null, knownClasses)),
    run.qboInvoiceNo != null ? String(run.qboInvoiceNo) : '',
    'Haven',
    invoiceDate,
    dueDate,
  ])
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
  const invNo = run.qboInvoiceNo != null ? String(run.qboInvoiceNo) : ''
  const rows = arLines.map((l, i) => [
    invNo,
    i === 0 ? 'Haven' : '',
    i === 0 ? fmtUsDate(run.invoiceDate) : '',
    i === 0 ? fmtUsDate(run.dueDate ?? run.invoiceDate) : '',
    i === 0 ? 'Due on receipt' : '',
    '',
    i === 0 ? s(`${run.vendorName} ${run.vendorInvoiceNumber ?? ''}`.trim()) : '',
    s(l.serviceType ?? ''),
    withNote(l.propertyName ?? '', l.note),
    '1',
    (l.clientChargeAmount ?? 0).toFixed(2),
    (l.clientChargeAmount ?? 0).toFixed(2),
    fmtUsDate(l.serviceDate),
  ])
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
  const rows = lines
    .filter(l => isArLine(l, 'bill_com'))
    .sort((a, b) => (a.clientName ?? '').localeCompare(b.clientName ?? '') || (a.serviceDate ?? '').localeCompare(b.serviceDate ?? ''))
    .map(l => [
      s(l.clientName ?? ''),
      fmtUsDate(run.invoiceDate),
      fmtUsDate(run.dueDate ?? run.invoiceDate),
      s(serviceTitle(l)),
      fmtUsDate(l.serviceDate),
      s(l.propertyName ?? ''),
      withNote('', l.note),
      (l.clientChargeAmount ?? 0).toFixed(2),
    ])
  return Papa.unparse({ fields: BILLCOM_HEADERS, data: rows }, { newline: '\r\n' })
}
