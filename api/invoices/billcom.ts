import type { VercelRequest, VercelResponse } from '@vercel/node'
import { fetchAllRows, getServiceClient, requireInvoicingBearer } from './_lib.js'
import { isCreditLine } from './_credits.js'
import {
  canTransition,
  clientInvoiceKey,
  creditClientsByLine,
  groupBillComInvoices,
  isBillComArLine,
  isMissingSchemaError,
  lineClient,
  lineServiceMonth,
  parseBillComAction,
  runAllowsSendControl,
  type BillComLineInput,
  type ClientInvoiceStatus,
  type CreditClient,
} from '../../shared/billcom-send.js'
import {
  isMissingFunctionError,
  parseMarkSentExtras,
  preSendExceptions,
  registerPeriod,
  sendableTotal,
  type PreSendException,
  type PreSendLine,
} from '../../shared/sent-invoice-register.js'

// POST /api/invoices/billcom
//   { action: 'hold_line',  run_id, line_no, reason }        reason blank → release
//   { action: 'set_status', run_id, contact_id, service_month, status: 'held'|'approved', hold_reason? }
//   { action: 'mark_sent',  run_id, contact_id, service_month, billcom_invoice_number,
//     recipient?, pdf_sha256?, total? }
//   { action: 'presend_check', run_id, contact_id, service_month, billcom_invoice_number? }
//
// Sent-invoices register (20261009h): mark_sent runs the pre-send check and
// records the register row in ONE transaction (client_invoice_mark_sent), and
// is refused with the list of exceptions unless that list is empty.
// presend_check returns the same list (plus the default recipient and the
// period the register will record) for the Mark sent dialog. Until 20261009h
// is applied, mark_sent behaves exactly as before and presend_check reports
// register_available: false. Only the SHA-256 of the bill.com PDF is ever
// received; the PDF itself is never uploaded.
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
  const extras = parseMarkSentExtras(req.body)
  if (a.action === 'mark_sent' && !extras.ok) {
    res.status(400).json({ error: extras.error })
    return
  }
  const supabase = getServiceClient()
  if (!supabase) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return
  }
  const who = actor.label || actor.email

  const { data: run, error: runErr } = await supabase
    .from('invoice_runs')
    .select('id, status, invoice_date, period_start, period_end, archived_at, source')
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
        .select('id, line_no, line_kind, review_status, review_note, flags, billing_channel, client_charge_amount, service_date, raw_date_mentioned, bill_hold_reason, properties(contact_id, contacts:contact_id(full_name, company))')
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
  const existing = new Map((ciRows ?? []).filter(r => !!r.contact_id).map(r => [clientInvoiceKey(r.contact_id, r.service_month), r]))

  // A client credit bills the client on its adjustment (it usually has no
  // property), so it joins and nets that client's invoice, same as the
  // worksheet. Table missing (20261009a pending) → no credits, as before.
  let creditClients: Map<string, CreditClient> = new Map()
  const creditLineIds = rows.filter(r => isCreditLine(r)).map(r => String(r.id))
  if (creditLineIds.length > 0) {
    const { data: adjRows, error: adjErr } = await supabase
      .from('invoice_adjustments')
      .select('applied_line_id, contact_id, contacts:contact_id(full_name, company)')
      .in('applied_line_id', creditLineIds)
    if (adjErr && !isMissingSchemaError(adjErr)) {
      res.status(500).json({ error: 'Failed to load client credits', detail: adjErr.message })
      return
    }
    creditClients = creditClientsByLine(adjRows)
  }

  const toInput = (r: Record<string, any>): BillComLineInput => {
    const prop = Array.isArray(r.properties) ? r.properties[0] : r.properties
    const contact = prop ? (Array.isArray(prop.contacts) ? prop.contacts[0] : prop.contacts) : null
    const client = lineClient({
      id: r.id != null ? String(r.id) : null,
      propertyContactId: prop?.contact_id ?? null,
      propertyClientName: contact?.full_name ?? contact?.company ?? null,
    }, creditClients)
    return {
      lineNo: Number(r.line_no),
      lineKind: r.line_kind,
      reviewStatus: r.review_status,
      billingChannel: r.billing_channel,
      clientChargeAmount: r.client_charge_amount != null ? Number(r.client_charge_amount) : null,
      serviceDate: r.service_date ?? r.raw_date_mentioned ?? null,
      contactId: client.contactId,
      clientName: client.clientName,
      billHoldReason: r.bill_hold_reason ?? null,
    }
  }
  const inputs = rows.map(toInput)
  const toPreSend = (r: Record<string, any>): PreSendLine => ({
    lineNo: Number(r.line_no),
    reviewStatus: r.review_status,
    billHoldReason: r.bill_hold_reason ?? null,
    flags: Array.isArray(r.flags) ? r.flags : [],
    reviewNote: r.review_note ?? null,
    serviceDate: r.service_date ?? r.raw_date_mentioned ?? null,
    clientChargeAmount: r.client_charge_amount != null ? Number(r.client_charge_amount) : null,
  })

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

  // ── pre-send check (read only) ────────────────────────────────────────────
  if (a.action === 'presend_check') {
    // Every row of this client invoice, held ones included (same membership
    // as groupBillComInvoices and the SQL function).
    const groupLines = rows
      .filter((r, i) => {
        const l = inputs[i]
        return isBillComArLine(l) && l.contactId === a.contactId && lineServiceMonth(l.serviceDate, run.invoice_date) === a.serviceMonth
      })
      .map(toPreSend)
    // The register lookup doubles as the "is 20261009h applied" probe. With no
    // number yet it matches nothing (the column refuses blanks).
    const { data: regRows, error: regErr } = await supabase
      .from('sent_invoices')
      .select('client_name, sent_at')
      .eq('billing_channel', 'bill_com')
      .eq('invoice_number', a.billcomInvoiceNumber ?? '')
      .is('voids_id', null)
      .limit(1)
    if (regErr && !isMissingSchemaError(regErr)) {
      res.status(500).json({ error: 'Failed to read the sent-invoices register', detail: regErr.message })
      return
    }
    const { data: contact } = await supabase.from('contacts').select('email').eq('id', a.contactId).maybeSingle()
    const exceptions: PreSendException[] = preSendExceptions({
      run: { status: run.status, archivedAt: run.archived_at },
      invoice: { status: (row?.status ?? null) as ClientInvoiceStatus | null, serviceMonth: a.serviceMonth },
      lines: groupLines,
      registered: regRows?.[0] ? { clientName: regRows[0].client_name, sentAt: regRows[0].sent_at } : null,
    })
    res.status(200).json({
      ok: true,
      register_available: !regErr,
      exceptions,
      total: sendableTotal(groupLines),
      period: registerPeriod(a.serviceMonth, run.period_start, run.period_end, groupLines.map(l => l.serviceDate)),
      recipient_default: contact?.email?.trim() || null,
      run_source: run.source,
    })
    return
  }

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

  // mark_sent with the register (20261009h): pre-send check, status change
  // and register row in one transaction. Refused with the exceptions unless
  // there are none. Falls through to the plain update below only when the
  // function is not there yet (migration pending).
  if (a.action === 'mark_sent' && row && extras.ok) {
    const args: { p_client_invoice_id: string; p_number: string; p_actor: string; p_recipient?: string; p_pdf_sha256?: string; p_total?: number } = {
      p_client_invoice_id: row.id,
      p_number: a.billcomInvoiceNumber,
      p_actor: who,
    }
    if (extras.value.recipient) args.p_recipient = extras.value.recipient
    if (extras.value.pdfSha256) args.p_pdf_sha256 = extras.value.pdfSha256
    if (extras.value.confirmedTotal != null) args.p_total = extras.value.confirmedTotal
    const { data: result, error: rpcErr } = await supabase.rpc('client_invoice_mark_sent', args)
    if (rpcErr && !isMissingFunctionError(rpcErr)) {
      if (rpcErr.code === '23505') {
        res.status(409).json({ error: 'This invoice number was already recorded as sent; refresh and check the register' })
        return
      }
      res.status(500).json({ error: 'Failed to mark the client invoice sent', detail: rpcErr.message })
      return
    }
    if (!rpcErr) {
      const out = (result ?? {}) as { ok?: boolean; exceptions?: unknown; client_invoice?: unknown; sent_invoice?: unknown }
      if (!out.ok) {
        res.status(409).json({ error: 'Pre-send check failed: fix these before marking it sent', exceptions: out.exceptions ?? [] })
        return
      }
      res.status(200).json({ ok: true, client_invoice: out.client_invoice ?? null, sent_invoice: out.sent_invoice ?? null })
      return
    }
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
