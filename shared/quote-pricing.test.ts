import { describe, expect, it } from 'vitest'
import { cleanerMinForBedrooms, suggestQuotePricing } from './quote-pricing'

describe('suggestQuotePricing', () => {
  it('prices from square footage the way the Add Quote dialog does', () => {
    // 1563 Grant Rd: 3 bed, 1,946 sq ft (the Slack request that prompted this).
    const p = suggestQuotePricing({ squareFootage: 1946, bedrooms: 3 })
    expect(p.ceCharged).toBe(272.44)
    expect(p.cleanerPay).toBe(136.22)
    expect(p.ceSource).toBe('sqft')
    expect(p.paySource).toBe('ce_share')
    expect(p.cleanerMin).toBe(130)
    expect(p.belowCleanerMin).toBe(false)
    expect(p.marginGuardCharge).toBeNull()
  })

  it('an explicit charge and pay always win over the suggestion', () => {
    const p = suggestQuotePricing({ squareFootage: 1946, ceCharged: 300, cleanerPay: 150 })
    expect(p).toMatchObject({ ceCharged: 300, cleanerPay: 150, ceSource: 'given', paySource: 'given' })
  })

  it('derives pay from a given charge', () => {
    const p = suggestQuotePricing({ ceCharged: 250 })
    expect(p.cleanerPay).toBe(125)
    expect(p.paySource).toBe('ce_share')
  })

  it('leaves both empty with nothing to price from', () => {
    const p = suggestQuotePricing({ bedrooms: 3 })
    expect(p).toMatchObject({ ceCharged: null, cleanerPay: null, ceSource: 'none', paySource: 'none' })
  })

  it('treats zero / negative inputs as absent', () => {
    expect(suggestQuotePricing({ squareFootage: 0, ceCharged: -5 }).ceCharged).toBeNull()
  })

  it('flags pay under the bedroom minimum without changing it', () => {
    const p = suggestQuotePricing({ squareFootage: 1500, bedrooms: 4 }) // ce 210, pay 105 < 160
    expect(p.cleanerPay).toBe(105)
    expect(p.belowCleanerMin).toBe(true)
  })

  it('suggests a higher charge when pay exceeds 55% of it', () => {
    const p = suggestQuotePricing({ ceCharged: 200, cleanerPay: 130 })
    expect(p.marginGuardCharge).toBe(236.36)
  })
})

describe('cleanerMinForBedrooms', () => {
  it('returns null outside the reference table', () => {
    expect(cleanerMinForBedrooms(7)).toBeNull()
    expect(cleanerMinForBedrooms(null)).toBeNull()
    expect(cleanerMinForBedrooms(1)).toBe(80)
  })
})
