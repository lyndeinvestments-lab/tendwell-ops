// bill.com send control (2026-10-09): which client invoices may go out.
//
// Dependency-free and pure, so the exporter (api/invoices/_exporters.ts), the
// bookkeeping endpoint (api/invoices/billcom.ts) and the Invoice
// Reconciliation page all agree on what one bill.com invoice is and whether
// it may be sent.
//
// One bill.com invoice = one CLIENT's bill.com lines on one run for one
// SERVICE MONTH. The worksheet already splits a client's lines by month
// (month books, see toBillComCsv), so a run spanning September and October
// produces two bill.com invoices for that client, each with its own number
// once sent. Rows live in public.client_invoices
// (20261009c_billcom_send_control.sql); a group with no row yet is HELD.
//
// Nothing here talks to bill.com: "sent" is bookkeeping a human records after
// entering the invoice in bill.com by hand.

export type ClientInvoiceStatus = 'held' | 'approved' | 'sent'

export const CLIENT_INVOICE_STATUSES: readonly ClientInvoiceStatus[] = ['held', 'approved', 'sent']

/** The stored state of one client invoice (a public.client_invoices row). */
export interface ClientInvoiceState {
  contactId: string
  serviceMonth: string // yyyy-mm
  status: ClientInvoiceStatus
  holdReason?: string | null
  billcomInvoiceNumber?: string | null
  sentAt?: string | null
  sentBy?: string | null
  total?: number | null
}

export function clientInvoiceKey(contactId: string | null | undefined, serviceMonth: string): string {
  return `${contactId ?? ''}|${serviceMonth}`
}

/** yyyy-mm of a line's service date, falling back to the run's invoice date
 *  (labor and undated lines). Same rule as serviceMonth() in the exporter. */
export function lineServiceMonth(serviceDate: string | null | undefined, fallback: string | null | undefined): string {
  return (serviceDate ?? fallback ?? '').slice(0, 7)
}

const MAX_HOLD_REASON = 500
const MAX_INVOICE_NUMBER = 64

/** A hold reason as stored: whitespace collapsed, trimmed, capped. Blank (or
 *  not a string) is null, which means "not held". */
export function normalizeHoldReason(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, MAX_HOLD_REASON) : null
}

/** A bill.com invoice number as stored: trimmed, non-empty, no inner line
 *  breaks, capped. null when unusable (the caller must refuse). */
export function normalizeBillcomInvoiceNumber(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const t = String(v).replace(/\s+/g, ' ').trim()
  if (!t || t.length > MAX_INVOICE_NUMBER) return null
  return t
}

/** Status moves a human may make. "sent" is final: the invoice already left
 *  in bill.com, so un-sending it here would only make the books lie. */
export function canTransition(from: ClientInvoiceStatus, to: ClientInvoiceStatus): boolean {
  if (from === 'sent') return false
  if (to === 'sent') return from === 'approved'
  return from !== to
}

/** PostgREST / Postgres "that table or column is not there" errors: the
 *  migration has not been applied yet, so callers fall back to the behaviour
 *  from before send control existed. Matches the code when we have it and
 *  the message when a wrapper (fetchAllRows) kept only the text. */
export function isMissingSchemaError(err: unknown): boolean {
  if (!err) return false
  const e = err as { code?: unknown; message?: unknown }
  const code = typeof e.code === 'string' ? e.code : ''
  if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)) return true
  const msg = typeof e.message === 'string' ? e.message : typeof err === 'string' ? err : ''
  return (
    /relation "[^"]*" does not exist/i.test(msg) ||
    /column "?[\w.]*"? (of relation "[^"]*" )?does not exist/i.test(msg) ||
    /could not find the table/i.test(msg) ||
    /could not find the '[^']*' column/i.test(msg)
  )
}

export function stateMap(states: ReadonlyArray<ClientInvoiceState>): Map<string, ClientInvoiceState> {
  return new Map(states.map(s => [clientInvoiceKey(s.contactId, s.serviceMonth), s]))
}

/** A client invoice with no stored row has never been approved: held. */
export function statusFor(
  states: ReadonlyMap<string, ClientInvoiceState>,
  contactId: string | null | undefined,
  serviceMonth: string,
): ClientInvoiceStatus {
  if (!contactId) return 'held'
  return states.get(clientInvoiceKey(contactId, serviceMonth))?.status ?? 'held'
}

/** May this (already bill.com, already billable) line go on the worksheet?
 *  Only when its client invoice is approved and the line itself is not held.
 *  A line with no client can never be sent: bill.com needs a customer. */
export function billComLineSendable(
  line: { contactId?: string | null; serviceMonth: string; billHoldReason?: string | null },
  states: ReadonlyMap<string, ClientInvoiceState>,
): boolean {
  if (normalizeHoldReason(line.billHoldReason)) return false
  if (!line.contactId) return false
  return statusFor(states, line.contactId, line.serviceMonth) === 'approved'
}

// ─── Endpoint request (api/invoices/billcom.ts) ──────────────────────────────

export type BillComAction =
  | { action: 'hold_line'; runId: string; lineNo: number; reason: string | null }
  | { action: 'set_status'; runId: string; contactId: string; serviceMonth: string; status: 'held' | 'approved'; holdReason: string | null }
  | { action: 'mark_sent'; runId: string; contactId: string; serviceMonth: string; billcomInvoiceNumber: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** Validate a POST body. Returns the action, or an error message fit to show
 *  the user. A blank/absent `reason` on hold_line clears the hold. */
export function parseBillComAction(body: unknown): { ok: true; value: BillComAction } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const runId = typeof b.run_id === 'string' ? b.run_id : ''
  if (!UUID_RE.test(runId)) return { ok: false, error: 'run_id is required' }
  const action = b.action
  if (action === 'hold_line') {
    const lineNo = Number(b.line_no)
    if (!Number.isInteger(lineNo) || lineNo < 0) return { ok: false, error: 'line_no is required' }
    return { ok: true, value: { action, runId, lineNo, reason: normalizeHoldReason(b.reason) } }
  }
  if (action !== 'set_status' && action !== 'mark_sent') {
    return { ok: false, error: 'action must be hold_line, set_status or mark_sent' }
  }
  const contactId = typeof b.contact_id === 'string' ? b.contact_id : ''
  if (!UUID_RE.test(contactId)) return { ok: false, error: 'contact_id is required (a bill.com invoice needs a client)' }
  const serviceMonth = typeof b.service_month === 'string' ? b.service_month : ''
  if (!MONTH_RE.test(serviceMonth)) return { ok: false, error: 'service_month must look like 2026-09' }
  if (action === 'set_status') {
    if (b.status !== 'held' && b.status !== 'approved') return { ok: false, error: 'status must be held or approved' }
    return { ok: true, value: { action, runId, contactId, serviceMonth, status: b.status, holdReason: b.status === 'held' ? normalizeHoldReason(b.hold_reason) : null } }
  }
  const billcomInvoiceNumber = normalizeBillcomInvoiceNumber(b.billcom_invoice_number)
  if (!billcomInvoiceNumber) return { ok: false, error: 'Enter the bill.com invoice number (up to 64 characters)' }
  return { ok: true, value: { action, runId, contactId, serviceMonth, billcomInvoiceNumber } }
}

/** Send control works on approved (or exported) runs only: those are the
 *  runs whose bill.com worksheet can be downloaded, and reconcile refuses to
 *  rebuild them, so a line's hold reason can never be wiped by a rebuild. */
export function runAllowsSendControl(status: string | null | undefined): boolean {
  return status === 'approved' || status === 'exported'
}

// ─── Who a line bills ────────────────────────────────────────────────────────

/** The client named on a credit's invoice_adjustments row. */
export interface CreditClient {
  contactId: string
  clientName: string | null
}

/** invoice_adjustments rows (applied_line_id, contact_id, contacts embed) →
 *  the client of each credit line, keyed by the invoice_lines id it was
 *  applied as. null/empty (table missing: migration 20261009a pending, or no
 *  credits on the run) gives an empty map, and every line falls back to its
 *  property's client exactly as before credits existed. */
export function creditClientsByLine(
  rows: ReadonlyArray<{ applied_line_id?: unknown; contact_id?: unknown; contacts?: unknown }> | null | undefined,
): Map<string, CreditClient> {
  const m = new Map<string, CreditClient>()
  for (const r of rows ?? []) {
    if (!r.applied_line_id || !r.contact_id) continue
    const rel = r.contacts as { full_name?: string | null; company?: string | null } | Array<{ full_name?: string | null; company?: string | null }> | null | undefined
    const c = Array.isArray(rel) ? rel[0] : rel
    m.set(String(r.applied_line_id), { contactId: String(r.contact_id), clientName: c?.full_name ?? c?.company ?? null })
  }
  return m
}

/** Who a line bills. A client credit (flag 'credit', service 'Credit') usually
 *  has no property: its client is on the adjustment it was applied from. Every
 *  other line bills its property's client. One rule for the worksheet, the
 *  send endpoint and the panel, so a credit lands in (and nets) its client's
 *  invoice everywhere. */
export function lineClient(
  line: { id?: string | null; propertyContactId?: string | null; propertyClientName?: string | null },
  creditClients: ReadonlyMap<string, CreditClient> | null | undefined,
): { contactId: string | null; clientName: string | null } {
  const credit = line.id != null ? creditClients?.get(String(line.id)) : undefined
  if (credit) return { contactId: credit.contactId, clientName: credit.clientName ?? line.propertyClientName ?? null }
  return { contactId: line.propertyContactId ?? null, clientName: line.propertyClientName ?? null }
}

// ─── Grouping (UI + endpoint totals) ─────────────────────────────────────────

/** The minimum of an invoice line the grouping needs. */
export interface BillComLineInput {
  lineNo: number
  lineKind: string
  reviewStatus: string
  billingChannel: string | null
  clientChargeAmount: number | null
  serviceDate: string | null
  contactId: string | null
  clientName: string | null
  billHoldReason?: string | null
}

/** Same filter as isArLine(l, 'bill_com') in the exporter. Charges are summed
 *  per group, so split rows need no collapsing here (their charges add up to
 *  the collapsed line's charge either way). */
export function isBillComArLine(l: Pick<BillComLineInput, 'lineKind' | 'reviewStatus' | 'billingChannel' | 'clientChargeAmount'>): boolean {
  return (
    l.billingChannel === 'bill_com' &&
    l.lineKind !== 'excluded' &&
    l.reviewStatus !== 'excluded' &&
    l.lineKind !== 'operating_expense' &&
    l.clientChargeAmount != null &&
    l.clientChargeAmount !== 0
  )
}

export interface BillComGroup {
  key: string
  contactId: string | null
  clientName: string | null
  serviceMonth: string
  /** Sum of the client charge on lines that are not held: what the bill.com
   *  invoice will total once sent. */
  total: number
  heldTotal: number
  lineNos: number[]
  heldLineNos: number[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Vendor line numbers held from bill.com. A vendor line split into several
 *  rows is held when any of its rows carries a reason (the endpoint sets it
 *  on every row of the line_no). */
export function heldLineNumbers(lines: ReadonlyArray<{ lineNo: number; billHoldReason?: string | null }>): Set<number> {
  return new Set(lines.filter(l => normalizeHoldReason(l.billHoldReason)).map(l => l.lineNo))
}

/** One group per (client, service month), sorted by client then month. */
export function groupBillComInvoices(lines: ReadonlyArray<BillComLineInput>, runInvoiceDate: string | null): BillComGroup[] {
  const held = heldLineNumbers(lines)
  const groups = new Map<string, BillComGroup>()
  for (const l of lines) {
    if (!isBillComArLine(l)) continue
    const month = lineServiceMonth(l.serviceDate, runInvoiceDate)
    const key = clientInvoiceKey(l.contactId, month)
    let g = groups.get(key)
    if (!g) {
      g = { key, contactId: l.contactId, clientName: l.clientName, serviceMonth: month, total: 0, heldTotal: 0, lineNos: [], heldLineNos: [] }
      groups.set(key, g)
    }
    if (!g.clientName && l.clientName) g.clientName = l.clientName
    const amount = Number(l.clientChargeAmount ?? 0)
    if (held.has(l.lineNo)) {
      g.heldTotal = round2(g.heldTotal + amount)
      if (!g.heldLineNos.includes(l.lineNo)) g.heldLineNos.push(l.lineNo)
    } else {
      g.total = round2(g.total + amount)
    }
    if (!g.lineNos.includes(l.lineNo)) g.lineNos.push(l.lineNo)
  }
  return Array.from(groups.values()).sort((a, b) =>
    (a.clientName ?? '').localeCompare(b.clientName ?? '') || a.serviceMonth.localeCompare(b.serviceMonth))
}
