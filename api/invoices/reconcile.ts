import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient, reconcileRun, requireInvoicingBearer } from './_lib.js'

// POST /api/invoices/reconcile  Body: { run_id }
// Re-runs the deterministic engine over a run's lines (e.g. after new aliases
// were confirmed or rates were fixed). Rows already resolved by a human and
// manually added rows are preserved; everything else is rebuilt.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const actor = await requireInvoicingBearer(req, res)
  if (!actor) return

  const runId = typeof (req.body as any)?.run_id === 'string' ? (req.body as any).run_id : null
  if (!runId) {
    res.status(400).json({ error: 'run_id is required' })
    return
  }
  const supabase = getServiceClient()
  if (!supabase) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return
  }
  try {
    const result = await reconcileRun(supabase, runId)
    res.status(200).json({ ok: true, run_id: runId, status: result.status, summary: result.summary })
  } catch (e) {
    res.status(500).json({ error: 'Reconcile failed', detail: e instanceof Error ? e.message : String(e) })
  }
}
