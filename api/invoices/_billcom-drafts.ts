// The bill.com invoice(s) Ops creates for one client invoice (one client, one
// service month, channel bill_com). Pure: no I/O.
//
// Built from the same rows as the bill.com worksheet (billComRows), and shaped
// like the invoices people typed by hand (2026-10-23 sample):
//   number   "<vendor invoice #>-<client initials>"  e.g. I261012825-AW
//   line     "Departure Clean, Ann Weber 2130, 10/12/2026", quantity 1
//   dates    invoice date = due date (Due On Receipt), as on the worksheet
// Held lines are left off, like the worksheet.
//
// HomeTeam gets one invoice per property (-HT01, -HT02…), by Jordan's call
// (2026-10-23): a fixed exception for that one client, not a setting.

import { fmtUsDate, type BillComRow } from './_exporters.js'
import { normalizeName } from '../../shared/billcom-customers.js'

const PER_PROPERTY_CLIENTS = new Set(['hometeam'])

export interface BillComDraftLine {
  description: string
  amount: number
}

export interface BillComDraft {
  invoiceNumber: string
  invoiceDate: string | null // yyyy-mm-dd, also the due date
  propertyName: string | null // per-property invoices only
  lines: BillComDraftLine[]
  total: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** "Ann Weber" → AW, "HomeTeam" → HT, "Hostimo" → HO. */
export function clientInitials(name: string | null | undefined): string {
  const words = (name ?? '').split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  const word = words[0] ?? ''
  const capitals = word.replace(/[^A-Z]/g, '')
  if (capitals.length >= 2) return capitals.slice(0, 2)
  return word.slice(0, 2).toUpperCase() || 'XX'
}

export function isPerPropertyClient(...names: Array<string | null | undefined>): boolean {
  return names.some((n) => PER_PROPERTY_CLIENTS.has(normalizeName(n).replace(/ /g, '')))
}

/** Each client on the run gets distinct initials; a second "AW" becomes "AW2". */
export function initialsByClient(rows: ReadonlyArray<Pick<BillComRow, 'contactId' | 'clientName'>>): Map<string, string> {
  const clients = new Map<string, string>()
  for (const r of rows) if (r.contactId && !clients.has(r.contactId)) clients.set(r.contactId, r.clientName ?? '')
  const ordered = Array.from(clients).sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))
  const used = new Map<string, number>()
  const out = new Map<string, string>()
  for (const [id, name] of ordered) {
    const base = clientInitials(name)
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    out.set(id, n === 1 ? base : `${base}${n}`)
  }
  return out
}

export function draftLineDescription(row: Pick<BillComRow, 'service' | 'propertyName' | 'serviceDate'>): string {
  return [row.service, row.propertyName?.trim(), fmtUsDate(row.serviceDate)].filter(Boolean).join(', ')
}

export function buildBillComDrafts(args: {
  vendorInvoiceNumber: string | null
  /** Every bill.com row on the run (billComRows), held ones included. */
  rows: ReadonlyArray<BillComRow>
  contactId: string
  serviceMonth: string
  clientName: string | null
  clientCompany?: string | null
}): { ok: true; drafts: BillComDraft[] } | { ok: false; error: string } {
  const vendorNo = args.vendorInvoiceNumber?.trim()
  if (!vendorNo) return { ok: false, error: 'This run has no vendor invoice number to number the bill.com invoice from' }

  const initials = initialsByClient(args.rows).get(args.contactId) ?? clientInitials(args.clientName)
  const clientRows = args.rows.filter((r) => r.contactId === args.contactId && !r.held && r.amount !== 0)
  // A run that crosses a month gives this client one invoice per month; the
  // month keeps their numbers apart.
  const months = new Set(clientRows.map((r) => r.serviceMonth))
  const monthSuffix = months.size > 1 ? `-${args.serviceMonth.slice(5, 7)}` : ''
  const mine = clientRows.filter((r) => r.serviceMonth === args.serviceMonth)
  if (mine.length === 0) return { ok: false, error: 'No unheld bill.com lines for this client and month' }

  const base = `${vendorNo}-${initials}`
  const draft = (number: string, rows: BillComRow[], propertyName: string | null): BillComDraft => ({
    invoiceNumber: number,
    invoiceDate: rows[0].invoiceDate,
    propertyName,
    lines: rows.map((r) => ({ description: draftLineDescription(r), amount: round2(r.amount) })),
    total: round2(rows.reduce((s, r) => s + r.amount, 0)),
  })

  if (!isPerPropertyClient(args.clientName, args.clientCompany)) {
    return { ok: true, drafts: [draft(`${base}${monthSuffix}`, mine, null)] }
  }
  const byProperty = new Map<string, BillComRow[]>()
  for (const r of mine) {
    const key = r.propertyName?.trim() || ''
    byProperty.set(key, [...(byProperty.get(key) ?? []), r])
  }
  const properties = Array.from(byProperty.keys()).sort((a, b) => a.localeCompare(b))
  return {
    ok: true,
    drafts: properties.map((p, i) => draft(`${base}${String(i + 1).padStart(2, '0')}${monthSuffix}`, byProperty.get(p)!, p || null)),
  }
}

/** What the sent-invoices register records for one client invoice: the
 *  number, or the first and last when it was split per property. */
export function registerInvoiceNumber(drafts: ReadonlyArray<Pick<BillComDraft, 'invoiceNumber'>>): string {
  if (drafts.length <= 1) return drafts[0]?.invoiceNumber ?? ''
  return `${drafts[0].invoiceNumber} to ${drafts[drafts.length - 1].invoiceNumber}`
}
