import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdminBearer } from '../qbo/_lib.js'
import {
  BillComError,
  billComGet,
  billComListAll,
  billComLogin,
  billComLogout,
  missingBillComEnv,
  summarizeBillCom,
  type BillComCustomerRow,
  type BillComInvoiceRow,
  type BillComSession,
} from './_lib.js'

// POST /api/billcom/status — admin only, read-only connection check for
// Settings → Integrations: logs in, counts customers, lists the latest invoice
// numbers and how recent invoices are set up, logs out. Never returns
// credentials.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const admin = await requireAdminBearer(req, res)
  if (!admin) return // requireAdminBearer already wrote the 401/403 response

  const missing = missingBillComEnv()
  if (missing.length) return res.status(200).json({ ok: false, stage: 'config', error: `Missing ${missing.join(', ')}` })

  let session
  try {
    session = await billComLogin()
  } catch (e) {
    return res.status(200).json({ ok: false, stage: 'login', ...errorBody(e) })
  }
  try {
    const customers = await billComListAll<BillComCustomerRow>(session, 'customers')
    const invoices = await billComListAll<BillComInvoiceRow & { id?: string }>(session, 'invoices')
    const summary = summarizeBillCom(customers, invoices)
    return res.status(200).json({ ok: true, ...summary, setup: await invoiceSetup(session, invoices) })
  } catch (e) {
    return res.status(200).json({ ok: false, stage: 'read', ...errorBody(e) })
  } finally {
    await billComLogout(session)
  }
}

// How the hand-entered invoices are built (items, classes, terms, wording), so
// invoices created from Ops can match them. Best-effort: a failure here never
// fails the connection check.
async function invoiceSetup(session: BillComSession, invoices: Array<BillComInvoiceRow & { id?: string }>) {
  try {
    const recent = invoices
      .filter((i) => !i.archived && i.id)
      .sort((a, b) => String(b.invoiceDate ?? '').localeCompare(String(a.invoiceDate ?? '')))
      .slice(0, 3)
    const samples = []
    for (const i of recent) {
      const d = await billComGet<any>(session, `invoices/${encodeURIComponent(i.id!)}`)
      samples.push({
        number: d.invoiceNumber,
        customer: d.customerName,
        invoice_date: d.invoiceDate,
        due_date: d.dueDate,
        payment_term_id: d.paymentTermId ?? null,
        pay_to_account: d.payToChartOfAccountId ?? null,
        classifications: d.classifications ?? null,
        card_payment: d.enableCardPayment ?? null,
        lines: (d.invoiceLineItems ?? []).map((l: any) => ({
          description: l.description,
          quantity: l.quantity,
          price: l.price,
          classifications: l.classifications ?? null,
        })),
      })
    }
    const items = (await billComListAll<any>(session, 'classifications/items'))
      .filter((it) => !it.archived)
      .map((it) => ({ id: it.id, name: it.name, type: it.type, price: it.price ?? null }))
    const terms = await billComGet<any>(session, `organizations/${encodeURIComponent(session.organizationId)}/payment-terms`, { max: '100' })
    return {
      samples,
      items,
      payment_terms: (terms?.results ?? []).map((t: any) => ({ id: t.id, name: t.name, days_due: t.daysDue })),
    }
  } catch (e) {
    return { error: e instanceof BillComError ? e.message : 'Could not read invoice setup' }
  }
}

function errorBody(e: unknown): { error: string; code?: string } {
  if (e instanceof BillComError) return { error: e.message, code: e.code }
  console.error('[billcom/status]', e)
  return { error: 'Unexpected error talking to bill.com' }
}
