import type { VercelRequest, VercelResponse } from '@vercel/node'
import { fetchAllRows, getServiceClient, refreshBillingChannels, requireInvoicingBearer } from './_lib.js'
import { REDO_PENDING_FLAG, redoBlocker, type RedoCheckLine } from '../../shared/invoice-redo.js'

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
// or (b) the line sum doesn't match the stated subtotal to the penny (a
// vendor CSV must have one: body.stated_subtotal sets it).
// Nothing ships with unresolved flags — that's the review queue's contract.

/** A reimbursement's review note is detailed enough when it names who it was
 *  for (guest / reservation / owner) and carries a link to the evidence. */
export function reimbursementDetailOk(note: string | null | undefined): boolean {
  const n = (note ?? '').trim()
  if (n.length < 15) return false
  const hasLink = /https?:\/\//i.test(n)
  const hasWho = /\b(guest|reservation|res\b|owner|booking|stay)\b/i.test(n)
  return hasLink && hasWho
}

/** Charges Haven recovers from a guest or owner, so each must say who it was
 *  for: a Trip Fee or a mailed left item is as much a guest claim as a UPS
 *  receipt (1096 #258, John Bryan Trip Fee $50, carried no detail at all). */
export const DETAIL_REQUIRED_SERVICES = ['Reimbursement', 'Trip Fee', 'Mailed Left Items by the Guest']

/** What the vendor invoiced, from the lines as they stand now (a reviewer
 *  may have edited an amount since the last reconcile). Split rows share a
 *  line_no and only the base row carries the vendor's amount; task-derived
 *  rows were never on the vendor's invoice. */
export function vendorInvoicedSum(rows: ReadonlyArray<{ line_no: number; raw_amount: number | string | null; split_group: number | null; line_kind: string; source: string | null }>): number {
  const base = new Map<number, number>()
  for (const r of rows) {
    if (r.source === 'task') continue
    if (r.split_group == null || r.line_kind !== 'extra') base.set(r.line_no, Number(r.raw_amount ?? 0))
  }
  return Math.round([...base.values()].reduce((a, n) => a + n, 0) * 100) / 100
}

/** Redo-flagged lines that still lack a usable bill / no-charge decision.
 *  Rows sharing a line_no are one vendor line, reported once. */
export function undecidedRedoLines<T extends BlockingLine & RedoCheckLine>(rows: ReadonlyArray<T>): BlockingLine[] {
  const out: BlockingLine[] = []
  const seen = new Set<number>()
  for (const r of rows) {
    if (seen.has(r.line_no) || redoBlocker(r) == null) continue
    seen.add(r.line_no)
    out.push({ line_no: r.line_no, raw_property_text: r.raw_property_text, raw_amount: r.raw_amount })
  }
  return out
}

const CLEAN_KINDS = ['clean', 'deep_clean', 'combined_split']

/** Clean lines on this run whose property-day is billed twice: twice within
 *  the run, or already on another approved/exported (non-archived) run. */
export async function duplicateCleanLines(
  supabase: NonNullable<ReturnType<typeof getServiceClient>>,
  runId: string,
): Promise<BlockingLine[]> {
  const mine = await fetchAllRows<BlockingLine & { property_id: number; service_date: string | null; raw_date_mentioned: string | null; split_group: number | null; line_kind: string }>(
    'invoice_lines (cleans on run)',
    () => supabase
      .from('invoice_lines')
      .select('line_no, raw_property_text, raw_amount, property_id, service_date, raw_date_mentioned, split_group, line_kind')
      .eq('run_id', runId)
      .in('line_kind', CLEAN_KINDS)
      .neq('review_status', 'excluded')
      .not('property_id', 'is', null)
      .order('line_no'),
    'line_no',
  )
  const dayOf = (r: { property_id: number; service_date: string | null; raw_date_mentioned: string | null }) => {
    const d = r.service_date ?? r.raw_date_mentioned
    return d ? `${r.property_id}|${d}` : null
  }
  const dates = mine.map(r => r.service_date ?? r.raw_date_mentioned).filter((d): d is string => !!d).sort()
  if (dates.length === 0) return []
  const lo = dates[0]
  const hi = dates[dates.length - 1]
  const others = await fetchAllRows<{ id: string; property_id: number; service_date: string | null; raw_date_mentioned: string | null }>(
    'invoice_lines (billed cleans)',
    () => supabase
      .from('invoice_lines')
      .select('id, property_id, service_date, raw_date_mentioned, invoice_runs!inner(status, archived_at)')
      .neq('run_id', runId)
      .in('line_kind', CLEAN_KINDS)
      .neq('review_status', 'excluded')
      .not('property_id', 'is', null)
      .in('invoice_runs.status', ['approved', 'exported'])
      .is('invoice_runs.archived_at', null)
      .or(`and(service_date.gte.${lo},service_date.lte.${hi}),and(service_date.is.null,raw_date_mentioned.gte.${lo},raw_date_mentioned.lte.${hi})`)
      .order('id') as any,
    'id',
  )
  const billedElsewhere = new Set(others.map(dayOf).filter((k): k is string => !!k))
  const seen = new Set<string>()
  const seenLineNos = new Set<number>()
  const out: BlockingLine[] = []
  for (const r of mine) {
    const k = dayOf(r)
    if (!k) continue
    // Rows sharing a line_no are ONE vendor line split for the client
    // invoice (base clean + onboarding surcharge, Paladino 4420 on 1096) —
    // not a second clean.
    if (seenLineNos.has(r.line_no)) continue
    seenLineNos.add(r.line_no)
    if (billedElsewhere.has(k) || seen.has(k)) out.push({ line_no: r.line_no, raw_property_text: r.raw_property_text, raw_amount: r.raw_amount })
    seen.add(k)
  }
  return out
}

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
    .select('id, source, status, stated_subtotal, computed_subtotal')
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
  if (run.status === 'draft') {
    // A vendor-portal invoice the vendor hasn't submitted (or that Tendwell
    // returned to them) is still being written — never approve it from under them.
    res.status(400).json({ error: 'This invoice is still a draft with the vendor — it can be approved once they submit it' })
    return
  }
  if (run.status === 'void' || run.status === 'ingested') {
    res.status(400).json({ error: `Run is ${run.status} — reconcile it first` })
    return
  }

  // Penny gate. A vendor CSV IS the vendor's invoice, so its lines must add
  // up to the total printed on that invoice before anything is paid or billed.
  // Every run since August had no stated total, so the gate never ran and
  // $347.15 of in-Ops amount edits on 1096 went through unexplained. The total
  // is required here (entered at upload, or with this approve).
  if (run.source === 'vendor_csv') {
    const givenRaw = (req.body as any)?.stated_subtotal
    const given = givenRaw == null || givenRaw === '' ? null : Number(givenRaw)
    if (given != null && !Number.isFinite(given)) {
      res.status(400).json({ error: 'stated_subtotal must be a number' })
      return
    }
    // A total typed at approve time replaces the stored one (it corrects a
    // typo at upload); it is saved even when the gate then fails.
    if (given != null && given !== (run.stated_subtotal != null ? Number(run.stated_subtotal) : null)) {
      const { error: setErr } = await supabase.from('invoice_runs').update({ stated_subtotal: given }).eq('id', runId)
      if (setErr) {
        res.status(500).json({ error: 'Failed to save the vendor invoice total', detail: setErr.message })
        return
      }
    }
    const stated = given ?? (run.stated_subtotal != null ? Number(run.stated_subtotal) : null)
    if (stated == null) {
      res.status(400).json({
        error: "Cannot approve: enter the total printed on the vendor's invoice — the lines must add up to it to the penny.",
        code: 'stated_subtotal_required',
      })
      return
    }
    let lineSum: number
    try {
      const rows = await fetchAllRows<{ id: string; line_no: number; raw_amount: number | null; split_group: number | null; line_kind: string; source: string | null }>(
        'invoice_lines (penny gate)',
        () => supabase
          .from('invoice_lines')
          .select('id, line_no, raw_amount, split_group, line_kind, source')
          .eq('run_id', runId)
          .order('id'),
        'id',
      )
      lineSum = vendorInvoicedSum(rows)
    } catch (e) {
      res.status(500).json({ error: 'Failed to total the invoice lines', detail: e instanceof Error ? e.message : String(e) })
      return
    }
    if (Math.abs(stated - lineSum) > 0.005) {
      res.status(400).json({
        error: `Subtotal gate failed — the lines add up to $${lineSum.toFixed(2)} but the vendor's invoice says $${stated.toFixed(2)}. Find the edited or missing amount (or get a corrected invoice from the vendor) before approving.`,
        stated_subtotal: stated,
        computed_subtotal: lineSum,
      })
      return
    }
  } else if (run.stated_subtotal != null && run.computed_subtotal != null) {
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

  // Redos: a clean followed by a callback / reclean within a week needs an
  // explicit decision, "bill" (charge stands) or "no charge" (our fault, client
  // charge 0). Checked before the generic review count so the message names
  // the decision, and again on resolved rows: a bulk Resolve must not wave a
  // redo through without one (shared/invoice-redo.ts).
  let undecidedRedos: BlockingLine[]
  try {
    const rows = await fetchAllRows<BlockingLine & RedoCheckLine>(
      'invoice_lines (redo decisions)',
      () => supabase
        .from('invoice_lines')
        .select('line_no, raw_property_text, raw_amount, flags, review_status, line_kind, review_note, client_charge_amount')
        .eq('run_id', runId)
        .contains('flags', [REDO_PENDING_FLAG])
        .order('line_no'),
      'line_no',
    )
    undecidedRedos = undecidedRedoLines(rows)
  } catch (e) {
    res.status(500).json({ error: 'Failed to check redo decisions', detail: e instanceof Error ? e.message : String(e) })
    return
  }
  if (undecidedRedos.length > 0) {
    res.status(400).json({
      error: `Cannot approve: ${undecidedRedos.length} clean line(s) were followed by a redo/callback and have no decision. ${describeLines(undecidedRedos)} Open each line and choose "Bill" (the charge stands) or "No charge" (the redo was our fault; client charge 0).`,
      blocking_lines: undecidedRedos,
    })
    return
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

  // Hard guard: one clean per property per day, ever. The engine flags
  // `already_billed` at reconcile time, but that is a review flag a human can
  // resolve, it only looks at runs approved BEFORE that reconcile, and two
  // runs for the same week (an uploaded CSV and a vendor-portal invoice, or a
  // re-upload) could each pass review alone. Checked here, at the last gate,
  // against this run itself and every approved/exported run. A genuine
  // second clean that day is billed as a Double Clean extra, not a clean.
  try {
    const dupes = await duplicateCleanLines(supabase, runId)
    if (dupes.length > 0) {
      res.status(400).json({
        error: `Cannot approve: ${dupes.length} clean line(s) bill a property-day that is already billed (on this invoice or an approved one). ${describeLines(dupes)} Exclude the duplicate, or bill a genuine second clean as a Double Clean.`,
        blocking_lines: dupes,
      })
      return
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to check for duplicate cleans', detail: e instanceof Error ? e.message : String(e) })
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
  // Exception: a line routed to QBO/Haven. Haven is the single QBO customer,
  // so the invoice knows who to bill without a property — the case is courier
  // reimbursements (UPS/FedEx), whose vendor line names the carrier, not a
  // cabin (Jordan, 2026-10-05, invoice 1261003821). bill.com still needs the
  // property: its worksheet bills per client, and the client comes from it.
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
        // A Reimbursement ALWAYS needs its property, Haven or not: Haven's AP
        // must know which cabin/guest it was for to recover it from the guest
        // (Christine, 2026-10-06 — two UPS lines on 1096 had no property).
        .or('billing_channel.is.null,billing_channel.neq.qbo_haven,service_type.eq.Reimbursement')
        .order('line_no'),
      'line_no',
    )
  } catch (e) {
    res.status(500).json({ error: 'Failed to check property links', detail: e instanceof Error ? e.message : String(e) })
    return
  }
  if (propertylessRows.length > 0) {
    res.status(400).json({
      error: `Cannot approve: ${propertylessRows.length} billable line(s) have no property assigned. ${describeLines(propertylessRows)} Assign a property, bill it to QuickBooks (Haven) — the one channel that needs no property — or set the line kind to Tendwell expense if it isn't billed to a client.`,
      blocking_lines: propertylessRows,
    })
    return
  }

  // Reimbursements must say what they were for. Haven files guest-caused
  // costs (shipping a guest's left item, etc.) as claims against the guest,
  // so "UPS courier reimbursement" isn't enough: the review note has to name
  // what was shipped/delivered, for which guest or reservation, and link the
  // Slack/Quo thread (Christine, 2026-10-06).
  let vagueReimbursements: BlockingLine[]
  try {
    const rows = await fetchAllRows<BlockingLine & { review_note: string | null; raw_note_text: string | null }>(
      'invoice_lines (reimbursement detail)',
      () => supabase
        .from('invoice_lines')
        .select('line_no, raw_property_text, raw_amount, review_note, raw_note_text')
        .eq('run_id', runId)
        .in('service_type', DETAIL_REQUIRED_SERVICES)
        // A line backed by a Breezeway/Trellis task ("Cleaning: Supply
        // Delivery") already has its evidence; only free-text vendor lines
        // (UPS/FedEx receipts) need the note.
        .is('matched_task_id', null)
        .not('line_kind', 'in', '(operating_expense,excluded)')
        .neq('review_status', 'excluded')
        .gt('client_charge_amount', 0)
        .order('line_no'),
      'line_no',
    )
    vagueReimbursements = rows.filter(r => !reimbursementDetailOk(r.review_note))
  } catch (e) {
    res.status(500).json({ error: 'Failed to check reimbursement detail', detail: e instanceof Error ? e.message : String(e) })
    return
  }
  if (vagueReimbursements.length > 0) {
    res.status(400).json({
      error: `Cannot approve: ${vagueReimbursements.length} reimbursement / trip fee / mailed-item line(s) don't say what they were for. ${describeLines(vagueReimbursements)} In the review note, write what was shipped/delivered, for which guest or reservation (or "owner request"), and paste the Slack or Quo link.`,
      blocking_lines: vagueReimbursements,
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
