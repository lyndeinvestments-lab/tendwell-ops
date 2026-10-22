import { describe, it, expect } from 'vitest'
import { classifySupply, itemizeBill, parseInvoiceText, parseStatementText } from './_supplies'

// Shaped like unpdf's text of a Hospitality Depot invoice PDF.
const INVOICE = `Remit to:
Hospitality Depot LLC
Invoice
INV10001
Date: 9/22/2026
Quantity UOM Item Rate Amount
2 CS 13850-385811
Can Liner: 38x58 1.1mil Clear ; 60 Gal. 100cs
$30.00 $60.00
1 DZ 15201-400000
T-200 Millennium King Flat 111x115; White w/Gold Hem
$100.00 $100.00
3 CS 13800-001248
Bath Tissue: Green Heritage; 96 rolls/cs; Wrapped
400 sheets/roll; 2 Ply White
$40.00 $120.00
Subtotal $280.00
Tax Total $28.00
Shipping Cost $0.00
Memo: Terry and bedding Total $308.00
Amount Due $308.00`

const STATEMENT = `Hospitality Depot LLC
Statement
Date Description Memo Due Date Invoice
Amount
Payment
Applied Balance
6/20/2026 Balance Forward $0.00
6/24/2026 Invoice #INV20001 Linen 7/14/2026 $1,512.36 $1,512.36
7/8/2026 Invoice #INV20002 TP, PT, Amenities, can liners, laundry
pods, sponges
7/28/2026 $2,948.77 $4,461.13
7/14/2026 Invoice #INV20003 8/3/2026 $420.90 $4,882.03
Aging Summary`

describe('classifySupply', () => {
  it('puts sheets, towels and pillows in linens, by sku or text', () => {
    expect(classifySupply('Hot Tub/Pool Towel: Nautique Horizontal BLUE Stripe', '01910-306413')).toBe('linens')
    expect(classifySupply('T-200 Millennium King Fitted 15"', null)).toBe('linens')
    expect(classifySupply('Resort Dobby Wash 12 x 12 1 lb/dz White')).toBe('linens')
    expect(classifySupply('Linen')).toBe('linens')
    expect(classifySupply('Terry and bedding')).toBe('linens')
  })

  it('keeps paper towels and bath tissue out of linens', () => {
    expect(classifySupply('Kitchen Roll Paper Towels; Boardwalk 30/cs 2 Ply White', '13800-006272')).toBe('paper')
    expect(classifySupply('Bath Tissue: Green Heritage; 96 rolls/cs; 400 sheets/roll', '13800-001248')).toBe('paper')
    expect(classifySupply('*Discontinued *: Gen Standard; 96 rolls/cs; Wrapped 400 sheets/roll; 2 Ply White')).toBe('paper')
  })

  it('sorts consumables', () => {
    expect(classifySupply('Can Liner: 38x58 1.1mil Clear', '13850-385811')).toBe('trash_bags')
    expect(classifySupply("Bath: Infuse' Shampoo 1oz. Tube Flip Cap", '13900-106101')).toBe('amenities')
    expect(classifySupply('Detergent: Terra Breeze Laundry Gel Pod', '13910-002205')).toBe('cleaning')
    expect(classifySupply('Bromine Tablets 50 lbs. tub', '13900-000100')).toBe('hot_tub_chem')
  })

  it('calls a memo naming several kinds mixed, never linens', () => {
    expect(classifySupply('TP, PT, Amenities, can liners')).toBe('mixed')
    expect(classifySupply('Statement for consumables linens and cleaning supplies')).toBe('mixed')
    expect(classifySupply('TP, PT')).toBe('paper')
    expect(classifySupply('supplies')).toBe('other')
  })
})

describe('parseInvoiceText', () => {
  it('reads product lines across wrapped descriptions plus tax', () => {
    const [inv] = parseInvoiceText(INVOICE)
    expect(inv.invoiceNumber).toBe('INV10001')
    expect(inv.charges).toBe(28)
    expect(inv.items.map(i => [i.sku, i.quantity, i.amount])).toEqual([
      ['13850-385811', 2, 60],
      ['15201-400000', 1, 100],
      ['13800-001248', 3, 120],
    ])
    expect(inv.items[2].description).toBe('Bath Tissue: Green Heritage; 96 rolls/cs; Wrapped 400 sheets/roll; 2 Ply White')
  })

  it('returns nothing for a statement', () => {
    expect(parseInvoiceText(STATEMENT)).toEqual([])
  })
})

describe('parseStatementText', () => {
  it('reads invoice rows, including wrapped and blank memos', () => {
    expect(parseStatementText(STATEMENT)).toEqual([
      { invoiceNumber: 'INV20001', memo: 'Linen', amount: 1512.36 },
      { invoiceNumber: 'INV20002', memo: 'TP, PT, Amenities, can liners, laundry pods, sponges', amount: 2948.77 },
      { invoiceNumber: 'INV20003', memo: '', amount: 420.9 },
    ])
  })
})

describe('itemizeBill', () => {
  const sum = (ls: { amount: number }[]) => Math.round(ls.reduce((s, l) => s + l.amount, 0) * 100) / 100

  it('uses Ramp line items when itemized, spreading the tax line', () => {
    const lines = itemizeBill({
      invoice_number: 'INV1', memo: 'order', amount: 110,
      line_items: [
        { memo: 'Can Liner: 38x58', amount: 40 },
        { memo: 'King Flat sheet 111x115', amount: 60 },
        { memo: 'Taxes', amount: 10 },
      ],
    }, [])
    expect(lines.map(l => [l.source, l.category, l.amount])).toEqual([
      ['ramp_line', 'trash_bags', 44],
      ['ramp_line', 'linens', 66],
    ])
  })

  it('falls back to the invoice PDF and reconciles to the cent', () => {
    const lines = itemizeBill({ invoice_number: 'INV10001', memo: 'Bulk order', amount: 308, line_items: [{ memo: 'Bulk order', amount: 308 }] }, [INVOICE])
    expect(lines.every(l => l.source === 'invoice_pdf')).toBe(true)
    expect(sum(lines)).toBe(308)
    expect(lines.find(l => l.category === 'linens')!.amount).toBe(110)
  })

  it('itemizes a statement bill by its invoice rows', () => {
    const lines = itemizeBill({ invoice_number: null, memo: 'Statement', amount: 4882.03, line_items: [{ memo: 'Statement', amount: 4882.03 }] }, [STATEMENT])
    expect(lines.map(l => [l.invoice_number, l.category])).toEqual([
      ['INV20001', 'linens'],
      ['INV20002', 'mixed'],
      ['INV20003', 'other'],
    ])
    expect(sum(lines)).toBe(4882.03)
  })

  it('keeps one memo line when nothing reconciles', () => {
    const lines = itemizeBill({ invoice_number: 'X', memo: 'Hand towels', amount: 500, line_items: [{ memo: 'Thirty dozen hand towels', amount: 500 }] }, [INVOICE])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ source: 'bill_memo', amount: 500, category: 'linens' })
  })
})
