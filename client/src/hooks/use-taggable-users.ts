import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ROLE_VIEWS, sanitizeViews, sanitizeRolePermissions, type ViewId } from '@/lib/auth'

// Returns the set of app_users who have view access to a given view(s). Use this
// to scope the @-mention candidate list for a notes area — anyone with view
// access to the related page is taggable, whether or not they have edit rights.
//
// Resolution order (matches login):
//   1. user.custom_views (if set) — override
//   2. app_settings.role_permissions[role].views (if configured)
//   3. ROLE_VIEWS[role] fallback

interface TaggableUserRow {
  id: number
  label: string | null
  role: string | null
  custom_views: unknown
}

export interface TaggableUser {
  id: number
  label: string
}

async function fetchResolvedUsers(requiredViews: ViewId[]): Promise<TaggableUser[]> {
  const [usersRes, settingsRes] = await Promise.all([
    supabase.from('app_users').select('id, label, role, custom_views'),
    supabase.from('app_settings').select('value').eq('key', 'role_permissions').maybeSingle(),
  ])
  if (usersRes.error) throw usersRes.error
  const users = (usersRes.data || []) as TaggableUserRow[]

  let rolePerms: ReturnType<typeof sanitizeRolePermissions> | null = null
  if (settingsRes.data?.value) {
    try {
      const parsed = typeof settingsRes.data.value === 'string'
        ? JSON.parse(settingsRes.data.value)
        : settingsRes.data.value
      rolePerms = sanitizeRolePermissions(parsed)
    } catch {
      rolePerms = null
    }
  }

  return users
    .map(u => {
      let views: ViewId[]
      if (u.custom_views !== null && u.custom_views !== undefined) {
        views = sanitizeViews(u.custom_views)
      } else if (u.role && rolePerms?.[u.role]) {
        views = rolePerms[u.role].views
      } else {
        views = sanitizeViews(ROLE_VIEWS[u.role || ''] || [])
      }
      const hasAccess = requiredViews.every(v => views.includes(v))
      if (!hasAccess) return null
      if (!u.label) return null
      return { id: u.id, label: u.label } as TaggableUser
    })
    .filter((u): u is TaggableUser => u !== null)
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function useTaggableUsers(viewId: ViewId | ViewId[]) {
  const required = Array.isArray(viewId) ? viewId : [viewId]
  const key = required.join(',')
  return useQuery({
    queryKey: ['/supabase/taggable-users', key],
    queryFn: () => fetchResolvedUsers(required),
    staleTime: 60_000,
  })
}
