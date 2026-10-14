// Shared Trellis → Supabase sync logic.
// Called by both the cron endpoints and the on-demand sync-now endpoint.
// The onProgress callback fires at each phase/chunk and should UPDATE the
// trellis_sync_log row's `progress` column. It is a best-effort fire-and-forget;
// errors in the callback do not abort the sync.
//
// Reliability (2026-10-14, plan review: the hourly tasks-only sync failed
// 104/210 runs in 14 days, 91 killed at the 300 s platform limit, 13 Trellis
// 429s):
//   - Run-wide deadline. Every Trellis call checks it; when it passes the run
//     stops CLEANLY: whatever was fetched is upserted, the prune is skipped
//     (it would delete rows this run never got to) and the result says
//     partial=true so the caller records status 'partial', not 'done'.
//   - Workspace-B per-member pull runs over ACTIVE roster members only and in
//     batches (`assigned_to_id in [...]`) instead of one query per member.
//   - Pacing between calls and 429 backoff with jitter, bounded by the deadline.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { autoActivateProperties } from '../tasks/_auto-stage.js'
import {
  classifyTrellisTask, planRosterDeactivation, workforcePullComplete, planCleanerSync,
  SYNC_OFFBOARDED_BY, TRELLIS_NIL_USER, type RosterMember, type CleanerRow,
} from '../../shared/trellis-sync-rules.js'

export interface SyncProgress {
  phase: string
  current: number
  total: number
  pct: number
  eta_seconds: number
  message: string
}

export type ProgressCallback = (p: SyncProgress) => Promise<void>

export interface SyncCounts {
  roster: number
  props_a: number
  props_b: number
  tasks_a: number
  tasks_b: number
  window: [string, string]
  /** True when the run hit its deadline and stopped early (status 'partial'). */
  partial?: boolean
  stopped_phase?: string
  elapsed_s?: number
  trellis_calls?: number
  retries_429?: number
  retries_5xx?: number
  roster_complete?: boolean
  roster_deactivated?: number
  roster_deferred?: number
  b_members?: number
  cleaners?: Record<string, unknown>
}

export interface SyncOptions {
  trigger: 'nightly' | 'manual' | 'on-demand' | 'hourly'
  /** Refresh only the task snapshot (skip roster + property phases). The
   *  workspace-A roster ids are read from the trellis_roster table (kept
   *  current by the nightly full sync) instead of re-pulled from Trellis. */
  tasksOnly?: boolean
  /** Existing log row id to claim. If omitted a new row is inserted. */
  logId?: string
  requestedBy?: string
  onProgress?: ProgressCallback
  /** Row id of the trellis_sync_log entry being written, so the core can
   *  poll cancel_requested at each checkpoint. Required for cancellation. */
  syncLogId?: string
  /** Supabase service-role client to use for cancel checks. Required when
   *  syncLogId is provided. */
  cancelCheckClient?: SupabaseClient
  /** Absolute epoch ms by which the run must stop. Default: start + 250 s
   *  (the functions have 300 s; the rest is for upserts + the log write). */
  deadlineMs?: number
}

export const DEFAULT_RUN_BUDGET_MS = 250_000

/** Status a caller records for a finished run. */
export function syncStatusFor(counts: { partial?: boolean }): 'done' | 'partial' {
  return counts.partial ? 'partial' : 'done'
}

// ── MCP / Trellis keys ───────────────────────────────────────────────────────

function trellisKeys(): { A: string; B: string } {
  // Primary (works on Vercel serverless): per-workspace env vars.
  const envA = process.env.TRELLIS_WORKSPACE_A_KEY
  const envB = process.env.TRELLIS_WORKSPACE_B_KEY
  if (envA && envB) return { A: envA, B: envB }

  // Local-dev fallback only: read the Trellis MCP keys from ~/.claude.json.
  // This branch never runs on Vercel (no home config there).
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'))
    const s = cfg.mcpServers || {}
    const A = envA || s['trellis-workspace-a']?.env?.TRELLIS_API_KEY
    const B = envB || s['trellis-workspace-b']?.env?.TRELLIS_API_KEY
    if (A && B) return { A, B }
  } catch {
    // fall through to the error below
  }

  throw new Error(
    'Trellis API keys not configured. Set TRELLIS_WORKSPACE_A_KEY and TRELLIS_WORKSPACE_B_KEY ' +
      'env vars (required on Vercel), or provide trellis-workspace-a/b keys in ~/.claude.json for local dev.',
  )
}

// ── Run context: deadline, pacing, 429 backoff ──────────────────────────────

/** Thrown when the run deadline passes; callers stop cleanly (partial). */
export class SyncDeadlineError extends Error {
  constructor(message = 'Run deadline reached') { super(message); this.name = 'SyncDeadlineError' }
}

export interface TrellisRunContext {
  deadlineMs: number
  /** Minimum gap between Trellis calls (ms), plus up to `jitterMs`. */
  minGapMs: number
  jitterMs: number
  lastCallAt: number
  calls: number
  retries429: number
  retries5xx: number
}

export function makeRunContext(deadlineMs: number, opts: { minGapMs?: number; jitterMs?: number } = {}): TrellisRunContext {
  return { deadlineMs, minGapMs: opts.minGapMs ?? 200, jitterMs: opts.jitterMs ?? 150, lastCallAt: 0, calls: 0, retries429: 0, retries5xx: 0 }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, Math.max(0, ms)))
const remaining = (ctx: TrellisRunContext) => ctx.deadlineMs - Date.now()

/** 429 backoff: 2 s, 4 s, 8 s … plus up to 1 s jitter. */
export function backoffMs(attempt: number, rand: () => number = Math.random): number {
  return 2000 * 2 ** attempt + Math.floor(rand() * 1000)
}

// ── JSON-RPC MCP call ────────────────────────────────────────────────────────

const ENDPOINT = process.env.TRELLIS_ENDPOINT || 'https://api.trellistech.com/v1/mcp-server'
let rpcId = 0

async function callTool(
  apiKey: string, name: string, args: Record<string, unknown>, ctx: TrellisRunContext | null, attempt = 0,
): Promise<unknown> {
  if (ctx) {
    if (remaining(ctx) <= 2_000) throw new SyncDeadlineError()
    const gap = ctx.minGapMs + Math.floor(Math.random() * ctx.jitterMs) - (Date.now() - ctx.lastCallAt)
    if (gap > 0) await sleep(gap)
    ctx.lastCallAt = Date.now()
    ctx.calls++
  }
  const body = { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }
  const timeout = ctx ? Math.max(5_000, Math.min(60_000, remaining(ctx))) : 60_000
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  }).catch(e => {
    if (ctx && remaining(ctx) <= 2_000) throw new SyncDeadlineError()
    throw e
  })
  const text = await res.text()
  // Trellis rate-limits bursts ("Rate limit exceeded. Retry shortly."). Back
  // off with jitter and retry, but never past the run deadline.
  // Gateway errors (502/503/504) are transient on Trellis's side (seen
  // 2026-10-14 mid-backfill): same backoff, fewer attempts.
  const transient = res.status === 429 || ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < 3)
  if (transient && attempt < 5) {
    const wait = backoffMs(attempt)
    if (ctx) {
      if (res.status === 429) ctx.retries429++
      else ctx.retries5xx++
      if (wait > remaining(ctx) - 5_000) throw new SyncDeadlineError(`Run deadline reached while retrying (HTTP ${res.status})`)
    }
    await sleep(wait)
    return callTool(apiKey, name, args, ctx, attempt + 1)
  }
  if (!res.ok) throw new Error(`Trellis ${name} HTTP ${res.status}: ${text.slice(0, 300)}`)

  let json: { error?: { message: string }; result?: { structuredContent?: unknown; content?: Array<{ type: string; text: string }> } }
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  if (ct.includes('text/event-stream')) {
    let last: string | null = null
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
      if (data) last = data
    }
    json = JSON.parse(last!)
  } else {
    json = JSON.parse(text)
  }
  if (json.error) throw new Error(`Trellis ${name} error: ${json.error.message}`)

  const result = json.result
  let out: unknown = result
  if (result?.structuredContent) out = result.structuredContent
  else if (result && Array.isArray(result.content)) {
    const part = result.content.find(c => c.type === 'text')
    if (part) out = JSON.parse(part.text)
  }
  // Tool-level failures come back as HTTP 200 + {ok:false, error}. Without
  // this they read as "no rows" (a bad filter silently returned nothing).
  if (out && typeof out === 'object' && (out as { ok?: unknown }).ok === false) {
    const o = out as { error?: unknown; error_type?: unknown }
    throw new Error(`Trellis ${name} failed: ${String(o.error_type ?? '')} ${String(o.error ?? '')}`.trim().slice(0, 400))
  }
  return out
}

/** Call a Trellis MCP tool for a workspace (aux jobs, backfill, scripts). */
export async function callTrellisTool(
  workspace: 'A' | 'B', name: string, args: Record<string, unknown>, ctx: TrellisRunContext | null = null,
): Promise<unknown> {
  const keys = trellisKeys()
  return callTool(workspace === 'A' ? keys.A : keys.B, name, args, ctx)
}

// ── Paginated query ──────────────────────────────────────────────────────────

/** Pull every page of a trellisql query. Rows are pushed into `out` as they
 *  arrive, so a SyncDeadlineError mid-query leaves the caller with what was
 *  fetched (the caller decides whether partial data is safe to upsert). */
export async function queryAll(
  apiKey: string,
  view: string,
  select: string[],
  filters: Record<string, unknown> | null,
  pageSize: number,
  ctx: TrellisRunContext | null = null,
  out: Array<Record<string, unknown>> = [],
): Promise<Array<Record<string, unknown>>> {
  let offset = 0
  for (;;) {
    const args: Record<string, unknown> = { view, select, limit: pageSize, offset }
    if (filters) args.filters = filters
    const r = await callTool(apiKey, 'trellisql_query', args, ctx) as {
      rows?: Array<Record<string, unknown>>
      pagination?: { has_more: boolean; next_offset?: number }
    }
    const rows = r.rows || []
    out.push(...rows)
    if (!r.pagination?.has_more || rows.length === 0) break
    // Trellis can return FEWER rows than asked when a page hits its result
    // budget (it says so with next_offset). Advancing by pageSize would skip
    // the rows in between, so follow next_offset, else what actually came back.
    offset = typeof r.pagination.next_offset === 'number' && r.pagination.next_offset > offset
      ? r.pagination.next_offset
      : offset + rows.length
  }
  return out
}

export async function queryWorkspace(
  workspace: 'A' | 'B', view: string, select: string[], filters: Record<string, unknown> | null,
  pageSize: number, ctx: TrellisRunContext | null = null, out: Array<Record<string, unknown>> = [],
): Promise<Array<Record<string, unknown>>> {
  const keys = trellisKeys()
  return queryAll(workspace === 'A' ? keys.A : keys.B, view, select, filters, pageSize, ctx, out)
}

// ── Supabase batch upsert ────────────────────────────────────────────────────

export async function upsert(
  supabase: SupabaseClient,
  table: string,
  rows: Array<Record<string, unknown>>,
  onConflict: string,
): Promise<void> {
  const BATCH = 100
  for (let i = 0; i < rows.length; i += BATCH) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from(table).upsert(rows.slice(i, i + BATCH), { onConflict })
    if (error) throw new Error(`upsert ${table}: ${error.message}`)
  }
}

// ── Row shape helpers ────────────────────────────────────────────────────────

export const TASK_SELECT = ['id', 'title', 'property_id', 'property_name', 'department_name', 'status', 'priority', 'assigned_to_id', 'assigned_to_name', 'scheduled_date', 'completed_at']
// What a reviewer needs to judge a billed task (invoice service detail,
// 20261012a): what was asked, when, for which stay, who did it. The task's
// `cost` is left out on purpose: trellis_task_snapshot is readable by crews.
export const TASK_DETAIL_SELECT = [
  ...TASK_SELECT,
  'description', 'summary', 'reservation_id', 'created_at', 'scheduled_time', 'source', 'external_id',
  'external_provider_slug', 'assignees', 'checklist_total', 'checklist_completed', 'linked_issue_tasks', 'is_no_charge',
]

/** Full detail for specific tasks, fetched on demand (invoice service detail).
 *  NOT part of the bulk sync: Trellis caps each response at ~12 KB, so the
 *  detailed field list returns ~8 tasks a page instead of 25 and the nightly
 *  sync would blow its 300 s budget. Rows come back keyed by task id, mapped
 *  to trellis_task_snapshot detail columns. */
export async function fetchTaskDetails(
  workspace: 'A' | 'B',
  taskIds: ReadonlyArray<string>,
  opts: { deadlineMs?: number } = {},
): Promise<Map<string, Record<string, unknown>>> {
  const keys = trellisKeys()
  const apiKey = workspace === 'A' ? keys.A : keys.B
  const out = new Map<string, Record<string, unknown>>()
  const BATCH = 40
  for (let i = 0; i < taskIds.length; i += BATCH) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break
    const ids = taskIds.slice(i, i + BATCH)
    const rows = await queryAll(apiKey, 'tasks', ['id', ...TASK_DETAIL_SELECT.filter(f => !TASK_SELECT.includes(f))], { id: { in: ids } }, 50)
    for (const r of rows) if (typeof r.id === 'string') out.set(r.id, taskDetailColumns(r))
  }
  return out
}
const PROP_SELECT = ['id', 'name', 'status', 'city']
const RESERVATION_SELECT = ['id', 'property_id', 'property_name', 'guest_name', 'checkin_date', 'checkout_date', 'status', 'source', 'total_amount']

const now = () => new Date().toISOString()
const isoOffset = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

const propRow = (p: Record<string, unknown>, ws: string) => ({
  trellis_id: p.id, workspace: ws, name: p.name ?? '(unnamed)', status: p.status ?? null, city: p.city ?? null, synced_at: now(),
})
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}
const reservationRow = (r: Record<string, unknown>, ws: string) => ({
  trellis_reservation_id: r.id, workspace: ws, trellis_property_id: r.property_id ?? null,
  property_name: r.property_name ?? null, guest_name: r.guest_name ?? null,
  checkin_date: r.checkin_date ?? null, checkout_date: r.checkout_date ?? null,
  status: r.status ?? null, source: r.source ?? null, total_amount: num(r.total_amount), synced_at: now(),
})

/** Snapshot row for a task, with the classification columns (clean_kind,
 *  is_tendwell, task_category) computed from shared/trellis-sync-rules.ts.
 *  `tendwellMemberIds` = every workspace-A roster user id. */
export const taskRow = (t: Record<string, unknown>, ws: 'A' | 'B', tendwellMemberIds: ReadonlySet<string>) => ({
  trellis_task_id: t.id, workspace: ws, trellis_property_id: t.property_id ?? null,
  property_name: t.property_name ?? null, title: t.title ?? null,
  department_name: t.department_name ?? null, status: t.status ?? null, priority: t.priority ?? null,
  assigned_to_id: t.assigned_to_id ?? null, assigned_to_name: t.assigned_to_name ?? null,
  scheduled_date: t.scheduled_date ?? null, completed_at: t.completed_at ?? null, synced_at: now(),
  ...classifyTrellisTask({ ...t, workspace: ws }, tendwellMemberIds),
  ...taskDetailColumns(t),
})

/** Detail columns, only for a row fetched with the detailed select. Bulk-sync
 *  rows carry none, so the nightly upsert never blanks out cached detail. */
export function taskDetailColumns(t: Record<string, unknown>): Record<string, unknown> {
  if (!('description' in t)) return {}
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null)
  return {
    description: str(t.description),
    summary: str(t.summary),
    reservation_id: str(t.reservation_id),
    task_created_at: str(t.created_at),
    scheduled_time: str(t.scheduled_time),
    task_source: str(t.source),
    external_id: str(t.external_id),
    external_provider: str(t.external_provider_slug),
    assignees: Array.isArray(t.assignees) ? t.assignees : null,
    checklist_total: int(t.checklist_total),
    checklist_completed: int(t.checklist_completed),
    linked_issue_count: Array.isArray(t.linked_issue_tasks) ? t.linked_issue_tasks.length : null,
    is_no_charge: typeof t.is_no_charge === 'boolean' ? t.is_no_charge : null,
  }
}

export function dedupeById(arr: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const m = new Map<unknown, Record<string, unknown>>()
  for (const x of arr) if (x.id) m.set(x.id, x)
  return [...m.values()]
}

/** Every workspace-A roster user id (active or not): the set isTendwellTask
 *  checks, same as invoicing. */
export async function loadTendwellMemberIds(supabase: SupabaseClient): Promise<Set<string>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).from('trellis_roster').select('user_id').eq('workspace', 'A')
  if (error) throw new Error(`trellis_roster read: ${error.message}`)
  return new Set(((data ?? []) as Array<{ user_id: string }>).map(r => r.user_id))
}

// ── Roster pull (paginated) ─────────────────────────────────────────────────

// 44 members at limit 100 came back at 12,483 bytes: right at the ~12 KB cap.
const WORKFORCE_PAGE = 25

export async function pullWorkforce(apiKey: string, ctx: TrellisRunContext | null): Promise<{
  members: Array<Record<string, unknown>>; complete: boolean; total: number | null
}> {
  const members: Array<Record<string, unknown>> = []
  let offset = 0
  let total: number | null = null
  let exhausted = false
  for (let page = 0; page < 40; page++) {
    const wf = await callTool(apiKey, 'read_workforce', { limit: WORKFORCE_PAGE, offset }, ctx) as {
      data?: { members?: Array<Record<string, unknown>>; total?: number; has_more?: boolean; next_offset?: number }
      members?: Array<Record<string, unknown>>
      pagination?: { has_more?: boolean; next_offset?: number; total?: number }
    }
    const rows = wf.data?.members || wf.members || []
    members.push(...rows)
    const t = wf.data?.total ?? wf.pagination?.total
    if (typeof t === 'number') total = t
    const hasMore = wf.data?.has_more ?? wf.pagination?.has_more ?? false
    if (!hasMore || rows.length === 0) { exhausted = true; break }
    const next = wf.data?.next_offset ?? wf.pagination?.next_offset
    offset = typeof next === 'number' && next > offset ? next : offset + rows.length
  }
  const unique = dedupeByKey(members, 'user_id')
  return { members: unique, complete: workforcePullComplete(unique.length, total, exhausted), total }
}

function dedupeByKey(arr: Array<Record<string, unknown>>, key: string): Array<Record<string, unknown>> {
  const m = new Map<unknown, Record<string, unknown>>()
  for (const x of arr) if (x[key]) m.set(x[key], x)
  return [...m.values()]
}

// ── Cleaner sync (DB only: no Trellis calls) ────────────────────────────────

/**
 * Link / create / offboard / reactivate cleaners from trellis_roster. Linking
 * and offboarding always run; creating new cleaners only when
 * app_settings.trellis_cleaner_sync_enabled = 'true'. Never touches
 * app_users (logins) and never renames a cleaner.
 */
export async function syncCleanersFromRoster(supabase: SupabaseClient): Promise<Record<string, unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const [{ data: roster, error: rErr }, { data: cleaners, error: cErr }, { data: setting }, { data: dismissed }] = await Promise.all([
    db.from('trellis_roster').select('user_id, name, email, role, departments, is_active, last_seen_at').eq('workspace', 'A'),
    db.from('cleaners').select('id, full_name, email, alt_email, trellis_user_id, status, offboarded_by'),
    db.from('app_settings').select('value').eq('key', 'trellis_cleaner_sync_enabled').maybeSingle(),
    db.from('trellis_roster_dismissals').select('user_id'),
  ])
  if (rErr) throw new Error(`trellis_roster read: ${rErr.message}`)
  if (cErr) throw new Error(`cleaners read: ${cErr.message}`)
  const autoCreate = String((setting as { value?: string } | null)?.value ?? '').trim().toLowerCase() === 'true'
  const plan = planCleanerSync(roster as RosterMember[], cleaners as CleanerRow[], {
    autoCreate,
    dismissedUserIds: new Set(((dismissed ?? []) as Array<{ user_id: string }>).map(d => d.user_id)),
  })
  const errors: string[] = []
  for (const l of plan.links) {
    const { error } = await db.from('cleaners').update({ trellis_user_id: l.user_id }).eq('id', l.cleaner_id).is('trellis_user_id', null)
    if (error) errors.push(`link ${l.cleaner_id}: ${error.message}`)
  }
  for (const c of plan.creates) {
    const { error } = await db.from('cleaners').insert({
      full_name: c.full_name, email: c.email, trellis_user_id: c.user_id, source: 'trellis', status: 'active',
    })
    if (error) errors.push(`create ${c.user_id}: ${error.message}`)
  }
  if (plan.offboard.length > 0) {
    const { error } = await db.from('cleaners')
      .update({ status: 'offboarded', is_active: false, offboarded_at: now(), offboarded_by: SYNC_OFFBOARDED_BY })
      .in('id', plan.offboard).eq('status', 'active')
    if (error) errors.push(`offboard: ${error.message}`)
  }
  if (plan.reactivate.length > 0) {
    const { error } = await db.from('cleaners')
      .update({ status: 'active', is_active: true })
      .in('id', plan.reactivate).eq('offboarded_by', SYNC_OFFBOARDED_BY)
    if (error) errors.push(`reactivate: ${error.message}`)
  }
  return {
    auto_create: autoCreate,
    linked: plan.links.length,
    created: plan.creates.length,
    offboarded: plan.offboard.length,
    reactivated: plan.reactivate.length,
    skipped: plan.skipped.length,
    ...(errors.length ? { errors: errors.slice(0, 5) } : {}),
  }
}

// ── ETA helper ───────────────────────────────────────────────────────────────
function estimateEta(t0: number, pct: number): number {
  if (pct < 2) return 0
  const elapsed = (Date.now() - t0) / 1000
  return Math.round(elapsed / (pct / 100) - elapsed)
}

// ── Cancellation sentinel ────────────────────────────────────────────────────

// Thrown when cancel_requested=true is detected at a checkpoint.
class SyncCanceledError extends Error {
  constructor() { super('Sync canceled by user request'); this.name = 'SyncCanceledError' }
}

// ── Main sync ────────────────────────────────────────────────────────────────

/** Members per `assigned_to_id in [...]` query in the workspace-B pull. */
const MEMBER_BATCH = 15

export async function runSync(opts: SyncOptions): Promise<SyncCounts> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase config missing')

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { A, B } = trellisKeys()
  const t0 = Date.now()
  const ctx = makeRunContext(opts.deadlineMs ?? t0 + DEFAULT_RUN_BUDGET_MS)
  const runStartIso = new Date(t0).toISOString()
  const windowStart = isoOffset(-30)
  const windowEnd = isoOffset(90)
  const dateFilter = { scheduled_date: { gte: windowStart, lte: windowEnd } }

  let processed = 0
  let estimatedTotal = 750
  let partial = false
  let stoppedPhase: string | undefined
  const extra: Partial<SyncCounts> = {}

  const emit = async (phase: string, current: number, total: number, message: string) => {
    if (!opts.onProgress) return
    const pct = total > 0 ? Math.min(99, Math.round((current / total) * 100)) : 0
    const eta_seconds = estimateEta(t0, pct)
    try {
      await opts.onProgress({ phase, current, total, pct, eta_seconds, message })
    } catch { /* fire-and-forget */ }
  }

  const checkCancel = async () => {
    if (!opts.syncLogId || !opts.cancelCheckClient) return
    const { data } = await opts.cancelCheckClient
      .from('trellis_sync_log')
      .select('cancel_requested')
      .eq('id', opts.syncLogId)
      .single()
    if ((data as { cancel_requested?: boolean } | null)?.cancel_requested) {
      throw new SyncCanceledError()
    }
  }

  /** Run a phase; a deadline stops the run cleanly instead of failing it. */
  const phase = async (name: string, fn: () => Promise<void>): Promise<boolean> => {
    if (partial) return false
    try {
      await fn()
      return true
    } catch (e) {
      if (e instanceof SyncDeadlineError) {
        partial = true
        stoppedPhase = name
        await emit(name, processed, estimatedTotal, `Stopped at the run deadline during ${name}; partial results kept`)
        return false
      }
      throw e
    }
  }

  // ── Workspace A: Roster ──────────────────────────────────────────────────
  // activeIds: who the workspace-B per-member pull covers.
  const activeIds = new Set<string>()
  let rosterSeen = 0
  if (opts.tasksOnly) {
    await emit('roster', 0, estimatedTotal, 'Loading roster from DB…')
    await checkCancel()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: dbRoster, error: rosterErr } = await (supabase as any)
      .from('trellis_roster').select('user_id').eq('workspace', 'A').eq('is_active', true)
    if (rosterErr) throw new Error(`trellis_roster read: ${rosterErr.message}`)
    for (const r of (dbRoster ?? []) as Array<{ user_id: string }>) activeIds.add(r.user_id)
    await emit('roster', 0, estimatedTotal, `Roster loaded from DB (${activeIds.size} active members)`)
    await checkCancel()
  } else {
    await emit('roster', 0, estimatedTotal, 'Loading Workspace A roster…')
    await checkCancel()
    await phase('roster', async () => {
      const pull = await pullWorkforce(A, ctx)
      const seenAt = now()
      const rows = pull.members.filter(m => m.user_id).map(m => ({
        user_id: m.user_id, member_id: m.member_id ?? null, workspace: 'A',
        name: m.name ?? null, email: m.email ?? null, role: m.role ?? null,
        departments: m.departments ?? [], is_active: true, synced_at: seenAt,
        last_seen_at: seenAt, missed_runs: 0, removed_at: null,
      }))
      await upsert(supabase, 'trellis_roster', rows, 'user_id')
      rosterSeen = rows.length
      extra.roster_complete = pull.complete

      // Deactivate members missing from complete pulls (never delete).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing, error } = await (supabase as any).from('trellis_roster')
        .select('user_id, is_active, missed_runs, last_seen_at').eq('workspace', 'A')
      if (error) throw new Error(`trellis_roster read: ${error.message}`)
      const seen = new Set(rows.map(r => String(r.user_id)))
      const plan = planRosterDeactivation(existing ?? [], seen, pull.complete)
      for (const m of plan.missed) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('trellis_roster').update({ missed_runs: m.missed_runs }).eq('user_id', m.user_id)
      }
      if (plan.deactivate.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('trellis_roster').update({ is_active: false, removed_at: now() }).in('user_id', plan.deactivate)
      }
      extra.roster_deactivated = plan.deactivate.length
      extra.roster_deferred = plan.deferred.length
      for (const r of (existing ?? []) as Array<{ user_id: string; is_active: boolean }>) {
        if (r.is_active && !plan.deactivate.includes(r.user_id)) activeIds.add(r.user_id)
      }
      processed += rows.length
      estimatedTotal = Math.max(estimatedTotal, processed + 730)
      await emit('roster', processed, estimatedTotal,
        `Roster loaded (${rows.length} members${pull.complete ? '' : ', pull incomplete: no deactivation'}; ${plan.deactivate.length} deactivated)`)
    })
    await checkCancel()

    // Cleaner linking / offboarding (DB only). Best-effort.
    if (!partial) {
      try {
        extra.cleaners = await syncCleanersFromRoster(supabase)
        await emit('cleaners', processed, estimatedTotal, `Cleaners: ${JSON.stringify(extra.cleaners)}`.slice(0, 300))
      } catch (e) {
        extra.cleaners = { error: e instanceof Error ? e.message : String(e) }
      }
    }
  }
  // isTendwellTask needs every workspace-A roster id (incl. people who left).
  const tendwellIds = await loadTendwellMemberIds(supabase)
  activeIds.delete(TRELLIS_NIL_USER)

  // ── Workspace A: Properties ──────────────────────────────────────────────
  let propsA: Array<Record<string, unknown>> = []
  if (!opts.tasksOnly) {
    await phase('props_a', async () => {
      await emit('props_a', processed, estimatedTotal, 'Pulling Workspace A properties…')
      await checkCancel()
      propsA = await queryAll(A, 'properties', PROP_SELECT, null, 100, ctx)
      await upsert(supabase, 'trellis_property_snapshot', propsA.map(p => propRow(p, 'A')), 'trellis_id')
      processed += propsA.length
      estimatedTotal = Math.max(estimatedTotal, processed + 650)
      await emit('props_a', processed, estimatedTotal, `Workspace A properties done (${propsA.length})`)
    })
    await checkCancel()
  }

  // ── Workspace A: Tasks ───────────────────────────────────────────────────
  // A is never pruned, so partial pages are safe to keep.
  const tasksABuf: Array<Record<string, unknown>> = []
  await phase('tasks_a', async () => {
    await emit('tasks_a', processed, estimatedTotal, 'Pulling Workspace A tasks…')
    await checkCancel()
    try {
      await queryAll(A, 'tasks', TASK_SELECT, dateFilter, 100, ctx, tasksABuf)
    } finally {
      await upsert(supabase, 'trellis_task_snapshot', dedupeById(tasksABuf).map(t => taskRow(t, 'A', tendwellIds)), 'trellis_task_id')
    }
    processed += tasksABuf.length
    estimatedTotal = Math.max(estimatedTotal, processed + 460)
    await emit('tasks_a', processed, estimatedTotal, `Workspace A tasks done (${tasksABuf.length})`)
  })
  const tasksA = dedupeById(tasksABuf)
  await checkCancel()

  // ── Workspace B: Properties ──────────────────────────────────────────────
  let propsB: Array<Record<string, unknown>> = []
  if (!opts.tasksOnly) {
    await phase('props_b', async () => {
      await emit('props_b', processed, estimatedTotal, 'Pulling Workspace B properties…')
      await checkCancel()
      propsB = await queryAll(B, 'properties', PROP_SELECT, null, 50, ctx)
      await upsert(supabase, 'trellis_property_snapshot', propsB.map(p => propRow(p, 'B')), 'trellis_id')
      processed += propsB.length
      estimatedTotal = Math.max(estimatedTotal, processed + 400)
      await emit('props_b', processed, estimatedTotal, `Workspace B properties done (${propsB.length})`)
    })
    await checkCancel()
  }

  // ── Workspace B: Tasks ───────────────────────────────────────────────────
  const bTasks = new Map<unknown, Record<string, unknown>>()
  const addB = (rows: Array<Record<string, unknown>>) => { for (const t of rows) if (t.id) bTasks.set(t.id, t) }
  const bComplete = await phase('tasks_b', async () => {
    await emit('tasks_b', processed, estimatedTotal, 'Pulling Workspace B tasks…')
    await checkCancel()
    try {
      // Tendwell Cleaning Co. (vendor) assignment
      const buf: Array<Record<string, unknown>> = []
      try { await queryAll(B, 'tasks', TASK_SELECT, { assigned_to_name: 'Tendwell Cleaning Co.', ...dateFilter }, 50, ctx, buf) } finally { addB(buf) }
      await checkCancel()
      // Active roster members, batched.
      const ids = [...activeIds]
      extra.b_members = ids.length
      for (let i = 0; i < ids.length; i += MEMBER_BATCH) {
        const chunk = ids.slice(i, i + MEMBER_BATCH)
        const mbuf: Array<Record<string, unknown>> = []
        try { await queryAll(B, 'tasks', TASK_SELECT, { assigned_to_id: { in: chunk }, ...dateFilter }, 50, ctx, mbuf) } finally { addB(mbuf) }
        processed = processed + mbuf.length
        await emit('tasks_b', Math.round(processed), estimatedTotal,
          `Pulling Workspace B tasks… (members ${Math.min(i + MEMBER_BATCH, ids.length)}/${ids.length})`)
        await checkCancel()
      }
      // Completed work must survive in the snapshot: invoicing reconciles
      // every vendor clean against a COMPLETED task, and attribution needs the
      // last clean BY ANYONE. Nightly full sync: also pull every COMPLETED
      // Workspace B task from the last 30 days. A deadline here still counts
      // as partial; any other failure is best-effort.
      if (!opts.tasksOnly) {
        const doneFilter = { status: 'COMPLETED', scheduled_date: { gte: windowStart, lte: isoOffset(0) } }
        const dbuf: Array<Record<string, unknown>> = []
        try {
          await queryAll(B, 'tasks', TASK_SELECT, doneFilter, 50, ctx, dbuf)
        } catch (e) {
          if (e instanceof SyncDeadlineError) throw e
          await emit('tasks_b', Math.round(processed), estimatedTotal, `Completed-task backfill skipped: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300))
        } finally {
          for (const t of dbuf) if (t.id && !bTasks.has(t.id)) bTasks.set(t.id, t)
        }
      }
    } finally {
      // Whatever arrived is real data: keep it even when the run stops early.
      await upsert(supabase, 'trellis_task_snapshot', [...bTasks.values()].map(t => taskRow(t, 'B', tendwellIds)), 'trellis_task_id')
    }
    processed = Math.round(processed)
    estimatedTotal = processed + 10
    await emit('tasks_b', processed, estimatedTotal, `Workspace B tasks done (${bTasks.size})`)
  })
  await checkCancel()

  // ── Prune stale B tasks ──────────────────────────────────────────────────
  // Only after a COMPLETE B pull: a partial run never saw the rest, and
  // pruning would delete live tasks. Never prune a COMPLETED task: it is the
  // record that a clean happened.
  if (bComplete && !partial) {
    await emit('pruning', processed, estimatedTotal, 'Pruning stale Workspace B tasks…')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('trellis_task_snapshot').delete().eq('workspace', 'B').lt('synced_at', runStartIso)
      .neq('status', 'COMPLETED')
  }

  // Auto-activate pre-Active properties that now have a turn/departure clean
  // scheduled. Best-effort: never fail the sync over it.
  try {
    const activated = await autoActivateProperties(supabase)
    if (activated.length > 0) {
      await emit('auto_stage', processed, estimatedTotal, `Auto-activated ${activated.length} propert${activated.length === 1 ? 'y' : 'ies'}: ${activated.map(a => a.name).join(', ').slice(0, 300)}`)
    }
  } catch (e) {
    console.error('auto-activate failed (sync succeeded):', e)
  }

  // ── Workspace B: Reservations (nightly) ──────────────────────────────────
  // Haven's reservation calendar, so invoicing can tell an owner's stay from a
  // guest's. Best-effort, runs LAST, and only when the run has time left; a
  // skip is retried next night (not a partial run).
  if (!opts.tasksOnly && !partial && remaining(ctx) > 60_000) {
    try {
      await emit('reservations', processed, estimatedTotal, 'Pulling Haven reservations…')
      await checkCancel()
      const resStart = isoOffset(-45)
      const resEnd = isoOffset(14)
      const res = dedupeById(await queryAll(B, 'reservations', RESERVATION_SELECT, {
        status: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'],
        checkout_date: { gte: resStart, lte: resEnd },
      }, 100, ctx))
      await upsert(supabase, 'trellis_reservation_snapshot', res.map(r => reservationRow(r, 'B')), 'trellis_reservation_id')
      // A reservation cancelled since the last sync drops out of the query —
      // remove what this run did not see inside the window it covered.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('trellis_reservation_snapshot').delete()
        .eq('workspace', 'B').lt('synced_at', runStartIso)
        .gte('checkout_date', resStart).lte('checkout_date', resEnd)
      await emit('reservations', processed, estimatedTotal, `Reservations done (${res.length})`)
    } catch (e) {
      if (e instanceof SyncCanceledError) throw e
      await emit('reservations', processed, estimatedTotal, `Reservation sync skipped: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300))
    }
    await checkCancel()
  }

  const counts: SyncCounts = {
    roster: opts.tasksOnly ? 0 : rosterSeen,
    props_a: propsA.length,
    props_b: propsB.length,
    tasks_a: tasksA.length,
    tasks_b: bTasks.size,
    window: [windowStart, windowEnd],
    ...extra,
    partial,
    ...(stoppedPhase ? { stopped_phase: stoppedPhase } : {}),
    elapsed_s: Math.round((Date.now() - t0) / 100) / 10,
    trellis_calls: ctx.calls,
    retries_429: ctx.retries429,
    retries_5xx: ctx.retries5xx,
  }
  await emit('done', estimatedTotal, estimatedTotal,
    `Sync ${partial ? `stopped early (deadline, at ${stoppedPhase})` : 'complete'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  return counts
}

export { SyncCanceledError }

// ── Convenience: build a supabase service-role client ───────────────────────
export function makeServiceSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase config missing')
  return createClient(url, key, { auth: { persistSession: false } })
}
