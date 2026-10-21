import { describe, it, expect } from 'vitest'
import {
  inspectionRatePct, monthKey, qboRowToMonthRecord, propertiesPerMonth, cleansPerMonth,
  cleansByPropertyFromEstimate, deepCleansByPropertyFromEstimate, cutoverMonth,
} from './clean-sources'
import { computeDerived } from '@/lib/forecaster'

describe('inspectionRatePct', () => {
  it('divides inspections by cleans, two decimals', () => {
    expect(inspectionRatePct(25, 200)).toBe(12.5)
    expect(inspectionRatePct(1, 3)).toBe(33.33)
  })
  it('is 0 with no cleans or bad input', () => {
    expect(inspectionRatePct(5, 0)).toBe(0)
    expect(inspectionRatePct(NaN, 10)).toBe(0)
  })
})

describe('monthKey', () => {
  it('trims a date to YYYY-MM', () => {
    expect(monthKey('2026-01-01')).toBe('2026-01')
    expect(monthKey('2026-01-01T00:00:00Z')).toBe('2026-01')
  })
})

describe('qboRowToMonthRecord', () => {
  // Synthetic P&L month.
  const row = {
    month: '2026-01-01',
    total_income: '1000',
    total_cogs: 800,
    total_expenses: 50,
    income_breakdown: { 'Services': 100, 'Turn Clean': 600, 'Departure Clean': 250, 'Onboarding Fee': 50 },
    cogs_breakdown: { 'Laundry': 100, 'Leadership Pay': 40, 'Cleaning Supplies': 60, 'Cleaning Contractor Pay': 500, 'Software': 100 },
  }

  it('keeps QuickBooks totals exactly (revenue, COGS, net income)', () => {
    const d = computeDerived(qboRowToMonthRecord(row, 12, 3))
    expect(d.revenue).toBeCloseTo(1000, 6)
    expect(d.cogs).toBeCloseTo(800, 6)
    expect(d.netIncome).toBeCloseTo(150, 6)
    expect(d.tasks).toBe(12)
    expect(d.properties).toBe(3)
    expect(d.month).toBe('2026-01')
  })

  it('splits accounts into categories', () => {
    const r = qboRowToMonthRecord(row)
    expect(r.services).toBe(100)
    expect(r.onboardingRevenue).toBe(50)
    expect(r.cleaningFee).toBe(850)
    expect(r.contractorPay).toBe(500)
    expect(r.laundry).toBe(100)
    expect(r.leadership).toBe(40)
    expect(r.supplies).toBe(60)
    expect(r.otherCOGS).toBe(100)
  })

  it('tolerates missing breakdowns and nulls', () => {
    const r = qboRowToMonthRecord({ month: '2025-06-01', total_income: null, total_cogs: 100, total_expenses: null })
    const d = computeDerived(r)
    expect(d.revenue).toBe(0)
    expect(d.cogs).toBe(100)
    expect(r.otherCOGS).toBe(100)
  })
})

describe('propertiesPerMonth', () => {
  it('counts distinct properties with cleans, per month', () => {
    const m = propertiesPerMonth([
      { property_id: 1, month: '2026-01-01', cleans: 3 },
      { property_id: 1, month: '2026-01-01', cleans: 1 },
      { property_id: 2, month: '2026-01-01', cleans: 0 },
      { property_id: 3, month: '2026-02-01', cleans: '2' },
    ])
    expect(m.get('2026-01')).toBe(1)
    expect(m.get('2026-02')).toBe(1)
  })
})

describe('cleansPerMonth', () => {
  it('sums cleans per month and ignores zero rows', () => {
    const m = cleansPerMonth([
      { month: '2026-01-01', cleans: 3 },
      { month: '2026-01-01', cleans: '2' },
      { month: '2026-02-01', cleans: 0 },
    ])
    expect(m.get('2026-01')).toBe(5)
    expect(m.has('2026-02')).toBe(false)
  })
})

describe('cleansByPropertyFromEstimate', () => {
  it('adds regular and deep cleans per property and skips empties', () => {
    expect(cleansByPropertyFromEstimate([
      { property_id: 7, cleans: 3, deep_cleans: 1 },
      { property_id: '8', cleans: '0', deep_cleans: 0 },
      { property_id: null, cleans: 5 },
    ])).toEqual({ '7': 4 })
    expect(cleansByPropertyFromEstimate(null)).toEqual({})
  })
})

describe('deepCleansByPropertyFromEstimate', () => {
  it('keeps only deep cleans per property', () => {
    expect(deepCleansByPropertyFromEstimate([
      { property_id: 7, cleans: 3, deep_cleans: 1 },
      { property_id: '8', cleans: 2, deep_cleans: '0' },
      { property_id: null, deep_cleans: 5 },
    ])).toEqual({ '7': 1 })
    expect(deepCleansByPropertyFromEstimate(undefined)).toEqual({})
  })
})

describe('cutoverMonth', () => {
  it('returns YYYY-MM for a real cutover and null for the sentinel', () => {
    expect(cutoverMonth('2026-10-01')).toBe('2026-10')
    expect(cutoverMonth('9999-12-01')).toBeNull()
    expect(cutoverMonth(null)).toBeNull()
    expect(cutoverMonth('bad')).toBeNull()
  })
})
