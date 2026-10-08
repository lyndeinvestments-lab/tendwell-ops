import { supabase } from '@/lib/supabase'
import { addDaysIso, type VendorItemCategory, type VendorItemInput, type VendorRunStatus } from '@shared/vendor-invoice'

/**
 * Client side of the vendor invoicing portal (Operations → Invoicing).
 *
 * Everything here comes from api/vendor-invoices/*, which returns only an
 * allow-listed shape: the vendor's own pay, the task/date, and the Property
 * List's fields. These types mirror that shape on purpose — there is no
 * client charge or billing field to accidentally render.
 */

export interface VendorProperty {
  id: number
  name: string
  address: string | null
  bedrooms: number | null
  full_baths: number | null
  guest_count: number | null
  square_footage: number | null
  cleaner_pay: number | null
  status: string | null
}

export interface VendorRun {
  id: string
  period_start: string
  period_end: string
  status: VendorRunStatus
  created_at: string
  submitted_at: string | null
  returned_at: string | null
  returned_note: string | null
  vendor_reference: string | null
  total: number | null
  approved_at: string | null
}

export interface VendorLine {
  id: string
  line_no: number
  category: 'clean' | VendorItemCategory
  service_type: string | null
  date: string | null
  amount: number | null
  property_id: number | null
  removed: boolean
  removed_by: 'you' | 'tendwell' | null
  removed_reason: string | null
  in_review: boolean
  notices: string[]
  task_title: string | null
  task_count: number
  editable: boolean
  detail: {
    worker: string | null
    hours: number | null
    rate: number | null
    description: string | null
    requested_by: string | null
    evidence_url: string | null
    has_receipt: boolean
  }
}

export interface SkippedDay {
  property_id: number
  property_name: string
  date: string
  title: string
  reason: 'already_invoiced' | 'unknown_property'
  ref: string | null
}

export interface VendorRunDetail {
  run: VendorRun
  lines: VendorLine[]
  properties: Record<string, VendorProperty>
  skipped: SkippedDay[]
  pulled_at: string | null
  in_review_count: number
  added?: number
}

export interface VendorHome {
  vendor: { id: string; name: string }
  me: { email: string; is_admin: boolean }
  today: string
  runs: VendorRun[]
}

export class VendorApiError extends Error {
  readonly code: string
  readonly body: any
  readonly status: number
  constructor(code: string, status: number, body: any) {
    super(code)
    this.name = 'VendorApiError'
    this.code = code
    this.status = status
    this.body = body
  }
}

export async function vendorApi<T = any>(
  path: 'runs' | 'items' | 'receipts',
  opts: { method?: 'GET' | 'POST'; query?: Record<string, string>; body?: Record<string, unknown> } = {},
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : ''
  const res = await fetch(`/api/vendor-invoices/${path}${qs}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new VendorApiError(String(json?.error ?? `http_${res.status}`), res.status, json)
  return json as T
}

export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024

/** Upload a receipt/photo straight to private storage through a one-time
 *  signed URL; returns the storage path to attach to the item. */
export async function uploadReceipt(runId: string, file: File): Promise<string> {
  const type = file.type || (/\.heic$/i.test(file.name) ? 'image/heic' : '')
  if (!RECEIPT_TYPES.includes(type)) throw new VendorApiError('file_type', 400, null)
  if (file.size > RECEIPT_MAX_BYTES) throw new VendorApiError('file_size', 400, null)
  const { path, token } = await vendorApi<{ path: string; token: string }>('receipts', {
    method: 'POST',
    body: { action: 'upload_url', run_id: runId, content_type: type, size: file.size },
  })
  // Re-wrap with the resolved type: the upload sends the File as form data,
  // which carries the File's own type, and iPhone HEIC files often have none.
  const typed = file.type === type ? file : new File([file], file.name, { type })
  const { error } = await supabase.storage.from('vendor-invoices').uploadToSignedUrl(path, token, typed, { contentType: type })
  if (error) throw new VendorApiError('upload_failed', 500, error)
  return path
}

export async function openReceipt(lineId: string): Promise<void> {
  // Open the tab synchronously (popup blockers), then point it at the link.
  const tab = window.open('about:blank', '_blank')
  try {
    const { url } = await vendorApi<{ url: string }>('receipts', { query: { line_id: lineId } })
    if (tab) tab.location.href = url
    else window.location.href = url
  } catch (e) {
    tab?.close()
    throw e
  }
}

export type { VendorItemInput }

export function money(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/** The next invoice period: the 7 days after the last invoice ends (Busy Bee
 *  bills Sunday–Saturday), never past today. With no history, the last full
 *  Sunday–Saturday week. */
export function suggestPeriod(today: string, lastEnd: string | null): { start: string; end: string } {
  if (lastEnd && lastEnd < today) {
    const start = addDaysIso(lastEnd, 1)
    const end = addDaysIso(start, 6)
    return { start, end: end > today ? today : end }
  }
  const d = new Date(`${today}T00:00:00Z`)
  const dow = d.getUTCDay() // 0 Sun … 6 Sat
  const end = addDaysIso(today, -(dow + 1)) // most recent Saturday before today
  return { start: addDaysIso(end, -6), end }
}
