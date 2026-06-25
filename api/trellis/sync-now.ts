import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyAuthHeader, getStaffRole, getSupabaseConfig } from '../notify/_lib.js'
import { runSync, type SyncProgress } from './_sync-core.js'
import { createClient } from '@supabase/supabase-js'

// POST /api/trellis/sync-now
//
// Admin-only on-demand Trellis → Supabase sync with live progress.
// Auth: Bearer session JWT verified against Supabase Auth + admin role in app_users.
// Reuses the same verifyAuthHeader + getStaffRole helpers as api/notify/send.ts.
//
// Response: { ok: true, log_id: string } — the caller polls trellis_sync_log
// for status/progress updates.
//
// Concurrency guard: if a `running` row exists started < 10 min ago, returns
// that row id immediately instead of starting a second sync.

export const config = { maxDuration: 300, runtime: 'nodejs' }

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

  const now = () => new Date().toISOString()

  // ── Concurrency guard ─────────────────────────────────────────────────────
  // If a running row exists started within the last 10 min, return it.
  const tenMinAgo = new Date(Date.now() - CONCURRENCY_WINDOW_MS).toISOString()
  const { data: running } = await supabase
    .from('trellis_sync_log')
    .select('id')
    .eq('status', 'running')
    .gte('started_at', tenMinAgo)
    .order('started_at', { ascending: false })
    .limit(1)
  if (running && running.length > 0) {
    return res.status(200).json({ ok: true, log_id: (running[0] as { id: string }).id, already_running: true })
  }

  // ── Claim or open a log row ───────────────────────────────────────────────
  let logId: string
  const { data: pending } = await supabase
    .from('trellis_sync_log')
    .select('id')
    .eq('status', 'requested')
    .order('created_at')
    .limit(1)

  if (pending && pending.length > 0) {
    logId = (pending[0] as { id: string }).id
    await supabase.from('trellis_sync_log').update({ status: 'running', started_at: now() }).eq('id', logId)
  } else {
    const { data: ins, error } = await supabase
      .from('trellis_sync_log')
      .insert({ status: 'running', trigger: 'manual', requested_by: session.email, started_at: now() })
      .select('id')
      .single()
    if (error || !ins) return res.status(500).json({ error: `sync_log insert: ${error?.message}` })
    logId = (ins as { id: string }).id
  }

  // ── Progress callback: UPDATE trellis_sync_log.progress ──────────────────
  const onProgress = async (p: SyncProgress) => {
    await supabase
      .from('trellis_sync_log')
      .update({ progress: p })
      .eq('id', logId)
  }

  // ── Run sync ──────────────────────────────────────────────────────────────
  try {
    const counts = await runSync({ trigger: 'manual', requestedBy: session.email, onProgress })
    await supabase.from('trellis_sync_log').update({ status: 'done', finished_at: now(), counts, progress: null }).eq('id', logId)
    return res.status(200).json({ ok: true, log_id: logId, counts })
  } catch (err: any) {
    const msg = String(err?.message || err)
    await supabase.from('trellis_sync_log').update({ status: 'error', finished_at: now(), error: msg, progress: null }).eq('id', logId)
    console.error('TRELLIS SYNC-NOW FAILED:', msg)
    return res.status(500).json({ ok: false, log_id: logId, error: msg })
  }
}
