// Pure helpers behind the Invoice Reconciliation tabs: which tab a deep link
// lands on, how the Vendor invoices list is grouped, the per-run numbers in
// its table, QuickBooks number formatting, the client-invoice send groups and
// the Sent invoices filters. No React, no Supabase: unit-tested next door.

import type { InvoiceRun } from '@/lib/invoices'
import type { StatusTone } from '@/lib/status-colors'
import {
  groupBillComInvoices,
  isClientInvoiceArLine,
  lineClient,
  stateMap,
  statusFor,
  type ClientInvoiceChannel,
  type ClientInvoiceState,
  type ClientInvoiceStatus,
  type CreditClient,
} from '@shared/billcom-send'

// ── Tabs and deep links ──────────────────────────────────────────────────────

export type InvoicingView = 'runs' | 'client' | 'audit' | 'charges' | 'prices'

/** Tab order and labels. `runs` is the landing tab. */
export const INVOICING_VIEWS: ReadonlyArray<{ id: InvoicingView; label: string }> = [
  { id: 'runs', label: 'Vendor invoices' },
  { id: 'client', label: 'Client invoices' },
  { id: 'audit', label: 'Unbilled work' },
  { id: 'charges', label: 'Credits & linen' },
  { id: 'prices', label: 'Prices' },
]

/** One sentence per tab: what it is for. */
export const INVOICING_SUBTITLES: Record<InvoicingView, string> = {
  runs: 'Review and approve each vendor invoice, then export it and send the client invoices.',
  client: 'Client invoices from approved runs that still need sending, and the register of what has gone out.',
  audit: 'Billable work that is not on a vendor invoice: completed tasks and work seen in Slack or Quo that still needs billing.',
  charges: "Credits owed back to clients and linen onboarding fees. Both are added to the client's next approved invoice automatically.",
  prices: 'The prices that decide what each client is billed. Changes apply the next time a run is generated or reconciled.',
}

/**
 * Tab for a URL query string. Old ids keep working (`sent` is now part of
 * Client invoices), and the legacy `?linen=<property id>` link (onboarding
 * checklist, alerts) lands on Credits & linen.
 */
export function invoicingViewFromSearch(search: string): InvoicingView {
  const params = new URLSearchParams(search)
  const linen = Number(params.get('linen'))
  if (Number.isInteger(linen) && linen > 0) return 'charges'
  switch (params.get('view')) {
    case 'runs': return 'runs'
    case 'client':
    case 'sent': return 'client'
    case 'audit': return 'audit'
    case 'charges': return 'charges'
    case 'prices': return 'prices'
    default: return 'runs'
  }
}

// ── Vendor invoices list ─────────────────────────────────────────────────────

export type RunGroup = 'needs_you' | 'writing' | 'done'

type RunForGrouping = Pick<InvoiceRun, 'id' | 'status' | 'source'>

/**
 * Where a run sits in the Vendor invoices list.
 * - needs you: ingested / reconciled / review needed (includes vendor-portal
 *   runs the vendor submitted), and approved or exported runs that still have
 *   client invoices not marked sent.
 * - writing: a vendor-portal draft the vendor is still writing.
 * - done: everything else (void, fully sent, nothing to send).
 */
export function classifyRun(run: Pick<InvoiceRun, 'status' | 'source'>, unsentClientInvoices: number): RunGroup {
  switch (run.status) {
    case 'review_needed':
    case 'reconciled':
    case 'ingested':
      return 'needs_you'
    case 'draft':
      return run.source === 'vendor_portal' ? 'writing' : 'needs_you'
    case 'approved':
    case 'exported':
      return unsentClientInvoices > 0 ? 'needs_you' : 'done'
    default:
      return 'done'
  }
}

export function groupRuns<T extends RunForGrouping>(
  runs: ReadonlyArray<T>,
  unsentByRun: ReadonlyMap<string, number>,
): { needsYou: T[]; writing: T[]; done: T[] } {
  const out = { needsYou: [] as T[], writing: [] as T[], done: [] as T[] }
  for (const run of runs) {
    const g = classifyRun(run, unsentByRun.get(run.id) ?? 0)
    if (g === 'needs_you') out.needsYou.push(run)
    else if (g === 'writing') out.writing.push(run)
    else out.done.push(run)
  }
  return out
}

export function runStatusTone(status: string): StatusTone {
  if (status === 'review_needed') return 'warning'
  if (status === 'approved' || status === 'exported') return 'success'
  if (status === 'void' || status === 'draft') return 'neutral'
  return 'info' // ingested | reconciled
}

const round2 = (n: number) => Math.round(n * 100) / 100

export interface RunLineStatRow {
  run_id: string
  review_status: string | null
  cleaner_pay_amount: number | string | null
  client_charge_amount: number | string | null
}

export interface RunLineStats {
  needsReview: number
  /** Sum of cleaner_pay_amount over non-excluded lines (what the vendor is paid). */
  vendorPay: number
  /** Sum of client_charge_amount over non-excluded lines (what clients are billed). */
  clientTotal: number
}

/** Per-run numbers for the table. "Non-excluded" matches the run detail page: review_status other than 'excluded'. */
export function summarizeRunLines(rows: ReadonlyArray<RunLineStatRow>): Map<string, RunLineStats> {
  const out = new Map<string, RunLineStats>()
  for (const r of rows) {
    let s = out.get(r.run_id)
    if (!s) { s = { needsReview: 0, vendorPay: 0, clientTotal: 0 }; out.set(r.run_id, s) }
    if (r.review_status === 'needs_review') s.needsReview += 1
    if (r.review_status !== 'excluded') {
      s.vendorPay += Number(r.cleaner_pay_amount ?? 0)
      s.clientTotal += Number(r.client_charge_amount ?? 0)
    }
  }
  out.forEach(s => { s.vendorPay = round2(s.vendorPay); s.clientTotal = round2(s.clientTotal) })
  return out
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-09" to "Sep". Unparseable input comes back unchanged. */
export function monthAbbr(yyyymm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm)
  const idx = m ? Number(m[2]) - 1 : -1
  return idx >= 0 && idx < 12 ? MONTH_ABBR[idx] : yyyymm
}

/** "2026-09" to "September 2026". Unparseable input comes back unchanged. */
export function monthLong(yyyymm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm)
  if (!m) return yyyymm || '-'
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

/**
 * QuickBooks invoice number(s) of a run. `qbo_invoice_nos` is one number per
 * service month ({"2026-09":1096,"2026-10":1097}); with two or more it reads
 * "Sep 1096 · Oct 1097", with one it is just the number. Falls back to the
 * single `qbo_invoice_no`. null when the run has no QuickBooks number.
 */
export function formatQboNumbers(nos: unknown, single: number | null | undefined): string | null {
  const entries: Array<[string, number]> = []
  if (nos && typeof nos === 'object' && !Array.isArray(nos)) {
    for (const [month, v] of Object.entries(nos as Record<string, unknown>)) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) entries.push([month, n])
    }
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]))
  if (entries.length >= 2) return entries.map(([month, n]) => `${monthAbbr(month)} ${n}`).join(' · ')
  if (entries.length === 1) return String(entries[0][1])
  return single != null && Number.isFinite(Number(single)) && Number(single) > 0 ? String(single) : null
}

// ── Client invoice send groups ───────────────────────────────────────────────

/** The invoice_lines columns the send grouping needs. */
export interface SendLineRow {
  id: string
  line_no: number
  line_kind: string
  review_status: string
  billing_channel: string | null
  client_charge_amount: number | string | null
  service_date?: string | null
  raw_date_mentioned?: string | null
  property_id: number | null
  flags?: string[] | null
  bill_hold_reason?: string | null
}

/** One client invoice (client + service month + channel) on a run, with its send status. */
export interface ClientInvoiceRow {
  key: string
  runId: string
  channel: ClientInvoiceChannel
  contactId: string | null
  clientName: string | null
  serviceMonth: string
  status: ClientInvoiceStatus
  holdReason: string | null
  /** Computed from the run's lines when known, else the stored total. */
  total: number | null
  invoiceNumber: string | null
  sentAt: string | null
}

export interface SendProgress { total: number; sent: number; approved: number; held: number }

export function sendProgressOf(rows: ReadonlyArray<Pick<ClientInvoiceRow, 'status'>>): SendProgress {
  const p = { total: rows.length, sent: 0, approved: 0, held: 0 }
  for (const r of rows) p[r.status] += 1
  return p
}

/**
 * Every client invoice on one run with its status: the same grouping the
 * bill.com / QuickBooks send panel uses (groupBillComInvoices), joined to the
 * stored client_invoices rows. A group with no stored row has never been
 * approved, so it is held.
 */
export function buildRunClientInvoices(args: {
  runId: string
  invoiceDate: string | null
  lines: ReadonlyArray<SendLineRow>
  clientByProperty: ReadonlyMap<number, { contactId: string | null; name: string | null }>
  creditClients: ReadonlyMap<string, CreditClient> | null
  states: ReadonlyArray<ClientInvoiceState>
}): ClientInvoiceRow[] {
  const { runId, invoiceDate, lines, clientByProperty, creditClients, states } = args
  const arLines = lines.filter(l => isClientInvoiceArLine({
    lineKind: l.line_kind,
    reviewStatus: l.review_status,
    billingChannel: l.billing_channel,
    clientChargeAmount: l.client_charge_amount == null ? null : Number(l.client_charge_amount),
  }))
  const groups = groupBillComInvoices(
    arLines.map(l => {
      const prop = l.property_id != null ? clientByProperty.get(l.property_id) : undefined
      const client = lineClient({ id: l.id, propertyContactId: prop?.contactId, propertyClientName: prop?.name }, creditClients)
      return {
        lineNo: l.line_no,
        lineKind: l.line_kind,
        reviewStatus: l.review_status,
        billingChannel: l.billing_channel,
        clientChargeAmount: l.client_charge_amount == null ? null : Number(l.client_charge_amount),
        serviceDate: l.service_date ?? l.raw_date_mentioned ?? null,
        contactId: client.contactId,
        clientName: client.clientName,
        billHoldReason: l.bill_hold_reason ?? null,
      }
    }),
    invoiceDate,
  )
  const map = stateMap(states)
  return groups.map(g => {
    const state = map.get(g.key)
    return {
      key: g.key,
      runId,
      channel: g.channel,
      contactId: g.contactId,
      clientName: g.clientName,
      serviceMonth: g.serviceMonth,
      status: statusFor(map, g.contactId, g.serviceMonth, g.channel),
      holdReason: state?.holdReason ?? null,
      total: state?.status === 'sent' && state.total != null ? Number(state.total) : g.total,
      invoiceNumber: state?.billcomInvoiceNumber ?? null,
      sentAt: state?.sentAt ?? null,
    }
  })
}

/**
 * Stored client_invoices rows to ClientInvoiceRow, for runs whose lines were
 * not loaded: the status and total are whatever was stored.
 */
export function storedClientInvoiceRows(
  rows: ReadonlyArray<{
    run_id: string
    contact_id: string | null
    billing_channel: string
    service_month: string
    status: string
    hold_reason: string | null
    billcom_invoice_number: string | null
    sent_at: string | null
    total: number | string | null
    contacts?: { full_name: string | null; company: string | null } | Array<{ full_name: string | null; company: string | null }> | null
  }>,
): ClientInvoiceRow[] {
  return rows.map(r => {
    const c = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts
    const channel: ClientInvoiceChannel = r.billing_channel === 'qbo_client' ? 'qbo_client' : 'bill_com'
    return {
      key: `${channel}|${r.contact_id ?? ''}|${r.service_month}`,
      runId: r.run_id,
      channel,
      contactId: r.contact_id,
      clientName: c?.full_name ?? c?.company ?? null,
      serviceMonth: r.service_month,
      status: (r.status === 'sent' || r.status === 'approved' ? r.status : 'held') as ClientInvoiceStatus,
      holdReason: r.hold_reason,
      total: r.total == null ? null : Number(r.total),
      invoiceNumber: r.billcom_invoice_number,
      sentAt: r.sent_at,
    }
  })
}

/** Held first, then approved; within a status by client name then month. */
export function sortToSend(rows: ReadonlyArray<ClientInvoiceRow>): ClientInvoiceRow[] {
  const rank: Record<ClientInvoiceStatus, number> = { approved: 0, held: 1, sent: 2 }
  return [...rows].sort((a, b) =>
    rank[a.status] - rank[b.status] ||
    (a.clientName ?? '').localeCompare(b.clientName ?? '') ||
    a.serviceMonth.localeCompare(b.serviceMonth))
}

// ── Sent invoices filters ────────────────────────────────────────────────────

interface SentFilterRow {
  invoice_number: string
  client_name: string
  recipient: string | null
  period_start: string
}

/** Service months (yyyy-mm of period_start) present in the register, newest first. */
export function sentInvoiceMonths(rows: ReadonlyArray<Pick<SentFilterRow, 'period_start'>>): string[] {
  return Array.from(new Set(rows.map(r => r.period_start.slice(0, 7)).filter(m => /^\d{4}-\d{2}$/.test(m)))).sort().reverse()
}

/** Search by client, invoice number or recipient; `month` ('' = all) is the service month. */
export function filterSentInvoices<T extends SentFilterRow>(rows: ReadonlyArray<T>, opts: { search: string; month: string }): T[] {
  const q = opts.search.trim().toLowerCase()
  return rows.filter(r => {
    if (opts.month && r.period_start.slice(0, 7) !== opts.month) return false
    if (!q) return true
    return (
      r.invoice_number.toLowerCase().includes(q) ||
      r.client_name.toLowerCase().includes(q) ||
      (r.recipient ?? '').toLowerCase().includes(q)
    )
  })
}
