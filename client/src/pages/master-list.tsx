import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, STAGE_COLORS } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { useLocation } from 'wouter'
import { Search, Download, ArrowUpDown, ArrowUp, ArrowDown, AlertCircle, Loader2 } from 'lucide-react'
import { InlineEdit } from '@/components/InlineEdit'
import { TablePagination } from '@/components/TablePagination'

function fmt(n: number | null | undefined) {
  if (n == null) return ''
  return n.toFixed(2)
}

const REQUIRED_FIELDS = ['ce_charged', 'cleaner_pay', 'square_footage', 'bedrooms', 'address']
function completeness(p: any): number {
  const filled = REQUIRED_FIELDS.filter(f => p[f] != null && p[f] !== '' && p[f] !== 0).length
  return Math.round((filled / REQUIRED_FIELDS.length) * 100)
}

type SortKey = 'name' | 'client' | 'bedrooms' | 'full_baths' | 'square_footage' | 'ce_charged' | 'cleaner_pay' | 'profit_percentage' | 'stage'
type SortDir = 'asc' | 'desc'

function SortHeader({ label, sortKey, currentSort, currentDir, onSort }: {
  label: string; sortKey: SortKey; currentSort: SortKey; currentDir: SortDir; onSort: (k: SortKey) => void
}) {
  const active = currentSort === sortKey
  return (
    <th
      className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors group"
      onClick={() => onSort(sortKey)}
    >
      <span className="flex items-center gap-1">
        {label}
        {active ? (
          currentDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
        )}
      </span>
    </th>
  )
}

export default function MasterListPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [location] = useLocation()
  usePageTitle('Master List')
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStage, setBulkStage] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [detailProperty, setDetailProperty] = useState<any>(null)
  const [highlightHandled, setHighlightHandled] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

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
        .select('*, pipeline_stages!properties_stage_id_fkey(id, name, color)')
        .order("name")
      if (error) throw error
      return data || []
    },
  })

  // Auto-open detail panel when ?highlight= param is present
  useEffect(() => {
    if (highlightHandled || !properties || properties.length === 0) return
    // Parse query string from hash-based URL (e.g., #/master-list?highlight=id)
    const fullUrl = window.location.hash || ''
    const qIdx = fullUrl.indexOf('?')
    if (qIdx === -1) return
    const params = new URLSearchParams(fullUrl.slice(qIdx))
    const highlightId = params.get('highlight')
    if (highlightId) {
      const match = properties.find((p: any) => p.id === highlightId)
      if (match) {
        setDetailProperty(match)
        setHighlightHandled(true)
      }
    }
  }, [properties, highlightHandled])

  const { mutate: bulkChangeStage, isPending: bulkPending } = useMutation({
    mutationFn: async ({ ids, stageId }: { ids: string[]; stageId: string }) => {
      const { error } = await supabase.from('properties').update({ stage_id: stageId }).in('id', ids)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/master-list'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      setSelected(new Set())
      toast({ title: `Updated ${selected.size} properties` })
    },
    onError: () => toast({ title: 'Bulk update failed', variant: 'destructive' }),
  })

  // Detail panel save
  const { mutate: saveDetail, isPending: savingDetail } = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const { error } = await supabase.from('properties').update(updates).eq('id', detailProperty.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/master-list'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pro-forma'] })
      toast({ title: 'Property updated' })
      setDetailProperty(null)
    },
    onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
  })

  // Quick inline update for CE/Pay with undo
  const { mutate: quickUpdate } = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: number | null }) => {
      const { error } = await supabase.from('properties').update({ [field]: value }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, { id, field, value }) => {
      qc.invalidateQueries({ queryKey: ['/supabase/master-list'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      // Show undo toast — find prev value from current data
      const prev = properties?.find((p: any) => p.id === id)?.[field] ?? null
      toast({
        title: 'Updated',
        description: `${field === 'ce_charged' ? 'CE' : 'Pay'} updated`,
        action: (
          <button
            className="text-xs underline"
            onClick={() => quickUpdate({ id, field, value: prev })}
          >
            Undo
          </button>
        ) as any,
        duration: 5000,
      })
    },
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  })

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const filtered = useMemo(() => {
    if (!properties) return []
    let result = properties.filter((p: any) => {
      const matchSearch = [p.name, p.client, p.address].some(v =>
        v?.toLowerCase().includes(search.toLowerCase())
      )
      const matchStage = stageFilter === 'all' || p.pipeline_stages?.name === stageFilter
      return matchSearch && matchStage
    })

    // Sort
    result.sort((a: any, b: any) => {
      let aVal: any, bVal: any
      if (sortKey === 'stage') {
        aVal = a.pipeline_stages?.name || ''
        bVal = b.pipeline_stages?.name || ''
      } else {
        aVal = a[sortKey]
        bVal = b[sortKey]
      }
      if (aVal == null) aVal = sortDir === 'asc' ? Infinity : -Infinity
      if (bVal == null) bVal = sortDir === 'asc' ? Infinity : -Infinity
      if (typeof aVal === 'string') {
        const cmp = aVal.localeCompare(bVal)
        return sortDir === 'asc' ? cmp : -cmp
      }
      return sortDir === 'asc' ? (aVal - bVal) : (bVal - aVal)
    })

    return result
  }, [properties, search, stageFilter, sortKey, sortDir])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

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
          <p className="text-sm text-muted-foreground">All {properties?.length ?? 0} properties — click a name to view details</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected.size > 0 && (
            <div className="flex items-center gap-2 bg-muted/60 rounded-md px-2.5 py-1.5">
              <span className="text-xs font-medium">{selected.size} selected</span>
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
                {bulkPending ? 'Applying…' : 'Apply'}
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid="button-export-selected"
                onClick={() => {
                  const cols = ['name', 'client', 'address', 'bedrooms', 'full_baths', 'square_footage', 'ce_charged', 'cleaner_pay', 'profit_percentage', 'stage']
                  const header = cols.join(',')
                  const selectedRows = filtered.filter((p: any) => selected.has(p.id))
                  const rows = selectedRows.map((p: any) => cols.map(c => {
                    if (c === 'stage') return `"${p.pipeline_stages?.name || ''}"`
                    const v = p[c]
                    return v == null ? '' : typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
                  }).join(','))
                  const csv = [header, ...rows].join('\n')
                  const blob = new Blob([csv], { type: 'text/csv' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url; a.download = 'tendwell-selected-properties.csv'; a.click()
                  URL.revokeObjectURL(url)
                }}>
                <Download className="w-3 h-3" /> Export Selected
              </Button>
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input type="search" placeholder="Search…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              data-testid="input-search-master" className="pl-8 h-7 w-48 text-xs" />
          </div>
          <Select value={stageFilter} onValueChange={v => { setStageFilter(v); setPage(1) }}>
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
              <SortHeader label="Name" sortKey="name" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Client" sortKey="client" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Address</th>
              <SortHeader label="Beds" sortKey="bedrooms" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Baths" sortKey="full_baths" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Sq Ft" sortKey="square_footage" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="CE" sortKey="ce_charged" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Pay" sortKey="cleaner_pay" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Profit %" sortKey="profit_percentage" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Stage" sortKey="stage" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 w-12" title="Data completeness">
                <AlertCircle className="w-3 h-3" />
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(10)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(12)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-3 w-full" /></td>)}
                </tr>
              ))
            ) : paged.map((p: any) => {
              const color = p.pipeline_stages?.color || '#6b7280'
              const comp = completeness(p)
              return (
                <tr key={p.id} data-testid={`row-master-${p.id}`} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="py-1.5 px-3">
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggleSelect(p.id)}
                      data-testid={`checkbox-${p.id}`}
                    />
                  </td>
                  <td className="py-1.5 px-3">
                    <button
                      onClick={() => setDetailProperty(p)}
                      className="font-medium text-primary hover:underline cursor-pointer text-left"
                      data-testid={`link-property-${p.id}`}
                    >
                      {p.name}
                    </button>
                  </td>
                  <td className="py-1.5 px-3 text-muted-foreground">{p.client || '—'}</td>
                  <td className="py-1.5 px-3 text-muted-foreground text-xs max-w-[140px] truncate">{p.address || '—'}</td>
                  <td className="py-1.5 px-3 tabular-nums">{p.bedrooms ?? '—'}</td>
                  <td className="py-1.5 px-3 tabular-nums">{p.full_baths != null ? `${p.full_baths}${p.half_baths ? ` / ${p.half_baths}h` : ''}` : '—'}</td>
                  <td className="py-1.5 px-3 tabular-nums">{p.square_footage?.toLocaleString() ?? '—'}</td>
                  <td className="py-1.5 px-3 tabular-nums" onClick={e => e.stopPropagation()}>
                    <InlineEdit
                      value={p.ce_charged}
                      type="number"
                      onSave={v => quickUpdate({ id: p.id, field: 'ce_charged', value: v ? parseFloat(v) : null })}
                      testId={`inline-ce-${p.id}`}
                      placeholder="—"
                    />
                  </td>
                  <td className="py-1.5 px-3 tabular-nums" onClick={e => e.stopPropagation()}>
                    <InlineEdit
                      value={p.cleaner_pay}
                      type="number"
                      onSave={v => quickUpdate({ id: p.id, field: 'cleaner_pay', value: v ? parseFloat(v) : null })}
                      testId={`inline-pay-${p.id}`}
                      placeholder="—"
                    />
                  </td>
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
                  <td className="py-1.5 px-3">
                    {p.pipeline_stages?.name === 'Offboarded' ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center gap-1" title={`${comp}% complete`}>
                        <div className="w-8 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${comp}%`,
                              backgroundColor: comp === 100 ? '#22c55e' : comp >= 60 ? '#f59e0b' : '#ef4444'
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      {/* Property Detail Slide-out Panel */}
      <PropertyDetailPanel
        property={detailProperty}
        stages={stages || []}
        open={!!detailProperty}
        onClose={() => setDetailProperty(null)}
        onSave={saveDetail}
        saving={savingDetail}
      />
    </div>
  )
}

function PropertyDetailPanel({ property, stages, open, onClose, onSave, saving }: {
  property: any; stages: any[]; open: boolean; onClose: () => void
  onSave: (updates: Record<string, any>) => void; saving: boolean
}) {
  const [form, setForm] = useState<Record<string, any>>({})

  // Reset form when property changes
  const propId = property?.id
  useMemo(() => {
    if (property) {
      setForm({
        name: property.name || '',
        client: property.client || '',
        address: property.address || '',
        bedrooms: property.bedrooms ?? '',
        full_baths: property.full_baths ?? '',
        half_baths: property.half_baths ?? '',
        square_footage: property.square_footage ?? '',
        ce_charged: property.ce_charged ?? '',
        cleaner_pay: property.cleaner_pay ?? '',
        number_of_beds: property.number_of_beds ?? '',
        guest_count: property.guest_count ?? '',
        kitchens: property.kitchens ?? '',
        hot_tub: property.hot_tub ?? false,
        pet_friendly: property.pet_friendly || 'No',
        cleaning_frequency: property.cleaning_frequency || 'as_needed',
        auto_code: property.auto_code || '',
        door_code: property.door_code || '',
        wifi_network: (property.wifi_info || '').split('\n')[0] || '',
        wifi_password: (property.wifi_info || '').split('\n')[1] || '',
        notes: property.notes || '',
        stage_id: property.stage_id,
      })
    }
  }, [propId])

  function updateForm(key: string, value: any) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleSave() {
    const updates: Record<string, any> = {}
    for (const [key, val] of Object.entries(form)) {
      if (key === 'hot_tub') {
        updates[key] = val
      } else if (['bedrooms', 'full_baths', 'half_baths', 'square_footage', 'ce_charged', 'cleaner_pay', 'number_of_beds', 'guest_count', 'kitchens'].includes(key)) {
        updates[key] = val === '' ? null : parseFloat(val)
      } else {
        updates[key] = val || null
      }
    }
    updates.wifi_info = [form.wifi_network, form.wifi_password].filter(Boolean).join('\n')
    delete updates.wifi_network
    delete updates.wifi_password
    onSave(updates)
  }

  if (!property) return null

  const stageColor = property.pipeline_stages?.color || '#6b7280'

  const FIELDS = [
    { section: 'Basic Info', fields: [
      { key: 'name', label: 'Property Name', type: 'text' },
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'address', label: 'Address', type: 'text' },
    ]},
    { section: 'Property Details', fields: [
      { key: 'bedrooms', label: 'Bedrooms', type: 'number' },
      { key: 'full_baths', label: 'Full Baths', type: 'number' },
      { key: 'half_baths', label: 'Half Baths', type: 'number' },
      { key: 'square_footage', label: 'Square Footage', type: 'number' },
      { key: 'number_of_beds', label: 'Number of Beds', type: 'number' },
      { key: 'guest_count', label: 'Guest Count', type: 'number' },
      { key: 'kitchens', label: 'Kitchens', type: 'number' },
      { key: 'pet_friendly', label: 'Pet Friendly', type: 'select', options: ['Yes', 'No'] },
    ]},
    { section: 'Financial', fields: [
      { key: 'ce_charged', label: 'CE Charged', type: 'number' },
      { key: 'cleaner_pay', label: 'Cleaner Pay', type: 'number' },
    ]},
    { section: 'Operations', fields: [
      { key: 'cleaning_frequency', label: 'Cleaning Frequency', type: 'select', options: ['weekly', 'biweekly', 'monthly', 'as_needed'] },
      { key: 'auto_code', label: 'Auto Code', type: 'text' },
      { key: 'door_code', label: 'Door Code', type: 'text' },
      { key: 'wifi_network', label: 'WiFi Network', type: 'text' },
      { key: 'wifi_password', label: 'WiFi Password', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ]},
  ]

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-[400px] sm:w-[480px] overflow-y-auto" data-testid="property-detail-panel">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-base flex items-center gap-2">
            {property.name}
            <Badge style={{ backgroundColor: stageColor + '20', color: stageColor, border: `1px solid ${stageColor}40` }} className="text-xs">
              {property.pipeline_stages?.name}
            </Badge>
          </SheetTitle>
        </SheetHeader>

        {/* Computed summary */}
        <div className="grid grid-cols-3 gap-3 bg-muted/50 rounded-md p-3 mb-4">
          <div>
            <span className="text-xs text-muted-foreground block">Total Cost</span>
            <span className="text-sm font-medium">${(property.total_estimated_cost || 0).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Profit</span>
            <span className={`text-sm font-medium ${(property.estimated_profit || 0) < 0 ? 'text-destructive' : ''}`}>
              ${(property.estimated_profit || 0).toFixed(2)}
            </span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Profit %</span>
            <span className="text-sm font-medium">{(property.profit_percentage || 0).toFixed(1)}%</span>
          </div>
        </div>

        {/* Editable fields */}
        <div className="space-y-5">
          {FIELDS.map(section => (
            <div key={section.section}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{section.section}</h3>
              <div className="space-y-2.5">
                {section.fields.map(field => (
                  <div key={field.key} className="grid grid-cols-[120px_1fr] items-center gap-2">
                    <Label className="text-xs text-muted-foreground">{field.label}</Label>
                    {field.type === 'select' ? (
                      <Select value={form[field.key] || ''} onValueChange={v => updateForm(field.key, v)}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {field.options?.map((o: string) => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={field.type}
                        value={form[field.key] ?? ''}
                        onChange={e => updateForm(field.key, e.target.value)}
                        className="h-7 text-xs"
                        data-testid={`detail-input-${field.key}`}
                        step={field.type === 'number' ? '0.01' : undefined}
                        min={field.type === 'number' ? '0' : undefined}
                      />
                    )}
                  </div>
                ))}
              </div>
              <Separator className="mt-3" />
            </div>
          ))}

          {/* Stage selector */}
          <div className="grid grid-cols-[120px_1fr] items-center gap-2">
            <Label className="text-xs text-muted-foreground">Stage</Label>
            <Select value={String(form.stage_id)} onValueChange={v => updateForm('stage_id', v)}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stages?.map((s: any) => <SelectItem key={s.id} value={String(s.id)} className="text-xs">{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6 pb-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving} data-testid="button-save-detail">
            {saving ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Saving…</> : 'Save Changes'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
