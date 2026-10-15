import { describe, it, expect } from 'vitest'
import {
  trellisFreshness,
  trellisFreshnessDescription,
  breezewayAlertSeverity,
  breezewayFreshness,
  isTrellisPrimary,
  TRELLIS_STALE_WARNING_HOURS,
  TRELLIS_STALE_CRITICAL_HOURS,
} from './data-freshness'

const NOW = new Date('2026-10-14T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

describe('trellisFreshness', () => {
  it('is quiet after a recent sync', () => {
    expect(trellisFreshness(hoursAgo(1), NOW)).toBeNull()
    expect(trellisFreshness(hoursAgo(TRELLIS_STALE_WARNING_HOURS - 1), NOW)).toBeNull()
  })

  it('warns once a day has been missed', () => {
    const v = trellisFreshness(hoursAgo(TRELLIS_STALE_WARNING_HOURS), NOW)
    expect(v?.severity).toBe('warning')
    expect(v?.hoursStale).toBe(TRELLIS_STALE_WARNING_HOURS)
  })

  it('goes critical at the critical threshold', () => {
    expect(trellisFreshness(hoursAgo(TRELLIS_STALE_CRITICAL_HOURS - 1), NOW)?.severity).toBe('warning')
    expect(trellisFreshness(hoursAgo(TRELLIS_STALE_CRITICAL_HOURS), NOW)?.severity).toBe('critical')
  })

  it('treats missing or unparseable timestamps as critical, never fresh', () => {
    for (const v of [null, undefined, '', 'nope']) {
      const r = trellisFreshness(v as string | null | undefined, NOW)
      expect(r?.severity).toBe('critical')
      expect(r?.lastSyncKey).toBe('never')
    }
  })

  it('keys the alert by the last sync date so a dismissal does not mute the next stall', () => {
    expect(trellisFreshness('2026-10-12T03:00:00Z', NOW)?.lastSyncKey).toBe('2026-10-12')
  })
})

describe('trellisFreshnessDescription', () => {
  it('reports hours under two days and days after', () => {
    expect(trellisFreshnessDescription(trellisFreshness(hoursAgo(30), NOW)!)).toContain('30 hours ago')
    expect(trellisFreshnessDescription(trellisFreshness(hoursAgo(80), NOW)!)).toContain('3 days ago')
  })
  it('explains a never-synced deployment', () => {
    expect(trellisFreshnessDescription(trellisFreshness(null, NOW)!)).toContain('has ever finished')
  })
  it('never uses an em dash', () => {
    expect(trellisFreshnessDescription(trellisFreshness(hoursAgo(30), NOW)!)).not.toContain('—')
  })
})

describe('isTrellisPrimary', () => {
  it('switches on the cutover month start', () => {
    expect(isTrellisPrimary('2026-10-01', '2026-09-30')).toBe(false)
    expect(isTrellisPrimary('2026-10-01', '2026-10-01')).toBe(true)
    expect(isTrellisPrimary('2026-10-01', '2026-10-14')).toBe(true)
  })
  it('defaults to Breezeway when the cutover is the sentinel or missing', () => {
    expect(isTrellisPrimary('9999-12-01', '2026-10-14')).toBe(false)
    expect(isTrellisPrimary(null, '2026-10-14')).toBe(false)
    expect(isTrellisPrimary('garbage', '2026-10-14')).toBe(false)
  })
})

describe('breezewayAlertSeverity', () => {
  const stale = breezewayFreshness('2026-10-01T00:00:00Z', NOW)!
  it('keeps the graded severity while Breezeway is primary', () => {
    expect(breezewayAlertSeverity(stale, false)).toBe('critical')
  })
  it('drops to info once Trellis is primary', () => {
    expect(breezewayAlertSeverity(stale, true)).toBe('info')
  })
})
