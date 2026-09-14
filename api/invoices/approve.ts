import type { VercelRequest, VercelResponse } from '@vercel/node'
import { fetchAllRows, getServiceClient, refreshBillingChannels, requireInvoicingBearer } from './_lib.js'

// A line that is holding up Approve. Every guard below reports these, because
// a bare count ("2 billable line(s) have no billing channel") is unfindable on
// a 287-line run — especially once a human has hit Resolve on the line, which
// drops it out of the review-queue filter while it keeps blocking the run.
interface BlockingLine {
  line_no: number
  raw_property_text: string | null
  raw_amount: number | string | null
}

// "Line 286 "Ups Deliver 8/31/26" ($33.95), line 287 …" — names the first few
// so the run detail's All filter can be searched for them directly.
function describeLines(rows: BlockingLine[], max = 5): string {
  const shown = rows.slice(0, max).map(r => {
    const amt = r.raw_amount == null ? '' : ` (${Number(r.raw_amount).toFixed(2)})`
    const what = (r.raw_property_text ?? '').trim()
    return `line ${r.line_no}${what ? ` "${what}"` : ''}${amt}`
  })
  const more = rows.length > max ? `, and ${rows.length - max} more` : ''
  return `Affected: ${shown.join(', ')}${more}.`
}

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
  // First pick up any client channel fixed since the lines were resolved
  // (Clients page / review dialog), so a fixed client unblocks Approve
  // without a manual re-reconcile.
  try {
    await refreshBillingChannels(supabase, runId)
  } catch (e) {
    res.status(500).json({ error: 'Failed to refresh billing channels', detail: e instanceof Error ? e.message : String(e) })
    return
  }
  let unroutedRows: BlockingLine[]
  try {
    unroutedRows = await fetchAllRows<BlockingLine>(
      'invoice_lines (unrouted)',
      () => supabase
        .from('invoice_lines')
        .select('line_no, raw_property_text, raw_amount')
        .eq('run_id', runId)
        .not('line_kind', 'in', '(operating_expense,excluded)')
        .neq('review_status', 'excluded')
        .or('billing_channel.is.null,billing_channel.eq.none')
        .order('line_no'),
      'line_no',
    )
  } catch (e) {
    res.status(500).json({ error: 'Failed to check billing channels', detail: e instanceof Error ? e.message : String(e) })
    return
  }
  if (unroutedRows.length > 0) {
    res.status(400).json({
      error: `Cannot approve: ${unroutedRows.length} billable line(s) have no billing channel (would be paid to the vendor but never invoiced to a client). ${describeLines(unroutedRows)} Open the line (pencil) and pick a billing channel, or set the client's Payment Method on the Clients page, then approve again.`,
      blocking_lines: unroutedRows,
    })
    return
  }

  // Same class of leak via a different path: a billable line whose property
  // was cleared in review would export with a blank property name/class.
  let propertylessRows: BlockingLine[]
  try {
    propertylessRows = await fetchAllRows<BlockingLine>(
      'invoice_lines (no property)',
      () => supabase
        .from('invoice_lines')
        .select('line_no, raw_property_text, raw_amount')
        .eq('run_id', runId)
        .not('line_kind', 'in', '(operating_expense,excluded)')
        .neq('review_status', 'excluded')
        .is('property_id', null)
        .order('line_no'),
      'line_no',
    )
  } catch (e) {
    res.status(500).json({ error: 'Failed to check property links', detail: e instanceof Error ? e.message : String(e) })
    return
  }
  if (propertylessRows.length > 0) {
    res.status(400).json({
      error: `Cannot approve: ${propertylessRows.length} billable line(s) have no property assigned. ${describeLines(propertylessRows)} Assign a property, or set the line kind to Tendwell expense if it isn't a property clean.`,
      blocking_lines: propertylessRows,
    })
    return
  }

  // A billed line with no cleaner pay silently VANISHES from the Ramp export
  // (the AP filter drops null/zero pay) — the vendor's invoice total then
  // never reconciles. Real case: "Irma Work" $1,054 resolved with null pay
  // made the Ramp file $1,054 short. Zero-raw lines (e.g. split surcharges)
  // are fine.
  // Paged: a truncated read would let this guard pass a run whose unpaid
  // lines happened to sit past the 1000-row cap.
  let unpaidRows: Array<Record<string, any>>
  try {
    unpaidRows = await fetchAllRows<Record<string, any>>(
      'invoice_lines',
      () => supabase
        .from('invoice_lines')
        .select('id, line_no, raw_property_text, raw_amount, cleaner_pay_amount, line_kind, review_status')
        .eq('run_id', runId)
        .neq('line_kind', 'excluded')
        .neq('review_status', 'excluded')
        .neq('raw_amount', 0)
        .order('line_no'),
      'line_no',
    )
  } catch (e) {
    res.status(500).json({ error: 'Failed to check cleaner pay coverage', detail: e instanceof Error ? e.message : String(e) })
    return
  }
  const unpaid = unpaidRows.filter(r => !(Number(r.cleaner_pay_amount ?? 0) !== 0))
  if (unpaid.length > 0) {
    const named = unpaid.map(r => ({ line_no: r.line_no, raw_property_text: r.raw_property_text, raw_amount: r.raw_amount }))
    res.status(400).json({
      error: `Cannot approve: ${unpaid.length} billed line(s) have no cleaner pay — they would be silently missing from the Ramp export. ${describeLines(named)} Set the pay (usually the invoiced amount) or exclude the line.`,
      blocking_lines: named,
    })
    return
  }

  const { error: updErr } = await supabase
    .from('invoice_runs')
    .update({ status: 'approved', approved_by: actor.email, approved_at: new Date().toISOString() })
    .eq('id', runId)
  if (updErr) {
    res.status(500).json({ error: 'Failed to approve', detail: updErr.message })
    return
  }
  res.status(200).json({ ok: true, run_id: runId, status: 'approved' })
}
