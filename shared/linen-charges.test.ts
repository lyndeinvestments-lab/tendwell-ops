import { describe, expect, it } from 'vitest'
import {
  chargeTotals, isLinenChargeLine, linenChargeLabel, linenLineNote, linenPropertiesMissingDecision, planLinenInstallment, splitInstallments,
  type PlanInstallment,
} from './linen-charges'

describe('splitInstallments', () => {
  it('splits to the cent, the last payment carrying the remainder (Hostimo thirds)', () => {
    expect(splitInstallments(21741.28, 3)).toEqual([7247.09, 7247.09, 7247.10])
    expect(splitInstallments(1835, 3)).toEqual([611.66, 611.66, 611.68])
  })

  it('one payment is the whole amount', () => {
    expect(splitInstallments(1737.72, 1)).toEqual([1737.72])
  })

  it('always adds back up to the amount', () => {
    for (const [amt, n] of [[100, 3], [0.05, 2], [999.99, 7], [21741.28, 12]] as const) {
      const parts = splitInstallments(amt, n)
      expect(parts).toHaveLength(n)
      expect(Math.round(parts.reduce((a, b) => a + b, 0) * 100)).toBe(Math.round(amt * 100))
    }
  })

  it('refuses nonsense', () => {
    expect(splitInstallments(0, 3)).toEqual([])
    expect(splitInstallments(100, 0)).toEqual([])
    expect(splitInstallments(Number.NaN, 1)).toEqual([])
  })
})

describe('planLinenInstallment', () => {
  const inst = (seq: number, status: PlanInstallment['status'], billFrom: string | null = null, serviceMonth: string | null = null): PlanInstallment =>
    ({ seq, status, billFrom, serviceMonth })

  it('bills nothing when the run does not bill the property', () => {
    expect(planLinenInstallment({ installments: [inst(1, 'pending')], runMonth: null, today: '2026-10-20' }))
      .toEqual({ skip: 'not_on_run' })
  })

  it('bills the first pending payment on the first invoice', () => {
    expect(planLinenInstallment({ installments: [inst(1, 'pending')], runMonth: '2026-10', today: '2026-10-20' }))
      .toEqual({ bill: inst(1, 'pending') })
  })

  it('an undated payment plan bills at most one payment per service month', () => {
    const installments = [inst(1, 'billed', null, '2026-10'), inst(2, 'pending'), inst(3, 'pending')]
    expect(planLinenInstallment({ installments, runMonth: '2026-10', today: '2026-10-27' }))
      .toEqual({ skip: 'already_billed_this_month' })
    expect(planLinenInstallment({ installments, runMonth: '2026-11', today: '2026-11-02' }))
      .toEqual({ bill: inst(2, 'pending') })
  })

  it('a dated payment waits for its date, then bills even in a month that already had one (Hostimo)', () => {
    // Payment 1 went out by hand on invoice 1360; 2 is held to 10/26, 3 to 11/30.
    const installments = [inst(1, 'billed_external'), inst(2, 'pending', '2026-10-26'), inst(3, 'pending', '2026-11-30')]
    expect(planLinenInstallment({ installments, runMonth: '2026-10', today: '2026-10-20' }))
      .toEqual({ skip: 'held_until' })
    expect(planLinenInstallment({ installments, runMonth: '2026-10', today: '2026-10-26' }))
      .toEqual({ bill: inst(2, 'pending', '2026-10-26') })
  })

  it('payments go out in order: a later payment never jumps a held one', () => {
    const installments = [inst(2, 'pending', '2026-11-30'), inst(3, 'pending')]
    expect(planLinenInstallment({ installments, runMonth: '2026-11', today: '2026-11-10' }))
      .toEqual({ skip: 'held_until' })
  })

  it('nothing pending means nothing to bill', () => {
    expect(planLinenInstallment({ installments: [inst(1, 'billed', null, '2026-10')], runMonth: '2026-11', today: '2026-11-02' }))
      .toEqual({ skip: 'nothing_pending' })
  })
})

describe('labels and lines', () => {
  it('names what was stocked', () => {
    expect(linenChargeLabel(3, false)).toBe('3 sets')
    expect(linenChargeLabel(1, true)).toBe('1 set + comforters')
    expect(linenChargeLabel(null, false)).toBe('')
  })

  it('a payment plan says which payment it is; a single payment does not', () => {
    expect(linenLineNote('3 sets', 2, 3)).toBe('3 sets, payment 2 of 3')
    expect(linenLineNote('3 sets', 1, 1)).toBe('3 sets')
    expect(linenLineNote(null, 1, 3)).toBe('payment 1 of 3')
  })

  it('recognises a linen charge line by its flag', () => {
    expect(isLinenChargeLine({ flags: ['linen_charge'] })).toBe(true)
    expect(isLinenChargeLine({ flags: ['credit'] })).toBe(false)
    expect(isLinenChargeLine({ flags: null })).toBe(false)
  })
})

describe('linenPropertiesMissingDecision', () => {
  const props = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
  const firstClean = new Map([[1, '2026-10-25'], [2, '2026-09-17'], [3, '2026-10-21']])

  it('flags properties first cleaned since go-live that have no decision', () => {
    expect(linenPropertiesMissingDecision(props, new Set([3]), firstClean).map(r => r.property.id)).toEqual([1])
  })

  it('never flags a property that has not been cleaned, or was cleaned before go-live', () => {
    const ids = linenPropertiesMissingDecision(props, new Set(), firstClean).map(r => r.property.id)
    expect(ids).not.toContain(4)
    expect(ids).not.toContain(2)
  })
})

describe('chargeTotals', () => {
  it('counts payments billed in or outside Ops as billed, pending as owed', () => {
    expect(chargeTotals([
      { seq: 1, amount: '7247.09', status: 'billed_external' },
      { seq: 2, amount: 7247.09, status: 'pending', bill_from: '2026-10-26' },
      { seq: 3, amount: 7247.10, status: 'pending', bill_from: '2026-11-30' },
    ])).toEqual({ billed: 7247.09, owed: 14494.19, next: { seq: 2, amount: 7247.09, billFrom: '2026-10-26' } })
  })
})
