import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { thumbUrl } from '@/lib/image'
import { useAuth, canEditView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { useCleaners } from '@/hooks/use-cleaners'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { TablePagination } from '@/components/TablePagination'
import { Search, ClipboardCheck, Download, X, Star, Camera, User, ExternalLink, Plus, Trash2, CalendarDays, AlertTriangle, MapPin } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import Papa from 'papaparse'
import { InspectionFormSheet, type ExistingInspection } from '@/components/InspectionFormSheet'
import { InspectionPriorityDashboard } from '@/components/InspectionPriorityDashboard'
import { MapPickerDialog } from '@/components/MapPickerDialog'
import { MyInspectionsTab } from '@/components/MyInspectionsTab'
import { useMyInspector } from '@/hooks/use-my-inspector'
import { INSPECTION_SELECT, scoreColorClass, type Inspection, type InspectionStatus, type ReinspectUrgency } from '@/lib/inspections'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

type InspectionFilters = {
  search: string
  inspectorFilter: string
  statusFilter: 'all' | InspectionStatus
  dateFrom: string
  dateTo: string
  minScore: string
}

// The free-text search used to match property name, cleaner name, and notes
// client-side. Property/cleaner names live on joined tables, which PostgREST
// can't OR against parent columns — so we resolve matching ids first, then
// fold them into a single .or() clause alongside the top-level ilike filters.
async function buildSearchOrClause(search: string): Promise<string | null> {
  // Strip characters that are significant in PostgREST or()/ilike syntax.
  const term = search.trim().replace(/[%_,()."\\]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!term) return null
  const [propRes, cleanerRes] = await Promise.all([
    supabase.from('properties').select('id').ilike('name', `%${term}%`).limit(200),
    supabase.from('cleaners').select('id').ilike('full_name', `%${term}%`).limit(200),
  ])
  const parts = [`notes.ilike.%${term}%`, `cleaner_name.ilike.%${term}%`]
  const propIds = (propRes.data ?? []).map(p => p.id)
  if (propIds.length) parts.push(`property_id.in.(${propIds.join(',')})`)
  const cleanerIds = (cleanerRes.data ?? []).map(c => c.id)
  if (cleanerIds.length) parts.push(`cleaner_id.in.(${cleanerIds.join(',')})`)
  return parts.join(',')
}

// Applies the shared filter set to any inspections query builder (page query,
// average-score query, and CSV export all use the same predicate).
function applyInspectionFilters(query: any, f: InspectionFilters, orClause: string | null): any {
  let q = query
  if (orClause) q = q.or(orClause)
  if (f.statusFilter !== 'all') q = q.eq('status', f.statusFilter)
  if (f.inspectorFilter === 'unassigned') q = q.is('inspector_id', null)
  else if (f.inspectorFilter !== 'all') q = q.eq('inspector_id', f.inspectorFilter)
  if (f.dateFrom) q = q.gte('inspected_at', f.dateFrom)
  if (f.dateTo) q = q.lte('inspected_at', f.dateTo + 'T23:59:59')
  if (f.minScore !== 'any') q = q.gte('overall_score', Number(f.minScore))
  return q
}

// Text-only tone for the avg-score summary tile value.
function scoreTextClass(score: number | null): string {
  if (score == null) return ''
  if (score >= 4) return 'text-success'
  if (score >= 3) return 'text-warning'
  return 'text-destructive'
}

const URGENCY_BADGE: Record<ReinspectUrgency, { label: string; cls: string }> = {
  none:     { label: '',         cls: '' },
  low:      { label: 'Low',      cls: 'bg-success/15 text-success' },
  medium:   { label: 'Medium',   cls: 'bg-warning/15 text-warning' },
  high:     { label: 'High',     cls: 'bg-warning/20 text-warning' },
  critical: { label: 'Critical', cls: 'bg-destructive/15 text-destructive' },
}

function StatusPill({ status }: { status: InspectionStatus }) {
  const map: Record<InspectionStatus, string> = {
    scheduled: 'bg-info/15 text-info',
    completed: 'bg-success/15 text-success',
    skipped:   'bg-muted text-muted-foreground',
  }
  return <span className={`inline-block text-2xs uppercase tracking-wide px-1.5 py-0.5 rounded font-medium ${map[status]}`}>{status}</span>
}

function ScorePill({ label, score }: { label: string; score: number | null }) {
  if (score == null) return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span className="text-2xs uppercase tracking-wide">{label}</span>
      <span>—</span>
    </span>
  )
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${scoreColorClass(score)}`}>
      <span className="text-2xs uppercase tracking-wide opacity-80">{label}</span>
      <span className="font-semibold tabular-nums">{score}</span>
    </span>
  )
}

export default function InspectionsPage() {
  usePageTitle('Inspections')
  const { toast } = useToast()
  const { effectiveUser } = useAuth()
  const { openPropertyModal } = usePropertyModal()
  const canEdit = canEditView('inspections', effectiveUser)
  const { myInspector, isLoading: myInspectorLoading } = useMyInspector()

  // Controlled tabs so inspectors land on their own queue once their identity
  // resolves; anyone can still switch tabs manually afterwards.
  const [tabChoice, setTabChoice] = useState<string | null>(null)
  const activeTab = tabChoice ?? (myInspector ? 'mine' : 'priority')

  const [search, setSearch] = useState('')
  const [inspectorFilter, setInspectorFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | InspectionStatus>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [minScore, setMinScore] = useState<string>('any')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [activeDetail, setActiveDetail] = useState<Inspection | null>(null)
  const [mapAddress, setMapAddress] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ExistingInspection | null>(null)
  const queryClient = useQueryClient()

  const deleteMut = useMutation({
    mutationFn: async (inspectionId: string) => {
      // Delete any associated storage objects (best effort).
      const { data: files } = await supabase.storage.from('inspections').list(inspectionId)
      if (files && files.length > 0) {
        await supabase.storage
          .from('inspections')
          .remove(files.map(f => `${inspectionId}/${f.name}`))
      }
      const { error } = await supabase.from('inspections').delete().eq('id', inspectionId)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Inspection deleted' })
      queryClient.invalidateQueries({ queryKey: ['/supabase/inspections-all'] })
      // Matches InspectionFormSheet — the dashboard's 90-day aggregate is
      // a separate cache entry, so it needs its own invalidation when a
      // row disappears.
      queryClient.invalidateQueries({ queryKey: ['/supabase/dashboard-inspections'] })
      setActiveDetail(null)
      setEditing(null)
      setFormOpen(false)
    },
    onError: (e: Error) => {
      toast({ title: 'Could not delete', description: e.message, variant: 'destructive' })
    },
  })

  function confirmDelete(id: string, label: string) {
    if (!canEdit) return
    if (confirm(`Delete inspection for ${label}? This also removes any photos. This cannot be undone.`)) {
      deleteMut.mutate(id)
    }
  }

  function handleRowClick(i: Inspection) {
    if (i.status === 'scheduled') {
      // Open the form sheet in edit mode so the inspector can fill it out and complete it.
      setEditing({
        id: i.id,
        property_id: i.property_id,
        cleaner_id: i.cleaner_id,
        inspector_id: i.inspector_id,
        status: i.status,
        scheduled_for: i.scheduled_for,
        inspected_at: i.inspected_at,
        last_cleaned_on: i.last_cleaned_on,
        notes: i.notes,
        photos_url: i.photos_url,
        reinspect_urgency: i.reinspect_urgency,
        reinspect_by: i.reinspect_by,
        overall_score: i.overall_score,
        cleanliness_score: i.cleanliness_score,
        linens_score: i.linens_score,
        supplies_score: i.supplies_score,
        exterior_score: i.exterior_score,
      })
      setFormOpen(true)
    } else {
      setActiveDetail(i)
    }
  }

  // Debounce free-text search so each keystroke doesn't fire a server query.
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const filters: InspectionFilters = {
    search: debouncedSearch,
    inspectorFilter,
    statusFilter,
    dateFrom,
    dateTo,
    minScore,
  }

  // Server-side pagination: filters are pushed into the Supabase query and
  // only the current page is fetched, with { count: 'exact' } for the total.
  // The '/supabase/inspections-all' key prefix is kept so existing fuzzy
  // invalidations (delete here, InspectionFormSheet saves) still refresh us.
  const { data: pageData, isLoading, isError, refetch } = useQuery({
    queryKey: ['/supabase/inspections-all', { page, pageSize, ...filters }],
    queryFn: async () => {
      const orClause = await buildSearchOrClause(filters.search)
      let q = supabase.from('inspections').select(INSPECTION_SELECT, { count: 'exact' })
      q = applyInspectionFilters(q, filters, orClause)
      const from = (page - 1) * pageSize
      const { data, error, count } = await q
        .order('inspected_at', { ascending: false })
        .range(from, from + pageSize - 1)
      if (error) throw error
      return { rows: (data || []) as unknown as Inspection[], total: count ?? 0 }
    },
    placeholderData: keepPreviousData,
  })

  const inspections = pageData?.rows
  const totalCount = pageData?.total ?? 0
  const paged = inspections ?? []
  const hasActiveFilters = !!(debouncedSearch || inspectorFilter !== 'all' || statusFilter !== 'all' || dateFrom || dateTo || minScore !== 'any')

  // Average overall score across ALL matching rows (not just the current
  // page) — fetched as a single lightweight column with the same filters.
  const { data: avgScore } = useQuery({
    queryKey: ['/supabase/inspections-all', 'avg-score', filters],
    queryFn: async () => {
      const orClause = await buildSearchOrClause(filters.search)
      let q = supabase.from('inspections').select('overall_score').not('overall_score', 'is', null)
      q = applyInspectionFilters(q, filters, orClause)
      const { data, error } = await q.limit(5000)
      if (error) throw error
      const scores = (data ?? []).map((r: { overall_score: number | null }) => r.overall_score).filter((s): s is number => s != null)
      if (!scores.length) return null
      return scores.reduce((a, b) => a + b, 0) / scores.length
    },
  })

  // Summary tile: re-inspections needing attention (high/critical urgency),
  // respecting the active filters. Head-only count, no rows fetched.
  const { data: needsReinspect } = useQuery({
    queryKey: ['/supabase/inspections-all', 'needs-reinspect', filters],
    queryFn: async () => {
      const orClause = await buildSearchOrClause(filters.search)
      let q = supabase.from('inspections').select('id', { count: 'exact', head: true }).in('reinspect_urgency', ['high', 'critical'])
      q = applyInspectionFilters(q, filters, orClause)
      const { count, error } = await q
      if (error) throw error
      return count ?? 0
    },
  })

  // Summary tile: completed inspections in the last 7 days — a fixed
  // recent-activity pulse, independent of the table filters.
  const { data: last7dCount } = useQuery({
    queryKey: ['/supabase/inspections-all', 'last-7d'],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const { count, error } = await supabase
        .from('inspections')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed')
        .gte('inspected_at', since)
      if (error) throw error
      return count ?? 0
    },
  })

  const { data: cleaners } = useCleaners()

  const [exporting, setExporting] = useState(false)

  // Export fetches ALL matching rows on demand (chunked), independent of the
  // current page, so the CSV matches the full filtered result set.
  async function exportCsv() {
    if (exporting) return
    setExporting(true)
    try {
      const orClause = await buildSearchOrClause(filters.search)
      const all: Inspection[] = []
      const CHUNK = 1000
      const MAX_ROWS = 20000
      for (let from = 0; from < MAX_ROWS; from += CHUNK) {
        let q = supabase.from('inspections').select(INSPECTION_SELECT)
        q = applyInspectionFilters(q, filters, orClause)
        const { data, error } = await q
          .order('inspected_at', { ascending: false })
          .range(from, from + CHUNK - 1)
        if (error) throw error
        const chunkRows = (data || []) as unknown as Inspection[]
        all.push(...chunkRows)
        if (chunkRows.length < CHUNK) break
      }
      const rows = all.map(i => ({
        'Property': i.properties?.name ?? '',
        'Cleaner': i.cleaners?.full_name ?? i.cleaner_name ?? '',
        'Inspector': i.inspectors?.full_name ?? '',
        'Inspected At': i.inspected_at ? format(parseISO(i.inspected_at), 'yyyy-MM-dd HH:mm') : '',
        'Overall': i.overall_score ?? '',
        'Cleanliness': i.cleanliness_score ?? '',
        'Linens': i.linens_score ?? '',
        'Supplies': i.supplies_score ?? '',
        'Exterior': i.exterior_score ?? '',
        'Notes': i.notes ?? '',
        'Photos': (i.photos_url ?? []).length,
      }))
      const csv = Papa.unparse(rows)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `inspections-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: 'CSV exported', description: `${rows.length} rows` })
    } catch (e: any) {
      toast({ title: 'Export failed', description: e?.message, variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col overflow-x-hidden">
      <PageHeader
        title="Inspections"
        subtitle="Cleaning-quality scores logged after each clean · scores 1–5"
        actions={
          <>
            {canEdit && (
              <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true) }} className="h-8 text-xs gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                New Inspection
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={totalCount === 0 || exporting} className="h-8 text-xs gap-1.5">
              <Download className="w-3.5 h-3.5" />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </Button>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search property / cleaner / notes…"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
                className="pl-8 pr-7 h-8 w-64 text-sm"
              />
              {search && (
                <button onClick={() => { setSearch(''); setPage(1) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </>
        }
      />

      <Tabs value={activeTab} onValueChange={setTabChoice} className="flex-1 flex flex-col min-h-0">
        <TabsList className="self-start">
          {(myInspector || myInspectorLoading) && (
            <TabsTrigger value="mine" data-testid="tab-mine" disabled={!myInspector}>My Inspections</TabsTrigger>
          )}
          <TabsTrigger value="priority" data-testid="tab-priority">Priority Dashboard</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
        </TabsList>
        {myInspector && (
          <TabsContent value="mine" className="flex-1 min-h-0 mt-3 data-[state=active]:flex data-[state=active]:flex-col">
            <MyInspectionsTab inspectorId={myInspector.id} onOpen={handleRowClick} />
          </TabsContent>
        )}
        <TabsContent value="priority" className="flex-1 min-h-0 mt-3 data-[state=active]:flex data-[state=active]:flex-col">
          <InspectionPriorityDashboard />
        </TabsContent>
        <TabsContent value="history" className="flex-1 min-h-0 mt-3 space-y-4 data-[state=active]:flex data-[state=active]:flex-col">
      {/* Summary strip — at-a-glance quality stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm p-4">
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><ClipboardCheck className="w-3.5 h-3.5" /> Total Inspections</div>
          <p className="mt-1 text-3xl font-bold tabular-nums leading-none">{totalCount}</p>
        </div>
        <div className="rounded-2xl border border-card-border bg-card shadow-sm p-4">
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><Star className="w-3.5 h-3.5" /> Avg Overall Score</div>
          <p className={`mt-1 text-3xl font-bold tabular-nums leading-none ${scoreTextClass(avgScore ?? null)}`}>{avgScore == null ? '—' : avgScore.toFixed(2)}</p>
        </div>
        <div className="rounded-2xl border border-card-border bg-card shadow-sm p-4">
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><CalendarDays className="w-3.5 h-3.5" /> Inspected (7d)</div>
          <p className="mt-1 text-3xl font-bold tabular-nums leading-none text-info">{last7dCount ?? '—'}</p>
        </div>
        <div className={`rounded-2xl border shadow-sm p-4 ${(needsReinspect ?? 0) > 0 ? 'border-warning/30 bg-warning/5' : 'border-card-border bg-card'}`}>
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><AlertTriangle className="w-3.5 h-3.5" /> Needs Re-inspection</div>
          <p className={`mt-1 text-3xl font-bold tabular-nums leading-none ${(needsReinspect ?? 0) > 0 ? 'text-warning' : ''}`}>{needsReinspect ?? '—'}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <label className="text-muted-foreground">Status</label>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v as 'all' | InspectionStatus); setPage(1) }}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All</SelectItem>
            <SelectItem value="scheduled" className="text-xs">Scheduled</SelectItem>
            <SelectItem value="completed" className="text-xs">Completed</SelectItem>
            <SelectItem value="skipped" className="text-xs">Skipped</SelectItem>
          </SelectContent>
        </Select>
        <label className="text-muted-foreground ml-2">Inspector</label>
        <Select value={inspectorFilter} onValueChange={v => { setInspectorFilter(v); setPage(1) }}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All inspectors</SelectItem>
            <SelectItem value="unassigned" className="text-xs">Unassigned</SelectItem>
            {(cleaners || []).map(c => (
              <SelectItem key={c.id} value={c.id} className="text-xs">{c.full_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="text-muted-foreground ml-2">Min overall</label>
        <Select value={minScore} onValueChange={v => { setMinScore(v); setPage(1) }}>
          <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any" className="text-xs">Any</SelectItem>
            {[1, 2, 3, 4, 5].map(n => <SelectItem key={n} value={String(n)} className="text-xs">{n}+</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="text-muted-foreground ml-2">From</label>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }} className="h-8 text-xs border border-input rounded px-2 bg-background" />
        <label className="text-muted-foreground">To</label>
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }} className="h-8 text-xs border border-input rounded px-2 bg-background" />
        <span className="text-muted-foreground ml-auto">{totalCount} record{totalCount === 1 ? '' : 's'}</span>
      </div>

      {isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <>
          {/* Mobile: cards (no horizontal scroll) */}
          <div className="md:hidden flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
            {isLoading ? (
              [...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)
            ) : paged.length === 0 ? (
              <EmptyState
                icon={ClipboardCheck}
                title="No inspections"
                description={
                  hasActiveFilters
                    ? 'No records match the current filters.'
                    : 'Tap + New Inspection to log or schedule one.'
                }
              />
            ) : (
              paged.map(i => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => handleRowClick(i)}
                  className="w-full text-left rounded-2xl border border-border bg-background p-3 shadow-sm active:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <StatusPill status={i.status} />
                        {i.reinspect_urgency !== 'none' && (
                          <span className={`text-2xs uppercase tracking-wide px-1.5 py-0.5 rounded font-medium ${URGENCY_BADGE[i.reinspect_urgency].cls}`}>
                            {URGENCY_BADGE[i.reinspect_urgency].label}
                          </span>
                        )}
                      </div>
                      <div className="font-medium text-sm truncate">
                        {i.properties?.name ?? <span className="text-muted-foreground">Deleted property</span>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {(i.cleaners?.full_name ?? i.cleaner_name ?? <span className="italic text-muted-foreground/70">Cleaner not recorded</span>)}
                        {' · '}
                        {i.status === 'scheduled' && i.scheduled_for
                          ? `→ ${format(parseISO(i.scheduled_for), 'MMM d')}`
                          : i.inspected_at
                            ? format(parseISO(i.inspected_at), 'MMM d, yyyy')
                            : '—'}
                      </div>
                    </div>
                    {i.overall_score != null && (
                      <span className={`shrink-0 inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded font-semibold tabular-nums ${scoreColorClass(i.overall_score)}`}>
                        <Star className="w-3 h-3 fill-current" /> {i.overall_score}
                      </span>
                    )}
                  </div>
                  {(i.cleanliness_score != null || i.linens_score != null || i.supplies_score != null || i.exterior_score != null) && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      <ScorePill label="Clean" score={i.cleanliness_score} />
                      <ScorePill label="Linen" score={i.linens_score} />
                      <ScorePill label="Supp" score={i.supplies_score} />
                      <ScorePill label="Ext" score={i.exterior_score} />
                    </div>
                  )}
                  {((i.photos_url?.length ?? 0) > 0 || i.notes) && (
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      {(i.photos_url?.length ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 shrink-0">
                          <Camera className="w-3 h-3" />
                          {i.photos_url!.length}
                        </span>
                      )}
                      {i.notes && <span className="truncate flex-1 min-w-0">{i.notes}</span>}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Desktop: full table */}
          <div className="hidden md:block overflow-auto flex-1 rounded-2xl border border-border shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[180px]">Property</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Cleaner</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Inspector</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Inspected</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Overall</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Sub-scores</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 w-8"></th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 max-w-[220px]">Notes</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {[...Array(8)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}
                    </tr>
                  ))
                ) : paged.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState
                        icon={ClipboardCheck}
                        title="No inspections"
                        description={
                          hasActiveFilters
                            ? 'No records match the current filters. Clear filters or widen the date range.'
                            : 'Log an inspection from a property modal → Inspections tab. Records appear here.'
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  paged.map(i => (
                    <tr
                      key={i.id}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => handleRowClick(i)}
                    >
                      <td className="py-2 px-3 font-medium text-xs">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{i.properties?.name ?? <span className="text-muted-foreground">Deleted property</span>}</span>
                          <StatusPill status={i.status} />
                          {i.reinspect_urgency !== 'none' && (
                            <span className={`text-2xs uppercase tracking-wide px-1.5 py-0.5 rounded font-medium ${URGENCY_BADGE[i.reinspect_urgency].cls}`}>
                              {URGENCY_BADGE[i.reinspect_urgency].label}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">
                        {i.cleaners?.full_name ?? i.cleaner_name ?? <span className="italic">Cleaner not recorded</span>}
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">
                        {i.inspectors?.full_name ?? '—'}
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                        {i.status === 'scheduled' && i.scheduled_for
                          ? `→ ${format(parseISO(i.scheduled_for), 'MMM d, yyyy')}`
                          : i.inspected_at
                            ? format(parseISO(i.inspected_at), 'MMM d, yyyy')
                            : '—'}
                      </td>
                      <td className="py-2 px-3">
                        {i.overall_score != null ? (
                          <span className={`inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded font-semibold tabular-nums ${scoreColorClass(i.overall_score)}`}>
                            <Star className="w-3 h-3" /> {i.overall_score}
                          </span>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex flex-wrap gap-1">
                          <ScorePill label="Clean" score={i.cleanliness_score} />
                          <ScorePill label="Linen" score={i.linens_score} />
                          <ScorePill label="Supp" score={i.supplies_score} />
                          <ScorePill label="Ext" score={i.exterior_score} />
                        </div>
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">
                        {i.photos_url && i.photos_url.length > 0 && (
                          <span className="inline-flex items-center gap-0.5"><Camera className="w-3 h-3" />{i.photos_url.length}</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground max-w-[220px] truncate" title={i.notes ?? ''}>
                        {i.notes || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!isLoading && totalCount > 0 && (
            <TablePagination total={totalCount} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
          )}
        </>
      )}
        </TabsContent>
      </Tabs>

      {/* Detail drawer */}
      <Sheet open={!!activeDetail} onOpenChange={v => !v && setActiveDetail(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">
              {activeDetail?.properties?.name ?? 'Inspection'}
            </SheetTitle>
            {activeDetail?.properties?.address && (
              <button
                type="button"
                onClick={() => setMapAddress(activeDetail.properties!.address!)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground w-fit mt-0.5 group"
              >
                <MapPin className="w-3 h-3 shrink-0 text-primary group-hover:text-foreground" />
                <span className="truncate underline-offset-2 group-hover:underline">{activeDetail.properties.address}</span>
              </button>
            )}
          </SheetHeader>
          {activeDetail && (
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusPill status={activeDetail.status} />
                {activeDetail.reinspect_urgency !== 'none' && (
                  <span className={`text-2xs uppercase tracking-wide px-1.5 py-0.5 rounded font-medium ${URGENCY_BADGE[activeDetail.reinspect_urgency].cls}`}>
                    Re-inspect: {URGENCY_BADGE[activeDetail.reinspect_urgency].label}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><User className="w-3 h-3" />Cleaner: {activeDetail.cleaners?.full_name ?? activeDetail.cleaner_name ?? <span className="italic">Cleaner not recorded</span>}</span>
                <span>·</span>
                <span className="flex items-center gap-1"><User className="w-3 h-3" />Inspector: {activeDetail.inspectors?.full_name ?? '—'}</span>
                <span>·</span>
                {activeDetail.status === 'scheduled' && activeDetail.scheduled_for ? (
                  <span>Scheduled for {format(parseISO(activeDetail.scheduled_for), 'PPP')}</span>
                ) : (
                  <span>{activeDetail.inspected_at ? format(parseISO(activeDetail.inspected_at), 'PPP') : '—'}</span>
                )}
                {activeDetail.reinspect_by && (
                  <>
                    <span>·</span>
                    <span>Re-inspect by {format(parseISO(activeDetail.reinspect_by), 'PPP')}</span>
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['Overall', activeDetail.overall_score],
                  ['Cleanliness', activeDetail.cleanliness_score],
                  ['Linens', activeDetail.linens_score],
                  ['Supplies', activeDetail.supplies_score],
                  ['Exterior', activeDetail.exterior_score],
                ] as const).map(([label, score]) => (
                  <div key={label} className="rounded border border-border px-3 py-2 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className={`text-sm font-semibold px-2 py-0.5 rounded tabular-nums ${scoreColorClass(score)}`}>
                      {score ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
              {activeDetail.notes && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Notes</h4>
                  <p className="text-sm whitespace-pre-wrap">{activeDetail.notes}</p>
                </div>
              )}
              {activeDetail.photos_url && activeDetail.photos_url.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                    <Camera className="w-3 h-3" /> Photos
                  </h4>
                  <div className="grid grid-cols-3 gap-2">
                    {activeDetail.photos_url.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block aspect-square rounded overflow-hidden border border-border hover:border-primary">
                        <img src={thumbUrl(url, { width: 300 })} alt={`Photo ${i + 1}`} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    if (activeDetail.property_id) openPropertyModal(String(activeDetail.property_id), 'inspections')
                    setActiveDetail(null)
                  }}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open property
                </Button>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive ml-auto"
                    onClick={() => confirmDelete(activeDetail.id, activeDetail.properties?.name ?? 'this inspection')}
                    disabled={deleteMut.isPending}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <InspectionFormSheet
        open={formOpen}
        onOpenChange={(v) => {
          setFormOpen(v)
          if (!v) setEditing(null)
        }}
        existing={editing}
        defaultInspectorId={myInspector?.id ?? null}
        onDelete={canEdit ? (insp) => {
          const label = (inspections ?? []).find(i => i.id === insp.id)?.properties?.name ?? 'this inspection'
          confirmDelete(insp.id, label)
        } : undefined}
      />
      <MapPickerDialog
        open={!!mapAddress}
        onOpenChange={v => !v && setMapAddress(null)}
        address={mapAddress ?? ''}
      />
    </PageContainer>
  )
}
