import { describe, it, expect } from 'vitest'
import { buildMonthlySeries, lastTwo } from './perClean'

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
