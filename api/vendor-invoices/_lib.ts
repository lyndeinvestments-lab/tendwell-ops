// I/O shell for the vendor invoicing portal (Operations → Invoicing).
//
// THE DATA BOUNDARY. A cleaning company sees its own invoice and nothing else
// Tendwell knows: client charges, billing channels, owner-stay routing, engine
// notes and review notes all stay server-side. Everything returned to the
// browser is built by the serializers below from an explicit allow-list —
// the property fields are exactly the Property List's (name, address, beds,
// baths, guests, sq ft, cleaner pay, status) and money is only what Tendwell
// pays the vendor. The vendor's session never reads invoice_* tables itself
// (RLS requires the admin `invoicing` grant), so these endpoints are the only
// door.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows, getServiceClient, RunBusyError } from '../invoices/_lib.js'
import { requirePermissionBearer } from '../qbo/_lib.js'
import { round2, vendorNotices, vendorRunStatus, type VendorRunStatus } from '../../shared/vendor-invoice.js'

export const RECEIPT_BUCKET = 'vendor-invoices'

export interface VendorActor {
  email: string
  label: string
  role: string
  isAdmin: boolean
  vendorId: string
  vendorName: string
}

/** Today in Knoxville — the business day the "no future dates" rule uses. */
export function todayEastern(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
}

/** The caller must hold the `vendor-invoicing` grant AND be linked to a vendor
 *  in vendor_users. Admins may act for any vendor (`vendor_id` param), which
 *  is how Tendwell previews exactly what the vendor sees; with one active
 *  vendor an admin defaults to it. Returns null after writing the response. */
export async function requireVendorActor(
  req: VercelRequest,
  res: VercelResponse,
  mode: 'view' | 'edit',
): Promise<{ actor: VendorActor; supabase: SupabaseClient } | null> {
  const staff = await requirePermissionBearer(req, res, 'vendor-invoicing', mode)
  if (!staff) return null
  const supabase = getServiceClient()
  if (!supabase) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return null
  }
  const email = staff.email.toLowerCase()
  const isAdmin = staff.role === 'admin'

  const { data: link, error: linkErr } = await supabase
    .from('vendor_users')
    .select('vendor_id, vendors(name, active)')
    .eq('email', email)
    .maybeSingle()
  if (linkErr) {
    res.status(500).json({ error: 'Vendor lookup failed', detail: linkErr.message })
    return null
  }

  const requested = (typeof req.query?.vendor_id === 'string' ? req.query.vendor_id : null) ??
    (typeof (req.body as any)?.vendor_id === 'string' ? (req.body as any).vendor_id : null)

  let vendorId: string | null = null
  let vendorName = ''
  if (isAdmin && requested) {
    const { data: v } = await supabase.from('vendors').select('id, name').eq('id', requested).maybeSingle()
    if (v) { vendorId = v.id; vendorName = v.name }
  } else if (link) {
    const v = Array.isArray(link.vendors) ? link.vendors[0] : link.vendors
    if (v && (v as any).active !== false) { vendorId = link.vendor_id; vendorName = (v as any).name ?? '' }
  } else if (isAdmin) {
    const { data: vs } = await supabase.from('vendors').select('id, name').eq('active', true)
    if (vs && vs.length === 1) { vendorId = vs[0].id; vendorName = vs[0].name }
  }
  if (!vendorId) {
    res.status(403).json({ error: 'not_linked', detail: 'This login is not linked to a cleaning company yet. Ask Tendwell to link it.' })
    return null
  }
  return {
    actor: { email, label: staff.label, role: staff.role, isAdmin, vendorId, vendorName },
    supabase,
  }
}

/** Never hand the vendor raw database / engine text: business-rule refusals
 *  map to stable codes (translated client-side), everything else is logged
 *  here and answered generically. */
export function sendError(res: VercelResponse, e: unknown, fallback = 'Request failed'): void {
  if (e instanceof RunBusyError) {
    res.status(409).json({ error: 'busy' })
    return
  }
  const msg = e instanceof Error ? e.message : String(e)
  if (/cannot be billed twice/i.test(msg)) {
    res.status(409).json({ error: 'duplicate' })
    return
  }
  if (/already has an invoice covering/i.test(msg)) {
    res.status(409).json({ error: 'overlap' })
    return
  }
  console.error(`[vendor-invoices] ${fallback}: ${msg}`)
  res.status(500).json({ error: 'generic' })
}

// ─── Runs ────────────────────────────────────────────────────────────────────

export const RUN_COLUMNS =
  'id, vendor_id, source, status, period_start, period_end, created_at, created_by, submitted_at, submitted_by, ' +
  'returned_at, returned_by, returned_note, vendor_reference, vendor_total, approved_at, archived_at, vendor_draft_meta'

export interface RunRow {
  id: string
  vendor_id: string
  source: string
  status: string
  period_start: string
  period_end: string
  created_at: string
  created_by: string | null
  submitted_at: string | null
  submitted_by: string | null
  returned_at: string | null
  returned_by: string | null
  returned_note: string | null
  vendor_reference: string | null
  vendor_total: number | string | null
  approved_at: string | null
  archived_at: string | null
  vendor_draft_meta: Record<string, any> | null
}

/** A run this vendor owns, made in the portal. Anything else is a 404 — never
 *  reveal that a run id exists for another vendor or an admin upload. */
export async function loadVendorRun(supabase: SupabaseClient, runId: unknown, vendorId: string): Promise<RunRow | null> {
  if (typeof runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(runId)) return null
  const { data } = await supabase
    .from('invoice_runs')
    .select(RUN_COLUMNS)
    .eq('id', runId)
    .eq('vendor_id', vendorId)
    .eq('source', 'vendor_portal')
    .is('archived_at', null)
    .maybeSingle()
  return (data as unknown as RunRow) ?? null
}

export interface VendorRunSummary {
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

export function serializeRun(run: RunRow, total: number | null): VendorRunSummary {
  const status = vendorRunStatus(run)
  return {
    id: run.id,
    period_start: run.period_start,
    period_end: run.period_end,
    status,
    created_at: run.created_at,
    submitted_at: run.submitted_at,
    returned_at: run.returned_at,
    // Tendwell's return note is written FOR the vendor; shown only while the
    // invoice is back in their hands.
    returned_note: status === 'returned' ? run.returned_note : null,
    vendor_reference: run.vendor_reference,
    total,
    approved_at: run.approved_at,
  }
}

// ─── Lines ───────────────────────────────────────────────────────────────────

export const LINE_COLUMNS =
  'id, line_no, split_group, source, raw_note_text, raw_amount, raw_date_mentioned, service_date, property_id, ' +
  'service_type, line_kind, cleaner_pay_amount, flags, review_status, vendor_category, vendor_detail, receipt_path'

export interface LineRow {
  id: string
  line_no: number
  split_group: number | null
  source: string
  raw_note_text: string | null
  raw_amount: number | string
  raw_date_mentioned: string | null
  service_date: string | null
  property_id: number | null
  service_type: string | null
  line_kind: string
  cleaner_pay_amount: number | string | null
  flags: string[] | null
  review_status: string
  vendor_category: string | null
  vendor_detail: Record<string, any> | null
  receipt_path: string | null
}

export async function loadRunLines(supabase: SupabaseClient, runId: string): Promise<LineRow[]> {
  return fetchAllRows<LineRow>(
    'invoice_lines (vendor)',
    () => supabase.from('invoice_lines').select(LINE_COLUMNS).eq('run_id', runId).order('line_no').order('id') as any,
    'line_no',
  )
}

/** Rows the vendor never sees: Tendwell's own client-billing rows (billable
 *  Breezeway/Trellis tasks the vendor did not bill) and client-only split
 *  rows (the $50 onboarding surcharge, a disputed $0 onboarding add-on) —
 *  money that is neither the vendor's pay nor the vendor's claim. */
export function isVendorVisible(r: LineRow): boolean {
  if (r.source === 'task') return false
  const pay = Number(r.cleaner_pay_amount ?? 0)
  if (r.split_group != null && r.line_kind === 'extra' && Number(r.raw_amount) === 0 && pay === 0) return false
  return true
}

export function isRemoved(r: Pick<LineRow, 'review_status' | 'line_kind'>): boolean {
  return r.review_status === 'excluded' || r.line_kind === 'excluded'
}

/** What Tendwell pays the vendor for this row. A vendor-entered item before
 *  the engine has priced it shows what the vendor entered. */
export function vendorAmount(r: LineRow): number | null {
  if (r.cleaner_pay_amount != null) return round2(Number(r.cleaner_pay_amount))
  if (r.vendor_category && r.vendor_category !== 'clean') return round2(Number(r.raw_amount))
  return null
}

export const MANUAL_CATEGORIES: ReadonlySet<string> = new Set(['reimbursement', 'inspection', 'labor'])
export const ENGINE_ITEM_CATEGORIES: ReadonlySet<string> = new Set(['missing_clean', 'extra'])

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

/** Exactly the Property List's fields — nothing about the client. */
export async function loadVendorProperties(supabase: SupabaseClient, ids?: number[]): Promise<Map<number, VendorProperty>> {
  const [rows, stages] = await Promise.all([
    fetchAllRows<any>(
      'properties (vendor)',
      () => {
        let q = supabase
          .from('properties')
          .select('id, name, address, bedrooms, full_baths, guest_count, square_footage, cleaner_pay, stage_id')
          .is('deleted_at', null)
          .order('id')
        if (ids) q = q.in('id', ids.length ? ids : [-1])
        return q as any
      },
      'id',
    ),
    supabase.from('pipeline_stages').select('id, name'),
  ])
  const stageName = new Map<number, string>((stages.data ?? []).map((s: any) => [Number(s.id), String(s.name)]))
  const out = new Map<number, VendorProperty>()
  for (const p of rows) {
    out.set(Number(p.id), {
      id: Number(p.id),
      name: String(p.name),
      address: p.address ?? null,
      bedrooms: p.bedrooms == null ? null : Number(p.bedrooms),
      full_baths: p.full_baths == null ? null : Number(p.full_baths),
      guest_count: p.guest_count == null ? null : Number(p.guest_count),
      square_footage: p.square_footage == null ? null : Number(p.square_footage),
      cleaner_pay: p.cleaner_pay == null ? null : Number(p.cleaner_pay),
      status: p.stage_id == null ? null : stageName.get(Number(p.stage_id)) ?? null,
    })
  }
  return out
}

export interface VendorLine {
  id: string
  line_no: number
  category: string
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

function lineCategory(r: LineRow): string {
  if (r.vendor_category) return r.vendor_category
  if (r.line_kind === 'operating_expense') return 'labor'
  if (r.line_kind === 'extra') return r.service_type === 'Reimbursement' ? 'reimbursement' : 'extra'
  return 'clean'
}

export function serializeLine(r: LineRow, runIsDraft: boolean): VendorLine {
  const d = r.vendor_detail ?? {}
  const removed = isRemoved(r)
  const removedByVendor = removed && typeof d.removed_reason === 'string'
  const category = lineCategory(r)
  const vendorItem = category !== 'clean'
  return {
    id: r.id,
    line_no: r.line_no,
    category,
    service_type: r.service_type ?? (typeof d.service_type === 'string' ? d.service_type : null),
    date: r.service_date ?? r.raw_date_mentioned ?? null,
    amount: removed ? 0 : vendorAmount(r),
    property_id: r.property_id,
    removed,
    removed_by: removed ? (removedByVendor ? 'you' : 'tendwell') : null,
    removed_reason: removedByVendor ? String(d.removed_reason) : null,
    in_review: r.review_status === 'needs_review',
    notices: removed ? [] : vendorNotices([...(r.flags ?? []), ...(Array.isArray(d.flags) ? d.flags : [])]),
    task_title: typeof d.task_title === 'string' ? d.task_title : null,
    task_count: Array.isArray(d.task_ids) ? d.task_ids.length : 0,
    editable: runIsDraft && vendorItem && !!r.vendor_category && !removed,
    detail: {
      worker: d.worker ?? null,
      hours: d.hours == null ? null : Number(d.hours),
      rate: d.rate == null ? null : Number(d.rate),
      description: d.description ?? null,
      requested_by: d.requested_by ?? null,
      evidence_url: d.evidence_url ?? null,
      has_receipt: !!r.receipt_path,
    },
  }
}

export function vendorTotal(lines: LineRow[]): number {
  return round2(
    lines
      .filter(r => isVendorVisible(r) && !isRemoved(r))
      .reduce((a, r) => a + (vendorAmount(r) ?? 0), 0),
  )
}

/** Receipts live under a per-vendor, per-run prefix; an item may only point
 *  at a file uploaded for this run. */
export function receiptPrefix(vendorId: string, runId: string): string {
  return `vendor-portal/${vendorId}/${runId}/`
}

export function isOwnReceiptPath(path: string | null | undefined, vendorId: string, runId: string): boolean {
  if (!path) return true
  const prefix = receiptPrefix(vendorId, runId)
  return path.startsWith(prefix) && !path.includes('..') && /^[A-Za-z0-9._\-/]+$/.test(path)
}

// ─── Billed days ─────────────────────────────────────────────────────────────

const CLEAN_KINDS = ['clean', 'deep_clean', 'combined_split']

/** Property-days already billed elsewhere: cleans on approved/exported runs
 *  (any source — an uploaded CSV counts) and on every other active
 *  vendor-portal invoice (draft or submitted). Value = where, for the vendor:
 *  the period of THEIR OWN invoice, or null for anyone else's (another
 *  vendor's or Tendwell's runs are none of their business). */
export async function blockedDaysFor(
  supabase: SupabaseClient,
  runId: string,
  vendorId: string,
  start: string,
  end: string,
): Promise<Map<string, string | null>> {
  const rows = await fetchAllRows<any>(
    'invoice_lines (billed days)',
    () => supabase
      .from('invoice_lines')
      .select('id, property_id, service_date, raw_date_mentioned, run_id, invoice_runs!inner(source, status, archived_at, period_start, period_end, vendor_id)')
      .neq('run_id', runId)
      .in('line_kind', CLEAN_KINDS)
      .neq('review_status', 'excluded')
      .not('property_id', 'is', null)
      .is('invoice_runs.archived_at', null)
      .neq('invoice_runs.status', 'void')
      .or(`and(service_date.gte.${start},service_date.lte.${end}),and(service_date.is.null,raw_date_mentioned.gte.${start},raw_date_mentioned.lte.${end})`)
      .order('id') as any,
    'id',
  )
  const out = new Map<string, string | null>()
  for (const r of rows) {
    const run = Array.isArray(r.invoice_runs) ? r.invoice_runs[0] : r.invoice_runs
    if (!run) continue
    const billed = run.status === 'approved' || run.status === 'exported'
    if (!billed && run.source !== 'vendor_portal') continue // stale admin drafts don't block
    const d = r.service_date ?? r.raw_date_mentioned
    if (!d) continue
    const own = run.vendor_id === vendorId && run.source === 'vendor_portal'
    out.set(`${Number(r.property_id)}|${String(d)}`, own ? `${run.period_start} – ${run.period_end}` : null)
  }
  return out
}

// ─── Receipts ────────────────────────────────────────────────────────────────

export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024
export const RECEIPT_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
])

/** The uploaded file really exists and really is a photo/PDF under 10 MB —
 *  checked from storage metadata, not from what the browser declared when it
 *  asked for the upload link. */
export async function receiptOk(supabase: SupabaseClient, path: string): Promise<boolean> {
  const slash = path.lastIndexOf('/')
  const name = path.slice(slash + 1)
  const { data } = await supabase.storage.from(RECEIPT_BUCKET).list(path.slice(0, slash), { search: name })
  const file = (data ?? []).find(f => f.name === name)
  if (!file) return false
  const meta = (file.metadata ?? {}) as { size?: number; mimetype?: string }
  if (typeof meta.size === 'number' && (meta.size <= 0 || meta.size > RECEIPT_MAX_BYTES)) return false
  if (typeof meta.mimetype === 'string' && !RECEIPT_MIME_TYPES.has(meta.mimetype.toLowerCase())) return false
  return true
}

/** Remove a receipt file only when no other line still points at it. */
export async function removeReceiptIfUnused(supabase: SupabaseClient, path: string | null | undefined, exceptLineNo: number): Promise<void> {
  if (!path) return
  const { data } = await supabase.from('invoice_lines').select('line_no').eq('receipt_path', path)
  if ((data ?? []).some(r => Number(r.line_no) !== exceptLineNo)) return
  await supabase.storage.from(RECEIPT_BUCKET).remove([path])
}
