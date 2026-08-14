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
  { id: 'billcom', label: 'bill.com CSV (draft template)' },
]

export const LINE_KINDS: Array<{ id: LineKind; label: string }> = [
  { id: 'clean', label: 'Clean' },
  { id: 'deep_clean', label: 'Deep Clean' },
  { id: 'extra', label: 'Extra' },
  { id: 'combined_split', label: 'Combined Split' },
  { id: 'operating_expense', label: 'Operating Expense' },
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
}

export function flagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? flag.replace(/_/g, ' ')
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
  resolved_by: string | null
  resolved_at: string | null
  created_at: string | null
  /** Joined via `properties(id, name)`. */
  properties?: { id: number; name: string } | { id: number; name: string }[] | null
}

export function vendorNameOf(run: Pick<InvoiceRun, 'vendors'>): string {
  const v = run.vendors
  if (!v) return 'Unknown vendor'
  return Array.isArray(v) ? v[0]?.name ?? 'Unknown vendor' : v.name ?? 'Unknown vendor'
}

export function propertyOf(line: Pick<InvoiceLine, 'properties'>): { id: number; name: string } | null {
  const p = line.properties
  if (!p) return null
  return Array.isArray(p) ? p[0] ?? null : p
}

// ─── API helper ──────────────────────────────────────────────────────────────

/**
 * Calls a POST/GET /api/invoices/<path> endpoint, attaching the current
 * session's bearer token (all endpoints are admin-only Bearer-gated).
 */
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
    throw new Error(message)
  }
  return json as T
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
