import { describe, it, expect } from 'vitest'
import { mergeRolePermissions } from '@/lib/auth'
import type { RolePermissionsStore } from '@/lib/auth'

// The live store the Settings matrix saves on top of. Shape mirrors the real
// app_settings.role_permissions blob: system roles plus admin-created custom
// roles (`supervisor` here) that have no hardcoded ROLE_VIEWS fallback.
function store(...roleIds: string[]): RolePermissionsStore {
  const out: RolePermissionsStore = {}
  for (const id of roleIds) {
    out[id] = { label: id, views: [], permissions: {} }
  }
  return out
}

describe('mergeRolePermissions', () => {
  it('keeps live roles the edited copy never included', () => {
    // The regression: the matrix rendered the 5 hardcoded default roles, so
    // saving from that state dropped `supervisor` (3 real users) entirely.
    const live = store('admin', 'operations', 'cleaning', 'inspector', 'viewer', 'supervisor')
    const edited = store('admin', 'operations', 'cleaning', 'inspector', 'viewer')

    const merged = mergeRolePermissions(live, edited)

    expect(Object.keys(merged).sort()).toEqual(
      ['admin', 'cleaning', 'inspector', 'operations', 'supervisor', 'viewer']
    )
  })

  it('applies edits to the roles that were touched', () => {
    const live = store('operations', 'supervisor')
    const edited: RolePermissionsStore = {
      operations: {
        label: 'Operations',
        views: ['dashboard'],
        permissions: { dashboard: { view: true, edit: true } },
      },
    }

    const merged = mergeRolePermissions(live, edited)

    expect(merged.operations.permissions.dashboard).toEqual({ view: true, edit: true })
    expect(merged.supervisor).toBeDefined()
  })

  it('removes only roles named explicitly as deleted', () => {
    const live = store('admin', 'supervisor', 'temp_role')
    const edited = store('admin', 'supervisor')

    const merged = mergeRolePermissions(live, edited, ['temp_role'])

    expect(Object.keys(merged).sort()).toEqual(['admin', 'supervisor'])
  })

  it('treats an absent live store as a fresh install', () => {
    const edited = store('admin', 'viewer')

    expect(Object.keys(mergeRolePermissions(null, edited)).sort()).toEqual(['admin', 'viewer'])
  })
})
