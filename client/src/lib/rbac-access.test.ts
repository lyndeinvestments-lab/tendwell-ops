import { describe, it, expect } from 'vitest'
import { canAccessView, ADMIN_ONLY_VIEWS } from '@/lib/auth'
import type { AuthUser, ViewId } from '@/lib/auth'

function user(role: string, views: string[]): AuthUser {
  return {
    id: '1',
    role,
    label: role,
    resolvedViews: views as ViewId[],
    resolvedPermissions: {},
    hasCustomViews: false,
  }
}

// The sidebar and GuardedRoute both gate on canAccessView, so anything encoded
// here keeps them in agreement. The bug this guards: /invoicing and /api-sync
// were AdminRoute (hardcoded role check) while the nav filtered on the
// permission matrix, so granting `invoicing` to Operations produced a sidebar
// link that the route answered with "You don't have access to this page".
describe('canAccessView', () => {
  it('honours a granted view for a non-admin role', () => {
    expect(canAccessView('invoicing', user('operations', ['invoicing']))).toBe(true)
  })

  it('denies a view that was never granted', () => {
    expect(canAccessView('invoicing', user('operations', ['property-list']))).toBe(false)
  })

  it('keeps admin-only views admin-only even when granted in the matrix', () => {
    // trellis-sync (API Sync) reads admin-only tables and calls admin-bearer
    // endpoints, so a matrix grant must not surface it.
    expect(canAccessView('trellis-sync', user('operations', ['trellis-sync']))).toBe(false)
    expect(canAccessView('trellis-sync', user('admin', ['trellis-sync']))).toBe(true)
  })

  it('denies everything without a user', () => {
    expect(canAccessView('dashboard', null)).toBe(false)
  })

  it('does not treat invoicing as admin-only — all three layers were widened', () => {
    expect(ADMIN_ONLY_VIEWS.has('invoicing')).toBe(false)
  })
})
