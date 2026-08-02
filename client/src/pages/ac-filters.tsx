import { useState, useMemo, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, logPropertyEdit } from '@/lib/supabase'
import { invalidateAllPropertyQueries } from '@/lib/query-invalidations'
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
import { Search, AlertTriangle, CheckCircle2, Clock, CalendarCheck, X, ArrowUpDown, ArrowUp, ArrowDown, Upload, Edit3, Wind, Ruler } from 'lucide-react'
import { TablePagination } from '@/components/TablePagination'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import Papa from 'papaparse'

/** `'Due soon'` → `'due_soon'`; used to look up the `status.*`/`common.stage.*` dictionary keys for display. */
function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function getDueStatus(nextDue: string | null, intervalDays: number): { label: string; color: string; icon: typeof CheckCircle2 } | null {
  if (!nextDue) return null
  const due = new Date(nextDue)
  const now = new Date()
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return { label: 'Overdue', color: 'text-destructive', icon: AlertTriangle }
  if (diffDays <= 14) return { label: 'Due soon', color: 'text-warning', icon: Clock }
  return { label: 'OK', color: 'text-success', icon: CheckCircle2 }
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
  const { t } = useLocale('acFilters')
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
  const [savingId, setSavingId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey | null>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [bulkFilterSize, setBulkFilterSize] = useState('')
  const [csvOpen, setCsvOpen] = useState(false)
  const [csvData, setCsvData] = useState<any[]>([])
  const csvInputRef = useRef<HTMLInputElement>(null)

  const toggleSort = useCallback((key: SortKey) => {
    // Don't mutate one piece of state from inside another's updater — React
    // may double-invoke updaters (Strict Mode) and the writes can race.
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setPage(1)
  }, [sortKey])

  const { data: properties, isLoading, isError, refetch } = useQuery({
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
      // properties.id is bigint at the DB; the handler receives a string-typed
      // id from React keys / Set<string>, so coerce at the query boundary.
      const { error } = await supabase.from('properties').update({ [field]: value || null }).eq('id', Number(id))
      if (error) throw error
      logPropertyEdit(id, field, oldValue, value, propName)
    },
    onSuccess: () => {
      invalidateAllPropertyQueries(qc)
      qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
      toast({ title: t('toasts.saved') })
    },
    onError: (error: any) => toast({ title: t('toasts.updateFailed'), description: error?.message, variant: 'destructive' }),
  })

  function calcNextDue(fromDate: string): string {
    const d = new Date(fromDate)
    d.setDate(d.getDate() + intervalDays)
    return d.toISOString().slice(0, 10)
  }

  async function markChangedToday(id: string) {
    if (!canEditView('ac-filters', effectiveUser)) {
      toast({ title: t('toasts.editAccessRequired'), variant: 'destructive' })
      return
    }
    // Guard against duplicate submissions: on a slow connection (common for
    // field staff on-site) the row doesn't visibly change until the refetch
    // completes, which reads as "didn't save" and invites repeated taps —
    // each one a redundant write. A disabled button with a spinner makes the
    // in-flight state visible instead.
    if (savingId === id) return
    setSavingId(id)
    const today = new Date().toISOString().slice(0, 10)
    const nextDue = calcNextDue(today)
    const prop = properties?.find((p: any) => p.id === id)
    const { error } = await supabase.from('properties').update({
      last_filter_changed: today,
      next_filter_due: nextDue,
    }).eq('id', Number(id))
    setSavingId(null)
    if (error) {
      toast({ title: t('toasts.updateFailed'), description: error.message, variant: 'destructive' })
    } else {
      logPropertyEdit(id, 'last_filter_changed', prop?.last_filter_changed, today, prop?.name)
      logPropertyEdit(id, 'next_filter_due', prop?.next_filter_due, nextDue, prop?.name)
      invalidateAllPropertyQueries(qc)
      qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
      toast({ title: t('toasts.filterMarkedChanged'), description: t('toasts.nextDueDescription', { date: nextDue }) })
      setJustSavedId(id)
      setTimeout(() => setJustSavedId(null), 1500)
    }
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
      toast({ title: t('toasts.editAccessRequired'), variant: 'destructive' })
      return
    }
    if (!bulkFilterSize.trim() || bulkSelected.size === 0) return
    const ids = Array.from(bulkSelected)
    const { error } = await supabase.from('properties').update({ filter_size: bulkFilterSize.trim() }).in('id', ids.map(Number))
    if (error) { toast({ title: t('toasts.bulkUpdateFailed'), description: error.message, variant: 'destructive' }); return }
    ids.forEach(id => {
      const prop = properties?.find((p: any) => p.id === id)
      logPropertyEdit(id, 'filter_size', prop?.filter_size, bulkFilterSize.trim(), prop?.name)
    })
    invalidateAllPropertyQueries(qc)
    qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
    qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
    toast({ title: t('toasts.filterSizeUpdated', { count: ids.length }) })
    setBulkSelected(new Set())
    setBulkFilterSize('')
  }

  async function bulkMarkChangedToday() {
    if (!canEditView('ac-filters', effectiveUser)) {
      toast({ title: t('toasts.editAccessRequired'), variant: 'destructive' })
      return
    }
    if (bulkSelected.size === 0) return
    const ids = Array.from(bulkSelected)
    const today = new Date().toISOString().slice(0, 10)
    const nextDue = calcNextDue(today)
    const { error } = await supabase.from('properties').update({ last_filter_changed: today, next_filter_due: nextDue }).in('id', ids.map(Number))
    if (error) { toast({ title: t('toasts.bulkUpdateFailed'), description: error.message, variant: 'destructive' }); return }
    ids.forEach(id => {
      const prop = properties?.find((p: any) => p.id === id)
      logPropertyEdit(id, 'last_filter_changed', prop?.last_filter_changed, today, prop?.name)
      logPropertyEdit(id, 'next_filter_due', prop?.next_filter_due, nextDue, prop?.name)
    })
    invalidateAllPropertyQueries(qc)
    qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
    qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
    toast({ title: t('toasts.bulkMarkedChanged', { count: ids.length }) })
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
      error: () => toast({ title: t('toasts.csvParseFailed'), variant: 'destructive' }),
    })
    e.target.value = ''
  }

  async function importCsv() {
    if (!canEditView('ac-filters', effectiveUser)) {
      toast({ title: t('toasts.editAccessRequired'), variant: 'destructive' })
      return
    }
    if (!csvData.length || !properties) return
    let updated = 0
    for (const row of csvData) {
      const name = row.Property || row.property || row.Name || row.name
      if (!name) continue
      const match = properties.find((p: any) => p.name?.toLowerCase() === name.toLowerCase())
      if (!match || match.id == null) continue
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
    invalidateAllPropertyQueries(qc)
    qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
    toast({ title: t('toasts.csvImported', { updated, total: csvData.length }) })
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
  const allMissingSize = (properties || []).filter((p: any) => !p.filter_size || String(p.filter_size).trim() === '').length

  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <>
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1) }}>
              <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('page.allStatuses')}</SelectItem>
                {STATUS_OPTIONS.map(s => (
                  <SelectItem key={s} value={s}>{t(`common.stage.${slugify(s)}`, undefined, s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t('page.searchPlaceholder')}
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
                  {bulkMode ? t('page.exitBulk') : t('page.bulkEdit')}
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => csvInputRef.current?.click()}>
                  <Upload className="w-3.5 h-3.5" />
                  {t('page.importCsv')}
                </Button>
                <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvFile} />
              </>
            )}
          </>
        }
      />

      {/* Summary strip — at-a-glance filter health */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm p-4">
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><Wind className="w-3.5 h-3.5" /> {t('tiles.totalTracked')}</div>
          <p className="mt-1 text-3xl font-bold tabular-nums leading-none">{properties?.length ?? 0}</p>
        </div>
        <div className={`rounded-2xl border shadow-sm p-4 ${allOverdue > 0 ? 'border-destructive/30 bg-destructive/5' : 'border-card-border bg-card'}`}>
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><AlertTriangle className="w-3.5 h-3.5" /> {t('tiles.overdue')}</div>
          <p className={`mt-1 text-3xl font-bold tabular-nums leading-none ${allOverdue > 0 ? 'text-destructive' : ''}`}>{allOverdue}</p>
        </div>
        <div className={`rounded-2xl border shadow-sm p-4 ${allDueSoon > 0 ? 'border-warning/30 bg-warning/5' : 'border-card-border bg-card'}`}>
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><Clock className="w-3.5 h-3.5" /> {t('tiles.dueSoon')}</div>
          <p className={`mt-1 text-3xl font-bold tabular-nums leading-none ${allDueSoon > 0 ? 'text-warning' : ''}`}>{allDueSoon}</p>
        </div>
        <div className={`rounded-2xl border shadow-sm p-4 ${allMissingSize > 0 ? 'border-warning/30 bg-warning/5' : 'border-card-border bg-card'}`}>
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><Ruler className="w-3.5 h-3.5" /> {t('tiles.missingFilterSize')}</div>
          <p className={`mt-1 text-3xl font-bold tabular-nums leading-none ${allMissingSize > 0 ? 'text-warning' : ''}`}>{allMissingSize}</p>
        </div>
      </div>

      {/* Bulk action bar */}
      {canEditView('ac-filters', effectiveUser) && bulkMode && bulkSelected.size > 0 && (
        <div className="flex items-center gap-3 p-2 bg-primary/5 border border-primary/20 rounded-lg text-xs">
          <span className="font-medium">{t('bulk.selected', { count: bulkSelected.size })}</span>
          <div className="flex items-center gap-1.5">
            <Input
              value={bulkFilterSize}
              onChange={e => setBulkFilterSize(e.target.value)}
              placeholder={t('bulk.filterSizePlaceholder')}
              className="h-7 w-32 text-xs"
            />
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={bulkSetFilterSize} disabled={!bulkFilterSize.trim()}>
              {t('bulk.setSize')}
            </Button>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={bulkMarkChangedToday}>
            <CalendarCheck className="w-3 h-3" /> {t('bulk.markChangedToday')}
          </Button>
        </div>
      )}

      {isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <>
      <div className="overflow-auto flex-1 rounded-2xl border border-border shadow-sm">
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
                <span className="inline-flex items-center">{t('common.labels.property')} <SortIcon column="name" sortKey={sortKey} sortDir={sortDir} /></span>
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('common.labels.status')}</th>
              <th
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground"
                aria-sort={sortKey === 'filter_size' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                tabIndex={0}
                onClick={() => toggleSort('filter_size')}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleSort('filter_size')}
              >
                <span className="inline-flex items-center">{t('table.filterSize')} <SortIcon column="filter_size" sortKey={sortKey} sortDir={sortDir} /></span>
              </th>
              <th
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground"
                aria-sort={sortKey === 'last_filter_changed' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                tabIndex={0}
                onClick={() => toggleSort('last_filter_changed')}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleSort('last_filter_changed')}
              >
                <span className="inline-flex items-center">{t('table.lastChanged')} <SortIcon column="last_filter_changed" sortKey={sortKey} sortDir={sortDir} /></span>
              </th>
              <th
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground"
                aria-sort={sortKey === 'next_filter_due' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                tabIndex={0}
                onClick={() => toggleSort('next_filter_due')}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleSort('next_filter_due')}
              >
                <span className="inline-flex items-center">{t('table.nextDue')} <SortIcon column="next_filter_due" sortKey={sortKey} sortDir={sortDir} /></span>
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 w-8">{t('table.due')}</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('common.labels.notes')}</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">{t('common.labels.actions')}</th>
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
                  <EmptyState icon={Wind} title={t('table.emptyTitle')} description={t('table.emptyDescription')} />
                </td>
              </tr>
            ) : (
              paged.map((p: any) => {
                const dueStatus = getDueStatus(p.next_filter_due, intervalDays)
                const rowClass = dueStatus?.label === 'Overdue'
                  ? 'bg-destructive/10'
                  : dueStatus?.label === 'Due soon'
                  ? 'bg-warning/5'
                  : ''
                const justSaved = justSavedId === p.id
                return (
                  <tr key={p.id} data-testid={`row-filter-${p.id}`} data-just-saved={justSaved || undefined} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${rowClass} ${justSaved ? 'animate-pulse bg-success/10' : ''}`}>
                    {bulkMode && (
                      <td className="py-2 px-3">
                        <Checkbox checked={bulkSelected.has(p.id)} onCheckedChange={() => toggleBulkSelect(p.id)} />
                      </td>
                    )}
                    <td className="py-2 px-3 font-medium text-xs max-w-[200px] truncate" title={p.name}>{p.name}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">{p.stage_name ? t(`common.stage.${slugify(p.stage_name)}`, undefined, p.stage_name) : '—'}</td>
                    <td className="py-2 px-3">
                      <InlineEdit
                        value={p.filter_size}
                        type="text"
                        onSave={v => updateField({ id: p.id, field: 'filter_size', value: v, oldValue: p.filter_size, propName: p.name })}
                        testId={`inline-filter-size-${p.id}`}
                        placeholder={t('table.addSizePlaceholder')}
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
                          <dueStatus.icon className={`w-4 h-4 ${dueStatus.color}`} aria-label={t(`status.${slugify(dueStatus.label)}`, undefined, dueStatus.label)} />
                        )}
                        {dueStatus?.label === 'Overdue' && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">{t('table.overdueBadge')}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <InlineEdit
                        value={p.notes}
                        type="text"
                        onSave={v => updateField({ id: p.id, field: 'notes', value: v, oldValue: p.notes, propName: p.name })}
                        testId={`inline-notes-${p.id}`}
                        placeholder={t('table.addNotesPlaceholder')}
                        className="w-full min-w-[150px]"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs gap-1 px-2"
                        onClick={() => markChangedToday(p.id)}
                        disabled={savingId === p.id}
                        data-testid={`button-mark-changed-${p.id}`}
                        title={t('table.markChangedTooltip')}
                      >
                        <CalendarCheck className={`w-3 h-3 ${savingId === p.id ? 'animate-pulse' : ''}`} />
                        {savingId === p.id ? t('table.savingButton') : t('table.todayButton')}
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
        </>
      )}

      {/* CSV Import Dialog */}
      <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('csvDialog.title')}</DialogTitle></DialogHeader>
          <div className="text-xs text-muted-foreground space-y-2">
            <p>{t('csvDialog.foundRows', { count: csvData.length })}</p>
            <p>{t('csvDialog.matchingNote')}</p>
            {csvData.length > 0 && (
              <div className="max-h-40 overflow-auto border rounded p-2 space-y-1">
                {csvData.slice(0, 10).map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="font-medium">{row.Property || row.property || row.Name || row.name}</span>
                    <span className="text-muted-foreground">-</span>
                    <span>{row['Filter Size'] || row.filter_size || '—'}</span>
                  </div>
                ))}
                {csvData.length > 10 && <p className="text-muted-foreground">{t('csvDialog.moreRows', { count: csvData.length - 10 })}</p>}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCsvOpen(false)}>{t('common.actions.cancel')}</Button>
            <Button size="sm" onClick={importCsv}>{t('csvDialog.importRows', { count: csvData.length })}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
