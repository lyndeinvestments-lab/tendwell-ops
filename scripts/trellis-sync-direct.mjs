// Deterministic Trellis -> Supabase sync. NO LLM.
//
// Talks to the Trellis MCP HTTP endpoint via JSON-RPC directly (the MCP server
// is just a stateless Bearer-auth proxy to api.trellistech.com) and bulk-upserts
// via supabase-js. This replaces the agentic `claude -p` wrapper, which took
// hours because it reasoned between every MCP call and upserted one page at a
// time. This runs in seconds.
//
// Tendwell-attribution + the date window match the trellis-sync skill:
//   - Workspace A (Tendwell's own Trellis): roster + properties + tasks.
//   - Workspace B (Haven's Trellis): properties + ONLY Tendwell-attributable
//     tasks, ALWAYS bounded to scheduled_date in [today-30d, today+90d].
//
// Env (required): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Env (optional): TRELLIS_ENDPOINT (default https://api.trellistech.com/v1/mcp-server)
// Trellis API keys are read from ~/.claude.json mcpServers
//   (trellis-workspace-a / trellis-workspace-b) — the single source of truth,
//   so secrets are not duplicated into cron/env.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/trellis-sync-direct.mjs [--nightly|--on-demand]

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENDPOINT = process.env.TRELLIS_ENDPOINT || 'https://api.trellistech.com/v1/mcp-server'
const TRIGGER = process.argv.includes('--nightly')
  ? 'nightly'
  : process.argv.includes('--on-demand') ? 'on-demand' : 'manual'

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

function trellisKeys() {
  const cfg = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'))
  const s = cfg.mcpServers || {}
  const A = s['trellis-workspace-a']?.env?.TRELLIS_API_KEY
  const B = s['trellis-workspace-b']?.env?.TRELLIS_API_KEY
  if (!A || !B) throw new Error('trellis-workspace-a/b TRELLIS_API_KEY not found in ~/.claude.json')
  return { A, B }
}

let rpcId = 0
async function callTool(apiKey, name, args) {
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

  let json
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  if (ct.includes('text/event-stream')) {
    let last = null
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
      if (data) last = data
    }
    json = JSON.parse(last)
  } else {
    json = JSON.parse(text)
  }
  if (json.error) throw new Error(`Trellis ${name} error: ${json.error.message}`)

  // Unwrap MCP tools/call result: prefer structuredContent, else parse the
  // text content part (Trellis returns its JSON payload as a text part).
  const result = json.result
  if (result && result.structuredContent) return result.structuredContent
  if (result && Array.isArray(result.content)) {
    const part = result.content.find(c => c.type === 'text')
    if (part) return JSON.parse(part.text)
  }
  return result
}

async function queryAll(apiKey, view, select, filters, pageSize) {
  const out = []
  let offset = 0
  for (;;) {
    const args = { view, select, limit: pageSize, offset }
    if (filters) args.filters = filters
    const r = await callTool(apiKey, 'trellisql_query', args)
    const rows = r.rows || []
    out.push(...rows)
    if (!r.pagination?.has_more || rows.length === 0) break
    offset += pageSize
  }
  return out
}

async function upsert(table, rows, onConflict) {
  const BATCH = 100
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + BATCH), { onConflict })
    if (error) throw new Error(`upsert ${table}: ${error.message}`)
  }
}

const TASK_SELECT = ['id', 'title', 'property_id', 'property_name', 'department_name', 'status', 'priority', 'assigned_to_id', 'assigned_to_name', 'scheduled_date', 'completed_at']
const PROP_SELECT = ['id', 'name', 'status', 'city']

const now = () => new Date().toISOString()
const isoOffset = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

const propRow = (p, ws) => ({ trellis_id: p.id, workspace: ws, name: p.name ?? '(unnamed)', status: p.status ?? null, city: p.city ?? null, synced_at: now() })
const taskRow = (t, ws) => ({ trellis_task_id: t.id, workspace: ws, trellis_property_id: t.property_id ?? null, property_name: t.property_name ?? null, title: t.title ?? null, department_name: t.department_name ?? null, status: t.status ?? null, priority: t.priority ?? null, assigned_to_id: t.assigned_to_id ?? null, assigned_to_name: t.assigned_to_name ?? null, scheduled_date: t.scheduled_date ?? null, completed_at: t.completed_at ?? null, synced_at: now() })

function dedupeById(arr) {
  const m = new Map()
  for (const x of arr) if (x.id) m.set(x.id, x)
  return [...m.values()]
}

async function main() {
  const t0 = Date.now()
  const runStartIso = new Date(t0).toISOString()
  const { A, B } = trellisKeys()
  const windowStart = isoOffset(-30)
  const windowEnd = isoOffset(90)
  const dateFilter = { scheduled_date: { gte: windowStart, lte: windowEnd } }

  // Claim a pending on-demand row if present, else open a new run.
  let logId
  const { data: req } = await supabase.from('trellis_sync_log').select('id').eq('status', 'requested').order('created_at').limit(1)
  if (req && req.length) {
    logId = req[0].id
    await supabase.from('trellis_sync_log').update({ status: 'running', started_at: now() }).eq('id', logId)
  } else {
    const { data: ins, error } = await supabase.from('trellis_sync_log')
      .insert({ status: 'running', trigger: TRIGGER, requested_by: 'direct-script', started_at: now() })
      .select('id').single()
    if (error) throw new Error(`sync_log insert: ${error.message}`)
    logId = ins.id
  }

  try {
    // --- Workspace A ---
    const wf = await callTool(A, 'read_workforce', { limit: 100 })
    const members = wf.data?.members || wf.members || []
    const rosterMap = new Map()
    for (const m of members) {
      if (!m.user_id) continue
      rosterMap.set(m.user_id, { user_id: m.user_id, member_id: m.member_id ?? null, workspace: 'A', name: m.name ?? null, email: m.email ?? null, role: m.role ?? null, departments: m.departments ?? [], is_active: m.is_active ?? true, synced_at: now() })
    }
    await upsert('trellis_roster', [...rosterMap.values()], 'user_id')

    const propsA = await queryAll(A, 'properties', PROP_SELECT, null, 100)
    await upsert('trellis_property_snapshot', propsA.map(p => propRow(p, 'A')), 'trellis_id')

    const tasksA = dedupeById(await queryAll(A, 'tasks', TASK_SELECT, dateFilter, 100))
    await upsert('trellis_task_snapshot', tasksA.map(t => taskRow(t, 'A')), 'trellis_task_id')

    // --- Workspace B (Tendwell-attributable, date-bounded) ---
    const propsB = await queryAll(B, 'properties', PROP_SELECT, null, 50)
    await upsert('trellis_property_snapshot', propsB.map(p => propRow(p, 'B')), 'trellis_id')

    const bTasks = new Map()
    for (const t of await queryAll(B, 'tasks', TASK_SELECT, { assigned_to_name: 'Tendwell Cleaning Co.', ...dateFilter }, 50)) {
      if (t.id) bTasks.set(t.id, t)
    }
    for (const uid of rosterMap.keys()) {
      for (const t of await queryAll(B, 'tasks', TASK_SELECT, { assigned_to_id: uid, ...dateFilter }, 50)) {
        if (t.id) bTasks.set(t.id, t)
      }
    }
    await upsert('trellis_task_snapshot', [...bTasks.values()].map(t => taskRow(t, 'B')), 'trellis_task_id')

    // Prune stale workspace-B tasks: any row not refreshed by this run (now
    // outside the date window, reassigned away from Tendwell, or deleted in
    // Trellis). Only runs after all B upserts succeed, so a partial pull never
    // deletes good data.
    await supabase.from('trellis_task_snapshot').delete().eq('workspace', 'B').lt('synced_at', runStartIso)

    const counts = { roster: rosterMap.size, props_a: propsA.length, props_b: propsB.length, tasks_a: tasksA.length, tasks_b: bTasks.size, window: [windowStart, windowEnd] }
    await supabase.from('trellis_sync_log').update({ status: 'done', finished_at: now(), counts }).eq('id', logId)
    console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(counts))
  } catch (err) {
    await supabase.from('trellis_sync_log').update({ status: 'error', finished_at: now(), error: String(err?.message || err) }).eq('id', logId)
    console.error('SYNC FAILED:', err?.message || err)
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
