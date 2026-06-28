import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyAuthHeader, getStaffRole, getSupabaseConfig } from '../notify/_lib.js'
import { createClient } from '@supabase/supabase-js'

// POST /api/trellis/sync-cancel
//
// Admin-only cooperative cancellation for a running Trellis sync.
// Auth: Bearer session JWT — same pattern as sync-now.ts.
//
// Sets cancel_requested=true on the most recent 'running' row started within
// the last 10 minutes. The running sync-now.ts checks this flag at each
// batch/phase checkpoint and stops gracefully (status='canceled').
//
// Response shapes:
//   { ok: true, log_id, message: 'cancel requested' }   — cancel flag set
//   { ok: true, message: 'no running sync' }             — nothing to cancel

export const config = { maxDuration: 30, runtime: 'nodejs' }

const CONCURRENCY_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let sb
  try { sb = getSupabaseConfig() } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  // ── Auth: valid session + admin role ──────────────────────────────────────
  const session = await verifyAuthHeader(sb, req.headers.authorization)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  const role = await getStaffRole(sb, session.email)
  if (role !== 'admin') return res.status(403).json({ error: 'Admin role required' })

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || sb.url,
    process.env.SUPABASE_SERVICE_ROLE_KEY || sb.serviceKey,
    { auth: { persistSession: false } },
  )

  // ── Find the most recent running row started within the last 10 min ───────
  const tenMinAgo = new Date(Date.now() - CONCURRENCY_WINDOW_MS).toISOString()
  const { data: running } = await supabase
    .from('trellis_sync_log')
    .select('id, status')
    .eq('status', 'running')
    .gte('started_at', tenMinAgo)
    .order('started_at', { ascending: false })
    .limit(1)

  if (!running || running.length === 0) {
    return res.status(200).json({ ok: true, message: 'no running sync' })
  }

  const logId = (running[0] as { id: string }).id

  // ── Set cancel_requested = true ───────────────────────────────────────────
  const { error } = await supabase
    .from('trellis_sync_log')
    .update({ cancel_requested: true })
    .eq('id', logId)

  if (error) {
    return res.status(500).json({ error: `Failed to set cancel flag: ${error.message}` })
  }

  return res.status(200).json({ ok: true, log_id: logId, message: 'cancel requested' })
}
