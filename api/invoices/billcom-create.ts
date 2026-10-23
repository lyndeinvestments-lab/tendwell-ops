import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient, requireInvoicingBearer } from './_lib.js'
import { loadExportLines } from './_export-lines.js'
import { billComRows } from './_exporters.js'
import { buildBillComDrafts, registerInvoiceNumber, type BillComDraft } from './_billcom-drafts.js'
import { isMissingSchemaError, runAllowsSendControl } from '../../shared/billcom-send.js'
import { BillComError, billComListAll, billComLogin, billComLogout, billComPost, type BillComSession } from '../billcom/_lib.js'

// POST /api/invoices/billcom-create — create an approved client invoice in
// bill.com instead of typing it in. Invoicing edit grant.
//
//   { action: 'preview', run_id, contact_id, service_month }
//       the invoice(s) as they would be created; nothing is sent anywhere
//   { action: 'create', run_id, contact_id, service_month, expected_total, create_customer? }
//       creates them in bill.com (not emailed: Mark sent does that)
//
// The invoice(s) come from the same rows as the bill.com worksheet
// (_billcom-drafts.ts). `expected_total` is the total the person saw in the
// preview; a different total now means the lines changed, so nothing is
// created. A client with no linked bill.com customer gets one created only
// when `create_customer` is true (the preview asks first).
//
// A double click cannot create twice: the request claims the client invoice
// (billcom_created_at) before calling bill.com, and invoices already recorded
// are skipped, so a retry after a partial failure creates only the rest.

const LINE_ITEM_NAME = 'Cleaning Service' // every hand-made client invoice line uses this item
const CLAIM_SECONDS = 120

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const actor = await requireInvoicingBearer(req, res)
  if (!actor) return
  const supabase = getServiceClient()
  if (!supabase) return res.status(503).json({ error: 'Supabase service role not configured' })
  const who = actor.label || actor.email

  const body = (req.body ?? {}) as Record<string, unknown>
  const action = body.action
  const runId = typeof body.run_id === 'string' ? body.run_id : ''
  const contactId = typeof body.contact_id === 'string' ? body.contact_id : ''
  const serviceMonth = typeof body.service_month === 'string' && /^\d{4}-\d{2}$/.test(body.service_month) ? body.service_month : ''
  if ((action !== 'preview' && action !== 'create') || !runId || !contactId || !serviceMonth) {
    return res.status(400).json({ error: 'action (preview|create), run_id, contact_id and service_month are required' })
  }

  const { data: run } = await supabase
    .from('invoice_runs')
    .select('id, status, invoice_number, invoice_date, archived_at')
    .eq('id', runId)
    .maybeSingle()
  if (!run) return res.status(404).json({ error: 'Run not found' })
  if (!runAllowsSendControl(run.status) || run.archived_at) {
    return res.status(409).json({ error: `Run is ${run.archived_at ? 'archived' : run.status}: only approved runs are invoiced` })
  }

  const { data: ci, error: ciErr } = await supabase
    .from('client_invoices')
    .select('id, status, total, billcom_invoices, billcom_created_at')
    .eq('run_id', runId)
    .eq('contact_id', contactId)
    .eq('billing_channel', 'bill_com')
    .eq('service_month', serviceMonth)
    .maybeSingle()
  if (ciErr) {
    const missing = isMissingSchemaError(ciErr)
    return res.status(missing ? 503 : 500).json({ error: missing ? 'Database not ready: apply migration 20261023b_client_invoice_billcom_ids.sql' : 'Failed to load the client invoice' })
  }
  if (!ci || ci.status !== 'approved') {
    return res.status(409).json({ error: ci?.status === 'sent' ? 'This client invoice was already sent' : 'Approve this client invoice first' })
  }

  const { data: contact } = await supabase
    .from('contacts')
    .select('id, full_name, company, email, billcom_customer_id')
    .eq('id', contactId)
    .maybeSingle()
  if (!contact) return res.status(404).json({ error: 'Client not found' })

  let drafts: BillComDraft[]
  try {
    const { lines } = await loadExportLines(supabase, runId)
    const built = buildBillComDrafts({
      vendorInvoiceNumber: run.invoice_number,
      rows: billComRows({ invoiceDate: run.invoice_date }, lines),
      contactId,
      serviceMonth,
      clientName: contact.full_name,
      clientCompany: contact.company,
    })
    if (!built.ok) return res.status(409).json({ error: built.error })
    drafts = built.drafts
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load lines', detail: e instanceof Error ? e.message : String(e) })
  }
  const total = Math.round(drafts.reduce((s, d) => s + d.total, 0) * 100) / 100
  const created: CreatedInvoice[] = Array.isArray(ci.billcom_invoices) ? ci.billcom_invoices : []
  const createdNumbers = new Set(created.map((c) => c.number))

  if (action === 'preview') {
    return res.status(200).json({
      ok: true,
      drafts,
      total,
      register_number: registerInvoiceNumber(drafts),
      client: { name: contact.full_name, company: contact.company, email: contact.email },
      customer_linked: !!contact.billcom_customer_id,
      created,
    })
  }

  // ── create ────────────────────────────────────────────────────────────────
  const expected = Number(body.expected_total)
  if (!Number.isFinite(expected) || Math.abs(expected - total) > 0.005) {
    return res.status(409).json({ error: `The lines changed since the preview (now ${total.toFixed(2)}); review it again` })
  }
  const todo = drafts.filter((d) => !createdNumbers.has(d.invoiceNumber))
  if (todo.length === 0) return res.status(409).json({ error: 'Already created in bill.com', created })
  if (!contact.billcom_customer_id && body.create_customer !== true) {
    return res.status(409).json({ error: 'Link this client to a bill.com customer first, or confirm creating one' })
  }
  if (!contact.billcom_customer_id && !contact.email?.trim()) {
    return res.status(409).json({ error: 'This client has no email in Ops; add one before creating their bill.com customer' })
  }

  // Claim: one creator at a time per client invoice.
  const staleBefore = new Date(Date.now() - CLAIM_SECONDS * 1000).toISOString()
  const { data: claimed } = await supabase
    .from('client_invoices')
    .update({ billcom_created_at: new Date().toISOString(), billcom_created_by: who })
    .eq('id', ci.id)
    .eq('status', 'approved')
    .or(`billcom_created_at.is.null,billcom_created_at.lt.${staleBefore}`)
    .select('id')
  if (!claimed?.length) return res.status(409).json({ error: 'Someone is creating this invoice right now; refresh in a minute' })

  let session: BillComSession | null = null
  try {
    session = await billComLogin()
    let customerId = contact.billcom_customer_id as string | null
    if (!customerId) {
      const customer = await billComPost<{ id: string }>(session, 'customers', {
        name: contact.full_name || contact.company,
        email: contact.email!.trim(),
      })
      customerId = customer.id
      const { error: linkErr } = await supabase.from('contacts').update({ billcom_customer_id: customerId }).eq('id', contactId)
      if (linkErr) throw new Error(`Created bill.com customer ${customerId} but could not link it: ${linkErr.message}`)
      await audit(supabase, contactId, contact.full_name, 'billcom_customer_created', null, customerId, who, { run_id: runId })
    }

    const items = await billComListAll<{ id: string; name: string; archived?: boolean }>(session, 'classifications/items')
    const item = items.find((i) => !i.archived && i.name === LINE_ITEM_NAME)
    if (!item) throw new BillComError(`No "${LINE_ITEM_NAME}" item in bill.com`, 409)

    for (const d of todo) {
      const inv = await billComPost<{ id: string; invoiceNumber: string; totalAmount: number }>(session, 'invoices', {
        customer: { id: customerId },
        invoiceNumber: d.invoiceNumber,
        ...(d.invoiceDate ? { invoiceDate: d.invoiceDate, dueDate: d.invoiceDate } : {}),
        invoiceLineItems: d.lines.map((l) => ({
          description: l.description,
          quantity: 1,
          price: l.amount,
          classifications: { itemId: item.id },
        })),
      })
      created.push({ id: inv.id, number: inv.invoiceNumber ?? d.invoiceNumber, total: Number(inv.totalAmount ?? d.total), property: d.propertyName })
      // Recorded after each one, so a failure part-way never loses an invoice.
      await supabase.from('client_invoices').update({ billcom_invoices: created }).eq('id', ci.id)
    }
    await audit(supabase, contactId, contact.full_name, 'billcom_invoice_created', null, registerInvoiceNumber(drafts), who, {
      run_id: runId, service_month: serviceMonth, total, invoices: created,
    })
    return res.status(200).json({ ok: true, created, register_number: registerInvoiceNumber(drafts) })
  } catch (e) {
    const done = created.length ? ` Created so far: ${created.map((c) => c.number).join(', ')}.` : ''
    if (e instanceof BillComError) return res.status(502).json({ error: `bill.com: ${e.message}.${done}`, code: e.code, created })
    console.error('[invoices/billcom-create]', e)
    return res.status(500).json({ error: `${e instanceof Error ? e.message : 'Unexpected error'}.${done}`, created })
  } finally {
    // Release the claim so a retry can pick up anything left.
    if (created.length < drafts.length) await supabase.from('client_invoices').update({ billcom_created_at: null }).eq('id', ci.id)
    if (session) await billComLogout(session)
  }
}

interface CreatedInvoice { id: string; number: string; total: number; property: string | null }

async function audit(
  supabase: NonNullable<ReturnType<typeof getServiceClient>>,
  contactId: string,
  name: string | null,
  action: string,
  oldValue: string | null,
  newValue: string | null,
  who: string,
  metadata: Record<string, unknown>,
) {
  await supabase.from('activity_log').insert({
    entity_type: 'contact',
    entity_id: contactId,
    entity_name: name,
    action,
    field_name: action === 'billcom_customer_created' ? 'billcom_customer_id' : 'billcom_invoice',
    old_value: oldValue,
    new_value: newValue,
    changed_by: who,
    metadata,
  })
}
