import { describe, it, expect } from 'vitest'
import {
  deriveCurrentPreset, partialWindowMonth, rollupEstimates, prorateEstimates, computeVariance,
  generateForecast, FORECAST_PRESETS, FALLBACK_START_PROPERTIES, SEASONAL, type MonthRecord,
} from './forecaster'

// Synthetic months: $100k income, 40% contractor, 10% laundry, 5% supplies.
function month(m: string, tasks?: number, properties?: number, extra: Partial<MonthRecord> = {}): MonthRecord {
  return {
    month: m, cleaningFee: 100_000, contractorPay: 40_000, laundry: 10_000, supplies: 5_000,
    leadership: 3_000, opex: 2_000, tasks, properties, ...extra,
  }
}

describe('deriveCurrentPreset', () => {
  it('derives ratios from the last 3 full months, excluding the current month', () => {
    const months = [
      month('2026-05', 400, 100, { laundry: 50_000 }),
      month('2026-06', 400, 100),
      month('2026-07', 500, 120),
      month('2026-08', 500, 130),
      month('2026-09', 500, 160),
      month('2026-10', 100, 200, { cleaningFee: 10 }),
    ]
    const d = deriveCurrentPreset(months, { asOfMonth: '2026-10', seasonal: false })
    expect(d.sourceMonths).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(d.sliders.contractorPct).toBe(40)
    expect(d.sliders.laundryPct).toBe(10)
    expect(d.sliders.suppliesPct).toBe(5)
    expect(d.sliders.leadership).toBe(3000)
    expect(d.sliders.opex).toBe(2000)
    expect(d.sliders.revPerTask).toBe(200)
    expect(d.sliders.tasksPerProp).toBe(3.7)  // 1500 / 410
    expect(d.sliders.propGrowth).toBe(20)     // (160 - 100) / 3, Jun -> Sep
    expect(d.startProperties).toBe(160)
    expect(d.startMonth).toBe('2026-09')
  })

  it('deseasonalizes tasksPerProp when seasonal multipliers are applied on top', () => {
    const months = [month('2026-07', 460, 100), month('2026-08', 440, 100), month('2026-09', 380, 100)]
    const avgMult = (SEASONAL[7] + SEASONAL[8] + SEASONAL[9]) / 3
    const d = deriveCurrentPreset(months, { asOfMonth: '2026-10', seasonal: true })
    expect(d.sliders.tasksPerProp).toBe(Math.round((1280 / 300 / avgMult) * 10) / 10)
  })

  it('falls back to constants without data', () => {
    const d = deriveCurrentPreset([], { asOfMonth: '2026-10' })
    expect(d.sliders).toEqual(FORECAST_PRESETS.current)
    expect(d.startProperties).toBe(FALLBACK_START_PROPERTIES)
    expect(d.startMonth).toBeNull()
  })

  it('keeps per-clean fallbacks when clean counts are missing', () => {
    const d = deriveCurrentPreset([month('2026-09')], { asOfMonth: '2026-10' })
    expect(d.sliders.contractorPct).toBe(40)
    expect(d.sliders.revPerTask).toBe(FORECAST_PRESETS.current.revPerTask)
    expect(d.sliders.tasksPerProp).toBe(FORECAST_PRESETS.current.tasksPerProp)
    expect(d.sliders.propGrowth).toBe(FORECAST_PRESETS.current.propGrowth)
  })
})

describe('partialWindowMonth', () => {
  it('flags the earliest month when it is the rolling 1-year window start', () => {
    expect(partialWindowMonth(['2025-11', '2025-10', '2026-10'], new Date(2026, 9, 21))).toBe('2025-10')
  })
  it('returns null for month-aligned coverage or on the 1st', () => {
    expect(partialWindowMonth(['2025-07', '2025-10'], new Date(2026, 9, 21))).toBeNull()
    expect(partialWindowMonth(['2025-10'], new Date(2026, 9, 1))).toBeNull()
    expect(partialWindowMonth([], new Date(2026, 9, 21))).toBeNull()
  })
})

describe('rollupEstimates', () => {
  const props = [
    { id: 1, ce_charged: 100, deep_clean_3x_ce: 250, cleaner_pay: 50, est_laundry: 10 },
    { id: 2, ce_charged: 80, cleaner_pay: 40 },
  ]
  it('prices deep cleans at deep_clean_3x_ce, else 3 × ce_charged', () => {
    const r = rollupEstimates(props, { '1': 3, '2': 2 }, { '1': 1, '2': 1 })
    expect(r.revenue).toBe(100 * 2 + 250 + 80 + 240)
    expect(r.contractorPay).toBe(50 * 3 + 40 * 2)
    expect(r.laundry).toBe(30)
  })
  it('treats every task as regular without deep counts', () => {
    expect(rollupEstimates(props, { '1': 2 }).revenue).toBe(200)
  })
})

describe('prorateEstimates', () => {
  it('scales every category and clamps the factor to 0-1', () => {
    const e = { laundry: 10, supplies: 20, inspections: 0, trash: 4, contractorPay: 100, revenue: 200 }
    expect(prorateEstimates(e, 0.5)).toEqual({ laundry: 5, supplies: 10, inspections: 0, trash: 2, contractorPay: 50, revenue: 100 })
    expect(prorateEstimates(e, 2)).toEqual(e)
  })
})

describe('computeVariance', () => {
  it('leaves actual-only rows without a variance', () => {
    const [a, b] = computeVariance([
      { category: 'Laundry', estimated: 100, actual: 120 },
      { category: 'Leadership', estimated: null, actual: 3000 },
    ])
    expect(a).toMatchObject({ variance: 20, variancePct: 20, favorable: false })
    expect(b).toMatchObject({ variance: null, variancePct: null, favorable: null })
  })
})

describe('generateForecast', () => {
  it('grows properties from the start count', () => {
    const f = generateForecast(FORECAST_PRESETS.current, { startProperties: 276, startMonth: '2026-10', horizon: 2, seasonal: false })
    expect(f.map(m => m.properties)).toEqual([306, 336])
    expect(f[0].tasks).toBe(Math.round(306 * 4.2))
  })
})
