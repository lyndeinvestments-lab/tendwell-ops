import { describe, it, expect } from 'vitest'
import { monthlyFigures, resolveCleansPerMonth, rollupMonthly } from './monthlyPace'

describe('resolveCleansPerMonth', () => {
  it('uses the live 90-day rate when the property has clean history', () => {
    expect(resolveCleansPerMonth({ months_with_data: 4, avg_cleans_per_month: '6.3' }, 2)).toEqual({ cleansPerMonth: 6.3, auto: true })
  })
  it('keeps a live rate of 0 instead of falling back to the manual value', () => {
    expect(resolveCleansPerMonth({ months_with_data: 2, avg_cleans_per_month: 0 }, 4.33)).toEqual({ cleansPerMonth: 0, auto: true })
  })
  it('falls back to the stored value without clean history', () => {
    expect(resolveCleansPerMonth(undefined, 2.17)).toEqual({ cleansPerMonth: 2.17, auto: false })
    expect(resolveCleansPerMonth({ months_with_data: 0, avg_cleans_per_month: 5 }, '1')).toEqual({ cleansPerMonth: 1, auto: false })
    expect(resolveCleansPerMonth(null, null)).toEqual({ cleansPerMonth: null, auto: false })
  })
})

describe('monthlyFigures', () => {
  it('multiplies per-clean rates by cleans per month', () => {
    const m = monthlyFigures({ ce_charged: 200, total_estimated_cost: 150 }, 4)!
    expect(m.revenue).toBe(800)
    expect(m.cost).toBe(600)
    expect(m.profit).toBe(200)
  })
  it('returns null without cleans per month', () => {
    expect(monthlyFigures({ ce_charged: 200, total_estimated_cost: 150 }, 0)).toBeNull()
    expect(monthlyFigures({ ce_charged: 200, total_estimated_cost: 150 }, null)).toBeNull()
  })
})

describe('rollupMonthly', () => {
  it('sums children and weights the margin by revenue', () => {
    const r = rollupMonthly([
      { revenue: 1000, cost: 700, profit: 300 },
      { revenue: 100, cost: 150, profit: -50 },
      null,
    ])
    expect(r.revenue).toBe(1100)
    expect(r.cost).toBe(850)
    expect(r.profit).toBe(250)
    // unweighted mean of 30% and -50% would be -10%
    expect(r.marginPct).toBeCloseTo(22.73, 2)
    expect(r.included).toBe(2)
    expect(r.withoutCleans).toBe(1)
  })
  it('has no margin when there is no revenue', () => {
    expect(rollupMonthly([null]).marginPct).toBeNull()
  })
})
