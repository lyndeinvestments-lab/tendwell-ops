import type { VercelRequest, VercelResponse } from '@vercel/node'
import { runAuxSync } from '../trellis/_aux-core.js'

// GET /api/cron/trellis-aux-sync
//
// Trellis auxiliary jobs (Vercel Cron, off the hour so it never overlaps the
// nightly 03:00 full sync or the hourly :00 task refresh): guest reviews,
// assignee enrichment for completed Tendwell cleans, resumable review + task
// history backfill, and inspection attribution. See api/trellis/_aux-core.ts.
// Skips itself while a trellis_sync_log run is active. State + results live in
// trellis_aux_sync_log (one row per run, kind='run', plus one per step).
//
// Auth: Vercel cron sets `Authorization: Bearer ${CRON_SECRET}`.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(500).json({ error: 'CRON_SECRET not configured' })
  const authHeader = req.headers.authorization
  const headerSecret = (req.headers['x-cron-secret'] as string | undefined) ?? ''
  if (!(authHeader === `Bearer ${cronSecret}` || headerSecret === cronSecret)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const t0 = Date.now()
  try {
    const result = await runAuxSync({ trigger: 'cron', deadlineMs: t0 + 250_000 })
    return res.json({ ok: true, ...result })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('TRELLIS AUX SYNC FAILED:', msg)
    return res.status(500).json({ ok: false, error: msg })
  }
}

// maxDuration: 300 seconds. Configured in vercel.json. Requires Vercel Pro.
export const config = { runtime: 'nodejs' }
