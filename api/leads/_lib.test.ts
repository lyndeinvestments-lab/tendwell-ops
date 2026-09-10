import { describe, it, expect } from 'vitest'
import { parseLead, pickUtm, isLikelyEmail, rateLimit } from './_lib.js'

describe('parseLead', () => {
  it('accepts a normal submission and shapes it into RPC args', () => {
    const r = parseLead(
      {
        external_id: 'web:abc-123',
        full_name: '  Jordan Lynde  ',
        email: 'JORDAN@example.com ',
        phone: '(865) 555-0123',
        property_count: '2-5',
        property_location: 'Gatlinburg',
        message: 'Current cleaner keeps missing 4 PM check-ins.',
        source_page: '/book',
        utm: { utm_source: 'google', utm_medium: 'cpc', nonsense: 'x' },
      },
      'Mozilla/5.0',
    )
    expect(r.ok).toBe(true)
    if (r.ok !== true) return
    expect(r.args.p_external_id).toBe('web:abc-123')
    expect(r.args.p_full_name).toBe('Jordan Lynde')
    // Trimmed but NOT lowercased — the DB does case-insensitive matching, and
    // staff should see the address as the person typed it.
    expect(r.args.p_email).toBe('JORDAN@example.com')
    expect(r.args.p_property_count).toBe('2-5')
    expect(r.args.p_utm).toEqual({ utm_source: 'google', utm_medium: 'cpc' })
    expect(r.args.p_user_agent).toBe('Mozilla/5.0')
  })

  it('requires a name', () => {
    const r = parseLead({ email: 'a@b.com' })
    expect(r).toEqual({ ok: false, error: 'A name is required' })
  })

  it('requires at least one way to reach the person', () => {
    const r = parseLead({ full_name: 'No Contact' })
    expect(r.ok).toBe(false)
  })

  it('accepts a phone-only lead', () => {
    const r = parseLead({ full_name: 'Phone Only', phone: '865-555-0100' })
    expect(r.ok).toBe(true)
    if (r.ok !== true) return
    expect(r.args.p_email).toBeNull()
  })

  it('rejects an obviously broken email rather than storing it', () => {
    const r = parseLead({ full_name: 'Typo', email: 'jordan@' })
    expect(r).toEqual({ ok: false, error: 'That email address does not look right' })
  })

  it('silently ignores a honeypot hit', () => {
    const r = parseLead({ full_name: 'Bot', email: 'bot@spam.example', website: 'http://spam' })
    expect(r).toEqual({ ok: 'ignored' })
  })

  it('mints an external_id when one is not supplied, so the RPC never rejects', () => {
    const r = parseLead({ full_name: 'Curl User', email: 'a@b.com' })
    expect(r.ok).toBe(true)
    if (r.ok !== true) return
    expect(r.args.p_external_id).toMatch(/^web:/)
  })

  it('caps long input instead of rejecting it', () => {
    const r = parseLead({ full_name: 'A'.repeat(500), email: 'a@b.com', message: 'B'.repeat(5000) })
    expect(r.ok).toBe(true)
    if (r.ok !== true) return
    expect(r.args.p_full_name).toHaveLength(120)
    expect(r.args.p_message).toHaveLength(2000)
  })

  it('turns blank optional answers into null, not empty strings', () => {
    const r = parseLead({ full_name: 'Blank Fields', email: 'a@b.com', company: '   ', message: '' })
    expect(r.ok).toBe(true)
    if (r.ok !== true) return
    expect(r.args.p_company).toBeNull()
    expect(r.args.p_message).toBeNull()
  })
})

describe('pickUtm', () => {
  it('keeps only known attribution keys', () => {
    expect(pickUtm({ utm_source: 'x', evil: 'y', gclid: 'z' })).toEqual({ utm_source: 'x', gclid: 'z' })
  })
  it('tolerates a non-object', () => {
    expect(pickUtm('nope')).toEqual({})
    expect(pickUtm(null)).toEqual({})
  })
})

describe('isLikelyEmail', () => {
  it('accepts real-world addresses', () => {
    for (const e of ['a@b.co', 'first.last+tag@sub.domain.com', "o'brien@example.org"]) {
      expect(isLikelyEmail(e)).toBe(true)
    }
  })
  it('rejects what is clearly not an address', () => {
    for (const e of ['nope', 'a@b', 'a b@c.com', '@b.com']) {
      expect(isLikelyEmail(e)).toBe(false)
    }
  })
})

describe('rateLimit', () => {
  it('allows up to the limit then refuses', () => {
    const key = `test-${Math.random()}`
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 60_000)).toBe(true)
    expect(rateLimit(key, 3, 60_000)).toBe(false)
  })

  it('buckets independently per key', () => {
    const a = `a-${Math.random()}`
    const b = `b-${Math.random()}`
    expect(rateLimit(a, 1, 60_000)).toBe(true)
    expect(rateLimit(a, 1, 60_000)).toBe(false)
    expect(rateLimit(b, 1, 60_000)).toBe(true)
  })
})
