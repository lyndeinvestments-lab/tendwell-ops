import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LINEN_COSTS,
  calcLinenOnboarding,
  calcLinenRecurringPerClean,
  suggestedLinenFee,
} from '@/lib/linen-onboarding'

const C = DEFAULT_LINEN_COSTS

describe('calcLinenOnboarding', () => {
  it('prices the worked example from the Dzee cost reference', () => {
    // 3-bed cabin (2 king, 1 queen), 3 full baths, 3 sets, no comforters.
    // Doc: (2 x 144.06) + (1 x 130.77) + (3 x 45.38) = 555.03
    const r = calcLinenOnboarding(C, {
      king_beds: 2,
      queen_beds: 1,
      full_baths: 3,
    })
    expect(r.beds).toBeCloseTo(418.89, 2)   // 2*144.06 + 130.77
    expect(r.baths).toBeCloseTo(136.17, 2)  // 3 * 15.13 * 3
    // Doc's own table says 555.03; we land 3c higher because its per-set and
    // 3-set columns are rounded independently. Per-set is authoritative.
    expect(r.subtotal).toBeCloseTo(555.06, 2)
  })

  it('scales beds and baths with the sets stepper', () => {
    const one = calcLinenOnboarding(C, { king_beds: 1, full_baths: 1 }, { sets: 1 })
    const three = calcLinenOnboarding(C, { king_beds: 1, full_baths: 1 }, { sets: 3 })
    expect(one.subtotal).toBeCloseTo(48.02 + 15.13, 2)
    expect(three.subtotal).toBeCloseTo(one.subtotal * 3, 2)
  })

  it('treats full beds as queen bedding', () => {
    const q = calcLinenOnboarding(C, { queen_beds: 2 })
    const f = calcLinenOnboarding(C, { full_beds: 2 })
    expect(f.subtotal).toBeCloseTo(q.subtotal, 2)
  })

  it('adds duvet inserts per bed and does NOT scale them with sets', () => {
    const base = calcLinenOnboarding(C, { king_beds: 2 }, { sets: 3 })
    const withD = calcLinenOnboarding(C, { king_beds: 2 }, { sets: 3, comforters: true })
    expect(withD.comforters).toBeCloseTo(2 * 42.6, 2)

    // Same duvet cost at a different par level.
    const withD1 = calcLinenOnboarding(C, { king_beds: 2 }, { sets: 1, comforters: true })
    expect(withD1.comforters).toBeCloseTo(withD.comforters, 2)
    expect(withD.subtotal).toBeCloseTo(base.subtotal + withD.comforters, 2)
  })

  it('includes pool towels per guest when the property has a hot tub', () => {
    const r = calcLinenOnboarding(C, { king_beds: 2, guest_count: 8, hot_tub: true })
    expect(r.poolTowels).toBeCloseTo(8 * 11.8, 2)
  })

  it('includes pool towels for a pool as well, and never double counts', () => {
    const both = calcLinenOnboarding(C, { guest_count: 4, hot_tub: true, pool: true })
    const onlyPool = calcLinenOnboarding(C, { guest_count: 4, pool: true })
    expect(both.poolTowels).toBeCloseTo(4 * 11.8, 2)
    expect(onlyPool.poolTowels).toBeCloseTo(both.poolTowels, 2)
  })

  it('omits pool towels with no hot tub and no pool', () => {
    const r = calcLinenOnboarding(C, { king_beds: 1, guest_count: 4 })
    expect(r.poolTowels).toBe(0)
  })

  it('falls back to bed-derived sleep count for pool towels when guests are blank', () => {
    // 2 king + 1 twin -> 2*2 + 1 = 5 guests
    const r = calcLinenOnboarding(C, { king_beds: 2, twin_beds: 1, hot_tub: true })
    expect(r.poolTowels).toBeCloseTo(5 * 11.8, 2)
  })

  it('applies the markup percentage to the total, not the subtotal lines', () => {
    const r = calcLinenOnboarding(C, { king_beds: 1 }, { sets: 3, markupPct: 25 })
    expect(r.subtotal).toBeCloseTo(144.06, 2)
    expect(r.markup).toBeCloseTo(36.015, 2)
    expect(r.total).toBeCloseTo(180.075, 2)
  })

  it('defaults to zero markup so the fee ships at cost', () => {
    const r = calcLinenOnboarding(C, { king_beds: 1 })
    expect(r.markup).toBe(0)
    expect(r.total).toBeCloseTo(r.subtotal, 2)
  })

  it('returns zero for a property with no beds or baths', () => {
    const r = calcLinenOnboarding(C, {})
    expect(r.total).toBe(0)
  })

  it('coerces string counts coming off the quote sheet inputs', () => {
    const r = calcLinenOnboarding(C, { king_beds: '2', full_baths: '1' })
    expect(r.subtotal).toBeCloseTo(2 * 144.06 + 45.39, 2)
  })

  it('ignores negative or non-numeric counts rather than crediting the fee', () => {
    const r = calcLinenOnboarding(C, { king_beds: -3, queen_beds: 'abc' as any })
    expect(r.total).toBe(0)
  })

  it('never lets sets below 1 zero out the quote', () => {
    const r = calcLinenOnboarding(C, { king_beds: 1 }, { sets: 0 })
    expect(r.subtotal).toBeCloseTo(48.02, 2)
  })
})

describe('calcLinenRecurringPerClean', () => {
  // Replacement: 2 sets/bed/year, spread over 12 months and 4 cleans/month.
  it('prices a king bed at two sets a year across 48 cleans', () => {
    const r = calcLinenRecurringPerClean(C, { king_beds: 1 })
    expect(r).toBeCloseTo((2 * 48.02) / 12 / 4, 4)
    expect(r).toBeCloseTo(2.0, 2)
  })

  it('prices queen and twin beds off their own per-set cost', () => {
    expect(calcLinenRecurringPerClean(C, { queen_beds: 1 })).toBeCloseTo(1.8163, 3)
    expect(calcLinenRecurringPerClean(C, { twin_beds: 1 })).toBeCloseTo(1.2171, 3)
  })

  it('sums mixed bed sizes', () => {
    const mixed = calcLinenRecurringPerClean(C, { king_beds: 2, queen_beds: 1, twin_beds: 1 })
    const parts =
      calcLinenRecurringPerClean(C, { king_beds: 2 }) +
      calcLinenRecurringPerClean(C, { queen_beds: 1 }) +
      calcLinenRecurringPerClean(C, { twin_beds: 1 })
    expect(mixed).toBeCloseTo(parts, 4)
  })

  it('falls back to the blended per-bed rate when no size breakdown exists', () => {
    // 7 of the 30 properties on the program have number_of_beds but no sizes.
    const r = calcLinenRecurringPerClean(C, { number_of_beds: 3 })
    expect(r).toBeCloseTo((3 * 2 * C.blendedPerSet) / 12 / 4, 4)
  })

  it('prefers the real size breakdown over the blended fallback', () => {
    const sized = calcLinenRecurringPerClean(C, { number_of_beds: 3, king_beds: 3 })
    expect(sized).toBeCloseTo((3 * 2 * 48.02) / 12 / 4, 4)
  })

  it('returns zero when the property has no beds at all', () => {
    expect(calcLinenRecurringPerClean(C, {})).toBe(0)
  })

  it('honours a non-default sets-per-year setting', () => {
    const costs = { ...C, recurringSetsPerYear: 3 }
    expect(calcLinenRecurringPerClean(costs, { king_beds: 1 })).toBeCloseTo((3 * 48.02) / 48, 4)
  })
})

describe('suggestedLinenFee', () => {
  it('uses the manual override when one is set', () => {
    const s = suggestedLinenFee(C, { king_beds: 1 }, { override: 250 })
    expect(s.suggested).toBeCloseTo(144.06, 2)
    expect(s.effective).toBe(250)
    expect(s.isOverridden).toBe(true)
  })

  it('falls back to the suggested figure when the override is blank', () => {
    const s = suggestedLinenFee(C, { king_beds: 1 }, { override: null })
    expect(s.effective).toBeCloseTo(144.06, 2)
    expect(s.isOverridden).toBe(false)
  })

  it('treats an explicit zero override as a real override, not a blank', () => {
    const s = suggestedLinenFee(C, { king_beds: 1 }, { override: 0 })
    expect(s.effective).toBe(0)
    expect(s.isOverridden).toBe(true)
    // The suggestion stays visible so you can see what was waived.
    expect(s.suggested).toBeCloseTo(144.06, 2)
  })

  it('ignores an unparseable override rather than quoting NaN', () => {
    const s = suggestedLinenFee(C, { king_beds: 1 }, { override: 'abc' })
    expect(s.isOverridden).toBe(false)
    expect(s.effective).toBeCloseTo(144.06, 2)
  })
})
