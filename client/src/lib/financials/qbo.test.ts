import { describe, it, expect } from 'vitest'
import { parseQboMonthly } from './qbo'

const raw = {
  updated_at: '2026-06-27T12:00:00Z',
  monthly: {
    'Jan 2026': { income: 70849.75, cogs: 60675.01, expenses: 1802.88, netIncome: 8371.86 },
    'Jun 2026': { income: 130399.52, cogs: 99736.97, expenses: 1747.24, netIncome: 28915.31 },
  },
}

describe('parseQboMonthly', () => {
  it('normalizes keys to YYYY-MM, sorts, computes totals/margin', () => {
    const { months, connected, updatedAt } = parseQboMonthly(raw)
    expect(connected).toBe(true)
    expect(updatedAt).toBe('2026-06-27T12:00:00Z')
    expect(months[0].ym).toBe('2026-01')
    expect(months[1].ym).toBe('2026-06')
    expect(months[1].totalExpenses).toBeCloseTo(101484.21, 2)
    expect(months[1].marginPct).toBeCloseTo(22.17, 1)
  })
  it('handles missing blob', () => {
    expect(parseQboMonthly(null)).toEqual({ months: [], updatedAt: null, connected: false })
  })
})
