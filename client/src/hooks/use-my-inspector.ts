import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface MyInspector {
  id: string
  full_name: string
}

/**
 * Resolves the logged-in user to their `cleaners` row (the table that
 * `inspections.inspector_id` references), matched by email — the same
 * email link used by the cleaner-invite flow (`cleaners.email` ↔
 * `app_users.google_email` ↔ auth session email).
 *
 * Returns null for staff who aren't in the cleaners table, so callers can
 * decide whether to show inspector-first UI.
 */
export function useMyInspector() {
  const { data, isLoading } = useQuery({
    queryKey: ['/supabase/my-inspector'],
    queryFn: async (): Promise<MyInspector | null> => {
      const { data: userData } = await supabase.auth.getUser()
      const email = userData?.user?.email?.trim().toLowerCase()
      if (!email) return null
      const { data: rows, error } = await supabase
        .from('cleaners')
        .select('id, full_name, email, is_active')
        .ilike('email', email)
        .limit(1)
      if (error) throw error
      const row = rows?.[0]
      if (!row || row.is_active === false) return null
      return { id: row.id, full_name: row.full_name }
    },
    staleTime: 15 * 60 * 1000,
  })
  return { myInspector: data ?? null, isLoading }
}
