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
  type BilledClean,
  type BillingChannel,
  type EngineLine,
  type PropertyRates,
  type RawLine,
  type RunSummary,
  type StayRow,
  type TaskRow,
} from './_engine.js'
import { buildTaskLines, isHumanTouchedTaskLine, type AuxTaskRow, type ExistingLineRef } from './_aux.js'
import {
  APP_SETTING_AUX_BILLABLE,
  APP_SETTING_EXTRA_PRICING,
  isTaskCancelled,
  feeOverridesByContact,
  isTaskCompleted,
  resolveAuxSettings,
  type AuxBillingSettings,
} from '../../shared/aux-tasks.js'

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
  /** properties.trellis_id → properties.id, for resolving Trellis snapshot rows. */
  propertyByTrellisId: Map<string, number>
  /** Earliest Tendwell clean per property (onboarding is only valid on it). */
  firstCleanByProperty: Map<number, string>
  /** Cleans already billed on OTHER approved/exported runs near this period. */
  billedCleans: BilledClean[]
  /** Haven reservations around the period (owner blocks flagged). */
  stays: StayRow[]
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

export interface BreezewayTaskInput {
  external_id: string
  property_id: number | null
  due_date: string | null
  task_title: string
  is_clean: boolean
  is_deep_clean: boolean
  raw?: Record<string, unknown> | null
  status: string | null
  completed_date: string | null
}
export interface TrellisTaskInput {
  trellis_task_id: string
  trellis_property_id: string | null
  title: string | null
  status: string | null
  scheduled_date: string | null
  completed_at: string | null
}

/** Pure: Breezeway + Trellis rows → the engine's clean-task evidence pool.
 *  Exported so the replay/verification scripts use the exact same rules. */
export function buildEngineTasks(
  taskRows: BreezewayTaskInput[],
  trellisRows: TrellisTaskInput[],
  propertyByTrellisId: Map<string, number>,
): { tasks: TaskRow[]; trellisTasks: TaskRow[] } {
  // A Breezeway row's own is_clean flag predates the engine's title rules
  // ("Post-Owner Stay Clean - HT" imported as not-a-clean), so the engine's
  // rules decide here, the same way they do for Trellis.
  const engineIsClean = (title: string) => {
    if (isExcludedTitle(title) || /deep\s*clean/i.test(title)) return false
    const std = standardizeTitle(title)
    return std != null && !std.isExtra && !/in?spection|walkthrough/i.test(std.title)
  }
  const tasks: TaskRow[] = taskRows
    .filter(t => !isTaskCancelled(t.status))
    .map(t => {
      const costRaw = t.raw?.['Total cost']
      const cost = typeof costRaw === 'string' ? Number(costRaw.replace(/[^0-9.-]/g, '')) : typeof costRaw === 'number' ? costRaw : NaN
      return {
        externalId: t.external_id,
        propertyId: t.property_id,
        dueDate: t.due_date,
        title: t.task_title,
        isClean: !t.is_deep_clean && (t.is_clean || engineIsClean(t.task_title)),
        isDeepClean: t.is_deep_clean,
        totalCostRef: Number.isFinite(cost) ? cost : null,
        completed: isTaskCompleted('breezeway', t.status, t.completed_date),
        source: 'breezeway' as const,
      }
    })

  // Trellis cleans join the evidence pool unless Breezeway already has a
  // COMPLETED clean for that property-day (Breezeway wins only when it has the
  // real, finished task — an open ghost row must never hide Trellis's
  // completed one). externalId is 'trellis:'-prefixed for provenance.
  const bwDoneCleanDays = new Set(
    tasks.filter(t => (t.isClean || t.isDeepClean) && t.completed && t.propertyId != null && t.dueDate != null)
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
        // Same rule as Breezeway: an inspection/walkthrough is not a clean.
        // (Chad Williams 223-202, 9/30: a completed "Cleaning Inspection" tied
        // with the real Turn Clean and won the label.)
        isClean: !excluded && !isDeep && std != null && !std.isExtra && engineIsClean(title),
        isDeepClean: isDeep,
        totalCostRef: null,
        completed: isTaskCompleted('trellis', t.status, t.completed_at),
        source: 'trellis' as const,
        status: t.status ?? '',
      }
    })
    .filter(t =>
      (t.isClean || t.isDeepClean) &&
      t.propertyId != null &&
      t.dueDate != null &&
      !isTaskCancelled(t.status) &&
      !bwDoneCleanDays.has(`${t.propertyId}|${t.dueDate}`),
    )
    .map(({ status: _s, ...t }) => t)

  return { tasks, trellisTasks }
}

export async function loadEngineContext(
  supabase: SupabaseClient,
  periodStart: string,
  periodEnd: string,
  excludeRunId: string | null = null,
): Promise<EngineContext> {
  const taskWindowStart = shiftDate(periodStart, -TASK_WINDOW_PAD_DAYS)
  const taskWindowEnd = shiftDate(periodEnd, TASK_WINDOW_PAD_DAYS)

  // Every one of these is paged: a truncated context makes the engine flag
  // real cleans as `unmatched_task`, and it does so silently. See fetchAllRows.
  const [propRowsRaw, contactRows, aliasRows, taskRows, trellisRows, overrideRows] = await Promise.all([
    fetchAllRows<{
      id: number
      name: string
      ce_charged: number | null
      cleaner_pay: number | null
      deep_clean_3x_ce: number | null
      contact_id: string | null
      trellis_id: string | null
      hot_tub: boolean | null
    }>(
      'properties',
      () => supabase
        .from('properties')
        .select('id, name, ce_charged, cleaner_pay, deep_clean_3x_ce, contact_id, trellis_id, hot_tub')
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
      status: string | null
      completed_date: string | null
    }>(
      'breezeway_tasks',
      () => supabase
        .from('breezeway_tasks')
        .select('external_id, property_id, due_date, task_title, is_clean, is_deep_clean, raw, status, completed_date')
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
      completed_at: string | null
    }>(
      'trellis_task_snapshot',
      () => supabase
        .from('trellis_task_snapshot')
        .select('trellis_task_id, trellis_property_id, title, status, scheduled_date, completed_at')
        // A NULL department is not "not cleaning": 4 completed "Turn Clean"
        // rows in the 90 days to 2026-09-22 carried no department and were
        // invisible here, so their vendor lines flagged unmatched_task. The
        // title rules below still decide what counts as a clean.
        .or('department_name.ilike.%clean%,department_name.is.null')
        .gte('scheduled_date', taskWindowStart)
        .lte('scheduled_date', taskWindowEnd)
        .order('trellis_task_id'),
      'trellis_task_id',
    ),
    // Per-client negotiated fee prices (Invoicing → Task audit → Client fee
    // overrides). Resolved per property through contact_id, like the billing
    // channel, so every property of one client prices the same.
    fetchAllRows<{ contact_id: string | null; service_type: string; charge: number | string | null; hot_tub_charge: number | string | null }>(
      'client_fee_overrides',
      () => supabase
        .from('client_fee_overrides')
        .select('id, contact_id, service_type, charge, hot_tub_charge')
        .order('id'),
      'id',
    ),
  ])

  const overridesByContact = feeOverridesByContact(overrideRows)
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
    hotTub: p.hot_tub === true,
    feeOverrides: p.contact_id ? overridesByContact.get(p.contact_id) : undefined,
  }))
  const propertyByTrellisId = new Map<string, number>()
  for (const p of propRows) if (p.trellis_id) propertyByTrellisId.set(p.trellis_id, p.id)

  const aliases: AliasRow[] = aliasRows.map(a => ({
    vendorId: a.vendor_id,
    aliasRaw: a.alias_raw,
    propertyId: a.property_id,
  }))

  const { tasks, trellisTasks } = buildEngineTasks(taskRows, trellisRows, propertyByTrellisId)

  // Onboarding evidence + cross-invoice duplicate guard.
  const [firstRows, billedRows] = await Promise.all([
    fetchAllRows<{ property_id: number; first_clean_date: string }>(
      'property_first_tendwell_clean',
      () => supabase.from('property_first_tendwell_clean').select('property_id, first_clean_date').order('property_id'),
      'property_id',
    ),
    fetchAllRows<{
      id: string
      property_id: number
      raw_date_mentioned: string | null
      service_date: string | null
      matched_task_id: string | null
      line_no: number
      run_id: string
      invoice_runs: { qbo_invoice_no: number | null; status: string; archived_at: string | null } | null
    }>(
      'invoice_lines (billed cleans)',
      () => {
        let q = supabase
          .from('invoice_lines')
          .select('id, property_id, raw_date_mentioned, service_date, matched_task_id, line_no, run_id, invoice_runs!inner(qbo_invoice_no, status, archived_at)')
          .in('invoice_runs.status', ['approved', 'exported'])
          .is('invoice_runs.archived_at', null)
          .in('line_kind', ['clean', 'combined_split', 'deep_clean'])
          .neq('review_status', 'excluded')
          .not('property_id', 'is', null)
          .gte('raw_date_mentioned', taskWindowStart)
          .lte('raw_date_mentioned', taskWindowEnd)
          .order('id')
        if (excludeRunId) q = q.neq('run_id', excludeRunId)
        return q
      },
      'id',
    ),
  ])
  const firstCleanByProperty = new Map<number, string>()
  for (const r of firstRows) firstCleanByProperty.set(Number(r.property_id), String(r.first_clean_date))
  const billedCleans: BilledClean[] = billedRows.map(r => ({
    propertyId: Number(r.property_id),
    date: String(r.service_date ?? r.raw_date_mentioned),
    taskId: r.matched_task_id,
    ref: `invoice ${r.invoice_runs?.qbo_invoice_no ?? '(unnumbered)'} line ${r.line_no}`,
  }))

  const stays = await loadStays(supabase, taskWindowStart, taskWindowEnd, propertyByTrellisId)

  return { properties, aliases, tasks: [...tasks, ...trellisTasks], propertyByTrellisId, firstCleanByProperty, billedCleans, stays }
}

/** Reservations that overlap the window, mapped onto Ops properties (primary
 *  trellis_id, then property_aliases.trellis_id for duplicate/renamed Trellis
 *  records). Best-effort: with no snapshot (table missing / never synced)
 *  owner stays come only from "Post-Owner Stay Clean" task titles. */
export async function loadStays(
  supabase: SupabaseClient,
  windowStart: string,
  windowEnd: string,
  propertyByTrellisId: ReadonlyMap<string, number>,
): Promise<StayRow[]> {
  try {
    const [rows, aliasRows] = await Promise.all([
      fetchAllRows<{
        trellis_reservation_id: string
        trellis_property_id: string | null
        guest_name: string | null
        checkin_date: string | null
        checkout_date: string | null
        is_owner_block: boolean | null
      }>(
        'trellis_reservation_snapshot',
        () => supabase
          .from('trellis_reservation_snapshot')
          .select('trellis_reservation_id, trellis_property_id, guest_name, checkin_date, checkout_date, is_owner_block')
          // Overlap, padded so a checkout just before the window still counts.
          .gte('checkout_date', shiftDate(windowStart, -7))
          .lte('checkin_date', windowEnd)
          .order('trellis_reservation_id'),
        'trellis_reservation_id',
      ),
      fetchAllRows<{ id: string; property_id: number; trellis_id: string | null }>(
        'property_aliases',
        () => supabase.from('property_aliases').select('id, property_id, trellis_id').not('trellis_id', 'is', null).order('id'),
        'id',
      ),
    ])
    const byTrellis = new Map(propertyByTrellisId)
    for (const a of aliasRows) if (a.trellis_id && !byTrellis.has(a.trellis_id)) byTrellis.set(a.trellis_id, Number(a.property_id))
    const out: StayRow[] = []
    for (const r of rows) {
      const propertyId = r.trellis_property_id ? byTrellis.get(r.trellis_property_id) : undefined
      if (propertyId == null || !r.checkin_date || !r.checkout_date) continue
      out.push({
        propertyId,
        checkin: r.checkin_date,
        checkout: r.checkout_date,
        isOwner: r.is_owner_block === true,
        guestName: r.guest_name,
      })
    }
    return out
  } catch (e) {
    console.error('owner-stay reservations unavailable:', e)
    return []
  }
}

// ─── Billable auxiliary tasks (see _aux.ts) ──────────────────────────────────

/** Pricing + billability overrides from app_settings, merged over the shared defaults. */
export async function loadAuxSettings(supabase: SupabaseClient): Promise<AuxBillingSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', [APP_SETTING_EXTRA_PRICING, APP_SETTING_AUX_BILLABLE])
  if (error) throw new Error(`Failed to load invoicing settings: ${error.message}`)
  const byKey = new Map<string, unknown>((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]))
  return resolveAuxSettings({
    pricing: byKey.get(APP_SETTING_EXTRA_PRICING),
    billable: byKey.get(APP_SETTING_AUX_BILLABLE),
  })
}

/**
 * Every task (any department, any status) in [start, end] from BOTH sources,
 * property-resolved. Unlike the clean loader above this does not pad the
 * window or filter by department — a hot tub refresh lives under Maintenance
 * as often as Cleaning, and only work dated inside the period bills. The
 * builder (_aux.ts) decides completion, billability and Breezeway-vs-Trellis
 * dedup; this stays a dumb, paged read.
 */
export async function loadAuxiliaryTasks(
  supabase: SupabaseClient,
  start: string,
  end: string,
  propertyByTrellisId: ReadonlyMap<string, number>,
): Promise<AuxTaskRow[]> {
  const [bw, tr] = await Promise.all([
    fetchAllRows<{
      external_id: string
      property_id: number | null
      due_date: string | null
      task_title: string
      department: string | null
      status: string | null
      completed_date: string | null
    }>(
      'breezeway_tasks (aux)',
      () => supabase
        .from('breezeway_tasks')
        .select('external_id, property_id, due_date, task_title, department, status, completed_date')
        .gte('due_date', start)
        .lte('due_date', end)
        .order('external_id'),
      'external_id',
    ),
    fetchAllRows<{
      trellis_task_id: string
      trellis_property_id: string | null
      title: string | null
      department_name: string | null
      status: string | null
      scheduled_date: string | null
      completed_at: string | null
    }>(
      'trellis_task_snapshot (aux)',
      () => supabase
        .from('trellis_task_snapshot')
        .select('trellis_task_id, trellis_property_id, title, department_name, status, scheduled_date, completed_at')
        .gte('scheduled_date', start)
        .lte('scheduled_date', end)
        .order('trellis_task_id'),
      'trellis_task_id',
    ),
  ])
  const rows: AuxTaskRow[] = []
  for (const t of bw) {
    rows.push({
      externalId: t.external_id,
      source: 'breezeway',
      propertyId: t.property_id,
      date: t.due_date,
      title: t.task_title,
      department: t.department,
      completed: isTaskCompleted('breezeway', t.status, t.completed_date),
      cancelled: isTaskCancelled(t.status),
    })
  }
  for (const t of tr) {
    rows.push({
      externalId: `trellis:${t.trellis_task_id}`,
      source: 'trellis',
      propertyId: t.trellis_property_id ? propertyByTrellisId.get(t.trellis_property_id) ?? null : null,
      date: t.scheduled_date,
      title: t.title ?? '',
      department: t.department_name,
      completed: isTaskCompleted('trellis', t.status, t.completed_at),
      cancelled: isTaskCancelled(t.status),
    })
  }
  return rows
}

export interface TaskLineSyncResult {
  inserted: number
  kept: number
  totalClientCharge: number
  needsReviewCount: number
}

/**
 * Bring a run's `source='task'` lines in step with the completed billable
 * tasks in its period. Human-touched task rows (dismissed / resolved / edited)
 * are kept exactly as they are — a dismissal sticks across reconciles and a
 * dismissed task is never re-added (the builder sees its matched_task_id).
 * Untouched task rows are deleted and rebuilt so a settings change (price,
 * billability) or a late-arriving task lands without anyone doing anything.
 */
export async function syncTaskLines(
  supabase: SupabaseClient,
  runId: string,
  input: {
    periodStart: string
    periodEnd: string
    properties: PropertyRates[]
    propertyByTrellisId: ReadonlyMap<string, number>
    /** Every existing source='task' row on the run (any state). */
    taskRows: Array<Record<string, any>>
    /** Every non-task line that will be on the run after this reconcile. */
    otherLines: ExistingLineRef[]
    nextLineNo: number
    stays?: StayRow[]
  },
): Promise<TaskLineSyncResult> {
  const kept = input.taskRows.filter(isHumanTouchedTaskLine)
  const stale = input.taskRows.filter(r => !isHumanTouchedTaskLine(r))
  for (let i = 0; i < stale.length; i += 200) {
    const ids = stale.slice(i, i + 200).map(r => r.id as string)
    const { error } = await supabase.from('invoice_lines').delete().in('id', ids)
    if (error) throw new Error(`Failed to clear task lines: ${error.message}`)
  }

  const [settings, tasks, dismissedObs] = await Promise.all([
    loadAuxSettings(supabase),
    loadAuxiliaryTasks(supabase, input.periodStart, input.periodEnd, input.propertyByTrellisId),
    // A task dismissed from the Task Audit view BEFORE any run covered its
    // date has no invoice line to remember the dismissal by — the audit view
    // records it as a dismissed observation pointing at the task instead.
    // Fed in as excluded refs so the builder skips it (already_on_run) and
    // never counts it as a vendor line.
    fetchAllRows<{ matched_task_id: string }>(
      'task_audit_observations (dismissed)',
      () => supabase
        .from('task_audit_observations')
        .select('matched_task_id')
        .eq('status', 'dismissed')
        .not('matched_task_id', 'is', null)
        .gte('occurred_on', shiftDate(input.periodStart, -1))
        .lte('occurred_on', shiftDate(input.periodEnd, 1))
        .order('id'),
      'id',
    ),
  ])
  const existing: ExistingLineRef[] = [
    ...input.otherLines,
    ...dismissedObs.map(o => ({
      source: 'observation',
      propertyId: null,
      serviceType: null,
      date: null,
      matchedTaskId: o.matched_task_id,
      lineKind: 'excluded',
      reviewStatus: 'excluded',
    })),
    ...kept.map(r => ({
      source: String(r.source),
      propertyId: r.property_id == null ? null : Number(r.property_id),
      serviceType: r.service_type ?? null,
      date: r.raw_date_mentioned ?? null,
      matchedTaskId: r.matched_task_id ?? null,
      lineKind: String(r.line_kind),
      reviewStatus: String(r.review_status),
    })),
  ]
  const built = buildTaskLines({
    tasks,
    existing,
    properties: new Map(input.properties.map(p => [p.id, p])),
    settings,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    nextLineNo: input.nextLineNo,
    stays: input.stays,
  })
  if (built.inserts.length > 0) {
    const { error } = await supabase
      .from('invoice_lines')
      .insert(built.inserts.map(l => ({ ...l, run_id: runId })))
    if (error) throw new Error(`Failed to insert task lines: ${error.message}`)
  }

  const keptActive = kept.filter(r => r.line_kind !== 'excluded' && r.review_status !== 'excluded')
  return {
    inserted: built.inserts.length,
    kept: kept.length,
    totalClientCharge: round2(
      built.totalClientCharge + keptActive.reduce((a, r) => a + Number(r.client_charge_amount ?? 0), 0),
    ),
    needsReviewCount: built.needsReviewCount + kept.filter(r => r.review_status === 'needs_review').length,
  }
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
  engine_note: string | null
  service_date: string | null
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
    engine_note: l.engineNote,
    service_date: l.serviceDate ?? l.rawDateMentioned ?? null,
  }))
}

export interface ReconcileResult {
  summary: RunSummary
  status: 'reconciled' | 'review_needed'
  /** Billable Breezeway/Trellis task lines added / kept on this pass (see _aux.ts). */
  taskLines: TaskLineSyncResult
}

// Route still-unrouted billable lines from their client's current channel.
// Why: reconcile preserves human-resolved and manual rows untouched, so when
// a client's billing channel is fixed AFTER those rows exist (Clients page
// payment method, or the review dialog's "save as client default"), the
// lines kept 'none' and Approve refused the whole run (I260906806, Morgan
// Hogg, 2026-09-07). Called from reconcile and approve. Never downgrades a
// routed line; lines without a property are left for the property guard.
export async function refreshBillingChannels(supabase: SupabaseClient, runId: string): Promise<number> {
  const lines = await fetchAllRows<{ id: string; property_id: number; flags: string[] | null }>(
    'invoice_lines (unrouted)',
    () => supabase
      .from('invoice_lines')
      .select('id, property_id, flags')
      .eq('run_id', runId)
      .not('line_kind', 'in', '(operating_expense,excluded)')
      .neq('review_status', 'excluded')
      .or('billing_channel.is.null,billing_channel.eq.none')
      .not('property_id', 'is', null)
      .order('id'),
    'id',
  )
  if (lines.length === 0) return 0

  const propertyIds = [...new Set(lines.map(l => l.property_id))]
  const { data: props, error: propErr } = await supabase
    .from('properties')
    .select('id, contact_id')
    .in('id', propertyIds)
  if (propErr) throw new Error(`Failed to load properties for channel refresh: ${propErr.message}`)
  const contactByProperty = new Map<number, string>()
  for (const p of (props ?? []) as Array<{ id: number; contact_id: string | null }>) {
    if (p.contact_id) contactByProperty.set(p.id, p.contact_id)
  }
  const contactIds = [...new Set(contactByProperty.values())]
  if (contactIds.length === 0) return 0
  const { data: contacts, error: cErr } = await supabase
    .from('contacts')
    .select('id, billing_channel')
    .in('id', contactIds)
  if (cErr) throw new Error(`Failed to load contacts for channel refresh: ${cErr.message}`)
  const channelByContact = new Map<string, BillingChannel>()
  for (const c of (contacts ?? []) as Array<{ id: string; billing_channel: BillingChannel }>) {
    channelByContact.set(c.id, c.billing_channel)
  }

  let updated = 0
  for (const line of lines) {
    const contactId = contactByProperty.get(line.property_id)
    const channel = contactId ? channelByContact.get(contactId) : undefined
    if (!channel || channel === 'none') continue
    const { error } = await supabase
      .from('invoice_lines')
      .update({
        billing_channel: channel,
        flags: (line.flags ?? []).filter(f => f !== 'no_billing_channel'),
      })
      .eq('id', line.id)
    if (error) throw new Error(`Failed to route line ${line.id}: ${error.message}`)
    updated += 1
  }
  return updated
}

// Run the engine over a run's raw lines and persist the classified output.
// Rows a human already resolved (review_status='resolved'), excluded
// (review_status/line_kind='excluded'), or added manually (source='manual')
// are preserved untouched; everything else is rebuilt.
export function shouldPreserveInvoiceLine(r: {
  review_status?: string | null
  source?: string | null
  line_kind?: string | null
}): boolean {
  return (
    r.review_status === 'resolved' ||
    r.review_status === 'excluded' ||
    r.line_kind === 'excluded' ||
    r.source === 'manual'
  )
}

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
  // a truncated read here would silently drop preserved (resolved/manual/
  // excluded) rows and skew computed_subtotal.
  const rows = await fetchAllRows<Record<string, any>>(
    'invoice_lines',
    () => supabase
      .from('invoice_lines')
      .select('*')
      .eq('run_id', runId)
      .order('line_no'),
    'line_no',
  )
  // Task-derived rows (billable Breezeway/Trellis tasks, source='task') never
  // enter the engine — syncTaskLines rebuilds them from the task tables once
  // the vendor lines are settled — so they sit outside both buckets here.
  const taskRows = rows.filter(r => r.source === 'task')
  const taskLineNos = taskRows.map(r => Number(r.line_no))
  const nonTaskRows = rows.filter(r => r.source !== 'task')
  const preserved = nonTaskRows.filter(shouldPreserveInvoiceLine)
  const preservedLineNos = new Set(preserved.map(r => r.line_no))
  const rebuild = nonTaskRows.filter(r => !preservedLineNos.has(r.line_no))

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
  const ctx = await loadEngineContext(supabase, periodStart, periodEnd, runId)

  const { lines, summary } = reconcile({
    firstCleanByProperty: ctx.firstCleanByProperty,
    billedCleans: ctx.billedCleans,
    stays: ctx.stays,
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
    const keepLineNos = [...preservedLineNos, ...taskLineNos]
    const { error: delErr } = await supabase
      .from('invoice_lines')
      .delete()
      .eq('run_id', runId)
      .not('line_no', 'in', `(${keepLineNos.length ? keepLineNos.join(',') : '-1'})`)
    if (delErr) throw new Error(`Failed to clear lines: ${delErr.message}`)
  }
  if (lines.length > 0) {
    const inserts = toLineInserts(runId, offsetLines.filter(l => !preservedLineNos.has(l.lineNo)))
    if (inserts.length > 0) {
      const { error: insErr } = await supabase.from('invoice_lines').insert(inserts)
      if (insErr) throw new Error(`Failed to insert lines: ${insErr.message}`)
    }
  }

  // Billable auxiliary tasks the vendor did not invoice (hot tub refreshes,
  // trash pickups… — see _aux.ts). Runs after the vendor lines are settled so
  // the builder can see what the vendor DID bill and never double-charge.
  // raw_amount is 0 on every task line, so computed_subtotal is unaffected.
  const maxLineNo = Math.max(0, ...rows.map(r => Number(r.line_no)), ...lines.map(l => l.lineNo))
  const asRef = (l: {
    source: string; propertyId: number | null; serviceType: string | null
    date: string | null; matchedTaskId: string | null; lineKind: string; reviewStatus: string
  }): ExistingLineRef => l
  const taskSync = await syncTaskLines(supabase, runId, {
    periodStart,
    periodEnd,
    properties: ctx.properties,
    propertyByTrellisId: ctx.propertyByTrellisId,
    stays: ctx.stays,
    taskRows,
    otherLines: [
      ...preserved.map(r => asRef({
        source: String(r.source),
        propertyId: r.property_id == null ? null : Number(r.property_id),
        serviceType: r.service_type ?? null,
        date: r.raw_date_mentioned ?? null,
        matchedTaskId: r.matched_task_id ?? null,
        lineKind: String(r.line_kind),
        reviewStatus: String(r.review_status),
      })),
      ...offsetLines
        .filter(l => !preservedLineNos.has(l.lineNo))
        .map(l => asRef({
          source: l.source,
          propertyId: l.propertyId,
          serviceType: l.serviceType,
          date: l.rawDateMentioned,
          matchedTaskId: l.matchedTaskId,
          lineKind: l.lineKind,
          reviewStatus: l.reviewStatus,
        })),
    ],
    nextLineNo: maxLineNo + 1,
  })
  summary.totalClientCharge = round2(summary.totalClientCharge + taskSync.totalClientCharge)
  summary.needsReviewCount += taskSync.needsReviewCount

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
  // A human can exclude a line in review (e.g. a caught duplicate) without
  // the engine ever reclassifying line_kind — review_status='excluded' is
  // that signal and must count the same as line_kind='excluded' here, or a
  // line marked excluded in review still inflates these totals (and, via
  // isApLine/isArLine in _exporters.ts, still gets paid/billed in full).
  summary.totalCleanerPay = round2(
    summary.totalCleanerPay +
      preserved
        .filter(r => r.line_kind !== 'excluded' && r.review_status !== 'excluded')
        .reduce((a, r) => a + Number(r.cleaner_pay_amount ?? 0), 0),
  )
  summary.totalClientCharge = round2(
    summary.totalClientCharge +
      preserved
        .filter(r => r.line_kind !== 'excluded' && r.review_status !== 'excluded' && r.line_kind !== 'operating_expense')
        .reduce((a, r) => a + Number(r.client_charge_amount ?? 0), 0),
  )

  // Preserved rows never see the engine's channel lookup — pick up any client
  // channel fixed since they were resolved (see refreshBillingChannels).
  await refreshBillingChannels(supabase, runId)

  const stated = run.stated_subtotal != null ? Number(run.stated_subtotal) : null
  const subtotalOk = stated == null || Math.abs(summary.totalInvoiced - stated) <= 0.005
  const needsReview = summary.needsReviewCount > 0 || !subtotalOk
  const status: ReconcileResult['status'] = needsReview ? 'review_needed' : 'reconciled'

  const { error: updErr } = await supabase
    .from('invoice_runs')
    .update({ status, computed_subtotal: summary.totalInvoiced })
    .eq('id', runId)
  if (updErr) throw new Error(`Failed to update run: ${updErr.message}`)

  return { summary, status, taskLines: taskSync }
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
