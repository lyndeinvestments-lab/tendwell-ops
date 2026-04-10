import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase, STAGE_COLORS, logPropertyEdit } from '@/lib/supabase'
import { format, subDays } from 'date-fns'
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
import { Search, Download, Upload, Trash2, ArrowUpDown, ArrowUp, ArrowDown, AlertCircle, Loader2, Check } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import Papa from 'papaparse'
import { InlineEdit } from '@/components/InlineEdit'
import { TablePagination } from '@/components/TablePagination'

function fmt(n: number | null | undefined) {
  if (n == null) return ''
  return n.toFixed(2)
}

const REQUIRED_FIELDS = ['name', 'address', 'bedrooms', 'full_baths', 'square_footage', 'ce_charged', 'cleaner_pay']
function completeness(p: any): number {
  const filled = REQUIRED_FIELDS.filter(f => p[f] != null && p[f] !== '').length
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
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(sortKey) } }}
      tabIndex={0}
      role="columnheader"
      aria-sort={active ? (currentDir === 'asc' ? 'ascending' : 'descending') : 'none'}
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

  const [stageFilter, setStageFilter] = useState(() => {
    // Check URL params first, then localStorage
    const hash = window.location.hash || ''
    const qIdx = hash.indexOf('?')
    if (qIdx !== -1) {
      const urlStage = new URLSearchParams(hash.slice(qIdx)).get('stage')
      if (urlStage) return urlStage
    }
    try { return localStorage.getItem('ml-stage-filter') || 'all' } catch { return 'all' }
  })

  // Reactively apply ?stage= param on navigation (e.g. from dashboard stat cards)
  useEffect(() => {
    const hash = window.location.hash || ''
    const qIdx = hash.indexOf('?')
    if (qIdx === -1) return
    const params = new URLSearchParams(hash.slice(qIdx))
    const urlStage = params.get('stage')
    if (urlStage) {
      setStageFilter(urlStage)
      setPage(1)
      // Strip the query param to prevent it persisting in the URL
      window.history.replaceState(null, '', window.location.pathname + hash.slice(0, qIdx))
    }
  }, [location])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStage, setBulkStage] = useState('')
  const [assignClient, setAssignClient] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    try { return (localStorage.getItem('ml-sort-key') as SortKey) || 'name' } catch { return 'name' }
  })
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    try { return (localStorage.getItem('ml-sort-dir') as SortDir) || 'asc' } catch { return 'asc' }
  })
  const [detailProperty, setDetailProperty] = useState<any>(null)
  const [highlightHandled, setHighlightHandled] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // Detect ?stageChangeLast30=true in hash URL
  const stageChangeLast30 = useMemo(() => {
    const hash = window.location.hash || ''
    const qIdx = hash.indexOf('?')
    if (qIdx === -1) return false
    return new URLSearchParams(hash.slice(qIdx)).get('stageChangeLast30') === 'true'
  }, [])

  // Fetch recent transition property IDs when stageChangeLast30 is active
  const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd')
  const { data: recentTransitionIds } = useQuery({
    queryKey: ['/supabase/stage_transitions_recent_30d'],
    enabled: stageChangeLast30,
    queryFn: async () => {
      const { data } = await supabase
        .from('stage_transitions')
        .select('property_id')
        .gte('created_at', thirtyDaysAgo)
      return new Set(data?.map((r: any) => r.property_id) ?? [])
    },
    staleTime: 60_000,
  })

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

  const { mutate: bulkChangeStage, isPending: bulkPending } = useGuardedMutation('master-list', {
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

  const [confirmDelete, setConfirmDelete] = useState(false)
  const { mutate: bulkDelete, isPending: deletePending } = useGuardedMutation('master-list', {
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('properties').delete().in('id', ids)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/master-list'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pro-forma'] })
      const count = selected.size
      setSelected(new Set())
      setConfirmDelete(false)
      toast({ title: `Deleted ${count} ${count === 1 ? 'property' : 'properties'}` })
    },
    onError: (e: any) => toast({ title: 'Delete failed: ' + (e.message || 'Unknown error'), variant: 'destructive' }),
  })

  // Detail panel save
  const { mutate: saveDetail, isPending: savingDetail } = useGuardedMutation('master-list', {
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

  // Persist sort/filter to localStorage (#9)
  useEffect(() => {
    try { localStorage.setItem('ml-sort-key', sortKey) } catch {}
    try { localStorage.setItem('ml-sort-dir', sortDir) } catch {}
  }, [sortKey, sortDir])

  // Quick inline update for CE/Pay with undo
  const { mutate: quickUpdate } = useGuardedMutation('master-list', {
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: number | null }) => {
      const { error } = await supabase.from('properties').update({ [field]: value }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, { id, field, value }) => {
      const prop = properties?.find((p: any) => p.id === id)
      logPropertyEdit(id, field, prop?.[field] ?? null, value, prop?.name)
      qc.invalidateQueries({ queryKey: ['/supabase/master-list'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
      toast({
        title: 'Updated',
        description: `${field === 'ce_charged' ? 'CE' : 'Pay'} updated`,
        action: (
          <button
            className="text-xs underline"
            onClick={() => quickUpdate({ id, field, value: prop?.[field] ?? null })}
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
      const matchRecent = !stageChangeLast30 || !recentTransitionIds || recentTransitionIds.has(p.id)
      return matchSearch && matchStage && matchRecent
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
  }, [properties, search, stageFilter, sortKey, sortDir, stageChangeLast30, recentTransitionIds])

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

  // ── CSV Export/Import column definitions ──
  const EXPORT_COLS = [
    'id', 'name', 'client', 'address', 'bedrooms', 'full_baths', 'half_baths',
    'square_footage', 'guest_count', 'number_of_beds', 'king_beds', 'queen_beds',
    'full_beds', 'twin_beds', 'hot_tub', 'pet_friendly', 'auto_code', 'door_code',
    'other_codes', 'wifi_info', 'filter_size', 'cleaning_frequency', 'notes',
    'ce_charged', 'cleaner_pay', 'profit_percentage', 'stage',
  ]
  // Fields that can be imported (excludes computed/read-only fields)
  const IMPORTABLE_FIELDS = new Set([
    'client', 'address', 'bedrooms', 'full_baths', 'half_baths', 'square_footage',
    'guest_count', 'number_of_beds', 'king_beds', 'queen_beds', 'full_beds', 'twin_beds',
    'hot_tub', 'pet_friendly', 'auto_code', 'door_code', 'other_codes', 'wifi_info',
    'filter_size', 'cleaning_frequency', 'notes', 'ce_charged', 'cleaner_pay',
  ])
  const NUMERIC_FIELDS = new Set([
    'bedrooms', 'full_baths', 'half_baths', 'square_footage', 'guest_count',
    'number_of_beds', 'king_beds', 'queen_beds', 'full_beds', 'twin_beds',
    'ce_charged', 'cleaner_pay',
  ])
  const BOOLEAN_FIELDS = new Set(['hot_tub'])

  function exportCSV() {
    const header = EXPORT_COLS.join(',')
    const rows = filtered.map((p: any) => EXPORT_COLS.map(c => {
      if (c === 'stage') return `"${p.pipeline_stages?.name || ''}"`
      const v = p[c]
      if (v == null) return ''
      if (typeof v === 'boolean') return v ? 'true' : 'false'
      return typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
    }).join(','))
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'tendwell-properties.csv'; a.click()
    URL.revokeObjectURL(url)
    toast({ title: `Exported ${filtered.length} properties` })
  }

  // ── CSV Import (fill-only mode) ──
  const [importPreview, setImportPreview] = useState<any[] | null>(null)
  const [importRunning, setImportRunning] = useState(false)

  function handleImportFile(file: File) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (!result.data?.length || !properties) {
          toast({ title: 'No data found in CSV', variant: 'destructive' })
          return
        }
        const csvRows = result.data as Record<string, string>[]
        const csvHeaders = Object.keys(csvRows[0])

        // Determine how to match: by ID if available, else by name
        const hasId = csvHeaders.some(h => h.toLowerCase().trim() === 'id')
        const nameCol = csvHeaders.find(h => h.toLowerCase().trim() === 'name')

        const preview: any[] = []

        for (const csvRow of csvRows) {
          // Find matching property
          let match: any = null
          const csvId = hasId ? (csvRow['id'] || csvRow['ID'] || csvRow['Id'] || '').trim() : ''
          const csvName = nameCol ? (csvRow[nameCol] || '').trim() : ''

          if (csvId) {
            match = properties.find((p: any) => String(p.id) === csvId)
          }
          if (!match && csvName) {
            match = properties.find((p: any) =>
              p.name?.toLowerCase() === csvName.toLowerCase()
            )
          }

          if (!match) {
            preview.push({ csvName: csvName || csvId, match: null, fills: [], skips: 0 })
            continue
          }

          // Compare each importable field: fill only if DB is empty and CSV has data
          const fills: { field: string; value: any }[] = []
          let skips = 0

          for (const csvCol of csvHeaders) {
            const field = csvCol.toLowerCase().trim()
            if (!IMPORTABLE_FIELDS.has(field)) continue
            const csvVal = (csvRow[csvCol] || '').trim()
            if (!csvVal) continue // empty CSV cell → skip, never erase

            const dbVal = match[field]
            const dbEmpty = dbVal == null || dbVal === '' || dbVal === 0

            if (dbEmpty) {
              // Convert value to correct type
              let typedVal: any = csvVal
              if (NUMERIC_FIELDS.has(field)) {
                typedVal = parseFloat(csvVal)
                if (isNaN(typedVal)) continue
              } else if (BOOLEAN_FIELDS.has(field)) {
                typedVal = csvVal.toLowerCase() === 'true' || csvVal === '1' || csvVal.toLowerCase() === 'yes'
              }
              fills.push({ field, value: typedVal })
            } else {
              // DB already has data — never overwrite
              skips++
            }
          }

          preview.push({
            csvName: match.name,
            match,
            fills,
            skips,
          })
        }

        setImportPreview(preview)
      },
      error: () => toast({ title: 'Failed to parse CSV', variant: 'destructive' }),
    })
  }

  async function executeImport() {
    if (!importPreview) return
    setImportRunning(true)
    let updated = 0, fieldsAdded = 0

    for (const row of importPreview) {
      if (!row.match || row.fills.length === 0) continue
      const updates: Record<string, any> = {}
      for (const fill of row.fills) {
        updates[fill.field] = fill.value
      }
      const { error } = await supabase.from('properties').update(updates).eq('id', row.match.id)
      if (!error) {
        updated++
        fieldsAdded += row.fills.length
      }
    }

    qc.invalidateQueries({ queryKey: ['/supabase/master-list'] })
    qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
    toast({ title: 'Import complete', description: `${updated} properties updated, ${fieldsAdded} fields filled in` })
    setImportPreview(null)
    setImportRunning(false)
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
            <div className="flex items-center gap-2 flex-wrap bg-muted/60 rounded-md px-2.5 py-1.5">
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
              {!confirmDelete ? (
                <Button variant="destructive" size="sm" className="h-7 text-xs gap-1" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="w-3 h-3" /> Delete
                </Button>
              ) : (
                <div className="flex items-center gap-1">
                  <Button variant="destructive" size="sm" className="h-7 text-xs" disabled={deletePending}
                    onClick={() => bulkDelete(Array.from(selected))}>
                    {deletePending ? 'Deleting…' : `Confirm Delete (${selected.size})`}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input type="search" placeholder="Search…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              data-testid="input-search-master" className="pl-8 h-7 w-48 text-xs" />
          </div>
          <Select value={stageFilter} onValueChange={v => { setStageFilter(v); setPage(1); try { localStorage.setItem('ml-stage-filter', v) } catch {} }}>
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
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = '.csv'
              input.onchange = e => {
                const file = (e.target as HTMLInputElement).files?.[0]
                if (file) handleImportFile(file)
              }
              input.click()
            }}
          >
            <Upload className="w-3 h-3" /> Import CSV
          </Button>
        </div>
      </div>

      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th className="py-2 px-3 w-8 sticky left-0 z-20 bg-muted/80 backdrop-blur">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} data-testid="checkbox-select-all" />
              </th>
              <th
                className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors group sticky left-[44px] z-20 bg-muted/80 backdrop-blur"
                onClick={() => handleSort('name')}
                aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <span className="flex items-center gap-1">
                  Name
                  {sortKey === 'name' ? (
                    sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                  )}
                </span>
              </th>
              <SortHeader label="Client" sortKey="client" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Address</th>
              <SortHeader label="Beds" sortKey="bedrooms" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Baths" sortKey="full_baths" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Sq Ft" sortKey="square_footage" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="CE" sortKey="ce_charged" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Pay" sortKey="cleaner_pay" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Profit %" sortKey="profit_percentage" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Stage" sortKey="stage" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 w-12" aria-label="Data completeness">
                <AlertCircle className="w-3 h-3" aria-hidden="true" />
                <span className="sr-only">Data completeness</span>
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
                  <td className="py-1.5 px-3 sticky left-0 z-10 bg-card">
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggleSelect(p.id)}
                      data-testid={`checkbox-${p.id}`}
                    />
                  </td>
                  <td className="py-1.5 px-3 sticky left-[44px] z-10 bg-card">
                    <button
                      onClick={() => setDetailProperty(p)}
                      className="font-medium text-primary hover:underline cursor-pointer text-left max-w-[200px] truncate"
                      title={p.name}
                      data-testid={`link-property-${p.id}`}
                    >
                      {p.name}
                    </button>
                  </td>
                  <td className="py-1.5 px-3 text-muted-foreground">{p.client || '—'}</td>
                  <td className="py-1.5 px-3 text-muted-foreground text-xs max-w-[140px] truncate" title={p.address || undefined}>{p.address || '—'}</td>
                  <td className="py-1.5 px-3 tabular-nums">{p.bedrooms ?? '—'}</td>
                  <td className="py-1.5 px-3 tabular-nums" title={p.full_baths != null ? `${p.full_baths} full${p.half_baths ? `, ${p.half_baths} half` : ''}` : undefined}>{p.full_baths != null ? (p.half_baths ? `${p.full_baths + p.half_baths * 0.5}` : `${p.full_baths}`) : '—'}</td>
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
                              backgroundColor: comp >= 90 ? '#22c55e' : comp >= 50 ? '#f59e0b' : '#ef4444'
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

      {/* Import CSV Preview Dialog */}
      <Dialog open={!!importPreview} onOpenChange={v => !v && !importRunning && setImportPreview(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Import Preview — Fill Missing Data Only</DialogTitle>
          </DialogHeader>
          {importPreview && (() => {
            const matched = importPreview.filter(r => r.match)
            const unmatched = importPreview.filter(r => !r.match)
            const withFills = matched.filter(r => r.fills.length > 0)
            const totalFills = matched.reduce((s: number, r: any) => s + r.fills.length, 0)
            const totalSkips = matched.reduce((s: number, r: any) => s + r.skips, 0)
            return (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="rounded-md border border-border p-2">
                    <p className="text-muted-foreground">Matched</p>
                    <p className="text-lg font-semibold">{matched.length}</p>
                  </div>
                  <div className="rounded-md border border-green-200 dark:border-green-800 p-2 bg-green-50/50 dark:bg-green-900/10">
                    <p className="text-green-700 dark:text-green-400">Fields to fill</p>
                    <p className="text-lg font-semibold text-green-700 dark:text-green-400">{totalFills}</p>
                  </div>
                  <div className="rounded-md border border-border p-2">
                    <p className="text-muted-foreground">Already have data (skipped)</p>
                    <p className="text-lg font-semibold">{totalSkips}</p>
                  </div>
                  <div className="rounded-md border border-border p-2">
                    <p className="text-muted-foreground">Unmatched (skipped)</p>
                    <p className="text-lg font-semibold">{unmatched.length}</p>
                  </div>
                </div>

                <div className="overflow-auto flex-1 rounded-lg border border-border mt-2">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border">
                      <tr>
                        <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Property</th>
                        <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Status</th>
                        <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Fields to Fill</th>
                        <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Skipped (has data)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {withFills.map((row: any, i: number) => (
                        <tr key={i} className="border-b border-border/30">
                          <td className="py-1.5 px-2 font-medium">{row.csvName}</td>
                          <td className="py-1.5 px-2">
                            <span className="text-green-600 dark:text-green-400 flex items-center gap-1"><Check className="w-3 h-3" /> {row.fills.length} to fill</span>
                          </td>
                          <td className="py-1.5 px-2 text-muted-foreground">
                            {row.fills.map((f: any) => f.field).join(', ')}
                          </td>
                          <td className="py-1.5 px-2 text-muted-foreground">{row.skips}</td>
                        </tr>
                      ))}
                      {matched.filter((r: any) => r.fills.length === 0).map((row: any, i: number) => (
                        <tr key={`skip-${i}`} className="border-b border-border/30 opacity-50">
                          <td className="py-1.5 px-2">{row.csvName}</td>
                          <td className="py-1.5 px-2 text-muted-foreground">No changes</td>
                          <td className="py-1.5 px-2 text-muted-foreground">—</td>
                          <td className="py-1.5 px-2 text-muted-foreground">{row.skips} kept</td>
                        </tr>
                      ))}
                      {unmatched.map((row: any, i: number) => (
                        <tr key={`unm-${i}`} className="border-b border-border/30 opacity-40">
                          <td className="py-1.5 px-2">{row.csvName}</td>
                          <td className="py-1.5 px-2 text-red-500">No match</td>
                          <td className="py-1.5 px-2" colSpan={2}>Property not found in database — skipped</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between pt-2 text-xs">
                  <p className="text-muted-foreground">
                    Only empty fields will be filled. Existing data is never changed or erased.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setImportPreview(null)} disabled={importRunning}>Cancel</Button>
                    <Button size="sm" className="gap-1.5" onClick={executeImport} disabled={importRunning || totalFills === 0}>
                      {importRunning ? 'Importing…' : `Fill ${totalFills} Fields`}
                    </Button>
                  </div>
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>
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
      { key: 'ce_charged', label: 'Client Charged', type: 'number' },
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
