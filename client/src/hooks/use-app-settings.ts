import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

type SettingsMap = Record<string, string>

// app_settings is a small KV reference table edited only via the Settings
// page, which invalidates this query on save. 1-hour staleTime + 4-hour
// gcTime means every page that needs settings (cost-tracking, quote-sheet,
// ac-filters, etc.) gets an instant in-memory hit instead of refetching
// every 60s as the queryClient default was driving.
const ONE_HOUR_MS = 60 * 60 * 1000
const FOUR_HOURS_MS = 4 * ONE_HOUR_MS

export function useAppSettings() {
  const { data, isLoading } = useQuery({
    queryKey: ['/supabase/app_settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('key, value')
      if (error) throw error
      const map: SettingsMap = {}
      for (const row of data ?? []) map[row.key] = row.value
      return map
    },
    staleTime: ONE_HOUR_MS,
    gcTime: FOUR_HOURS_MS,
    refetchOnWindowFocus: false,
  })

  const qc = useQueryClient()

  const { mutate: saveSetting } = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const { error } = await supabase
        .from('app_settings')
        .upsert({ key, value })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/supabase/app_settings'] }),
  })

  function get(key: string, fallback: string): string {
    if (!data) return fallback
    return data[key] ?? fallback
  }

  function getNumber(key: string, fallback: number): number {
    const v = get(key, String(fallback))
    const n = parseFloat(v)
    return isNaN(n) ? fallback : n
  }

  return { settings: data ?? {}, isLoading, get, getNumber, saveSetting }
}
