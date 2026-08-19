import { describe, it, expect } from 'vitest'
import {
  breezewayFreshness,
  breezewayFreshnessDescription,
  BREEZEWAY_STALE_WARNING_DAYS,
  BREEZEWAY_STALE_CRITICAL_DAYS,
} from './data-freshness'

const NOW = new Date('2026-08-19T13:30:00Z')

/** An import that landed `days` before NOW. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
}

describe('breezewayFreshness', () => {
  it('stays quiet on a feed that ran today', () => {
    expect(breezewayFreshness(daysAgo(0), NOW)).toBeNull()
  })

  it('stays quiet after a single missed run', () => {
    // One skipped daily run is noise — and the importer's 30h lookback
    // self-heals it on the next run without anyone intervening.
    expect(breezewayFreshness(daysAgo(1), NOW)).toBeNull()
  })

  it('warns once two days have passed', () => {
    const v = breezewayFreshness(daysAgo(BREEZEWAY_STALE_WARNING_DAYS), NOW)
    expect(v?.severity).toBe('warning')
    expect(v?.daysStale).toBe(2)
  })

  it('escalates to critical at the critical threshold', () => {
    expect(breezewayFreshness(daysAgo(BREEZEWAY_STALE_CRITICAL_DAYS - 1), NOW)?.severity).toBe('warning')
    expect(breezewayFreshness(daysAgo(BREEZEWAY_STALE_CRITICAL_DAYS), NOW)?.severity).toBe('critical')
  })

  it('grades the real outage that motivated this alert', () => {
    // Live gap: 2026-06-28 import, then nothing until 2026-08-17.
    const v = breezewayFreshness('2026-06-28T02:13:01Z', new Date('2026-08-17T00:00:00Z'))
    expect(v?.severity).toBe('critical')
    expect(v?.daysStale).toBe(49)
  })

  it('treats an empty import log as critical', () => {
    for (const empty of [null, undefined, '']) {
      const v = breezewayFreshness(empty, NOW)
      expect(v?.severity).toBe('critical')
      expect(v?.daysStale).toBeNull()
      expect(v?.lastImportKey).toBe('never')
    }
  })

  it('treats an unparseable timestamp as critical, not fresh', () => {
    // Failing open here would recreate the silence this alert exists to break.
    expect(breezewayFreshness('not a timestamp', NOW)?.severity).toBe('critical')
  })

  it('keys the alert id by import date so a later stall re-alerts', () => {
    // Dismissals are keyed on the alert id (`alert_dismissals.alert_key`).
    // Dating the key means dismissing one stall doesn't permanently mute the
    // next one after a fresh import lands.
    expect(breezewayFreshness('2026-08-10T11:33:00Z', NOW)?.lastImportKey).toBe('2026-08-10')
    expect(breezewayFreshness('2026-08-11T11:33:00Z', NOW)?.lastImportKey).toBe('2026-08-11')
  })

  it('does not fire on a clock skew that puts the last import slightly ahead', () => {
    expect(breezewayFreshness(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBeNull()
  })
})

describe('breezewayFreshnessDescription', () => {
  it('names the day count when there is one', () => {
    const v = breezewayFreshness(daysAgo(6), NOW)!
    expect(breezewayFreshnessDescription(v)).toContain('6 days ago')
  })

  it('reads as never-run when the log is empty', () => {
    const v = breezewayFreshness(null, NOW)!
    expect(breezewayFreshnessDescription(v)).toContain('has ever completed')
  })
})
