import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdminBearer } from '../qbo/_lib.js'
import {
  BillComError,
  billComListAll,
  billComLogin,
  billComLogout,
  missingBillComEnv,
  summarizeBillCom,
  type BillComCustomerRow,
  type BillComInvoiceRow,
} from './_lib.js'

// POST /api/billcom/status — admin only, read-only connection check for
// Settings → Integrations: logs in, counts customers, lists the latest invoice
// numbers, logs out. Returns counts and invoice numbers, never credentials.

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
    const invoices = await billComListAll<BillComInvoiceRow>(session, 'invoices')
    return res.status(200).json({ ok: true, ...summarizeBillCom(customers, invoices) })
  } catch (e) {
    return res.status(200).json({ ok: false, stage: 'read', ...errorBody(e) })
  } finally {
    await billComLogout(session)
  }
}

function errorBody(e: unknown): { error: string; code?: string } {
  if (e instanceof BillComError) return { error: e.message, code: e.code }
  console.error('[billcom/status]', e)
  return { error: 'Unexpected error talking to bill.com' }
}
