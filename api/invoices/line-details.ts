import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requirePermissionBearer } from '../qbo/_lib.js'
import { getServiceClient } from './_lib.js'
import { compactDetail, loadServiceDetails } from './_service-detail.js'

// GET /api/invoices/line-details?run_id=<uuid>
//
// What each line of a run actually was: the task behind it (what was asked,
// when, priority, who did it, checklist), who was staying that day, and
// warnings worth a look before billing. Access codes are masked
// (shared/service-detail.ts). Read-only; needs the `invoicing` VIEW grant
// (a finance view), since it names guests next to billed lines.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const actor = await requirePermissionBearer(req, res, 'invoicing', 'view')
  if (!actor) return

  const runId = typeof req.query.run_id === 'string' ? req.query.run_id : null
  if (!runId || !UUID_RE.test(runId)) {
    res.status(400).json({ error: 'run_id is required' })
    return
  }
  const supabase = getServiceClient()
  if (!supabase) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return
  }
  try {
    const details = await loadServiceDetails(supabase, runId)
    res.setHeader('Cache-Control', 'private, no-store')
    res.status(200).json({ details: compactDetail(details) })
  } catch (e) {
    res.status(500).json({ error: 'Failed to load service detail', detail: e instanceof Error ? e.message : String(e) })
  }
}
