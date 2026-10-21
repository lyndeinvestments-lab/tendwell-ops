import { describe, it, expect } from 'vitest'
import { findDuplicatePairs, normalizeAddress, pairKey } from './property-duplicates'

const p = (id: number, name: string, address: string | null) => ({ id, name, address })

describe('findDuplicatePairs', () => {
  it('does not flag different houses that share a name prefix and identical pricing', () => {
    const rows = [
      p(1, 'HPM-3750 Old Thomas Cross Road', '3750 Old Thomas Cross Rd, Sevierville, TN 37876, USA'),
      p(2, 'HPM-3754 Old Thomas Cross Road', '3754 Old Thomas Cross Rd, Sevierville, TN 37876, USA'),
      p(3, 'HPM-1602 Bear Valley Rd', '1602 Bear Valley Rd, Sevierville, TN 37862, USA'),
    ]
    expect(findDuplicatePairs(rows)).toEqual([])
  })

  it('flags the same name entered twice regardless of case and punctuation', () => {
    const rows = [p(1, 'Chad Williams 223-202', null), p(2, 'chad williams 223 202', null)]
    const pairs = findDuplicatePairs(rows)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].reason).toBe('name')
  })

  it('flags the same address under two names', () => {
    const rows = [
      p(1, 'Jason and Marsha Paladino 4420', '4420 Stackstone Rd, Sevierville, TN 37862, USA'),
      p(2, 'Jason Paladino 4420', '4420 Stackstone Rd., Sevierville, TN 37862'),
    ]
    const pairs = findDuplicatePairs(rows)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].reason).toBe('address')
  })

  it('does not flag separate units at one address when the names carry different numbers', () => {
    const rows = [
      p(1, 'HPM-744 Powdermill Road Unit 2', '744 Powdermill Rd, Gatlinburg, TN 37738, USA'),
      p(2, 'HPM-744 Powdermill Road Unit 3', '744 Powdermill Rd, Gatlinburg, TN 37738, USA'),
    ]
    expect(findDuplicatePairs(rows)).toEqual([])
  })

  it('ignores blank names and addresses', () => {
    expect(findDuplicatePairs([p(1, '', ''), p(2, '', '')])).toEqual([])
  })
})

describe('helpers', () => {
  it('normalizeAddress drops punctuation and the country', () => {
    expect(normalizeAddress('4420 Stackstone Rd., Sevierville, TN 37862, USA')).toBe('4420 stackstone rd sevierville tn 37862')
  })
  it('pairKey is order-independent', () => {
    expect(pairKey(9, 3)).toBe(pairKey(3, 9))
  })
})
