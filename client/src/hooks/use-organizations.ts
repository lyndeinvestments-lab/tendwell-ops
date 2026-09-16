import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface Organization {
  id: string
  name: string
  notes: string | null
  billing_channel: string
  payment_method: string | null
  payment_notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export const ORGANIZATIONS_QUERY_KEY = ['organizations'] as const

const TWO_MIN_MS = 2 * 60 * 1000
const THIRTY_MIN_MS = 30 * 60 * 1000

export function useOrganizations(opts?: { enabled?: boolean; activeOnly?: boolean }) {
  const activeOnly = opts?.activeOnly ?? true
  return useQuery<Organization[]>({
    queryKey: [...ORGANIZATIONS_QUERY_KEY, { activeOnly }],
    queryFn: async () => {
      let q = supabase.from('organizations').select('*').order('name')
      if (activeOnly) q = q.eq('is_active', true)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Organization[]
    },
    staleTime: TWO_MIN_MS,
    gcTime: THIRTY_MIN_MS,
    refetchOnWindowFocus: false,
    enabled: opts?.enabled ?? true,
  })
}
