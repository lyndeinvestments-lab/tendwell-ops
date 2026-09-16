import { describe, expect, it } from 'vitest'
import { isAllowedIssuePhotoUrl } from './_photo-url'

describe('isAllowedIssuePhotoUrl', () => {
  const env = {
    VITE_SUPABASE_URL: 'https://eetsudoksvsmwtiqraot.supabase.co',
    SUPABASE_URL: 'https://eetsudoksvsmwtiqraot.supabase.co',
  }

  it('accepts this project storage public issue-photos URL', () => {
    expect(
      isAllowedIssuePhotoUrl(
        'https://eetsudoksvsmwtiqraot.supabase.co/storage/v1/object/public/issue-photos/abc.jpg',
        env,
      ),
    ).toBe(true)
  })

  it('accepts the custom domain host used in production', () => {
    expect(
      isAllowedIssuePhotoUrl(
        'https://api.tendwellcleaningco.com/storage/v1/object/public/issue-photos/abc.jpg',
        env,
      ),
    ).toBe(true)
  })

  it('rejects other supabase projects', () => {
    expect(
      isAllowedIssuePhotoUrl(
        'https://evilproject.supabase.co/storage/v1/object/public/issue-photos/phish.jpg',
        env,
      ),
    ).toBe(false)
  })

  it('rejects non-issue-photos buckets on the allowed host', () => {
    expect(
      isAllowedIssuePhotoUrl(
        'https://eetsudoksvsmwtiqraot.supabase.co/storage/v1/object/public/property-photos/x.jpg',
        env,
      ),
    ).toBe(false)
  })

  it('rejects javascript and data URLs', () => {
    expect(isAllowedIssuePhotoUrl('javascript:alert(1)', env)).toBe(false)
    expect(isAllowedIssuePhotoUrl('data:image/png;base64,aaa', env)).toBe(false)
  })
})
