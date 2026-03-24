import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/EmptyState'
import { TablePagination } from '@/components/TablePagination'
import { ArrowUpDown, Search, X, ClipboardCheck } from 'lucide-react'

type SortKey = 'property' | 'date' | 'overall' | 'inspector'

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground">—</span>
  const cls = score >= 8 ? 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800' :
              score >= 6 ? 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-800' :
              'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800'
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${cls}`}>{score}/10</span>
}

export default function InspectionsPage() {
  usePageTitle('Inspections')
  const { openPropertyModal } = usePropertyModal()
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

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
                  <EmptyState icon={ClipboardCheck} title="No inspections" description="No inspections have been logged yet." />
                </td>
              </tr>
            ) : (
              paged.map((i: any) => (
                <tr key={i.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="py-2 px-3 font-medium text-xs">
                    <button onClick={() => openPropertyModal((i.properties as any)?.id)} className="hover:underline text-left">
                      {(i.properties as any)?.name || '—'}
                    </button>
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{new Date(i.inspected_at).toLocaleDateString()}</td>
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
    </div>
  )
}
