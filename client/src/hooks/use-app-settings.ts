import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

type SettingsMap = Record<string, string>

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
    staleTime: 60_000,
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
