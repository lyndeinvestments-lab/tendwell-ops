import { describe, expect, it } from 'vitest'
import { confirmMatches, summarizeImpact, type DeleteImpact } from './permanent-delete'

const base: DeleteImpact = {
  kind: 'property',
  id: 711,
  name: 'ZZ Delete Test 9999',
  erased: {},
  unlinked: {},
  blocked_by_invoices: 0,
}

describe('summarizeImpact', () => {
  it('treats a record with nothing attached as a clean duplicate', () => {
    const s = summarizeImpact(base)
    expect(s.isClean).toBe(true)
    expect(s.blocked).toBe(false)
  })

  it('orders erased history largest first and drops zero counts', () => {
    const s = summarizeImpact({
      ...base,
      erased: { property_notes: 1, cleaning_history: 42, inspections: 3, tasks: 0 },
    })
    expect(s.erased).toEqual([
      { table: 'cleaning_history', count: 42 },
      { table: 'inspections', count: 3 },
      { table: 'property_notes', count: 1 },
    ])
    expect(s.isClean).toBe(false)
  })

  it('blocks when invoice lines exist (real case: Ashley May 1619, 24 lines)', () => {
    const s = summarizeImpact({ ...base, blocked_by_invoices: 24 })
    expect(s.blocked).toBe(true)
    expect(s.invoiceLines).toBe(24)
  })

  it('a client with linked properties is not clean (they will be unlinked)', () => {
    const s = summarizeImpact({
      ...base,
      kind: 'contact',
      linked_properties: [{ id: 711, name: 'ZZ Delete Test 9999', stage: 'Lead' }],
    })
    expect(s.isClean).toBe(false)
    expect(s.linkedProperties).toHaveLength(1)
  })

  it('tolerates missing maps from an older server', () => {
    const s = summarizeImpact({ ...base, erased: undefined as never, unlinked: undefined as never })
    expect(s.erased).toEqual([])
    expect(s.unlinked).toEqual([])
  })
})

describe('confirmMatches', () => {
  it('mirrors the server: trimmed and case-insensitive', () => {
    expect(confirmMatches('  zz delete TEST 9999 ', 'ZZ Delete Test 9999')).toBe(true)
  })
  it('rejects a partial or empty name', () => {
    expect(confirmMatches('ZZ Delete', 'ZZ Delete Test 9999')).toBe(false)
    expect(confirmMatches('   ', '   ')).toBe(false)
  })
})
