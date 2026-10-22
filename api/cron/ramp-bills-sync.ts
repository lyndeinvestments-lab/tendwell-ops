import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { extractText, getDocumentProxy } from 'unpdf'
import { getSupabaseConfig, requireAdminBearer } from '../qbo/_lib.js'
import { RAMP_API_BASE, RAMP_USER_AGENT, getRampToken } from '../ramp/_lib.js'
import { isItemizedInRamp, itemizeBill } from '../ramp/_supplies.js'

// GET /api/cron/ramp-bills-sync[?full=1]
//
// Nightly (05:00 UTC, after the QBO P&L sync) itemization of supply bills
// paid through Ramp into supply_purchase_lines. A bill counts as a supply
// bill when any of its lines posts to a GL account named like "supplies"
// (Cleaning Supplies, Supplies Expense). Bills already itemized at the same
// amount are skipped unless ?full=1; archived bills lose their rows.
// Also runnable on demand with an admin bearer.

const MONTHS_BACK = 18
const MAX_BILLS = 5000

interface RampBill {
  id: string
  invoice_number: string | null
  memo: string | null
  issued_at: string | null
  accounting_date: string | null
  archived_at: string | null
  amount: { amount: number; minor_unit_conversion_rate?: number }
  vendor: { name?: string | null; remote_name?: string | null } | null
  invoice_urls?: string[] | null
  attachments?: Array<{ url: string }> | null
  line_items?: Array<{
    memo: string | null
    amount: { amount: number; minor_unit_conversion_rate?: number }
    posting_gl_account?: { name?: string | null } | null
  }> | null
}

const dollars = (a: { amount: number; minor_unit_conversion_rate?: number }) => a.amount / (a.minor_unit_conversion_rate || 100)
const isSupplyGl = (name: string | null | undefined) => /suppl/i.test(name ?? '')
const isPdf = (u: string) => u.split('?')[0].toLowerCase().endsWith('.pdf')

async function pdfText(url: string): Promise<string | null> {
  const r = await fetch(url, { headers: { 'User-Agent': RAMP_USER_AGENT } })
  if (!r.ok) return null
  const pdf = await getDocumentProxy(new Uint8Array(await r.arrayBuffer()))
  const { text } = await extractText(pdf, { mergePages: true })
  return text
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.authorization
  const headerSecret = (req.headers['x-cron-secret'] as string | undefined) ?? ''
  const cronOk = !!cronSecret && (authHeader === `Bearer ${cronSecret}` || headerSecret === cronSecret)
  if (!cronOk) {
    const admin = await requireAdminBearer(req, res)
    if (!admin) return
  }
  const full = req.query.full === '1'

  let sb
  try {
    const cfg = getSupabaseConfig()
    sb = createClient(cfg.url, cfg.serviceKey)
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  try {
    const token = await getRampToken('bills:read')
    const since = new Date()
    since.setUTCMonth(since.getUTCMonth() - MONTHS_BACK, 1)
    const bills: RampBill[] = []
    let next: string | null = `${RAMP_API_BASE}/bills?page_size=100&from_issued_date=${since.toISOString()}`
    while (next && bills.length < MAX_BILLS) {
      const r: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': RAMP_USER_AGENT } })
      if (!r.ok) throw new Error(`Ramp bills failed (${r.status}): ${(await r.text()).slice(0, 300)}`)
      const page: { data?: RampBill[]; page?: { next?: string | null } } = await r.json()
      bills.push(...(page.data ?? []))
      next = page.page?.next ?? null
    }

    const supply = bills.filter(b => (b.line_items ?? []).some(l => isSupplyGl(l.posting_gl_account?.name)))
    const { data: existing, error: exErr } = await sb.from('supply_purchase_lines')
      .select('ramp_bill_id, bill_amount')
      .eq('line_no', 1)
      .range(0, MAX_BILLS - 1)
    if (exErr) throw new Error(exErr.message)
    const stored = new Map<string, number>()
    for (const r of existing ?? []) stored.set(r.ramp_bill_id, Number(r.bill_amount))

    const counts = { bills: supply.length, itemized: 0, skipped: 0, removed: 0, errors: [] as string[], bySource: {} as Record<string, number> }

    const archived = supply.filter(b => b.archived_at).map(b => b.id).filter(id => stored.has(id))
    if (archived.length) {
      const { error } = await sb.from('supply_purchase_lines').delete().in('ramp_bill_id', archived)
      if (error) throw new Error(error.message)
      counts.removed = archived.length
    }

    for (const b of supply) {
      if (b.archived_at) continue
      const amount = dollars(b.amount)
      if (!full && stored.get(b.id) === amount) {
        counts.skipped++
        continue
      }
      try {
        const lineItems = (b.line_items ?? []).map(l => ({ memo: l.memo, amount: dollars(l.amount) }))
        const texts: string[] = []
        if (!isItemizedInRamp(lineItems)) {
          const urls = Array.from(new Set([...(b.invoice_urls ?? []), ...(b.attachments ?? []).map(a => a.url)])).filter(isPdf)
          for (const u of urls) {
            const t = await pdfText(u)
            if (t) texts.push(t)
          }
        }
        const lines = itemizeBill({ invoice_number: b.invoice_number || null, memo: b.memo, amount, line_items: lineItems }, texts)
        const billDate = (b.accounting_date ?? b.issued_at ?? '').slice(0, 10)
        const vendor = b.vendor?.name || b.vendor?.remote_name || '(no vendor)'
        const gl = (b.line_items ?? []).find(l => isSupplyGl(l.posting_gl_account?.name))?.posting_gl_account?.name ?? null
        const rows = lines.map(l => ({
          ramp_bill_id: b.id,
          line_no: l.line_no,
          bill_date: billDate,
          bill_month: `${billDate.slice(0, 7)}-01`,
          bill_amount: amount,
          vendor,
          gl_account: gl,
          invoice_number: l.invoice_number,
          source: l.source,
          sku: l.sku,
          description: l.description,
          quantity: l.quantity,
          uom: l.uom,
          amount: l.amount,
          category: l.category,
          synced_at: new Date().toISOString(),
        }))
        const del = await sb.from('supply_purchase_lines').delete().eq('ramp_bill_id', b.id)
        if (del.error) throw new Error(del.error.message)
        const ins = await sb.from('supply_purchase_lines').insert(rows)
        if (ins.error) throw new Error(ins.error.message)
        counts.itemized++
        const src = lines[0]?.source ?? 'none'
        counts.bySource[src] = (counts.bySource[src] ?? 0) + 1
      } catch (e: any) {
        counts.errors.push(`${b.invoice_number || b.id}: ${e.message}`)
      }
    }

    return res.status(200).json({ ok: true, ...counts })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
