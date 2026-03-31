import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'

const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes of inactivity

// ─── View Registry ─────────────────────────────────────────────────────────────
// Single source of truth for all navigable views. Used by permissions matrix,
// sidebar filtering, per-user override dialogs, and validation.

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

// Sanitize raw DB/JSON arrays to ensure they only contain known view IDs
export function sanitizeViews(raw: unknown): ViewId[] {
  if (!Array.isArray(raw)) return []
  return (raw as unknown[]).filter(
    (v): v is ViewId => typeof v === 'string' && VALID_VIEW_IDS.has(v)
  )
}

// ─── Role Permissions Type ─────────────────────────────────────────────────────
// Stored in app_settings under key 'role_permissions'
export type RolePermissionsStore = Record<string, {
  label: string
  views: ViewId[]
  system?: boolean  // true = built-in role (admin/operations/cleaning/viewer)
}>

// ─── Roles ────────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'operations' | 'cleaning' | 'viewer'

// Hardcoded fallback — used when no role_permissions DB override exists
export const ROLE_VIEWS: Record<string, ViewId[]> = {
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

// ─── AuthUser ─────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string           // app_users.id — used for emulation identity guard
  role: string         // UserRole or custom role id
  label: string
  resolvedViews: ViewId[]  // computed access list (per-user override > role > fallback)
  hasCustomViews: boolean  // true when app_users.custom_views is non-null
}

// ─── Central access helper ────────────────────────────────────────────────────
// Use this everywhere instead of mixing role checks and resolvedViews checks.

export function canAccessView(viewId: ViewId, user: AuthUser): boolean {
  return user.resolvedViews.includes(viewId)
}

// ─── Legacy canAccess (kept for sidebar compatibility, delegates to resolvedViews) ──

export function canAccess(view: string, _role: string, user?: AuthUser): boolean {
  if (user) return user.resolvedViews.includes(view as ViewId)
  // Fallback to hardcoded map for callers that haven't migrated
  return ROLE_VIEWS[_role]?.includes(view as ViewId) ?? false
}

// ─── AuthContext ───────────────────────────────────────────────────────────────

interface AuthContextType {
  user: AuthUser | null
  viewAs: AuthUser | null
  effectiveUser: AuthUser | null  // viewAs ?? user — used for permission checks
  isEmulating: boolean            // convenience: viewAs !== null
  setViewAs: (u: AuthUser | null) => void
  loginWithGoogle: () => Promise<void>
  logout: () => void
  isLoading: boolean
  authError: string | null
}

const AuthContext = createContext<AuthContextType | null>(null)

// ─── Role permissions loader ───────────────────────────────────────────────────
// Fetches customized role definitions from app_settings; falls back to ROLE_VIEWS.

async function loadRolePermissions(): Promise<RolePermissionsStore | null> {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'role_permissions')
      .single()
    if (!data?.value) return null
    const parsed: unknown = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    // Sanitize each role's view list
    const result: RolePermissionsStore = {}
    for (const [roleId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) continue
      const e = entry as Record<string, unknown>
      result[roleId] = {
        label: typeof e.label === 'string' ? e.label : roleId,
        views: sanitizeViews(e.views),
        system: e.system === true,
      }
    }
    return Object.keys(result).length > 0 ? result : null
  } catch {
    return null
  }
}

// ─── User resolver ─────────────────────────────────────────────────────────────

async function resolveUserFromEmail(email: string): Promise<AuthUser | null> {
  const { data, error } = await supabase
    .from('app_users')
    .select('id, role, label, custom_views')
    .eq('google_email', email.toLowerCase())
    .single()
  if (error || !data) return null

  const role = data.role as string
  let resolvedViews: ViewId[]
  let hasCustomViews = false

  if (data.custom_views !== null && data.custom_views !== undefined) {
    // Per-user override takes highest priority
    resolvedViews = sanitizeViews(data.custom_views)
    hasCustomViews = true
  } else {
    // Try DB-stored role permissions, fall back to hardcoded ROLE_VIEWS
    const rolePerms = await loadRolePermissions()
    if (rolePerms && rolePerms[role]) {
      resolvedViews = rolePerms[role].views
    } else {
      resolvedViews = ROLE_VIEWS[role] ?? []
    }
    hasCustomViews = false
  }

  return { id: data.id, role, label: data.label, resolvedViews, hasCustomViews }
}

// ─── AuthProvider ──────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [viewAs, setViewAsState] = useState<AuthUser | null>(null)

  // undefined = not yet determined | null = no session | string = authenticated email
  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined)

  // Effect 1: Subscribe to Supabase auth state changes.
  // IMPORTANT: Never make Supabase data queries here — doing so in Supabase v2
  // causes a deadlock because the client holds an internal lock during auth callbacks.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user?.email ?? null)
    })
    // Failsafe: if INITIAL_SESSION never fires, unblock loading after 5s
    const failsafe = setTimeout(() => setSessionEmail(prev => prev === undefined ? null : prev), 5000)
    return () => {
      subscription.unsubscribe()
      clearTimeout(failsafe)
    }
  }, [])

  // Effect 2: Once the session email is known, look up the user's role from app_users.
  // This runs outside the auth callback so Supabase queries work without deadlocking.
  useEffect(() => {
    if (sessionEmail === undefined) return

    if (sessionEmail === null) {
      setUser(null)
      setViewAsState(null)  // clear emulation on logout
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
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false))
  }, [sessionEmail])

  // setViewAs with guards: cannot emulate admins, cannot emulate self
  const setViewAs = useCallback((target: AuthUser | null) => {
    if (target === null) {
      setViewAsState(null)
      return
    }
    if (target.role === 'admin') return  // safety guard
    if (user && target.id === user.id) return  // cannot emulate self
    setViewAsState(target)
  }, [user])

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
    await supabase.auth.signOut()
    setUser(null)
    setViewAsState(null)
  }, [])

  // Session timeout — auto-logout after inactivity
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

  const effectiveUser = viewAs ?? user
  const isEmulating = viewAs !== null

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

// ─── View access config (legacy — kept for external consumers) ─────────────────
export const VIEW_ACCESS: Record<string, UserRole[]> = {
  dashboard: ['admin', 'viewer'],
  pipeline: ['admin', 'viewer'],
  contacts: ['admin', 'viewer'],
  'quote-sheet': ['admin'],
  'cost-tracking': ['admin', 'viewer'],
  'property-list': ['admin', 'operations', 'viewer'],
  'linen-tracker': ['admin', 'operations', 'cleaning', 'viewer'],
  'access-codes': ['admin', 'operations'],
  'ac-filters': ['admin', 'operations', 'viewer'],
  'master-list': ['admin', 'viewer'],
  'pro-forma': ['admin', 'viewer'],
  'financial-dashboard': ['admin', 'viewer'],
  'previous-properties': ['admin', 'viewer'],
  settings: ['admin'],
  'revenue-report': ['admin', 'viewer'],
  inspections: ['admin', 'operations', 'viewer'],
  cleaners: ['admin', 'operations'],
  alerts: ['admin', 'operations', 'viewer'],
  activity: ['admin', 'viewer'],
}
