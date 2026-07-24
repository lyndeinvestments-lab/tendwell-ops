import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, logPropertyEdit } from '@/lib/supabase'
import { invalidateAllPropertyQueries } from '@/lib/query-invalidations'

const KEY = ['/supabase/trellis-sync'] as const

export interface SyncProgress {
  phase: string
  current: number
  total: number
  pct: number
  eta_seconds: number
  message: string
}

export interface ReconRow {
  ops_property_id: number
  ops_name: string
  linked_trellis_id: string | null
  linked_trellis_name: string | null
  linked_workspace: 'A' | 'B' | null
  is_tendwell_property: boolean | null
  tendwell_task_count: number | null
  suggested_trellis_id: string | null
  suggested_trellis_name: string | null
  suggested_workspace: 'A' | 'B' | null
  match_status: 'matched' | 'stale' | 'suggested' | 'unmatched'
}
export interface ExceptionRow {
  trellis_id: string
  name: string
  workspace: 'A' | 'B'
  status: string | null
  tendwell_task_count: number
}
export interface RosterRow {
  user_id: string
  name: string | null
  email: string | null
  role: string | null
  departments: string[]
  is_active: boolean
}
export interface TaskRow {
  trellis_task_id: string
  workspace: 'A' | 'B'
  property_name: string | null
  title: string | null
  department_name: string | null
  status: string | null
  priority: string | null
  assigned_to_name: string | null
  scheduled_date: string | null
  completed_at: string | null
  is_tendwell: boolean
}
export interface SyncLogRow {
  id: string
  status: 'requested' | 'running' | 'done' | 'error' | 'canceled'
  trigger: string
  requested_by: string | null
  started_at: string | null
  finished_at: string | null
  counts: Record<string, number> | null
  error: string | null
  progress: SyncProgress | null
  cancel_requested: boolean
  created_at: string
}

export interface TrellisPropOption {
  trellis_id: string
  name: string
  workspace: 'A' | 'B'
}

export interface DismissalRow {
  id: string
  kind: string
  trellis_property_id: string | null
  ops_property_id: number | null
  dismissed_by: string | null
  created_at: string
}

export interface BreezewayCoverageRow {
  property_id: number
  clean_count: number
  last_clean_due: string | null
}

export interface BreezewayExceptionRow {
  property_raw: string
  clean_count: number
  task_count: number
  first_due: string | null
  last_due: string | null
}

export interface OpsPropertyOption {
  id: number
  name: string
}

export function useTrellisSync() {
  const qc = useQueryClient()

  const recon = useQuery({
    queryKey: [...KEY, 'recon'],
    queryFn: async (): Promise<ReconRow[]> => {
      const { data, error } = await supabase.from('trellis_reconciliation').select('*').order('ops_name')
      if (error) throw error
      return (data ?? []) as ReconRow[]
    },
    refetchOnWindowFocus: false,
  })

  const exceptions = useQuery({
    queryKey: [...KEY, 'exceptions'],
    queryFn: async (): Promise<ExceptionRow[]> => {
      const { data, error } = await supabase.from('trellis_exceptions').select('*').order('name')
      if (error) throw error
      return (data ?? []) as ExceptionRow[]
    },
    refetchOnWindowFocus: false,
  })

  const roster = useQuery({
    queryKey: [...KEY, 'roster'],
    queryFn: async (): Promise<RosterRow[]> => {
      const { data, error } = await supabase.from('trellis_roster').select('*').order('name')
      if (error) throw error
      return (data ?? []) as RosterRow[]
    },
    refetchOnWindowFocus: false,
  })

  // Most recent DONE row — shown as "Last synced X ago". Never let
  // in-progress rows corrupt this display.
  const lastDoneSync = useQuery({
    queryKey: [...KEY, 'lastDoneSync'],
    queryFn: async (): Promise<SyncLogRow | null> => {
      const { data, error } = await supabase
        .from('trellis_sync_log').select('*')
        .eq('status', 'done')
        .order('finished_at', { ascending: false }).limit(1)
      if (error) throw error
      return (data?.[0] ?? null) as unknown as SyncLogRow | null
    },
    refetchOnWindowFocus: false,
  })

  // Live row — any status. Polled every 2s while running/requested.
  const lastSync = useQuery({
    queryKey: [...KEY, 'lastSync'],
    queryFn: async (): Promise<SyncLogRow | null> => {
      const { data, error } = await supabase
        .from('trellis_sync_log').select('*')
        .order('created_at', { ascending: false }).limit(1)
      if (error) throw error
      return (data?.[0] ?? null) as unknown as SyncLogRow | null
    },
    // Poll at 2s while running or canceling (cancel_requested=true), 5s for requested, else stop.
    refetchInterval: (q) => {
      const row = q.state.data as SyncLogRow | null
      if (row?.status === 'running') return 2000
      if (row?.status === 'requested') return 5000
      return false
    },
    refetchOnWindowFocus: false,
  })

  // Sync history — most recent 50 rows for the History tab.
  const syncHistory = useQuery({
    queryKey: [...KEY, 'history'],
    queryFn: async (): Promise<SyncLogRow[]> => {
      const { data, error } = await supabase
        .from('trellis_sync_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as unknown as SyncLogRow[]
    },
    refetchOnWindowFocus: false,
  })

  // Every Trellis snapshot property — the option list for manually picking a
  // match on any row (matched / unmatched / suggested / stale).
  const trellisProps = useQuery({
    queryKey: [...KEY, 'trellisProps'],
    queryFn: async (): Promise<TrellisPropOption[]> => {
      const { data, error } = await supabase
        .from('trellis_property_snapshot').select('trellis_id, name, workspace').order('name')
      if (error) throw error
      return (data ?? []) as TrellisPropOption[]
    },
    refetchOnWindowFocus: false,
  })

  const breezewayCoverage = useQuery({
    queryKey: [...KEY, 'breezewayCoverage'],
    queryFn: async (): Promise<BreezewayCoverageRow[]> => {
      const { data, error } = await (supabase as any)
        .from('breezeway_property_coverage')
        .select('property_id, clean_count, last_clean_due')
      if (error) throw error
      return (data ?? []) as BreezewayCoverageRow[]
    },
    refetchOnWindowFocus: false,
  })

  const breezewayExceptions = useQuery({
    queryKey: [...KEY, 'breezewayExceptions'],
    queryFn: async (): Promise<BreezewayExceptionRow[]> => {
      const { data, error } = await (supabase as any)
        .from('breezeway_exceptions')
        .select('*')
        .order('clean_count', { ascending: false })
      if (error) throw error
      return (data ?? []) as BreezewayExceptionRow[]
    },
    refetchOnWindowFocus: false,
  })

  // Ops properties — option list for the Breezeway match picker.
  // Excludes soft-deleted properties (deleted_at IS NOT NULL).
  const opsProperties = useQuery({
    queryKey: [...KEY, 'opsProperties'],
    queryFn: async (): Promise<OpsPropertyOption[]> => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name')
        .is('deleted_at', null)
        .order('name')
      if (error) throw error
      return (data ?? []) as OpsPropertyOption[]
    },
    refetchOnWindowFocus: false,
  })

  // Admin-controlled dismissals for exception + reconciliation rows.
  // The view does NOT filter these — the client handles show/hide via toggle.
  // Note: cast to `any` because generated DB types don't include this table
  // until the migration is applied and types are regenerated.
  const dismissals = useQuery({
    queryKey: [...KEY, 'dismissals'],
    queryFn: async (): Promise<DismissalRow[]> => {
      const { data, error } = await (supabase as any)
        .from('trellis_reconciliation_dismissals')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as DismissalRow[]
    },
    refetchOnWindowFocus: false,
  })

  // Link an Ops property to a Trellis property (confirm a suggested/changed match).
  const linkMatch = useMutation({
    mutationFn: async ({ opsId, opsName, trellisId }: { opsId: number; opsName: string; trellisId: string | null }) => {
      const { error } = await supabase.from('properties').update({ trellis_id: trellisId }).eq('id', opsId)
      if (error) throw error
      await logPropertyEdit(opsId, 'trellis_id', null, trellisId, opsName)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...KEY, 'recon'] })
      qc.invalidateQueries({ queryKey: [...KEY, 'exceptions'] })
      // Writing properties.trellis_id changes a shared property row — refresh
      // every property-derived view (and the opsProperties sub-query here).
      invalidateAllPropertyQueries(qc)
    },
  })

  // Dismiss a row — inserts a record into trellis_reconciliation_dismissals.
  // kind = 'trellis_not_in_ops'   → set trellis_property_id
  // kind = 'ops_not_in_trellis'   → set ops_property_id
  // Cast to `any` — table not yet in generated DB types (pending migration).
  const dismissRow = useMutation({
    mutationFn: async (row: Omit<DismissalRow, 'id' | 'created_at'>) => {
      const { error } = await (supabase as any)
        .from('trellis_reconciliation_dismissals')
        .insert(row)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...KEY, 'dismissals'] })
    },
  })

  // Restore a dismissed row — deletes by id.
  // Cast to `any` — table not yet in generated DB types (pending migration).
  const restoreRow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('trellis_reconciliation_dismissals')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...KEY, 'dismissals'] })
    },
  })

  // Match a Breezeway orphan to an Ops property — upserts into
  // breezeway_property_resolutions then back-fills property_id on existing
  // breezeway_tasks rows that are still unmatched for that raw string.
  // Cast to `any` — table not yet in generated DB types.
  const matchBreezeway = useMutation({
    mutationFn: async ({ propertyRaw, propertyId, resolvedBy }: { propertyRaw: string; propertyId: number; resolvedBy: string }) => {
      const { error: resErr } = await (supabase as any)
        .from('breezeway_property_resolutions')
        .upsert(
          { property_raw: propertyRaw, status: 'matched', property_id: propertyId, resolved_by: resolvedBy },
          { onConflict: 'property_raw' }
        )
      if (resErr) throw resErr
      const { error: taskErr } = await (supabase as any)
        .from('breezeway_tasks')
        .update({ property_id: propertyId })
        .eq('property_raw', propertyRaw)
        .is('property_id', null)
      if (taskErr) throw taskErr
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...KEY, 'breezewayExceptions'] })
      qc.invalidateQueries({ queryKey: [...KEY, 'breezewayCoverage'] })
    },
  })

  // Dismiss a Breezeway orphan — upserts status='ignored' so the
  // breezeway_exceptions view hides it on next refetch.
  // Cast to `any` — table not yet in generated DB types.
  const dismissBreezeway = useMutation({
    mutationFn: async ({ propertyRaw, resolvedBy }: { propertyRaw: string; resolvedBy: string }) => {
      const { error } = await (supabase as any)
        .from('breezeway_property_resolutions')
        .upsert(
          { property_raw: propertyRaw, status: 'ignored', property_id: null, resolved_by: resolvedBy },
          { onConflict: 'property_raw' }
        )
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...KEY, 'breezewayExceptions'] })
    },
  })

  // Trigger a real server-side sync via POST /api/trellis/sync-now.
  // Returns the log row id so the polling query can pick it up immediately.
  const triggerSync = useMutation({
    mutationFn: async (): Promise<{ log_id: string }> => {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) throw new Error('Not authenticated')
      const res = await fetch('/api/trellis/sync-now', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      return json as { log_id: string }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...KEY, 'lastSync'] })
      qc.invalidateQueries({ queryKey: [...KEY, 'lastDoneSync'] })
    },
  })

  // Request cooperative cancellation of a running sync via POST /api/trellis/sync-cancel.
  const cancelSync = useMutation({
    mutationFn: async (): Promise<{ ok: boolean; log_id?: string; message?: string }> => {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) throw new Error('Not authenticated')
      const res = await fetch('/api/trellis/sync-cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      return json as { ok: boolean; log_id?: string; message?: string }
    },
    onSuccess: () => {
      // Keep polling — lastSync will eventually flip to 'canceled'
      qc.invalidateQueries({ queryKey: [...KEY, 'lastSync'] })
    },
  })

  return { recon, exceptions, roster, lastSync, lastDoneSync, syncHistory, trellisProps, opsProperties, dismissals, breezewayCoverage, breezewayExceptions, dismissRow, restoreRow, linkMatch, matchBreezeway, dismissBreezeway, triggerSync, cancelSync }
}

// Workflows tab pulls task rows on demand (one query per workflow).
export async function fetchTasks(filter: {
  tendwellOnly?: boolean
  scheduledFrom?: string
  scheduledTo?: string
  titleILike?: string
  unassignedTendwellCo?: boolean
  openOnly?: boolean
}): Promise<TaskRow[]> {
  let q = supabase.from('trellis_task_attributed').select('*')
  if (filter.tendwellOnly) q = q.eq('is_tendwell', true)
  if (filter.unassignedTendwellCo) q = q.eq('assigned_to_name', 'Tendwell Cleaning Co.')
  if (filter.scheduledFrom) q = q.gte('scheduled_date', filter.scheduledFrom)
  if (filter.scheduledTo) q = q.lte('scheduled_date', filter.scheduledTo)
  if (filter.titleILike) q = q.ilike('title', `%${filter.titleILike}%`)
  if (filter.openOnly) q = q.is('completed_at', null)
  const { data, error } = await q.order('scheduled_date').limit(500)
  if (error) throw error
  return (data ?? []) as TaskRow[]
}
