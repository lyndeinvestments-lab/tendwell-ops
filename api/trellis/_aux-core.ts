// Trellis auxiliary sync: guest reviews, assignee enrichment, and resumable
// history backfill (2026-10-14, Trellis API expansion WS1).
//
// Kept OFF the nightly/hourly task sync on purpose (plan review): those runs
// already use most of their 300 s, so these jobs get their own cron
// (api/cron/trellis-aux-sync.ts), their own on-demand endpoint
// (POST /api/trellis/backfill) and their own state table
// (trellis_aux_sync_log). Every step:
//   - honours a run deadline and persists progress per window, so the next
//     run resumes instead of starting over;
//   - never runs while a trellis_sync_log run is active (they would race the
//     same rows and share Trellis's rate limit);
//   - upserts idempotently (re-reading a window is harmless).
//
// Steps
//   reviews          read_reviews since max(review_date) − 14 d
//   review_backfill  15-day windows walking back to 365 d ago
//   assignees        fetch only `id, assignees` for completed Tendwell cleans
//                    with no assignee list (vendor-assigned cleans name the
//                    crew member only there), newest first
//   task_backfill    COMPLETED tasks in 7-day windows walking back:
//                    A all (A starts 2026-04-11), B Cleaning-department tasks
//                    by anyone (attribution needs "last clean by anyone") plus
//                    Tendwell vendor / roster tasks in other departments
//   inspections      attribute recent inspections that had no clean when
//                    they were logged (DB only)

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  callTrellisTool, queryWorkspace, upsert, taskRow, loadTendwellMemberIds, makeRunContext,
  makeServiceSupabase, dedupeById, SyncDeadlineError, TASK_SELECT, DEFAULT_RUN_BUDGET_MS,
  type TrellisRunContext,
} from './_sync-core.js'
import { reviewRow, classifyTrellisTask, TRELLIS_NIL_USER } from '../../shared/trellis-sync-rules.js'

export type AuxStep = 'reviews' | 'review_backfill' | 'assignees' | 'task_backfill' | 'inspections'
export const ALL_AUX_STEPS: AuxStep[] = ['reviews', 'assignees', 'review_backfill', 'task_backfill', 'inspections']

export interface AuxOptions {
  trigger: 'cron' | 'manual' | 'script'
  steps?: AuxStep[]
  /** Absolute epoch ms by which the run must stop. Default now + 250 s. */
  deadlineMs?: number
  supabase?: SupabaseClient
  /** Oldest scheduled_date the task backfill reaches, per workspace. */
  taskFloor?: { A?: string; B?: string }
  /** How far back the review backfill reaches, in days. */
  reviewDays?: number
  /** Assignee enrichment lookback in days (null = all history). */
  assigneeDays?: number | null
  log?: (msg: string) => void
}

export interface AuxResult {
  skipped?: string
  steps: Record<string, { status: string; counts?: Record<string, unknown>; state?: unknown; error?: string }>
  trellis_calls: number
  retries_429: number
  elapsed_s: number
}

export const TASK_BACKFILL_FLOOR = { A: '2026-04-01', B: '2025-06-01' }
export const REVIEW_BACKFILL_DAYS = 365
const REVIEW_OVERLAP_DAYS = 14
const REVIEW_WINDOW_DAYS = 15
const TASK_WINDOW_DAYS = 7
const TENDWELL_VENDOR = 'Tendwell Cleaning Co.'
/** B departments that are not Cleaning; Tendwell work there is pulled by assignee. */
const OTHER_B_DEPARTMENTS = ['Maintenance', 'Runner', 'Onboarding', 'Owner Relations', 'Front Office', 'Inspection', 'Quality Control', 'Laundry']

const day = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (iso: string, n: number) => day(new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000))
const nowIso = () => new Date().toISOString()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

async function startLog(db: Db, kind: string, trigger: string): Promise<string> {
  const { data, error } = await db.from('trellis_aux_sync_log').insert({ kind, trigger, status: 'running' }).select('id').single()
  if (error) throw new Error(`trellis_aux_sync_log insert: ${error.message}`)
  return (data as { id: string }).id
}

async function finishLog(db: Db, id: string, patch: Record<string, unknown>): Promise<void> {
  await db.from('trellis_aux_sync_log').update({ finished_at: nowIso(), ...patch }).eq('id', id)
}

/** Latest persisted state for a step (any row of that kind that has one). */
async function latestState<T>(db: Db, kind: string): Promise<T | null> {
  const { data } = await db.from('trellis_aux_sync_log').select('state')
    .eq('kind', kind).not('state', 'is', null).order('started_at', { ascending: false }).limit(1)
  return ((data ?? [])[0]?.state ?? null) as T | null
}

/** A trellis_sync_log run is in flight (started < 30 min ago). */
export async function mainSyncActive(db: Db): Promise<boolean> {
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString()
  const { data } = await db.from('trellis_sync_log').select('id, started_at, created_at').in('status', ['requested', 'running'])
  return ((data ?? []) as Array<{ started_at: string | null; created_at: string | null }>)
    .some(r => (r.started_at ?? r.created_at ?? '') >= cutoff)
}

/** Another aux run is in flight (started < 10 min ago, still running). */
async function auxRunActive(db: Db): Promise<boolean> {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data } = await db.from('trellis_aux_sync_log').select('id').eq('kind', 'run').eq('status', 'running').gte('started_at', cutoff).limit(1)
  return (data ?? []).length > 0
}

// ── Reviews ──────────────────────────────────────────────────────────────────

// 10 reviews with their reservation came back at ~10.4 KB; at 20 Trellis
// dropped the data entirely (data_partial, no `reviews`).
const REVIEW_PAGE = 8

/** Read every review matching `filters` and upsert it. Halves the page size
 *  when Trellis drops an over-budget page. */
async function pullReviews(db: Db, ctx: TrellisRunContext, filters: Record<string, string>): Promise<number> {
  let limit = REVIEW_PAGE
  let cursor: string | undefined
  let offset = 0
  let n = 0
  for (let guard = 0; guard < 1000; guard++) {
    const args: Record<string, unknown> = {
      filters, include: ['reservation'], sort_by: 'review_date', sort_order: 'DESC', limit,
      ...(cursor ? { cursor } : { offset }),
    }
    const r = await callTrellisTool('B', 'read_reviews', args, ctx) as {
      data?: { reviews?: unknown[]; has_more?: boolean; next_offset?: number; next_cursor?: string }
      pagination?: { has_more?: boolean; next_offset?: number; next_cursor?: string }
    }
    const reviews = r.data?.reviews
    if (!Array.isArray(reviews)) {
      if (limit > 1) { limit = Math.max(1, Math.floor(limit / 2)); cursor = undefined; continue }
      throw new Error('read_reviews returned no data even at page size 1')
    }
    const at = nowIso()
    const rows = reviews.map(x => reviewRow(x as Record<string, unknown>, 'B', at)).filter((x): x is Record<string, unknown> => !!x)
    await upsert(db, 'trellis_review_snapshot', rows, 'trellis_review_id')
    n += rows.length
    const hasMore = r.pagination?.has_more ?? r.data?.has_more ?? false
    if (!hasMore || reviews.length === 0) break
    const next = r.pagination?.next_cursor ?? r.data?.next_cursor
    const nextOff = r.pagination?.next_offset ?? r.data?.next_offset
    if (next) cursor = next
    else { cursor = undefined; offset = typeof nextOff === 'number' && nextOff > offset ? nextOff : offset + reviews.length }
  }
  return n
}

async function stepReviews(db: Db, ctx: TrellisRunContext): Promise<{ counts: Record<string, unknown> }> {
  const { data } = await db.from('trellis_review_snapshot').select('review_date').order('review_date', { ascending: false }).limit(1)
  const max = (data ?? [])[0]?.review_date as string | undefined
  if (!max) return { counts: { reviews: 0, note: 'table empty: review_backfill loads history first' } }
  const after = addDays(max.slice(0, 10), -REVIEW_OVERLAP_DAYS)
  const n = await pullReviews(db, ctx, { review_after: after })
  return { counts: { reviews: n, review_after: after } }
}

interface WindowState { before: string; floor: string; done: boolean }

/** Resume a walk-back state, or start one at `start`. A lower floor than the
 *  stored one reopens a finished walk. */
function resumeWindow(prev: WindowState | null | undefined, start: string, floor: string): WindowState {
  if (!prev) return { before: start, floor, done: start <= floor }
  if (floor < prev.floor) return { before: prev.done ? prev.floor : prev.before, floor, done: false }
  return prev
}

async function stepReviewBackfill(db: Db, ctx: TrellisRunContext, days: number, logId: string): Promise<{ counts: Record<string, unknown>; state: WindowState }> {
  const floor = addDays(day(new Date()), -days)
  let state = resumeWindow(await latestState<WindowState>(db, 'review_backfill'), addDays(day(new Date()), 1), floor)
  let n = 0
  let windows = 0
  while (!state.done) {
    const after = addDays(state.before, -REVIEW_WINDOW_DAYS)
    n += await pullReviews(db, ctx, { review_after: after, review_before: state.before })
    windows++
    state = { ...state, before: after, done: after <= state.floor }
    await db.from('trellis_aux_sync_log').update({ state, counts: { reviews: n, windows } }).eq('id', logId)
  }
  return { counts: { reviews: n, windows }, state }
}

// ── Assignee enrichment ──────────────────────────────────────────────────────

async function stepAssignees(db: Db, ctx: TrellisRunContext, tendwellIds: ReadonlySet<string>, sinceDays: number | null, logId: string): Promise<{ counts: Record<string, unknown> }> {
  let updated = 0
  let fetched = 0
  const PAGE = 150
  for (;;) {
    let q = db.from('trellis_task_snapshot').select('trellis_task_id, workspace, title, assigned_to_id, assigned_to_name')
      .eq('workspace', 'B').eq('status', 'COMPLETED').not('clean_kind', 'is', null).eq('is_tendwell', true).is('assignees', null)
      .order('scheduled_date', { ascending: false }).limit(PAGE)
    if (sinceDays != null) q = q.gte('scheduled_date', addDays(day(new Date()), -sinceDays))
    const { data, error } = await q
    if (error) throw new Error(`assignee candidates: ${error.message}`)
    const rows = (data ?? []) as Array<Record<string, unknown>>
    if (rows.length === 0) break
    for (let i = 0; i < rows.length; i += 30) {
      const chunk = rows.slice(i, i + 30)
      const ids = chunk.map(r => String(r.trellis_task_id))
      const got = await queryWorkspace('B', 'tasks', ['id', 'assignees'], { id: { in: ids } }, 50, ctx)
      fetched += got.length
      const byId = new Map(got.map(g => [String(g.id), g]))
      await Promise.all(chunk.map(async r => {
        const g = byId.get(String(r.trellis_task_id))
        // Not returned (gone from Trellis) or no list: store [] so it is not refetched forever.
        const assignees = Array.isArray(g?.assignees) ? g!.assignees : []
        const { is_tendwell } = classifyTrellisTask({ ...r, workspace: 'B', assignees }, tendwellIds)
        const { error: uErr } = await db.from('trellis_task_snapshot').update({ assignees, is_tendwell }).eq('trellis_task_id', r.trellis_task_id)
        if (!uErr) updated++
      }))
      await db.from('trellis_aux_sync_log').update({ counts: { updated, fetched } }).eq('id', logId)
    }
    if (rows.length < PAGE) break
  }
  return { counts: { updated, fetched } }
}

// ── Task history backfill ────────────────────────────────────────────────────

interface TaskBackfillState { A: WindowState; B: WindowState }

async function backfillWindow(
  db: Db, ctx: TrellisRunContext, ws: 'A' | 'B', from: string, to: string, tendwellIds: ReadonlySet<string>, rosterIds: string[],
): Promise<number> {
  const date = { scheduled_date: { gte: from, lte: to } }
  const buf: Array<Record<string, unknown>> = []
  try {
    if (ws === 'A') {
      await queryWorkspace('A', 'tasks', TASK_SELECT, { status: 'COMPLETED', ...date }, 100, ctx, buf)
    } else {
      await queryWorkspace('B', 'tasks', TASK_SELECT, { status: 'COMPLETED', department_name: 'Cleaning', ...date }, 50, ctx, buf)
      await queryWorkspace('B', 'tasks', TASK_SELECT,
        { status: 'COMPLETED', assigned_to_name: TENDWELL_VENDOR, department_name: OTHER_B_DEPARTMENTS, ...date }, 50, ctx, buf)
      for (let i = 0; i < rosterIds.length; i += 15) {
        await queryWorkspace('B', 'tasks', TASK_SELECT,
          { status: 'COMPLETED', assigned_to_id: { in: rosterIds.slice(i, i + 15) }, department_name: OTHER_B_DEPARTMENTS, ...date }, 50, ctx, buf)
      }
    }
  } finally {
    // Keep what arrived even if the deadline hits mid-window (completed rows
    // are never pruned); the window itself is redone next run.
    const rows = dedupeById(buf).map(t => taskRow(t, ws, tendwellIds))
    await upsert(db, 'trellis_task_snapshot', rows, 'trellis_task_id')
  }
  return dedupeById(buf).length
}

async function stepTaskBackfill(
  db: Db, ctx: TrellisRunContext, tendwellIds: ReadonlySet<string>, floors: { A: string; B: string }, logId: string,
): Promise<{ counts: Record<string, unknown>; state: TaskBackfillState }> {
  const prev = await latestState<TaskBackfillState>(db, 'task_backfill')
  // The nightly sync already keeps the last 30 days of completed B tasks.
  const start = addDays(day(new Date()), -28)
  let state: TaskBackfillState = {
    A: resumeWindow(prev?.A, start, floors.A),
    B: resumeWindow(prev?.B, start, floors.B),
  }
  const rosterIds = [...tendwellIds].filter(id => id !== TRELLIS_NIL_USER)
  const counts: Record<string, number> = { A: 0, B: 0, windows: 0 }
  for (const ws of ['B', 'A'] as const) {
    while (!state[ws].done) {
      const to = addDays(state[ws].before, -1)
      const from = addDays(state[ws].before, -TASK_WINDOW_DAYS)
      counts[ws] += await backfillWindow(db, ctx, ws, from, to, tendwellIds, rosterIds)
      counts.windows++
      state = { ...state, [ws]: { ...state[ws], before: from, done: from <= state[ws].floor } }
      await db.from('trellis_aux_sync_log').update({ state, counts }).eq('id', logId)
    }
  }
  return { counts, state }
}

// ── Inspection attribution (DB only) ─────────────────────────────────────────

async function stepInspections(db: Db): Promise<{ counts: Record<string, unknown> }> {
  const since = addDays(day(new Date()), -45)
  const { data, error } = await db.rpc('backfill_inspection_attribution', { p_since: since, p_limit: 500 })
  if (error) throw new Error(`backfill_inspection_attribution: ${error.message}`)
  return { counts: { since, ...(typeof data === 'object' && data ? data : { result: data }) } }
}

// ── Runner ───────────────────────────────────────────────────────────────────

export async function runAuxSync(opts: AuxOptions): Promise<AuxResult> {
  const t0 = Date.now()
  const db: Db = opts.supabase ?? makeServiceSupabase()
  const log = opts.log ?? (() => {})
  const ctx = makeRunContext(opts.deadlineMs ?? t0 + DEFAULT_RUN_BUDGET_MS)
  const steps = opts.steps ?? ALL_AUX_STEPS
  const result: AuxResult = { steps: {}, trellis_calls: 0, retries_429: 0, elapsed_s: 0 }
  const finish = () => {
    result.trellis_calls = ctx.calls
    result.retries_429 = ctx.retries429
    result.elapsed_s = Math.round((Date.now() - t0) / 100) / 10
    return result
  }

  if (await mainSyncActive(db)) { result.skipped = 'trellis_sync_log run in progress'; return finish() }
  if (await auxRunActive(db)) { result.skipped = 'another aux run in progress'; return finish() }
  const runId = await startLog(db, 'run', opts.trigger)

  let tendwellIds: Set<string> | null = null
  const ids = async () => (tendwellIds ??= await loadTendwellMemberIds(db))
  let stopped = false

  for (const step of steps) {
    if (stopped || Date.now() > ctx.deadlineMs - 5_000) { stopped = true; result.steps[step] = { status: 'skipped' }; continue }
    if (step !== 'inspections' && await mainSyncActive(db)) {
      stopped = true
      result.steps[step] = { status: 'skipped', error: 'trellis_sync_log run started' }
      continue
    }
    const logId = await startLog(db, step, opts.trigger)
    // Sub-deadline: review backfill and assignee enrichment may use at most
    // half of what is left, so one long history job never starves the next.
    const sub = (step === 'review_backfill' || step === 'assignees') && steps.length > 1
      ? makeRunContext(Math.min(ctx.deadlineMs, Date.now() + (ctx.deadlineMs - Date.now()) / 2))
      : ctx
    try {
      let out: { counts: Record<string, unknown>; state?: unknown }
      switch (step) {
        case 'reviews': out = await stepReviews(db, sub); break
        case 'review_backfill': out = await stepReviewBackfill(db, sub, opts.reviewDays ?? REVIEW_BACKFILL_DAYS, logId); break
        case 'assignees': out = await stepAssignees(db, sub, await ids(),
          opts.assigneeDays !== undefined ? opts.assigneeDays : opts.trigger === 'cron' ? 60 : null, logId); break
        case 'task_backfill': out = await stepTaskBackfill(db, sub, await ids(), {
          A: opts.taskFloor?.A ?? TASK_BACKFILL_FLOOR.A, B: opts.taskFloor?.B ?? TASK_BACKFILL_FLOOR.B,
        }, logId); break
        case 'inspections': out = await stepInspections(db); break
      }
      await finishLog(db, logId, { status: 'done', counts: out.counts, ...(out.state ? { state: out.state } : {}) })
      result.steps[step] = { status: 'done', counts: out.counts, state: out.state }
      log(`${step}: done ${JSON.stringify(out.counts)}`)
    } catch (e) {
      if (e instanceof SyncDeadlineError) {
        // State was persisted per window inside the step; it stays on the row.
        const { data } = await db.from('trellis_aux_sync_log').select('state, counts').eq('id', logId).single()
        await finishLog(db, logId, { status: 'partial', error: e.message })
        result.steps[step] = { status: 'partial', counts: data?.counts ?? undefined, state: data?.state ?? undefined }
        log(`${step}: partial (deadline) ${JSON.stringify(data?.counts ?? {})}`)
        if (sub === ctx) stopped = true
      } else {
        const msg = e instanceof Error ? e.message : String(e)
        await finishLog(db, logId, { status: 'error', error: msg.slice(0, 1000) })
        result.steps[step] = { status: 'error', error: msg }
        log(`${step}: error ${msg}`)
      }
    } finally {
      if (sub !== ctx) { ctx.calls += sub.calls; ctx.retries429 += sub.retries429; ctx.lastCallAt = sub.lastCallAt }
    }
  }

  finish()
  const statuses = Object.values(result.steps).map(s => s.status)
  await finishLog(db, runId, {
    status: statuses.includes('error') ? 'error' : statuses.some(s => s !== 'done') ? 'partial' : 'done',
    counts: {
      steps: Object.fromEntries(Object.entries(result.steps).map(([k, v]) => [k, v.status])),
      trellis_calls: result.trellis_calls, retries_429: result.retries_429, elapsed_s: result.elapsed_s,
    },
  })
  return result
}
