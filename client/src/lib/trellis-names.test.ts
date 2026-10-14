import { describe, it, expect } from 'vitest'
import { stripTrellisRegionTag, trellisNameDiffers } from './trellis-names'

// Real Ops vs Trellis name pairs from the live mapping table (2026-10-14).
describe('stripTrellisRegionTag', () => {
  it('drops one trailing region tag', () => {
    expect(stripTrellisRegionTag('Amy Christopher 3303 (SCounty)')).toBe('Amy Christopher 3303')
    expect(stripTrellisRegionTag('Denny Johnson 2251-21 (SCounty)')).toBe('Denny Johnson 2251-21')
  })
  it('collapses doubled spaces', () => {
    expect(stripTrellisRegionTag('Phillip Dueitt  3710-105 (GAT)')).toBe('Phillip Dueitt 3710-105')
  })
  it('leaves names without a tag alone', () => {
    expect(stripTrellisRegionTag('Porchlight Retreat')).toBe('Porchlight Retreat')
  })
})

describe('trellisNameDiffers', () => {
  it('is false when only the region tag differs', () => {
    expect(trellisNameDiffers('Amy Christopher 3303', 'Amy Christopher 3303 (SCounty)')).toBe(false)
    expect(trellisNameDiffers('Phillip Dueitt 3710-105', 'Phillip Dueitt  3710-105 (GAT)')).toBe(false)
  })
  it('is true for a real name difference', () => {
    expect(trellisNameDiffers('Denny Johnson 2251', 'Denny Johnson 2251-21 (SCounty)')).toBe(true)
    expect(trellisNameDiffers('BeautifulView333', 'Beautiful View')).toBe(true)
  })
  it('is false with no Trellis name or an identical one', () => {
    expect(trellisNameDiffers('X', null)).toBe(false)
    expect(trellisNameDiffers('Beautiful View', 'Beautiful View')).toBe(false)
  })
})
