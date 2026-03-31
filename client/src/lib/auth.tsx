import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'

const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes of inactivity

// ─── VIEW_DEFINITIONS: canonical registry of all views ──────────────────────
export const VIEW_DEFINITIONS = [
  { id: 'dashboard',           label: 'Dashboard',           group: 'Overview' },
  { id: 'pipeline',            label: 'Pipeline',            group: 'Sales' },
  { id: 'contacts',            label: 'Contacts',            group: 'Sales' },
  { id: 'quote-sheet',         label: 'Quote Sheet',         group: 'Sales' },
  { id: 'cost-tracking',       label: 'Cost Tracking',       group: 'Operations' },
  { id: 'property-list',       label: 'Property List',       group: 'Operations' },
  { id: 'linen-tracker',       label: 'Linen Tracker',       group: 'Operations' },
  { id: 'access-codes',        label: 'Access Codes',        group: 'Operations' },
  { id: 'ac-filters',          label: 'AC Filters',          group: 'Operations' },
  { id: 'inspections',         label: 'Inspections',         group: 'Operations' },
  { id: 'cleaners',            label: 'Cleaners',            group: 'Operations' },
  { id: 'master-list',         label: 'Master List',         group: 'Admin' },
  { id: 'revenue-report',      label: 'Revenue Report',      group: 'Admin' },
  { id: 'alerts',              label: 'Alerts',              group: 'Admin' },
  { id: 'activity',            label: 'Activity',            group: 'Admin' },
  { id: 'pro-forma',           label: 'Pro Forma',           group: 'Admin' },
  { id: 'financial-dashboard', label: 'Financial Dashboard', group: 'Admin' },
  { id: 'previous-properties', label: 'Previous Properties', group: 'Admin' },
  { id: 'settings',            label: 'Settings',            group: 'Admin' },
] as const

export type ViewId = typeof VIEW_DEFINITIONS[number]['id']
const VALID_VIEW_IDS = new Set<string>(VIEW_DEFINITIONS.map(v => v.id))

export type UserRole = 'admin' | 'operations' | 'cleaning' | 'viewer'

// ─── Page Permission type ───────────────────────────────────────────────────
export interface PagePermission {
  view: boolean
  edit: boolean
}

export interface AuthUser {
  id: string
  role: string
  label: string
  resolvedViews: ViewId[]
  resolvedPermissions: Record<string, PagePermission>
  hasCustomViews: boolean
}

interface AuthContextType {
  user: AuthUser | null
  viewAs: AuthUser | null
  effectiveUser: AuthUser | null
  isEmulating: boolean
  setViewAs: (u: AuthUser | null) => void
  loginWithGoogle: () => Promise<void>
  logout: () => void
  isLoading: boolean
  authError: string | null
}

// ─── Hardcoded role defaults (final fallback) ────────────────────────────────
export const ROLE_VIEWS: Record<string, string[]> = {
  admin: [
    'dashboard', 'pipeline', 'contacts', 'quote-sheet', 'cost-tracking',
    'property-list', 'linen-tracker', 'access-codes', 'ac-filters',
    'master-list', 'pro-forma', 'previous-properties', 'settings',
    'revenue-report', 'inspections', 'cleaners', 'alerts', 'activity',
    'financial-dashboard',
  ],
  operations: ['property-list', 'linen-tracker', 'access-codes', 'ac-filters', 'inspections', 'cleaners', 'alerts'],
  cleaning: ['linen-tracker'],
  viewer: [
    'dashboard', 'pipeline', 'contacts', 'cost-tracking', 'property-list',
    'linen-tracker', 'ac-filters', 'master-list', 'pro-forma',
    'previous-properties', 'revenue-report', 'inspections', 'alerts',
    'activity', 'financial-dashboard',
  ],
}

export type RolePermissionsStore = Record<string, {
  label: string
  views: ViewId[]
  permissions: Record<string, PagePermission>
  system?: boolean
}>

// ─── View ID validation ──────────────────────────────────────────────────────
export function sanitizeViews(raw: unknown): ViewId[] {
  if (!Array.isArray(raw)) return []
  return (raw as unknown[]).filter(
    (v): v is ViewId => typeof v === 'string' && VALID_VIEW_IDS.has(v)
  )
}

// ─── Permission helpers ──────────────────────────────────────────────────────

export function derivePermissionsFromViews(
  views: ViewId[],
  isAdmin: boolean
): Record<string, PagePermission> {
  const result: Record<string, PagePermission> = {}
  for (const v of VIEW_DEFINITIONS) {
    const hasView = isAdmin || views.includes(v.id as ViewId)
    result[v.id] = { view: hasView, edit: isAdmin }
  }
  return result
}

export function sanitizePagePermissions(
  raw: Record<string, any>,
  fallbackViews: ViewId[]
): Record<string, PagePermission> {
  const result: Record<string, PagePermission> = {}
  for (const v of VIEW_DEFINITIONS) {
    const p = raw[v.id]
    if (p && typeof p === 'object') {
      result[v.id] = { view: !!p.view, edit: !!p.edit }
    } else {
      result[v.id] = { view: fallbackViews.includes(v.id as ViewId), edit: false }
    }
  }
  return result
}

// ─── Central access helpers ─────────────────────────────────────────────────
export function canAccessView(viewId: string, user: AuthUser | null): boolean {
  if (!user) return false
  return user.resolvedViews.includes(viewId as ViewId)
}

export function canEditView(viewId: string, user: AuthUser | null): boolean {
  if (!user) return false
  return user.resolvedPermissions[viewId]?.edit === true
}

// ─── Build default role_permissions from ROLE_VIEWS ──────────────────────────
export function buildDefaultRolePermissions(): RolePermissionsStore {
  return {
    admin: {
      label: 'Admin',
      views: sanitizeViews(ROLE_VIEWS.admin),
      permissions: derivePermissionsFromViews(sanitizeViews(ROLE_VIEWS.admin), true),
      system: true,
    },
    operations: {
      label: 'Operations',
      views: sanitizeViews(ROLE_VIEWS.operations),
      permissions: derivePermissionsFromViews(sanitizeViews(ROLE_VIEWS.operations), false),
      system: true,
    },
    cleaning: {
      label: 'Cleaning',
      views: sanitizeViews(ROLE_VIEWS.cleaning),
      permissions: derivePermissionsFromViews(sanitizeViews(ROLE_VIEWS.cleaning), false),
      system: true,
    },
    viewer: {
      label: 'Viewer',
      views: sanitizeViews(ROLE_VIEWS.viewer),
      permissions: derivePermissionsFromViews(sanitizeViews(ROLE_VIEWS.viewer), false),
      system: true,
    },
  }
}

export function sanitizeRolePermissions(raw: unknown): RolePermissionsStore {
  if (!raw || typeof raw !== 'object') return buildDefaultRolePermissions()
  const result: RolePermissionsStore = {}
  for (const [key, val] of Object.entries(raw as Record<string, any>)) {
    if (val && typeof val === 'object' && typeof val.label === 'string') {
      const views = sanitizeViews(val.views)
      const permissions: Record<string, PagePermission> = val.permissions
        ? sanitizePagePermissions(val.permissions, views)
        : derivePermissionsFromViews(views, key === 'admin')
      result[key] = {
        label: val.label,
        views,
        permissions,
        ...(val.system ? { system: true } : {}),
      }
    }
  }
  return result
}

// ─── Resolve user from DB ────────────────────────────────────────────────────
async function resolveUserFromEmail(email: string): Promise<AuthUser | null> {
  const { data, error } = await supabase
    .from('app_users')
    .select('id, role, label, custom_views, custom_permissions')
    .eq('google_email', email.toLowerCase())
    .single()
  if (error || !data) return null

  const role = data.role as string
  const customViews = data.custom_views as unknown
  const customPermissions = data.custom_permissions as unknown

  let resolvedViews: ViewId[]
  let resolvedPermissions: Record<string, PagePermission>
  let hasCustomViews = false

  if (customViews !== null && customViews !== undefined) {
    resolvedViews = sanitizeViews(customViews)
    hasCustomViews = true
    resolvedPermissions = (customPermissions && typeof customPermissions === 'object')
      ? sanitizePagePermissions(customPermissions as Record<string, any>, resolvedViews)
      : derivePermissionsFromViews(resolvedViews, role === 'admin')
  } else {
    try {
      const { data: settingsData } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'role_permissions')
        .single()
      if (settingsData?.value) {
        const parsed = typeof settingsData.value === 'string'
          ? JSON.parse(settingsData.value)
          : settingsData.value
        const perms = sanitizeRolePermissions(parsed)
        if (perms[role]) {
          resolvedViews = perms[role].views
          resolvedPermissions = perms[role].permissions
        } else {
          resolvedViews = sanitizeViews(ROLE_VIEWS[role] || [])
          resolvedPermissions = derivePermissionsFromViews(resolvedViews, role === 'admin')
        }
      } else {
        resolvedViews = sanitizeViews(ROLE_VIEWS[role] || [])
        resolvedPermissions = derivePermissionsFromViews(resolvedViews, role === 'admin')
      }
    } catch {
      resolvedViews = sanitizeViews(ROLE_VIEWS[role] || [])
      resolvedPermissions = derivePermissionsFromViews(resolvedViews, role === 'admin')
    }
  }

  return {
    id: data.id,
    role,
    label: data.label,
    resolvedViews,
    resolvedPermissions,
    hasCustomViews,
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [viewAs, setViewAsState] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined)

  const setViewAs = useCallback((target: AuthUser | null) => {
    if (target === null) {
      setViewAsState(null)
      return
    }
    if (target.role === 'admin') return
    if (user && target.id === user.id) return
    setViewAsState(target)
  }, [user])

  const effectiveUser = viewAs ?? user
  const isEmulating = viewAs !== null

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user?.email ?? null)
    })
    const failsafe = setTimeout(() => setSessionEmail(prev => prev === undefined ? null : prev), 5000)
    return () => {
      subscription.unsubscribe()
      clearTimeout(failsafe)
    }
  }, [])

  useEffect(() => {
    if (sessionEmail === undefined) return

    if (sessionEmail === null) {
      setUser(null)
      setIsLoading(false)
      return
    }

    resolveUserFromEmail(sessionEmail)
      .then(appUser => {
        if (appUser) {
          setUser(appUser)
          setAuthError(null)
        } else {
          supabase.auth.signOut()
          setAuthError('Your Google account is not authorized. Contact an admin.')
          setUser(null)
        }
      })
      .catch(() => {
        setUser(null)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [sessionEmail])

  async function loginWithGoogle() {
    setIsLoading(true)
    setAuthError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      setAuthError(error.message)
      setIsLoading(false)
    }
  }

  const logout = useCallback(async () => {
    setViewAsState(null)
    await supabase.auth.signOut()
    setUser(null)
  }, [])

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!user) return

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(logout, SESSION_TIMEOUT_MS)
    }

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const
    events.forEach(e => window.addEventListener(e, resetTimer))
    resetTimer()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      events.forEach(e => window.removeEventListener(e, resetTimer))
    }
  }, [user, logout])

  return (
    <AuthContext.Provider value={{
      user, viewAs, effectiveUser, isEmulating, setViewAs,
      loginWithGoogle, logout, isLoading, authError,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
