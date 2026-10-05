import { describe, expect, it } from 'vitest'
import { lineIssues, type InvoiceLine } from './invoices'

// Only the fields lineIssues reads; the rest of the row is irrelevant here.
const line = (over: Partial<InvoiceLine>): InvoiceLine =>
  ({
    line_kind: 'extra',
    review_status: 'resolved',
    billing_channel: 'qbo_haven',
    property_id: 1,
    raw_amount: 100,
    cleaner_pay_amount: 100,
    flags: [],
    ...over,
  }) as InvoiceLine

describe('lineIssues — property-less lines', () => {
  it('a QBO/Haven line needs no property (courier reimbursement, invoice 1261003821)', () => {
    expect(lineIssues(line({ property_id: null, billing_channel: 'qbo_haven' }))).toEqual([])
  })

  it('a bill.com line still needs a property — the client comes from it', () => {
    expect(lineIssues(line({ property_id: null, billing_channel: 'bill_com' }))).toContain(
      'No property assigned (or bill it to QuickBooks / Haven)',
    )
  })

  it('an unrouted, property-less line reports both blockers', () => {
    const issues = lineIssues(line({ property_id: null, billing_channel: 'none' }))
    expect(issues).toHaveLength(2)
  })

  it('a Tendwell expense needs neither', () => {
    expect(lineIssues(line({ line_kind: 'operating_expense', property_id: null, billing_channel: 'none' }))).toEqual([])
  })
})
