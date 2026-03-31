import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, logPropertyEdit } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePageTitle } from '@/hooks/use-page-title'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { Search, X, Download, Building2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import Papa from 'papaparse'

function StageBadgePopover({ propertyId, currentStageName, stageColor, stages }: {
  propertyId: string; currentStageName: string; stageColor: string; stages: any[]
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  const { mutate: changeStage } = useGuardedMutation('property-list', {
    mutationFn: async (stageId: string) => {
      const fromStage = stages.find((s: any) => s.name === currentStageName)
      const toStage = stages.find((s: any) => s.id === stageId)
      const { error } = await supabase.from('properties').update({ stage_id: stageId }).eq('id', propertyId)
      if (error) throw error
      await supabase.from('stage_transitions').insert({
        property_id: propertyId,
        from_stage_id: fromStage?.id,
        to_stage_id: stageId,
        changed_by: 'ops-user',
      })
    },
    onSuccess: (_, stageId) => {
      const toStage = stages?.find((s: any) => s.id === stageId)
      logPropertyEdit(propertyId, 'stage', currentStageName, toStage?.name ?? null)
      qc.invalidateQueries({ queryKey: ['/supabase/properties-list'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
      toast({ title: 'Stage updated' })
      setOpen(false)
    },
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          onClick={e => { e.stopPropagation(); setOpen(true) }}
          className="text-xs px-1.5 py-0.5 rounded font-medium cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all duration-300"
          style={{ backgroundColor: stageColor + '20', color: stageColor, border: `1px solid ${stageColor}40` }}
          title="Click to change stage"
        >
          {currentStageName}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start" onClick={e => e.stopPropagation()}>
        {stages.map((s: any) => (
          <button
            key={s.id}
            onClick={() => changeStage(s.id)}
            className={`w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors ${s.name === currentStageName ? 'font-semibold bg-muted/50' : ''}`}
          >
            {s.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export default function PropertyListPage() {
  usePageTitle('Property List')
  const { openPropertyModal } = usePropertyModal()
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<string | null>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortKey !== col) return <ArrowUpDown className="inline w-3 h-3 ml-1 opacity-40" />
    return sortDir === 'asc'
      ? <ArrowUp className="inline w-3 h-3 ml-1" />
      : <ArrowDown className="inline w-3 h-3 ml-1" />
  }

  const [statusFilter, setStatusFilter] = useState<string>(() => {
    try { return localStorage.getItem('property-list-filter') || 'Active' } catch { return 'Active' }
  })

  useEffect(() => {
    try { localStorage.setItem('property-list-filter', statusFilter) } catch { /* ignore */ }
  }, [statusFilter])

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/properties-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, address, bedrooms, full_baths, guest_count, square_footage, stage_name, stage_color')
      if (error) throw error
      return data || []
    },
  })

  const { data: stages } = useQuery({
    queryKey: ['/supabase/pipeline_stages'],
    queryFn: async () => {
      const { data } = await supabase.from('pipeline_stages').select('*').order('display_order')
      return data || []
    },
  })

  const filtered = useMemo(() => {
    if (!properties) return []
    const base = properties.filter((p: any) => {
      const matchSearch = p.name?.toLowerCase().includes(search.toLowerCase()) ||
        p.address?.toLowerCase().includes(search.toLowerCase())
      const matchStatus = !statusFilter || statusFilter === 'all' || p.stage_name === statusFilter
      return matchSearch && matchStatus
    })

    if (!sortKey) return base

    return [...base].sort((a: any, b: any) => {
      const dir = sortDir === 'asc' ? 1 : -1

      // Status sorts by the stage_name string
      const av = sortKey === 'stage_name' ? (a.stage_name ?? null) : a[sortKey]
      const bv = sortKey === 'stage_name' ? (b.stage_name ?? null) : b[sortKey]

      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1

      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * dir
      }
      return (av - bv) * dir
    })
  }, [properties, search, statusFilter, sortKey, sortDir])

  function exportCsv() {
    const rows = filtered.map((p: any) => ({
      'Property': p.name || '',
      'Address': p.address || '',
      'Bedrooms': p.bedrooms ?? '',
      'Full Baths': p.full_baths ?? '',
      'Max Guests': p.guest_count ?? '',
      'Sq Ft': p.square_footage ?? '',
      'Status': p.stage_name || '',
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'property-list.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Property List</h1>
          <p className="text-sm text-muted-foreground">Active operational properties</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search properties…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-search-properties"
              className="pl-8 pr-7 h-8 w-56 text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger data-testid="select-status-filter" className="h-8 w-44 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses ({properties?.length ?? 0})</SelectItem>
              {stages?.map((s: any) => {
                const count = properties?.filter((p: any) => p.stage_name === s.name).length ?? 0
                return (
                  <SelectItem key={s.id} value={s.name}>{s.name} ({count})</SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="h-8 text-xs gap-1.5"
            data-testid="button-export-csv"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/80 border-b border-border">
            <tr>
              {([
                { col: 'name', label: 'Property' },
                { col: 'address', label: 'Address' },
                { col: 'bedrooms', label: 'Beds' },
                { col: 'full_baths', label: 'Baths' },
                { col: 'guest_count', label: 'Guests' },
                { col: 'square_footage', label: 'Sq Ft' },
                { col: 'stage_name', label: 'Status' },
              ] as { col: string; label: string }[]).map(({ col, label }) => (
                <th
                  key={col}
                  className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap"
                  tabIndex={0}
                  role="columnheader"
                  aria-sort={sortKey === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  onClick={() => toggleSort(col)}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleSort(col)}
                >
                  {label}<SortIcon col={col} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(7)].map((_, j) => (
                    <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState icon={Building2} title="No properties found" description="Try adjusting your search or filter criteria." />
                </td>
              </tr>
            ) : (
              filtered.map((p: any) => {
                const color = p.stage_color || '#6b7280'
                return (
                  <tr
                    key={p.id}
                    data-testid={`row-property-${p.id}`}
                    onClick={() => openPropertyModal(p.id, 'property-list')}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <td className="py-2 px-3 font-medium text-xs text-primary hover:underline">{p.name}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">{p.address || '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.bedrooms ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.full_baths ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.guest_count ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.square_footage ? p.square_footage.toLocaleString() : '—'}</td>
                    <td className="py-2 px-3">
                      {p.stage_name && stages?.length ? (
                        <StageBadgePopover
                          propertyId={p.id}
                          currentStageName={p.stage_name}
                          stageColor={color}
                          stages={stages}
                        />
                      ) : p.stage_name ? (
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                          style={{ backgroundColor: color + '20', color, border: `1px solid ${color}40` }}>
                          {p.stage_name}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
