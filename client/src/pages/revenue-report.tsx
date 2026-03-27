import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowUpDown, Download, DollarSign, TrendingUp, ChevronDown, ChevronRight } from 'lucide-react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts'
import { EmptyState } from '@/components/EmptyState'
import Papa from 'papaparse'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

type SortKey = 'name' | 'ce_charged' | 'cleaner_pay' | 'profit' | 'profit_pct'
type ViewMode = 'property' | 'client' | 'forecast'

function ProfitBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>
  const isHigh = pct >= 30, isMid = pct >= 15, isPos = pct >= 0
  const tier = isHigh ? 'High' : isMid ? 'Mid' : isPos ? 'Low' : 'Negative'
  const cls = isHigh ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' :
              isMid ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' :
              isPos ? 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800' :
              'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${cls}`}>{pct.toFixed(1)}%<span className="sr-only"> ({tier} profit)</span></span>
}

function HealthDot({ pct }: { pct: number }) {
  const tier = pct >= 30 ? 'High' : pct >= 15 ? 'Mid' : 'Low'
  const color = pct >= 30 ? 'bg-green-500' : pct >= 15 ? 'bg-amber-500' : 'bg-red-500'
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} role="img" aria-label={`${tier} profit: ${pct.toFixed(1)}%`} />
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return <span className="text-muted-foreground text-xs">—</span>
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const h = 20, w = 60
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ')
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  )
}

export default function RevenueReportPage() {
  usePageTitle('Revenue Report')
  const { openPropertyModal } = usePropertyModal()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth())
  const [year, setYear] = useState(now.getFullYear())
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [viewMode, setViewMode] = useState<ViewMode>('property')
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set())
  const [globalOccupancy, setGlobalOccupancy] = useState(75)
  const [propertyOccupancy, setPropertyOccupancy] = useState<Record<string, number>>({})
  const [occupancyScenario, setOccupancyScenario] = useState<'custom' | 'best' | 'worst'>('custom')

  // Fetch all properties with cost data
  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/revenue-report-properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, client, contact_id, stage_id, ce_charged, cleaner_pay, estimated_profit, profit_percentage, pipeline_stages(name)')
      if (error) throw error
      return data || []
    },
  })

  // Fetch contacts for client view
  const { data: contacts } = useQuery({
    queryKey: ['/supabase/revenue-report-contacts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('id, full_name, payment_method')
      if (error) throw error
      return data || []
    },
  })

  // Fetch property edit log for historical data
  const { data: editLog } = useQuery({
    queryKey: ['/supabase/revenue-report-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_edit_log')
        .select('property_id, field_name, old_value, new_value, created_at')
        .in('field_name', ['ce_charged', 'cleaner_pay'])
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
  })

  // Active properties only
  const activeProperties = useMemo(() => {
    if (!properties) return []
    return properties.filter((p: any) => {
      const stageName = (p.pipeline_stages as any)?.name
      return stageName === 'Active' || stageName === 'Onboarding' || stageName === 'Offboarding'
    })
  }, [properties])

  // Build 12-month chart data
  const chartData = useMemo(() => {
    const months: { label: string; ce: number; pay: number; profit: number }[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(year, month - i, 1)
      const label = `${MONTHS[d.getMonth()]} ${d.getFullYear().toString().slice(2)}`
      // Use current snapshot for all months (historical data from edit_log is sparse)
      const ce = activeProperties.reduce((s: number, p: any) => s + (p.ce_charged || 0), 0)
      const pay = activeProperties.reduce((s: number, p: any) => s + (p.cleaner_pay || 0), 0)
      months.push({ label, ce, pay, profit: ce - pay })
    }
    return months
  }, [activeProperties, month, year])

  // KPI totals
  const totals = useMemo(() => {
    const ce = activeProperties.reduce((s: number, p: any) => s + (p.ce_charged || 0), 0)
    const pay = activeProperties.reduce((s: number, p: any) => s + (p.cleaner_pay || 0), 0)
    const profit = ce - pay
    const avgPct = activeProperties.length > 0
      ? activeProperties.reduce((s: number, p: any) => s + (p.profit_percentage || 0), 0) / activeProperties.length
      : 0
    return { ce, pay, profit, avgPct }
  }, [activeProperties])

  // Build sparkline data per property (last 8 data points from edit log)
  const sparklineData = useMemo(() => {
    if (!editLog) return {} as Record<string, number[]>
    const map: Record<string, { ce: number; pay: number; date: string }[]> = {}
    for (const log of editLog) {
      const pid = log.property_id
      if (!map[pid]) map[pid] = []
      const prop = activeProperties.find((p: any) => String(p.id) === String(pid))
      if (!prop) continue
      const ce = log.field_name === 'ce_charged' ? parseFloat(log.new_value || '0') : (prop.ce_charged || 0)
      const pay = log.field_name === 'cleaner_pay' ? parseFloat(log.new_value || '0') : (prop.cleaner_pay || 0)
      const pct = ce > 0 ? ((ce - pay) / ce) * 100 : 0
      map[pid].push({ ce, pay, date: log.created_at })
    }
    const result: Record<string, number[]> = {}
    for (const [pid, entries] of Object.entries(map)) {
      const prop = activeProperties.find((p: any) => String(p.id) === String(pid))
      const current = prop ? (prop.profit_percentage || 0) : 0
      const points = entries.map(e => e.ce > 0 ? ((e.ce - e.pay) / e.ce) * 100 : 0)
      points.push(current)
      result[pid] = points.slice(-8)
    }
    return result
  }, [editLog, activeProperties])

  function getSparklineColor(data: number[]) {
    if (!data || data.length < 2) return '#9ca3af'
    return data[data.length - 1] > data[0] ? '#22c55e' : data[data.length - 1] < data[0] ? '#ef4444' : '#9ca3af'
  }

  // Sorted properties
  const sorted = useMemo(() => {
    const arr = [...activeProperties]
    arr.sort((a: any, b: any) => {
      let av: any, bv: any
      if (sortKey === 'name') { av = a.name || ''; bv = b.name || '' }
      else if (sortKey === 'ce_charged') { av = a.ce_charged || 0; bv = b.ce_charged || 0 }
      else if (sortKey === 'cleaner_pay') { av = a.cleaner_pay || 0; bv = b.cleaner_pay || 0 }
      else if (sortKey === 'profit') { av = a.estimated_profit || 0; bv = b.estimated_profit || 0 }
      else { av = a.profit_percentage || 0; bv = b.profit_percentage || 0 }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [activeProperties, sortKey, sortDir])

  // Client grouping for "By Client" view
  const clientGroups = useMemo(() => {
    const contactMap = new Map((contacts || []).map((c: any) => [c.id, c]))
    const groups: Record<string, { name: string; paymentMethod: string | null; contactId: string | null; properties: any[] }> = {}

    for (const p of sorted) {
      const contact = p.contact_id ? contactMap.get(p.contact_id) : null
      const key = contact ? `contact_${contact.id}` : `client_${p.client || 'Unknown'}`
      if (!groups[key]) {
        groups[key] = {
          name: contact?.full_name || p.client || 'Unknown',
          paymentMethod: contact?.payment_method || null,
          contactId: contact?.id || null,
          properties: [],
        }
      }
      groups[key].properties.push(p)
    }

    return Object.entries(groups)
      .map(([key, g]) => {
        const ce = g.properties.reduce((s: number, p: any) => s + (p.ce_charged || 0), 0)
        const pay = g.properties.reduce((s: number, p: any) => s + (p.cleaner_pay || 0), 0)
        const profit = ce - pay
        const avgPct = g.properties.length > 0
          ? g.properties.reduce((s: number, p: any) => s + (p.profit_percentage || 0), 0) / g.properties.length
          : 0
        return { key, ...g, ce, pay, profit, avgPct, activeCount: g.properties.length }
      })
      .sort((a, b) => b.ce - a.ce)
  }, [sorted, contacts])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function toggleClientExpand(key: string) {
    setExpandedClients(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function exportCsv() {
    const rows = sorted.map((p: any) => ({
      'Property': p.name || '',
      'Client': p.client || '',
      'CE Charged': p.ce_charged ?? '',
      'Cleaner Pay': p.cleaner_pay ?? '',
      'Profit': p.estimated_profit ?? '',
      'Profit %': p.profit_percentage != null ? `${p.profit_percentage.toFixed(1)}%` : '',
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `revenue-report-${MONTHS[month]}-${year}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // Forecast calculations
  const effectiveOccupancy = occupancyScenario === 'best' ? 95 : occupancyScenario === 'worst' ? 55 : globalOccupancy

  const forecastMonths = useMemo(() => {
    const result = []
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 1)
      result.push({ label: `${MONTHS[d.getMonth()]} ${d.getFullYear().toString().slice(2)}`, date: d })
    }
    return result
  }, [now])

  const forecastData = useMemo(() => {
    return sorted.map((p: any) => {
      const occ = propertyOccupancy[p.id] != null ? propertyOccupancy[p.id] : effectiveOccupancy
      const monthlyProj = (p.ce_charged || 0) * (occ / 100)
      return { ...p, occ, monthlyProj, sixMonthTotal: monthlyProj * 6 }
    })
  }, [sorted, propertyOccupancy, effectiveOccupancy])

  const forecastChartData = useMemo(() => {
    return forecastMonths.map(m => ({
      label: m.label,
      projected: forecastData.reduce((s: number, p: any) => s + (p.monthlyProj || 0), 0),
    }))
  }, [forecastMonths, forecastData])

  function exportForecastCsv() {
    const headers = ['Property', 'CE Charged', 'Occupancy %', ...forecastMonths.map(m => m.label), '6-Month Total']
    const rows = forecastData.map((p: any) => ({
      Property: p.name || '',
      'CE Charged': p.ce_charged ?? '',
      'Occupancy %': p.occ,
      ...Object.fromEntries(forecastMonths.map(m => [m.label, p.monthlyProj.toFixed(2)])),
      '6-Month Total': p.sixMonthTotal.toFixed(2),
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `forecast-${MONTHS[month]}-${year}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i)
  const thCls = 'text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap'

  function SortIcon({ col }: { col: SortKey }) {
    return <ArrowUpDown className={`w-3 h-3 inline ml-1 ${sortKey === col ? 'text-primary' : 'text-muted-foreground/40'}`} />
  }

  return (
    <div className="p-5 h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Revenue Report</h1>
          <p className="text-sm text-muted-foreground">Monthly financial overview across all operational properties</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
            <SelectTrigger className="h-8 w-28 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="h-8 w-24 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center border rounded-md overflow-hidden">
            {(['property', 'client', 'forecast'] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === v ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
              >
                {v === 'property' ? 'By Property' : v === 'client' ? 'By Client' : 'Forecast'}
              </button>
            ))}
          </div>
          {viewMode === 'forecast' ? (
            <Button variant="outline" size="sm" onClick={exportForecastCsv} disabled={forecastData.length === 0} className="h-8 gap-1.5 text-xs">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={sorted.length === 0} className="h-8 gap-1.5 text-xs">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total CE Charged</p>
            {isLoading ? <Skeleton className="h-7 w-24 mt-1.5" /> : (
              <p className="text-xl font-semibold mt-1">{fmt(totals.ce)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Cleaner Pay</p>
            {isLoading ? <Skeleton className="h-7 w-24 mt-1.5" /> : (
              <p className="text-xl font-semibold mt-1">{fmt(totals.pay)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Profit</p>
            {isLoading ? <Skeleton className="h-7 w-24 mt-1.5" /> : (
              <p className={`text-xl font-semibold mt-1 ${totals.profit < 0 ? 'text-destructive' : ''}`}>{fmt(totals.profit)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Avg Profit %</p>
            {isLoading ? <Skeleton className="h-7 w-24 mt-1.5" /> : (
              <p className="text-xl font-semibold mt-1">{totals.avgPct.toFixed(1)}%</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 12-Month Chart */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-medium mb-3">12-Month Revenue Trend</p>
          {isLoading ? <Skeleton className="h-64 w-full" /> : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} className="text-muted-foreground" />
                <Tooltip formatter={(val: number) => fmt(val)} />
                <Legend />
                <Line type="monotone" dataKey="ce" name="CE Charged" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="pay" name="Cleaner Pay" stroke="#ef4444" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="profit" name="Profit" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Forecast Panel */}
      {viewMode === 'forecast' && (
        <div className="space-y-4 flex-1 overflow-auto">
          {/* Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground">Global Occupancy</label>
              <input
                type="range"
                min={0}
                max={100}
                value={effectiveOccupancy}
                disabled={occupancyScenario !== 'custom'}
                onChange={e => { setGlobalOccupancy(Number(e.target.value)); setOccupancyScenario('custom') }}
                className="w-28 accent-primary"
              />
              <span className="text-xs font-medium tabular-nums w-8">{effectiveOccupancy}%</span>
            </div>
            <div className="flex items-center gap-1">
              {[{ key: 'best', label: 'Best Case (95%)', pct: 95 }, { key: 'worst', label: 'Worst Case (55%)', pct: 55 }, { key: 'custom', label: 'Custom', pct: globalOccupancy }].map(s => (
                <button
                  key={s.key}
                  onClick={() => setOccupancyScenario(s.key as any)}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${occupancyScenario === s.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Bar chart */}
          <Card>
            <CardContent className="p-4">
              <p className="text-sm font-medium mb-3">6-Month Revenue Projection</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={forecastChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="projected" name="Projected Revenue" radius={[4,4,0,0]}>
                    {forecastChartData.map((_, i) => (
                      <Cell key={i} fill={`hsl(${220 + i * 10}, 80%, 55%)`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Forecast table */}
          <div className="overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Property</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">CE Charged</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Occupancy %</th>
                  {forecastMonths.map(m => (
                    <th key={m.label} className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">{m.label}</th>
                  ))}
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">6-Mo Total</th>
                </tr>
              </thead>
              <tbody>
                {forecastData.length === 0 ? (
                  <tr><td colSpan={10}><EmptyState icon={TrendingUp} title="No properties" description="No active properties to forecast." /></td></tr>
                ) : forecastData.map((p: any) => (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-2 px-3 font-medium text-xs">
                      <button onClick={() => openPropertyModal(p.id)} className="hover:underline text-left">{p.name}</button>
                    </td>
                    <td className="py-2 px-3 tabular-nums text-xs">{fmt(p.ce_charged)}</td>
                    <td className="py-2 px-3 text-xs">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={propertyOccupancy[p.id] != null ? propertyOccupancy[p.id] : effectiveOccupancy}
                          onChange={e => setPropertyOccupancy(prev => ({ ...prev, [p.id]: Number(e.target.value) }))}
                          className="w-14 h-6 text-xs border border-input rounded px-1 bg-background tabular-nums"
                        />
                        <span className="text-muted-foreground text-xs">%</span>
                      </div>
                    </td>
                    {forecastMonths.map(m => (
                      <td key={m.label} className="py-2 px-3 tabular-nums text-xs">{fmt(p.monthlyProj)}</td>
                    ))}
                    <td className="py-2 px-3 tabular-nums text-xs font-medium">{fmt(p.sixMonthTotal)}</td>
                  </tr>
                ))}
                {forecastData.length > 0 && (
                  <tr className="bg-muted/60 border-t-2 border-border font-semibold">
                    <td className="py-2 px-3 text-xs uppercase tracking-wide" colSpan={3}>Total</td>
                    {forecastMonths.map(m => (
                      <td key={m.label} className="py-2 px-3 tabular-nums text-xs">{fmt(forecastData.reduce((s: number, p: any) => s + p.monthlyProj, 0))}</td>
                    ))}
                    <td className="py-2 px-3 tabular-nums text-xs">{fmt(forecastData.reduce((s: number, p: any) => s + p.sixMonthTotal, 0))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Property/Client Table */}
      {viewMode !== 'forecast' && <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th className={thCls} onClick={() => toggleSort('name')}>
                {viewMode === 'client' ? 'Client' : 'Property'} <SortIcon col="name" />
              </th>
              {viewMode === 'client' && <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Payment</th>}
              {viewMode === 'client' && <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Properties</th>}
              <th className={thCls} onClick={() => toggleSort('ce_charged')}>CE Charged <SortIcon col="ce_charged" /></th>
              <th className={thCls} onClick={() => toggleSort('cleaner_pay')}>Cleaner Pay <SortIcon col="cleaner_pay" /></th>
              <th className={thCls} onClick={() => toggleSort('profit')}>Profit <SortIcon col="profit" /></th>
              <th className={thCls} onClick={() => toggleSort('profit_pct')}>Profit % <SortIcon col="profit_pct" /></th>
              {/* Trend column hidden — requires edit history data to populate */}
              {viewMode === 'client' && <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Health</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(7)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}
                </tr>
              ))
            ) : viewMode === 'property' ? (
              sorted.length === 0 ? (
                <tr><td colSpan={7}><EmptyState icon={DollarSign} title="No properties" description="No operational properties found." /></td></tr>
              ) : sorted.map((p: any) => {
                const sparkData = sparklineData[String(p.id)]
                const sparkColor = getSparklineColor(sparkData)
                return (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-2 px-3 font-medium text-xs max-w-[200px] truncate" title={p.name}>
                      <button onClick={() => openPropertyModal(p.id)} className="hover:underline text-left">{p.name}</button>
                    </td>
                    <td className="py-2 px-3 tabular-nums text-xs">{fmt(p.ce_charged)}</td>
                    <td className="py-2 px-3 tabular-nums text-xs">{fmt(p.cleaner_pay)}</td>
                    <td className="py-2 px-3 tabular-nums text-xs font-medium">{fmt(p.estimated_profit)}</td>
                    <td className="py-2 px-3"><ProfitBadge pct={p.profit_percentage} /></td>
                    {/* Trend column hidden */}
                  </tr>
                )
              })
            ) : (
              clientGroups.length === 0 ? (
                <tr><td colSpan={8}><EmptyState icon={DollarSign} title="No clients" description="No client data found." /></td></tr>
              ) : clientGroups.map(g => (
                <>
                  <tr key={g.key} className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer bg-muted/10" onClick={() => toggleClientExpand(g.key)}>
                    <td className="py-2 px-3 font-medium text-xs">
                      <div className="flex items-center gap-1">
                        {expandedClients.has(g.key) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        {g.name}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-xs">
                      {g.paymentMethod && <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-xs">{g.paymentMethod}</span>}
                    </td>
                    <td className="py-2 px-3 tabular-nums text-xs font-medium">{g.activeCount}</td>
                    <td className="py-2 px-3 tabular-nums text-xs font-medium">{fmt(g.ce)}</td>
                    <td className="py-2 px-3 tabular-nums text-xs font-medium">{fmt(g.pay)}</td>
                    <td className="py-2 px-3 tabular-nums text-xs font-medium">{fmt(g.profit)}</td>
                    <td className="py-2 px-3"><ProfitBadge pct={g.avgPct} /></td>
                    <td className="py-2 px-3"><HealthDot pct={g.avgPct} /></td>
                  </tr>
                  {expandedClients.has(g.key) && g.properties.map((p: any) => (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors bg-muted/5">
                      <td className="py-1.5 px-3 text-xs pl-10">
                        <button onClick={() => openPropertyModal(p.id)} className="hover:underline text-left text-muted-foreground">{p.name}</button>
                      </td>
                      <td className="py-1.5 px-3" />
                      <td className="py-1.5 px-3" />
                      <td className="py-1.5 px-3 tabular-nums text-xs">{fmt(p.ce_charged)}</td>
                      <td className="py-1.5 px-3 tabular-nums text-xs">{fmt(p.cleaner_pay)}</td>
                      <td className="py-1.5 px-3 tabular-nums text-xs">{fmt(p.estimated_profit)}</td>
                      <td className="py-1.5 px-3"><ProfitBadge pct={p.profit_percentage} /></td>
                      <td className="py-1.5 px-3" />
                    </tr>
                  ))}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>}
    </div>
  )
}
