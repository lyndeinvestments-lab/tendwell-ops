import { describe, expect, it } from 'vitest'
import { shouldPreserveInvoiceLine } from './_lib'

describe('shouldPreserveInvoiceLine', () => {
  it('preserves human-resolved and manual lines', () => {
    expect(shouldPreserveInvoiceLine({ review_status: 'resolved' })).toBe(true)
    expect(shouldPreserveInvoiceLine({ source: 'manual' })).toBe(true)
  })

  it('preserves human-excluded lines so re-reconcile does not revive them', () => {
    expect(shouldPreserveInvoiceLine({ review_status: 'excluded' })).toBe(true)
    expect(shouldPreserveInvoiceLine({ line_kind: 'excluded' })).toBe(true)
  })

  it('does not preserve ordinary engine lines', () => {
    expect(shouldPreserveInvoiceLine({ review_status: 'ok', source: 'vendor', line_kind: 'clean' })).toBe(false)
    expect(shouldPreserveInvoiceLine({ review_status: 'needs_review' })).toBe(false)
  })
})
