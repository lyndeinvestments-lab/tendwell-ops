import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient, requireAdminBearer } from './_lib.js'

// POST /api/invoices/approve  Body: { run_id }
//
// The gate before any export: refuses while (a) any line still needs review,
// or (b) a stated subtotal exists and doesn't match the line sum to the penny.
// Nothing ships with unresolved flags — that's the review queue's contract.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const admin = await requireAdminBearer(req, res)
  if (!admin) return

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

  const { data: run, error: runErr } = await supabase
    .from('invoice_runs')
    .select('id, status, stated_subtotal, computed_subtotal')
    .eq('id', runId)
    .single()
  if (runErr || !run) {
    res.status(404).json({ error: 'Run not found' })
    return
  }
  if (run.status === 'approved' || run.status === 'exported') {
    res.status(200).json({ ok: true, run_id: runId, status: run.status, already: true })
    return
  }
  if (run.status === 'void' || run.status === 'ingested') {
    res.status(400).json({ error: `Run is ${run.status} — reconcile it first` })
    return
  }

  if (run.stated_subtotal != null && run.computed_subtotal != null) {
    const diff = Math.abs(Number(run.stated_subtotal) - Number(run.computed_subtotal))
    if (diff > 0.005) {
      res.status(400).json({
        error: 'Subtotal gate failed — line sum must equal the stated subtotal to the penny',
        stated_subtotal: run.stated_subtotal,
        computed_subtotal: run.computed_subtotal,
      })
      return
    }
  }

  const { count, error: cntErr } = await supabase
    .from('invoice_lines')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', runId)
    .eq('review_status', 'needs_review')
  if (cntErr) {
    res.status(500).json({ error: 'Failed to check review queue', detail: cntErr.message })
    return
  }
  if ((count ?? 0) > 0) {
    res.status(400).json({ error: `Cannot approve: ${count} line(s) still need review` })
    return
  }

  // Hard guard: a client-billable line without a billing channel would be
  // paid to the vendor but silently missing from BOTH AR exports (the
  // formatters filter by channel). Hand-resolved lines can end up here when
  // the property fix didn't re-derive the channel — refuse rather than leak.
  const { count: unrouted, error: chErr } = await supabase
    .from('invoice_lines')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', runId)
    .not('line_kind', 'in', '(operating_expense,excluded)')
    .neq('review_status', 'excluded')
    .or('billing_channel.is.null,billing_channel.eq.none')
  if (chErr) {
    res.status(500).json({ error: 'Failed to check billing channels', detail: chErr.message })
    return
  }
  if ((unrouted ?? 0) > 0) {
    res.status(400).json({
      error: `Cannot approve: ${unrouted} billable line(s) have no billing channel (would be paid to the vendor but never invoiced to a client). Fix the property/client link and re-run reconcile.`,
    })
    return
  }

  const { error: updErr } = await supabase
    .from('invoice_runs')
    .update({ status: 'approved', approved_by: admin.email, approved_at: new Date().toISOString() })
    .eq('id', runId)
  if (updErr) {
    res.status(500).json({ error: 'Failed to approve', detail: updErr.message })
    return
  }
  res.status(200).json({ ok: true, run_id: runId, status: 'approved' })
}
