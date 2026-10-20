import { describe, expect, it } from 'vitest'
import { summarizeRunOutputs, type OutputLine } from './invoice-outputs'

const line = (o: Partial<OutputLine>): OutputLine => ({
  lineKind: 'clean',
  reviewStatus: 'ok',
  billingChannel: 'qbo_haven',
  cleanerPayAmount: 100,
  clientChargeAmount: 200,
  serviceDate: '2026-09-29',
  ...o,
})

describe('summarizeRunOutputs', () => {
  it('splits a run that crosses a month into one Haven invoice and one Ramp bill per month', () => {
    const out = summarizeRunOutputs(
      [
        line({}),
        line({ serviceDate: '2026-09-30', cleanerPayAmount: 50.5, clientChargeAmount: 90.25 }),
        line({ serviceDate: '2026-10-02' }),
      ],
      { invoiceDate: '2026-10-03', vendorInvoiceNumber: '1261003821', qboInvoiceNo: null, qboInvoiceNos: { '2026-09': 1096, '2026-10': 1097 } },
    )
    expect(out.splitsRamp).toBe(true)
    expect(out.splitsHaven).toBe(true)
    expect(out.months.map(m => m.month)).toEqual(['2026-09', '2026-10'])
    const [sep, oct] = out.months
    expect(sep.documentDate).toBe('2026-09-30')
    expect(oct.documentDate).toBe('2026-10-03')
    expect(sep.haven).toEqual({ lines: 2, total: 290.25, invoiceNo: 1096 })
    expect(oct.haven).toEqual({ lines: 1, total: 200, invoiceNo: 1097 })
    expect(sep.ramp).toEqual({ lines: 2, total: 150.5, billNumber: '1261003821-2026-09' })
    expect(oct.ramp.billNumber).toBe('1261003821-2026-10')
  })

  it('keeps the plain vendor number on a single-month run', () => {
    const out = summarizeRunOutputs([line({ serviceDate: '2026-10-12' })], {
      invoiceDate: '2026-10-17', vendorInvoiceNumber: 'I261012825', qboInvoiceNo: 1100, qboInvoiceNos: { '2026-10': 1100 },
    })
    expect(out.splitsRamp).toBe(false)
    expect(out.months[0].ramp.billNumber).toBe('I261012825')
    expect(out.months[0].haven.invoiceNo).toBe(1100)
  })

  it('gives a run numbered before the month split its old number for the first month', () => {
    const out = summarizeRunOutputs([line({}), line({ serviceDate: '2026-10-01' })], {
      invoiceDate: '2026-10-03', vendorInvoiceNumber: 'X', qboInvoiceNo: 1096, qboInvoiceNos: null,
    })
    expect(out.months[0].haven.invoiceNo).toBe(1096)
    expect(out.months[1].haven.invoiceNo).toBeNull()
  })

  it('leaves excluded lines out and routes each channel to its own bucket', () => {
    const out = summarizeRunOutputs(
      [
        line({ reviewStatus: 'excluded' }),
        line({ lineKind: 'excluded' }),
        line({ billingChannel: 'bill_com', clientChargeAmount: 120 }),
        line({ billingChannel: 'qbo_client', clientChargeAmount: 80 }),
        line({ billingChannel: 'none', clientChargeAmount: 60 }),
        line({ lineKind: 'operating_expense', billingChannel: null, clientChargeAmount: null, cleanerPayAmount: 720 }),
        line({ billingChannel: 'bill_com', cleanerPayAmount: null, clientChargeAmount: -25 }),
      ],
      { invoiceDate: '2026-09-30', vendorInvoiceNumber: 'V', qboInvoiceNo: null },
    )
    const m = out.months[0]
    expect(m.haven.lines).toBe(0)
    expect(m.billCom).toEqual({ lines: 2, total: 95 })
    expect(m.qboClient).toEqual({ lines: 1, total: 80 })
    expect(m.unrouted).toEqual({ lines: 1, total: 60 })
    // labor is paid; the two excluded lines are not; the credit has no pay
    expect(m.ramp).toEqual({ lines: 4, total: 100 * 3 + 720, billNumber: 'V' })
  })

  it('dates an undated line (labor) by the run invoice date', () => {
    const out = summarizeRunOutputs([line({ serviceDate: null, lineKind: 'operating_expense', billingChannel: null })], {
      invoiceDate: '2026-10-03', vendorInvoiceNumber: 'V', qboInvoiceNo: null,
    })
    expect(out.months.map(m => m.month)).toEqual(['2026-10'])
  })
})
