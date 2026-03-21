import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { STAGE_COLORS } from '@/lib/supabase'
import { Search } from 'lucide-react'

export default function PropertyListPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    try { return localStorage.getItem('property-list-filter') || 'Active' } catch { return 'Active' }
  })
  const [selected, setSelected] = useState<any>(null)

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
              className="pl-8 h-8 w-56 text-sm"
            />
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
                <td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">No properties found</td>
              </tr>
            ) : (
              filtered.map((p: any) => {
                const color = p.stage_color || '#6b7280'
                return (
                  <tr
                    key={p.id}
                    data-testid={`row-property-${p.id}`}
                    onClick={() => setSelected(p)}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <td className="py-2 px-3 font-medium text-xs">{p.name}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">{p.address || '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.bedrooms ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.full_baths ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.guest_count ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.square_footage ? p.square_footage.toLocaleString() : '—'}</td>
                    <td className="py-2 px-3">
                      {p.stage_name ? (
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

      {/* Property detail dialog — no financials */}
      <Dialog open={!!selected} onOpenChange={v => !v && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{selected?.name}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 py-1">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-xs text-muted-foreground block">Address</span><span>{selected.address || '—'}</span></div>
                <div><span className="text-xs text-muted-foreground block">Status</span>
                  <span>{selected.stage_name || "—"}</span>
                </div>
                <div><span className="text-xs text-muted-foreground block">Bedrooms</span><span>{selected.bedrooms ?? '—'}</span></div>
                <div><span className="text-xs text-muted-foreground block">Bathrooms</span><span>{selected.full_baths ?? '—'}</span></div>
                <div><span className="text-xs text-muted-foreground block">Max Guests</span><span>{selected.guest_count ?? '—'}</span></div>
                <div><span className="text-xs text-muted-foreground block">Sq Ft</span><span>{selected.square_footage?.toLocaleString() ?? '—'}</span></div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
