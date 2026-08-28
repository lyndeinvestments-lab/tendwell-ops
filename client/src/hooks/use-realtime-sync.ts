import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { invalidateAllPropertyQueries } from '@/lib/query-invalidations'

// Live cross-device sync: subscribe to Postgres change events on the core
// operational tables (whatever tables the `supabase_realtime` publication
// carries — migration 20260828_realtime_publication.sql) and invalidate the
// matching query caches, so an edit saved on one device appears on every
// other open screen within a second or two — no foreground transition or
// manual Refresh needed.
//
// Realtime enforces RLS per subscriber (each client only receives events for
// rows its own JWT could SELECT), so this leaks nothing beyond what a direct
// read already allows.
//
// This is a freshness layer, not a delivery guarantee: sockets die when a
// phone backgrounds the app. The existing foreground-transition invalidation
// in App.tsx covers whatever was missed while disconnected.

export const REALTIME_TABLES = [
  'properties',
  'property_notes',
  'cleaners',
  'contacts',
  'inspections',
  'cleaning_issues',
] as const

// Non-property tables → the query-key prefixes that read them. Property
// tables go through the shared invalidateAllPropertyQueries registry instead.
const TABLE_KEY_PREFIXES: Record<string, string[]> = {
  cleaners: ['cleaners', '/supabase/all-assignments', '/supabase/cleaners-active-props'],
  contacts: ['contacts', '/supabase/contact-portals', '/supabase/contact-properties'],
  inspections: ['/supabase/inspections-all', '/supabase/dashboard-inspections', '/supabase/dashboard-scheduled-week'],
  cleaning_issues: ['/supabase/cleaning-issues', '/supabase/issue-comments', '/supabase/issue-photos'],
}

export function invalidateForTable(qc: QueryClient, table: string) {
  if (table === 'properties' || table === 'property_notes') {
    invalidateAllPropertyQueries(qc)
    return
  }
  const prefixes = TABLE_KEY_PREFIXES[table]
  if (!prefixes) return
  qc.invalidateQueries({
    predicate: q => {
      const first = Array.isArray(q.queryKey) ? q.queryKey[0] : q.queryKey
      return typeof first === 'string' && prefixes.some(p => first.startsWith(p))
    },
  })
}

export function useRealtimeSync(enabled: boolean) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!enabled) return

    // Leading-edge + trailing-edge coalescing: a lone edit invalidates
    // immediately, while a burst (CSV import, bulk edit, the reconcile
    // engine rewriting a run) collapses into one trailing invalidation
    // instead of refetching once per row.
    const pending = new Set<string>()
    let timer: number | undefined
    const flush = () => {
      timer = undefined
      if (pending.size === 0) return
      const tables = Array.from(pending)
      pending.clear()
      tables.forEach(t => invalidateForTable(qc, t))
    }
    const onChange = (payload: { table: string }) => {
      if (timer == null) {
        invalidateForTable(qc, payload.table)
        timer = window.setTimeout(flush, 1500)
      } else {
        pending.add(payload.table)
      }
    }

    let channel = supabase.channel('db-sync')
    for (const table of REALTIME_TABLES) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        onChange,
      )
    }
    // supabase-js reconnects the socket and rejoins channels on its own;
    // no manual retry needed. Gaps while disconnected are covered by the
    // App-level foreground invalidation.
    channel.subscribe()

    return () => {
      if (timer != null) window.clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [enabled, qc])
}
