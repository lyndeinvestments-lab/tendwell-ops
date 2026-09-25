import { describe, expect, it } from 'vitest'
import { summarizeDamaged, isOpenStatus, itemFallbackLabel, type DamagedLinen } from './damaged-linens'

function row(p: Partial<DamagedLinen>): DamagedLinen {
  return {
    id: Math.random().toString(36),
    property_id: 1,
    item_type: 'bath_towel',
    quantity: 1,
    damage_type: 'stain',
    status: 'reported',
    found_date: '2026-09-20',
    found_by: null,
    cleaner_id: null,
    estimated_cost: null,
    charge_back: false,
    notes: null,
    photo_urls: [],
    resolved_at: null,
    resolved_by: null,
    created_by: null,
    created_at: '2026-09-20T00:00:00Z',
    updated_at: '2026-09-20T00:00:00Z',
    property: { id: 1, name: 'Cabin A' },
    ...p,
  }
}

describe('summarizeDamaged', () => {
  it('counts units, not rows, and splits open vs resolved', () => {
    const s = summarizeDamaged([
      row({ quantity: 6, status: 'reported', charge_back: true }),
      row({ quantity: 2, status: 'treating' }),
      row({ quantity: 3, status: 'discarded', estimated_cost: 42.5 }),
      row({ quantity: 1, status: 'restored' }),
    ])
    expect(s.openUnits).toBe(8)
    expect(s.openReports).toBe(2)
    expect(s.discardedUnits).toBe(3)
    expect(s.restoredUnits).toBe(1)
    expect(s.restoreRate).toBeCloseTo(0.25)
    expect(s.estimatedLoss).toBe(42.5)
    expect(s.chargeBackOpen).toBe(1)
  })

  it('only counts loss on discarded rows', () => {
    const s = summarizeDamaged([row({ status: 'reported', estimated_cost: 100 })])
    expect(s.estimatedLoss).toBe(0)
  })

  it('returns null restore rate when nothing is resolved', () => {
    expect(summarizeDamaged([row({})]).restoreRate).toBeNull()
    expect(summarizeDamaged([]).restoreRate).toBeNull()
  })

  it('ranks hot-spot properties and items by units', () => {
    const s = summarizeDamaged([
      row({ property_id: 1, property: { id: 1, name: 'Cabin A' }, quantity: 2 }),
      row({ property_id: 2, property: { id: 2, name: 'Cabin B' }, quantity: 5, item_type: 'king_flat' }),
      row({ property_id: null, property: null, quantity: 1 }),
    ])
    expect(s.topProperties.map(p => p.propertyId)).toEqual([2, 1, null])
    expect(s.topItems[0]).toEqual({ itemType: 'king_flat', units: 5 })
    expect(s.topItems[1]).toEqual({ itemType: 'bath_towel', units: 3 })
  })

  it('treats a missing or zero quantity as one unit', () => {
    expect(summarizeDamaged([row({ quantity: 0 })]).openUnits).toBe(1)
  })
})

describe('helpers', () => {
  it('isOpenStatus', () => {
    expect(isOpenStatus('reported')).toBe(true)
    expect(isOpenStatus('treating')).toBe(true)
    expect(isOpenStatus('restored')).toBe(false)
    expect(isOpenStatus('discarded')).toBe(false)
  })
  it('itemFallbackLabel falls back to the raw key', () => {
    expect(itemFallbackLabel('bath_towel')).toBe('Bath Towel')
    expect(itemFallbackLabel('mystery')).toBe('mystery')
  })
})
