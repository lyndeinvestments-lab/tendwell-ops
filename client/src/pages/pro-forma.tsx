import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase } from '@/lib/supabase'
import { InlineEdit } from '@/components/InlineEdit'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { Search, AlertTriangle, Upload, Download, FlaskConical, X, ArrowUpDown, ArrowUp, ArrowDown, Clock, History } from 'lucide-react'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import Papa from 'papaparse'
import { format } from 'date-fns'
import { CsvImportModal } from '@/components/CsvImportModal'
import { invalidateAllPropertyQueries } from '@/lib/query-invalidations'
import { TablePagination } from '@/components/TablePagination'
import { useInProFormaWrapper } from '@/pages/pro-forma-wrapper'

const FREQ_OPTIONS = [
  { value: 'weekly', label: 'Weekly', cleans: 4.33 },
  { value: 'biweekly', label: 'Biweekly', cleans: 2.17 },
  { value: 'monthly', label: 'Monthly', cleans: 1 },
  { value: 'as_needed', label: 'As Needed', cleans: 2 },
  { value: 'custom', label: 'Custom', cleans: null },
]

const BREAK_EVEN_MARGIN = 0.20

function fmt(n: number | null | undefined, prefix = '$') {
  if (n == null) return '—'
  return `${prefix}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function FrequencyCell({ id, value, avgCleans }: { id: string; value: string; avgCleans: number | null }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [customCleans, setCustomCleans] = useState<string>(avgCleans != null ? String(avgCleans) : '')

  const { mutate } = useGuardedMutation('pro-forma', {
    mutationFn: async ({ freq, cleans }: { freq: string; cleans?: number | null }) => {
      const update: Record<string, unknown> = { cleaning_frequency: freq }
      if (cleans != null) update.avg_cleans_per_month = cleans
      const { error } = await supabase.from('properties').update(update).eq('id', Number(id))
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/pro-forma'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      toast({ title: 'Frequency saved' })
    },
    onError: (error: any) => toast({ title: 'Update failed', description: error?.message, variant: 'destructive' }),
  })

  const labelColor = value === 'as_needed' ? 'text-warning' : ''

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={value || 'as_needed'}
        onValueChange={(freq) => {
          if (freq !== 'custom') {
            mutate({ freq })
          } else {
            mutate({ freq: 'custom', cleans: customCleans ? parseFloat(customCleans) : null })
          }
        }}
      >
        <SelectTrigger data-testid={`select-freq-${id}`} className={`h-6 w-28 text-xs border-0 p-0 bg-transparent focus:ring-0 hover:bg-muted transition-colors ${labelColor}`}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {FREQ_OPTIONS.map(f => (
            <SelectItem key={f.value} value={f.value} className="text-xs">
              {f.label}{f.cleans != null ? ` (${f.cleans}/mo)` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value === 'custom' && (
        <Input
          type="number"
          min="0"
          step="0.1"
          value={customCleans}
          onChange={e => setCustomCleans(e.target.value)}
          onBlur={() => {
            const n = parseFloat(customCleans)
            if (!isNaN(n)) mutate({ freq: 'custom', cleans: n })
          }}
          className="h-6 w-16 text-xs px-1"
          placeholder="cleans/mo"
        />
      )}
    </div>
  )
}

function WhatIfPopover({
  id,
  field,
  currentValue,
  ceCharged,
  totalCost,
  cpm,
}: {
  id: string
  field: 'ce_charged' | 'total_estimated_cost'
  currentValue: number | null
  ceCharged: number | null
  totalCost: number | null
  cpm: number | null
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [val, setVal] = useState<string>(currentValue != null ? String(currentValue) : '')

  const parsed = parseFloat(val)
  const isValid = !isNaN(parsed) && parsed >= 0

  const previewCe = field === 'ce_charged' ? (isValid ? parsed : ceCharged) : ceCharged
  const previewCost = field === 'total_estimated_cost' ? (isValid ? parsed : totalCost) : totalCost
  const profitPerClean = previewCe != null && previewCost != null ? previewCe - previewCost : null
  const moProfitPreview = profitPerClean != null && cpm != null ? profitPerClean * cpm : null
  const breakEvenCe = previewCost != null ? previewCost / (1 - BREAK_EVEN_MARGIN) : null

  const { mutate, isPending } = useGuardedMutation('pro-forma', {
    mutationFn: async () => {
      const { error } = await supabase
        .from('properties')
        .update({ [field]: parsed })
        .eq('id', Number(id))
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/pro-forma'] })
      toast({ title: 'Saved' })
      setOpen(false)
    },
    onError: (error: any) => toast({ title: 'Update failed', description: error?.message, variant: 'destructive' }),
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="text-xs tabular-nums underline-offset-2 hover:underline cursor-pointer text-left w-full">
          {fmt(currentValue)}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-3" side="right">
        <p className="text-xs font-semibold text-foreground">
          What-If: {field === 'ce_charged' ? 'Client Charged/Clean' : 'Cost/Clean'}
        </p>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={val}
          onChange={e => setVal(e.target.value)}
          className="h-7 text-xs"
          placeholder="Enter value…"
          autoFocus
        />
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Profit/Clean</span>
            <span className={profitPerClean != null && profitPerClean < 0 ? 'text-destructive font-medium' : 'text-foreground font-medium'}>
              {fmt(profitPerClean)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Mo Profit</span>
            <span className={moProfitPreview != null && moProfitPreview < 0 ? 'text-destructive font-medium' : 'text-foreground font-medium'}>
              {fmt(moProfitPreview)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Break-Even CE</span>
            <span className="text-foreground font-medium">{fmt(breakEvenCe)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="h-6 text-xs flex-1"
            disabled={!isValid || isPending}
            onClick={() => mutate()}
          >
            {isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => { setOpen(false); setVal(currentValue != null ? String(currentValue) : '') }}
          >
            Cancel
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default function ProFormaPage() {
  const inWrapper = useInProFormaWrapper()
  const { toast } = useToast()
  const qc = useQueryClient()
  usePageTitle(inWrapper ? 'Pro Forma — Per-Property' : 'Pro Forma')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkFreq, setBulkFreq] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  type SortKey = 'name' | 'ce_charged' | 'total_estimated_cost' | 'estimated_profit' | 'cleaning_frequency' | 'avg_cleans_per_month' | 'first_clean_date' | 'monthly_revenue_estimate' | 'monthly_cost_estimate' | 'monthly_profit_estimate' | null
  type SortDir = 'asc' | 'desc'
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Feature 2: Scenario overrides
  const [scenarioOverrides, setScenarioOverrides] = useState<Record<string, number>>({})
  const [scenarioEnabled, setScenarioEnabled] = useState<Set<string>>(new Set())

  // Feature 3: Filter controls
  const [freqFilter, setFreqFilter] = useState('all')
  const [profitFilter, setProfitFilter] = useState('all')
  const [missingDataFilter, setMissingDataFilter] = useState(false)

  // Feature 5: Dismissed duplicates — persisted to alert_dismissals (team-wide)
  // with localStorage as a legacy fallback. Marking a pair as "intentionally
  // separate" writes to Supabase so every teammate sees the banner cleared.
  const [localDismissed, setLocalDismissed] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('tendwell-dismissed-duplicates')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })

  const { data: remoteDismissed } = useQuery({
    queryKey: ['/supabase/alert-dismissals/duplicate-pair'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alert_dismissals')
        .select('alert_key')
        .like('alert_key', 'duplicate-pair::%')
      if (error) { console.warn('duplicate dismissals fetch failed:', error.message); return [] }
      return (data || []).map(r => r.alert_key.replace(/^duplicate-pair::/, ''))
    },
    staleTime: 60_000,
  })

  const dismissedDuplicates = useMemo(() => {
    const s = new Set<string>(localDismissed)
    ;(remoteDismissed || []).forEach(k => s.add(k))
    return s
  }, [localDismissed, remoteDismissed])

  // Import history panel
  const [showHistory, setShowHistory] = useState(false)
  // Per-property cleaning history
  const [historyProperty, setHistoryProperty] = useState<{ id: string; name: string } | null>(null)

  const { data: importLog } = useQuery({
    queryKey: ['/supabase/csv-import-log'],
    enabled: showHistory,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('csv_import_log')
        .select('id, file_name, imported_at, records_imported, records_skipped, properties_updated, imported_by')
        .order('imported_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data || []
    },
  })

  const { data: propertyCleanHistory, isLoading: cleanHistoryLoading } = useQuery({
    queryKey: ['/supabase/cleaning-history', historyProperty?.id],
    enabled: !!historyProperty,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cleaning_history')
        .select('id, clean_date, cleaner_name, created_at')
        .eq('property_id', Number(historyProperty!.id))
        .order('clean_date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: rawProperties, isLoading } = useQuery({
    queryKey: ['/supabase/pro-forma'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, ce_charged, total_estimated_cost, estimated_profit, profit_percentage, cleaning_frequency, first_clean_date, avg_cleans_per_month, monthly_revenue_estimate, monthly_cost_estimate, monthly_profit_estimate, stage_name')
        .eq('stage_name', 'Active')
        .order('name')
        .limit(5000)
      if (error) throw error
      return data || []
    },
  })

  // Live cleans-per-month from the breezeway daily import. When a property
  // has any breezeway data, we override the manually-imported
  // avg_cleans_per_month so the Per-Property sheet auto-updates as cleans
  // happen — operator no longer needs to re-import a CSV to refresh.
  const { data: breezewayStats } = useQuery({
    queryKey: ['/supabase/property-breezeway-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_breezeway_stats')
        .select('property_id, total_cleans, months_with_data, avg_cleans_per_month, avg_deep_cleans_per_month, latest_task')
      if (error) throw error
      return data || []
    },
  })

  // Merge: when breezeway has tasks for a property, recompute Cleans/Mo
  // and per-property monthly revenue / cost / profit from the live signal.
  // total_estimated_cost is the per-clean cost (already computed by the
  // operational_properties view); revenue per clean is ce_charged.
  const properties = useMemo(() => {
    if (!rawProperties) return rawProperties
    if (!breezewayStats || breezewayStats.length === 0) return rawProperties
    const statsByPropId = new Map<string, any>()
    for (const s of breezewayStats as any[]) statsByPropId.set(String(s.property_id), s)
    return (rawProperties as any[]).map(p => {
      const s = statsByPropId.get(String(p.id))
      if (!s || !s.months_with_data || Number(s.months_with_data) === 0) return p
      const cpm = Number(s.avg_cleans_per_month) || 0
      const ce = Number(p.ce_charged) || 0
      const costPerClean = Number(p.total_estimated_cost) || 0
      const revenue = cpm * ce
      const cost    = cpm * costPerClean
      return {
        ...p,
        avg_cleans_per_month: cpm,
        monthly_revenue_estimate: revenue,
        monthly_cost_estimate: cost,
        monthly_profit_estimate: revenue - cost,
        // Future Phase-3 variance work will read these.
        _cleans_source: 'breezeway',
        _months_with_data: Number(s.months_with_data) || 0,
        _latest_breezeway_task: s.latest_task,
      }
    })
  }, [rawProperties, breezewayStats])

  const { mutate: updateDate } = useGuardedMutation('pro-forma', {
    mutationFn: async ({ id, value }: { id: string; value: string }) => {
      const { error } = await supabase.from('properties').update({ first_clean_date: value || null }).eq('id', Number(id))
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/supabase/pro-forma'] }),
    onError: (error: any) => toast({ title: 'Update failed', description: error?.message, variant: 'destructive' }),
  })

  const { mutate: bulkSetFreq, isPending: bulkPending } = useGuardedMutation('pro-forma', {
    mutationFn: async ({ ids, freq }: { ids: string[]; freq: string }) => {
      const { error } = await supabase
        .from('properties')
        .update({ cleaning_frequency: freq })
        .in('id', ids.map(Number))
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/pro-forma'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      const count = selected.size
      setSelected(new Set())
      setBulkFreq('')
      toast({ title: `Updated ${count} properties` })
    },
    onError: (error: any) => toast({ title: 'Bulk update failed', description: error?.message, variant: 'destructive' }),
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
  }

  // Feature 3 + search filtering
  const filtered = useMemo(() => {
    if (!properties) return []
    const result = properties.filter((p: any) => {
      if (search && !p.name?.toLowerCase().includes(search.toLowerCase())) return false
      if (freqFilter !== 'all' && p.cleaning_frequency !== freqFilter) return false
      if (missingDataFilter && p.first_clean_date != null) return false
      if (profitFilter === 'profitable') {
        const pct = p.profit_percentage ?? 0
        if (pct <= 5) return false
      } else if (profitFilter === 'near_break_even') {
        const pct = p.profit_percentage ?? 0
        if (pct <= 0 || pct > 5) return false
      } else if (profitFilter === 'unprofitable') {
        const pct = p.profit_percentage ?? 0
        if (pct > 0) return false
      }
      return true
    })
    if (!sortKey) return result
    return [...result].sort((a: any, b: any) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      // Nulls always last
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      let cmp = 0
      if (sortKey === 'name' || sortKey === 'cleaning_frequency') {
        cmp = String(aVal).localeCompare(String(bVal))
      } else if (sortKey === 'first_clean_date') {
        cmp = new Date(aVal).getTime() - new Date(bVal).getTime()
      } else {
        cmp = (aVal as number) - (bVal as number)
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [properties, search, freqFilter, profitFilter, missingDataFilter, sortKey, sortDir])

  // Feature 5: Duplicate detection
  const duplicatePairs = useMemo(() => {
    if (!filtered.length) return []
    const pairs: Array<{ a: any; b: any; key: string }> = []
    const seen = new Set<string>()
    for (let i = 0; i < filtered.length; i++) {
      for (let j = i + 1; j < filtered.length; j++) {
        const a = filtered[i] as any
        const b = filtered[j] as any
        const aPrefix = (a.name || '').slice(0, 3).toLowerCase()
        const bPrefix = (b.name || '').slice(0, 3).toLowerCase()
        if (aPrefix !== bPrefix || aPrefix === '') continue
        const aAddr = (a.address || '').toLowerCase().trim()
        const bAddr = (b.address || '').toLowerCase().trim()
        if (aAddr && bAddr && aAddr !== bAddr) continue
        const ceSimilar = a.ce_charged != null && b.ce_charged != null && Math.abs(a.ce_charged - b.ce_charged) <= 1
        const costSimilar = a.total_estimated_cost != null && b.total_estimated_cost != null && Math.abs(a.total_estimated_cost - b.total_estimated_cost) <= 1
        if (ceSimilar && costSimilar) {
          const key = [a.id, b.id].sort().join('::')
          if (!seen.has(key)) {
            seen.add(key)
            pairs.push({ a, b, key })
          }
        }
      }
    }
    return pairs
  }, [filtered])

  const visibleDuplicatePairs = duplicatePairs.filter(p => !dismissedDuplicates.has(p.key))

  // IDs of properties in undismissed duplicate pairs — excluded from totals
  const duplicateExcludedIds = useMemo(() => {
    const ids = new Set<string>()
    visibleDuplicatePairs.forEach(pair => {
      ids.add(pair.a.id)
      ids.add(pair.b.id)
    })
    return ids
  }, [visibleDuplicatePairs])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  // Feature 5: Totals exclude dismissed duplicates
  const totals = useMemo(() => {
    if (!filtered?.length) return null
    const forTotals = filtered.filter((p: any) => !duplicateExcludedIds.has(p.id))
    return {
      revenue: forTotals.reduce((s: number, p: any) => s + (p.monthly_revenue_estimate || 0), 0),
      cost: forTotals.reduce((s: number, p: any) => s + (p.monthly_cost_estimate || 0), 0),
      profit: forTotals.reduce((s: number, p: any) => s + (p.monthly_profit_estimate || 0), 0),
    }
  }, [filtered, duplicateExcludedIds])

  const asNeededCount = filtered?.filter((p: any) => p.cleaning_frequency === 'as_needed').length ?? 0

  // Feature 2: Scenario columns visibility
  const hasScenarios = Object.keys(scenarioOverrides).length > 0

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (filtered.length > 0 && selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((p: any) => p.id)))
    }
  }

  function toggleScenario(id: string) {
    setScenarioEnabled(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        setScenarioOverrides(o => {
          const n = { ...o }
          delete n[id]
          return n
        })
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Feature 6: CSV export with Frequency Type column
  function exportCsv() {
    const rows = filtered.map((p: any) => ({
      'Property': p.name || '',
      'Client Charged/Clean': p.ce_charged != null ? `$${p.ce_charged.toFixed(2)}` : '',
      'Cost/Clean': p.total_estimated_cost != null ? `$${p.total_estimated_cost.toFixed(2)}` : '',
      'Profit/Clean': p.estimated_profit != null ? `$${p.estimated_profit.toFixed(2)}` : '',
      'Frequency': FREQ_OPTIONS.find(f => f.value === p.cleaning_frequency)?.label || p.cleaning_frequency || '',
      'Frequency Type': p.cleaning_frequency === 'custom' ? 'Custom' : 'Standard',
      'Cleans/Mo': p.avg_cleans_per_month ?? '',
      'First Clean': p.first_clean_date ? p.first_clean_date.slice(0, 10) : '',
      'Mo Revenue': p.monthly_revenue_estimate != null ? `$${p.monthly_revenue_estimate.toFixed(2)}` : '',
      'Mo Cost': p.monthly_cost_estimate != null ? `$${p.monthly_cost_estimate.toFixed(2)}` : '',
      'Mo Profit': p.monthly_profit_estimate != null ? `$${p.monthly_profit_estimate.toFixed(2)}` : '',
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'pro-forma.csv'
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: 'CSV exported', description: `${rows.length} rows exported` })
  }

  const allSelected = filtered.length > 0 && selected.size === filtered.length
  const someSelected = selected.size > 0 && selected.size < filtered.length

  // Total col count for colSpan calculations
  const baseColCount = 13 // checkbox + 11 data cols + scenario toggle col
  const scenarioColCount = hasScenarios ? 3 : 0
  const totalColCount = baseColCount + scenarioColCount

  return (
    <PageContainer width="full" className="h-full flex flex-col">
      {!inWrapper && (
        <PageHeader
          title="Pro Forma"
          subtitle="Financial projections for active properties"
        />
      )}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {inWrapper && (
          <div className="text-xs text-muted-foreground">
            {filtered?.length ?? 0} {filtered?.length === 1 ? 'property' : 'properties'}
          </div>
        )}
        <div className={`flex items-center gap-3 ${inWrapper ? '' : 'ml-auto'}`}>
          {asNeededCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-warning">
              <AlertTriangle className="w-3 h-3" />
              <span>{asNeededCount} using default frequency (2/mo)</span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistory(true)}
            className="h-8 text-xs gap-1.5"
            data-testid="button-import-history"
          >
            <History className="w-3.5 h-3.5" />
            History
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowImport(true)}
            className="h-8 text-xs gap-1.5"
            data-testid="button-import-csv"
          >
            <Upload className="w-3.5 h-3.5" />
            Import CSV
          </Button>
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
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              data-testid="input-search-proforma"
              className="pl-8 h-8 w-48 text-sm"
            />
          </div>
        </div>
      </div>


      {/* Feature 3: Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground font-medium">Frequency:</span>
          <Select value={freqFilter} onValueChange={v => { setFreqFilter(v); setPage(1) }}>
            <SelectTrigger className="h-7 w-36 text-xs" data-testid="select-filter-freq">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All</SelectItem>
              {FREQ_OPTIONS.map(f => (
                <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground font-medium">Profitability:</span>
          <Select value={profitFilter} onValueChange={v => { setProfitFilter(v); setPage(1) }}>
            <SelectTrigger className="h-7 w-44 text-xs" data-testid="select-filter-profit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All</SelectItem>
              <SelectItem value="profitable" className="text-xs">Profitable (&gt;5%)</SelectItem>
              <SelectItem value="near_break_even" className="text-xs">Near Break-Even (&lt;5%)</SelectItem>
              <SelectItem value="unprofitable" className="text-xs">Unprofitable</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <Checkbox
            id="missing-data-filter"
            checked={missingDataFilter}
            onCheckedChange={v => { setMissingDataFilter(!!v); setPage(1) }}
            data-testid="checkbox-missing-data"
          />
          <label htmlFor="missing-data-filter" className="text-xs text-muted-foreground cursor-pointer select-none">
            Missing first clean date only
          </label>
        </div>
        {(freqFilter !== 'all' || profitFilter !== 'all' || missingDataFilter) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground gap-1"
            onClick={() => { setFreqFilter('all'); setProfitFilter('all'); setMissingDataFilter(false); setPage(1) }}
          >
            <X className="w-3 h-3" />
            Clear filters
          </Button>
        )}
      </div>

      {/* Feature 5: Duplicate warning banner */}
      {visibleDuplicatePairs.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
            <span className="text-xs font-semibold text-warning">
              {visibleDuplicatePairs.length} potential duplicate{visibleDuplicatePairs.length > 1 ? 's' : ''} detected
            </span>
          </div>
          <ul className="space-y-1">
            {visibleDuplicatePairs.map(pair => (
              <li key={pair.key} className="flex items-center justify-between gap-3 text-xs text-warning">
                <span>
                  <span className="font-medium">{pair.a.name}</span>
                  {' '}&amp;{' '}
                  <span className="font-medium">{pair.b.name}</span>
                  {' — '}CE: {fmt(pair.a.ce_charged)} / {fmt(pair.b.ce_charged)}, Cost: {fmt(pair.a.total_estimated_cost)} / {fmt(pair.b.total_estimated_cost)}
                </span>
                <button
                  className="shrink-0 text-2xs px-2 py-0.5 rounded border border-warning/50 text-warning hover:bg-warning/20"
                  onClick={async () => {
                    setLocalDismissed(prev => {
                      const n = new Set(prev); n.add(pair.key)
                      try { localStorage.setItem('tendwell-dismissed-duplicates', JSON.stringify(Array.from(n))) } catch {}
                      return n
                    })
                    const { error } = await supabase
                      .from('alert_dismissals')
                      .upsert({ alert_key: `duplicate-pair::${pair.key}` }, { onConflict: 'alert_key' })
                    if (error) {
                      toast({ title: 'Saved locally — sync failed', description: error.message, variant: 'destructive' })
                    } else {
                      qc.invalidateQueries({ queryKey: ['/supabase/alert-dismissals/duplicate-pair'] })
                      toast({ title: 'Marked as intentionally separate' })
                    }
                  }}
                  title="These are distinct units — suppress this alert for everyone on the team"
                >
                  Intentionally separate
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      <div className={`overflow-auto flex-1 rounded-lg border border-border ${selected.size > 0 ? 'pb-16' : ''}`}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
            <tr>
              <th className="py-2 px-3 w-8 sticky left-0 top-0 z-30 bg-muted">
                <Checkbox
                  checked={allSelected}
                  data-state={someSelected ? 'indeterminate' : allSelected ? 'checked' : 'unchecked'}
                  onCheckedChange={toggleAll}
                  data-testid="checkbox-select-all"
                />
              </th>
              <th
                role="columnheader"
                aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[140px] cursor-pointer select-none hover:text-foreground transition-colors group sticky left-[44px] z-20 bg-muted/80 backdrop-blur"
                onClick={() => toggleSort('name')}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('name') } }}
              >
                <span className="flex items-center gap-1">Property <SortIcon col="name" /></span>
              </th>
              <th
                role="columnheader"
                aria-sort={sortKey === 'ce_charged' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors group"
                onClick={() => toggleSort('ce_charged')}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('ce_charged') } }}
              >
                <span className="flex items-center gap-1">Client Charged/Clean <SortIcon col="ce_charged" /></span>
              </th>
              <th
                role="columnheader"
                aria-sort={sortKey === 'total_estimated_cost' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors group"
                onClick={() => toggleSort('total_estimated_cost')}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('total_estimated_cost') } }}
              >
                <span className="flex items-center gap-1">Cost/Clean <SortIcon col="total_estimated_cost" /></span>
              </th>
              <th
                role="columnheader"
                aria-sort={sortKey === 'estimated_profit' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors group"
                onClick={() => toggleSort('estimated_profit')}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('estimated_profit') } }}
              >
                <span className="flex items-center gap-1">Profit/Clean <SortIcon col="estimated_profit" /></span>
              </th>
              <th
                role="columnheader"
                aria-sort={sortKey === 'cleaning_frequency' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors group"
                onClick={() => toggleSort('cleaning_frequency')}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('cleaning_frequency') } }}
              >
                <span className="flex items-center gap-1">Frequency <SortIcon col="cleaning_frequency" /></span>
              </th>
              <th
                role="columnheader"
                aria-sort={sortKey === 'avg_cleans_per_month' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors group"
                onClick={() => toggleSort('avg_cleans_per_month')}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('avg_cleans_per_month') } }}
              >
                <span className="flex items-center gap-1">Cleans/Mo <SortIcon col="avg_cleans_per_month" /></span>
              </th>
              <th
                role="columnheader"
                aria-sort={sortKey === 'first_clean_date' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors group"
                onClick={() => toggleSort('first_clean_date')}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('first_clean_date') } }}
              >
                <span className="flex items-center gap-1">First Clean <SortIcon col="first_clean_date" /></span>
              </th>
              <th
                role="columnheader"
                aria-sort={sortKey === 'monthly_revenue_estimate' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors group"
                onClick={() => toggleSort('monthly_revenue_estimate')}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('monthly_revenue_estimate') } }}
              >
                <span className="flex items-center gap-1">Mo Revenue <SortIcon col="monthly_revenue_estimate" /></span>
              </th>
              <th
                role="columnheader"
                aria-sort={sortKey === 'monthly_cost_estimate' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors group"
                onClick={() => toggleSort('monthly_cost_estimate')}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('monthly_cost_estimate') } }}
              >
                <span className="flex items-center gap-1">Mo Cost <SortIcon col="monthly_cost_estimate" /></span>
              </th>
              <th
                role="columnheader"
                aria-sort={sortKey === 'monthly_profit_estimate' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors group"
                onClick={() => toggleSort('monthly_profit_estimate')}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('monthly_profit_estimate') } }}
              >
                <span className="flex items-center gap-1">Mo Profit <SortIcon col="monthly_profit_estimate" /></span>
              </th>
              <th
                role="columnheader"
                aria-sort={sortKey === 'total_estimated_cost' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors group"
                title={`CE needed to break even at ${BREAK_EVEN_MARGIN * 100}% margin`}
                onClick={() => toggleSort('total_estimated_cost')}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('total_estimated_cost') } }}
              >
                <span className="flex items-center gap-1">B/E CE <SortIcon col="total_estimated_cost" /></span>
              </th>
              {/* Scenario toggle column */}
              <th className="py-2 px-2 w-8" title="Enable scenario mode for this row">
                <FlaskConical className="w-3.5 h-3.5 text-muted-foreground mx-auto" />
              </th>
              {hasScenarios && (
                <>
                  <th className="text-left text-xs font-medium text-info uppercase tracking-wide py-2 px-3 whitespace-nowrap">Scenario Mo Rev</th>
                  <th className="text-left text-xs font-medium text-info uppercase tracking-wide py-2 px-3 whitespace-nowrap">Scenario Mo Cost</th>
                  <th className="text-left text-xs font-medium text-info uppercase tracking-wide py-2 px-3 whitespace-nowrap">Scenario Mo Profit</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(totalColCount)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}
                </tr>
              ))
            ) : !filtered || filtered.length === 0 ? (
              <tr>
                <td colSpan={totalColCount} className="text-center py-12 text-muted-foreground text-sm">No active properties found</td>
              </tr>
            ) : (
              paged.map((p: any) => {
                const profitNeg = (p.monthly_profit_estimate || 0) < 0
                const scenarioOn = scenarioEnabled.has(p.id)
                const scenarioCpm = scenarioOverrides[p.id] ?? null
                const scenarioRev = p.ce_charged != null && scenarioCpm != null ? p.ce_charged * scenarioCpm : null
                const scenarioCost = p.total_estimated_cost != null && scenarioCpm != null ? p.total_estimated_cost * scenarioCpm : null
                const scenarioProfit = p.ce_charged != null && p.total_estimated_cost != null && scenarioCpm != null
                  ? (p.ce_charged - p.total_estimated_cost) * scenarioCpm
                  : null
                return (
                  <tr key={p.id} data-testid={`row-proforma-${p.id}`} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${profitNeg ? 'bg-destructive/5' : ''}`}>
                    <td className="py-2 px-3 sticky left-0 z-10 bg-card">
                      <Checkbox
                        checked={selected.has(p.id)}
                        onCheckedChange={() => toggleSelect(p.id)}
                        data-testid={`checkbox-${p.id}`}
                      />
                    </td>
                    <td className="py-2 px-3 font-medium text-xs max-w-[200px] truncate sticky left-[44px] z-10 bg-card">
                      <button
                        className="text-left hover:underline truncate max-w-full"
                        title={`${p.name} — click to view cleaning history`}
                        onClick={() => setHistoryProperty({ id: p.id, name: p.name })}
                        data-testid={`btn-cleaning-history-${p.id}`}
                      >
                        {p.name}
                      </button>
                    </td>
                    {/* Feature 4: What-If Popover for Client Charged/Clean */}
                    <td className="py-2 px-3 text-xs tabular-nums">
                      <WhatIfPopover
                        id={p.id}
                        field="ce_charged"
                        currentValue={p.ce_charged}
                        ceCharged={p.ce_charged}
                        totalCost={p.total_estimated_cost}
                        cpm={p.avg_cleans_per_month}
                      />
                    </td>
                    {/* Feature 4: What-If Popover for Cost/Clean */}
                    <td className="py-2 px-3 text-xs tabular-nums">
                      <WhatIfPopover
                        id={p.id}
                        field="total_estimated_cost"
                        currentValue={p.total_estimated_cost}
                        ceCharged={p.ce_charged}
                        totalCost={p.total_estimated_cost}
                        cpm={p.avg_cleans_per_month}
                      />
                    </td>
                    <td className={`py-2 px-3 text-xs tabular-nums font-medium ${(p.estimated_profit || 0) < 0 ? 'text-destructive' : ''}`}>{fmt(p.estimated_profit)}</td>
                    <td className="py-2 px-3">
                      {/* Feature 1: Custom frequency with inline input */}
                      <FrequencyCell id={p.id} value={p.cleaning_frequency} avgCleans={p.avg_cleans_per_month} />
                    </td>
                    <td className={`py-2 px-3 text-xs tabular-nums ${(p.avg_cleans_per_month ?? 0) > 10 ? 'text-destructive font-medium' : ''}`} title={(p.avg_cleans_per_month ?? 0) > 10 ? 'Unusually high — verify cleaning history' : undefined}>
                      {p.avg_cleans_per_month ?? '—'}
                    </td>
                    <td className="py-2 px-3">
                      <InlineEdit
                        value={p.first_clean_date ? p.first_clean_date.slice(0, 10) : ''}
                        type="date"
                        onSave={v => updateDate({ id: p.id, value: v })}
                        testId={`inline-date-${p.id}`}
                      />
                    </td>
                    <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.monthly_revenue_estimate)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.monthly_cost_estimate)}</td>
                    <td className={`py-2 px-3 text-xs tabular-nums font-semibold ${profitNeg ? 'text-destructive' : 'text-primary'}`}>{fmt(p.monthly_profit_estimate)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums text-muted-foreground italic">
                      {p.total_estimated_cost != null
                        ? fmt(p.total_estimated_cost / (1 - BREAK_EVEN_MARGIN))
                        : '—'}
                    </td>
                    {/* Feature 2: Scenario toggle button */}
                    <td className="py-2 px-2 text-center">
                      <button
                        title={scenarioOn ? 'Disable scenario mode' : 'Enable scenario mode'}
                        onClick={() => toggleScenario(p.id)}
                        className={`p-0.5 rounded transition-colors ${scenarioOn ? 'text-info bg-info/15' : 'text-muted-foreground hover:text-info'}`}
                      >
                        <FlaskConical className="w-3.5 h-3.5" />
                      </button>
                    </td>
                    {/* Feature 2: Scenario columns */}
                    {hasScenarios && (
                      <>
                        <td className="py-2 px-3 text-xs tabular-nums text-info">
                          {scenarioOn ? (
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min="0"
                                step="0.1"
                                value={scenarioOverrides[p.id] ?? ''}
                                onChange={e => {
                                  const v = parseFloat(e.target.value)
                                  if (!isNaN(v)) {
                                    setScenarioOverrides(o => ({ ...o, [p.id]: v }))
                                  } else {
                                    setScenarioOverrides(o => { const n = { ...o }; delete n[p.id]; return n })
                                  }
                                }}
                                className="h-6 w-16 text-xs px-1"
                                placeholder="cpm"
                              />
                              {scenarioRev != null && <span>{fmt(scenarioRev)}</span>}
                            </div>
                          ) : '—'}
                        </td>
                        <td className="py-2 px-3 text-xs tabular-nums text-info">
                          {scenarioOn && scenarioCost != null ? fmt(scenarioCost) : '—'}
                        </td>
                        <td className={`py-2 px-3 text-xs tabular-nums font-semibold ${scenarioProfit != null && scenarioProfit < 0 ? 'text-destructive' : 'text-info'}`}>
                          {scenarioOn && scenarioProfit != null ? fmt(scenarioProfit) : '—'}
                        </td>
                      </>
                    )}
                  </tr>
                )
              })
            )}
            {totals && !isLoading && (
              <tr className="bg-muted/70 border-t-2 border-border font-semibold sticky bottom-0 z-20" data-testid="row-proforma-totals">
                <td className="py-2 px-3 sticky left-0 bottom-0 z-30 bg-muted/90 backdrop-blur" />
                <td className="py-2 px-3 text-xs uppercase tracking-wide sticky left-[44px] bottom-0 z-30 bg-muted/90 backdrop-blur" colSpan={7}>
                  Monthly Totals ({filtered?.length - duplicateExcludedIds.size > 0 ? filtered.length - duplicateExcludedIds.size : filtered.length})
                  {duplicateExcludedIds.size > 0 && (
                    <span className="ml-1 font-normal text-warning">
                      (excl. {duplicateExcludedIds.size} suspected dupes)
                    </span>
                  )}
                </td>
                <td className="py-2 px-3 text-xs tabular-nums">{fmt(totals.revenue)}</td>
                <td className="py-2 px-3 text-xs tabular-nums">{fmt(totals.cost)}</td>
                <td className={`py-2 px-3 text-xs tabular-nums ${totals.profit < 0 ? 'text-destructive' : 'text-primary'}`}>{fmt(totals.profit)}</td>
                <td className="py-2 px-3" />
                <td className="py-2 px-3" />
                {hasScenarios && <><td /><td /><td /></>}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      {/* Sticky bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-3 px-5 py-3 bg-background border-t border-border shadow-lg">
          <span className="text-sm font-medium text-foreground">
            {selected.size} {selected.size === 1 ? 'property' : 'properties'} selected
          </span>
          <div className="flex items-center gap-2">
            <Select value={bulkFreq} onValueChange={setBulkFreq}>
              <SelectTrigger className="h-8 w-40 text-xs" data-testid="select-bulk-freq">
                <SelectValue placeholder="Set Frequency…" />
              </SelectTrigger>
              <SelectContent>
                {FREQ_OPTIONS.map(f => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">
                    {f.label}{f.cleans != null ? ` (${f.cleans}/mo)` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!bulkFreq || bulkPending}
              onClick={() => bulkSetFreq({ ids: Array.from(selected), freq: bulkFreq })}
              data-testid="button-bulk-apply"
            >
              {bulkPending ? 'Applying…' : 'Apply'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setSelected(new Set()); setBulkFreq('') }}
              data-testid="button-clear-selection"
            >
              Clear Selection
            </Button>
          </div>
        </div>
      )}

      {showImport && (
        <CsvImportModal
          properties={properties || []}
          onClose={() => setShowImport(false)}
          onImportComplete={() => {
            // CSV import inserts new properties AND updates clean-counts on
            // existing ones — the blast radius is every property-derived
            // cache. The registry walk covers pro-forma, dashboard,
            // master-list, pipeline, revenue, etc. csv-import-log lives
            // outside the registry, so keep it explicit.
            invalidateAllPropertyQueries(qc)
            qc.invalidateQueries({ queryKey: ['/supabase/csv-import-log'] })
            setShowImport(false)
          }}
        />
      )}

      {/* Import history slide-over */}
      <Sheet open={showHistory} onOpenChange={setShowHistory}>
        <SheetContent side="right" className="w-full sm:w-[480px] flex flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <History className="w-4 h-4" />
              CSV Import History
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto mt-4">
            {!importLog ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded" />)}
              </div>
            ) : importLog.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No imports yet</p>
            ) : (
              <div className="space-y-2">
                {importLog.map((log: any) => (
                  <div key={log.id} className="rounded-lg border border-border px-4 py-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{log.file_name}</span>
                      {log.imported_by && (
                        <span className="text-xs text-muted-foreground shrink-0">{log.imported_by}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {format(new Date(log.imported_at), 'MMM d, yyyy h:mm a')}
                      </span>
                      <span>{log.properties_updated} {log.properties_updated === 1 ? 'property' : 'properties'} updated</span>
                      {log.records_imported > 0 && (
                        <span className="text-success">{log.records_imported} new records</span>
                      )}
                      {log.records_skipped > 0 && (
                        <span className="text-warning">{log.records_skipped} skipped (dupes)</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Per-property cleaning history slide-over */}
      <Sheet open={!!historyProperty} onOpenChange={open => { if (!open) setHistoryProperty(null) }}>
        <SheetContent side="right" className="w-full sm:w-[480px] flex flex-col">
          <SheetHeader>
            <SheetTitle className="text-base truncate">{historyProperty?.name} — Cleaning History</SheetTitle>
          </SheetHeader>
          <p className="text-xs text-muted-foreground mt-1">
            Individual clean records imported from CSV. Duplicates are blocked at the database level.
          </p>
          <div className="flex-1 overflow-y-auto mt-4">
            {cleanHistoryLoading ? (
              <div className="space-y-2">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded" />)}
              </div>
            ) : !propertyCleanHistory || propertyCleanHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No cleaning records found. Import a CSV to populate history.
              </p>
            ) : (
              <div className="overflow-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Clean Date</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Cleaner</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Imported</th>
                    </tr>
                  </thead>
                  <tbody>
                    {propertyCleanHistory.map((row: any) => (
                      <tr key={row.id} className="border-t border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2 tabular-nums font-medium">{row.clean_date}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.cleaner_name || '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.created_at ? format(new Date(row.created_at), 'MMM d, yyyy') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground text-right px-3 py-2 border-t border-border">
                  {propertyCleanHistory.length} record{propertyCleanHistory.length !== 1 ? 's' : ''}
                </p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </PageContainer>
  )
}
