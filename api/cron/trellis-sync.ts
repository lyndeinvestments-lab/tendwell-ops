import type { VercelRequest, VercelResponse } from '@vercel/node'
import { runSync, makeServiceSupabase } from '../trellis/_sync-core.js'

// GET /api/cron/trellis-sync
//
// Vercel Cron entrypoint for the nightly Trellis → Supabase sync.
// Auth: Vercel cron sets `Authorization: Bearer ${CRON_SECRET}`.
// No progress callback — cron runs are fire-and-forget.
//
// This endpoint does NOT forward progress to trellis_sync_log.progress;
// it uses the same insert/update lifecycle as the legacy direct script.

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
  const started_at = new Date(t0).toISOString()

  // Claim oldest pending row or open a new run
  let logId: string
  const { data: req_ } = await sb.from('trellis_sync_log').select('id').eq('status', 'requested').order('created_at').limit(1)
  const now = () => new Date().toISOString()
  if (req_ && req_.length > 0) {
    logId = (req_[0] as { id: string }).id
    await sb.from('trellis_sync_log').update({ status: 'running', started_at: now() }).eq('id', logId)
  } else {
    const { data: ins, error } = await sb.from('trellis_sync_log')
      .insert({ status: 'running', trigger: 'nightly', started_at: now() })
      .select('id').single()
    if (error || !ins) return res.status(500).json({ error: `sync_log insert: ${error?.message}` })
    logId = (ins as { id: string }).id
  }

  try {
    const counts = await runSync({ trigger: 'nightly' })
    await sb.from('trellis_sync_log').update({ status: 'done', finished_at: now(), counts }).eq('id', logId)
    return res.json({ ok: true, log_id: logId, elapsed_s: ((Date.now() - t0) / 1000).toFixed(1), counts })
  } catch (err: any) {
    await sb.from('trellis_sync_log').update({ status: 'error', finished_at: now(), error: String(err?.message || err) }).eq('id', logId)
    console.error('TRELLIS SYNC CRON FAILED:', err?.message || err)
    return res.status(500).json({ ok: false, log_id: logId, error: err?.message || String(err) })
  }
}

export const config = { runtime: 'nodejs' }
