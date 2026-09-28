import { describe, it, expect } from 'vitest'
import { defaultMyView, sanitizeMyView, sameMyView, effectiveMyViewDates } from './inspection-my-view'

describe('inspection My View filters', () => {
  it('defaults to the signed-in inspector, all statuses', () => {
    expect(defaultMyView('abc')).toMatchObject({ inspectorFilter: 'abc', statusFilter: 'all', todayOnly: false })
    expect(defaultMyView(null).inspectorFilter).toBe('all')
  })

  it('keeps well-formed saved fields and drops malformed ones', () => {
    const fb = defaultMyView('me')
    const v = sanitizeMyView({ inspectorFilter: 'other', statusFilter: 'bogus', minScore: '9', dateFrom: '2026-09-01', dateTo: 'nope', todayOnly: true }, fb)
    expect(v).toEqual({ inspectorFilter: 'other', statusFilter: 'all', minScore: 'any', dateFrom: '2026-09-01', dateTo: '', todayOnly: true })
  })

  it('falls back entirely on non-object input', () => {
    const fb = defaultMyView('me')
    expect(sanitizeMyView(null, fb)).toBe(fb)
    expect(sanitizeMyView('x', fb)).toBe(fb)
    expect(sanitizeMyView([1], fb)).toBe(fb)
  })

  it('today-only overrides the saved range with the current day', () => {
    const f = { ...defaultMyView('me'), dateFrom: '2026-01-01', dateTo: '2026-01-31' }
    expect(effectiveMyViewDates(f, '2026-09-28')).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })
    expect(effectiveMyViewDates({ ...f, todayOnly: true }, '2026-09-28')).toEqual({ dateFrom: '2026-09-28', dateTo: '2026-09-28' })
  })

  it('compares views field by field', () => {
    const a = defaultMyView('me')
    expect(sameMyView(a, { ...a })).toBe(true)
    expect(sameMyView(a, { ...a, todayOnly: true })).toBe(false)
  })
})
