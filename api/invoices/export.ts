import type { VercelRequest, VercelResponse } from '@vercel/node'
import { monthsOf, toBillComCsv, toQboFlatCsv, toQboMultilineCsv, toRampCsv, type ExportLine, type ExportRun } from './_exporters.js'
import { getServiceClient, requireInvoicingBearer } from './_lib.js'
import { loadExportLines } from './_export-lines.js'
import { isMissingSchemaError, type ClientInvoiceState, type ClientInvoiceStatus } from '../../shared/billcom-send.js'
import { allocateClearNumber, docNumberTaken, qboConnection, raiseCounterToQbo } from './_qbo-numbers.js'

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
    .select('id, status, vendor_id, invoice_number, invoice_date, period_end, qbo_invoice_no, qbo_invoice_nos, vendors(name)')
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

  let lines: ExportLine[]
  // bill.com send control needs invoice_lines.bill_hold_reason and the
  // client_invoices table (20261009c). Until that migration is applied both
  // are missing, and the export behaves exactly as it did before.
  let sendControl: boolean
  try {
    ({ lines, sendControl } = await loadExportLines(supabase, runId))
  } catch (e) {
    res.status(500).json({ error: 'Failed to load lines', detail: e instanceof Error ? e.message : String(e) })
    return
  }

  let billComInvoices: ClientInvoiceState[] | null = null
  if (sendControl && format === 'billcom') {
    const { data: ciRows, error: ciErr } = await supabase
      .from('client_invoices')
      .select('contact_id, service_month, status, billcom_invoice_number')
      .eq('run_id', runId)
      .eq('billing_channel', 'bill_com')
    if (ciErr && !isMissingSchemaError(ciErr)) {
      res.status(500).json({ error: 'Failed to load client invoices', detail: ciErr.message })
      return
    }
    if (!ciErr) {
      billComInvoices = (ciRows ?? []).map(r => ({
        contactId: r.contact_id != null ? String(r.contact_id) : null,
        serviceMonth: String(r.service_month),
        status: r.status as ClientInvoiceStatus,
        billcomInvoiceNumber: r.billcom_invoice_number ?? null,
      }))
    }
  }

  const vendorRel = (run as unknown as { vendors: { name: string } | Array<{ name: string }> | null }).vendors
  const vendorName = Array.isArray(vendorRel) ? vendorRel[0]?.name ?? 'Vendor' : vendorRel?.name ?? 'Vendor'

  // One QBO invoice number per SERVICE MONTH of the Haven lines (Haven books
  // by month and rejected 1096 for mixing Sept + Oct). Numbers already
  // assigned are kept; missing months are allocated on the first real QBO
  // export only — never on preview, the counter is shared with live QBO.
  const qboMonths = monthsOf(
    lines.filter(l => l.billingChannel === 'qbo_haven' && l.lineKind !== 'excluded' && l.reviewStatus !== 'excluded' &&
      l.lineKind !== 'operating_expense' && l.clientChargeAmount != null && l.clientChargeAmount !== 0),
    run.invoice_date,
  )
  const qboInvoiceNos: Record<string, number> = { ...((run.qbo_invoice_nos as Record<string, number> | null) ?? {}) }
  let qboInvoiceNo = run.qbo_invoice_no as number | null
  // A run numbered before the month split keeps its number for its first month.
  if (qboInvoiceNo != null && qboMonths.length > 0 && !Object.values(qboInvoiceNos).includes(qboInvoiceNo) && qboInvoiceNos[qboMonths[0]] == null) {
    qboInvoiceNos[qboMonths[0]] = qboInvoiceNo
  }
  const missing = qboMonths.filter(m => qboInvoiceNos[m] == null)
  if (!preview && (format === 'qbo_flat' || format === 'qbo_multiline') && missing.length > 0) {
    // Ask QuickBooks first (_qbo-numbers.ts): move our counter past Haven's
    // highest invoice there, and skip any number QuickBooks already has.
    // QuickBooks unreachable → our counter alone, as before.
    let qbo: Awaited<ReturnType<typeof qboConnection>> = null
    try {
      qbo = await qboConnection(supabase)
      if (qbo) await raiseCounterToQbo(supabase, qbo)
    } catch (e) {
      console.warn('QBO invoice numbering: QuickBooks check skipped:', e instanceof Error ? e.message : e)
      qbo = null
    }
    const conn = qbo
    try {
      for (const m of missing) {
        const { number, skipped } = await allocateClearNumber(
          () => nextQboInvoiceNo(supabase),
          conn ? n => docNumberTaken(conn, n) : null,
        )
        if (skipped.length > 0) console.warn(`QBO invoice numbering: skipped ${skipped.join(', ')} (already in QuickBooks)`)
        qboInvoiceNos[m] = number
      }
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
      return
    }
    qboInvoiceNo = qboInvoiceNos[qboMonths[0]] ?? qboInvoiceNo
    await supabase.from('invoice_runs').update({ qbo_invoice_no: qboInvoiceNo, qbo_invoice_nos: qboInvoiceNos }).eq('id', runId)
  }

  const exportRun: ExportRun = {
    vendorName,
    vendorInvoiceNumber: run.invoice_number,
    invoiceDate: run.invoice_date,
    dueDate: run.invoice_date, // Due On Receipt
    qboInvoiceNo,
    qboInvoiceNos,
    periodEnd: run.period_end,
    billComInvoices,
  }

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
      qbo_invoice_nos: qboInvoiceNos,
      // True when this format prints an invoice number and the run hasn't been
      // assigned one yet — the real export will fill that blank cell in.
      invoice_number_pending:
        (format === 'qbo_flat' || format === 'qbo_multiline') && qboMonths.some(m => qboInvoiceNos[m] == null),
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
