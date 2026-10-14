// Run the Trellis auxiliary jobs (reviews, assignee enrichment, review / task
// history backfill, inspection attribution) locally, without the 300 s
// serverless limit. Same code as /api/cron/trellis-aux-sync and
// POST /api/trellis/backfill (api/trellis/_aux-core.ts); progress is saved in
// trellis_aux_sync_log, so it can be stopped and resumed at any time.
//
//   npx tsx scripts/trellis-aux-backfill.ts [--steps reviews,review_backfill,assignees,task_backfill,inspections]
//                                           [--budget 900] [--loops 1] [--assignee-days N|all]
//
// Env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or .env.local); Trellis keys
// from TRELLIS_WORKSPACE_A_KEY / _B_KEY or the local ~/.claude.json fallback.
// Writes the same snapshot tables the crons write (by design: it IS the sync).

import { readFileSync, existsSync } from 'node:fs'

for (const f of ['.env.local', '../../../.env.local']) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const { runAuxSync, ALL_AUX_STEPS } = await import('../api/trellis/_aux-core.js')
  const steps = (arg('steps')?.split(',').filter(Boolean) ?? ALL_AUX_STEPS) as typeof ALL_AUX_STEPS
  const budget = Number(arg('budget') ?? 900)
  const loops = Number(arg('loops') ?? 1)
  const ad = arg('assignee-days')
  for (let i = 0; i < loops; i++) {
    const t0 = Date.now()
    const result = await runAuxSync({
      trigger: 'script',
      steps,
      deadlineMs: t0 + budget * 1000,
      assigneeDays: ad === 'all' ? null : ad ? Number(ad) : undefined,
      log: m => console.log(new Date().toISOString().slice(11, 19), m),
    })
    console.log(JSON.stringify({ loop: i + 1, skipped: result.skipped, calls: result.trellis_calls, r429: result.retries_429, s: result.elapsed_s,
      steps: Object.fromEntries(Object.entries(result.steps).map(([k, v]) => [k, v.status])) }))
    if (result.skipped) break
    const allDone = Object.values(result.steps).every(s => s.status === 'done')
    if (allDone) break
  }
}

main().catch(e => { console.error(e); process.exit(1) })
