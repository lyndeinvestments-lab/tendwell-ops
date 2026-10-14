// One-off (re-runnable) backfill of trellis_task_snapshot.clean_kind /
// is_tendwell / task_category for rows written before the sync computed them
// (migration 20261014a). Uses the exact TS the sync uses
// (shared/trellis-sync-rules.ts → classifyAuxTask / isTendwellTask), so the
// stored columns match what a fresh upsert would write.
//
//   npx tsx scripts/backfill-trellis-task-classification.ts [--dry-run]
//
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment or
// .env.local. Only derived columns are written; it is idempotent and only
// touches rows whose values change. (Not a verify script: it writes derived
// columns on purpose against the real database, like the sync does.)

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { classifyTrellisTask } from '../shared/trellis-sync-rules.js'

for (const f of ['.env.local', '../../../.env.local']) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

const dryRun = process.argv.includes('--dry-run')
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
const db = createClient(url, key, { auth: { persistSession: false } })

type Row = {
  trellis_task_id: string; workspace: 'A' | 'B'; title: string | null; assigned_to_id: string | null
  assigned_to_name: string | null; assignees: unknown; clean_kind: string | null; is_tendwell: boolean | null; task_category: string | null
}

async function main() {
  const { data: roster, error: rErr } = await db.from('trellis_roster').select('user_id').eq('workspace', 'A')
  if (rErr) throw rErr
  const ids = new Set((roster ?? []).map(r => r.user_id as string))

  const groups = new Map<string, string[]>()
  let scanned = 0
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('trellis_task_snapshot')
      .select('trellis_task_id, workspace, title, assigned_to_id, assigned_to_name, assignees, clean_kind, is_tendwell, task_category')
      .order('trellis_task_id').range(from, from + 999)
    if (error) throw error
    const rows = (data ?? []) as Row[]
    for (const r of rows) {
      const c = classifyTrellisTask(r, ids)
      if (c.clean_kind === r.clean_kind && c.is_tendwell === r.is_tendwell && c.task_category === r.task_category) continue
      const k = JSON.stringify(c)
      groups.set(k, [...(groups.get(k) ?? []), r.trellis_task_id])
    }
    scanned += rows.length
    if (rows.length < 1000) break
  }

  let changed = 0
  for (const [k, taskIds] of groups) {
    changed += taskIds.length
    if (dryRun) continue
    for (let i = 0; i < taskIds.length; i += 200) {
      const { error } = await db.from('trellis_task_snapshot').update(JSON.parse(k)).in('trellis_task_id', taskIds.slice(i, i + 200))
      if (error) throw error
    }
  }
  const summary = [...groups].map(([k, v]) => `${v.length.toString().padStart(6)}  ${k}`).sort().reverse().join('\n')
  console.log(`scanned ${scanned}, ${dryRun ? 'would change' : 'changed'} ${changed}\n${summary}`)
}

main().catch(e => { console.error(e); process.exit(1) })
