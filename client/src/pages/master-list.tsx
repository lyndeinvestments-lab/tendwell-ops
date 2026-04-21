import { useState, useMemo, useEffect, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { useAuth, canAccessView } from '@/lib/auth'
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
import { profitColorClass } from '@/lib/profit-colors'
import { useAppSettings } from '@/hooks/use-app-settings'

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
      className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors group"
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
  const { effectiveUser } = useAuth()
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
    try { return localStorage.getItem('ml-stage-filter') || 'operational' } catch { return 'operational' }
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
      const toStage = stages?.find((s: any) => s.id === stageId)
      const { executeStageTransition } = await import('@/lib/stage-transition')
      for (const id of ids) {
        const prop = properties?.find((p: any) => String(p.id) === String(id))
        const fromStage = stages?.find((s: any) => s.id === prop?.stage_id)
        const result = await executeStageTransition({
          propertyId: Number(id),
          propertyName: prop?.name || '',
          fromStageId: Number(fromStage?.id),
          fromStageName: fromStage?.name || '',
          toStageId: Number(stageId),
          toStageName: toStage?.name || '',
          changedBy: effectiveUser?.label || 'unknown',
        })
        if (!result.ok) throw new Error(result.error)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/master-list'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
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
    onError: (e: any) => toast({ title: 'Save failed', description: e?.message || 'Unknown error', variant: 'destructive' }),
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
      const stageName = p.pipeline_stages?.name
      const matchStage = stageFilter === 'all' ? true
        : stageFilter === 'operational' ? ['Onboarding', 'Active', 'Offboarding'].includes(stageName)
        : stageName === stageFilter
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

  // ── CSV Import ──
  type ImportChangeKind = 'fill' | 'overwrite'
  type ImportChange = { field: string; oldValue: any; newValue: any; kind: ImportChangeKind }
  type ImportPreviewRow = {
    rowIdx: number
    csvName: string
    match: any | null
    changes: ImportChange[]
    invalidFields: string[]
  }

  const [importPreview, setImportPreview] = useState<ImportPreviewRow[] | null>(null)
  const [importRunning, setImportRunning] = useState(false)
  const [overwriteMode, setOverwriteMode] = useState(false)
  const [excludedChanges, setExcludedChanges] = useState<Set<string>>(new Set())
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())

  // Strict numeric parse: rejects garbage that would silently corrupt calculations.
  // Strips $ £ € ¥ % , whitespace; requires remainder to be a well-formed number.
  function parseNumericCell(raw: string): number | null {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const cleaned = trimmed.replace(/[$£€¥%,\s]/g, '')
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
    const n = parseFloat(cleaned)
    return isFinite(n) ? n : null
  }

  function parseBooleanCell(raw: string): boolean | null {
    const v = raw.trim().toLowerCase()
    if (['true', 'yes', '1', 'y', 't'].includes(v)) return true
    if (['false', 'no', '0', 'n', 'f'].includes(v)) return false
    return null
  }

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

        const hasId = csvHeaders.some(h => h.toLowerCase().trim() === 'id')
        const nameCol = csvHeaders.find(h => h.toLowerCase().trim() === 'name')

        const preview: ImportPreviewRow[] = []

        csvRows.forEach((csvRow, rowIdx) => {
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
            preview.push({ rowIdx, csvName: csvName || csvId || '(no name)', match: null, changes: [], invalidFields: [] })
            return
          }

          const changes: ImportChange[] = []
          const invalidFields: string[] = []

          for (const csvCol of csvHeaders) {
            const field = csvCol.toLowerCase().trim()
            if (!IMPORTABLE_FIELDS.has(field)) continue
            const csvVal = (csvRow[csvCol] || '').trim()
            if (!csvVal) continue // empty CSV cell never erases DB data

            let typedVal: any = csvVal
            if (NUMERIC_FIELDS.has(field)) {
              const n = parseNumericCell(csvVal)
              if (n == null) { invalidFields.push(field); continue }
              typedVal = n
            } else if (BOOLEAN_FIELDS.has(field)) {
              const b = parseBooleanCell(csvVal)
              if (b == null) { invalidFields.push(field); continue }
              typedVal = b
            }

            const dbVal = match[field]
            const dbEmpty = dbVal == null || dbVal === '' || dbVal === 0

            // Skip no-op writes (identical value after type coercion)
            if (String(dbVal ?? '') === String(typedVal)) continue

            changes.push({
              field,
              oldValue: dbVal,
              newValue: typedVal,
              kind: dbEmpty ? 'fill' : 'overwrite',
            })
          }

          preview.push({ rowIdx, csvName: match.name, match, changes, invalidFields })
        })

        setImportPreview(preview)
        setExcludedChanges(new Set())
        setExpandedRows(new Set())
      },
      error: () => toast({ title: 'Failed to parse CSV', variant: 'destructive' }),
    })
  }

  async function executeImport() {
    if (!importPreview) return
    setImportRunning(true)
    let updated = 0, fieldsApplied = 0

    for (const row of importPreview) {
      if (!row.match) continue
      if (excludedChanges.has(`row:${row.rowIdx}`)) continue

      const activeChanges = row.changes.filter(c => {
        if (c.kind === 'overwrite' && !overwriteMode) return false
        if (excludedChanges.has(`${row.rowIdx}:${c.field}`)) return false
        return true
      })
      if (activeChanges.length === 0) continue

      const updates: Record<string, any> = {}
      for (const c of activeChanges) updates[c.field] = c.newValue

      const { error } = await supabase.from('properties').update(updates).eq('id', row.match.id)
      if (!error) {
        updated++
        fieldsApplied += activeChanges.length
      }
    }

    qc.invalidateQueries({ queryKey: ['/supabase/master-list'] })
    qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
    toast({ title: 'Import complete', description: `${updated} properties updated, ${fieldsApplied} fields changed` })
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
              data-testid="input-search-master" className="pl-8 h-8 w-full sm:w-56 text-sm" />
          </div>
          <Select value={stageFilter} onValueChange={v => { setStageFilter(v); setPage(1); try { localStorage.setItem('ml-stage-filter', v) } catch {} }}>
            <SelectTrigger data-testid="select-stage-filter" className="h-8 w-36 text-xs">
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="operational">Operational</SelectItem>
              <SelectItem value="all">All Stages</SelectItem>
              {stages?.map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={exportCSV} data-testid="button-export-csv">
            <Download className="w-3 h-3" /> Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
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
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
            <tr>
              <th className="py-2 px-3 w-8 sticky left-0 top-0 z-30 bg-muted">
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
                      <span className={`font-medium ${profitColorClass(p.profit_percentage)}`}>
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
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Import Preview</DialogTitle>
          </DialogHeader>
          {importPreview && (() => {
            const matched = importPreview.filter(r => r.match)
            const unmatched = importPreview.filter(r => !r.match)

            const isActive = (row: ImportPreviewRow, c: ImportChange): boolean => {
              if (c.kind === 'overwrite' && !overwriteMode) return false
              if (excludedChanges.has(`row:${row.rowIdx}`)) return false
              if (excludedChanges.has(`${row.rowIdx}:${c.field}`)) return false
              return true
            }

            const totalFills = matched.reduce((s, r) => s + r.changes.filter(c => c.kind === 'fill').length, 0)
            const totalOverwrites = matched.reduce((s, r) => s + r.changes.filter(c => c.kind === 'overwrite').length, 0)
            const totalInvalid = matched.reduce((s, r) => s + r.invalidFields.length, 0)
            const totalActive = matched.reduce(
              (s, r) => s + r.changes.filter(c => isActive(r, c)).length,
              0,
            )

            const toggleRow = (rowIdx: number) => {
              setExcludedChanges(prev => {
                const next = new Set(prev)
                const key = `row:${rowIdx}`
                if (next.has(key)) next.delete(key); else next.add(key)
                return next
              })
            }
            const toggleField = (rowIdx: number, field: string) => {
              setExcludedChanges(prev => {
                const next = new Set(prev)
                const key = `${rowIdx}:${field}`
                if (next.has(key)) next.delete(key); else next.add(key)
                return next
              })
            }
            const toggleExpand = (rowIdx: number) => {
              setExpandedRows(prev => {
                const next = new Set(prev)
                if (next.has(rowIdx)) next.delete(rowIdx); else next.add(rowIdx)
                return next
              })
            }
            const fmtVal = (v: any): string => {
              if (v == null || v === '') return '(empty)'
              if (typeof v === 'boolean') return v ? 'true' : 'false'
              return String(v)
            }

            return (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="rounded-md border border-border p-2">
                    <p className="text-muted-foreground">Matched</p>
                    <p className="text-lg font-semibold">{matched.length}</p>
                  </div>
                  <div className="rounded-md border border-green-200 dark:border-green-800 p-2 bg-green-50/50 dark:bg-green-900/10">
                    <p className="text-green-700 dark:text-green-400">Fills (empty → filled)</p>
                    <p className="text-lg font-semibold text-green-700 dark:text-green-400">{totalFills}</p>
                  </div>
                  <div className={`rounded-md border p-2 ${overwriteMode ? 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10' : 'border-border'}`}>
                    <p className={overwriteMode ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}>
                      Overwrites {overwriteMode ? '' : '(disabled)'}
                    </p>
                    <p className={`text-lg font-semibold ${overwriteMode ? 'text-amber-700 dark:text-amber-400' : ''}`}>{totalOverwrites}</p>
                  </div>
                  <div className="rounded-md border border-border p-2">
                    <p className="text-muted-foreground">Unmatched / invalid</p>
                    <p className="text-lg font-semibold">{unmatched.length + totalInvalid}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Checkbox
                    id="ml-overwrite-toggle"
                    checked={overwriteMode}
                    onCheckedChange={v => setOverwriteMode(!!v)}
                  />
                  <Label htmlFor="ml-overwrite-toggle" className="text-xs cursor-pointer">
                    Allow overwriting existing data
                  </Label>
                  {overwriteMode && totalOverwrites > 0 && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      {totalOverwrites} existing value{totalOverwrites === 1 ? '' : 's'} will be replaced — review each row.
                    </span>
                  )}
                </div>

                <div className="overflow-auto flex-1 rounded-lg border border-border mt-2">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border">
                      <tr>
                        <th className="w-8 py-1.5 px-2"></th>
                        <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Property</th>
                        <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Changes</th>
                        <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Fields</th>
                        <th className="w-20 py-1.5 px-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {matched.map(row => {
                        const rowExcluded = excludedChanges.has(`row:${row.rowIdx}`)
                        const visibleChanges = row.changes.filter(c => c.kind === 'fill' || overwriteMode)
                        const activeCount = row.changes.filter(c => isActive(row, c)).length
                        const hiddenOverwrites = row.changes.filter(c => c.kind === 'overwrite').length
                        const expanded = expandedRows.has(row.rowIdx)

                        if (visibleChanges.length === 0 && row.invalidFields.length === 0) {
                          return (
                            <tr key={row.rowIdx} className="border-b border-border/30 opacity-40">
                              <td></td>
                              <td className="py-1.5 px-2">{row.csvName}</td>
                              <td className="py-1.5 px-2 text-muted-foreground" colSpan={3}>
                                {hiddenOverwrites > 0
                                  ? `${hiddenOverwrites} potential overwrite${hiddenOverwrites === 1 ? '' : 's'} — enable overwrite toggle to review`
                                  : 'No changes'}
                              </td>
                            </tr>
                          )
                        }

                        return (
                          <Fragment key={row.rowIdx}>
                            <tr className={`border-b border-border/30 ${rowExcluded ? 'opacity-40' : ''}`}>
                              <td className="py-1.5 px-2">
                                <Checkbox
                                  checked={!rowExcluded && visibleChanges.length > 0}
                                  onCheckedChange={() => toggleRow(row.rowIdx)}
                                  disabled={visibleChanges.length === 0}
                                />
                              </td>
                              <td className="py-1.5 px-2 font-medium">{row.csvName}</td>
                              <td className="py-1.5 px-2">
                                <span className="inline-flex items-center gap-2">
                                  {activeCount > 0 ? (
                                    <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                                      <Check className="w-3 h-3" /> {activeCount} to apply
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">0 to apply</span>
                                  )}
                                  {row.invalidFields.length > 0 && (
                                    <span className="text-red-500 flex items-center gap-1">
                                      <AlertCircle className="w-3 h-3" /> {row.invalidFields.length} invalid
                                    </span>
                                  )}
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-muted-foreground truncate max-w-[280px]">
                                {visibleChanges.length > 0 ? visibleChanges.map(c => c.field).join(', ') : '—'}
                              </td>
                              <td className="py-1.5 px-2 text-right">
                                {(visibleChanges.length > 0 || row.invalidFields.length > 0) && (
                                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => toggleExpand(row.rowIdx)}>
                                    {expanded ? 'Hide' : 'Details'}
                                  </Button>
                                )}
                              </td>
                            </tr>
                            {expanded && (
                              <tr className="bg-muted/30">
                                <td colSpan={5} className="py-2 px-4">
                                  <div className="space-y-1">
                                    {visibleChanges.map(c => {
                                      const fieldExcluded = rowExcluded || excludedChanges.has(`${row.rowIdx}:${c.field}`)
                                      return (
                                        <div key={c.field} className={`flex items-center gap-2 text-xs ${fieldExcluded ? 'opacity-40' : ''}`}>
                                          <Checkbox
                                            checked={!fieldExcluded}
                                            onCheckedChange={() => toggleField(row.rowIdx, c.field)}
                                            disabled={rowExcluded}
                                          />
                                          <span className="font-mono font-medium w-36 truncate">{c.field}</span>
                                          <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${c.kind === 'fill' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                                            {c.kind}
                                          </span>
                                          <span className="text-muted-foreground font-mono truncate">
                                            {c.kind === 'overwrite' ? (
                                              <>
                                                <span>{fmtVal(c.oldValue)}</span>
                                                <span className="mx-1">→</span>
                                                <span className="text-foreground">{fmtVal(c.newValue)}</span>
                                              </>
                                            ) : (
                                              <span className="text-foreground">{fmtVal(c.newValue)}</span>
                                            )}
                                          </span>
                                        </div>
                                      )
                                    })}
                                    {row.invalidFields.length > 0 && (
                                      <div className="text-xs text-red-500 pt-1 flex items-start gap-1">
                                        <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                                        <span>
                                          Rejected (won't be written): <span className="font-mono">{row.invalidFields.join(', ')}</span>
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                      {unmatched.map((row, i) => (
                        <tr key={`unm-${i}`} className="border-b border-border/30 opacity-40">
                          <td></td>
                          <td className="py-1.5 px-2">{row.csvName}</td>
                          <td className="py-1.5 px-2 text-red-500" colSpan={3}>No match in database — skipped</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between pt-2 text-xs">
                  <p className="text-muted-foreground">
                    Empty CSV cells never erase data. Invalid numeric/boolean values are rejected. Computed fields (profit_percentage, stage, name, id) are never touched.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setImportPreview(null)} disabled={importRunning}>Cancel</Button>
                    <Button size="sm" className="gap-1.5" onClick={executeImport} disabled={importRunning || totalActive === 0}>
                      {importRunning ? 'Importing…' : `Apply ${totalActive} Change${totalActive === 1 ? '' : 's'}`}
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
  const { effectiveUser } = useAuth()
  const canViewFinancials = canAccessView('cost-tracking', effectiveUser) || canAccessView('financial-dashboard', effectiveUser)
  const canViewAccess = canAccessView('access-codes', effectiveUser)

  const { getNumber } = useAppSettings()
  const breakEvenMargin = getNumber('break_even_target_margin', 0.20)

  const propId = property?.id
  useEffect(() => {
    if (property) {
      setForm({
        name: property.name || '',
        client: property.client || '',
        address: property.address || '',
        // Property details
        bedrooms: property.bedrooms ?? '',
        full_baths: property.full_baths ?? '',
        half_baths: property.half_baths ?? '',
        square_footage: property.square_footage ?? '',
        number_of_beds: property.number_of_beds ?? '',
        guest_count: property.guest_count ?? '',
        kitchens: property.kitchens ?? '',
        hot_tub: property.hot_tub ?? false,
        pet_friendly: property.pet_friendly || '',
        // Bed sizes (for linens)
        king_beds: property.king_beds ?? '',
        queen_beds: property.queen_beds ?? '',
        full_beds: property.full_beds ?? '',
        twin_beds: property.twin_beds ?? '',
        // Financial
        ce_charged: property.ce_charged ?? '',
        cleaner_pay: property.cleaner_pay ?? '',
        // Access & Wi-Fi
        auto_code: property.auto_code || '',
        door_code: property.door_code || '',
        other_codes: property.other_codes || '',
        wifi_info: property.wifi_info || '',
        // Linen towels
        bath_towels: property.bath_towels ?? '',
        washcloths: property.washcloths ?? '',
        hand_towels: property.hand_towels ?? '',
        bathmats: property.bathmats ?? '',
        pool_towels: property.pool_towels ?? '',
        // Operations
        cleaning_frequency: property.cleaning_frequency || '',
        filter_size: property.filter_size || '',
        notes: property.notes || '',
        linen_notes: property.linen_notes || '',
        stage_id: property.stage_id,
      })
    }
  }, [propId])

  function updateForm(key: string, value: any) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const NUMBER_FIELDS = new Set([
    'bedrooms', 'full_baths', 'half_baths', 'square_footage', 'number_of_beds',
    'guest_count', 'kitchens', 'king_beds', 'queen_beds', 'full_beds', 'twin_beds',
    'bath_towels', 'washcloths', 'hand_towels', 'bathmats', 'pool_towels',
    'ce_charged', 'cleaner_pay',
  ])

  function handleSave() {
    const updates: Record<string, any> = {}
    for (const [key, val] of Object.entries(form)) {
      if (key === 'hot_tub') {
        updates[key] = val
      } else if (key === 'stage_id') {
        updates[key] = val ? parseInt(val) : null
      } else if (NUMBER_FIELDS.has(key)) {
        updates[key] = val === '' ? null : parseFloat(val)
      } else {
        updates[key] = val || null
      }
    }
    onSave(updates)
  }

  if (!property) return null

  const stageColor = property.pipeline_stages?.color || '#6b7280'

  const SECTIONS = [
    { title: 'Basic Info', fields: [
      { key: 'name', label: 'Property Name', type: 'text' },
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'address', label: 'Address', type: 'text' },
    ]},
    { title: 'Property Details', fields: [
      { key: 'bedrooms', label: 'Bedrooms', type: 'number' },
      { key: 'full_baths', label: 'Full Baths', type: 'number' },
      { key: 'half_baths', label: 'Half Baths', type: 'number' },
      { key: 'square_footage', label: 'Square Footage', type: 'number' },
      { key: 'number_of_beds', label: 'Total Beds', type: 'number' },
      { key: 'guest_count', label: 'Max Guests', type: 'number' },
      { key: 'kitchens', label: 'Kitchens', type: 'number' },
      { key: 'hot_tub', label: 'Hot Tub', type: 'boolean' },
      { key: 'pet_friendly', label: 'Pet Friendly', type: 'text' },
    ]},
    { title: 'Bed Sizes', fields: [
      { key: 'king_beds', label: 'King', type: 'number' },
      { key: 'queen_beds', label: 'Queen', type: 'number' },
      { key: 'full_beds', label: 'Full', type: 'number' },
      { key: 'twin_beds', label: 'Twin', type: 'number' },
    ]},
    { title: 'Linen Counts', fields: [
      { key: 'bath_towels', label: 'Bath Towels', type: 'number' },
      { key: 'washcloths', label: 'Washcloths', type: 'number' },
      { key: 'hand_towels', label: 'Hand Towels', type: 'number' },
      { key: 'bathmats', label: 'Bathmats', type: 'number' },
      { key: 'pool_towels', label: 'Pool Towels', type: 'number' },
      { key: 'linen_notes', label: 'Linen Notes', type: 'textarea' },
    ]},
    { title: 'Financial', fields: [
      { key: 'ce_charged', label: 'Client Charged ($)', type: 'number', step: '0.01' },
      { key: 'cleaner_pay', label: 'Cleaner Pay ($)', type: 'number', step: '0.01' },
    ]},
    { title: 'Access & Wi-Fi', fields: [
      { key: 'auto_code', label: 'Auto Code', type: 'text' },
      { key: 'door_code', label: 'Door Code', type: 'text' },
      { key: 'other_codes', label: 'Other Codes', type: 'text' },
      { key: 'wifi_info', label: 'Wi-Fi Info', type: 'textarea' },
    ]},
    { title: 'Operations', fields: [
      { key: 'cleaning_frequency', label: 'Cleaning Freq', type: 'select', options: ['weekly', 'biweekly', 'monthly', 'as_needed'] },
      { key: 'filter_size', label: 'AC Filter Size', type: 'text' },
      { key: 'notes', label: 'Special Notes', type: 'textarea' },
    ]},
  ]

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:w-[480px] overflow-y-auto" data-testid="property-detail-panel">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-base flex items-center gap-2">
            {property.name}
            <Badge style={{ backgroundColor: stageColor + '20', color: stageColor, border: `1px solid ${stageColor}40` }} className="text-xs">
              {property.pipeline_stages?.name}
            </Badge>
          </SheetTitle>
        </SheetHeader>

        {/* Financial summary — only for users with financial access */}
        {canViewFinancials && <div className="grid grid-cols-3 gap-3 bg-muted/50 rounded-md p-3 mb-4">
          <div>
            <span className="text-xs text-muted-foreground block">Client Charged</span>
            <span className="text-sm font-medium">${(property.ce_charged || 0).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Cleaner Pay</span>
            <span className="text-sm font-medium">${(property.cleaner_pay || 0).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Total Cost</span>
            <span className="text-sm font-medium">${(property.total_estimated_cost || 0).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Laundry</span>
            <span className="text-sm font-medium">${(property.est_laundry || 0).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Consumables</span>
            <span className="text-sm font-medium">${(property.est_consumables || 0).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Profit / Clean</span>
            <span className={`text-sm font-medium ${(property.estimated_profit || 0) < 0 ? 'text-destructive' : ''}`}>
              ${(property.estimated_profit || 0).toFixed(2)}
            </span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Profit %</span>
            <span className={`text-sm font-medium ${profitColorClass(property.profit_percentage)}`}>{(property.profit_percentage || 0).toFixed(1)}%</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Break-Even CE</span>
            <span className="text-sm font-medium">
              {property.total_estimated_cost ? `$${(property.total_estimated_cost / (1 - breakEvenMargin)).toFixed(2)}` : '—'}
            </span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">DC Cost</span>
            <span className="text-sm font-medium">{property.estimated_deep_clean_cost != null ? `$${Number(property.estimated_deep_clean_cost).toFixed(2)}` : '—'}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">DC Income (3x)</span>
            <span className="text-sm font-medium">{property.deep_clean_3x_ce != null ? `$${Number(property.deep_clean_3x_ce).toFixed(2)}` : '—'}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">DC Profit</span>
            <span className={`text-sm font-medium ${(property.profit_deep_clean || 0) < 0 ? 'text-destructive' : ''}`}>
              {property.profit_deep_clean != null ? `$${Number(property.profit_deep_clean).toFixed(2)}` : '—'}
            </span>
          </div>
        </div>}

        {/* Editable fields by section */}
        <div className="space-y-5">
          {SECTIONS.filter(section => {
            if (section.title === 'Financial' && !canViewFinancials) return false
            if (section.title === 'Access & Wi-Fi' && !canViewAccess) return false
            return true
          }).map(section => (
            <div key={section.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{section.title}</h3>
              <div className="space-y-2.5">
                {section.fields.map((field: any) => (
                  <div key={field.key} className="grid grid-cols-[120px_1fr] items-center gap-2">
                    <Label className="text-xs text-muted-foreground">{field.label}</Label>
                    {field.type === 'boolean' ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => updateForm(field.key, false)}
                          className={`flex-1 h-7 rounded-md border text-xs transition-colors ${!form[field.key] ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-muted-foreground'}`}
                        >No</button>
                        <button
                          type="button"
                          onClick={() => updateForm(field.key, true)}
                          className={`flex-1 h-7 rounded-md border text-xs transition-colors ${form[field.key] ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-muted-foreground'}`}
                        >Yes</button>
                      </div>
                    ) : field.type === 'select' ? (
                      <Select value={form[field.key] || ''} onValueChange={v => updateForm(field.key, v)}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {field.options?.map((o: string) => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        value={form[field.key] ?? ''}
                        onChange={e => updateForm(field.key, e.target.value)}
                        className="w-full h-16 rounded-md border border-input bg-background px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    ) : (
                      <Input
                        type={field.type}
                        value={form[field.key] ?? ''}
                        onChange={e => updateForm(field.key, e.target.value)}
                        className="h-7 text-xs"
                        step={field.step || (field.type === 'number' ? '1' : undefined)}
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
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
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
