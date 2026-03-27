import { useState, useMemo, Fragment, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { InlineEdit } from '@/components/InlineEdit'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { ArrowUpDown, Search, Download, X, ChevronRight, ChevronDown, DollarSign as DollarSignIcon, RotateCcw } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { TablePagination } from '@/components/TablePagination'
import Papa from 'papaparse'

type SortKey = 'name' | 'ce_charged' | 'cleaner_pay' | 'est_laundry' | 'est_consumables' | 'total_estimated_cost' | 'estimated_profit' | 'profit_percentage'

const STATUS_OPTIONS = ['Active', 'Onboarding', 'Offboarding', 'Offboarded']

function ProfitBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>
  const isHigh = pct >= 30, isMid = pct >= 15, isPos = pct >= 0
  const cls = isHigh ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' :
              isMid ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' :
              isPos ? 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800' :
              'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
  const tier = isHigh ? 'High' : isMid ? 'Mid' : isPos ? 'Low' : 'Neg'
  return (
    <div className="flex items-center gap-1">
      <span data-testid={`badge-profit-${Math.round(pct)}`} className={`text-xs font-medium px-1.5 py-0.5 rounded border ${cls}`}>
        {pct.toFixed(1)}%
      </span>
      <span className={`text-xs font-medium px-1 py-0.5 rounded ${cls}`}>{tier}</span>
    </div>
  )
}

function StageBadge({ stage }: { stage: string | null }) {
  if (!stage) return <span className="text-muted-foreground text-xs">—</span>
  const colors: Record<string, string> = {
    Active: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    Onboarding: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    Offboarding: 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
    Lead: 'text-gray-600 bg-gray-50 border-gray-200',
    Quote: 'text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
  }
  const cls = colors[stage] || 'text-gray-600 bg-gray-50 border-gray-200'
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${cls}`}>{stage}</span>
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function AssignCleanerInline({ propertyId }: { propertyId: string }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [date, setDate] = useState('')
  const [cleanerId, setCleanerId] = useState('')

  const { data: cleaners } = useQuery({
    queryKey: ['/supabase/cleaners-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cleaners').select('id, full_name').eq('is_active', true).order('full_name')
      if (error) throw error
      return data || []
    },
    staleTime: 60_000,
  })

  const { mutate: addAssignment, isPending } = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('clean_assignments').insert({
        property_id: propertyId,
        cleaner_id: cleanerId,
        scheduled_date: date,
        status: 'scheduled',
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/all-assignments'] })
      toast({ title: 'Assignment added' })
      setDate('')
      setCleanerId('')
    },
    onError: () => toast({ title: 'Failed to add assignment', variant: 'destructive' }),
  })

  return (
    <div className="mt-3 pt-2 border-t border-border/40">
      <span className="text-muted-foreground block mb-1 text-xs">Assign Cleaner</span>
      <div className="flex items-center gap-2">
        <select
          value={cleanerId}
          onChange={e => setCleanerId(e.target.value)}
          className="h-6 text-xs border border-input rounded px-1 bg-background flex-1"
        >
          <option value="">Select cleaner…</option>
          {(cleaners || []).map((c: any) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
        </select>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="h-6 text-xs border border-input rounded px-1 bg-background"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs px-2"
          disabled={!cleanerId || !date || isPending}
          onClick={() => addAssignment()}
        >
          Add
        </Button>
      </div>
    </div>
  )
}

export default function CostTrackingPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { openPropertyModal } = usePropertyModal()
  usePageTitle('Cost Tracking')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [bulkEditMode, setBulkEditMode] = useState(false)
  const [bulkChanges, setBulkChanges] = useState<Record<string, number>>({})
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [localProperties, setLocalProperties] = useState<any[] | null>(null)
  const [flashedCells, setFlashedCells] = useState<Set<string>>(new Set())

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/operational_properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, stage_name, ce_charged, cleaner_pay, est_laundry, est_consumables, inspection_cost, trash_cost, total_estimated_cost, estimated_profit, profit_percentage, notes')
      if (error) throw error
      return data || []
    },
    onSuccess: (data: any[]) => setLocalProperties(data),
  } as any)

  const displayProperties = localProperties ?? properties ?? []

  function flashCell(cellId: string) {
    setFlashedCells(prev => new Set(prev).add(cellId))
    setTimeout(() => setFlashedCells(prev => { const s = new Set(prev); s.delete(cellId); return s }), 1500)
  }

  const { mutate: updateProperty } = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: number | string | null }) => {
      const { error } = await supabase.from('properties').update({ [field]: value }).eq('id', id)
      if (error) throw error
    },
    onMutate: ({ id, field, value }) => {
      const snapshot = localProperties ? [...localProperties] : null
      setLocalProperties(prev => prev ? prev.map(p => p.id === id ? { ...p, [field]: value } : p) : prev)
      return { snapshot }
    },
    onSuccess: (_, { id, field }) => {
      qc.invalidateQueries({ queryKey: ['/supabase/operational_properties'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      flashCell(`${id}-${field}`)
      toast({ title: 'Saved' })
    },
    onError: (_, __, ctx: any) => {
      if (ctx?.snapshot) setLocalProperties(ctx.snapshot)
      toast({ title: 'Update failed', variant: 'destructive' })
    },
  })

  const resetRow = useCallback(async (id: string) => {
    const { error } = await supabase.from('properties')
      .update({ est_laundry: null, est_consumables: null })
      .eq('id', id)
    if (error) { toast({ title: 'Reset failed', variant: 'destructive' }); return }
    qc.invalidateQueries({ queryKey: ['/supabase/operational_properties'] })
    toast({ title: 'Row reset to defaults' })
  }, [qc, toast])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    if (!displayProperties.length && isLoading) return []
    let arr = displayProperties.filter((p: any) => {
      const q = search.toLowerCase()
      const matchSearch = !q || (p.name?.toLowerCase().includes(q) || p.stage_name?.toLowerCase().includes(q))
      const matchStatus = statusFilter === 'all' || p.stage_name === statusFilter
      return matchSearch && matchStatus
    })
    arr = [...arr].sort((a: any, b: any) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [properties, search, statusFilter, sortKey, sortDir])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  const totals = useMemo(() => {
    if (!filtered?.length) return null
    const ceTotal = filtered.reduce((s: number, p: any) => s + (p.ce_charged || 0), 0)
    const payTotal = filtered.reduce((s: number, p: any) => s + (p.cleaner_pay || 0), 0)
    const laundryTotal = filtered.reduce((s: number, p: any) => s + (p.est_laundry || 0), 0)
    const consumablesTotal = filtered.reduce((s: number, p: any) => s + (p.est_consumables || 0), 0)
    const costTotal = filtered.reduce((s: number, p: any) => s + (p.total_estimated_cost || 0), 0)
    const profitTotal = filtered.reduce((s: number, p: any) => s + (p.estimated_profit || 0), 0)
    const avgProfitPct = filtered.length > 0
      ? filtered.reduce((s: number, p: any) => s + (p.profit_percentage || 0), 0) / filtered.length
      : 0
    return { ceTotal, payTotal, laundryTotal, consumablesTotal, costTotal, profitTotal, avgProfitPct }
  }, [filtered])

  function exportCsv() {
    const rows = filtered.map((p: any) => ({
      'Property': p.name || '',
      'Status': p.stage_name || '',
      'CE Charged': p.ce_charged ?? '',
      'Cleaner Pay': p.cleaner_pay ?? '',
      'Laundry': p.est_laundry ?? '',
      'Consumables': p.est_consumables ?? '',
      'Total Cost': p.total_estimated_cost ?? '',
      'Profit': p.estimated_profit ?? '',
      'Profit %': p.profit_percentage != null ? `${p.profit_percentage.toFixed(1)}%` : '',
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'cost-tracking.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  async function bulkSaveAll() {
    try {
      await Promise.all(
        Object.entries(bulkChanges).map(([id, value]) =>
          supabase.from('properties').update({ cleaner_pay: value }).eq('id', id).then(({ error }) => { if (error) throw error })
        )
      )
      qc.invalidateQueries({ queryKey: ['/supabase/operational_properties'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      toast({ title: `Updated ${Object.keys(bulkChanges).length} properties` })
      setBulkEditMode(false)
      setBulkChanges({})
    } catch {
      toast({ title: 'Bulk update failed', variant: 'destructive' })
    }
  }

  const thCls = 'text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap'

  function SortIcon({ col }: { col: SortKey }) {
    return <ArrowUpDown className={`w-3 h-3 inline ml-1 ${sortKey === col ? 'text-primary' : 'text-muted-foreground/40'}`} />
  }

  return (
    <div className="p-5 h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Cost Tracking</h1>
          <p className="text-sm text-muted-foreground">Operational properties — click cells to edit</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1) }}>
            <SelectTrigger className="h-8 w-44 text-sm" data-testid="select-status-filter">
              <SelectValue placeholder="All Statuses" />
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
              data-testid="input-search-cost"
              className="pl-8 pr-8 h-8 w-56 text-sm"
            />
            {search && (
              <button
                onClick={() => { setSearch(''); setPage(1) }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0} className="h-8 gap-1.5 text-xs" data-testid="button-export-csv">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
          <Button
            variant={bulkEditMode ? "default" : "outline"}
            size="sm"
            onClick={() => { setBulkEditMode(m => !m); setBulkChanges({}) }}
            className="h-8 gap-1.5 text-xs"
            data-testid="button-bulk-edit"
          >
            {bulkEditMode ? 'Exit Bulk Edit' : 'Bulk Edit'}
          </Button>
        </div>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th className={thCls} onClick={() => toggleSort('name')}><span className="pl-6">Property</span> <SortIcon col="name" /></th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Status</th>
              <th className={thCls} onClick={() => toggleSort('ce_charged')}>CE Charged <SortIcon col="ce_charged" /></th>
              <th className={thCls} onClick={() => toggleSort('cleaner_pay')}>Cleaner Pay <SortIcon col="cleaner_pay" /></th>
              <th className={thCls} onClick={() => toggleSort('est_laundry')}>Laundry <SortIcon col="est_laundry" /></th>
              <th className={thCls} onClick={() => toggleSort('est_consumables')}>Consumables <SortIcon col="est_consumables" /></th>
              <th className={thCls}>Inspection</th>
              <th className={thCls}>Trash</th>
              <th className={thCls} onClick={() => toggleSort('total_estimated_cost')}>Total Cost <SortIcon col="total_estimated_cost" /></th>
              <th className={thCls} onClick={() => toggleSort('estimated_profit')}>Profit <SortIcon col="estimated_profit" /></th>
              <th className={thCls} onClick={() => toggleSort('profit_percentage')}>Profit % <SortIcon col="profit_percentage" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(10)].map((_, j) => (
                    <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={11}>
                  <EmptyState icon={DollarSignIcon} title="No properties found" description="No operational properties match your current filters." />
                </td>
              </tr>
            ) : (
              paged.map((p: any) => (
                <Fragment key={p.id}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                <tr data-testid={`row-property-${p.id}`} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="py-2 px-3 font-medium text-xs">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setExpandedRow(prev => prev === p.id ? null : p.id)}
                        className="p-0.5 rounded hover:bg-muted"
                        data-testid={`chevron-${p.id}`}
                      >
                        {expandedRow === p.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => openPropertyModal(p.id)}
                        className="hover:underline text-left"
                        data-testid={`link-property-${p.id}`}
                      >
                        {p.name}
                      </button>
                    </div>
                  </td>
                  <td className="py-2 px-3"><StageBadge stage={p.stage_name} /></td>
                  <td className={`py-2 px-3 transition-all duration-300 ${flashedCells.has(`${p.id}-ce_charged`) ? 'ring-2 ring-green-400 rounded' : ''}`}>
                    <InlineEdit
                      value={p.ce_charged}
                      type="number"
                      onSave={v => updateProperty({ id: p.id, field: 'ce_charged', value: v ? parseFloat(v) : null })}
                      testId={`inline-ce-${p.id}`}
                    />
                  </td>
                  <td className={`py-2 px-3 transition-all duration-300 ${flashedCells.has(`${p.id}-cleaner_pay`) ? 'ring-2 ring-green-400 rounded' : ''}`}>
                    {bulkEditMode ? (
                      <input
                        type="number"
                        defaultValue={p.cleaner_pay}
                        onChange={e => setBulkChanges(prev => ({...prev, [p.id]: parseFloat(e.target.value) || 0}))}
                        className="h-6 text-xs w-20 border border-input rounded px-1"
                        data-testid={`bulk-pay-${p.id}`}
                      />
                    ) : (
                      <InlineEdit
                        value={p.cleaner_pay}
                        type="number"
                        onSave={v => updateProperty({ id: p.id, field: 'cleaner_pay', value: v ? parseFloat(v) : null })}
                        testId={`inline-pay-${p.id}`}
                      />
                    )}
                  </td>
                  <td className={`py-2 px-3 transition-all duration-300 ${flashedCells.has(`${p.id}-est_laundry`) ? 'ring-2 ring-green-400 rounded' : ''}`}>
                    <InlineEdit
                      value={p.est_laundry}
                      type="number"
                      onSave={v => updateProperty({ id: p.id, field: 'est_laundry', value: v ? parseFloat(v) : null })}
                      testId={`inline-laundry-${p.id}`}
                    />
                  </td>
                  <td className={`py-2 px-3 transition-all duration-300 ${flashedCells.has(`${p.id}-est_consumables`) ? 'ring-2 ring-green-400 rounded' : ''}`}>
                    <InlineEdit
                      value={p.est_consumables}
                      type="number"
                      onSave={v => updateProperty({ id: p.id, field: 'est_consumables', value: v ? parseFloat(v) : null })}
                      testId={`inline-consumables-${p.id}`}
                    />
                  </td>
                  <td className="py-2 px-3 tabular-nums text-xs text-muted-foreground">$15.00</td>
                  <td className="py-2 px-3 tabular-nums text-xs text-muted-foreground">$5.00</td>
                  <td className="py-2 px-3 tabular-nums text-xs font-medium">{fmt(p.total_estimated_cost)}</td>
                  <td className="py-2 px-3 tabular-nums text-xs font-medium">{fmt(p.estimated_profit)}</td>
                  <td className="py-2 px-3"><ProfitBadge pct={p.profit_percentage} /></td>
                </tr>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => resetRow(p.id)} className="gap-2">
                      <RotateCcw className="w-3.5 h-3.5" /> Reset Row
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                {expandedRow === p.id && (
                  <tr className="bg-muted/20 border-b border-border/50">
                    <td colSpan={11} className="py-3 px-6">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 text-xs mb-3">
                        <div>
                          <span className="text-muted-foreground block">Est Laundry</span>
                          <span className="font-medium">{fmt(p.est_laundry)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Est Consumables</span>
                          <span className="font-medium">{fmt(p.est_consumables)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Inspection</span>
                          <span className="font-medium">$15.00</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Trash</span>
                          <span className="font-medium">$5.00</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Cleaner Pay</span>
                          <span className="font-medium">{fmt(p.cleaner_pay)}</span>
                        </div>
                      </div>
                      <div className="text-xs">
                        <span className="text-muted-foreground block mb-1">Notes</span>
                        <InlineEdit
                          value={p.notes}
                          type="text"
                          placeholder="Add notes…"
                          onSave={v => updateProperty({ id: p.id, field: 'notes', value: v || null })}
                          testId={`inline-notes-${p.id}`}
                        />
                      </div>
                      <AssignCleanerInline propertyId={p.id} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))
            )}
            {totals && !isLoading && (
              <tr className="bg-muted/60 border-t-2 border-border font-semibold sticky bottom-0">
                <td colSpan={2} className="py-2 px-3 text-xs uppercase tracking-wide">Totals ({filtered?.length})</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.ceTotal)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.payTotal)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.laundryTotal)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.consumablesTotal)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt((filtered?.length ?? 0) * 15)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt((filtered?.length ?? 0) * 5)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.costTotal)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.profitTotal)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{totals.avgProfitPct.toFixed(1)}%</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}
      {bulkEditMode && Object.keys(bulkChanges).length > 0 && (
        <div className="sticky bottom-0 left-0 right-0 bg-background border-t border-border p-3 flex items-center justify-between z-20 shadow-lg">
          <span className="text-sm text-muted-foreground">{Object.keys(bulkChanges).length} change(s) pending</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { setBulkEditMode(false); setBulkChanges({}) }} data-testid="button-bulk-cancel">
              Cancel
            </Button>
            <Button size="sm" onClick={bulkSaveAll} data-testid="button-bulk-save">
              Save All
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
