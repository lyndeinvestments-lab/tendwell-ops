import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { EmptyState } from '@/components/EmptyState'
import { TablePagination } from '@/components/TablePagination'
import { ArrowUpDown, Search, X, ClipboardCheck, Plus } from 'lucide-react'
import { format } from 'date-fns'

type SortKey = 'property' | 'date' | 'overall' | 'inspector'

const SCORE_SECTIONS = [
  { key: 'cleanliness_score', label: 'Cleanliness' },
  { key: 'linens_score', label: 'Linens' },
  { key: 'supplies_score', label: 'Supplies' },
  { key: 'exterior_score', label: 'Exterior' },
] as const

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground">—</span>
  const cls = score >= 8 ? 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800' :
              score >= 6 ? 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-800' :
              'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800'
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${cls}`}>{score}/10</span>
}

function ScoreInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <ScoreBadge score={value || null} />
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-primary h-2"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>1</span><span>5</span><span>10</span>
      </div>
    </div>
  )
}

const defaultForm = () => ({
  property_id: '',
  inspected_at: new Date().toISOString().split('T')[0],
  inspected_by: '',
  cleanliness_score: 8,
  linens_score: 8,
  supplies_score: 8,
  exterior_score: 8,
  notes: '',
})

export default function InspectionsPage() {
  usePageTitle('Inspections')
  const { openPropertyModal } = usePropertyModal()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [logOpen, setLogOpen] = useState(false)
  const [detailInspection, setDetailInspection] = useState<any>(null)
  const [form, setForm] = useState(defaultForm())

  const overall = useMemo(() => {
    const scores = [form.cleanliness_score, form.linens_score, form.supplies_score, form.exterior_score]
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  }, [form.cleanliness_score, form.linens_score, form.supplies_score, form.exterior_score])

  const { data: inspections, isLoading } = useQuery({
    queryKey: ['/supabase/inspections-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspections')
        .select('*, properties!inspections_property_id_fkey(id, name)')
        .order('inspected_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: activeProps } = useQuery({
    queryKey: ['/supabase/inspection-active-props'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, pipeline_stages!properties_stage_id_fkey(name)')
      if (error) throw error
      return (data || []).filter((p: any) => {
        const sn = (p.pipeline_stages as any)?.name
        return sn === 'Active' || sn === 'Onboarding'
      }).sort((a: any, b: any) => a.name.localeCompare(b.name))
    },
    enabled: logOpen,
  })

  const { mutate: logInspection, isPending: logging } = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('inspections').insert({
        property_id: Number(form.property_id),
        inspected_at: new Date(form.inspected_at).toISOString(),
        inspected_by: form.inspected_by.trim() || 'ops-user',
        cleanliness_score: form.cleanliness_score,
        linens_score: form.linens_score,
        supplies_score: form.supplies_score,
        exterior_score: form.exterior_score,
        overall_score: overall,
        notes: form.notes.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/inspections-all'] })
      toast({ title: 'Inspection logged' })
      setLogOpen(false)
      setForm(defaultForm())
    },
    onError: (e: any) => toast({ title: 'Failed: ' + (e.message || 'Error'), variant: 'destructive' }),
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'date' ? 'desc' : 'asc') }
  }

  const filtered = useMemo(() => {
    if (!inspections) return []
    let arr = inspections
    if (search.trim()) {
      const q = search.toLowerCase()
      arr = arr.filter((i: any) => (i.properties as any)?.name?.toLowerCase().includes(q) || i.inspected_by?.toLowerCase().includes(q))
    }
    arr = [...arr].sort((a: any, b: any) => {
      let av: any, bv: any
      if (sortKey === 'property') { av = (a.properties as any)?.name || ''; bv = (b.properties as any)?.name || '' }
      else if (sortKey === 'date') { av = a.inspected_at || ''; bv = b.inspected_at || '' }
      else if (sortKey === 'overall') { av = a.overall_score || 0; bv = b.overall_score || 0 }
      else { av = a.inspected_by || ''; bv = b.inspected_by || '' }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [inspections, search, sortKey, sortDir])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  const thCls = 'text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap'

  function SortIcon({ col }: { col: SortKey }) {
    return <ArrowUpDown className={`w-3 h-3 inline ml-1 ${sortKey === col ? 'text-primary' : 'text-muted-foreground/40'}`} />
  }

  return (
    <div className="p-5 h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Inspections</h1>
          <p className="text-sm text-muted-foreground">Quality scores across all properties</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              className="pl-8 pr-8 h-8 w-56 text-sm"
            />
            {search && (
              <button onClick={() => { setSearch(''); setPage(1) }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setLogOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Log Inspection
          </Button>
        </div>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th className={thCls} onClick={() => toggleSort('property')}>Property <SortIcon col="property" /></th>
              <th className={thCls} onClick={() => toggleSort('date')}>Date <SortIcon col="date" /></th>
              <th className={thCls} onClick={() => toggleSort('inspector')}>Inspector <SortIcon col="inspector" /></th>
              <th className={thCls} onClick={() => toggleSort('overall')}>Overall <SortIcon col="overall" /></th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Cleanliness</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Linens</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Supplies</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Exterior</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Notes</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(9)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    icon={ClipboardCheck}
                    title="No inspections"
                    description="Log property inspections to track cleanliness, linens, supplies, and exterior condition. Each inspection scores properties on a 1-10 scale."
                    action={{ label: 'Log First Inspection', onClick: () => setLogOpen(true) }}
                  />
                </td>
              </tr>
            ) : (
              paged.map((i: any) => (
                <tr
                  key={i.id}
                  className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => setDetailInspection(i)}
                >
                  <td className="py-2 px-3 font-medium text-xs">
                    <button
                      onClick={e => { e.stopPropagation(); openPropertyModal((i.properties as any)?.id) }}
                      className="hover:underline text-left"
                    >
                      {(i.properties as any)?.name || '—'}
                    </button>
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{format(new Date(i.inspected_at), 'MMM d, yyyy')}</td>
                  <td className="py-2 px-3 text-xs">{i.inspected_by}</td>
                  <td className="py-2 px-3"><ScoreBadge score={i.overall_score} /></td>
                  <td className="py-2 px-3"><ScoreBadge score={i.cleanliness_score} /></td>
                  <td className="py-2 px-3"><ScoreBadge score={i.linens_score} /></td>
                  <td className="py-2 px-3"><ScoreBadge score={i.supplies_score} /></td>
                  <td className="py-2 px-3"><ScoreBadge score={i.exterior_score} /></td>
                  <td className="py-2 px-3 text-xs text-muted-foreground max-w-[200px] truncate">{i.notes || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      {/* Log Inspection Sheet */}
      <Sheet open={logOpen} onOpenChange={setLogOpen}>
        <SheetContent side="right" className="w-[420px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Log Inspection</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Property *</label>
              <select
                value={form.property_id}
                onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))}
                className="mt-1 w-full h-8 text-xs border border-input rounded px-2 bg-background"
              >
                <option value="">Select property…</option>
                {(activeProps || []).map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Date *</label>
                <Input
                  type="date"
                  value={form.inspected_at}
                  onChange={e => setForm(f => ({ ...f, inspected_at: e.target.value }))}
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Inspector</label>
                <Input
                  value={form.inspected_by}
                  onChange={e => setForm(f => ({ ...f, inspected_by: e.target.value }))}
                  placeholder="Name…"
                  className="mt-1 h-8 text-xs"
                />
              </div>
            </div>

            <div className="rounded-md border border-border p-3 space-y-4 bg-muted/20">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Scores</p>
              {SCORE_SECTIONS.map(s => (
                <ScoreInput
                  key={s.key}
                  label={s.label}
                  value={(form as any)[s.key]}
                  onChange={v => setForm(f => ({ ...f, [s.key]: v }))}
                />
              ))}
              <div className="pt-2 border-t border-border/60 flex items-center justify-between">
                <span className="text-xs font-medium">Overall Score</span>
                <ScoreBadge score={overall} />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes…"
                className="mt-1 w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <Button
              className="w-full"
              disabled={!form.property_id || !form.inspected_at || logging}
              onClick={() => logInspection()}
            >
              {logging ? 'Saving…' : 'Save Inspection'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Detail Inspection Sheet */}
      <Sheet open={!!detailInspection} onOpenChange={v => !v && setDetailInspection(null)}>
        <SheetContent side="right" className="w-[400px] overflow-y-auto">
          {detailInspection && (
            <>
              <SheetHeader>
                <SheetTitle>{(detailInspection.properties as any)?.name || 'Inspection'}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground block">Date</span>
                    <span className="font-medium">{format(new Date(detailInspection.inspected_at), 'MMM d, yyyy')}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Inspector</span>
                    <span className="font-medium">{detailInspection.inspected_by || '—'}</span>
                  </div>
                </div>
                <div className="rounded-md border border-border p-3 space-y-2 bg-muted/20">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Scores</p>
                  {[
                    { label: 'Overall', value: detailInspection.overall_score },
                    { label: 'Cleanliness', value: detailInspection.cleanliness_score },
                    { label: 'Linens', value: detailInspection.linens_score },
                    { label: 'Supplies', value: detailInspection.supplies_score },
                    { label: 'Exterior', value: detailInspection.exterior_score },
                  ].map(s => (
                    <div key={s.label} className="flex items-center justify-between">
                      <span className="text-xs">{s.label}</span>
                      <ScoreBadge score={s.value} />
                    </div>
                  ))}
                </div>
                {detailInspection.notes && (
                  <div>
                    <span className="text-xs text-muted-foreground block mb-1">Notes</span>
                    <p className="text-xs">{detailInspection.notes}</p>
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => {
                    setDetailInspection(null)
                    openPropertyModal((detailInspection.properties as any)?.id)
                  }}
                >
                  Open Property →
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
