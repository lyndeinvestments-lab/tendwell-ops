import { describe, it, expect } from 'vitest'
import { buildMonthlySeries, lastTwo, splitLatestMonths, sumMonths } from './perClean'

const qbo = [
  { ym: '2026-05', income: 142235.52, cogs: 127773.65, expenses: 2257.96, totalExpenses: 130031.61, netIncome: 12203.91, marginPct: 8.58 },
  { ym: '2026-06', income: 130399.52, cogs: 99736.97, expenses: 1747.24, totalExpenses: 101484.21, netIncome: 28915.31, marginPct: 22.17 },
]
describe('buildMonthlySeries', () => {
  it('joins cleans and computes per-clean economics', () => {
    const s = buildMonthlySeries(qbo as any, [{ month: '2026-06', cleans: 305 }], 2)
    const jun = s.find(r => r.ym === '2026-06')!
    expect(jun.cleans).toBe(305)
    expect(jun.revPerClean).toBeCloseTo(427.54, 1)
    const may = s.find(r => r.ym === '2026-05')!
    expect(may.cleans).toBe(0)
    expect(may.revPerClean).toBeNull()  // divide-by-zero guard
  })
  it('lastTwo returns the final two months', () => {
    const s = buildMonthlySeries(qbo as any, [], 2)
    const { curr, prev } = lastTwo(s)
    expect(curr?.ym).toBe('2026-06')
    expect(prev?.ym).toBe('2026-05')
  })
})

describe('splitLatestMonths', () => {
  const s = buildMonthlySeries(qbo as any, [], 2)
  it('treats the current calendar month as partial and compares the two months before it', () => {
    const { curr, prev, partial } = splitLatestMonths(s, '2026-06')
    expect(partial?.ym).toBe('2026-06')
    expect(curr?.ym).toBe('2026-05')
    expect(prev).toBeNull()
  })
  it('has no partial month once the current month is not in the data yet', () => {
    const { curr, prev, partial } = splitLatestMonths(s, '2026-07')
    expect(partial).toBeNull()
    expect(curr?.ym).toBe('2026-06')
    expect(prev?.ym).toBe('2026-05')
  })
})

describe('sumMonths', () => {
  it('totals income, costs and net, and derives margin and revenue per clean', () => {
    const s = buildMonthlySeries(qbo as any, [{ month: '2026-05', cleans: 100 }, { month: '2026-06', cleans: 300 }], 2)
    const t = sumMonths(s)
    expect(t.months).toBe(2)
    expect(t.income).toBeCloseTo(272635.04, 2)
    expect(t.netIncome).toBeCloseTo(41119.22, 2)
    expect(t.marginPct).toBeCloseTo(15.08, 1)
    expect(t.cleans).toBe(400)
    expect(t.revPerClean).toBeCloseTo(681.59, 1)
  })
  it('returns null ratios for an empty period', () => {
    const t = sumMonths([])
    expect(t.marginPct).toBeNull()
    expect(t.revPerClean).toBeNull()
  })
})
