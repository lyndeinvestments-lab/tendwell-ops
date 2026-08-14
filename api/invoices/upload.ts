import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHash } from 'node:crypto'
import Papa from 'papaparse'
import { extractDateFromText, round2, type RawLine } from './_engine.js'
import { getServiceClient, readRawBody, reconcileRun, requireAdminBearer } from './_lib.js'

// POST /api/invoices/upload
//
// Ingests a vendor invoice as CSV. Body options:
//   application/json → { vendor_id, csv, invoice_number?, invoice_date?,
//                        period_start?, period_end?, stated_subtotal? }
//   text/csv         → raw CSV body; vendor_id etc. via query params
//
// Tolerant column mapping (vendor exports vary):
//   property: Property | Item Name | Name | Cabin | Description
//   note:     Note(s) | Memo | Details  (or embedded as line 2+ of the
//             property cell — Busy Bee's export puts the note under the name)
//   amount:   Total | Amount | Line Total  (falls back to Quantity × Unit Price)
//   date:     Date | Service Date | Due Date  (or parsed out of the note text)
//
// Nina's date-header-block convention is honored: a $0.00 row whose text is
// just a date (e.g. "7/13/26") sets the service date for the rows after it.
//
// Subtotal hard gate: if a stated subtotal is known (param or a "Subtotal"
// row/line in the file), the line sum must match to the penny or the run is
// stored as review_needed (subtotal_mismatch) and can never be approved until
// re-uploaded or manually resolved.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function pickHeader(headers: string[], candidates: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const c of candidates) {
    const hit = headers.find(h => norm(h) === norm(c))
    if (hit) return hit
  }
  for (const c of candidates) {
    const hit = headers.find(h => norm(h).includes(norm(c)))
    if (hit) return hit
  }
  return null
}

function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  // Accounting-notation credits: "($45.00)" means −45.00 — stripping the
  // parens must not flip a credit into a positive charge.
  const parenNegative = /^\(.*\)$/.test(trimmed)
  const cleaned = trimmed.replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return parenNegative ? -Math.abs(n) : n
}

// A "date header" row: no meaningful amount and the text is just a date.
function asDateHeader(text: string | null, amount: number | null): string | null {
  if (!text) return null
  if (amount != null && Math.abs(amount) > 0.005) return null
  const trimmed = text.trim()
  if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed)) return null
  return extractDateFromText(trimmed)
}

export interface ParsedInvoiceCsv {
  lines: RawLine[]
  detectedSubtotal: number | null
}

// Exported for unit tests.
export function parseVendorCsv(csvText: string): ParsedInvoiceCsv {
  let text = csvText
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  })
  const headers = parsed.meta.fields ?? []
  const propCol = pickHeader(headers, ['Property', 'Item Name', 'Name', 'Cabin', 'Description'])
  const noteCol = pickHeader(headers, ['Note', 'Notes', 'Memo', 'Details', 'Comments'])
  const amountCol = pickHeader(headers, ['Total', 'Amount', 'Line Total', 'Total Price'])
  const qtyCol = pickHeader(headers, ['Quantity', 'Qty'])
  const rateCol = pickHeader(headers, ['Unit Price', 'Rate', 'Price'])
  const dateCol = pickHeader(headers, ['Service Date', 'Date', 'Due Date'])
  if (!propCol) throw new Error(`Could not find a property/item column. Headers seen: ${headers.join(', ')}`)
  if (!amountCol && !(qtyCol && rateCol)) {
    throw new Error(`Could not find an amount column (Total/Amount) or Quantity+Unit Price. Headers seen: ${headers.join(', ')}`)
  }

  const lines: RawLine[] = []
  let detectedSubtotal: number | null = null
  let currentDate: string | null = null
  let lineNo = 0

  for (const row of parsed.data) {
    const propRaw = (row[propCol] ?? '').trim()
    let amount = amountCol ? parseAmount(row[amountCol]) : null
    if (amount == null && qtyCol && rateCol) {
      const qty = parseAmount(row[qtyCol])
      const rate = parseAmount(row[rateCol])
      // Multiply in integer cents — round2(0.25 * 8.54) lands on 2.13 instead
      // of the penny-exact 2.14 that vendor software produces, tripping the
      // subtotal gate for no real reason.
      if (qty != null && rate != null) amount = Math.round(qty * Math.round(rate * 100)) / 100
    }

    // Subtotal/total footer rows → capture, never ingest as a line.
    if (/^(sub)?total\b/i.test(propRaw)) {
      if (amount != null) detectedSubtotal = amount
      continue
    }

    // Date-header block rows set the running service date.
    const headerDate = asDateHeader(propRaw, amount)
    if (headerDate) {
      currentDate = headerDate
      continue
    }

    if (!propRaw && amount == null) continue
    if (amount == null) continue // text-only row with no charge — not a line item

    // Busy Bee-style exports put the note on line 2+ of the item-name cell.
    let propertyText = propRaw
    let noteText = noteCol ? (row[noteCol] ?? '').trim() || null : null
    const nl = propRaw.indexOf('\n')
    if (nl >= 0) {
      propertyText = propRaw.slice(0, nl).trim()
      const embedded = propRaw.slice(nl + 1).replace(/\s+/g, ' ').trim()
      noteText = noteText ? `${embedded} ${noteText}` : embedded || null
    }

    const explicitDate = dateCol ? extractDateFromText(row[dateCol] ?? null) ?? ((row[dateCol] ?? '').match(/^\d{4}-\d{2}-\d{2}$/) ? row[dateCol] : null) : null

    lines.push({
      lineNo: ++lineNo,
      source: 'vendor',
      rawPropertyText: propertyText || null,
      rawNoteText: noteText,
      rawAmount: round2(amount),
      rawDateMentioned: explicitDate ?? extractDateFromText(noteText) ?? currentDate,
    })
  }

  return { lines, detectedSubtotal }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const admin = await requireAdminBearer(req, res)
  if (!admin) return

  // Body / params
  let csvText: string
  let params: Record<string, unknown>
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && typeof (req.body as any).csv === 'string') {
    csvText = (req.body as any).csv
    params = req.body as Record<string, unknown>
  } else {
    try {
      csvText = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : await readRawBody(req as unknown as AsyncIterable<Buffer>)
    } catch (e) {
      res.status(400).json({ error: 'Failed to read request body', detail: e instanceof Error ? e.message : String(e) })
      return
    }
    params = req.query as Record<string, unknown>
  }
  if (!csvText || !csvText.trim()) {
    res.status(400).json({ error: 'Empty CSV body' })
    return
  }

  const vendorId = typeof params.vendor_id === 'string' ? params.vendor_id : null
  if (!vendorId) {
    res.status(400).json({ error: 'vendor_id is required' })
    return
  }

  const supabase = getServiceClient()
  if (!supabase) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return
  }

  try {
    const { lines, detectedSubtotal } = parseVendorCsv(csvText)
    if (lines.length === 0) {
      res.status(400).json({ error: 'No line items parsed from CSV' })
      return
    }

    const statedParam = parseFloat(String(params.stated_subtotal ?? ''))
    const statedSubtotal = Number.isFinite(statedParam) ? round2(statedParam) : detectedSubtotal
    const invoiceNumber = typeof params.invoice_number === 'string' ? params.invoice_number : null
    const invoiceDate = typeof params.invoice_date === 'string' && ISO_DATE.test(params.invoice_date) ? params.invoice_date : null

    const lineDates = lines.map(l => l.rawDateMentioned).filter((d): d is string => d != null).sort()
    const periodStart =
      typeof params.period_start === 'string' && ISO_DATE.test(params.period_start)
        ? params.period_start
        : lineDates[0] ?? invoiceDate ?? new Date().toISOString().slice(0, 10)
    const periodEnd =
      typeof params.period_end === 'string' && ISO_DATE.test(params.period_end)
        ? params.period_end
        : lineDates[lineDates.length - 1] ?? invoiceDate ?? periodStart

    const sha256 = createHash('sha256').update(csvText).digest('hex')
    const { data: run, error: runErr } = await supabase
      .from('invoice_runs')
      .insert({
        vendor_id: vendorId,
        source: 'vendor_csv',
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate ?? periodEnd,
        period_start: periodStart,
        period_end: periodEnd,
        stated_subtotal: statedSubtotal,
        status: 'ingested',
        source_file_sha256: sha256,
        created_by: admin.email,
      })
      .select('id')
      .single()
    if (runErr || !run) throw new Error(`Failed to create run: ${runErr?.message}`)

    // Archive the original file for audit (best-effort — a storage hiccup
    // shouldn't fail the ingest; the sha256 is already recorded).
    const filePath = `${run.id}/source.csv`
    const uploadRes = await supabase.storage
      .from('vendor-invoices')
      .upload(filePath, Buffer.from(csvText, 'utf8'), { contentType: 'text/csv', upsert: true })
    if (!uploadRes.error) {
      await supabase.from('invoice_runs').update({ source_file_path: filePath }).eq('id', run.id)
    }

    const inserts = lines.map(l => ({
      run_id: run.id,
      line_no: l.lineNo,
      source: 'vendor',
      raw_property_text: l.rawPropertyText,
      raw_note_text: l.rawNoteText,
      raw_amount: l.rawAmount,
      raw_date_mentioned: l.rawDateMentioned,
      line_kind: 'clean',
      flags: [],
      review_status: 'ok',
    }))
    const { error: insErr } = await supabase.from('invoice_lines').insert(inserts)
    if (insErr) throw new Error(`Failed to insert lines: ${insErr.message}`)

    const result = await reconcileRun(supabase, run.id)
    const sum = result.summary.totalInvoiced
    const gate = statedSubtotal == null ? null : Math.abs(sum - statedSubtotal) <= 0.005

    res.status(200).json({
      ok: true,
      run_id: run.id,
      status: result.status,
      summary: result.summary,
      subtotal_gate: gate == null ? 'no_stated_subtotal' : gate ? 'passed' : 'FAILED',
      stated_subtotal: statedSubtotal,
      computed_subtotal: sum,
    })
  } catch (e) {
    res.status(500).json({ error: 'Upload failed', detail: e instanceof Error ? e.message : String(e) })
  }
}
