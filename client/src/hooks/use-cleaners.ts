import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useCanViewFinancials } from '@/lib/financial-access'

// Shared hook for the cleaners reference table (~15 rows).
//
// Before this hook, 6 separate pages each used their own queryKey and
// projection, so:
//   - Adding a cleaner on the Cleaners page only invalidated 1 of 6
//     caches — the inspections / cost-tracking / cleaner-metrics
//     dropdowns kept a stale list for up to 60s
//   - Every page firing a fresh request for the same tiny table
//
// One shared queryKey + a short staleTime + a 4-hour gcTime means a
// single fetch covers the whole app, and a single invalidate from the
// Cleaners page's mutations refreshes every consumer at once.
//
// staleTime is 2 minutes (was 15) with window-focus refetch ON: cleaners are
// edited from other devices/sessions too (real case: a cleaner provisioned by
// an admin didn't appear in the inspector dropdown on another machine for up
// to 15 minutes), and this table is ~15 rows — refetching it is cheap.

export interface Cleaner {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  alt_email: string | null
  notes: string | null
  created_at: string | null
  is_active: boolean | null
  app_role: string | null
  invite_sent_at: string | null
  /** Trellis workspace-A user this cleaner is linked to (sync or admin link). */
  trellis_user_id: string | null
  status: 'active' | 'offboarded' | string | null
  offboarded_at: string | null
  /** Staff member's name for a manual offboard; 'trellis-sync' when the sync did it. */
  offboarded_by: string | null
  /** 'manual' (added in Ops) or 'trellis' (created from the Trellis roster). */
  source: string | null
}

/**
 * Explicit column list, never `*`: since 20261014e2 the browser role has no
 * SELECT on `cleaners.pay_rate` (finance staff read it via cleaner_pay_rates()),
 * so a `select('*')` on cleaners fails with permission denied.
 */
export const CLEANER_COLUMNS =
  'id, full_name, phone, email, alt_email, notes, created_at, is_active, app_role, invite_sent_at, trellis_user_id, status, offboarded_at, offboarded_by, source'

export const CLEANERS_QUERY_KEY = ['cleaners'] as const

const TWO_MIN_MS = 2 * 60 * 1000
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

export function useCleaners(opts?: { activeOnly?: boolean; enabled?: boolean }) {
  const q = useQuery<Cleaner[]>({
    queryKey: CLEANERS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cleaners')
        .select(CLEANER_COLUMNS)
        .order('full_name')
      if (error) throw error
      return (data ?? []) as Cleaner[]
    },
    staleTime: TWO_MIN_MS,
    gcTime: FOUR_HOURS_MS,
    enabled: opts?.enabled ?? true,
  })

  // activeOnly is applied client-side so we keep one shared cache entry.
  // 15 rows × 1 boolean check is free; the benefit is one fewer query key.
  if (opts?.activeOnly && q.data) {
    return { ...q, data: q.data.filter(c => c.is_active !== false) }
  }
  return q
}

export const CLEANER_PAY_RATES_QUERY_KEY = ['cleaners', 'pay-rates'] as const

/**
 * Cleaner pay rates by cleaner id, for finance staff only. Crews (cleaning /
 * inspector / supervisor) never fetch it, and the RPC returns no rows for them
 * anyway (staff_has_financial_view() gate in the database).
 */
export function useCleanerPayRates() {
  const canViewFinancials = useCanViewFinancials()
  return useQuery<Map<string, number | null>>({
    queryKey: CLEANER_PAY_RATES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_pay_rates')
      if (error) throw error
      return new Map((data ?? []).map((r: { cleaner_id: string; pay_rate: number | null }) => [r.cleaner_id, r.pay_rate == null ? null : Number(r.pay_rate)]))
    },
    enabled: canViewFinancials,
    staleTime: TWO_MIN_MS,
    gcTime: FOUR_HOURS_MS,
  })
}
