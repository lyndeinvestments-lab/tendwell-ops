import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, STAGE_COLORS } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { Search, Download } from 'lucide-react'

function fmt(n: number | null | undefined) {
  if (n == null) return ''
  return n.toFixed(2)
}

export default function MasterListPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStage, setBulkStage] = useState('')

  const { data: stages } = useQuery({
    queryKey: ['/supabase/pipeline_stages'],
    queryFn: async () => {
      const { data } = await supabase.from('pipeline_stages').select('*').order('display_order')
      return data || []
    },
  })

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/master-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, client, address, bedrooms, full_baths, square_footage, ce_charged, cleaner_pay, profit_percentage, stage_id, pipeline_stages!properties_stage_id_fkey(id, name, color)')
        .order("name")
      if (error) throw error
      return data || []
    },
  })

  const { mutate: bulkChangeStage, isPending: bulkPending } = useMutation({
    mutationFn: async ({ ids, stageId }: { ids: string[]; stageId: string }) => {
      const { error } = await supabase.from('properties').update({ stage_id: stageId }).in('id', ids)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/master-list'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      setSelected(new Set())
      toast({ title: `Updated ${selected.size} properties` })
    },
    onError: () => toast({ title: 'Bulk update failed', variant: 'destructive' }),
  })

  const filtered = useMemo(() => {
    if (!properties) return []
    return properties.filter((p: any) => {
      const matchSearch = [p.name, p.client, p.address].some(v =>
        v?.toLowerCase().includes(search.toLowerCase())
      )
      const matchStage = stageFilter === 'all' || p.pipeline_stages?.name === stageFilter
      return matchSearch && matchStage
    })
  }, [properties, search, stageFilter])

  function toggleSelect(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map((p: any) => p.id)))
  }

  function exportCSV() {
    const cols = ['name', 'client', 'address', 'bedrooms', 'full_baths', 'square_footage', 'ce_charged', 'cleaner_pay', 'profit_percentage', 'stage']
    const header = cols.join(',')
    const rows = filtered.map((p: any) => cols.map(c => {
      if (c === 'stage') return `"${p.pipeline_stages?.name || ''}"`
      const v = p[c]
      return v == null ? '' : typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
    }).join(','))
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'tendwell-properties.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const allSelected = filtered.length > 0 && selected.size === filtered.length

  return (
    <div className="p-5 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Master List</h1>
          <p className="text-sm text-muted-foreground">All {properties?.length ?? 0} properties</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{selected.size} selected</span>
              <Select value={bulkStage} onValueChange={setBulkStage}>
                <SelectTrigger data-testid="select-bulk-stage" className="h-7 w-36 text-xs">
                  <SelectValue placeholder="Change stage…" />
                </SelectTrigger>
                <SelectContent>
                  {stages?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-7 text-xs" disabled={!bulkStage || bulkPending}
                onClick={() => bulkChangeStage({ ids: Array.from(selected), stageId: bulkStage })}
                data-testid="button-bulk-apply">
                Apply
              </Button>
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input type="search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
              data-testid="input-search-master" className="pl-8 h-7 w-48 text-xs" />
          </div>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger data-testid="select-stage-filter" className="h-7 w-36 text-xs">
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stages</SelectItem>
              {stages?.map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={exportCSV} data-testid="button-export-csv">
            <Download className="w-3 h-3" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th className="py-2 px-3 w-8">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} data-testid="checkbox-select-all" />
              </th>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Name</th>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Client</th>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Address</th>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Beds</th>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Baths</th>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Sq Ft</th>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">CE</th>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Pay</th>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Profit %</th>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Stage</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(10)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(11)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-3 w-full" /></td>)}
                </tr>
              ))
            ) : filtered.map((p: any) => {
              const color = p.pipeline_stages?.color || '#6b7280'
              return (
                <tr key={p.id} data-testid={`row-master-${p.id}`} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="py-1.5 px-3">
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggleSelect(p.id)}
                      data-testid={`checkbox-${p.id}`}
                    />
                  </td>
                  <td className="py-1.5 px-3 font-medium">{p.name}</td>
                  <td className="py-1.5 px-3 text-muted-foreground">{p.client || '—'}</td>
                  <td className="py-1.5 px-3 text-muted-foreground text-xs max-w-[140px] truncate">{p.address || '—'}</td>
                  <td className="py-1.5 px-3 tabular-nums">{p.bedrooms ?? '—'}</td>
                  <td className="py-1.5 px-3 tabular-nums">{p.bathrooms ?? '—'}</td>
                  <td className="py-1.5 px-3 tabular-nums">{p.square_footage?.toLocaleString() ?? '—'}</td>
                  <td className="py-1.5 px-3 tabular-nums">{p.ce_charged != null ? `$${fmt(p.ce_charged)}` : '—'}</td>
                  <td className="py-1.5 px-3 tabular-nums">{p.cleaner_pay != null ? `$${fmt(p.cleaner_pay)}` : '—'}</td>
                  <td className="py-1.5 px-3 tabular-nums">
                    {p.profit_percentage != null ? (
                      <span className={`font-medium ${p.profit_percentage >= 30 ? 'text-green-600 dark:text-green-400' : p.profit_percentage >= 15 ? 'text-amber-600' : 'text-destructive'}`}>
                        {p.profit_percentage.toFixed(1)}%
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-1.5 px-3">
                    <span className="px-1.5 py-0.5 rounded font-medium text-xs"
                      style={{ backgroundColor: color + '20', color, border: `1px solid ${color}40` }}>
                      {p.pipeline_stages?.name || '—'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
