import { describe, it, expect } from 'vitest'
import { fmtCurrency, fmtPct, fmtDelta } from './format'

describe('format', () => {
  it('formats currency and handles null', () => {
    expect(fmtCurrency(1234.5)).toBe('$1,235')
    expect(fmtCurrency(null)).toBe('—')
  })
  it('formats percent and handles null', () => {
    expect(fmtPct(12.345, 1)).toBe('12.3%')
    expect(fmtPct(null)).toBe('—')
  })
  it('computes delta direction', () => {
    expect(fmtDelta(110, 100).dir).toBe('up')
    expect(fmtDelta(90, 100).dir).toBe('down')
    expect(fmtDelta(100, null).dir).toBe('flat')
  })
})
