import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'

const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes of inactivity

export type UserRole = 'admin' | 'operations' | 'cleaning' | 'viewer'

export interface AuthUser {
  role: UserRole
  label: string
  allowedViews: string[]
}

interface AuthContextType {
  user: AuthUser | null
  loginWithGoogle: () => Promise<void>
  logout: () => void
  isLoading: boolean
  authError: string | null
}

const ROLE_VIEWS: Record<string, string[]> = {
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

const AuthContext = createContext<AuthContextType | null>(null)

async function resolveUserFromEmail(email: string): Promise<AuthUser | null> {
  const { data, error } = await supabase
    .from('app_users')
    .select('role, label')
    .eq('google_email', email.toLowerCase())
    .single()
  if (error || !data) return null
  const role = data.role as UserRole
  return {
    role,
    label: data.label,
    allowedViews: ROLE_VIEWS[role] || [],
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    // Check for existing Supabase session on mount
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user?.email) {
        const appUser = await resolveUserFromEmail(session.user.email)
        if (appUser) {
          setUser(appUser)
        } else {
          await supabase.auth.signOut()
          setAuthError('Your Google account is not authorized. Contact an admin.')
        }
      }
      setIsLoading(false)
    })

    // Listen for auth state changes (handles OAuth redirect callback)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user?.email) {
        const appUser = await resolveUserFromEmail(session.user.email)
        if (appUser) {
          setUser(appUser)
          setAuthError(null)
        } else {
          await supabase.auth.signOut()
          setAuthError('Your Google account is not authorized. Contact an admin.')
        }
        setIsLoading(false)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        setIsLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

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
    // On success the browser redirects to Google — no further action needed here
  }

  const logout = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
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

  return (
    <AuthContext.Provider value={{ user, loginWithGoogle, logout, isLoading, authError }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

// View access config — used by sidebar + route guard
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

export function canAccess(view: string, role: UserRole): boolean {
  const allowed = VIEW_ACCESS[view]
  return allowed ? allowed.includes(role) : false
}
