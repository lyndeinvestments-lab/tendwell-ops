import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient, requireInvoicingBearer } from './_lib.js'

// POST /api/invoices/return  Body: { run_id, note }
//
// Send a SUBMITTED vendor-portal invoice back to the vendor to fix (missing
// receipt, wrong date, a clean that didn't happen…). The run becomes a draft
// again, the note is shown to the vendor, and they re-submit. Lines Tendwell
// already resolved or excluded stay that way (reconcile preserves them).
// Only for portal runs that are not yet approved — an approved invoice is
// voided or credited, never silently reopened.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const actor = await requireInvoicingBearer(req, res)
  if (!actor) return

  const body = (req.body ?? {}) as Record<string, unknown>
  const runId = typeof body.run_id === 'string' ? body.run_id : null
  const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim() : ''
  if (!runId) {
    res.status(400).json({ error: 'run_id is required' })
    return
  }
  if (note.length < 10) {
    res.status(400).json({ error: 'Tell the vendor what to fix (at least 10 characters)' })
    return
  }
  const supabase = getServiceClient()
  if (!supabase) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return
  }

  const { data: run, error } = await supabase
    .from('invoice_runs')
    .select('id, source, status')
    .eq('id', runId)
    .maybeSingle()
  if (error || !run) {
    res.status(404).json({ error: 'Run not found' })
    return
  }
  if (run.source !== 'vendor_portal') {
    res.status(400).json({ error: 'Only invoices the vendor built in Ops can be returned to them' })
    return
  }
  if (!['review_needed', 'reconciled', 'ingested'].includes(run.status)) {
    res.status(409).json({ error: `Run is ${run.status} — only a submitted, unapproved invoice can be returned` })
    return
  }

  const { error: updErr } = await supabase
    .from('invoice_runs')
    .update({
      status: 'draft',
      returned_at: new Date().toISOString(),
      returned_by: actor.email,
      returned_note: note.slice(0, 1000),
    })
    .eq('id', runId)
    .eq('status', run.status)
  if (updErr) {
    res.status(500).json({ error: 'Failed to return the invoice', detail: updErr.message })
    return
  }
  res.status(200).json({ ok: true, run_id: runId, status: 'draft' })
}
