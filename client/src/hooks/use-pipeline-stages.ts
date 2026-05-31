import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Shared hook for the 6-row pipeline_stages reference table.
//
// Why this exists:
//   8 separate pages were each calling useQuery for pipeline_stages with
//   different query keys, so every page refetched on mount and they
//   each refreshed every 60s in the background by the React Query default.
//   That's ~8 redundant queries per session minimum.
//
//   Pipeline stages essentially never change at runtime — admins only edit
//   them through Settings, which already invalidates this query key. So
//   we share a single cache entry across the app with a long staleTime.

export interface PipelineStage {
  id: number
  name: string
  slug: string | null
  display_order: number | null
  color: string | null
  description: string | null
  is_operational: boolean | null
  requires_fields: string[] | null
  created_at: string | null
}

// Single shared query key — every consumer hits the same cache entry.
export const PIPELINE_STAGES_QUERY_KEY = ['pipeline_stages'] as const

const ONE_HOUR_MS = 60 * 60 * 1000
const FOUR_HOURS_MS = 4 * ONE_HOUR_MS

export function usePipelineStages(opts?: { enabled?: boolean }) {
  return useQuery<PipelineStage[]>({
    queryKey: PIPELINE_STAGES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('*')
        .order('display_order')
      if (error) throw error
      return (data ?? []) as PipelineStage[]
    },
    staleTime: ONE_HOUR_MS,
    gcTime: FOUR_HOURS_MS,
    refetchOnWindowFocus: false,
    enabled: opts?.enabled ?? true,
  })
}
