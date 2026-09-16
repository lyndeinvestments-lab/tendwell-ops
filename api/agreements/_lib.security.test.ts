import { describe, expect, it } from 'vitest'
import { resolveAuditIp, loadTemplateBytes } from './_lib'

describe('resolveAuditIp', () => {
  it('prefers x-vercel-forwarded-for over spoofable leftmost XFF', () => {
    expect(
      resolveAuditIp({
        'x-forwarded-for': '1.2.3.4, 10.0.0.1',
        'x-vercel-forwarded-for': '10.0.0.1',
      }),
    ).toBe('10.0.0.1')
  })

  it('falls back to rightmost X-Forwarded-For hop', () => {
    expect(resolveAuditIp({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9' })).toBe('9.9.9.9')
  })

  it('returns unknown when no IP headers present', () => {
    expect(resolveAuditIp({})).toBe('unknown')
  })
})

describe('loadTemplateBytes', () => {
  it('loads the co-deployed PDF from client/public without using Host', async () => {
    const bytes = await loadTemplateBytes()
    expect(bytes.byteLength).toBeGreaterThan(1000)
    // PDF magic
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF')
  })
})
