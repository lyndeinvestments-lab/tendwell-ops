import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Shared hook for the contacts reference list (~10 rows today, growing).
//
// Before this hook, 6+ pages each used their own queryKey for contacts.
// ContactModal mutations only invalidated ['/supabase/contacts'] — so
// adding/editing a client on the Clients page didn't refresh dropdowns on
// the Command Palette, Property modal, Dashboard, Alerts, Revenue Report,
// or Quote Sheet until their per-page staleTime expired.
//
// One shared queryKey + a 2-minute staleTime (contacts change more often
// than pipeline_stages or cleaners) + a 30-minute gcTime means a single
// fetch covers the whole app, and a single invalidate from any contact
// mutation refreshes every consumer simultaneously.
//
// Not consolidated:
//   - ContactModal's single-contact-by-id fetch (different shape)
//   - alerts.tsx & contacts.tsx queries that JOIN properties(id) for
//     the per-contact property count column

export interface Contact {
  id: string
  full_name: string
  company: string | null
  email: string | null
  phone: string | null
  secondary_phone: string | null
  mailing_address: string | null
  source: string | null
  source_notes: string | null
  payment_method: string | null
  payment_notes: string | null
  client_since: string | null
  additional_properties_count: number | null
  additional_properties_notes: string | null
  tags: string[] | null
  notes: string | null
  is_active: boolean | null
  created_at: string | null
  updated_at: string | null
}

export const CONTACTS_QUERY_KEY = ['contacts'] as const

const TWO_MIN_MS = 2 * 60 * 1000
const THIRTY_MIN_MS = 30 * 60 * 1000

export function useContacts(opts?: { enabled?: boolean }) {
  return useQuery<Contact[]>({
    queryKey: CONTACTS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .order('full_name')
      if (error) throw error
      return (data ?? []) as Contact[]
    },
    staleTime: TWO_MIN_MS,
    gcTime: THIRTY_MIN_MS,
    refetchOnWindowFocus: false,
    enabled: opts?.enabled ?? true,
  })
}
