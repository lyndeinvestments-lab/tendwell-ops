import { describe, it, expect } from 'vitest'
import { normalizePropertyName } from './breezeway-import.js'

// This matcher runs over every row of every daily import (~2,600 rows/day), so
// a regression here silently unlinks tasks from properties — and a task with
// property_id NULL is invisible to invoicing's reconciliation and to the
// per-property coverage panel.

describe('normalizePropertyName', () => {
  it('matches Ops and Breezeway across the WTN → CTN rename', () => {
    // The CTN group was renamed from WTN. Breezeway exports still say WTN.
    // Real case: "WTN-Engle Town 3030" imported with property_id NULL against
    // the Ops row "CTN Engle Town 3030".
    expect(normalizePropertyName('WTN-Engle Town 3030')).toBe(normalizePropertyName('CTN Engle Town 3030'))
    expect(normalizePropertyName('WTN-Pine Top 820')).toBe(normalizePropertyName('CTN-Pine Top 820'))
    expect(normalizePropertyName('Wtn-mountain View')).toBe(normalizePropertyName('CTN-Mountain View'))
    expect(normalizePropertyName('WTN-Rebel Hill 1644')).toBe(normalizePropertyName('CTN-Rebel Hill 1644'))
  })

  it('collapses the separator styles Ops actually uses', () => {
    // Live data has all three: "CTN - X", "CTN X", "CTN-X".
    const a = normalizePropertyName('CTN - Tunnel Ridge 208')
    expect(normalizePropertyName('CTN-Tunnel Ridge 208')).toBe(a)
    expect(normalizePropertyName('CTN Tunnel Ridge 208')).toBe(a)
  })

  it('only rewrites a LEADING wtn token', () => {
    // A name that merely contains the letters must not be mangled.
    expect(normalizePropertyName('Newtn Ridge')).toBe('newtn ridge')
    expect(normalizePropertyName('Smith WTN Cabin')).toBe('smith wtn cabin')
    // ...and not a longer word that happens to start with wtn.
    expect(normalizePropertyName('Wtnsomething 4')).toBe('wtnsomething 4')
  })

  it('does not conflate distinct properties', () => {
    // The rename must not make different cabins look identical.
    expect(normalizePropertyName('CTN-Pine Top 820')).not.toBe(normalizePropertyName('CTN-Pine Top 830'))
    expect(normalizePropertyName('CTN-Black Bear Cub')).not.toBe(normalizePropertyName('Wtn Black Bear 1012'))
  })

  it('is case- and whitespace-insensitive', () => {
    expect(normalizePropertyName('  CTN-Loafers   Glory  ')).toBe('ctn loafers glory')
  })

  it('handles empty and punctuation-only input', () => {
    expect(normalizePropertyName('')).toBe('')
    expect(normalizePropertyName(' --- ')).toBe('')
  })
})
