import { describe, expect, it } from 'vitest'
import {
  isRateEligibleService,
  matchRateProperty,
  parseRateRows,
  parseSheetDate,
  planReservationRates,
  specialRateNote,
  type ReservationRate,
} from './reservation-rates'

// Shaped like Mark Bulba's list (TW Discounted Cleaning Reservations, 2026-10-12).
const heavenly = (code: string, checkin: string, checkout: string): ReservationRate =>
  ({ propertyId: 360, confirmationCode: code, checkin, checkout, standardCharge: 180, specialCharge: 155 })

describe('planReservationRates', () => {
  it('discounts the clean on the checkout day, not the check-in day', () => {
    const rates = [heavenly('GY-D94htZfk', '2026-10-10', '2026-10-13')]
    const plan = planReservationRates([
      { key: 'turn-10-10', propertyId: 360, date: '2026-10-10' }, // previous guest's checkout
      { key: 'dep-10-13', propertyId: 360, date: '2026-10-13' },
    ], rates)
    expect([...plan.keys()]).toEqual(['dep-10-13'])
  })

  it('takes the next morning only when nothing was cleaned on checkout day', () => {
    const r = heavenly('HMFATCCR28', '2026-09-27', '2026-10-01')
    expect([...planReservationRates([{ key: 'a', propertyId: 360, date: '2026-10-02' }], [r]).keys()]).toEqual(['a'])
    expect(planReservationRates([{ key: 'a', propertyId: 360, date: '2026-10-03' }], [r]).size).toBe(0)
  })

  it("never lets a late clean steal another stay's checkout-day clean", () => {
    // Stay A checks out 8/21 with no clean that day; stay B checks out 8/22 and
    // is cleaned 8/22. The 8/22 clean is B's.
    const a = heavenly('A', '2026-08-15', '2026-08-21')
    const b = heavenly('B', '2026-08-21', '2026-08-22')
    const plan = planReservationRates([{ key: 'c', propertyId: 360, date: '2026-08-22' }], [a, b])
    expect(plan.get('c')?.confirmationCode).toBe('B')
  })

  it('discounts one clean per reservation, and ignores other properties', () => {
    const r = heavenly('X', '2026-10-01', '2026-10-05')
    const plan = planReservationRates([
      { key: 'a', propertyId: 360, date: '2026-10-05' },
      { key: 'b', propertyId: 360, date: '2026-10-05' },
      { key: 'c', propertyId: 361, date: '2026-10-05' },
    ], [r])
    expect([...plan.keys()]).toEqual(['a'])
  })
})

describe('isRateEligibleService', () => {
  it('covers turn and departure cleans only', () => {
    expect(isRateEligibleService('Turn Clean')).toBe(true)
    expect(isRateEligibleService('Departure Clean')).toBe(true)
    expect(isRateEligibleService('Deep Clean')).toBe(false)
    expect(isRateEligibleService('Onboarding Clean')).toBe(false)
    expect(isRateEligibleService('Hot Tub Refresh Requested by Guest')).toBe(false)
  })
})

describe('specialRateNote', () => {
  it('names the reservation and the usual price', () => {
    expect(specialRateNote(heavenly('GY-D94htZfk', '2026-10-10', '2026-10-13'), 180))
      .toBe('Special rate $155.00 for reservation GY-D94htZfk (stay 10/10–10/13) instead of $180.00.')
  })
})

describe('importing the list', () => {
  const sheet = [
    ["LISTING'S NICKNAME", 'CONFIRMATION CODE', 'CHECK-IN', 'CHECK-OUT', "LISTING'S ADDRESS", 'TW Rate', 'TW Special Rate'],
    ['HeavenlyBliss2936', 'GY-D94htZfk', '2026-10-10 04:00 PM', '2026-10-13 10:00 AM', '2936 Valley Springs Way, Sevierville, Tennessee 37862, United States', '180', '155'],
    ['PolishedPine2818', 'HA-FqRT7TA', '10/9/2026', 46307, '2818 Ridge Creek Circle, Sevierville, Tennessee 37876, United States', 340, 300],
    ['Bad', 'NODATE', 'soon', '', '', '', '100'],
  ]

  it('reads rows, dates in every format, and reports bad ones', () => {
    const { rows, problems } = parseRateRows(sheet)
    expect(rows.map(r => [r.confirmationCode, r.checkin, r.checkout, r.standardCharge, r.specialCharge])).toEqual([
      ['GY-D94htZfk', '2026-10-10', '2026-10-13', 180, 155],
      ['HA-FqRT7TA', '2026-10-09', '2026-10-12', 340, 300],
    ])
    expect(problems).toEqual([{ row: 4, message: 'NODATE: check-in or check-out is not a date.' }])
  })

  it('refuses a file without the needed columns', () => {
    expect(parseRateRows([['Name', 'Amount']]).problems.length).toBe(4)
  })

  it('parses Excel serial dates', () => {
    expect(parseSheetDate(46307)).toBe('2026-10-12')
  })

  const props = [
    { id: 360, name: 'HeavenlyBliss', address: '2936 Valley Springs Way, Sevierville, TN 37862' },
    { id: 362, name: 'EasyStreet2882', address: '2882 Easy St, Sevierville, TN 37862' },
    { id: 363, name: 'PolishedPine2818', address: '2818 Ridge Creek Cir, Sevierville, TN 37876' },
  ]

  it('matches the property by listing name, then by street', () => {
    expect(matchRateProperty({ nickname: 'EasyStreet2882', address: null }, props)?.id).toBe(362)
    expect(matchRateProperty({ nickname: 'HeavenlyBliss2936', address: null }, props)?.id).toBe(360)
    expect(matchRateProperty({ nickname: 'Unknown', address: '2818 Ridge Creek Circle, Sevierville' }, props)?.id).toBe(363)
    expect(matchRateProperty({ nickname: 'Nope', address: '1 Nowhere Rd' }, props)).toBeNull()
  })
})
