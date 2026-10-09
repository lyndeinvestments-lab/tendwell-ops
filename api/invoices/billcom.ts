import type { VercelRequest, VercelResponse } from '@vercel/node'
import { fetchAllRows, getServiceClient, requireInvoicingBearer } from './_lib.js'
import {
  canTransition,
  clientInvoiceKey,
  groupBillComInvoices,
  isMissingSchemaError,
  lineServiceMonth,
  parseBillComAction,
  runAllowsSendControl,
  type BillComLineInput,
  type ClientInvoiceStatus,
} from '../../shared/billcom-send.js'

// POST /api/invoices/billcom
//   { action: 'hold_line',  run_id, line_no, reason }        reason blank → release
//   { action: 'set_status', run_id, contact_id, service_month, status: 'held'|'approved', hold_reason? }
//   { action: 'mark_sent',  run_id, contact_id, service_month, billcom_invoice_number }
//
// bill.com send control: bookkeeping only. bill.com has no import and this
// never calls bill.com; a human enters the invoice there, then records it
// here so the worksheet stops listing it. One client invoice = one client's
// bill.com lines on this run for one service month (shared/billcom-send.ts).
// Only approved/exported runs: reconcile refuses those, so a hold can never be
// wiped by a rebuild. "sent" is final (also enforced by a DB trigger).

const NOT_SET_UP = 'bill.com send control is not set up yet (database migration 20261009c pending)'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const actor = await requireInvoicingBearer(req, res)
  if (!actor) return

  const parsed = parseBillComAction(req.body)
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error })
    return
  }
  const a = parsed.value
  const supabase = getServiceClient()
  if (!supabase) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return
  }
  const who = actor.label || actor.email

  const { data: run, error: runErr } = await supabase
    .from('invoice_runs')
    .select('id, status, invoice_date')
    .eq('id', a.runId)
    .maybeSingle()
  if (runErr || !run) {
    res.status(404).json({ error: 'Run not found' })
    return
  }
  if (!runAllowsSendControl(run.status)) {
    res.status(409).json({ error: `Run is ${run.status}: approve it before sending client invoices to bill.com` })
    return
  }

  let rows: Array<Record<string, any>>
  try {
    rows = await fetchAllRows<Record<string, any>>(
      'invoice_lines',
      () => supabase
        .from('invoice_lines')
        .select('id, line_no, line_kind, review_status, billing_channel, client_charge_amount, service_date, raw_date_mentioned, bill_hold_reason, properties(contact_id, contacts:contact_id(full_name, company))')
        .eq('run_id', a.runId)
        .order('line_no'),
      'line_no',
    )
  } catch (e) {
    if (isMissingSchemaError(e)) {
      res.status(503).json({ error: NOT_SET_UP })
      return
    }
    res.status(500).json({ error: 'Failed to load lines', detail: e instanceof Error ? e.message : String(e) })
    return
  }

  const { data: ciRows, error: ciErr } = await supabase
    .from('client_invoices')
    .select('*')
    .eq('run_id', a.runId)
    .eq('billing_channel', 'bill_com')
  if (ciErr) {
    const missing = isMissingSchemaError(ciErr)
    res.status(missing ? 503 : 500).json({ error: missing ? NOT_SET_UP : 'Failed to load client invoices', detail: ciErr.message })
    return
  }
  const existing = new Map((ciRows ?? []).map(r => [clientInvoiceKey(r.contact_id, r.service_month), r]))

  const toInput = (r: Record<string, any>): BillComLineInput => {
    const prop = Array.isArray(r.properties) ? r.properties[0] : r.properties
    const contact = prop ? (Array.isArray(prop.contacts) ? prop.contacts[0] : prop.contacts) : null
    return {
      lineNo: Number(r.line_no),
      lineKind: r.line_kind,
      reviewStatus: r.review_status,
      billingChannel: r.billing_channel,
      clientChargeAmount: r.client_charge_amount != null ? Number(r.client_charge_amount) : null,
      serviceDate: r.service_date ?? r.raw_date_mentioned ?? null,
      contactId: prop?.contact_id ?? null,
      clientName: contact?.full_name ?? contact?.company ?? null,
      billHoldReason: r.bill_hold_reason ?? null,
    }
  }
  const inputs = rows.map(toInput)

  // ── hold / release one vendor line ────────────────────────────────────────
  if (a.action === 'hold_line') {
    const lineInputs = inputs.filter(l => l.lineNo === a.lineNo)
    if (lineInputs.length === 0) {
      res.status(404).json({ error: `Line ${a.lineNo} is not on this run` })
      return
    }
    // The client invoice(s) this line belongs to: a sent one is closed.
    const keys = new Set(lineInputs.map(l => clientInvoiceKey(l.contactId, lineServiceMonth(l.serviceDate, run.invoice_date))))
    const sent = Array.from(keys).map(k => existing.get(k)).find(r => r?.status === 'sent')
    if (sent) {
      res.status(409).json({ error: `This line's client invoice was already sent to bill.com as ${sent.billcom_invoice_number}` })
      return
    }
    // Every row of the vendor line (split rows share line_no) gets the hold.
    const { error: updErr } = await supabase
      .from('invoice_lines')
      .update({ bill_hold_reason: a.reason })
      .eq('run_id', a.runId)
      .eq('line_no', a.lineNo)
    if (updErr) {
      const missing = isMissingSchemaError(updErr)
      res.status(missing ? 503 : 500).json({ error: missing ? NOT_SET_UP : 'Failed to update the line', detail: updErr.message })
      return
    }
    // Keep a stored (not yet sent) invoice's total in step with its lines.
    const after = groupBillComInvoices(inputs.map(l => (l.lineNo === a.lineNo ? { ...l, billHoldReason: a.reason } : l)), run.invoice_date)
    for (const g of after) {
      const row = keys.has(g.key) ? existing.get(g.key) : undefined
      if (row && row.status !== 'sent') {
        await supabase.from('client_invoices').update({ total: g.total, updated_by: who }).eq('id', row.id).neq('status', 'sent')
      }
    }
    res.status(200).json({ ok: true, line_no: a.lineNo, bill_hold_reason: a.reason })
    return
  }

  // ── client invoice status ─────────────────────────────────────────────────
  const group = groupBillComInvoices(inputs, run.invoice_date).find(g => g.key === clientInvoiceKey(a.contactId, a.serviceMonth))
  if (!group) {
    res.status(404).json({ error: 'No bill.com lines for this client and month on this run' })
    return
  }
  const row = existing.get(group.key)
  const from = (row?.status ?? 'held') as ClientInvoiceStatus
  const to: ClientInvoiceStatus = a.action === 'mark_sent' ? 'sent' : a.status

  if (from === 'sent') {
    res.status(409).json({ error: `Already sent to bill.com as ${row?.billcom_invoice_number}` })
    return
  }
  if (a.action === 'set_status' && from === to) {
    // Idempotent re-click; a changed hold reason is still saved.
    if (row && to === 'held' && a.holdReason !== row.hold_reason) {
      await supabase.from('client_invoices').update({ hold_reason: a.holdReason, updated_by: who }).eq('id', row.id).eq('status', 'held')
    }
    res.status(200).json({ ok: true, status: to })
    return
  }
  if (!canTransition(from, to)) {
    res.status(409).json({ error: to === 'sent' ? 'Approve this client invoice before marking it sent' : `Cannot move a ${from} invoice to ${to}` })
    return
  }
  if (to !== 'held' && group.total <= 0) {
    res.status(409).json({ error: 'Every line on this client invoice is held; release a line first' })
    return
  }

  const patch: Record<string, unknown> = {
    status: to,
    total: group.total,
    updated_by: who,
    hold_reason: a.action === 'set_status' && to === 'held' ? a.holdReason : null,
  }
  if (a.action === 'mark_sent') {
    patch.billcom_invoice_number = a.billcomInvoiceNumber
    patch.sent_at = new Date().toISOString()
    patch.sent_by = who
  }

  if (row) {
    // Conditional on the status we read, so two people clicking at once
    // cannot both win (e.g. one holding while the other marks it sent).
    const { data: upd, error: updErr } = await supabase
      .from('client_invoices')
      .update(patch)
      .eq('id', row.id)
      .eq('status', from)
      .select('*')
    if (updErr) {
      res.status(500).json({ error: 'Failed to update the client invoice', detail: updErr.message })
      return
    }
    if (!upd || upd.length === 0) {
      res.status(409).json({ error: 'This client invoice changed meanwhile; refresh and try again' })
      return
    }
    res.status(200).json({ ok: true, client_invoice: upd[0] })
    return
  }

  // No row yet (implicitly held). mark_sent never gets here: held → sent is
  // refused above.
  const { data: ins, error: insErr } = await supabase
    .from('client_invoices')
    .insert({ run_id: a.runId, contact_id: a.contactId, billing_channel: 'bill_com', service_month: a.serviceMonth, ...patch })
    .select('*')
  if (insErr) {
    if (insErr.code === '23505') {
      res.status(409).json({ error: 'This client invoice changed meanwhile; refresh and try again' })
      return
    }
    res.status(500).json({ error: 'Failed to save the client invoice', detail: insErr.message })
    return
  }
  res.status(200).json({ ok: true, client_invoice: ins?.[0] ?? null })
}
