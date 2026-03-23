import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { Search, X, Download, Building2 } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import Papa from 'papaparse'

function StageBadgePopover({ propertyId, currentStageName, stageColor, stages }: {
  propertyId: string; currentStageName: string; stageColor: string; stages: any[]
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  const { mutate: changeStage } = useMutation({
    mutationFn: async (stageId: string) => {
      const fromStage = stages.find((s: any) => s.name === currentStageName)
      const { error } = await supabase.from('properties').update({ stage_id: stageId }).eq('id', propertyId)
      if (error) throw error
      await supabase.from('stage_transitions').insert({
        property_id: propertyId,
        from_stage_id: fromStage?.id,
        to_stage_id: stageId,
        changed_by: 'ops-user',
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/properties-list'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
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
          className="text-xs px-1.5 py-0.5 rounded font-medium cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
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
    return properties.filter((p: any) => {
      const matchSearch = p.name?.toLowerCase().includes(search.toLowerCase()) ||
        p.address?.toLowerCase().includes(search.toLowerCase())
      const matchStatus = !statusFilter || statusFilter === 'all' || p.stage_name === statusFilter
      return matchSearch && matchStatus
    })
  }, [properties, search, statusFilter])

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
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Property</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Address</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Beds</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Baths</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Guests</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Sq Ft</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Status</th>
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
