// Shared I/O shell for the invoicing endpoints. All Supabase access for the
// engine lives here; api/invoices/_engine.ts stays pure. Auth reuses the
// QBO admin-bearer primitive (same cross-import pattern as api/ramp/spend.ts).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  isExcludedTitle,
  reconcile,
  round2,
  standardizeTitle,
  type AliasRow,
  type BillingChannel,
  type EngineLine,
  type PropertyRates,
  type RawLine,
  type RunSummary,
  type TaskRow,
} from './_engine.js'

import { requirePermissionBearer } from '../qbo/_lib.js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

/** Gate for every api/invoices/* endpoint: the caller needs the `invoicing`
 *  EDIT grant (admins always pass). Every endpoint here mutates a run or
 *  assigns the sequential QBO invoice number, so none of them are read-only.
 *  Grant-driven rather than admin-only so Settings → Roles & Permissions
 *  actually governs this area — see 20260817c_permission_driven_invoicing.sql,
 *  which points the invoicing table policies at the same SQL helpers. */
export function requireInvoicingBearer(req: VercelRequest, res: VercelResponse) {
  return requirePermissionBearer(req, res, 'invoicing', 'edit')
}

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

/** PostgREST caps every response at `db-max-rows` (1000 on Supabase) and
 *  reports the truncation only in the Content-Range header — the JSON body
 *  looks like a complete, successful result. An unpaginated context load is
 *  therefore silently lossy the moment a table crosses that line, and the
 *  engine can only conclude "no task exists" for the rows it never received.
 *
 *  Real case: invoice run "Test 1" (2026-06-06 → 2026-07-05). With the ±14d
 *  pad its task window held 2,254 breezeway_tasks, so the engine saw the first
 *  1,000 — everything due after ~2026-06-24 was invisible. 103 of its 112
 *  `unmatched_task` lines had a matching clean sitting in the table on a
 *  resolved property, within the engine's own ±3-day rule. Weekly invoices
 *  (~1,460 rows in window) stayed under the cap for their own period, which is
 *  why this only showed up on a month-long run.
 *
 *  Pages until a short page arrives, so it is correct for any table size.
 *  The explicit order is required: without a stable sort, two pages can
 *  overlap or skip rows. */
const PAGE_SIZE = 1000

export async function fetchAllRows<T>(
  label: string,
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> },
  orderedBy: string,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`Failed to load ${label}: ${error.message}`)
    const page = data ?? []
    out.push(...page)
    if (page.length < PAGE_SIZE) return out
    // Guard against an unbounded loop if a table ever grows pathologically:
    // 100k rows is far beyond any plausible context load here.
    if (out.length >= 100 * PAGE_SIZE) {
      throw new Error(`Refusing to page past ${out.length} rows of ${label} (ordered by ${orderedBy})`)
    }
  }
}

export async function loadEngineContext(
  supabase: SupabaseClient,
  periodStart: string,
  periodEnd: string,
): Promise<EngineContext> {
  const taskWindowStart = shiftDate(periodStart, -TASK_WINDOW_PAD_DAYS)
  const taskWindowEnd = shiftDate(periodEnd, TASK_WINDOW_PAD_DAYS)

  // Every one of these is paged: a truncated context makes the engine flag
  // real cleans as `unmatched_task`, and it does so silently. See fetchAllRows.
  const [propRowsRaw, contactRows, aliasRows, taskRows, trellisRows] = await Promise.all([
    fetchAllRows<{
      id: number
      name: string
      ce_charged: number | null
      cleaner_pay: number | null
      deep_clean_3x_ce: number | null
      contact_id: string | null
      trellis_id: string | null
    }>(
      'properties',
      () => supabase
        .from('properties')
        .select('id, name, ce_charged, cleaner_pay, deep_clean_3x_ce, contact_id, trellis_id')
        .is('deleted_at', null)
        .order('id'),
      'id',
    ),
    fetchAllRows<{ id: string; billing_channel: BillingChannel }>(
      'contacts',
      () => supabase.from('contacts').select('id, billing_channel').order('id'),
      'id',
    ),
    fetchAllRows<{ vendor_id: string | null; alias_raw: string; property_id: number }>(
      'vendor_property_aliases',
      () => supabase
        .from('vendor_property_aliases')
        .select('vendor_id, alias_raw, property_id')
        .order('alias_raw'),
      'alias_raw',
    ),
    fetchAllRows<{
      external_id: string
      property_id: number | null
      due_date: string | null
      task_title: string
      is_clean: boolean
      is_deep_clean: boolean
      raw: Record<string, unknown> | null
    }>(
      'breezeway_tasks',
      () => supabase
        .from('breezeway_tasks')
        .select('external_id, property_id, due_date, task_title, is_clean, is_deep_clean, raw')
        .gte('due_date', taskWindowStart)
        .lte('due_date', taskWindowEnd)
        .order('external_id'),
      'external_id',
    ),
    // Trellis cleans too: Breezeway alone missed ~half the 8/10–8/16 week
    // (88 of 172 property-day cleans; 84 existed only in Trellis). Task-level
    // union with Breezeway winning per (property, day) — the property-level
    // rule from financial_monthly_cleans undercounts for invoicing.
    fetchAllRows<{
      trellis_task_id: string
      trellis_property_id: string | null
      title: string | null
      status: string | null
      scheduled_date: string | null
    }>(
      'trellis_task_snapshot',
      () => supabase
        .from('trellis_task_snapshot')
        .select('trellis_task_id, trellis_property_id, title, status, scheduled_date')
        .ilike('department_name', '%clean%')
        .gte('scheduled_date', taskWindowStart)
        .lte('scheduled_date', taskWindowEnd)
        .order('trellis_task_id'),
      'trellis_task_id',
    ),
  ])

  const channelByContact = new Map<string, BillingChannel>()
  for (const c of contactRows) {
    channelByContact.set(c.id, c.billing_channel)
  }

  const propRows = propRowsRaw
  const properties: PropertyRates[] = propRows.map(p => ({
    id: p.id,
    name: p.name,
    ceCharged: p.ce_charged,
    cleanerPay: p.cleaner_pay,
    deepClean3xCe: p.deep_clean_3x_ce,
    billingChannel: p.contact_id ? channelByContact.get(p.contact_id) ?? null : null,
  }))
  const propertyByTrellisId = new Map<string, number>()
  for (const p of propRows) if (p.trellis_id) propertyByTrellisId.set(p.trellis_id, p.id)

  const aliases: AliasRow[] = aliasRows.map(a => ({
    vendorId: a.vendor_id,
    aliasRaw: a.alias_raw,
    propertyId: a.property_id,
  }))

  const tasks: TaskRow[] = taskRows.map(t => {
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

  // Trellis cleans for property-days Breezeway doesn't cover. Breezeway wins
  // per (property, day) so a clean tracked in both systems counts once.
  // externalId is 'trellis:'-prefixed — matched_task_id historically meant
  // breezeway_tasks.external_id, and the prefix keeps provenance unambiguous.
  // Title rules mirror the engine: standardizeTitle must yield a base clean;
  // Cleaner Self-Inspections / Air Filter Changes are excluded; hot-tub and
  // other extra-only titles never generate a draft clean.
  const bwCleanDays = new Set(
    tasks.filter(t => (t.isClean || t.isDeepClean) && t.propertyId != null && t.dueDate != null)
      .map(t => `${t.propertyId}|${t.dueDate}`),
  )
  const trellisTasks: TaskRow[] = trellisRows
    .map(t => {
      const propertyId = t.trellis_property_id ? propertyByTrellisId.get(t.trellis_property_id) ?? null : null
      const title = t.title ?? ''
      const excluded = isExcludedTitle(title)
      const std = standardizeTitle(title)
      const isDeep = !excluded && /deep\s*clean/i.test(title)
      return {
        externalId: `trellis:${t.trellis_task_id}`,
        propertyId,
        dueDate: t.scheduled_date,
        title,
        isClean: !excluded && !isDeep && std != null && !std.isExtra,
        isDeepClean: isDeep,
        totalCostRef: null,
        status: t.status ?? '',
      }
    })
    .filter(t =>
      (t.isClean || t.isDeepClean) &&
      t.propertyId != null &&
      t.dueDate != null &&
      !/cancel/i.test(t.status) &&
      !bwCleanDays.has(`${t.propertyId}|${t.dueDate}`),
    )
    .map(({ status: _s, ...t }) => t)

  return { properties, aliases, tasks: [...tasks, ...trellisTasks] }
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

  // Paged: a month-long run can carry >1000 lines once splits are added, and
  // a truncated read here would silently drop preserved (resolved/manual)
  // rows and skew computed_subtotal.
  const rows = await fetchAllRows<Record<string, any>>(
    'invoice_lines',
    () => supabase
      .from('invoice_lines')
      .select('*')
      .eq('run_id', runId)
      .order('line_no'),
    'line_no',
  )
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

  // Preserved rows keep their original split_group numbers while the engine
  // restarts its counter at 1 each run — without an offset, a rebuilt split
  // collides with a preserved one and unrelated rows read as one group (real
  // case: Luning Wang + Samyuktha Ravi both landed in group 1 on I260810797,
  // which corrupted a downstream group-sum repair by $210).
  const maxPreservedGroup = preserved.reduce((m, r) => Math.max(m, Number(r.split_group ?? 0)), 0)
  const offsetLines = maxPreservedGroup > 0
    ? lines.map(l => (l.splitGroup != null ? { ...l, splitGroup: l.splitGroup + maxPreservedGroup } : l))
    : lines

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
    const inserts = toLineInserts(runId, offsetLines.filter(l => !preservedLineNos.has(l.lineNo)))
    if (inserts.length > 0) {
      const { error: insErr } = await supabase.from('invoice_lines').insert(inserts)
      if (insErr) throw new Error(`Failed to insert lines: ${insErr.message}`)
    }
  }

  // Preserved (human-resolved / manual) rows never enter the engine, so the
  // engine's summary omits them — the stored computed_subtotal and totals
  // must include them or the penny gate drifts as soon as a human edits an
  // invoiced amount or adds a line. Split rows share a line_no: only the base
  // row (no split_group, or non-extra kind) carries the vendor's raw amount.
  const preservedBaseByLineNo = new Map<number, Record<string, any>>()
  for (const r of preserved) {
    const isBase = r.split_group == null || r.line_kind !== 'extra'
    if (isBase) preservedBaseByLineNo.set(r.line_no, r)
  }
  const preservedInvoiced = round2(
    [...preservedBaseByLineNo.values()].reduce((a, r) => a + Number(r.raw_amount ?? 0), 0),
  )
  summary.totalInvoiced = round2(summary.totalInvoiced + preservedInvoiced)
  summary.totalCleanerPay = round2(
    summary.totalCleanerPay +
      preserved.filter(r => r.line_kind !== 'excluded').reduce((a, r) => a + Number(r.cleaner_pay_amount ?? 0), 0),
  )
  summary.totalClientCharge = round2(
    summary.totalClientCharge +
      preserved
        .filter(r => r.line_kind !== 'excluded' && r.line_kind !== 'operating_expense')
        .reduce((a, r) => a + Number(r.client_charge_amount ?? 0), 0),
  )

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
