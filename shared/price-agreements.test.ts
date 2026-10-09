import { describe, expect, it } from 'vitest'
import { isHttpsLink, parseSourceLink, priceAgreementsByContact } from './price-agreements'
import { isMissingSchemaError } from './db-errors'

describe('isHttpsLink / parseSourceLink', () => {
  it('accepts absolute https links only', () => {
    expect(isHttpsLink('https://tendwell.slack.com/archives/C1/p123')).toBe(true)
    expect(isHttpsLink('  https://mail.google.com/mail/u/0/#inbox/abc  ')).toBe(true)
    expect(isHttpsLink('http://example.com')).toBe(false)
    expect(isHttpsLink('javascript:alert(1)')).toBe(false)
    expect(isHttpsLink('https://')).toBe(false)
    expect(isHttpsLink('https://exa mple.com')).toBe(false)
    expect(isHttpsLink('example.com')).toBe(false)
    expect(isHttpsLink(null)).toBe(false)
  })

  it('treats blank as no link and trims a valid one', () => {
    expect(parseSourceLink('')).toEqual({ ok: true, value: null })
    expect(parseSourceLink('   ')).toEqual({ ok: true, value: null })
    expect(parseSourceLink(' https://example.com/q ')).toEqual({ ok: true, value: 'https://example.com/q' })
    expect(parseSourceLink('www.example.com')).toEqual({ ok: false })
  })
})

describe('priceAgreementsByContact', () => {
  it('parses numeric strings, drops rows with no client or no price, and hides a bad link', () => {
    const m = priceAgreementsByContact([
      { contact_id: 'c1', accepted_clean_price: '165.50', linen_fee: '35', onboarding_fee: null, accepted_date: '2026-09-01T00:00:00Z', source_link: 'http://insecure.example.com' },
      { contact_id: null, accepted_clean_price: 100, linen_fee: null, onboarding_fee: null, accepted_date: null, source_link: null },
      { contact_id: 'c2', accepted_clean_price: null, linen_fee: null, onboarding_fee: null, accepted_date: null, source_link: null },
      { contact_id: 'c3', accepted_clean_price: -5, linen_fee: 'abc', onboarding_fee: 50, accepted_date: null, source_link: null },
    ])
    expect([...m.keys()]).toEqual(['c1', 'c3'])
    expect(m.get('c1')).toEqual({ cleanPrice: 165.5, linenFee: 35, onboardingFee: null, acceptedDate: '2026-09-01', sourceLink: null })
    expect(m.get('c3')).toEqual({ cleanPrice: null, linenFee: null, onboardingFee: 50, acceptedDate: null, sourceLink: null })
  })
})

describe('isMissingSchemaError', () => {
  it('recognises the not-migrated-yet codes', () => {
    for (const code of ['42P01', '42703', 'PGRST204', 'PGRST205']) expect(isMissingSchemaError({ code, message: 'x' })).toBe(true)
  })

  it('recognises the messages when the code was lost', () => {
    expect(isMissingSchemaError(new Error('relation "public.client_price_agreements" does not exist'))).toBe(true)
    expect(isMissingSchemaError(new Error('column client_fee_overrides.source_link does not exist'))).toBe(true)
    expect(isMissingSchemaError(new Error("Could not find the table 'public.client_price_agreements' in the schema cache"))).toBe(true)
    expect(isMissingSchemaError(new Error("Could not find the 'source_link' column of 'client_fee_overrides' in the schema cache"))).toBe(true)
  })

  it('does not swallow real failures', () => {
    expect(isMissingSchemaError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false)
    expect(isMissingSchemaError({ code: '42501', message: 'permission denied for table client_price_agreements' })).toBe(false)
    expect(isMissingSchemaError(null)).toBe(false)
    expect(isMissingSchemaError('relation does not exist')).toBe(false)
  })
})
