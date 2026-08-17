import type { VercelRequest, VercelResponse } from '@vercel/node'
import { generateDraftLines } from './_engine.js'
import { getServiceClient, loadEngineContext, reconcileRun, requireInvoicingBearer, toLineInserts } from './_lib.js'
import { reconcile } from './_engine.js'

// POST /api/invoices/generate
// Body: { vendor_id: string, period_start: 'yyyy-mm-dd', period_end: 'yyyy-mm-dd' }
//
// The "suggested invoice" path: builds a draft invoice deterministically from
// breezeway_tasks (due_date in range) × per-property cleaner pay, then runs the
// same reconcile pipeline a vendor CSV goes through. No LLM, no upload.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const actor = await requireInvoicingBearer(req, res)
  if (!actor) return

  const body = (req.body ?? {}) as Record<string, unknown>
  const vendorId = typeof body.vendor_id === 'string' ? body.vendor_id : null
  const periodStart = typeof body.period_start === 'string' ? body.period_start : ''
  const periodEnd = typeof body.period_end === 'string' ? body.period_end : ''
  if (!vendorId || !ISO_DATE.test(periodStart) || !ISO_DATE.test(periodEnd) || periodStart > periodEnd) {
    res.status(400).json({ error: 'vendor_id, period_start and period_end (yyyy-mm-dd, start <= end) are required' })
    return
  }

  const supabase = getServiceClient()
  if (!supabase) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return
  }

  try {
    const ctx = await loadEngineContext(supabase, periodStart, periodEnd)
    // Draft only from tasks strictly inside the requested period (the context
    // window is padded for matching, not for generation).
    const inPeriod = ctx.tasks.filter(
      t => t.dueDate != null && t.dueDate >= periodStart && t.dueDate <= periodEnd,
    )
    const propsById = new Map(ctx.properties.map(p => [p.id, p]))
    const rawLines = generateDraftLines(inPeriod, propsById)
    if (rawLines.length === 0) {
      res.status(200).json({ ok: false, reason: 'no_tasks', detail: 'No clean/deep-clean tasks with a linked property in that period' })
      return
    }

    const { data: run, error: runErr } = await supabase
      .from('invoice_runs')
      .insert({
        vendor_id: vendorId,
        source: 'generated',
        period_start: periodStart,
        period_end: periodEnd,
        invoice_date: periodEnd,
        status: 'ingested',
        created_by: actor.email,
      })
      .select('id')
      .single()
    if (runErr || !run) throw new Error(`Failed to create run: ${runErr?.message}`)

    const { lines } = reconcile({
      vendorId,
      lines: rawLines,
      aliases: ctx.aliases,
      properties: ctx.properties,
      tasks: ctx.tasks,
      periodStart,
      periodEnd,
    })
    const { error: insErr } = await supabase.from('invoice_lines').insert(toLineInserts(run.id, lines))
    if (insErr) throw new Error(`Failed to insert lines: ${insErr.message}`)

    // reconcileRun recomputes status + computed_subtotal off the stored rows
    // (idempotent with the insert above — it preserves nothing on first pass).
    const result = await reconcileRun(supabase, run.id)
    res.status(200).json({ ok: true, run_id: run.id, status: result.status, summary: result.summary })
  } catch (e) {
    res.status(500).json({ error: 'Generate failed', detail: e instanceof Error ? e.message : String(e) })
  }
}
