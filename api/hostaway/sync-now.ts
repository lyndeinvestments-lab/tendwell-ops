import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyAuthHeader, getStaffRole, getSupabaseConfig } from '../notify/_lib.js'
import { runSync, makeServiceSupabase } from './_sync-core.js'

// POST /api/hostaway/sync-now
//
// Admin-only on-demand Hostaway → Supabase listing sync (the Refresh button
// on the Trellis Sync page's Hostaway tab). Auth mirrors
// api/trellis/sync-now.ts: Bearer session JWT verified against Supabase Auth
// + admin role in app_users.

export const config = { maxDuration: 120, runtime: 'nodejs' }

const CONCURRENCY_WINDOW_MS = 5 * 60 * 1000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let sb
  try { sb = getSupabaseConfig() } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  const session = await verifyAuthHeader(sb, req.headers.authorization)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  const role = await getStaffRole(sb, session.email)
  if (role !== 'admin') return res.status(403).json({ error: 'Admin role required' })

  let supabase
  try { supabase = makeServiceSupabase() } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  const now = () => new Date().toISOString()

  // Concurrency guard: a running row started in the last 5 min wins.
  const windowStart = new Date(Date.now() - CONCURRENCY_WINDOW_MS).toISOString()
  const { data: running } = await supabase
    .from('hostaway_sync_log')
    .select('id')
    .eq('status', 'running')
    .gte('started_at', windowStart)
    .limit(1)
  if (running && running.length > 0) {
    return res.status(200).json({ ok: true, log_id: (running[0] as { id: string }).id, already_running: true })
  }

  const { data: ins, error } = await supabase
    .from('hostaway_sync_log')
    .insert({ status: 'running', trigger: 'manual', requested_by: session.email, started_at: now() })
    .select('id')
    .single()
  if (error || !ins) return res.status(500).json({ error: `sync_log insert: ${error?.message}` })
  const logId = (ins as { id: string }).id

  try {
    const counts = await runSync({ trigger: 'manual' })
    await supabase.from('hostaway_sync_log').update({ status: 'done', finished_at: now(), counts }).eq('id', logId)
    return res.status(200).json({ ok: true, log_id: logId, counts })
  } catch (err: any) {
    const msg = String(err?.message || err)
    await supabase.from('hostaway_sync_log').update({ status: 'error', finished_at: now(), error: msg }).eq('id', logId)
    console.error('HOSTAWAY SYNC-NOW FAILED:', msg)
    return res.status(500).json({ ok: false, log_id: logId, error: msg })
  }
}
