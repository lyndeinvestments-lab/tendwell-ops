import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Shared hook for the cleaners reference table (~15 rows).
//
// Before this hook, 6 separate pages each used their own queryKey and
// projection, so:
//   - Adding a cleaner on the Cleaners page only invalidated 1 of 6
//     caches — the inspections / cost-tracking / cleaner-metrics
//     dropdowns kept a stale list for up to 60s
//   - Every page firing a fresh request for the same tiny table
//
// One shared queryKey + a 15-minute staleTime + a 4-hour gcTime means a
// single fetch covers the whole app, and a single invalidate from the
// Cleaners page's mutations refreshes every consumer at once.

export interface Cleaner {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  pay_rate: number | null
  notes: string | null
  created_at: string | null
  is_active: boolean | null
  app_role: string | null
  invite_sent_at: string | null
}

export const CLEANERS_QUERY_KEY = ['cleaners'] as const

const FIFTEEN_MIN_MS = 15 * 60 * 1000
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

export function useCleaners(opts?: { activeOnly?: boolean; enabled?: boolean }) {
  const q = useQuery<Cleaner[]>({
    queryKey: CLEANERS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cleaners')
        .select('*')
        .order('full_name')
      if (error) throw error
      return (data ?? []) as Cleaner[]
    },
    staleTime: FIFTEEN_MIN_MS,
    gcTime: FOUR_HOURS_MS,
    refetchOnWindowFocus: false,
    enabled: opts?.enabled ?? true,
  })

  // activeOnly is applied client-side so we keep one shared cache entry.
  // 15 rows × 1 boolean check is free; the benefit is one fewer query key.
  if (opts?.activeOnly && q.data) {
    return { ...q, data: q.data.filter(c => c.is_active !== false) }
  }
  return q
}
