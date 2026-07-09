import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** YYYY-MM-DD for "today" in America/Chicago (en-CA locale formats ISO-style). */
export function todayInCentral(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

export interface TrellisTasksToday {
  date: string
  count: number
  syncedAt: string | null
}

// Deterministic count from the trellis_task_snapshot table (staff-readable,
// refreshed by the nightly full sync + hourly tasks-only cron). Replaces the
// old server proxy that asked a Trellis agent and parsed an integer out of
// its free-text reply — non-deterministic and billed per pageview.
export function useTrellisTasksToday() {
  return useQuery<TrellisTasksToday>({
    queryKey: ['/supabase/trellis-tasks-today'],
    queryFn: async () => {
      const date = todayInCentral()
      const { count, error } = await supabase
        .from('trellis_task_snapshot')
        .select('*', { count: 'exact', head: true })
        .in('status', ['SCHEDULED', 'OPEN'])
        .eq('scheduled_date', date)
      if (error) throw error
      const { data: latest } = await supabase
        .from('trellis_task_snapshot')
        .select('synced_at')
        .order('synced_at', { ascending: false })
        .limit(1)
      return { date, count: count ?? 0, syncedAt: (latest?.[0] as { synced_at?: string } | undefined)?.synced_at ?? null }
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
}
