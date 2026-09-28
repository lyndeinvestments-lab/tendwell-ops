import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

const KEY = ['/supabase/ui-prefs'] as const

/**
 * The signed-in staff user's saved UI preferences (app_users.ui_prefs),
 * read and written through caller-scoped RPCs so it works for every role,
 * not just admins. Returns {} for users without an app_users row.
 */
export function useUiPrefs() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Record<string, unknown>> => {
      const { data, error } = await supabase.rpc('get_my_ui_prefs' as never)
      if (error) throw error
      return (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>
    },
    staleTime: 5 * 60 * 1000,
  })

  const save = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      const { error } = await supabase.rpc('set_my_ui_pref' as never, { p_key: key, p_value: value } as never)
      if (error) throw error
    },
    onSuccess: (_d, { key, value }) => {
      queryClient.setQueryData<Record<string, unknown>>(KEY, prev => ({ ...(prev ?? {}), [key]: value }))
    },
  })

  return { prefs: data ?? {}, isLoading, savePref: save.mutateAsync, isSaving: save.isPending }
}
