// Sent-invoices register + pre-send check (2026-10-09).
//
// Dependency-free and pure, shared by api/invoices/billcom.ts (the "mark
// sent" action and its pre-send preview) and the Invoice Reconciliation page.
// The SQL function public.client_invoice_mark_sent
// (20261009h_sent_invoice_register.sql) runs the SAME check again inside the
// transaction that writes the register row, so a stale browser can never
// slip past it. KEEP THE TWO IN SYNC: codes, flag list and period rule.
//
// One CLIENT invoice = one client's lines on one run for one service month
// (shared/billcom-send.ts). It covers every run source: a vendor CSV, a
// generated draft and an invoice the vendor built in the portal
// (invoice_runs.source = 'vendor_portal') all bill the client the same way.
// The one-month rule applies to CLIENT invoices only; a vendor run may span
// months and is never checked here.

import { lineServiceMonth, normalizeHoldReason, type ClientInvoiceStatus } from './billcom-send.js'

/** Flags that need a written resolution (a non-blank review_note) before a
 *  line may be billed. Matched by name only: the engine may not raise all of
 *  them yet, and a flag it never raises simply never matches. */
export const NOTE_REQUIRED_FLAGS = [
  'charge_changed_since_last_invoice',
  'not_haven_listing',
  'redo_pending',
  'price_mismatch_agreement',
] as const

export type PreSendCode =
  | 'client_invoice_not_approved'
  | 'run_not_approved'
  | 'run_archived'
  | 'no_lines'
  | 'needs_review'
  | 'held_line'
  | 'note_required'
  | 'line_outside_month'
  | 'total_not_positive'
  | 'total_mismatch'
  | 'already_registered'

export interface PreSendException {
  code: PreSendCode
  message: string
  lineNo?: number
}

/** One invoice_lines row of the client invoice (split rows included; rows
 *  sharing a line_no are one vendor line). */
export interface PreSendLine {
  lineNo: number
  reviewStatus: string
  billHoldReason?: string | null
  flags?: ReadonlyArray<string> | null
  reviewNote?: string | null
  /** service_date ?? raw_date_mentioned, yyyy-mm-dd; null when undated. */
  serviceDate: string | null
  clientChargeAmount: number | null
}

export interface PreSendInput {
  run: { status: string; archivedAt?: string | null }
  /** null status = no client_invoices row yet, i.e. held. */
  invoice: { status: ClientInvoiceStatus | null; serviceMonth: string }
  /** Every line of this client invoice, held ones included. */
  lines: ReadonlyArray<PreSendLine>
  /** The total the user is confirming; null skips the comparison. */
  confirmedTotal?: number | null
  /** An existing register row with this channel + number, if any. */
  registered?: { clientName: string | null; sentAt: string | null } | null
}

const round2 = (n: number) => Math.round(n * 100) / 100
const fmt = (n: number) => `$${n.toFixed(2)}`

/** First day and last day (yyyy-mm-dd) of a yyyy-mm month; null if malformed. */
export function monthBounds(serviceMonth: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(serviceMonth)
  if (!m) return null
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate()
  return { start: `${m[1]}-${m[2]}-01`, end: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}` }
}

/** The one-month rule: start <= end and both inside the same calendar month
 *  (and, when given, inside that service month). Mirrors the CHECK on
 *  sent_invoices and the register trigger's service_month test. */
export function periodWithinOneMonth(start: string | null | undefined, end: string | null | undefined, serviceMonth?: string): boolean {
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false
  if (start > end) return false
  if (start.slice(0, 7) !== end.slice(0, 7)) return false
  return serviceMonth == null || start.slice(0, 7) === serviceMonth
}

const minStr = (vals: Array<string | null | undefined>) =>
  vals.filter((v): v is string => !!v).reduce<string | null>((a, v) => (a == null || v < a ? v : a), null)
const maxStr = (vals: Array<string | null | undefined>) =>
  vals.filter((v): v is string => !!v).reduce<string | null>((a, v) => (a == null || v > a ? v : a), null)

/** The period recorded on the register row: the service month intersected
 *  with the run's period, widened to the invoice's own line dates so a late
 *  item (a vendor-portal line dated before the run period) is still inside
 *  it, and never leaving the month. Falls back to the whole month when the
 *  run has no period or the intersection would be empty. Mirrored in SQL. */
export function registerPeriod(
  serviceMonth: string,
  runPeriodStart: string | null | undefined,
  runPeriodEnd: string | null | undefined,
  lineDates: ReadonlyArray<string | null | undefined>,
): { start: string; end: string } | null {
  const month = monthBounds(serviceMonth)
  if (!month) return null
  const lo = minStr([runPeriodStart, ...lineDates])
  const hi = maxStr([runPeriodEnd, ...lineDates])
  const start = lo && lo > month.start ? lo : month.start
  const end = hi && hi < month.end ? hi : month.end
  if (start > end) return month
  return { start, end }
}

/** Sum of the client charge on lines that are not held (what goes out). */
export function sendableTotal(lines: ReadonlyArray<PreSendLine>): number {
  return round2(lines.reduce((a, l) => (normalizeHoldReason(l.billHoldReason) ? a : a + Number(l.clientChargeAmount ?? 0)), 0))
}

/** Everything that must be fixed before this client invoice may be marked
 *  sent. Empty = clear to send. One entry per vendor line per problem. */
export function preSendExceptions(input: PreSendInput): PreSendException[] {
  const out: PreSendException[] = []
  const seen = new Set<string>()
  const push = (e: PreSendException) => {
    const k = `${e.code}|${e.lineNo ?? ''}`
    if (seen.has(k)) return
    seen.add(k)
    out.push(e)
  }

  const status = input.invoice.status ?? 'held'
  if (status !== 'approved') {
    push({ code: 'client_invoice_not_approved', message: status === 'sent' ? 'This client invoice was already sent' : 'Approve this client invoice first (it is held)' })
  }
  if (input.run.status !== 'approved' && input.run.status !== 'exported') {
    push({ code: 'run_not_approved', message: `The run is ${input.run.status}; only an approved or exported run can be billed` })
  }
  if (input.run.archivedAt) {
    push({ code: 'run_archived', message: 'The run is archived; restore it before sending its client invoices' })
  }

  const lines = [...input.lines].sort((a, b) => a.lineNo - b.lineNo)
  if (lines.length === 0) push({ code: 'no_lines', message: 'No billable lines for this client and month' })

  // Per vendor line: split rows share a line_no and are judged together
  // (any row needs review / is held / is out of month; a flag needs a note
  // when no row of the line has one), exactly as the SQL groups them.
  const noteFlags = new Set<string>(NOTE_REQUIRED_FLAGS)
  const byLine = new Map<number, PreSendLine[]>()
  for (const l of lines) byLine.set(l.lineNo, [...(byLine.get(l.lineNo) ?? []), l])
  for (const [lineNo, rows] of Array.from(byLine.entries())) {
    if (rows.some(r => r.reviewStatus === 'needs_review')) {
      push({ code: 'needs_review', lineNo, message: `Line ${lineNo} still needs review` })
    }
    const hold = maxStr(rows.map(r => normalizeHoldReason(r.billHoldReason)))
    if (hold) {
      push({ code: 'held_line', lineNo, message: `Line ${lineNo} is held from billing (${hold}); release it before sending` })
    }
    const flagged = Array.from(new Set(rows.flatMap(r => (r.flags ?? []).filter(f => noteFlags.has(f))))).sort()
    if (flagged.length > 0 && rows.every(r => !(r.reviewNote ?? '').trim())) {
      push({ code: 'note_required', lineNo, message: `Line ${lineNo} is flagged ${flagged.join(', ')} and needs a review note saying how it was resolved` })
    }
    const outside = minStr(rows.map(r => r.serviceDate).filter(d => d && lineServiceMonth(d, null) !== input.invoice.serviceMonth))
    if (outside) {
      push({ code: 'line_outside_month', lineNo, message: `Line ${lineNo} is dated ${outside}, outside ${input.invoice.serviceMonth}` })
    }
  }

  const total = sendableTotal(lines)
  if (lines.length > 0 && total <= 0) {
    push({ code: 'total_not_positive', message: `The invoice total is ${fmt(total)}; a client invoice must be more than $0` })
  }
  if (input.confirmedTotal != null && Math.abs(round2(input.confirmedTotal) - total) >= 0.005) {
    push({ code: 'total_mismatch', message: `The total shown (${fmt(round2(input.confirmedTotal))}) differs from the lines (${fmt(total)}); refresh and check again` })
  }
  if (input.registered) {
    const who = input.registered.clientName ? ` to ${input.registered.clientName}` : ''
    const when = input.registered.sentAt ? ` on ${input.registered.sentAt.slice(0, 10)}` : ''
    push({ code: 'already_registered', message: `This invoice number was already recorded as sent${who}${when}` })
  }
  return out
}

// ─── Request fields for mark_sent (api/invoices/billcom.ts) ──────────────────

const SHA256_RE = /^[0-9a-f]{64}$/
const MAX_RECIPIENT = 320

/** A SHA-256 hex digest as stored (lowercase); null when absent or not one. */
export function normalizeSha256(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().toLowerCase()
  return SHA256_RE.test(t) ? t : null
}

/** A recipient as stored: whitespace collapsed, trimmed, capped. Blank is
 *  null (the server then falls back to the client's email). */
export function normalizeRecipient(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, MAX_RECIPIENT) : null
}

export interface MarkSentExtras {
  recipient: string | null
  pdfSha256: string | null
  confirmedTotal: number | null
}

/** The register fields of a mark_sent body (all optional). A pdf_sha256 that
 *  is present but not a SHA-256 hex digest is refused rather than dropped, so
 *  a broken upload can never be recorded as "no PDF". */
export function parseMarkSentExtras(body: unknown): { ok: true; value: MarkSentExtras } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  let pdfSha256: string | null = null
  if (b.pdf_sha256 != null && b.pdf_sha256 !== '') {
    pdfSha256 = normalizeSha256(b.pdf_sha256)
    if (!pdfSha256) return { ok: false, error: 'pdf_sha256 must be a SHA-256 hex digest (64 characters)' }
  }
  let confirmedTotal: number | null = null
  if (b.total != null && b.total !== '') {
    const n = Number(b.total)
    if (!Number.isFinite(n)) return { ok: false, error: 'total must be a number' }
    confirmedTotal = round2(n)
  }
  return { ok: true, value: { recipient: normalizeRecipient(b.recipient), pdfSha256, confirmedTotal } }
}

/** Short form of a hash for tables: first 8 and last 4 hex characters. */
export function shortHash(h: string | null | undefined): string {
  if (!h) return '-'
  return h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h
}

/** PostgREST "that function is not there" (migration not applied yet). */
export function isMissingFunctionError(err: unknown): boolean {
  if (!err) return false
  const e = err as { code?: unknown; message?: unknown }
  if (e.code === 'PGRST202' || e.code === '42883') return true
  const msg = typeof e.message === 'string' ? e.message : ''
  return /could not find the function/i.test(msg)
}
