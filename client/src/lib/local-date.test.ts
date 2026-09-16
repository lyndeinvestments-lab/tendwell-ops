import { describe, expect, it } from 'vitest'
import { localISODate } from './local-date'

describe('localISODate', () => {
  it('formats a local calendar date as YYYY-MM-DD', () => {
    // Construct with local Y/M/D so the assertion is timezone-stable.
    const d = new Date(2026, 8, 15, 23, 30, 0) // Sep 15 2026 23:30 local
    expect(localISODate(d)).toBe('2026-09-15')
  })

  it('does not roll forward on late-evening local time the way UTC ISO does', () => {
    const d = new Date(2026, 8, 15, 23, 30, 0)
    const utcIsoDay = d.toISOString().split('T')[0]
    const local = localISODate(d)
    // In timezones west of UTC, late evening local is already the next UTC day.
    // We only assert local stays on the constructed local calendar day.
    expect(local).toBe('2026-09-15')
    if (d.getTimezoneOffset() > 0) {
      expect(utcIsoDay).not.toBe(local)
    }
  })
})
