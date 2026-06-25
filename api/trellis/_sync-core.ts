// Shared Trellis → Supabase sync logic.
// Called by both the cron endpoint and the on-demand sync-now endpoint.
// The onProgress callback fires at each phase/chunk and should UPDATE the
// trellis_sync_log row's `progress` column. It is a best-effort fire-and-forget;
// errors in the callback do not abort the sync.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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
}

export interface SyncOptions {
  trigger: 'nightly' | 'manual' | 'on-demand'
  /** Existing log row id to claim. If omitted a new row is inserted. */
  logId?: string
  requestedBy?: string
  onProgress?: ProgressCallback
}

// ── MCP / Trellis keys ───────────────────────────────────────────────────────

function trellisKeys(): { A: string; B: string } {
  const cfg = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'))
  const s = cfg.mcpServers || {}
  const A = s['trellis-workspace-a']?.env?.TRELLIS_API_KEY
  const B = s['trellis-workspace-b']?.env?.TRELLIS_API_KEY
  if (!A || !B) throw new Error('trellis-workspace-a/b TRELLIS_API_KEY not found in ~/.claude.json')
  return { A, B }
}

// ── JSON-RPC MCP call ────────────────────────────────────────────────────────

const ENDPOINT = process.env.TRELLIS_ENDPOINT || 'https://api.trellistech.com/v1/mcp-server'
let rpcId = 0

async function callTool(apiKey: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const body = { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
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
  if (result?.structuredContent) return result.structuredContent
  if (result && Array.isArray(result.content)) {
    const part = result.content.find(c => c.type === 'text')
    if (part) return JSON.parse(part.text)
  }
  return result
}

// ── Paginated query ──────────────────────────────────────────────────────────

async function queryAll(
  apiKey: string,
  view: string,
  select: string[],
  filters: Record<string, unknown> | null,
  pageSize: number,
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = []
  let offset = 0
  for (;;) {
    const args: Record<string, unknown> = { view, select, limit: pageSize, offset }
    if (filters) args.filters = filters
    const r = await callTool(apiKey, 'trellisql_query', args) as { rows?: Array<Record<string, unknown>>; pagination?: { has_more: boolean } }
    const rows = r.rows || []
    out.push(...rows)
    if (!r.pagination?.has_more || rows.length === 0) break
    offset += pageSize
  }
  return out
}

// ── Supabase batch upsert ────────────────────────────────────────────────────

async function upsert(
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

const TASK_SELECT = ['id', 'title', 'property_id', 'property_name', 'department_name', 'status', 'priority', 'assigned_to_id', 'assigned_to_name', 'scheduled_date', 'completed_at']
const PROP_SELECT = ['id', 'name', 'status', 'city']

const now = () => new Date().toISOString()
const isoOffset = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

const propRow = (p: Record<string, unknown>, ws: string) => ({
  trellis_id: p.id, workspace: ws, name: p.name ?? '(unnamed)', status: p.status ?? null, city: p.city ?? null, synced_at: now(),
})
const taskRow = (t: Record<string, unknown>, ws: string) => ({
  trellis_task_id: t.id, workspace: ws, trellis_property_id: t.property_id ?? null,
  property_name: t.property_name ?? null, title: t.title ?? null,
  department_name: t.department_name ?? null, status: t.status ?? null, priority: t.priority ?? null,
  assigned_to_id: t.assigned_to_id ?? null, assigned_to_name: t.assigned_to_name ?? null,
  scheduled_date: t.scheduled_date ?? null, completed_at: t.completed_at ?? null, synced_at: now(),
})

function dedupeById(arr: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const m = new Map<unknown, Record<string, unknown>>()
  for (const x of arr) if (x.id) m.set(x.id, x)
  return [...m.values()]
}

// ── ETA helper ───────────────────────────────────────────────────────────────
// Best-effort heuristic: elapsed / pct projects remaining seconds.
// Returns 0 when pct is too small to be meaningful.
function estimateEta(t0: number, pct: number): number {
  if (pct < 2) return 0
  const elapsed = (Date.now() - t0) / 1000
  return Math.round(elapsed / (pct / 100) - elapsed)
}

// ── Main sync ────────────────────────────────────────────────────────────────

export async function runSync(opts: SyncOptions): Promise<SyncCounts> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase config missing')

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { A, B } = trellisKeys()
  const t0 = Date.now()
  const runStartIso = new Date(t0).toISOString()
  const windowStart = isoOffset(-30)
  const windowEnd = isoOffset(90)
  const dateFilter = { scheduled_date: { gte: windowStart, lte: windowEnd } }

  // Phase tracking
  // Estimated total "work units": roster(1) + propsA + tasksA + propsB + tasksB(estimated)
  // We don't know exact counts upfront; use rough estimates that update as we go.
  let processed = 0
  // rough estimate: 10 roster + 80 propsA + 200 tasksA + 60 propsB + 400 tasksB = 750
  let estimatedTotal = 750

  const emit = async (phase: string, current: number, total: number, message: string) => {
    if (!opts.onProgress) return
    const pct = total > 0 ? Math.min(99, Math.round((current / total) * 100)) : 0
    const eta_seconds = estimateEta(t0, pct)
    try {
      await opts.onProgress({ phase, current, total, pct, eta_seconds, message })
    } catch { /* fire-and-forget */ }
  }

  // ── Workspace A: Roster ──────────────────────────────────────────────────
  await emit('roster', 0, estimatedTotal, 'Loading Workspace A roster…')
  const wf = await callTool(A, 'read_workforce', { limit: 100 }) as { data?: { members?: Array<Record<string, unknown>> }; members?: Array<Record<string, unknown>> }
  const members = wf.data?.members || wf.members || []
  const rosterMap = new Map<unknown, Record<string, unknown>>()
  for (const m of members) {
    if (!m.user_id) continue
    rosterMap.set(m.user_id, {
      user_id: m.user_id, member_id: m.member_id ?? null, workspace: 'A',
      name: m.name ?? null, email: m.email ?? null, role: m.role ?? null,
      departments: m.departments ?? [], is_active: m.is_active ?? true, synced_at: now(),
    })
  }
  await upsert(supabase, 'trellis_roster', [...rosterMap.values()], 'user_id')
  processed += rosterMap.size
  estimatedTotal = Math.max(estimatedTotal, processed + 730)
  await emit('roster', processed, estimatedTotal, `Roster loaded (${rosterMap.size} members)`)

  // ── Workspace A: Properties ──────────────────────────────────────────────
  await emit('props_a', processed, estimatedTotal, 'Pulling Workspace A properties…')
  const propsA = await queryAll(A, 'properties', PROP_SELECT, null, 100)
  await upsert(supabase, 'trellis_property_snapshot', propsA.map(p => propRow(p, 'A')), 'trellis_id')
  processed += propsA.length
  estimatedTotal = Math.max(estimatedTotal, processed + 650)
  await emit('props_a', processed, estimatedTotal, `Workspace A properties done (${propsA.length})`)

  // ── Workspace A: Tasks ───────────────────────────────────────────────────
  await emit('tasks_a', processed, estimatedTotal, 'Pulling Workspace A tasks…')
  const tasksA = dedupeById(await queryAll(A, 'tasks', TASK_SELECT, dateFilter, 100))
  await upsert(supabase, 'trellis_task_snapshot', tasksA.map(t => taskRow(t, 'A')), 'trellis_task_id')
  processed += tasksA.length
  estimatedTotal = Math.max(estimatedTotal, processed + 460)
  await emit('tasks_a', processed, estimatedTotal, `Workspace A tasks done (${tasksA.length})`)

  // ── Workspace B: Properties ──────────────────────────────────────────────
  await emit('props_b', processed, estimatedTotal, 'Pulling Workspace B properties…')
  const propsB = await queryAll(B, 'properties', PROP_SELECT, null, 50)
  await upsert(supabase, 'trellis_property_snapshot', propsB.map(p => propRow(p, 'B')), 'trellis_id')
  processed += propsB.length
  estimatedTotal = Math.max(estimatedTotal, processed + 400)
  await emit('props_b', processed, estimatedTotal, `Workspace B properties done (${propsB.length})`)

  // ── Workspace B: Tasks ───────────────────────────────────────────────────
  await emit('tasks_b', processed, estimatedTotal, 'Pulling Workspace B tasks…')
  const bTasks = new Map<unknown, Record<string, unknown>>()
  // Tendwell Cleaning Co. assignment
  for (const t of await queryAll(B, 'tasks', TASK_SELECT, { assigned_to_name: 'Tendwell Cleaning Co.', ...dateFilter }, 50)) {
    if (t.id) bTasks.set(t.id, t)
  }
  // Per-roster-member tasks
  let membersDone = 0
  for (const uid of rosterMap.keys()) {
    for (const t of await queryAll(B, 'tasks', TASK_SELECT, { assigned_to_id: uid, ...dateFilter }, 50)) {
      if (t.id) bTasks.set(t.id, t)
    }
    membersDone++
    processed = processed + (bTasks.size / Math.max(membersDone, 1))
    await emit('tasks_b', Math.round(processed), estimatedTotal,
      `Pulling Workspace B tasks… (member ${membersDone}/${rosterMap.size})`)
  }
  await upsert(supabase, 'trellis_task_snapshot', [...bTasks.values()].map(t => taskRow(t, 'B')), 'trellis_task_id')
  processed = Math.round(processed)
  estimatedTotal = processed + 10
  await emit('tasks_b', processed, estimatedTotal, `Workspace B tasks done (${bTasks.size})`)

  // ── Prune stale B tasks ──────────────────────────────────────────────────
  await emit('pruning', processed, estimatedTotal, 'Pruning stale Workspace B tasks…')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('trellis_task_snapshot').delete().eq('workspace', 'B').lt('synced_at', runStartIso)

  const counts: SyncCounts = {
    roster: rosterMap.size,
    props_a: propsA.length,
    props_b: propsB.length,
    tasks_a: tasksA.length,
    tasks_b: bTasks.size,
    window: [windowStart, windowEnd],
  }
  await emit('done', estimatedTotal, estimatedTotal, `Sync complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  return counts
}

// ── Convenience: build a supabase service-role client ───────────────────────
export function makeServiceSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase config missing')
  return createClient(url, key, { auth: { persistSession: false } })
}
