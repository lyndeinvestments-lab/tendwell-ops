import { supabase } from '@/lib/supabase'

/**
 * Shared domain types + API helpers for the Invoicing feature (client-side
 * only — server API + DB already exist, see api/invoices/*.ts and the
 * `invoice_runs`/`invoice_lines`/`vendor_property_aliases` tables).
 *
 * These domain types narrow the generated `Row` types (status/kind unions,
 * joined vendor/property shapes) — same pattern as `SnapshotTask` in
 * trellis-tasks.tsx. Query results are cast at the boundary.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export type InvoiceRunSource = 'vendor_csv' | 'generated'
export type InvoiceRunStatus = 'ingested' | 'reconciled' | 'review_needed' | 'approved' | 'exported' | 'void'
export type LineKind = 'clean' | 'deep_clean' | 'extra' | 'combined_split' | 'operating_expense' | 'excluded'
export type BillingChannel = 'qbo_haven' | 'bill_com' | 'none'
export type ReviewStatus = 'ok' | 'needs_review' | 'resolved' | 'excluded'
export type ExportFormat = 'ramp' | 'qbo_flat' | 'qbo_multiline' | 'billcom'

export const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string }> = [
  { id: 'ramp', label: 'Ramp bill CSV' },
  { id: 'qbo_flat', label: 'QBO CSV (flat)' },
  { id: 'qbo_multiline', label: 'QBO CSV (official)' },
  // bill.com has no import — this is a worksheet listing everything (client,
  // property, service, dates, amount) for manual invoice creation there.
  { id: 'billcom', label: 'bill.com manual-entry list' },
]

export const LINE_KINDS: Array<{ id: LineKind; label: string }> = [
  { id: 'clean', label: 'Clean' },
  { id: 'deep_clean', label: 'Deep Clean' },
  { id: 'extra', label: 'Extra' },
  { id: 'combined_split', label: 'Combined Split' },
  // Tendwell's own cost (labor, supplies…): paid to the vendor via Ramp,
  // never invoiced to Haven or bill.com, and needs no property.
  { id: 'operating_expense', label: 'Tendwell Expense (labor / supplies)' },
  { id: 'excluded', label: 'Excluded' },
]

export const BILLING_CHANNELS: Array<{ id: BillingChannel; label: string }> = [
  { id: 'qbo_haven', label: 'QBO (Haven)' },
  { id: 'bill_com', label: 'bill.com' },
  { id: 'none', label: 'None' },
]

// Approved free-select list for invoice_lines.service_type.
export const SERVICE_TYPES: string[] = [
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
  'Double Clean',
  'Extra Cleaning',
  'Reimbursement',
  'Trip Fee',
  'Excessive Trash Pickup',
  'Mailed Left Items by the Guest',
  'Hot Tub Refresh Requested by Guest',
  'Pet Fee',
]

// ─── Flags ───────────────────────────────────────────────────────────────────

export const FLAG_LABELS: Record<string, string> = {
  subtotal_mismatch: 'Subtotal mismatch',
  unresolved_property: 'Unresolved property',
  low_confidence_alias: 'Low-confidence alias',
  negative_split_standalone: 'Negative split, standalone',
  relabeled_as_clean: 'Relabeled as clean',
  discrepancy_unexplained: 'Unexplained discrepancy',
  no_billing_channel: 'No billing channel',
  unmatched_task: 'Unmatched task',
  missing_rate: 'Missing rate',
  combined_split: 'Combined split',
  billed_whole: 'Billed whole',
  deep_rate_assumed: 'Deep-clean rate assumed',
  operating_expense: 'Operating expense',
  rate_stale: 'Rate may be stale',
  deep_mismatch: 'Deep-clean note/task mismatch',
  credit_line: 'Credit line',
  reason_required: 'Reason required',
  paid_at_rate: 'Paid at Ops rate (vendor under-billed)',
  standard_priced: 'Standard price applied',
  client_priced: "Client's agreed price applied",
  suspect_service_date: 'Service date looks wrong',
  aux_task: 'Billable task — not on vendor invoice',
}

export function flagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? flag.replace(/_/g, ' ')
}

// Task title → approved service title. Display-side mirror of the engine's
// TITLE_RULES in api/invoices/_engine.ts (same order — first match wins);
// keep the two in sync. Used by the review dialog to auto-fill the service
// from the matched task when a property is picked.
export function serviceTypeFromTaskTitle(title: string | null): string | null {
  if (!title) return null
  const t = title.toLowerCase()
  if (/double\s*clean/.test(t)) return 'Double Clean'
  if (/deep\s*clean/.test(t)) return 'Deep Clean'
  if (/onboarding\s*clean/.test(t)) return 'Onboarding Clean'
  if (/last\s*clean\s*(&|and)\s*linen\s*pull/.test(t)) return 'Last Clean & Linen Pull'
  if (/linen\s*pull/.test(t)) return 'Linen Pull'
  if (/last\s*clean/.test(t)) return 'Last Clean'
  if (/pre.?owner\s*stay/.test(t)) return 'Pre-Owner Stay Inspection'
  if (/cleaning\s*inspection/.test(t)) return 'Cleaning Inspection'
  if (/departure\s*clean/.test(t)) return 'Departure Clean'
  if (/turn\s*clean|same\s*day\s*turn|arrival\s*clean/.test(t)) return 'Turn Clean'
  if (/vacancy\s*clean|touch\s*up/.test(t)) return 'Vacancy Clean / Touch Up Clean'
  return null
}

// ─── Domain types ────────────────────────────────────────────────────────────

export interface Vendor {
  id: string
  name: string
  active: boolean
}

export interface InvoiceRun {
  id: string
  vendor_id: string | null
  source: InvoiceRunSource
  invoice_number: string | null
  invoice_date: string | null
  period_start: string | null
  period_end: string | null
  stated_subtotal: number | null
  computed_subtotal: number | null
  status: InvoiceRunStatus
  qbo_invoice_no: number | null
  approved_by: string | null
  approved_at: string | null
  created_by: string | null
  created_at: string | null
  /** Soft-archive: non-null hides the run from the default list. */
  archived_at?: string | null
  /** Joined via `vendors(name)` — may be an object or array depending on the query. */
  vendors?: { name: string } | { name: string }[] | null
}

export interface InvoiceLine {
  id: string
  run_id: string
  line_no: number
  split_group: number | null
  source: string
  raw_property_text: string | null
  raw_note_text: string | null
  raw_amount: number
  raw_date_mentioned: string | null
  property_id: number | null
  alias_confidence: number | null
  matched_task_id: string | null
  service_type: string | null
  line_kind: LineKind
  cleaner_pay_amount: number | null
  client_charge_amount: number | null
  billing_channel: BillingChannel | null
  flags: string[]
  review_status: ReviewStatus
  review_note: string | null
  /** Engine-written plain-English explanation of why the line is flagged. */
  engine_note: string | null
  resolved_by: string | null
  resolved_at: string | null
  created_at: string | null
  /** Joined via `properties(id, name, cleaner_pay)`. */
  properties?: JoinedProperty | JoinedProperty[] | null
}

/**
 * The property columns the invoicing table joins in. `cleaner_pay` is the
 * contracted Ops rate — the number every discrepancy flag is measured
 * against ("$40 above the Ops Cleaner Pay rate of $160"), so the reviewer
 * needs it on the row rather than having to know it by heart.
 */
export interface JoinedProperty {
  id: number
  name: string
  cleaner_pay: number | null
}

/**
 * Everything wrong with a line, in plain English — the client-side mirror of
 * the guards in api/invoices/approve.ts plus the engine's date-header check.
 *
 * Why this exists: `review_status` is NOT the same thing as "this line is
 * fine". A human can mark a line resolved without actually fixing what makes
 * it unexportable, and it then vanishes from the Needs-review filter while
 * still refusing to approve — a blocker hiding outside the queue whose whole
 * job is to show blockers (invoice I260913808, lines 286-287, 2026-09-14).
 * So issues are computed from the line's own data, never from its status.
 *
 * Keep in sync with api/invoices/approve.ts.
 */
export function lineIssues(l: InvoiceLine): string[] {
  const out: string[] = []
  const excluded = l.line_kind === 'excluded' || l.review_status === 'excluded'
  const billable = !excluded && l.line_kind !== 'operating_expense'
  if (billable && (l.billing_channel == null || l.billing_channel === 'none')) {
    out.push('No billing channel — would be paid to the vendor but never invoiced to a client')
  }
  if (billable && l.property_id == null) {
    out.push('No property assigned')
  }
  if (!excluded && Number(l.raw_amount ?? 0) !== 0 && !Number(l.cleaner_pay_amount ?? 0)) {
    out.push('No cleaner pay — would be missing from the Ramp export')
  }
  if ((l.flags ?? []).includes('suspect_service_date')) {
    out.push('Service date looks wrong')
  }
  if (l.review_status === 'needs_review') {
    out.push('Needs review')
  }
  return out
}

export function hasIssues(l: InvoiceLine): boolean {
  return lineIssues(l).length > 0
}

export function vendorNameOf(run: Pick<InvoiceRun, 'vendors'>): string {
  const v = run.vendors
  if (!v) return 'Unknown vendor'
  return Array.isArray(v) ? v[0]?.name ?? 'Unknown vendor' : v.name ?? 'Unknown vendor'
}

export function propertyOf(line: Pick<InvoiceLine, 'properties'>): JoinedProperty | null {
  const p = line.properties
  if (!p) return null
  return Array.isArray(p) ? p[0] ?? null : p
}

// ─── API helper ──────────────────────────────────────────────────────────────

/**
 * Calls a POST/GET /api/invoices/<path> endpoint, attaching the current
 * session's bearer token (all endpoints are admin-only Bearer-gated).
 */
/**
 * A failed `/api/invoices/*` call, carrying the response body. Approve's
 * guards return `blocking_lines` naming exactly which lines hold the run up;
 * a plain Error would drop that on the floor and leave the user hunting
 * through hundreds of rows for a line the server already identified.
 */
export class InvoiceApiError extends Error {
  readonly body: any
  constructor(message: string, body: any) {
    super(message)
    this.name = 'InvoiceApiError'
    this.body = body
  }
}

/** A line the approve guards named as blocking the run. */
export interface BlockingLine {
  line_no: number
  raw_property_text: string | null
  raw_amount: number | string | null
}

export async function invoicesApi<T = any>(
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: Record<string, unknown> } = {},
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch(`/api/invoices/${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = (json && (json.error || json.detail)) || `Request failed (${res.status})`
    throw new InvoiceApiError(message, json)
  }
  return json as T
}

export interface ExportPreview {
  format: ExportFormat
  /** The run's status at preview time — 'review_needed', 'approved', etc. */
  run_status: string
  /** Rendered by the same exporter the download uses, so this is what the
   *  file will contain (bar the invoice number, see below). */
  csv: string
  line_count: number
  qbo_invoice_no: number | null
  /** This format prints an AR invoice number and the run has not been assigned
   *  one yet — the blank cell gets filled at real export time. Previewing
   *  never allocates a number, since the counter is shared with live QBO. */
  invoice_number_pending: boolean
}

/**
 * Renders an export without any of its side effects: no invoice number is
 * allocated, the run is not advanced to 'exported', and any status may be
 * previewed (the whole point is looking before you approve).
 */
export async function previewExport(runId: string, format: ExportFormat): Promise<ExportPreview> {
  return invoicesApi<ExportPreview>(
    `export?run_id=${encodeURIComponent(runId)}&format=${encodeURIComponent(format)}&preview=1`,
  )
}

/**
 * Fetches an export CSV as a blob and triggers a browser download. Filename
 * is taken from the Content-Disposition header, falling back to a synthesized
 * name if absent.
 */
export async function downloadExport(runId: string, format: ExportFormat): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch(`/api/invoices/export?run_id=${encodeURIComponent(runId)}&format=${encodeURIComponent(format)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as Record<string, unknown>))
    throw new Error((body as any)?.error || (body as any)?.detail || `Export failed (${res.status})`)
  }
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = /filename="?([^";]+)"?/i.exec(disposition)
  const filename = match?.[1] ?? `invoice-${format}-${runId.slice(0, 8)}.csv`

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
