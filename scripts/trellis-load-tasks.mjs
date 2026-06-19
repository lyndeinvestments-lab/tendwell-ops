// Deterministic loader: read a JSONL file of Trellis workspace-B cleaning tasks
// (one JSON object per line, as dumped from the Trellis MCP) and upsert them
// into Supabase `trellis_task_snapshot` (workspace 'B'). This is the reliable,
// non-agentic write path — pair it with an MCP dump of the tasks.
//
// Why this exists: the agentic sync (the trellis-sync skill) can struggle to
// page-and-upsert hundreds of rows in one shot. Splitting fetch (MCP → file)
// from write (this script) makes the write bulletproof and resumable.
//
// Usage:
//   SUPABASE_URL='https://<ref>.supabase.co' \
//   SUPABASE_SERVICE_ROLE_KEY='<service-role-key>' \
//   node scripts/trellis-load-tasks.mjs /tmp/trellis-b-tasks.jsonl
//
// Each JSONL line may use either the raw Trellis field names or the snapshot
// column names; both are accepted:
//   id|trellis_task_id, property_id|trellis_property_id, property_name, title,
//   department_name, status, priority, assigned_to_id, assigned_to_name,
//   scheduled_date, completed_at
// Idempotent: re-running upserts by primary key.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const file = process.argv[2] || '/tmp/trellis-b-tasks.jsonl'

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

function pick(o, ...names) {
  for (const n of names) if (o[n] !== undefined) return o[n]
  return null
}

function toRow(o) {
  const id = pick(o, 'trellis_task_id', 'id')
  if (!id) return null
  return {
    trellis_task_id: id,
    workspace: 'B',
    trellis_property_id: pick(o, 'trellis_property_id', 'property_id'),
    property_name: pick(o, 'property_name'),
    title: pick(o, 'title'),
    department_name: pick(o, 'department_name'),
    status: pick(o, 'status'),
    priority: pick(o, 'priority'),
    assigned_to_id: pick(o, 'assigned_to_id'),
    assigned_to_name: pick(o, 'assigned_to_name'),
    scheduled_date: pick(o, 'scheduled_date'),
    completed_at: pick(o, 'completed_at'),
    synced_at: new Date().toISOString(),
  }
}

const lines = readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
const rows = []
let bad = 0
for (const line of lines) {
  try {
    const r = toRow(JSON.parse(line))
    if (r) rows.push(r); else bad++
  } catch {
    bad++
  }
}
console.log(`Parsed ${rows.length} task rows from ${file}${bad ? ` (${bad} skipped)` : ''}.`)

const BATCH = 100
let written = 0
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH)
  const { error } = await supabase
    .from('trellis_task_snapshot')
    .upsert(batch, { onConflict: 'trellis_task_id' })
  if (error) {
    console.error(`Batch ${i / BATCH + 1} failed:`, error.message)
    process.exit(1)
  }
  written += batch.length
  console.log(`Upserted ${written}/${rows.length}`)
}
console.log(`Done. ${written} workspace-B tasks upserted into trellis_task_snapshot.`)
