// Shared I/O shell for the invoicing endpoints. All Supabase access for the
// engine lives here; api/invoices/_engine.ts stays pure. Auth reuses the
// QBO admin-bearer primitive (same cross-import pattern as api/ramp/spend.ts).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  reconcile,
  round2,
  type AliasRow,
  type BillingChannel,
  type EngineLine,
  type PropertyRates,
  type RawLine,
  type RunSummary,
  type TaskRow,
} from './_engine.js'

export { requireAdminBearer } from '../qbo/_lib.js'

export function getServiceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

// ─── Engine context ──────────────────────────────────────────────────────────

export interface EngineContext {
  properties: PropertyRates[]
  aliases: AliasRow[]
  tasks: TaskRow[]
}

// Tasks are pulled with a ±14-day pad around the invoice period so catch-up
// lines ("we forgot this cabin last week") can still match their task.
const TASK_WINDOW_PAD_DAYS = 14

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function loadEngineContext(
  supabase: SupabaseClient,
  periodStart: string,
  periodEnd: string,
): Promise<EngineContext> {
  const [propsRes, contactsRes, aliasesRes, tasksRes] = await Promise.all([
    supabase
      .from('properties')
      .select('id, name, ce_charged, cleaner_pay, deep_clean_3x_ce, contact_id')
      .is('deleted_at', null),
    supabase.from('contacts').select('id, billing_channel'),
    supabase.from('vendor_property_aliases').select('vendor_id, alias_raw, property_id'),
    supabase
      .from('breezeway_tasks')
      .select('external_id, property_id, due_date, task_title, is_clean, is_deep_clean, raw')
      .gte('due_date', shiftDate(periodStart, -TASK_WINDOW_PAD_DAYS))
      .lte('due_date', shiftDate(periodEnd, TASK_WINDOW_PAD_DAYS)),
  ])
  const firstError = propsRes.error ?? contactsRes.error ?? aliasesRes.error ?? tasksRes.error
  if (firstError) throw new Error(`Failed to load engine context: ${firstError.message}`)

  const channelByContact = new Map<string, BillingChannel>()
  for (const c of (contactsRes.data ?? []) as Array<{ id: string; billing_channel: BillingChannel }>) {
    channelByContact.set(c.id, c.billing_channel)
  }

  const properties: PropertyRates[] = ((propsRes.data ?? []) as Array<{
    id: number
    name: string
    ce_charged: number | null
    cleaner_pay: number | null
    deep_clean_3x_ce: number | null
    contact_id: string | null
  }>).map(p => ({
    id: p.id,
    name: p.name,
    ceCharged: p.ce_charged,
    cleanerPay: p.cleaner_pay,
    deepClean3xCe: p.deep_clean_3x_ce,
    billingChannel: p.contact_id ? channelByContact.get(p.contact_id) ?? null : null,
  }))

  const aliases: AliasRow[] = ((aliasesRes.data ?? []) as Array<{
    vendor_id: string | null
    alias_raw: string
    property_id: number
  }>).map(a => ({ vendorId: a.vendor_id, aliasRaw: a.alias_raw, propertyId: a.property_id }))

  const tasks: TaskRow[] = ((tasksRes.data ?? []) as Array<{
    external_id: string
    property_id: number | null
    due_date: string | null
    task_title: string
    is_clean: boolean
    is_deep_clean: boolean
    raw: Record<string, unknown> | null
  }>).map(t => {
    const costRaw = t.raw?.['Total cost']
    const cost = typeof costRaw === 'string' ? Number(costRaw.replace(/[^0-9.-]/g, '')) : typeof costRaw === 'number' ? costRaw : NaN
    return {
      externalId: t.external_id,
      propertyId: t.property_id,
      dueDate: t.due_date,
      title: t.task_title,
      isClean: t.is_clean,
      isDeepClean: t.is_deep_clean,
      totalCostRef: Number.isFinite(cost) ? cost : null,
    }
  })

  return { properties, aliases, tasks }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

interface InvoiceLineInsert {
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
  line_kind: string
  cleaner_pay_amount: number | null
  client_charge_amount: number | null
  billing_channel: string | null
  flags: string[]
  review_status: string
}

export function toLineInserts(runId: string, lines: EngineLine[]): InvoiceLineInsert[] {
  return lines.map(l => ({
    run_id: runId,
    line_no: l.lineNo,
    split_group: l.splitGroup,
    source: l.source,
    raw_property_text: l.rawPropertyText,
    raw_note_text: l.rawNoteText,
    raw_amount: round2(l.rawAmount),
    raw_date_mentioned: l.rawDateMentioned,
    property_id: l.propertyId,
    alias_confidence: l.aliasConfidence,
    matched_task_id: l.matchedTaskId,
    service_type: l.serviceType,
    line_kind: l.lineKind,
    cleaner_pay_amount: l.cleanerPayAmount,
    client_charge_amount: l.clientChargeAmount,
    billing_channel: l.billingChannel,
    flags: l.flags,
    review_status: l.reviewStatus,
  }))
}

export interface ReconcileResult {
  summary: RunSummary
  status: 'reconciled' | 'review_needed'
}

// Run the engine over a run's raw lines and persist the classified output.
// Rows a human already resolved (review_status='resolved') or added manually
// (source='manual') are preserved untouched; everything else is rebuilt.
export async function reconcileRun(
  supabase: SupabaseClient,
  runId: string,
): Promise<ReconcileResult> {
  const { data: run, error: runErr } = await supabase
    .from('invoice_runs')
    .select('id, vendor_id, period_start, period_end, invoice_date, stated_subtotal, status')
    .eq('id', runId)
    .single()
  if (runErr || !run) throw new Error(`Run not found: ${runErr?.message ?? runId}`)
  if (run.status === 'approved' || run.status === 'exported') {
    throw new Error('Run is approved/exported — void it before re-reconciling')
  }

  const { data: lineRows, error: linesErr } = await supabase
    .from('invoice_lines')
    .select('*')
    .eq('run_id', runId)
    .order('line_no')
  if (linesErr) throw new Error(`Failed to load lines: ${linesErr.message}`)

  const rows = (lineRows ?? []) as Array<Record<string, any>>
  const preserved = rows.filter(r => r.review_status === 'resolved' || r.source === 'manual')
  const preservedLineNos = new Set(preserved.map(r => r.line_no))
  const rebuild = rows.filter(r => !preservedLineNos.has(r.line_no))

  // Reconstruct one RawLine per original line_no. Split rows share a line_no;
  // the base row (kind != 'extra' or no split_group) carries the original
  // vendor amount and raw text.
  const byLineNo = new Map<number, Record<string, any>>()
  for (const r of rebuild) {
    const existing = byLineNo.get(r.line_no)
    const isBase = r.split_group == null || r.line_kind !== 'extra'
    if (!existing || isBase) {
      if (!existing || existing.split_group != null) byLineNo.set(r.line_no, r)
    }
  }
  const rawLines: RawLine[] = [...byLineNo.values()]
    .sort((a, b) => a.line_no - b.line_no)
    .map(r => ({
      lineNo: r.line_no,
      source: r.source === 'manual' ? 'manual' : r.source,
      rawPropertyText: r.raw_property_text,
      rawNoteText: r.raw_note_text,
      rawAmount: Number(r.raw_amount),
      rawDateMentioned: r.raw_date_mentioned,
    }))

  const periodStart = run.period_start ?? run.invoice_date ?? new Date().toISOString().slice(0, 10)
  const periodEnd = run.period_end ?? run.invoice_date ?? periodStart
  const ctx = await loadEngineContext(supabase, periodStart, periodEnd)

  const { lines, summary } = reconcile({
    vendorId: run.vendor_id,
    lines: rawLines,
    aliases: ctx.aliases,
    properties: ctx.properties,
    tasks: ctx.tasks,
    periodStart,
    periodEnd,
  })

  // Replace rebuilt rows atomically-ish: delete then insert (staff-only table,
  // single-writer workflow — a lost race here just means re-running reconcile).
  if (rebuild.length > 0) {
    const { error: delErr } = await supabase
      .from('invoice_lines')
      .delete()
      .eq('run_id', runId)
      .not('line_no', 'in', `(${preservedLineNos.size ? [...preservedLineNos].join(',') : '-1'})`)
    if (delErr) throw new Error(`Failed to clear lines: ${delErr.message}`)
  }
  if (lines.length > 0) {
    const inserts = toLineInserts(runId, lines.filter(l => !preservedLineNos.has(l.lineNo)))
    if (inserts.length > 0) {
      const { error: insErr } = await supabase.from('invoice_lines').insert(inserts)
      if (insErr) throw new Error(`Failed to insert lines: ${insErr.message}`)
    }
  }

  const stated = run.stated_subtotal != null ? Number(run.stated_subtotal) : null
  const subtotalOk = stated == null || Math.abs(summary.totalInvoiced - stated) <= 0.005
  const needsReview = summary.needsReviewCount > 0 || !subtotalOk
  const status: ReconcileResult['status'] = needsReview ? 'review_needed' : 'reconciled'

  const { error: updErr } = await supabase
    .from('invoice_runs')
    .update({ status, computed_subtotal: summary.totalInvoiced })
    .eq('id', runId)
  if (updErr) throw new Error(`Failed to update run: ${updErr.message}`)

  return { summary, status }
}

// Bounded raw-body drain for text/csv posts (same pattern as
// api/tasks/breezeway-import.ts).
export async function readRawBody(req: AsyncIterable<Buffer | string>): Promise<string> {
  const MAX_BYTES = 10 * 1024 * 1024
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buf.length
    if (total > MAX_BYTES) throw new Error('Request body too large')
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}
