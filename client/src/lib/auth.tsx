import { createContext, useContext, useState, ReactNode } from 'react'

export type UserRole = 'admin' | 'operations' | 'cleaning'

export interface AuthUser {
  role: UserRole
  label: string
  allowedViews: string[]
}

interface AuthContextType {
  user: AuthUser | null
  login: (password: string) => Promise<void>
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function login(password: string) {
    setIsLoading(true)
    try {
      // Authenticate via server-side endpoint (password never compared client-side)
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Invalid password')
      }

      const data = await response.json()

      setUser({
        role: data.role as UserRole,
        label: data.label,
        allowedViews: data.allowedViews || [],
      })
    } catch (e: any) {
      throw new Error(e.message || 'Invalid password')
    } finally {
      setIsLoading(false)
    }
  }

  function logout() {
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
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
  dashboard: ['admin'],
  pipeline: ['admin'],
  'quote-sheet': ['admin'],
  'cost-tracking': ['admin'],
  'property-list': ['admin', 'operations'],
  'linen-tracker': ['admin', 'operations', 'cleaning'],
  'access-codes': ['admin', 'operations'],
  'ac-filters': ['admin', 'operations'],
  'master-list': ['admin'],
  'pro-forma': ['admin'],
  'previous-properties': ['admin'],
  settings: ['admin'],
}

export function canAccess(view: string, role: UserRole): boolean {
  const allowed = VIEW_ACCESS[view]
  return allowed ? allowed.includes(role) : false
}
