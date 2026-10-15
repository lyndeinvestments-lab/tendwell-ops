import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Per-property clean cadence from the property_clean_stats view: Trellis
// (Tendwell completed cleans) from app_settings.clean_source_cutover on, the
// Breezeway archive before it. Shared by Pro Forma > Pricing and the Master
// List so both pages show the same Cleans/Mo and first clean date.

export interface PropertyCleanStatsRow {
  property_id: number
  total_cleans: number
  months_with_data: number
  avg_cleans_per_month: number
  avg_deep_cleans_per_month: number
  latest_task: string | null
  first_clean_date: string | null
  cleans_90d: number
}

export const PROPERTY_CLEAN_STATS_KEY = ['/supabase/property-clean-stats'] as const

export function usePropertyCleanStats() {
  const query = useQuery({
    queryKey: PROPERTY_CLEAN_STATS_KEY,
    staleTime: 300_000,
    queryFn: async (): Promise<PropertyCleanStatsRow[]> => {
      const { data, error } = await (supabase as any)
        .from('property_clean_stats')
        .select('property_id, total_cleans, months_with_data, avg_cleans_per_month, avg_deep_cleans_per_month, latest_task, first_clean_date, cleans_90d')
      if (error) throw error
      return (data || []) as PropertyCleanStatsRow[]
    },
  })
  const byId = useMemo(() => {
    const m = new Map<string, PropertyCleanStatsRow>()
    for (const r of query.data ?? []) m.set(String(r.property_id), r)
    return m
  }, [query.data])
  return { ...query, byId }
}
