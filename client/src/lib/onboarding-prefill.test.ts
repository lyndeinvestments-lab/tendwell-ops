import { describe, expect, it } from 'vitest'
import { boolToYesNo, formatWifi, numToStr, parseWifi } from './onboarding-prefill'

describe('numToStr', () => {
  it('renders numbers, including zero', () => {
    expect(numToStr(0)).toBe('0')
    expect(numToStr(3)).toBe('3')
  })
  it('renders missing values as an empty field, not "null"', () => {
    expect(numToStr(null)).toBe('')
    expect(numToStr(undefined)).toBe('')
  })
})

describe('boolToYesNo', () => {
  it('distinguishes an explicit no from an unanswered question', () => {
    expect(boolToYesNo(true)).toBe('yes')
    expect(boolToYesNo(false)).toBe('no')
    expect(boolToYesNo(null)).toBe('')
    expect(boolToYesNo(undefined)).toBe('')
  })
})

describe('wifi round-trip', () => {
  it('reads back exactly what it writes', () => {
    const stored = formatWifi('Cabin Guest', 'summer2026')
    expect(stored).toBe('Network: Cabin Guest / Password: summer2026')
    expect(parseWifi(stored)).toEqual({ network: 'Cabin Guest', password: 'summer2026' })
  })

  it('handles a network with no password', () => {
    const stored = formatWifi('Cabin Guest', '')
    expect(stored).toBe('Network: Cabin Guest')
    expect(parseWifi(stored)).toEqual({ network: 'Cabin Guest', password: '' })
  })

  it('handles a password with no network', () => {
    expect(parseWifi(formatWifi('', 'summer2026'))).toEqual({ network: '', password: 'summer2026' })
  })

  it('keeps a password containing a slash intact', () => {
    const stored = formatWifi('Cabin', 'a/b/c')
    expect(parseWifi(stored)).toEqual({ network: 'Cabin', password: 'a/b/c' })
  })

  it('surfaces hand-typed staff text rather than dropping it', () => {
    expect(parseWifi('ask the neighbour')).toEqual({ network: 'ask the neighbour', password: '' })
  })

  it('treats blank storage as blank fields', () => {
    expect(formatWifi('', '')).toBeNull()
    expect(parseWifi(null)).toEqual({ network: '', password: '' })
    expect(parseWifi('   ')).toEqual({ network: '', password: '' })
  })
})
