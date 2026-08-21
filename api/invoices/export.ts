import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { BillingChannel, LineKind } from './_engine.js'
import { toBillComCsv, toQboFlatCsv, toQboMultilineCsv, toRampCsv, type ExportLine, type ExportRun } from './_exporters.js'
import { fetchAllRows, getServiceClient, requireInvoicingBearer } from './_lib.js'

// GET /api/invoices/export?run_id=<uuid>&format=ramp|qbo_flat|qbo_multiline|billcom
//                          [&preview=1]
//
// Only approved (or already-exported) runs can export — the review gate is
// enforced by approve.ts. First QBO export assigns the run its sequential AR
// invoice number from app_settings.invoicing_qbo_next_number.
//
// `preview=1` returns the same CSV as JSON (`{ csv, ... }`) with NO side
// effects, so a run can be inspected mid-reconciliation:
//   * any status is previewable — the point is seeing the file BEFORE approving
//   * no invoice number is allocated (next_qbo_invoice_no is never called);
//     an unassigned number renders as a blank cell and is reported as
//     `invoice_number_pending`
//   * the run's status is not advanced to 'exported'
// It deliberately runs the identical line-load + exporter path as the real
// download, so preview bytes are the download bytes — a preview that could
// drift from the file it predicts would be worse than none.

const FORMATS = ['ramp', 'qbo_flat', 'qbo_multiline', 'billcom'] as const
type Format = (typeof FORMATS)[number]

// Atomic single-statement increment (public.next_qbo_invoice_no) — a plain
// read-then-update here could hand two concurrent exports the same number.
async function nextQboInvoiceNo(supabase: NonNullable<ReturnType<typeof getServiceClient>>): Promise<number> {
  const { data, error } = await supabase.rpc('next_qbo_invoice_no')
  if (error || data == null) throw new Error(`Failed to allocate QBO invoice number: ${error?.message ?? 'no row'}`)
  return Number(data)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const actor = await requireInvoicingBearer(req, res)
  if (!actor) return

  const runId = typeof req.query.run_id === 'string' ? req.query.run_id : null
  const format = typeof req.query.format === 'string' ? (req.query.format as Format) : null
  const previewRaw = typeof req.query.preview === 'string' ? req.query.preview.toLowerCase() : ''
  const preview = previewRaw === '1' || previewRaw === 'true'
  if (!runId || !format || !FORMATS.includes(format)) {
    res.status(400).json({ error: `run_id and format (${FORMATS.join('|')}) are required` })
    return
  }
  const supabase = getServiceClient()
  if (!supabase) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return
  }

  const { data: run, error: runErr } = await supabase
    .from('invoice_runs')
    .select('id, status, vendor_id, invoice_number, invoice_date, period_end, qbo_invoice_no, vendors(name)')
    .eq('id', runId)
    .single()
  if (runErr || !run) {
    res.status(404).json({ error: 'Run not found' })
    return
  }
  if (!preview && run.status !== 'approved' && run.status !== 'exported') {
    res.status(400).json({ error: `Run must be approved before export (status: ${run.status})` })
    return
  }

  // Paged: PostgREST caps a response at 1000 rows, and a silently truncated
  // export is the worst failure here — a CSV that looks complete while
  // under-billing the client and under-paying the cleaner.
  let lineRows: Array<Record<string, any>>
  try {
    lineRows = await fetchAllRows<Record<string, any>>(
      'invoice_lines',
      () => supabase
        .from('invoice_lines')
        .select('line_kind, service_type, raw_date_mentioned, raw_note_text, review_note, review_status, cleaner_pay_amount, client_charge_amount, billing_channel, property_id, split_group, properties(name, contacts:contact_id(full_name, company))')
        .eq('run_id', runId)
        .order('line_no'),
      'line_no',
    )
  } catch (e) {
    res.status(500).json({ error: 'Failed to load lines', detail: e instanceof Error ? e.message : String(e) })
    return
  }

  // Assign our sequential QBO invoice number on first QBO export.
  let qboInvoiceNo = run.qbo_invoice_no as number | null
  // Never allocate on preview: the counter is shared with live QBO (Nina's
  // real numbering), so peeking at the file would burn AR invoice numbers and
  // leave gaps in the sequence.
  if (!preview && (format === 'qbo_flat' || format === 'qbo_multiline') && qboInvoiceNo == null) {
    try {
      qboInvoiceNo = await nextQboInvoiceNo(supabase)
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
      return
    }
    await supabase.from('invoice_runs').update({ qbo_invoice_no: qboInvoiceNo }).eq('id', runId)
  }

  const vendorRel = (run as unknown as { vendors: { name: string } | Array<{ name: string }> | null }).vendors
  const vendorName = Array.isArray(vendorRel) ? vendorRel[0]?.name ?? 'Vendor' : vendorRel?.name ?? 'Vendor'

  const exportRun: ExportRun = {
    vendorName,
    vendorInvoiceNumber: run.invoice_number,
    invoiceDate: run.invoice_date,
    dueDate: run.invoice_date, // Due On Receipt
    qboInvoiceNo,
    periodEnd: run.period_end,
  }

  const lines: ExportLine[] = ((lineRows ?? []) as Array<Record<string, any>>).map(r => {
    const prop = Array.isArray(r.properties) ? r.properties[0] : r.properties
    const contact = prop ? (Array.isArray(prop.contacts) ? prop.contacts[0] : prop.contacts) : null
    return {
      lineKind: r.line_kind as LineKind,
      serviceType: r.service_type,
      serviceDate: r.raw_date_mentioned,
      propertyName: prop?.name ?? null,
      propertyId: r.property_id != null ? Number(r.property_id) : null,
      clientName: contact?.full_name ?? contact?.company ?? null,
      billingChannel: r.billing_channel as BillingChannel | null,
      cleanerPayAmount: r.cleaner_pay_amount != null ? Number(r.cleaner_pay_amount) : null,
      clientChargeAmount: r.client_charge_amount != null ? Number(r.client_charge_amount) : null,
      note: r.raw_note_text,
      reviewNote: r.review_note,
      reviewStatus: r.review_status,
      splitGroup: r.split_group != null ? Number(r.split_group) : null,
    }
  })

  // Known QBO classes (nightly qbo-classes-sync snapshot) with any manual
  // property links from the API Sync → QuickBooks tab. Empty/absent →
  // undefined, which keeps the legacy behavior (property name as Class).
  let knownClasses: Array<{ name: string; matchedPropertyId: number | null }> | undefined
  if (format === 'ramp' || format === 'qbo_flat') {
    const { data: classRows } = await supabase.from('qbo_classes').select('name, matched_property_id').eq('active', true)
    if (classRows && classRows.length > 0) {
      knownClasses = classRows.map(r => ({
        name: r.name as string,
        matchedPropertyId: r.matched_property_id != null ? Number(r.matched_property_id) : null,
      }))
    }
  }

  const csv =
    format === 'ramp' ? toRampCsv(exportRun, lines, knownClasses)
    : format === 'qbo_flat' ? toQboFlatCsv(exportRun, lines, knownClasses)
    : format === 'qbo_multiline' ? toQboMultilineCsv(exportRun, lines)
    : toBillComCsv(exportRun, lines)

  if (preview) {
    res.status(200).json({
      ok: true,
      format,
      run_status: run.status,
      csv,
      line_count: lines.length,
      qbo_invoice_no: qboInvoiceNo,
      // True when this format prints an invoice number and the run hasn't been
      // assigned one yet — the real export will fill that blank cell in.
      invoice_number_pending:
        (format === 'qbo_flat' || format === 'qbo_multiline') && qboInvoiceNo == null,
    })
    return
  }

  if (run.status !== 'exported') {
    await supabase.from('invoice_runs').update({ status: 'exported' }).eq('id', runId)
  }

  const stamp = (run.invoice_date ?? new Date().toISOString().slice(0, 10)).replace(/-/g, '')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${format}-${stamp}-${runId.slice(0, 8)}.csv"`)
  res.status(200).send(csv)
}
