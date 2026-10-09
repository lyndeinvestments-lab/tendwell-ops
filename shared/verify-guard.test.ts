import { describe, expect, it } from 'vitest'
import { checkVerifyTarget, PROD_SUPABASE_REF } from './verify-guard'

const fakeJwt = (payload: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`

const nonProd = {
  VERIFY_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  VERIFY_SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ ref: 'abcdefghijklmnopqrst', role: 'service_role' }),
  VERIFY_SUPABASE_ANON_KEY: fakeJwt({ ref: 'abcdefghijklmnopqrst', role: 'anon' }),
}

describe('checkVerifyTarget', () => {
  it('accepts an explicit non-production target', () => {
    const r = checkVerifyTarget(nonProd)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.target.supabaseUrl).toBe(nonProd.VERIFY_SUPABASE_URL)
  })

  it('accepts a local Supabase stack over http', () => {
    expect(checkVerifyTarget({ ...nonProd, VERIFY_SUPABASE_URL: 'http://127.0.0.1:54321' }).ok).toBe(true)
  })

  it('ignores SUPABASE_URL and friends entirely (no fallback)', () => {
    const r = checkVerifyTarget({
      SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      VITE_SUPABASE_ANON_KEY: 'y',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/VERIFY_SUPABASE_URL.*VERIFY_SUPABASE_SERVICE_ROLE_KEY.*VERIFY_SUPABASE_ANON_KEY/)
  })

  it('refuses the production project ref', () => {
    for (const url of [
      `https://${PROD_SUPABASE_REF}.supabase.co`,
      `https://${PROD_SUPABASE_REF.toUpperCase()}.supabase.co/`,
    ]) {
      const r = checkVerifyTarget({ ...nonProd, VERIFY_SUPABASE_URL: url })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/production/)
    }
  })

  it('refuses the production custom domain', () => {
    const r = checkVerifyTarget({ ...nonProd, VERIFY_SUPABASE_URL: 'https://api.tendwellcleaningco.com' })
    expect(r.ok).toBe(false)
  })

  it('refuses a production key even when the URL looks fine', () => {
    const r = checkVerifyTarget({ ...nonProd, VERIFY_SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ ref: PROD_SUPABASE_REF, role: 'service_role' }) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/key belongs to the production project/)
  })

  it('refuses a malformed URL', () => {
    expect(checkVerifyTarget({ ...nonProd, VERIFY_SUPABASE_URL: 'not a url' }).ok).toBe(false)
    expect(checkVerifyTarget({ ...nonProd, VERIFY_SUPABASE_URL: 'ftp://x.supabase.co' }).ok).toBe(false)
  })

  describe('deployment host', () => {
    it('accepts a preview deployment', () => {
      const r = checkVerifyTarget(nonProd, { requireDeployment: true, deploymentUrl: 'https://tendwell-ops-git-x.vercel.app/' })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.target.deploymentUrl).toBe('https://tendwell-ops-git-x.vercel.app')
    })

    it('refuses the production app and every tendwellcleaningco.com host', () => {
      for (const d of ['https://app.tendwellcleaningco.com', 'https://tendwellcleaningco.com', 'https://ops.TendwellCleaningCo.com/x']) {
        const r = checkVerifyTarget(nonProd, { requireDeployment: true, deploymentUrl: d })
        expect(r.ok, d).toBe(false)
      }
    })

    it('does not mistake a lookalike host for production', () => {
      expect(checkVerifyTarget(nonProd, { requireDeployment: true, deploymentUrl: 'https://nottendwellcleaningco.com.example.app' }).ok).toBe(true)
    })

    it('requires an https deployment URL when one is required', () => {
      expect(checkVerifyTarget(nonProd, { requireDeployment: true }).ok).toBe(false)
      expect(checkVerifyTarget(nonProd, { requireDeployment: true, deploymentUrl: 'http://preview.vercel.app' }).ok).toBe(false)
    })

    it('still refuses a production DB with a valid preview host', () => {
      const r = checkVerifyTarget(
        { ...nonProd, VERIFY_SUPABASE_URL: `https://${PROD_SUPABASE_REF}.supabase.co` },
        { requireDeployment: true, deploymentUrl: 'https://tendwell-ops-git-x.vercel.app' },
      )
      expect(r.ok).toBe(false)
    })
  })
})
