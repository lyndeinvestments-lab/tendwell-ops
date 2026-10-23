import { describe, expect, it } from 'vitest'
import { billComErrorFrom, missingBillComEnv, summarizeBillCom } from './_lib'

describe('missingBillComEnv', () => {
  it('lists blank and absent variables', () => {
    expect(missingBillComEnv({ BILLCOM_USERNAME: 'u', BILLCOM_PASSWORD: ' ', BILLCOM_ORG_ID: '008x' })).toEqual([
      'BILLCOM_PASSWORD',
      'BILLCOM_DEV_KEY',
    ])
  })

  it('is empty when all four are set', () => {
    expect(
      missingBillComEnv({ BILLCOM_USERNAME: 'u', BILLCOM_PASSWORD: 'p', BILLCOM_ORG_ID: '008x', BILLCOM_DEV_KEY: 'k' }),
    ).toEqual([])
  })
})

describe('billComErrorFrom', () => {
  it('reads the first bill.com error', () => {
    const e = billComErrorFrom(400, [{ code: 'BDC_1109', message: 'Invalid username or password' }])
    expect(e.message).toBe('Invalid username or password')
    expect(e.code).toBe('BDC_1109')
    expect(e.status).toBe(400)
  })

  it('falls back to the status when the body is not an error list', () => {
    expect(billComErrorFrom(502, null).message).toBe('bill.com request failed (502)')
  })
})

describe('summarizeBillCom', () => {
  it('counts active customers and lists the newest invoices first', () => {
    const s = summarizeBillCom(
      [
        { name: 'A', email: 'a@x.com' },
        { name: 'B', email: '' },
        { name: 'C', email: 'c@x.com', archived: true },
      ],
      [
        { invoiceNumber: '1001', invoiceDate: '2026-09-01', status: 'PAID_IN_FULL' },
        { invoiceNumber: '1003', invoiceDate: '2026-10-01', status: 'OPEN' },
        { invoiceNumber: '1002', invoiceDate: '2026-09-15', status: 'OPEN' },
        { invoiceNumber: '0999', invoiceDate: '2026-10-05', status: 'OPEN', archived: true },
      ],
    )
    expect(s.customers).toEqual({ active: 2, archived: 1, with_email: 1 })
    expect(s.invoices.total).toBe(3)
    expect(s.invoices.by_status).toEqual({ PAID_IN_FULL: 1, OPEN: 2 })
    expect(s.invoices.latest.map((i) => i.number)).toEqual(['1003', '1002', '1001'])
  })

  it('keeps at most 8 latest invoices', () => {
    const invoices = Array.from({ length: 12 }, (_, i) => ({
      invoiceNumber: String(i),
      invoiceDate: `2026-10-${String(i + 1).padStart(2, '0')}`,
      status: 'OPEN',
    }))
    expect(summarizeBillCom([], invoices).invoices.latest).toHaveLength(8)
  })
})
