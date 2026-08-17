import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react'
import { supabase, clearCachedIdentity } from '@/lib/supabase'

const SESSION_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000 // 7 days of inactivity

// ─── VIEW_DEFINITIONS: canonical registry of all views ──────────────────────
export const VIEW_DEFINITIONS = [
  // Overview
  { id: 'dashboard',           label: 'Dashboard',           group: 'Overview' },
  // Sales
  { id: 'pipeline',            label: 'Pipeline',            group: 'Sales' },
  { id: 'contacts',            label: 'Clients',             group: 'Sales' },
  { id: 'quote-sheet',         label: 'Quote Sheet',         group: 'Sales' },
  // Operations
  { id: 'property-list',       label: 'Property List',       group: 'Operations' },
  { id: 'linen-tracker',       label: 'Linen Requirements',  group: 'Operations' },
  { id: 'linen-inventory',     label: 'Linen Inventory',     group: 'Operations' },
  { id: 'access-codes',        label: 'Access Codes',        group: 'Operations' },
  { id: 'ac-filters',          label: 'AC Filters',          group: 'Operations' },
  { id: 'property-verifications', label: 'Property Verifications', group: 'Operations' },
  { id: 'inspections',            label: 'Inspections',            group: 'Operations' },
  { id: 'reviews',                label: 'Reviews',                 group: 'Operations' },
  { id: 'trellis-tasks',          label: 'Trellis Tasks',           group: 'Operations' },
  { id: 'lost-items',             label: 'Lost Items',              group: 'Operations' },
  { id: 'incoming-shipments',     label: 'Incoming Shipments',      group: 'Operations' },
  { id: 'laundry-weigh-ins',      label: 'Laundry Weigh-Ins',       group: 'Operations' },
  { id: 'onboarding-queue',       label: 'Onboarding Queue',        group: 'Operations' },
  // Management
  { id: 'tasks',               label: 'Tasks',               group: 'Management' },
  { id: 'issues',              label: 'Issues',              group: 'Management' },
  { id: 'cleaners',            label: 'Cleaners',            group: 'Management' },
  { id: 'cleaner-metrics',     label: 'Cleaner Metrics',     group: 'Management' },
  { id: 'alerts',              label: 'Alerts',              group: 'Management' },
  // Admin
  { id: 'cost-tracking',       label: 'Cost Tracking',       group: 'Admin' },
  { id: 'master-list',         label: 'Master List',         group: 'Admin' },
  { id: 'revenue-report',      label: 'Revenue Report',      group: 'Admin' },
  { id: 'activity',            label: 'Activity',            group: 'Admin' },
  { id: 'pro-forma',           label: 'Pro Forma',           group: 'Admin' },
  { id: 'forecaster',          label: 'Forecaster',          group: 'Admin' },
  { id: 'financial-dashboard', label: 'Financial Dashboard', group: 'Admin' },
  { id: 'north-star',          label: 'North Star',          group: 'Admin' },
  { id: 'report',              label: 'Executive Summary',   group: 'Admin' },
  { id: 'settings',            label: 'Settings',            group: 'Admin' },
  { id: 'trellis-sync',        label: 'API Sync',            group: 'Admin' },
  { id: 'invoicing',           label: 'Invoicing',           group: 'Admin' },
] as const

export type ViewId = typeof VIEW_DEFINITIONS[number]['id']
const VALID_VIEW_IDS = new Set<string>(VIEW_DEFINITIONS.map(v => v.id))

export type UserRole = 'admin' | 'operations' | 'cleaning' | 'viewer' | 'owner'

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
  /** Set when a staff user's email is ALSO an active property owner. Lets the
   *  user switch into the owner portal view without a separate account. */
  ownerIdentity?: { id: string; label: string } | null
}

interface AuthContextType {
  user: AuthUser | null
  viewAs: AuthUser | null
  effectiveUser: AuthUser | null
  isEmulating: boolean
  setViewAs: (u: AuthUser | null) => void
  /** True when the signed-in staff user is also an active property owner. */
  canActAsOwner: boolean
  /** When true, a dual staff+owner user is viewing the owner portal. */
  actingAsOwner: boolean
  setActingAsOwner: (v: boolean) => void
  loginWithGoogle: () => Promise<void>
  loginWithPassword: (email: string, password: string) => Promise<void>
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>
  logout: () => void
  isLoading: boolean
  authError: string | null
  /** True when the user arrived via a password-recovery link and must set a new password. */
  isPasswordRecovery: boolean
}

/** Owners are not staff (`app_users`). They authenticate with email/password and
 *  are tracked in `property_owners`. This sentinel role drives the owner portal. */
export const OWNER_ROLE = 'owner'

// ─── Hardcoded role defaults (final fallback) ────────────────────────────────
export const ROLE_VIEWS: Record<string, string[]> = {
  admin: [
    'dashboard', 'pipeline', 'contacts', 'quote-sheet', 'cost-tracking',
    'property-list', 'linen-tracker', 'linen-inventory', 'access-codes', 'ac-filters',
    'master-list', 'pro-forma', 'forecaster', 'settings',
    'revenue-report', 'property-verifications', 'inspections', 'reviews', 'cleaners', 'issues', 'alerts', 'activity',
    'financial-dashboard', 'tasks', 'report', 'cleaner-metrics', 'north-star', 'lost-items',
    'incoming-shipments', 'laundry-weigh-ins', 'onboarding-queue', 'trellis-sync',
    'trellis-tasks', 'invoicing',
  ],
  operations: ['property-list', 'linen-tracker', 'linen-inventory', 'access-codes', 'ac-filters', 'property-verifications', 'inspections', 'reviews', 'cleaners', 'issues', 'alerts', 'tasks', 'cleaner-metrics', 'lost-items', 'incoming-shipments', 'laundry-weigh-ins', 'onboarding-queue'],
  cleaning: ['linen-tracker', 'linen-inventory'],
  // Inspectors (invited from the Cleaners page with app role 'inspector')
  // get the inspections page by default; admins can extend via Settings.
  inspector: ['inspections'],
  viewer: [
    'dashboard', 'pipeline', 'contacts', 'cost-tracking', 'property-list',
    'linen-tracker', 'ac-filters', 'master-list', 'pro-forma', 'forecaster',
    'revenue-report', 'property-verifications', 'inspections', 'reviews', 'alerts',
    'activity', 'financial-dashboard', 'lost-items', 'trellis-tasks',
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

/** Views whose page is admin-only no matter what the permission matrix says,
 *  because the data behind it is admin-only too (admin-bearer endpoints +
 *  admin-only RLS). Enforced here so the sidebar and the route guard agree —
 *  they both go through canAccessView, and granting one of these in Settings
 *  used to produce a nav link that the route then refused ("You don't have
 *  access to this page").
 *
 *  To move a view out of this set, widen all three layers first: the route
 *  guard, the table policies and the endpoints — see `invoicing` and
 *  20260817c_permission_driven_invoicing.sql for the worked example. */
export const ADMIN_ONLY_VIEWS: ReadonlySet<string> = new Set(['trellis-sync'])

export function canAccessView(viewId: string, user: AuthUser | null): boolean {
  if (!user) return false
  if (ADMIN_ONLY_VIEWS.has(viewId) && user.role !== 'admin') return false
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
    inspector: {
      label: 'Inspector',
      views: sanitizeViews(ROLE_VIEWS.inspector),
      // Inspectors must be able to log/complete inspections, not just view.
      permissions: {
        ...derivePermissionsFromViews(sanitizeViews(ROLE_VIEWS.inspector), false),
        inspections: { view: true, edit: true },
      },
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

/** Merges an edited role store onto the live one so a save can only ever
 *  change the roles it actually touched. Roles present in `live` but absent
 *  from `edited` are kept — the Settings matrix used to write its whole local
 *  copy, so a stale or defaults-seeded copy silently deleted every custom role
 *  (e.g. `supervisor`) and every customization the copy didn't include.
 *  Removals must therefore be named explicitly in `deleted`. */
export function mergeRolePermissions(
  live: RolePermissionsStore | null,
  edited: RolePermissionsStore,
  deleted: string[] = []
): RolePermissionsStore {
  const merged: RolePermissionsStore = { ...(live ?? {}), ...edited }
  for (const roleId of deleted) delete merged[roleId]
  return merged
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

// Hardcoded default access for a role — prefers the curated defaults in
// buildDefaultRolePermissions (which can grant per-page edit, e.g. inspector →
// inspections), falling back to a plain ROLE_VIEWS derivation for roles
// without a curated entry.
function roleDefaultAccess(role: string): { views: ViewId[]; permissions: Record<string, PagePermission> } {
  const curated = buildDefaultRolePermissions()[role]
  if (curated) return { views: curated.views, permissions: curated.permissions }
  const views = sanitizeViews(ROLE_VIEWS[role] || [])
  return { views, permissions: derivePermissionsFromViews(views, role === 'admin') }
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
      // Retried once: a transient failure here silently downgrades the user to
      // the hardcoded ROLE_VIEWS defaults (wrong permissions for a customized
      // system role, and NO views at all for a custom role like `supervisor`,
      // which has no hardcoded entry). Worth one retry before falling back.
      let settingsData: { value: string | null } | null = null
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data, error: readError } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'role_permissions')
          .maybeSingle()
        if (!readError) { settingsData = data; break }
        if (attempt === 0) await new Promise(r => setTimeout(r, 250))
      }
      if (settingsData?.value) {
        const parsed = typeof settingsData.value === 'string'
          ? JSON.parse(settingsData.value)
          : settingsData.value
        const perms = sanitizeRolePermissions(parsed)
        if (perms[role]) {
          resolvedViews = perms[role].views
          resolvedPermissions = perms[role].permissions
        } else {
          ;({ views: resolvedViews, permissions: resolvedPermissions } = roleDefaultAccess(role))
        }
      } else {
        ;({ views: resolvedViews, permissions: resolvedPermissions } = roleDefaultAccess(role))
      }
    } catch {
      ;({ views: resolvedViews, permissions: resolvedPermissions } = roleDefaultAccess(role))
    }
  }

  return {
    // app_users.id is integer; AuthUser typed as string for cross-render
    // stability. data.label is nullable in the schema; AuthUser requires a
    // string so fall back to empty.
    id: String(data.id),
    role,
    label: data.label ?? '',
    resolvedViews,
    resolvedPermissions,
    hasCustomViews,
  }
}

// ─── Resolve a property owner from email ──────────────────────────────────────
// Owners aren't in app_users; they live in property_owners and authenticate with
// email/password. Returns an AuthUser with the synthetic `owner` role. Owners
// have no staff views — the app routes them to the dedicated owner portal by
// role, not by VIEW_DEFINITIONS.
async function resolveOwnerFromEmail(email: string): Promise<AuthUser | null> {
  const { data, error } = await supabase
    .from('property_owners')
    .select('id, name, email, active')
    .eq('email', email.toLowerCase())
    .eq('active', true)
    .maybeSingle()
  if (error || !data) return null
  return {
    id: data.id,
    role: OWNER_ROLE,
    label: data.name ?? data.email,
    resolvedViews: [],
    resolvedPermissions: {},
    hasCustomViews: false,
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [viewAs, setViewAsState] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [actingAsOwner, setActingAsOwnerState] = useState<boolean>(() => {
    try { return localStorage.getItem('tendwell-acting-as-owner') === '1' } catch { return false }
  })

  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined)

  const setViewAs = useCallback((target: AuthUser | null) => {
    if (target === null) {
      setViewAsState(null)
      return
    }
    // Only admins can emulate other users
    if (!user || user.role !== 'admin') return
    if (target.role === 'admin') return
    if (target.id === user.id) return
    setViewAsState(target)
  }, [user])

  const effectiveUser = viewAs ?? user
  const isEmulating = viewAs !== null

  // A staff user whose email is also an active property owner may switch into
  // the owner portal view. Pure owners (role 'owner') already see the portal.
  const canActAsOwner = !!user?.ownerIdentity && user.role !== OWNER_ROLE

  const setActingAsOwner = useCallback((v: boolean) => {
    setActingAsOwnerState(v)
    try {
      if (v) localStorage.setItem('tendwell-acting-as-owner', '1')
      else localStorage.removeItem('tendwell-acting-as-owner')
    } catch { /* ignore storage failures */ }
  }, [])

  // Drop the owner view if the current user isn't eligible (e.g. after a
  // different user signs in), so a stale flag never routes a non-owner.
  useEffect(() => {
    if (actingAsOwner && !canActAsOwner) setActingAsOwner(false)
  }, [actingAsOwner, canActAsOwner, setActingAsOwner])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // A recovery link signs the user into a temporary session and fires this
      // event — gate the app behind the "set a new password" screen until done.
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true)
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
      .then(async appUser => {
        if (appUser) {
          // If this staff email is also an active property owner, attach the
          // owner identity so the user can switch into the owner portal view.
          // Default experience stays staff.
          const alsoOwner = await resolveOwnerFromEmail(sessionEmail)
          setUser(alsoOwner
            ? { ...appUser, ownerIdentity: { id: alsoOwner.id, label: alsoOwner.label } }
            : appUser)
          setAuthError(null)
          return
        }
        // Not staff — maybe a property owner signing in with email/password.
        const owner = await resolveOwnerFromEmail(sessionEmail)
        if (owner) {
          setUser(owner)
          setAuthError(null)
          return
        }
        setAuthError('This account is not authorized. Contact an admin.')
        setUser(null)
        clearCachedIdentity()
        // Await the sign-out so the session token is actually invalidated
        // before we move on (it was fire-and-forget, leaving a live session).
        await supabase.auth.signOut()
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

  async function loginWithPassword(email: string, password: string) {
    setIsLoading(true)
    setAuthError(null)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) {
      // Supabase returns the same generic message for bad email/password, which
      // is the desired behavior (don't reveal whether an account exists).
      setAuthError('Invalid email or password.')
      setIsLoading(false)
    }
    // On success the onAuthStateChange listener resolves the user + clears loading.
  }

  async function requestPasswordReset(email: string): Promise<{ error: string | null }> {
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: `${window.location.origin}/reset-password` },
    )
    return { error: error?.message ?? null }
  }

  async function updatePassword(newPassword: string): Promise<{ error: string | null }> {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (!error) setIsPasswordRecovery(false)
    return { error: error?.message ?? null }
  }

  const logout = useCallback(async () => {
    setViewAsState(null)
    setIsPasswordRecovery(false)
    setActingAsOwnerState(false)
    try { localStorage.removeItem('tendwell-acting-as-owner') } catch { /* ignore */ }
    // Bust the cached identity so a subsequent login within the TTL isn't
    // attributed to the previous user in the audit log.
    clearCachedIdentity()
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
      canActAsOwner, actingAsOwner, setActingAsOwner,
      loginWithGoogle, loginWithPassword, requestPasswordReset, updatePassword,
      logout, isLoading, authError, isPasswordRecovery,
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
