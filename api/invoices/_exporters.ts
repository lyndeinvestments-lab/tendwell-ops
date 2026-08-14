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
  clientName: string | null
  billingChannel: BillingChannel | null
  cleanerPayAmount: number | null
  clientChargeAmount: number | null
  note: string | null
  reviewStatus: string
}

// CSV formula-injection guard: vendor-authored free text (notes, invoice
// numbers, property strings) flows into files Nina opens in Excel before
// importing. Any text cell starting with =, +, @, tab, or CR — or a '-' that
// isn't just a negative number — gets a leading apostrophe so spreadsheet
// apps render it as text instead of executing it. Our own generated numeric
// strings (amounts, dates) never hit this path.
export function sanitizeCell(v: string): string {
  if (!v) return v
  const first = v[0]
  if (first === '=' || first === '+' || first === '@' || first === '\t' || first === '\r') return `'${v}`
  if (first === '-' && !/^-\d+(\.\d+)?$/.test(v)) return `'${v}`
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

function lineDescription(l: ExportLine): string {
  const parts = [l.serviceType, l.propertyName].filter(Boolean)
  const base = parts.join(' — ')
  return sanitizeCell(l.note ? (base ? `${base} (${l.note})` : l.note) : base)
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

export function toRampCsv(run: ExportRun, lines: ExportLine[]): string {
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
    'QuickBooks Class (optional)': s(l.propertyName ?? ''),
    'QuickBooks Customer/Job (optional)': '',
    'Line item description': lineDescription(l),
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

export function toQboFlatCsv(run: ExportRun, lines: ExportLine[]): string {
  const invoiceDate = fmtUsDate(run.invoiceDate)
  const dueDate = fmtUsDate(run.dueDate ?? run.invoiceDate)
  const rows = lines.filter(l => isArLine(l, 'qbo_haven')).map(l => [
    s(l.serviceType ?? ''),
    fmtUsDate(l.serviceDate),
    s(l.propertyName ?? ''),
    fmtUsd(l.clientChargeAmount ?? 0),
    s(l.propertyName ?? ''),
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
    lineDescription(l),
    '1',
    (l.clientChargeAmount ?? 0).toFixed(2),
    (l.clientChargeAmount ?? 0).toFixed(2),
    fmtUsDate(l.serviceDate),
  ])
  return Papa.unparse({ fields: QBO_ML_HEADERS, data: rows }, { newline: '\r\n' })
}

// ─── bill.com (PLACEHOLDER — real import template TBD from Nina) ─────────────
// Minimal generic AR shape, grouped by client, so non-Haven lines always have
// somewhere to land. Swap the columns for the real template when it arrives.
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
      s(l.serviceType ?? ''),
      fmtUsDate(l.serviceDate),
      s(l.propertyName ?? ''),
      lineDescription(l),
      (l.clientChargeAmount ?? 0).toFixed(2),
    ])
  return Papa.unparse({ fields: BILLCOM_HEADERS, data: rows }, { newline: '\r\n' })
}
