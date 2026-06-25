import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// GET /api/cron/trellis-sync
//
// Vercel Cron entrypoint that replicates the logic in
// scripts/trellis-sync-direct.mjs — Trellis → Supabase snapshot sync — but
// runs server-side in Vercel (no Mac, no Claude dependency).
//
// Talks to the Trellis MCP HTTP endpoint via JSON-RPC over plain HTTPS.
// Two workspace keys are required in env:
//   TRELLIS_WORKSPACE_A_KEY  — Tendwell's own Trellis workspace
//   TRELLIS_WORKSPACE_B_KEY  — Haven's Trellis workspace
//
// Auth: Vercel Cron sets `Authorization: Bearer ${CRON_SECRET}`. We also
// accept `x-cron-secret` header for manual / CI triggers.
//
// IMPORTANT — Vercel plan caveat:
//   A proven nightly run takes ~165 s. This function is configured with
//   maxDuration: 300 (5 min) to give headroom. Vercel Hobby plan hard-caps
//   serverless functions at 60 s, so this cron REQUIRES a Vercel Pro (or
//   higher) plan. On Hobby the function will be killed mid-run without error
//   output; upgrade the plan before enabling.

// ─── Env / config ──────────────────────────────────────────────────────────

const ENDPOINT =
  process.env.TRELLIS_ENDPOINT ?? 'https://api.trellistech.com/v1/mcp-server'

const TASK_SELECT = [
  'id',
  'title',
  'property_id',
  'property_name',
  'department_name',
  'status',
  'priority',
  'assigned_to_id',
  'assigned_to_name',
  'scheduled_date',
  'completed_at',
] as const

const PROP_SELECT = ['id', 'name', 'status', 'city'] as const

// ─── Trellis JSON-RPC helpers ────────────────────────────────────────────────

let rpcId = 0

async function callTool(
  apiKey: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const body = {
    jsonrpc: '2.0',
    id: ++rpcId,
    method: 'tools/call',
    params: { name, arguments: args },
  }
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
  if (!res.ok) {
    throw new Error(`Trellis ${name} HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  const ct = (res.headers.get('content-type') ?? '').toLowerCase()
  let json: any
  if (ct.includes('text/event-stream')) {
    // Parse SSE: find the last non-empty data line
    let last: string | null = null
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter(l => l.startsWith('data:'))
        .map(l => l.slice(5).trim())
        .join('\n')
      if (data) last = data
    }
    if (last === null) throw new Error(`Trellis ${name}: empty SSE response`)
    json = JSON.parse(last)
  } else {
    json = JSON.parse(text)
  }

  if (json.error) {
    throw new Error(`Trellis ${name} error: ${json.error.message}`)
  }

  // Unwrap MCP tools/call result: prefer structuredContent, else parse the
  // text content part (Trellis returns its JSON payload as a text part).
  const result = json.result
  if (result?.structuredContent) return result.structuredContent
  if (Array.isArray(result?.content)) {
    const part = result.content.find((c: any) => c.type === 'text')
    if (part) return JSON.parse(part.text)
  }
  return result
}

async function queryAll(
  apiKey: string,
  view: string,
  select: readonly string[],
  filters: Record<string, unknown> | null,
  pageSize: number,
): Promise<any[]> {
  const out: any[] = []
  let offset = 0
  for (;;) {
    const args: Record<string, unknown> = { view, select, limit: pageSize, offset }
    if (filters) args.filters = filters
    const r = (await callTool(apiKey, 'trellisql_query', args)) as any
    const rows: any[] = r.rows ?? []
    out.push(...rows)
    if (!r.pagination?.has_more || rows.length === 0) break
    offset += pageSize
  }
  return out
}

// ─── Row mappers ─────────────────────────────────────────────────────────────

const now = () => new Date().toISOString()

const isoOffset = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

function propRow(p: any, ws: 'A' | 'B') {
  return {
    trellis_id: p.id,
    workspace: ws,
    name: p.name ?? '(unnamed)',
    status: p.status ?? null,
    city: p.city ?? null,
    synced_at: now(),
  }
}

function taskRow(t: any, ws: 'A' | 'B') {
  return {
    trellis_task_id: t.id,
    workspace: ws,
    trellis_property_id: t.property_id ?? null,
    property_name: t.property_name ?? null,
    title: t.title ?? null,
    department_name: t.department_name ?? null,
    status: t.status ?? null,
    priority: t.priority ?? null,
    assigned_to_id: t.assigned_to_id ?? null,
    assigned_to_name: t.assigned_to_name ?? null,
    scheduled_date: t.scheduled_date ?? null,
    completed_at: t.completed_at ?? null,
    synced_at: now(),
  }
}

function dedupeById(arr: any[]): any[] {
  const m = new Map<string, any>()
  for (const x of arr) if (x.id) m.set(x.id, x)
  return [...m.values()]
}

// ─── Supabase upsert helper ───────────────────────────────────────────────────

async function upsert(
  supabase: ReturnType<typeof createClient>,
  table: string,
  rows: any[],
  onConflict: string,
): Promise<void> {
  const BATCH = 100
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase
      .from(table)
      .upsert(rows.slice(i, i + BATCH), { onConflict })
    if (error) throw new Error(`upsert ${table}: ${error.message}`)
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // ── Auth guard (match existing cron pattern) ──────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('CRON_SECRET not configured; refusing to run')
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }
  const authHeader = req.headers.authorization ?? ''
  const xCronSecret = (req.headers['x-cron-secret'] as string | undefined) ?? ''
  const authorized =
    authHeader === `Bearer ${cronSecret}` || xCronSecret === cronSecret
  if (!authorized) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  // ── Env validation ────────────────────────────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const keyA = process.env.TRELLIS_WORKSPACE_A_KEY
  const keyB = process.env.TRELLIS_WORKSPACE_B_KEY

  if (!supabaseUrl || !supabaseKey) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return
  }
  if (!keyA || !keyB) {
    res.status(503).json({
      error: 'Trellis workspace keys not configured',
      missing: [...(!keyA ? ['TRELLIS_WORKSPACE_A_KEY'] : []), ...(!keyB ? ['TRELLIS_WORKSPACE_B_KEY'] : [])],
    })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  })

  const t0 = Date.now()
  const runStartIso = new Date(t0).toISOString()

  // ── Claim or open a sync_log row ──────────────────────────────────────────
  let logId: number | string | null = null
  try {
    const { data: req_ } = await supabase
      .from('trellis_sync_log')
      .select('id')
      .eq('status', 'requested')
      .order('created_at')
      .limit(1)

    if (req_ && req_.length > 0) {
      logId = req_[0].id
      await supabase
        .from('trellis_sync_log')
        .update({ status: 'running', started_at: now() })
        .eq('id', logId)
    } else {
      const { data: ins, error: insErr } = await supabase
        .from('trellis_sync_log')
        .insert({
          status: 'running',
          trigger: 'nightly',
          requested_by: 'vercel-cron',
          started_at: now(),
        })
        .select('id')
        .single()
      if (insErr) throw new Error(`sync_log insert: ${insErr.message}`)
      logId = ins!.id
    }
  } catch (err: any) {
    console.error('trellis-sync: sync_log init failed:', err.message)
    res.status(500).json({ error: `sync_log init: ${err.message}` })
    return
  }

  // ── Sync work ─────────────────────────────────────────────────────────────
  try {
    const windowStart = isoOffset(-30)
    const windowEnd = isoOffset(90)
    const dateFilter = { scheduled_date: { gte: windowStart, lte: windowEnd } }

    // --- Workspace A: roster + properties + tasks ----------------------------
    const wf = (await callTool(keyA, 'read_workforce', { limit: 100 })) as any
    const members: any[] = wf.data?.members ?? wf.members ?? []

    const rosterMap = new Map<string, any>()
    for (const m of members) {
      if (!m.user_id) continue
      rosterMap.set(m.user_id, {
        user_id: m.user_id,
        member_id: m.member_id ?? null,
        workspace: 'A',
        name: m.name ?? null,
        email: m.email ?? null,
        role: m.role ?? null,
        departments: m.departments ?? [],
        is_active: m.is_active ?? true,
        synced_at: now(),
      })
    }
    await upsert(supabase, 'trellis_roster', [...rosterMap.values()], 'user_id')

    const propsA = await queryAll(keyA, 'properties', PROP_SELECT, null, 100)
    await upsert(
      supabase,
      'trellis_property_snapshot',
      propsA.map(p => propRow(p, 'A')),
      'trellis_id',
    )

    const tasksA = dedupeById(
      await queryAll(keyA, 'tasks', TASK_SELECT, dateFilter, 100),
    )
    await upsert(
      supabase,
      'trellis_task_snapshot',
      tasksA.map(t => taskRow(t, 'A')),
      'trellis_task_id',
    )

    // --- Workspace B: properties + Tendwell-attributable tasks ---------------
    const propsB = await queryAll(keyB, 'properties', PROP_SELECT, null, 50)
    await upsert(
      supabase,
      'trellis_property_snapshot',
      propsB.map(p => propRow(p, 'B')),
      'trellis_id',
    )

    // Collect B tasks by company name + by each Tendwell roster member
    const bTasks = new Map<string, any>()
    for (const t of await queryAll(
      keyB,
      'tasks',
      TASK_SELECT,
      { assigned_to_name: 'Tendwell Cleaning Co.', ...dateFilter },
      50,
    )) {
      if (t.id) bTasks.set(t.id, t)
    }
    for (const uid of rosterMap.keys()) {
      for (const t of await queryAll(
        keyB,
        'tasks',
        TASK_SELECT,
        { assigned_to_id: uid, ...dateFilter },
        50,
      )) {
        if (t.id) bTasks.set(t.id, t)
      }
    }
    await upsert(
      supabase,
      'trellis_task_snapshot',
      [...bTasks.values()].map(t => taskRow(t, 'B')),
      'trellis_task_id',
    )

    // Prune stale workspace-B rows (outside the date window, reassigned away
    // from Tendwell, or deleted in Trellis). Only runs after all B upserts
    // succeed so a partial pull never deletes good data.
    await supabase
      .from('trellis_task_snapshot')
      .delete()
      .eq('workspace', 'B')
      .lt('synced_at', runStartIso)

    // ── Finalize ────────────────────────────────────────────────────────────
    const counts = {
      roster: rosterMap.size,
      props_a: propsA.length,
      props_b: propsB.length,
      tasks_a: tasksA.length,
      tasks_b: bTasks.size,
      window: [windowStart, windowEnd],
    }
    await supabase
      .from('trellis_sync_log')
      .update({ status: 'done', finished_at: now(), counts })
      .eq('id', logId)

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`trellis-sync: done in ${elapsed}s`, JSON.stringify(counts))
    res.status(200).json({ ok: true, elapsed_s: parseFloat(elapsed), counts })
  } catch (err: any) {
    console.error('trellis-sync: FAILED:', err.message ?? err)
    await supabase
      .from('trellis_sync_log')
      .update({
        status: 'error',
        finished_at: now(),
        error: String(err?.message ?? err),
      })
      .eq('id', logId)
    res.status(500).json({ error: err.message ?? 'Sync failed' })
  }
}

// maxDuration: 300 seconds (5 min). A proven run takes ~165 s.
// NOTE: Vercel Hobby plan caps functions at 60 s — this REQUIRES Vercel Pro.
// See PR body for details.
export const config = { runtime: 'nodejs', maxDuration: 300 }
