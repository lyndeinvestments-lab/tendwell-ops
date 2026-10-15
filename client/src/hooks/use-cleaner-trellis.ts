import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { RosterRow } from '@/lib/cleaner-metrics'

// Trellis roster + login data for the Cleaners page (WS3). trellis_roster and
// trellis_roster_dismissals are admin-read (RLS), so callers pass
// `enabled: isAdmin` and the roster-dependent panels render for admins only.

export const ROSTER_QUERY_KEY = ['cleaners', 'trellis-roster'] as const
export const DISMISSALS_QUERY_KEY = ['cleaners', 'roster-dismissals'] as const
export const CREW_LOGINS_QUERY_KEY = ['cleaners', 'crew-logins'] as const

export interface RosterWithMeta extends RosterRow {
  removed_at: string | null
}

export function useTrellisRoster(enabled: boolean) {
  return useQuery<RosterWithMeta[]>({
    queryKey: ROSTER_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trellis_roster')
        .select('user_id, name, email, role, departments, is_active, last_seen_at, removed_at, workspace')
        .eq('workspace', 'A')
        .order('name')
      if (error) throw error
      return (data ?? []) as RosterWithMeta[]
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

export function useRosterDismissals(enabled: boolean) {
  return useQuery<Set<string>>({
    queryKey: DISMISSALS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('trellis_roster_dismissals').select('user_id')
      if (error) throw error
      return new Set((data ?? []).map(d => d.user_id))
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

export interface LoginRow {
  id: number
  google_email: string | null
  role: string | null
  label: string | null
}

/** Staff logins, used to show which cleaners still have an app login and to
 *  offer removing a crew login when offboarding (admin only). */
export function useCrewLogins(enabled: boolean) {
  return useQuery<LoginRow[]>({
    queryKey: CREW_LOGINS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_users').select('id, google_email, role, label')
      if (error) throw error
      return (data ?? []) as LoginRow[]
    },
    enabled,
    staleTime: 2 * 60 * 1000,
  })
}
