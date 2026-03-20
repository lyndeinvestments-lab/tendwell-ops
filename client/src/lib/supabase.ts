import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://eetsudoksvsmwtiqraot.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVldHN1ZG9rc3ZzbXd0aXFyYW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMjExMzksImV4cCI6MjA4OTU5NzEzOX0.VRo5_l4K5ncYT6e4HuL53dh3cVnLMFxx2zr-egE7-bU'

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
