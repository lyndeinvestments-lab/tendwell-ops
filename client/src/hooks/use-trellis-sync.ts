import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, logPropertyEdit } from '@/lib/supabase'

const KEY = ['/supabase/trellis-sync'] as const

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
  status: 'requested' | 'running' | 'done' | 'error'
  trigger: string
  started_at: string | null
  finished_at: string | null
  counts: Record<string, number> | null
  error: string | null
  created_at: string
}

export interface TrellisPropOption {
  trellis_id: string
  name: string
  workspace: 'A' | 'B'
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

  const lastSync = useQuery({
    queryKey: [...KEY, 'lastSync'],
    queryFn: async (): Promise<SyncLogRow | null> => {
      const { data, error } = await supabase
        .from('trellis_sync_log').select('*')
        .order('created_at', { ascending: false }).limit(1)
      if (error) throw error
      return (data?.[0] ?? null) as SyncLogRow | null
    },
    // Poll while a sync is in flight so the page reflects requested→running→done.
    refetchInterval: (q) => {
      const s = (q.state.data as SyncLogRow | null)?.status
      return s === 'requested' || s === 'running' ? 5000 : false
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
    },
  })

  // Enqueue an on-demand sync; the local poller picks it up.
  const requestSync = useMutation({
    mutationFn: async (requestedBy: string) => {
      const { error } = await supabase.from('trellis_sync_log').insert({ status: 'requested', trigger: 'manual', requested_by: requestedBy })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'lastSync'] }),
  })

  return { recon, exceptions, roster, lastSync, trellisProps, linkMatch, requestSync }
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
