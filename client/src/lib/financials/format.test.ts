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
  it('returns — for NaN inputs', () => {
    expect(fmtCurrency(NaN)).toBe('—')
    expect(fmtPct(NaN)).toBe('—')
  })
  it('formats delta text and guards zero prev', () => {
    expect(fmtDelta(110, 100).text).toBe('+10.0%')
    expect(fmtDelta(90, 100).text).toBe('-10.0%')
    expect(fmtDelta(100, null).text).toBe('—')
    expect(fmtDelta(50, 0)).toEqual({ text: '—', dir: 'flat' })
  })
})
