// Supply-bill itemization — pure, no I/O.
//
// Ramp bills (the source QuickBooks syncs from) are either itemized (one Ramp
// line per product plus a "Taxes" line) or a single summary line. Summary
// bills are itemized from the vendor's invoice PDF text, and a vendor
// statement (one bill paying several invoices) from its invoice rows. Every
// result sums to the bill amount to the cent, so per-category totals always
// reconcile with QuickBooks.

export type SupplyCategory =
  | 'paper'
  | 'trash_bags'
  | 'amenities'
  | 'cleaning'
  | 'hot_tub_chem'
  | 'linens'
  | 'mixed'
  | 'other'

export type SupplySource = 'ramp_line' | 'invoice_pdf' | 'statement' | 'bill_memo'

const LINEN_SKU = /^(01|15|16)\d{3}-/
const LINEN_TEXT = /\b(linens?|terry|bedding|pillow\w*|fitted|flat|duvet|comforter|blanket|mattress (pad|protector)|bath ?towels?|hand towels?|wash ?cloths?|pool towels?|kitchen towels?|dobby)\b/
const CONSUMABLE_RULES: Array<[Exclude<SupplyCategory, 'linens' | 'mixed' | 'other'>, RegExp]> = [
  ['hot_tub_chem', /\b(bromine|chlorine|spa shock|hot tub chem\w*)\b/],
  ['paper', /\b(bath tissue|toilet paper|paper towels?|roll towels?|kitchen roll|tp|pt|paper goods|napkins?|facial tissue|rolls?\/cs|\d ply)\b/],
  ['trash_bags', /\b(can liners?|trash bags?|liners?)\b/],
  ['amenities', /\b(shampoo|conditioner|body wash|cleansing bars?|amenit\w*|lotion|infuse)\b/],
  ['cleaning', /\b(detergent|dish\w*|sponges?|laundry pods?|cleaners?|bleach|disinfect\w*|wipes?|soap)\b/],
]

/** Category of a product line (sku + description) or a free-text memo. */
export function classifySupply(text: string, sku?: string | null): SupplyCategory {
  const t = text.toLowerCase()
  const paperLike = /\b(paper|roll|tissue)\b/.test(t)
  if (sku && LINEN_SKU.test(sku)) return 'linens'
  const linen = !paperLike && LINEN_TEXT.test(t)
  const hits = CONSUMABLE_RULES.filter(([, re]) => re.test(t)).map(([c]) => c)
  const alsoConsumables = hits.length > 0 || /\b(consumables?|supplies)\b/.test(t)
  if (linen) return alsoConsumables && !sku ? 'mixed' : 'linens'
  if (hits.length === 0) return 'other'
  if (sku || hits.length === 1) return hits[0]
  return 'mixed'
}

export interface ParsedItem {
  sku: string | null
  description: string
  quantity: number | null
  uom: string | null
  amount: number
}

export interface ParsedInvoice {
  invoiceNumber: string | null
  items: ParsedItem[]
  /** Tax + shipping, spread over the items. */
  charges: number
}

const money = (s: string) => Number(s.replace(/[$,]/g, ''))
const ITEM_HEAD = /^(\d+(?:\.\d+)?)\s+([A-Z]{1,4})\s+(\S+)$/
const RATE_AMOUNT = /\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s*$/

/** Product lines of every invoice in a PDF's text (Hospitality Depot layout). */
export function parseInvoiceText(text: string): ParsedInvoice[] {
  const byNumber = new Map<string, ParsedInvoice>()
  let current: ParsedInvoice | null = null
  let pending: { sku: string; quantity: number; uom: string; desc: string[] } | null = null
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === 'Invoice' && /^INV\d+$/.test(lines[i + 1] ?? '')) {
      const no = lines[i + 1]
      current = byNumber.get(no) ?? { invoiceNumber: no, items: [], charges: 0 }
      byNumber.set(no, current)
      pending = null
      i++
      continue
    }
    if (!current) continue
    const head = line.match(ITEM_HEAD)
    if (head) {
      pending = { quantity: Number(head[1]), uom: head[2], sku: head[3], desc: [] }
      continue
    }
    if (pending) {
      const ra = line.match(RATE_AMOUNT)
      const before = ra ? line.slice(0, ra.index).trim() : line
      if (before) pending.desc.push(before)
      if (ra) {
        current.items.push({
          sku: pending.sku,
          description: pending.desc.join(' ').replace(/\s+/g, ' '),
          quantity: pending.quantity,
          uom: pending.uom,
          amount: money(ra[2]),
        })
        pending = null
      }
      continue
    }
    const charge = line.match(/^(?:Tax Total|Shipping Cost)\s+\$([\d,]+\.\d{2})/)
    if (charge) current.charges += money(charge[1])
  }
  return Array.from(byNumber.values()).filter(inv => inv.items.length > 0)
}

export interface StatementRow {
  invoiceNumber: string
  memo: string
  amount: number
}

/** Invoice rows of a vendor statement ("Invoice #INV… memo  due-date  $amount  $balance"). */
export function parseStatementText(text: string): StatementRow[] {
  const flat = text.replace(/\s+/g, ' ')
  const re = /Invoice #(\S+)\s+(.*?)\s*\d{1,2}\/\d{1,2}\/\d{4}\s+\$([\d,]+\.\d{2})\s+\$[\d,]+\.\d{2}/g
  const out: StatementRow[] = []
  for (let m = re.exec(flat); m; m = re.exec(flat)) {
    out.push({ invoiceNumber: m[1], memo: m[2].trim(), amount: money(m[3]) })
  }
  return out
}

export interface SupplyLine {
  line_no: number
  source: SupplySource
  invoice_number: string | null
  sku: string | null
  description: string
  quantity: number | null
  uom: string | null
  /** Including its share of tax and shipping. */
  amount: number
  category: SupplyCategory
}

export interface RampBillLite {
  invoice_number: string | null
  memo: string | null
  /** Dollars. */
  amount: number
  line_items: Array<{ memo: string | null; amount: number }>
}

const cents = (v: number) => Math.round(v * 100)

/** Scale `parts` (cents) to sum to `totalCents` exactly; the remainder lands on the largest part. */
function scaleTo(parts: number[], totalCents: number): number[] {
  const base = parts.reduce((s, p) => s + p, 0)
  if (parts.length === 0) return []
  if (base === 0) return parts.map((_, i) => (i === 0 ? totalCents : 0))
  const out = parts.map(p => Math.round((p * totalCents) / base))
  const diff = totalCents - out.reduce((s, p) => s + p, 0)
  let big = 0
  out.forEach((p, i) => { if (Math.abs(p) > Math.abs(out[big])) big = i })
  out[big] += diff
  return out
}

const TOLERANCE_CENTS = 5
const isTaxMemo = (m: string | null) => /^\s*(sales\s+)?tax(es)?\s*$/i.test(m ?? '')
const productLines = (items: RampBillLite['line_items']) => items.filter(l => !isTaxMemo(l.memo) && (l.memo ?? '').trim())

/** Whether Ramp's own line items are per-product (so no PDF is needed). */
export function isItemizedInRamp(items: RampBillLite['line_items']): boolean {
  const product = productLines(items)
  return product.length >= 2 || (product.length === 1 && items.some(l => isTaxMemo(l.memo)))
}

/**
 * Supply lines for one bill: Ramp's own line items when itemized, else the
 * invoice PDF(s), else statement rows, else one line classified by its memo.
 * Amounts always sum to the bill amount.
 */
export function itemizeBill(bill: RampBillLite, pdfTexts: string[]): SupplyLine[] {
  const total = cents(bill.amount)
  if (isItemizedInRamp(bill.line_items)) {
    const product = productLines(bill.line_items)
    const amounts = scaleTo(product.map(l => cents(l.amount)), total)
    return product.map((l, i) => {
      const desc = (l.memo ?? '').trim()
      const sku = desc.match(/^(\d{5}-\d{6})\b/)?.[1] ?? null
      return {
        line_no: i + 1,
        source: 'ramp_line',
        invoice_number: bill.invoice_number,
        sku,
        description: desc,
        quantity: null,
        uom: null,
        amount: amounts[i] / 100,
        category: classifySupply(desc, sku),
      }
    })
  }

  const invoices = pdfTexts.flatMap(parseInvoiceText)
  const pdfCents = invoices.reduce((s, inv) => s + cents(inv.charges) + inv.items.reduce((a, it) => a + cents(it.amount), 0), 0)
  if (invoices.length > 0 && Math.abs(pdfCents - total) <= TOLERANCE_CENTS) {
    const flat = invoices.flatMap(inv => {
      const itemCents = inv.items.map(it => cents(it.amount))
      const withCharges = scaleTo(itemCents, itemCents.reduce((s, c) => s + c, 0) + cents(inv.charges))
      return inv.items.map((it, i) => ({ inv, it, c: withCharges[i] }))
    })
    const exact = scaleTo(flat.map(f => f.c), total)
    return flat.map((f, i) => ({
      line_no: i + 1,
      source: 'invoice_pdf',
      invoice_number: f.inv.invoiceNumber,
      sku: f.it.sku,
      description: f.it.description,
      quantity: f.it.quantity,
      uom: f.it.uom,
      amount: exact[i] / 100,
      category: classifySupply(f.it.description, f.it.sku),
    }))
  }

  const rows = pdfTexts.flatMap(parseStatementText)
  const rowCents = rows.reduce((s, r) => s + cents(r.amount), 0)
  if (rows.length > 0 && Math.abs(rowCents - total) <= TOLERANCE_CENTS) {
    const exact = scaleTo(rows.map(r => cents(r.amount)), total)
    return rows.map((r, i) => ({
      line_no: i + 1,
      source: 'statement',
      invoice_number: r.invoiceNumber,
      sku: null,
      description: r.memo,
      quantity: null,
      uom: null,
      amount: exact[i] / 100,
      category: classifySupply(r.memo),
    }))
  }

  const memo = [bill.memo, ...bill.line_items.map(l => l.memo)].filter(Boolean).join(' · ')
  return [{
    line_no: 1,
    source: 'bill_memo',
    invoice_number: bill.invoice_number,
    sku: null,
    description: memo,
    quantity: null,
    uom: null,
    amount: total / 100,
    category: classifySupply(memo),
  }]
}
