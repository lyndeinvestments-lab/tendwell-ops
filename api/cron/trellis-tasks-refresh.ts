import type { VercelRequest, VercelResponse } from '@vercel/node'
import { runSync, makeServiceSupabase } from '../trellis/_sync-core.js'

// GET /api/cron/trellis-tasks-refresh
//
// Hourly tasks-only Trellis → Supabase refresh (Vercel Cron). Keeps the
// trellis_task_snapshot fresh through the business day so the dashboard tile
// and /trellis-tasks page are at most ~1h stale. Roster + property snapshots
// are NOT touched — the nightly full sync (api/cron/trellis-sync.ts) owns those;
// this run reads the workspace-A roster ids from the DB.
//
// Auth: Vercel cron sets `Authorization: Bearer ${CRON_SECRET}`.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(500).json({ error: 'CRON_SECRET not configured' })

  const authHeader = req.headers.authorization
  const headerSecret = (req.headers['x-cron-secret'] as string | undefined) ?? ''
  const ok = authHeader === `Bearer ${cronSecret}` || headerSecret === cronSecret
  if (!ok) return res.status(401).json({ error: 'Unauthorized' })

  let sb
  try { sb = makeServiceSupabase() } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  const t0 = Date.now()
  const now = () => new Date().toISOString()

  // Skip if a full sync is already running/queued — the hourly refresh would
  // race its upserts and pruning for no benefit.
  const { data: active } = await sb.from('trellis_sync_log')
    .select('id').in('status', ['requested', 'running']).limit(1)
  if (active && active.length > 0) {
    return res.json({ ok: true, skipped: 'another sync is already running' })
  }

  const { data: ins, error } = await sb.from('trellis_sync_log')
    .insert({ status: 'running', trigger: 'hourly', started_at: now() })
    .select('id').single()
  if (error || !ins) return res.status(500).json({ error: `sync_log insert: ${error?.message}` })
  const logId = (ins as { id: string }).id

  try {
    const counts = await runSync({ trigger: 'hourly', tasksOnly: true })
    await sb.from('trellis_sync_log').update({ status: 'done', finished_at: now(), counts }).eq('id', logId)
    return res.json({ ok: true, log_id: logId, elapsed_s: ((Date.now() - t0) / 1000).toFixed(1), counts })
  } catch (err: any) {
    await sb.from('trellis_sync_log').update({ status: 'error', finished_at: now(), error: String(err?.message || err) }).eq('id', logId)
    console.error('TRELLIS TASKS REFRESH FAILED:', err?.message || err)
    return res.status(500).json({ ok: false, log_id: logId, error: err?.message || String(err) })
  }
}

// maxDuration: 300 seconds (5 min). Configured in vercel.json. Requires Vercel Pro.
export const config = { runtime: 'nodejs' }
