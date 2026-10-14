import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyAuthHeader, getStaffRole, getSupabaseConfig } from '../notify/_lib.js'
import { runAuxSync, ALL_AUX_STEPS, type AuxStep } from './_aux-core.js'

// POST /api/trellis/backfill
//
// Admin-only: run one slice of the Trellis auxiliary jobs on demand (reviews,
// assignee enrichment, review / task history backfill, inspection
// attribution). Same auth as /api/trellis/sync-now (session JWT + admin role).
// Each slice stops at its deadline and records where it got to in
// trellis_aux_sync_log, so calling it again continues the backfill.
//
// Body (all optional):
//   { "steps": ["task_backfill"], "budget_s": 240,
//     "task_floor": { "B": "2025-06-01" }, "review_days": 365, "assignee_days": null }

export const config = { maxDuration: 300, runtime: 'nodejs' }

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const t0 = Date.now()

  let sb
  try { sb = getSupabaseConfig() } catch (e: unknown) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
  const session = await verifyAuthHeader(sb, req.headers.authorization)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  const role = await getStaffRole(sb, session.email)
  if (role !== 'admin') return res.status(403).json({ error: 'Admin role required' })

  const body = (typeof req.body === 'object' && req.body) ? req.body as Record<string, unknown> : {}
  const steps = Array.isArray(body.steps)
    ? body.steps.filter((s): s is AuxStep => (ALL_AUX_STEPS as string[]).includes(String(s)))
    : undefined
  if (Array.isArray(body.steps) && steps!.length === 0) return res.status(400).json({ error: `steps must be some of ${ALL_AUX_STEPS.join(', ')}` })
  const budget = Math.min(250, Math.max(10, Number(body.budget_s) || 250))
  const floor = (body.task_floor && typeof body.task_floor === 'object') ? body.task_floor as Record<string, unknown> : {}
  const reviewDays = Number(body.review_days)

  try {
    const result = await runAuxSync({
      trigger: 'manual',
      steps,
      deadlineMs: t0 + budget * 1000,
      taskFloor: { A: isDate(floor.A) ? floor.A : undefined, B: isDate(floor.B) ? floor.B : undefined },
      reviewDays: Number.isFinite(reviewDays) && reviewDays > 0 && reviewDays <= 3650 ? reviewDays : undefined,
      assigneeDays: body.assignee_days === null ? null : Number.isFinite(Number(body.assignee_days)) && body.assignee_days !== undefined ? Number(body.assignee_days) : undefined,
    })
    return res.status(200).json({ ok: true, ...result })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('TRELLIS BACKFILL FAILED:', msg)
    return res.status(500).json({ ok: false, error: msg })
  }
}
