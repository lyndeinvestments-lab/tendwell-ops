import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { clientInvoiceTotal, isCreditLine, isMissingSchemaError, planCreditApplication, type OpenCredit } from './_credits.js'
import { toBillComCsv, toQboFlatCsv, toQboMultilineCsv, toRampCsv, type ExportLine, type ExportRun } from './_exporters.js'
import { isVendorVisible, type LineRow } from '../vendor-invoices/_lib.js'

const credit = (id: string, amount: number, createdAt: string): OpenCredit => ({ id, amount, createdAt })

describe('planCreditApplication (mirror of invoice_apply_open_credits)', () => {
  it('applies a credit smaller than the invoice in full: total = billed minus credit', () => {
    const plan = planCreditApplication(300, [credit('a', -50, '2026-10-01')])
    expect(plan.applications).toEqual([{ id: 'a', applied: -50, remainder: 0 }])
    expect(plan.total).toBe(250)
  })

  it('applies several credits oldest first and sums them', () => {
    const plan = planCreditApplication(300, [
      credit('late', -25.5, '2026-10-05'),
      credit('early', -40, '2026-09-20'),
    ])
    expect(plan.applications.map(a => a.id)).toEqual(['early', 'late'])
    expect(plan.total).toBe(234.5)
    expect(plan.total).toBe(300 - 40 - 25.5)
  })

  it('caps a credit larger than the invoice at the billed total and keeps the rest open', () => {
    const plan = planCreditApplication(120, [credit('big', -200, '2026-10-01')])
    expect(plan.applications).toEqual([{ id: 'big', applied: -120, remainder: -80 }])
    expect(plan.total).toBe(0)
  })

  it('never takes the invoice below zero; later credits stay open untouched', () => {
    const plan = planCreditApplication(100, [
      credit('a', -60, '2026-10-01'),
      credit('b', -60, '2026-10-02'),
      credit('c', -10, '2026-10-03'),
    ])
    expect(plan.applications).toEqual([
      { id: 'a', applied: -60, remainder: 0 },
      { id: 'b', applied: -40, remainder: -20 },
    ])
    expect(plan.untouched).toEqual(['c'])
    expect(plan.total).toBe(0)
  })

  it('applies nothing to an invoice that bills the client nothing', () => {
    const plan = planCreditApplication(0, [credit('a', -10, '2026-10-01')])
    expect(plan.applications).toEqual([])
    expect(plan.untouched).toEqual(['a'])
    expect(plan.total).toBe(0)
  })

  it('works in cents without float drift', () => {
    const plan = planCreditApplication(100.1, [credit('a', -0.2, '2026-10-01'), credit('b', -0.1, '2026-10-02')])
    expect(plan.total).toBe(99.8)
  })
})

describe('clientInvoiceTotal', () => {
  it('is billed minus credits, ignoring excluded lines and Tendwell expenses', () => {
    const total = clientInvoiceTotal([
      { clientChargeAmount: 175 },
      { clientChargeAmount: 50 },
      { clientChargeAmount: -30 }, // credit line
      { clientChargeAmount: 999, reviewStatus: 'excluded' },
      { clientChargeAmount: 999, lineKind: 'excluded' },
      { clientChargeAmount: 999, lineKind: 'operating_expense' },
      { clientChargeAmount: null },
    ])
    expect(total).toBe(195)
  })

  it('matches the plan: billed + applied credits, including a capped one', () => {
    const billedLines = [{ clientChargeAmount: 80 }, { clientChargeAmount: 45.25 }]
    const billed = clientInvoiceTotal(billedLines)
    const plan = planCreditApplication(billed, [credit('a', -100, '2026-10-01'), credit('b', -50, '2026-10-02')])
    const withCredits = clientInvoiceTotal([...billedLines, ...plan.applications.map(a => ({ clientChargeAmount: a.applied }))])
    expect(withCredits).toBe(plan.total)
    expect(withCredits).toBe(0)
    expect(plan.applications.find(a => a.id === 'b')).toEqual({ id: 'b', applied: -25.25, remainder: -24.75 })
  })
})

describe('isMissingSchemaError', () => {
  it('recognises "migration not applied" errors', () => {
    expect(isMissingSchemaError({ code: '42P01', message: 'relation "invoice_adjustments" does not exist' })).toBe(true)
    expect(isMissingSchemaError({ code: 'PGRST202', message: 'Could not find the function public.invoice_apply_open_credits' })).toBe(true)
    expect(isMissingSchemaError({ code: 'PGRST205', message: "Could not find the table 'public.invoice_adjustments' in the schema cache" })).toBe(true)
    expect(isMissingSchemaError({ code: '42703', message: 'column does not exist' })).toBe(true)
  })
  it('does not swallow real failures', () => {
    expect(isMissingSchemaError({ code: '55000', message: 'Run is exported; credits are applied when a run is approved' })).toBe(false)
    expect(isMissingSchemaError({ code: '23514', message: 'violates check constraint' })).toBe(false)
    expect(isMissingSchemaError(null)).toBe(false)
  })
})

// ─── Exports ─────────────────────────────────────────────────────────────────

const RUN: ExportRun = {
  vendorName: 'Busy Bee Cleaning',
  vendorInvoiceNumber: 'I261005900',
  invoiceDate: '2026-10-05',
  dueDate: '2026-10-05',
  qboInvoiceNo: 1100,
  periodEnd: '2026-10-05',
}

const havenClean: ExportLine = {
  lineKind: 'clean',
  serviceType: 'Turn Clean',
  serviceDate: '2026-10-02',
  propertyName: 'Test Cabin 101',
  clientName: 'Haven Vacation Rentals',
  billingChannel: 'qbo_haven',
  cleanerPayAmount: 100,
  clientChargeAmount: 175,
  note: null,
  reviewStatus: 'ok',
}

// As written by invoice_apply_open_credits: no property, zero pay, negative
// charge, reason as the note, reason + evidence link as the review note.
const havenCredit: ExportLine = {
  lineKind: 'extra',
  serviceType: 'Credit',
  serviceDate: '2026-10-02',
  propertyName: null,
  rawPropertyText: 'Client credit',
  clientName: 'Haven Vacation Rentals',
  billingChannel: 'qbo_haven',
  cleanerPayAmount: 0,
  clientChargeAmount: -40,
  note: 'Refund for missed bathroom',
  reviewNote: 'Refund for missed bathroom https://example.slack.com/archives/C1/p1',
  reviewStatus: 'ok',
  flags: ['credit'],
}

const ownerClean: ExportLine = {
  ...havenClean,
  propertyName: 'Owner Place 7',
  clientName: 'Jane Owner',
  billingChannel: 'bill_com',
  clientChargeAmount: 120,
}

const ownerCredit: ExportLine = {
  ...havenCredit,
  clientName: 'Jane Owner',
  billingChannel: 'bill_com',
  clientChargeAmount: -20,
  note: 'Goodwill discount',
  reviewNote: 'Goodwill discount',
}

const amountOf = (cell: string) => Number(cell.replace(/[$,]/g, ''))

describe('credit lines in the exports', () => {
  it('QBO flat: the credit is a negative "Credit (reason)" row and the invoice nets to billed minus credit', () => {
    const rows = Papa.parse<string[]>(toQboFlatCsv(RUN, [havenClean, havenCredit]).trim()).data
    const credit = rows.find(r => r[0].startsWith('Credit'))!
    expect(credit[0]).toBe('Credit (Refund for missed bathroom)')
    expect(credit[2]).toBe('Credit – Refund for missed bathroom – https://example.slack.com/archives/C1/p1')
    expect(credit[3]).toBe('-$40.00')
    expect(credit[5]).toBe('1100') // same invoice as the clean
    const net = rows.slice(1).reduce((a, r) => a + amountOf(r[3]), 0)
    expect(net).toBe(135)
  })

  it('QBO multiline: the credit rides the same invoice with a negative amount', () => {
    const rows = Papa.parse<string[]>(toQboMultilineCsv(RUN, [havenClean, havenCredit]).trim()).data
    expect(rows).toHaveLength(3)
    const credit = rows[2]
    expect(credit[0]).toBe('1100')
    expect(credit[7]).toBe('Credit')
    expect(credit[8]).toContain('Refund for missed bathroom')
    expect(credit[10]).toBe('-40.00')
    expect(credit[11]).toBe('-40.00')
    expect(rows.slice(1).reduce((a, r) => a + Number(r[11]), 0)).toBe(135)
  })

  it('bill.com: the credit lists under its client and nets that client to billed minus credit', () => {
    const rows = Papa.parse<string[]>(toBillComCsv(RUN, [ownerClean, ownerCredit, havenClean]).trim()).data.slice(1)
    expect(rows).toHaveLength(2) // Haven lines never go to bill.com
    const credit = rows.find(r => r[3].startsWith('Credit'))!
    expect(credit[0]).toBe('Jane Owner')
    expect(credit[3]).toBe('Credit (Goodwill discount)')
    expect(credit[6]).toBe('Goodwill discount')
    expect(credit[7]).toBe('-20.00')
    const janeTotal = rows.filter(r => r[0] === 'Jane Owner').reduce((a, r) => a + Number(r[7]), 0)
    expect(janeTotal).toBe(100)
  })

  it('Ramp: a credit is never paid to the vendor (zero cleaner pay)', () => {
    const rows = Papa.parse<string[]>(toRampCsv(RUN, [havenClean, havenCredit, ownerCredit]).trim()).data.slice(1)
    expect(rows).toHaveLength(1)
    expect(rows[0][7]).toBe('100.00')
  })

  it('a credit with a property names it in the description', () => {
    const rows = Papa.parse<string[]>(toQboFlatCsv(RUN, [{ ...havenCredit, propertyName: 'Test Cabin 101' }]).trim()).data
    expect(rows[1][2]).toBe('Credit – Test Cabin 101 – Refund for missed bathroom – https://example.slack.com/archives/C1/p1')
  })

  it('an excluded (released) credit drops out of every export', () => {
    const released = { ...havenCredit, reviewStatus: 'excluded' }
    expect(Papa.parse<string[]>(toQboFlatCsv(RUN, [released]).trim()).data).toHaveLength(1)
  })
})

describe('credit lines and the vendor portal', () => {
  const row = (over: Partial<LineRow>): LineRow => ({
    id: 'x', line_no: 1, split_group: null, source: 'vendor', raw_note_text: null, raw_amount: 0,
    raw_date_mentioned: null, service_date: null, property_id: null, service_type: null, line_kind: 'clean',
    cleaner_pay_amount: 100, flags: [], review_status: 'ok', vendor_category: null, vendor_detail: null,
    receipt_path: null, ...over,
  })

  it('a client credit is never shown to the vendor', () => {
    const c = row({ source: 'manual', line_kind: 'extra', service_type: 'Credit', cleaner_pay_amount: 0, flags: ['credit'] })
    expect(isCreditLine(c)).toBe(true)
    expect(isVendorVisible(c)).toBe(false)
    expect(isVendorVisible(row({}))).toBe(true)
  })
})
