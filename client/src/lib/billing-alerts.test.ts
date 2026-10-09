import { describe, expect, it } from 'vitest'
import { billingAlerts, isMissingColumnError, type BillingAlertsResponse } from './billing-alerts'

describe('isMissingColumnError', () => {
  it('is true only for a missing column/table', () => {
    expect(isMissingColumnError({ code: '42703', message: 'column invoice_runs.paid_at does not exist' })).toBe(true)
    expect(isMissingColumnError({ code: 'PGRST204' })).toBe(true)
    expect(isMissingColumnError({ code: '42501', message: 'permission denied for table invoice_runs' })).toBe(false)
    expect(isMissingColumnError(undefined)).toBe(false)
  })
})

const base: BillingAlertsResponse = {
  today: '2026-10-08',
  thresholds: { uninvoiced_after_days: 7, uninvoiced_lookback_days: 45, unpaid_after_days: 30 },
  uninvoiced_total: 0,
  uninvoiced_groups: [],
  unpaid_invoices: [],
  payment_tracking: true,
}

describe('billingAlerts', () => {
  it('returns nothing for an empty feed', () => {
    expect(billingAlerts(base)).toEqual([])
  })

  it('one warning per client, naming the top properties, linked to Invoice Reconciliation', () => {
    const [a] = billingAlerts({
      ...base,
      uninvoiced_groups: [{
        contactId: 'c-1', clientName: 'Haven', count: 6, oldestDate: '2026-09-20',
        properties: [
          { propertyId: 1, propertyName: 'A', count: 3, oldestDate: '2026-09-20' },
          { propertyId: 2, propertyName: 'B', count: 1, oldestDate: '2026-09-25' },
          { propertyId: 3, propertyName: 'C', count: 1, oldestDate: '2026-09-26' },
          { propertyId: 4, propertyName: 'D', count: 1, oldestDate: '2026-09-27' },
        ],
      }],
    })
    expect(a).toMatchObject({
      id: 'uninvoiced_cleans_c-1_2026-09-20',
      severity: 'warning',
      category: 'Billing',
      title: 'Cleans not invoiced: Haven',
      actionRoute: '/invoicing',
      requiredView: 'invoicing',
      propertyId: undefined,
    })
    expect(a.description).toBe('6 completed cleans over 7 days old not on any invoice, oldest 2026-09-20. A (3), B (1), C (1), +1 more')
  })

  it('links a single-property group to that property', () => {
    const [a] = billingAlerts({
      ...base,
      uninvoiced_groups: [{
        contactId: null, clientName: null, count: 1, oldestDate: '2026-09-30',
        properties: [{ propertyId: 9, propertyName: 'Solo', count: 1, oldestDate: '2026-09-30' }],
      }],
    })
    expect(a.id).toBe('uninvoiced_cleans_none_2026-09-30')
    expect(a.title).toBe('Cleans not invoiced: No client set')
    expect(a.propertyId).toBe('9')
    expect(a.description).toContain('1 completed clean over')
  })

  it('unpaid invoices: warning, critical past 60 days, keyed per run', () => {
    const unpaid = (runId: string, daysOutstanding: number) => ({
      runId, sentDate: '2026-09-01', daysOutstanding, qboInvoiceNos: [1096, 1097], vendorName: 'Busy Bee',
      periodStart: '2026-08-30', periodEnd: '2026-09-05', clientTotal: 1234,
    })
    const [a, b, c] = billingAlerts({ ...base, unpaid_invoices: [unpaid('r1', 31), unpaid('r2', 60), unpaid('r3', 61)] })
    expect(a).toMatchObject({ id: 'invoice_unpaid_r1', severity: 'warning', title: 'Invoice unpaid 31 days: QBO #1096, #1097' })
    expect(a.description).toContain('$1,234 billed to clients')
    expect(a.description).toContain('mark it paid')
    expect(b.severity).toBe('warning')
    expect(c.severity).toBe('critical')
  })

  it('says so when payment tracking is not set up yet', () => {
    const [a] = billingAlerts({
      ...base,
      payment_tracking: false,
      unpaid_invoices: [{ runId: 'r', sentDate: '2026-09-01', daysOutstanding: 37, qboInvoiceNos: [], vendorName: null, periodStart: null, periodEnd: '2026-09-05', clientTotal: null }],
    })
    expect(a.title).toBe('Invoice unpaid 37 days: Invoice ? to 2026-09-05')
    expect(a.description).toBe('Sent 2026-09-01. Payment tracking is not set up yet, so every exported invoice shows here; dismiss it once paid.')
  })

  it('never writes an em dash', () => {
    const all = billingAlerts({
      ...base,
      uninvoiced_groups: [{ contactId: 'c', clientName: 'X', count: 1, oldestDate: '2026-09-30', properties: [{ propertyId: 1, propertyName: 'P', count: 1, oldestDate: '2026-09-30' }] }],
      unpaid_invoices: [{ runId: 'r', sentDate: '2026-09-01', daysOutstanding: 40, qboInvoiceNos: [1], vendorName: 'V', periodStart: null, periodEnd: null, clientTotal: null }],
    })
    for (const a of all) expect(`${a.title} ${a.description}`).not.toContain(String.fromCharCode(0x2014))
  })
})
