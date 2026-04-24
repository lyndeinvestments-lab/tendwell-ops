import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { EmptyState } from '@/components/EmptyState'
import { TablePagination } from '@/components/TablePagination'
import { Search, ClipboardCheck, Download, X, Star, Camera, User, ExternalLink } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import Papa from 'papaparse'

type Inspection = {
  id: string
  property_id: number
  cleaner_id: string | null
  inspected_by: string | null
  inspected_at: string
  overall_score: number | null
  cleanliness_score: number | null
  linens_score: number | null
  supplies_score: number | null
  exterior_score: number | null
  notes: string | null
  photos_url: string[] | null
  properties?: { name: string } | null
  cleaners?: { full_name: string } | null
}

function scoreColorClass(score: number | null): string {
  if (score == null) return 'bg-muted text-muted-foreground'
  if (score >= 8) return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
  if (score >= 5) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
  return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
}

function ScorePill({ label, score }: { label: string; score: number | null }) {
  if (score == null) return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span className="text-[10px] uppercase tracking-wide">{label}</span>
      <span>—</span>
    </span>
  )
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${scoreColorClass(score)}`}>
      <span className="text-[10px] uppercase tracking-wide opacity-80">{label}</span>
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

  const [search, setSearch] = useState('')
  const [cleanerFilter, setCleanerFilter] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [minScore, setMinScore] = useState<string>('any')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [activeDetail, setActiveDetail] = useState<Inspection | null>(null)

  const { data: inspections, isLoading } = useQuery<Inspection[]>({
    queryKey: ['/supabase/inspections-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspections')
        .select('id, property_id, cleaner_id, inspected_by, inspected_at, overall_score, cleanliness_score, linens_score, supplies_score, exterior_score, notes, photos_url, properties(name), cleaners(full_name)')
        .order('inspected_at', { ascending: false })
        .limit(2000)
      if (error) throw error
      return (data || []) as unknown as Inspection[]
    },
  })

  const { data: cleaners } = useQuery({
    queryKey: ['/supabase/cleaners-lite'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cleaners').select('id, full_name').order('full_name')
      if (error) throw error
      return data || []
    },
  })

  const filtered = useMemo(() => {
    if (!inspections) return []
    const q = search.trim().toLowerCase()
    const min = minScore === 'any' ? null : Number(minScore)
    return inspections.filter(i => {
      if (q) {
        const propName = i.properties?.name?.toLowerCase() ?? ''
        const cleanerName = i.cleaners?.full_name?.toLowerCase() ?? ''
        const notes = (i.notes ?? '').toLowerCase()
        if (!propName.includes(q) && !cleanerName.includes(q) && !notes.includes(q)) return false
      }
      if (cleanerFilter !== 'all') {
        if (cleanerFilter === 'unassigned' && i.cleaner_id) return false
        if (cleanerFilter !== 'unassigned' && i.cleaner_id !== cleanerFilter) return false
      }
      if (dateFrom && i.inspected_at < dateFrom) return false
      if (dateTo && i.inspected_at > dateTo + 'T23:59:59') return false
      if (min != null && (i.overall_score ?? 0) < min) return false
      return true
    })
  }, [inspections, search, cleanerFilter, dateFrom, dateTo, minScore])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  const avgScore = useMemo(() => {
    if (!filtered.length) return null
    const scores = filtered.map(i => i.overall_score).filter((s): s is number => s != null)
    if (!scores.length) return null
    return scores.reduce((a, b) => a + b, 0) / scores.length
  }, [filtered])

  function exportCsv() {
    const rows = filtered.map(i => ({
      'Property': i.properties?.name ?? '',
      'Cleaner': i.cleaners?.full_name ?? '',
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
  }

  return (
    <div className="p-5 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Inspections</h1>
          <p className="text-sm text-muted-foreground">
            Cleaning-quality scores logged after each clean. Scores 1–10.
            {avgScore != null && (
              <span className="ml-2">
                <span className="text-muted-foreground">· Avg overall:</span>{' '}
                <span className={`font-medium px-1.5 py-0.5 rounded ${scoreColorClass(Math.round(avgScore))}`}>
                  {avgScore.toFixed(1)}
                </span>
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0} className="h-8 text-xs gap-1.5">
            <Download className="w-3.5 h-3.5" />
            Export CSV
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
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <label className="text-muted-foreground">Cleaner</label>
        <Select value={cleanerFilter} onValueChange={v => { setCleanerFilter(v); setPage(1) }}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All cleaners</SelectItem>
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
            {[5, 6, 7, 8, 9].map(n => <SelectItem key={n} value={String(n)} className="text-xs">{n}+</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="text-muted-foreground ml-2">From</label>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }} className="h-8 text-xs border border-input rounded px-2 bg-background" />
        <label className="text-muted-foreground">To</label>
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }} className="h-8 text-xs border border-input rounded px-2 bg-background" />
        <span className="text-muted-foreground ml-auto">{filtered.length} record{filtered.length === 1 ? '' : 's'}</span>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
            <tr>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[180px]">Property</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Cleaner</th>
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
                  {[...Array(7)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    icon={ClipboardCheck}
                    title="No inspections"
                    description={
                      inspections?.length
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
                  onClick={() => setActiveDetail(i)}
                >
                  <td className="py-2 px-3 font-medium text-xs">
                    {i.properties?.name ?? <span className="text-muted-foreground">Deleted property</span>}
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">
                    {i.cleaners?.full_name ?? (i.inspected_by ? <span>{i.inspected_by}</span> : '—')}
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                    {i.inspected_at ? format(parseISO(i.inspected_at), 'MMM d, yyyy h:mm a') : '—'}
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

      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      {/* Detail drawer */}
      <Sheet open={!!activeDetail} onOpenChange={v => !v && setActiveDetail(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">
              {activeDetail?.properties?.name ?? 'Inspection'}
            </SheetTitle>
          </SheetHeader>
          {activeDetail && (
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><User className="w-3 h-3" />{activeDetail.cleaners?.full_name ?? activeDetail.inspected_by ?? 'Unknown'}</span>
                <span>·</span>
                <span>{activeDetail.inspected_at ? format(parseISO(activeDetail.inspected_at), 'PPP p') : '—'}</span>
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
                        <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-2">
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
                  <span className="text-xs text-muted-foreground self-center">
                    Log a new inspection from the property modal → Inspections tab.
                  </span>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
