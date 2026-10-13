import { describe, expect, it } from 'vitest'
import { FLAGS, applyReservationRates, checkChargeChanged, lastChargeIndex, type EngineLine } from './_engine'
import type { ReservationRate } from '../../shared/reservation-rates'

// Mark Bulba's PolishedPine2818: normally $340, $300 for listed stays.
const line = (over: Partial<EngineLine>): EngineLine => ({
  lineNo: 1, source: 'vendor_csv', rawPropertyText: 'PolishedPine2818', rawNoteText: null, rawAmount: 160,
  rawDateMentioned: '2026-10-12', splitGroup: null, propertyId: 363, aliasConfidence: 1, matchedTaskId: 'bw-1',
  serviceType: 'Departure Clean', lineKind: 'clean', cleanerPayAmount: 160, clientChargeAmount: 340,
  billingChannel: 'bill_com', flags: [], reviewStatus: 'ok', engineNote: null, serviceDate: '2026-10-12',
  ...over,
} as EngineLine)

const rate: ReservationRate = {
  propertyId: 363, confirmationCode: 'HA-FqRT7TA', checkin: '2026-10-09', checkout: '2026-10-12', standardCharge: 340, specialCharge: 300,
}

describe('applyReservationRates', () => {
  it("bills the special rate on the stay's checkout clean and says why", () => {
    const [out] = applyReservationRates([line({})], [rate])
    expect(out.clientChargeAmount).toBe(300)
    expect(out.cleanerPayAmount).toBe(160)
    expect(out.flags).toContain(FLAGS.SPECIAL_RATE)
    expect(out.reviewStatus).toBe('ok')
    expect(out.engineNote).toBe('Special rate $300.00 for reservation HA-FqRT7TA (stay 10/9–10/12) instead of $340.00.')
  })

  it('leaves deep cleans, extras and other days alone', () => {
    const lines = [
      line({ serviceType: 'Deep Clean', lineKind: 'deep_clean' }),
      line({ serviceType: 'Hot Tub Refresh Requested by Guest', lineKind: 'extra', clientChargeAmount: 50 }),
      line({ serviceDate: '2026-10-09', rawDateMentioned: '2026-10-09' }),
    ]
    expect(applyReservationRates(lines, [rate]).map(l => l.clientChargeAmount)).toEqual([340, 50, 340])
  })

  it('is not flagged as a price change against the usual $340', () => {
    const [out] = applyReservationRates([line({})], [rate])
    const idx = lastChargeIndex([{ propertyId: 363, serviceType: 'Departure Clean', charge: 340, date: '2026-09-27', ref: 'invoice 1261003821' }])
    const checked = checkChargeChanged(out, idx)
    expect(checked.flags).not.toContain(FLAGS.CHARGE_CHANGED_SINCE_LAST_INVOICE)
    expect(checked.reviewStatus).toBe('ok')
  })
})
