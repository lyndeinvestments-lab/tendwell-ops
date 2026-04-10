import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { TablePagination } from '@/components/TablePagination'
import {
  Search, X, Boxes, ArrowUpDown, ArrowUp, ArrowDown, Download, Plus, Check, ChevronDown, ChevronUp,
} from 'lucide-react'
import { format, differenceInDays } from 'date-fns'
import Papa from 'papaparse'

type ViewMode = 'snapshot' | 'record' | 'history'
type StatusFilter = 'all' | 'below-par' | 'not-counted'
type InventoryStatus = 'below-par' | 'at-par' | 'above-par' | 'not-counted'

function getStatus(sets: number | null | undefined, target: number): InventoryStatus {
  if (sets == null) return 'not-counted'
  if (sets < target) return 'below-par'
  if (sets === target) return 'at-par'
  return 'above-par'
}

function StatusBadge({ status }: { status: InventoryStatus }) {
  const config = {
    'below-par': { label: 'Below Par', cls: 'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800' },
    'at-par': { label: 'At Par', cls: 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800' },
    'above-par': { label: 'Above Par', cls: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-900/20 dark:border-blue-800' },
    'not-counted': { label: 'Not Counted', cls: 'text-gray-600 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-900/20 dark:border-gray-800' },
  }[status]
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${config.cls}`}>{config.label}</span>
}

function StaleIndicator({ countedAt }: { countedAt: string | null }) {
  if (!countedAt) return <span className="text-muted-foreground">—</span>
  const days = differenceInDays(new Date(), new Date(countedAt))
  const label = days === 0 ? 'Today' : `${days}d ago`
  const cls = days === 0 ? 'text-green-600 dark:text-green-400' : days <= 7 ? 'text-foreground' : days <= 30 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
  return <span className={`text-xs ${cls}`}>{label}</span>
}

// ─── DETAIL FIELDS for expanded piece-level counts ──────────────────────────
const PIECE_FIELDS = [
  { key: 'king_sets', label: 'King Sets' },
  { key: 'queen_sets', label: 'Queen Sets' },
  { key: 'full_sets', label: 'Full Sets' },
  { key: 'twin_sets', label: 'Twin Sets' },
  { key: 'bath_towels', label: 'Bath Towels' },
  { key: 'washcloths', label: 'Washcloths' },
  { key: 'hand_towels', label: 'Hand Towels' },
  { key: 'bathmats', label: 'Bathmats' },
  { key: 'pool_towels', label: 'Pool Towels' },
]

export default function LinenInventoryPage() {
  usePageTitle('Linen Inventory')
  const { toast } = useToast()
  const { effectiveUser } = useAuth()
  const qc = useQueryClient()
  const canEdit = canEditView('linen-inventory', effectiveUser)

  const [viewMode, setViewMode] = useState<ViewMode>('snapshot')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // Record Count form state
  const [recordPropertyId, setRecordPropertyId] = useState('')
  const [recordSets, setRecordSets] = useState('')
  const [recordNotes, setRecordNotes] = useState('')
  const [recordBy, setRecordBy] = useState(effectiveUser?.label || '')
  const [showDetailed, setShowDetailed] = useState(false)
  const [detailedFields, setDetailedFields] = useState<Record<string, string>>({})

  // History filter
  const [historyPropertyFilter, setHistoryPropertyFilter] = useState('')

  // ─── Queries ──────────────────────────────────────────────────────────────
  const { data: properties, isLoading: propsLoading } = useQuery({
    queryKey: ['/supabase/linen-inventory-properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, target_par_sets, king_beds, queen_beds, full_beds, twin_beds, bath_towels, washcloths, hand_towels, bathmats, pool_towels, pipeline_stages!properties_stage_id_fkey(name)')
        .not('pipeline_stages.name', 'in', '("Offboarded","Lead","Quote")')
        .order('name')
      if (error) throw error
      return data || []
    },
  })

  const { data: latestCounts, isLoading: countsLoading } = useQuery({
    queryKey: ['/supabase/linen-inventory-latest'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('linen_inventory_latest')
        .select('*')
      if (error) throw error
      return data || []
    },
  })

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['/supabase/linen-inventory-history'],
    enabled: viewMode === 'history',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('linen_inventory_counts')
        .select('*, properties!inner(name, target_par_sets)')
        .order('counted_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return data || []
    },
  })

  // ─── Derived data ─────────────────────────────────────────────────────────
  const countMap = useMemo(() => {
    const map: Record<string, any> = {}
    for (const c of (latestCounts || [])) {
      map[String(c.property_id)] = c
    }
    return map
  }, [latestCounts])

  const snapshotData = useMemo(() => {
    if (!properties) return []
    return properties.map((p: any) => {
      const latest = countMap[String(p.id)]
      const target = p.target_par_sets ?? 3
      const sets = latest?.clean_complete_sets ?? null
      return {
        ...p,
        target,
        latestSets: sets,
        variance: sets != null ? sets - target : null,
        status: getStatus(sets, target),
        countedAt: latest?.counted_at || null,
        countedBy: latest?.counted_by || null,
        stageName: (p.pipeline_stages as any)?.name || '',
      }
    })
  }, [properties, countMap])

  const filteredSnapshot = useMemo(() => {
    let result = snapshotData
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(p => p.name?.toLowerCase().includes(q))
    }
    if (statusFilter === 'below-par') result = result.filter(p => p.status === 'below-par')
    if (statusFilter === 'not-counted') result = result.filter(p => p.status === 'not-counted')
    return result
  }, [snapshotData, search, statusFilter])

  const pagedSnapshot = useMemo(() => filteredSnapshot.slice((page - 1) * pageSize, page * pageSize), [filteredSnapshot, page, pageSize])

  const filteredHistory = useMemo(() => {
    if (!historyData) return []
    if (!historyPropertyFilter) return historyData
    return historyData.filter((h: any) => String(h.property_id) === historyPropertyFilter)
  }, [historyData, historyPropertyFilter])

  // ─── Summary stats ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const belowPar = snapshotData.filter(p => p.status === 'below-par').length
    const notCounted = snapshotData.filter(p => p.status === 'not-counted').length
    const atOrAbove = snapshotData.filter(p => p.status === 'at-par' || p.status === 'above-par').length
    return { belowPar, notCounted, atOrAbove, total: snapshotData.length }
  }, [snapshotData])

  // ─── Record Count mutation ────────────────────────────────────────────────
  const { mutate: saveCount, isPending: saving } = useGuardedMutation('linen-inventory', {
    mutationFn: async () => {
      const insert: Record<string, any> = {
        property_id: parseInt(recordPropertyId),
        counted_at: new Date().toISOString(),
        counted_by: recordBy.trim() || null,
        clean_complete_sets: parseInt(recordSets) || 0,
        notes: recordNotes.trim() || null,
      }
      if (showDetailed) {
        for (const f of PIECE_FIELDS) {
          const v = detailedFields[f.key]
          if (v) insert[f.key] = parseInt(v) || null
        }
      }
      const { error } = await supabase.from('linen_inventory_counts').insert(insert)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/linen-inventory-latest'] })
      qc.invalidateQueries({ queryKey: ['/supabase/linen-inventory-history'] })
      toast({ title: 'Count saved' })
    },
    onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
  })

  function handleSaveAndAnother() {
    saveCount(undefined, {
      onSuccess: () => {
        setRecordSets('')
        setRecordNotes('')
        setDetailedFields({})
        // Keep property selected for quick re-count
      },
    })
  }

  function handleSaveAndHistory() {
    saveCount(undefined, {
      onSuccess: () => {
        setHistoryPropertyFilter(recordPropertyId)
        setViewMode('history')
        resetForm()
      },
    })
  }

  function resetForm() {
    setRecordPropertyId('')
    setRecordSets('')
    setRecordNotes('')
    setRecordBy(effectiveUser?.label || '')
    setShowDetailed(false)
    setDetailedFields({})
  }

  function openRecordForProperty(propertyId: string) {
    setRecordPropertyId(propertyId)
    setRecordSets('')
    setRecordNotes('')
    setRecordBy(effectiveUser?.label || '')
    setShowDetailed(false)
    setDetailedFields({})
    setViewMode('record')
  }

  function exportHistory() {
    if (!filteredHistory.length) return
    const rows = filteredHistory.map((h: any) => ({
      Property: (h.properties as any)?.name || '',
      'Counted At': format(new Date(h.counted_at), 'yyyy-MM-dd HH:mm'),
      'Counted By': h.counted_by || '',
      'Clean Sets': h.clean_complete_sets,
      Target: (h.properties as any)?.target_par_sets ?? 3,
      Variance: h.clean_complete_sets - ((h.properties as any)?.target_par_sets ?? 3),
      Notes: h.notes || '',
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `linen-inventory-${new Date().toISOString().split('T')[0]}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // ─── Selected property reference (for Record Count view) ──────────────────
  const selectedProperty = properties?.find((p: any) => String(p.id) === recordPropertyId)

  const isLoading = propsLoading || countsLoading

  const thCls = 'text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap'

  return (
    <div className="p-5 h-full flex flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Linen Inventory</h1>
          <p className="text-sm text-muted-foreground">
            {stats.belowPar > 0 && <span className="text-red-600 dark:text-red-400 font-medium">{stats.belowPar} below par</span>}
            {stats.belowPar > 0 && stats.notCounted > 0 && ' · '}
            {stats.notCounted > 0 && <span>{stats.notCounted} not counted</span>}
            {stats.belowPar === 0 && stats.notCounted === 0 && `${stats.atOrAbove} properties at or above par`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center border rounded-md overflow-hidden">
            {(['snapshot', 'record', 'history'] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === v ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
              >
                {v === 'snapshot' ? 'Current Snapshot' : v === 'record' ? 'Record Count' : 'Count History'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ SNAPSHOT VIEW ═══ */}
      {viewMode === 'snapshot' && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {(['all', 'below-par', 'not-counted'] as StatusFilter[]).map(f => (
              <button
                key={f}
                onClick={() => { setStatusFilter(f); setPage(1) }}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${statusFilter === f ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-muted-foreground hover:bg-muted'}`}
              >
                {f === 'all' ? `All (${stats.total})` : f === 'below-par' ? `Below Par (${stats.belowPar})` : `Not Counted (${stats.notCounted})`}
              </button>
            ))}
            <div className="relative ml-auto">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input type="search" placeholder="Search…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} className="pl-8 pr-7 h-8 w-full sm:w-56 text-sm" />
              {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
            </div>
          </div>

          <div className="overflow-auto flex-1 rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
                <tr>
                  <th className={`${thCls} sticky left-0 z-20 bg-muted/80`}>Property</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Target Par</th>
                  <th className={thCls}>Clean Sets</th>
                  <th className={thCls}>Variance</th>
                  <th className={thCls}>Last Counted</th>
                  <th className={thCls}>Counted By</th>
                  {canEdit && <th className={thCls}>Action</th>}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(8)].map((_, i) => <tr key={i} className="border-b border-border/50">{[...Array(canEdit ? 8 : 7)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}</tr>)
                ) : filteredSnapshot.length === 0 ? (
                  <tr><td colSpan={canEdit ? 8 : 7}><EmptyState icon={Boxes} title={statusFilter !== 'all' ? 'No properties match' : 'No properties'} description={statusFilter === 'below-par' ? 'All properties are at or above par.' : statusFilter === 'not-counted' ? 'All properties have been counted.' : 'No active properties found.'} /></td></tr>
                ) : pagedSnapshot.map(p => (
                  <tr key={p.id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${p.status === 'below-par' ? 'bg-red-50/30 dark:bg-red-900/5' : ''}`}>
                    <td className="py-2 px-3 font-medium text-xs sticky left-0 z-10 bg-background">{p.name}</td>
                    <td className="py-2 px-3"><StatusBadge status={p.status} /></td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.target}</td>
                    <td className="py-2 px-3 text-xs tabular-nums font-medium">{p.latestSets ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">
                      {p.variance != null ? (
                        <span className={p.variance < 0 ? 'text-red-600 dark:text-red-400 font-medium' : p.variance > 0 ? 'text-green-600 dark:text-green-400' : ''}>{p.variance > 0 ? '+' : ''}{p.variance}</span>
                      ) : '—'}
                    </td>
                    <td className="py-2 px-3"><StaleIndicator countedAt={p.countedAt} /></td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">{p.countedBy || '—'}</td>
                    {canEdit && (
                      <td className="py-2 px-3">
                        <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => openRecordForProperty(String(p.id))}>
                          <Plus className="w-3 h-3 mr-1" /> Count
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!isLoading && filteredSnapshot.length > 0 && (
            <TablePagination total={filteredSnapshot.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
          )}
        </>
      )}

      {/* ═══ RECORD COUNT VIEW ═══ */}
      {viewMode === 'record' && (
        <div className="flex-1 flex flex-col items-center justify-start pt-4">
          <div className="w-full max-w-lg space-y-4">
            {!canEdit ? (
              <div className="text-center py-8 text-muted-foreground">
                <Boxes className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-medium">View Only</p>
                <p className="text-xs">You don't have edit access to record counts.</p>
              </div>
            ) : (
              <>
                {/* Property selector */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Property</label>
                  <select
                    value={recordPropertyId}
                    onChange={e => setRecordPropertyId(e.target.value)}
                    className="w-full h-10 text-sm border border-input rounded-md px-3 bg-background"
                  >
                    <option value="">Select property…</option>
                    {(properties || []).map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {/* Requirements reference card */}
                {selectedProperty && (
                  <div className="rounded-md border border-border bg-muted/30 p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Requirements (one set)</p>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-xs">
                      {[
                        { label: 'King', val: selectedProperty.king_beds },
                        { label: 'Queen', val: selectedProperty.queen_beds },
                        { label: 'Full', val: selectedProperty.full_beds },
                        { label: 'Twin', val: selectedProperty.twin_beds },
                        { label: 'Bath Twl', val: selectedProperty.bath_towels },
                        { label: 'Wash', val: selectedProperty.washcloths },
                        { label: 'Hand Twl', val: selectedProperty.hand_towels },
                        { label: 'Bathmats', val: selectedProperty.bathmats },
                        { label: 'Pool Twl', val: selectedProperty.pool_towels },
                      ].map(f => (
                        <div key={f.label}>
                          <span className="text-muted-foreground block">{f.label}</span>
                          <span className="font-medium">{f.val ?? 0}</span>
                        </div>
                      ))}
                      <div>
                        <span className="text-muted-foreground block">Target Par</span>
                        <span className="font-medium">{selectedProperty.target_par_sets ?? 3}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Quick count */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Clean Complete Sets On Shelf</label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={recordSets}
                    onChange={e => setRecordSets(e.target.value)}
                    placeholder="0"
                    className="h-12 text-lg font-medium"
                  />
                </div>

                {/* Detailed toggle */}
                <button
                  onClick={() => setShowDetailed(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showDetailed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {showDetailed ? 'Hide' : 'Show'} detailed piece counts
                </button>

                {showDetailed && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {PIECE_FIELDS.map(f => (
                      <div key={f.key}>
                        <label className="text-xs text-muted-foreground block mb-1">{f.label}</label>
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={detailedFields[f.key] || ''}
                          onChange={e => setDetailedFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                          className="h-9"
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Counted By</label>
                    <Input value={recordBy} onChange={e => setRecordBy(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Notes</label>
                    <Input value={recordNotes} onChange={e => setRecordNotes(e.target.value)} placeholder="Optional…" className="h-9 text-sm" />
                  </div>
                </div>

                {/* Save buttons */}
                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1 h-11 text-sm gap-1.5"
                    disabled={!recordPropertyId || !recordSets || saving}
                    onClick={handleSaveAndAnother}
                  >
                    <Check className="w-4 h-4" />
                    {saving ? 'Saving…' : 'Save & Count Another'}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 text-sm"
                    disabled={!recordPropertyId || !recordSets || saving}
                    onClick={handleSaveAndHistory}
                  >
                    Save & View History
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══ HISTORY VIEW ═══ */}
      {viewMode === 'history' && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={historyPropertyFilter}
              onChange={e => setHistoryPropertyFilter(e.target.value)}
              className="h-8 text-xs border border-input rounded-md px-2 bg-background w-56"
            >
              <option value="">All Properties</option>
              {(properties || []).map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 ml-auto" onClick={exportHistory} disabled={!filteredHistory.length}>
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
          </div>

          <div className="overflow-auto flex-1 rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
                <tr>
                  <th className={thCls}>Date</th>
                  <th className={`${thCls} sticky left-0 z-20 bg-muted/80`}>Property</th>
                  <th className={thCls}>Counted By</th>
                  <th className={thCls}>Clean Sets</th>
                  <th className={thCls}>Target</th>
                  <th className={thCls}>Variance</th>
                  <th className={thCls}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading ? (
                  [...Array(8)].map((_, i) => <tr key={i} className="border-b border-border/50">{[...Array(7)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}</tr>)
                ) : filteredHistory.length === 0 ? (
                  <tr><td colSpan={7}><EmptyState icon={Boxes} title="No count history" description={historyPropertyFilter ? 'No counts recorded for this property yet.' : 'No inventory counts have been recorded yet. Use Record Count to start.'} /></td></tr>
                ) : filteredHistory.map((h: any) => {
                  const target = (h.properties as any)?.target_par_sets ?? 3
                  const variance = h.clean_complete_sets - target
                  return (
                    <tr key={h.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="py-2 px-3 text-xs text-muted-foreground">{format(new Date(h.counted_at), 'MMM d, yyyy h:mm a')}</td>
                      <td className="py-2 px-3 font-medium text-xs sticky left-0 z-10 bg-background">{(h.properties as any)?.name || '—'}</td>
                      <td className="py-2 px-3 text-xs">{h.counted_by || '—'}</td>
                      <td className="py-2 px-3 text-xs tabular-nums font-medium">{h.clean_complete_sets}</td>
                      <td className="py-2 px-3 text-xs tabular-nums">{target}</td>
                      <td className="py-2 px-3 text-xs tabular-nums">
                        <span className={variance < 0 ? 'text-red-600 dark:text-red-400 font-medium' : variance > 0 ? 'text-green-600 dark:text-green-400' : ''}>{variance > 0 ? '+' : ''}{variance}</span>
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground max-w-[200px] truncate">{h.notes || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
