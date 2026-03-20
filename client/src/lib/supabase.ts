import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// In-memory storage to avoid localStorage (blocked in sandboxed iframes)
const memoryStorage: Record<string, string> = {}
const inMemoryStorageAdapter = {
  getItem: (key: string) => memoryStorage[key] ?? null,
  setItem: (key: string, value: string) => { memoryStorage[key] = value },
  removeItem: (key: string) => { delete memoryStorage[key] },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: inMemoryStorageAdapter,
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})

// Stage colors matching database values
export const STAGE_COLORS: Record<string, string> = {
  'Lead': '#6b7280',
  'Quote': '#9333ea',
  'Onboarding': '#3b82f6',
  'Active': '#3f7a63',
  'Offboarding': '#f97316',
  'Offboarded': '#9ca3af',
}

// Stage order for pipeline
export const STAGE_ORDER = ['Lead', 'Quote', 'Onboarding', 'Active', 'Offboarding', 'Offboarded']
