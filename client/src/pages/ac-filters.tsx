import { useState, useMemo, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, logPropertyEdit } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { useAppSettings } from '@/hooks/use-app-settings'
import { InlineEdit } from '@/components/InlineEdit'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { Search, AlertTriangle, CheckCircle2, Clock, CalendarCheck, X, ArrowUpDown, ArrowUp, ArrowDown, Upload, Edit3, Wind } from 'lucide-react'
import { TablePagination } from '@/components/TablePagination'
import { EmptyState } from '@/components/EmptyState'
import Papa from 'papaparse'

function getDueStatus(nextDue: string | null, intervalDays: number): { label: string; color: string; icon: typeof CheckCircle2 } | null {
  if (!nextDue) return null
  const due = new Date(nextDue)
  const now = new Date()
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return { label: 'Overdue', color: 'text-destructive', icon: AlertTriangle }
  if (diffDays <= 14) return { label: 'Due soon', color: 'text-amber-600 dark:text-amber-400', icon: Clock }
  return { label: 'OK', color: 'text-green-600 dark:text-green-400', icon: CheckCircle2 }
}

const STATUS_OPTIONS = ['Active', 'Onboarding', 'Offboarding']

type SortKey = 'name' | 'filter_size' | 'last_filter_changed' | 'next_filter_due'
type SortDir = 'asc' | 'desc'

function SortIcon({ column, sortKey, sortDir }: { column: SortKey; sortKey: SortKey | null; sortDir: SortDir }) {
  if (sortKey !== column) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40 shrink-0" />
  return sortDir === 'asc'
    ? <ArrowUp className="w-3 h-3 ml-1 shrink-0" />
    : <ArrowDown className="w-3 h-3 ml-1 shrink-0" />
}

export default function AcFiltersPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { effectiveUser } = useAuth()
  const { getNumber } = useAppSettings()
  const intervalDays = getNumber('ac_filter_interval', 90)
  usePageTitle('AC Filters')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [justSavedId, setJustSavedId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey | null>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [bulkFilterSize, setBulkFilterSize] = useState('')
  const [csvOpen, setCsvOpen] = useState(false)
  const [csvData, setCsvData] = useState<any[]>([])
  const csvInputRef = useRef<HTMLInputElement>(null)

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc')
        return key
      }
      setSortDir('asc')
      return key
    })
    setPage(1)
  }, [])

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/ac-filters'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, stage_name, notes, filter_size, last_filter_changed, next_filter_due')
        .neq('stage_name', 'Offboarded')
      if (error) throw error
      return data || []
    },
  })

  const { mutate: updateField } = useGuardedMutation('ac-filters', {
    mutationFn: async ({ id, field, value, oldValue, propName }: { id: string; field: string; value: string; oldValue?: any; propName?: string }) => {
      const { error } = await supabase.from('properties').update({ [field]: value || null }).eq('id', id)
      if (error) throw error
      logPropertyEdit(id, field, oldValue, value, propName)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/ac-filters'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
      toast({ title: 'Saved' })
    },
    onError: (error: any) => toast({ title: 'Update failed', description: error?.message, variant: 'destructive' }),
  })

  function calcNextDue(fromDate: string): string {
    const d = new Date(fromDate)
    d.setDate(d.getDate() + intervalDays)
    return d.toISOString().slice(0, 10)
  }

  function markChangedToday(id: string) {
    if (!canEditView('ac-filters', effectiveUser)) {
      toast({ title: 'Edit access required', variant: 'destructive' })
      return
    }
    const today = new Date().toISOString().slice(0, 10)
    const nextDue = calcNextDue(today)
    const prop = properties?.find((p: any) => p.id === id)
    supabase.from('properties').update({
      last_filter_changed: today,
      next_filter_due: nextDue,
    }).eq('id', id).then(({ error }) => {
      if (error) {
        toast({ title: 'Update failed', description: error.message, variant: 'destructive' })
      } else {
        logPropertyEdit(id, 'last_filter_changed', prop?.last_filter_changed, today, prop?.name)
        logPropertyEdit(id, 'next_filter_due', prop?.next_filter_due, nextDue, prop?.name)
        qc.invalidateQueries({ queryKey: ['/supabase/ac-filters'] })
        qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
        toast({ title: 'Filter marked as changed today', description: `Next due: ${nextDue}` })
        setJustSavedId(id)
        setTimeout(() => setJustSavedId(null), 1500)
      }
    })
  }

  function toggleBulkSelect(id: string) {
    setBulkSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleBulkAll() {
    if (bulkSelected.size === paged.length) setBulkSelected(new Set())
    else setBulkSelected(new Set(paged.map((p: any) => p.id)))
  }

  async function bulkSetFilterSize() {
    if (!canEditView('ac-filters', effectiveUser)) {
      toast({ title: 'Edit access required', variant: 'destructive' })
      return
    }
    if (!bulkFilterSize.trim() || bulkSelected.size === 0) return
    const ids = Array.from(bulkSelected)
    const { error } = await supabase.from('properties').update({ filter_size: bulkFilterSize.trim() }).in('id', ids)
    if (error) { toast({ title: 'Bulk update failed', description: error.message, variant: 'destructive' }); return }
    ids.forEach(id => {
      const prop = properties?.find((p: any) => p.id === id)
      logPropertyEdit(id, 'filter_size', prop?.filter_size, bulkFilterSize.trim(), prop?.name)
    })
    qc.invalidateQueries({ queryKey: ['/supabase/ac-filters'] })
    qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
    qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
    toast({ title: `Updated filter size for ${ids.length} properties` })
    setBulkSelected(new Set())
    setBulkFilterSize('')
  }

  async function bulkMarkChangedToday() {
    if (!canEditView('ac-filters', effectiveUser)) {
      toast({ title: 'Edit access required', variant: 'destructive' })
      return
    }
    if (bulkSelected.size === 0) return
    const ids = Array.from(bulkSelected)
    const today = new Date().toISOString().slice(0, 10)
    const nextDue = calcNextDue(today)
    const { error } = await supabase.from('properties').update({ last_filter_changed: today, next_filter_due: nextDue }).in('id', ids)
    if (error) { toast({ title: 'Bulk update failed', description: error.message, variant: 'destructive' }); return }
    ids.forEach(id => {
      const prop = properties?.find((p: any) => p.id === id)
      logPropertyEdit(id, 'last_filter_changed', prop?.last_filter_changed, today, prop?.name)
      logPropertyEdit(id, 'next_filter_due', prop?.next_filter_due, nextDue, prop?.name)
    })
    qc.invalidateQueries({ queryKey: ['/supabase/ac-filters'] })
    qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
    qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
    toast({ title: `Marked ${ids.length} filters as changed today` })
    setBulkSelected(new Set())
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    Papa.parse(file, {
      header: true,
      complete: (results) => {
        setCsvData(results.data.filter((r: any) => r.Property || r.property || r.Name || r.name))
        setCsvOpen(true)
      },
      error: () => toast({ title: 'Failed to parse CSV', variant: 'destructive' }),
    })
    e.target.value = ''
  }

  async function importCsv() {
    if (!canEditView('ac-filters', effectiveUser)) {
      toast({ title: 'Edit access required', variant: 'destructive' })
      return
    }
    if (!csvData.length || !properties) return
    let updated = 0
    for (const row of csvData) {
      const name = row.Property || row.property || row.Name || row.name
      if (!name) continue
      const match = properties.find((p: any) => p.name?.toLowerCase() === name.toLowerCase())
      if (!match) continue
      const updates: Record<string, any> = {}
      const filterSize = row['Filter Size'] || row.filter_size || row.FilterSize
      const lastChanged = row['Last Changed'] || row.last_filter_changed || row.LastChanged
      if (filterSize) updates.filter_size = filterSize
      if (lastChanged) {
        updates.last_filter_changed = lastChanged
        updates.next_filter_due = calcNextDue(lastChanged)
      }
      if (Object.keys(updates).length === 0) continue
      const { error } = await supabase.from('properties').update(updates).eq('id', match.id)
      if (!error) {
        updated++
        if (filterSize) logPropertyEdit(match.id, 'filter_size', match.filter_size, filterSize, match.name)
        if (lastChanged) logPropertyEdit(match.id, 'last_filter_changed', match.last_filter_changed, lastChanged, match.name)
      }
    }
    qc.invalidateQueries({ queryKey: ['/supabase/ac-filters'] })
    qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
    toast({ title: `Imported ${updated} of ${csvData.length} rows` })
    setCsvOpen(false)
    setCsvData([])
  }

  const filtered = useMemo(() => {
    if (!properties) return []
    const base = properties.filter((p: any) => {
      const matchSearch = p.name?.toLowerCase().includes(search.toLowerCase())
      const matchStatus = statusFilter === 'all' || p.stage_name === statusFilter
      return matchSearch && matchStatus
    })
    if (!sortKey) return base
    return [...base].sort((a: any, b: any) => {
      const av = a[sortKey] ?? null
      const bv = b[sortKey] ?? null
      // Nulls always last regardless of direction
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [properties, search, statusFilter, sortKey, sortDir])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  // Summary stats from ALL properties (not filtered)
  const allOverdue = (properties || []).filter((p: any) => getDueStatus(p.next_filter_due, intervalDays)?.label === 'Overdue').length
  const allDueSoon = (properties || []).filter((p: any) => getDueStatus(p.next_filter_due, intervalDays)?.label === 'Due soon').length

  return (
    <div className="p-5 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">AC Filters</h1>
          <p className="text-sm text-muted-foreground">
            Track filter sizes and change schedules — click cells to edit
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {(allOverdue > 0 || allDueSoon > 0) && (
            <div className="flex items-center gap-2 text-xs">
              {allOverdue > 0 && (
                <span className="flex items-center gap-1 text-destructive font-medium">
                  <AlertTriangle className="w-3 h-3" /> {allOverdue} overdue
                </span>
              )}
              {allDueSoon > 0 && (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                  <Clock className="w-3 h-3" /> {allDueSoon} due soon
                </span>
              )}
            </div>
          )}
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1) }}>
            <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUS_OPTIONS.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              data-testid="input-search-filters"
              className="pl-8 pr-7 h-8 w-56 text-sm"
            />
            {search && (
              <button onClick={() => { setSearch(''); setPage(1) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {canEditView('ac-filters', effectiveUser) && (
            <>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => { setBulkMode(m => !m); setBulkSelected(new Set()) }}>
                <Edit3 className="w-3.5 h-3.5" />
                {bulkMode ? 'Exit Bulk' : 'Bulk Edit'}
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => csvInputRef.current?.click()}>
                <Upload className="w-3.5 h-3.5" />
                Import CSV
              </Button>
              <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvFile} />
            </>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {canEditView('ac-filters', effectiveUser) && bulkMode && bulkSelected.size > 0 && (
        <div className="flex items-center gap-3 p-2 bg-primary/5 border border-primary/20 rounded-lg text-xs">
          <span className="font-medium">{bulkSelected.size} selected</span>
          <div className="flex items-center gap-1.5">
            <Input
              value={bulkFilterSize}
              onChange={e => setBulkFilterSize(e.target.value)}
              placeholder="Filter size…"
              className="h-7 w-32 text-xs"
            />
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={bulkSetFilterSize} disabled={!bulkFilterSize.trim()}>
              Set Size
            </Button>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={bulkMarkChangedToday}>
            <CalendarCheck className="w-3 h-3" /> Mark Changed Today
          </Button>
        </div>
      )}

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
            <tr>
              {bulkMode && (
                <th className="py-2 px-3 w-8">
                  <Checkbox checked={bulkSelected.size === paged.length && paged.length > 0} onCheckedChange={toggleBulkAll} />
                </th>
              )}
              <th
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[150px] cursor-pointer select-none hover:text-foreground"
                aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                tabIndex={0}
                onClick={() => toggleSort('name')}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleSort('name')}
              >
                <span className="inline-flex items-center">Property <SortIcon column="name" sortKey={sortKey} sortDir={sortDir} /></span>
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Status</th>
              <th
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground"
                aria-sort={sortKey === 'filter_size' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                tabIndex={0}
                onClick={() => toggleSort('filter_size')}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleSort('filter_size')}
              >
                <span className="inline-flex items-center">Filter Size <SortIcon column="filter_size" sortKey={sortKey} sortDir={sortDir} /></span>
              </th>
              <th
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground"
                aria-sort={sortKey === 'last_filter_changed' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                tabIndex={0}
                onClick={() => toggleSort('last_filter_changed')}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleSort('last_filter_changed')}
              >
                <span className="inline-flex items-center">Last Changed <SortIcon column="last_filter_changed" sortKey={sortKey} sortDir={sortDir} /></span>
              </th>
              <th
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground"
                aria-sort={sortKey === 'next_filter_due' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                tabIndex={0}
                onClick={() => toggleSort('next_filter_due')}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleSort('next_filter_due')}
              >
                <span className="inline-flex items-center">Next Due <SortIcon column="next_filter_due" sortKey={sortKey} sortDir={sortDir} /></span>
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 w-8">Due</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Notes</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(8)].map((_, j) => (
                    <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12">
                  <EmptyState icon={Wind} title="No properties found" description="No properties match your current filters." />
                </td>
              </tr>
            ) : (
              paged.map((p: any) => {
                const dueStatus = getDueStatus(p.next_filter_due, intervalDays)
                const rowClass = dueStatus?.label === 'Overdue'
                  ? 'bg-red-100 dark:bg-red-900/20'
                  : dueStatus?.label === 'Due soon'
                  ? 'bg-amber-50/50 dark:bg-amber-900/10'
                  : ''
                const justSaved = justSavedId === p.id
                return (
                  <tr key={p.id} data-testid={`row-filter-${p.id}`} data-just-saved={justSaved || undefined} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${rowClass} ${justSaved ? 'animate-pulse bg-green-100 dark:bg-green-900/30' : ''}`}>
                    {bulkMode && (
                      <td className="py-2 px-3">
                        <Checkbox checked={bulkSelected.has(p.id)} onCheckedChange={() => toggleBulkSelect(p.id)} />
                      </td>
                    )}
                    <td className="py-2 px-3 font-medium text-xs max-w-[200px] truncate" title={p.name}>{p.name}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">{p.stage_name || '—'}</td>
                    <td className="py-2 px-3">
                      <InlineEdit
                        value={p.filter_size}
                        type="text"
                        onSave={v => updateField({ id: p.id, field: 'filter_size', value: v, oldValue: p.filter_size, propName: p.name })}
                        testId={`inline-filter-size-${p.id}`}
                        placeholder="Add size…"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <InlineEdit
                        value={p.last_filter_changed ? p.last_filter_changed.slice(0, 10) : ''}
                        type="date"
                        onSave={v => {
                          updateField({ id: p.id, field: 'last_filter_changed', value: v, oldValue: p.last_filter_changed, propName: p.name })
                          if (v) {
                            updateField({ id: p.id, field: 'next_filter_due', value: calcNextDue(v), oldValue: p.next_filter_due, propName: p.name })
                          }
                        }}
                        testId={`inline-last-changed-${p.id}`}
                      />
                    </td>
                    <td className="py-2 px-3">
                      <InlineEdit
                        value={p.next_filter_due ? p.next_filter_due.slice(0, 10) : ''}
                        type="date"
                        onSave={v => updateField({ id: p.id, field: 'next_filter_due', value: v, oldValue: p.next_filter_due, propName: p.name })}
                        testId={`inline-next-due-${p.id}`}
                      />
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1.5">
                        {dueStatus && (
                          <dueStatus.icon className={`w-4 h-4 ${dueStatus.color}`} aria-label={dueStatus.label} />
                        )}
                        {dueStatus?.label === 'Overdue' && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">OVERDUE</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <InlineEdit
                        value={p.notes}
                        type="text"
                        onSave={v => updateField({ id: p.id, field: 'notes', value: v, oldValue: p.notes, propName: p.name })}
                        testId={`inline-notes-${p.id}`}
                        placeholder="Add notes…"
                        className="w-full min-w-[150px]"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs gap-1 px-2"
                        onClick={() => markChangedToday(p.id)}
                        data-testid={`button-mark-changed-${p.id}`}
                        title="Mark filter changed today and set next due date"
                      >
                        <CalendarCheck className="w-3 h-3" />
                        Today
                      </Button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      {/* CSV Import Dialog */}
      <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Import AC Filter Data</DialogTitle></DialogHeader>
          <div className="text-xs text-muted-foreground space-y-2">
            <p>Found {csvData.length} rows. Columns: Property, Filter Size, Last Changed</p>
            <p>Matching is by exact property name. Unmatched rows will be skipped.</p>
            {csvData.length > 0 && (
              <div className="max-h-40 overflow-auto border rounded p-2 space-y-1">
                {csvData.slice(0, 10).map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="font-medium">{row.Property || row.property || row.Name || row.name}</span>
                    <span className="text-muted-foreground">—</span>
                    <span>{row['Filter Size'] || row.filter_size || '—'}</span>
                  </div>
                ))}
                {csvData.length > 10 && <p className="text-muted-foreground">…and {csvData.length - 10} more</p>}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCsvOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={importCsv}>Import {csvData.length} Rows</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
