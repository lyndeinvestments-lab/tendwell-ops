import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { StatCard } from '@/components/StatCard'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmtCurrency, fmtPct } from '@/lib/financials/format'
import { profitColorClass } from '@/lib/profit-colors'
import { Search, X, Building2, DollarSign, TrendingDown, Percent, Download, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'

// Per-Property Profitability — real monthly economics per property from the
// property_month_financials view: revenue and cleaner pay are ACTUALS when
// we have them (QBO class income → invoicing → sheet estimate, labeled per
// cell), laundry+consumables come from the per-clean formula columns, and
// company overhead (inspections, trash, leadership, opex) is the real QBO
// monthly pool allocated by task share — not the flat $18/$5 averages.

interface PmfRow {
  property_id: number
  property_name: string
  stage_name: string | null
  month: string
  cleans: number
  deep_cleans: number
  invoiced_revenue: number
  invoiced_pay: number
  qbo_income: number
  revenue: number
  revenue_source: 'qbo' | 'invoiced' | 'estimate'
  cleaner_pay: number
  pay_source: 'invoiced' | 'estimate'
  variable_costs: number
  allocated_overhead: number
  overhead_source: 'actual' | 'average'
  est_revenue: number
  est_cleaner_pay: number
}

interface AggRow {
  property_id: number
  property_name: string
  stage_name: string | null
  cleans: number
  deep_cleans: number
  revenue: number
  cleaner_pay: number
  variable_costs: number
  allocated_overhead: number
  profit: number
  margin: number | null
  revenueSources: Set<string>
  paySources: Set<string>
  overheadSources: Set<string>
}

type SortKey = 'property_name' | 'cleans' | 'revenue' | 'cleaner_pay' | 'variable_costs' | 'allocated_overhead' | 'profit' | 'margin'

function SourceDot({ source, t }: { source: string; t: (k: string) => string }) {
  const cls = source === 'qbo' ? 'bg-success' : source === 'invoiced' ? 'bg-info' : source === 'actual' ? 'bg-success' : 'bg-muted-foreground/50'
  return <span title={t(`profit.sources.${source}`)} className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${cls}`} />
}

export default function PropertyProfitabilityPage() {
  const { t, locale } = useLocale('financials')
  const { openPropertyModal } = usePropertyModal()
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<'1' | '3' | '12'>('1')
  const [anchorMonth, setAnchorMonth] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('profit')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const q = useQuery({
    queryKey: ['/supabase/property-month-financials'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('property_month_financials')
        .select('*')
        .order('month', { ascending: false })
        .limit(10000)
      if (error) throw error
      return ((data ?? []) as PmfRow[]).map(r => ({ ...r, month: String(r.month).slice(0, 10) }))
    },
  })

  const months = useMemo(() => {
    const set = new Set((q.data ?? []).map(r => r.month))
    return Array.from(set).sort().reverse()
  }, [q.data])

  const anchor = anchorMonth ?? months[0] ?? null

  const windowMonths = useMemo(() => {
    if (!anchor) return []
    const i = months.indexOf(anchor)
    return months.slice(i, i + Number(range))
  }, [months, anchor, range])

  const aggregated = useMemo(() => {
    const inWindow = (q.data ?? []).filter(r => windowMonths.includes(r.month))
    const byProp = new Map<number, AggRow>()
    for (const r of inWindow) {
      const acc = byProp.get(r.property_id) ?? {
        property_id: r.property_id, property_name: r.property_name, stage_name: r.stage_name,
        cleans: 0, deep_cleans: 0, revenue: 0, cleaner_pay: 0, variable_costs: 0, allocated_overhead: 0,
        profit: 0, margin: null,
        revenueSources: new Set<string>(), paySources: new Set<string>(), overheadSources: new Set<string>(),
      }
      acc.cleans += r.cleans
      acc.deep_cleans += r.deep_cleans
      acc.revenue += Number(r.revenue) || 0
      acc.cleaner_pay += Number(r.cleaner_pay) || 0
      acc.variable_costs += Number(r.variable_costs) || 0
      acc.allocated_overhead += Number(r.allocated_overhead) || 0
      if (r.cleans > 0 || r.revenue !== 0) acc.revenueSources.add(r.revenue_source)
      if (r.cleans > 0 || r.cleaner_pay !== 0) acc.paySources.add(r.pay_source)
      acc.overheadSources.add(r.overhead_source)
      byProp.set(r.property_id, acc)
    }
    const rows = Array.from(byProp.values()).filter(r => r.cleans > 0 || r.revenue !== 0 || r.cleaner_pay !== 0)
    for (const r of rows) {
      r.profit = r.revenue - r.cleaner_pay - r.variable_costs - r.allocated_overhead
      r.margin = r.revenue > 0 ? (r.profit / r.revenue) * 100 : null
    }
    return rows
  }, [q.data, windowMonths])

  const filtered = useMemo(() => {
    const base = search
      ? aggregated.filter(r => r.property_name?.toLowerCase().includes(search.toLowerCase()))
      : aggregated
    return [...base].sort((a, b) => {
      const av = a[sortKey] ?? (sortKey === 'property_name' ? '' : -Infinity)
      const bv = b[sortKey] ?? (sortKey === 'property_name' ? '' : -Infinity)
      const cmp = av! < bv! ? -1 : av! > bv! ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [aggregated, search, sortKey, sortDir])

  const totals = useMemo(() => {
    const s = filtered.reduce((acc, r) => ({
      cleans: acc.cleans + r.cleans,
      revenue: acc.revenue + r.revenue,
      pay: acc.pay + r.cleaner_pay,
      variable: acc.variable + r.variable_costs,
      overhead: acc.overhead + r.allocated_overhead,
      profit: acc.profit + r.profit,
    }), { cleans: 0, revenue: 0, pay: 0, variable: 0, overhead: 0, profit: 0 })
    return { ...s, margin: s.revenue > 0 ? (s.profit / s.revenue) * 100 : null }
  }, [filtered])

  const unprofitable = filtered.filter(r => r.profit < 0).length

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'property_name' ? 'asc' : 'desc') }
  }

  function exportCsv() {
    const header = ['Property', 'Stage', 'Cleans', 'Deep Cleans', 'Revenue', 'Revenue Source', 'Cleaner Pay', 'Pay Source', 'Laundry+Consumables', 'Allocated Overhead', 'Profit', 'Margin %']
    const lines = filtered.map(r => [
      `"${(r.property_name ?? '').replace(/"/g, '""')}"`, r.stage_name ?? '', r.cleans, r.deep_cleans,
      r.revenue.toFixed(2), Array.from(r.revenueSources).join('+'), r.cleaner_pay.toFixed(2), Array.from(r.paySources).join('+'),
      r.variable_costs.toFixed(2), r.allocated_overhead.toFixed(2), r.profit.toFixed(2), r.margin?.toFixed(1) ?? '',
    ].join(','))
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `property-profitability-${anchor}-${range}mo.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function monthLabel(iso: string): string {
    const [y, m] = iso.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString(locale === 'es' ? 'es' : 'en-US', { month: 'long', year: 'numeric' })
  }

  const SortIcon = ({ column }: { column: SortKey }) =>
    sortKey !== column ? <ArrowUpDown className="w-3 h-3 ml-1 opacity-40 inline shrink-0" />
      : sortDir === 'asc' ? <ArrowUp className="w-3 h-3 ml-1 inline shrink-0" /> : <ArrowDown className="w-3 h-3 ml-1 inline shrink-0" />

  const HeaderCell = ({ column, label, className = '' }: { column: SortKey; label: string; className?: string }) => (
    <th
      className={`text-right first:text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap ${className}`}
      onClick={() => toggleSort(column)}
    >
      {label}<SortIcon column={column} />
    </th>
  )

  if (q.isError) return <div className="p-5"><ErrorState onRetry={() => q.refetch()} /></div>

  return (
    <div className="p-5 space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={anchor ?? ''} onValueChange={v => setAnchorMonth(v)}>
          <SelectTrigger className="h-8 w-44 text-xs" data-testid="select-profit-month"><SelectValue /></SelectTrigger>
          <SelectContent>
            {months.map(m => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={range} onValueChange={v => setRange(v as '1' | '3' | '12')}>
          <SelectTrigger className="h-8 w-40 text-xs" data-testid="select-profit-range"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">{t('profit.range.one')}</SelectItem>
            <SelectItem value="3">{t('profit.range.three')}</SelectItem>
            <SelectItem value="12">{t('profit.range.twelve')}</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input type="search" placeholder={t('profit.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-8 pr-7 h-8 w-52 text-sm" data-testid="input-profit-search" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 ml-auto" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download className="w-3.5 h-3.5" /> CSV
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title={t('profit.kpi.properties')} value={filtered.length} subtitle={t('profit.kpi.cleans', { count: totals.cleans })} icon={Building2} loading={q.isLoading} />
        <StatCard title={t('profit.kpi.revenue')} value={fmtCurrency(totals.revenue)} icon={DollarSign} loading={q.isLoading} />
        <StatCard title={t('profit.kpi.profit')} value={fmtCurrency(totals.profit)} subtitle={totals.margin != null ? fmtPct(totals.margin) : undefined} icon={Percent} tone={totals.profit < 0 ? 'destructive' : 'primary'} loading={q.isLoading} />
        <StatCard title={t('profit.kpi.unprofitable')} value={unprofitable} icon={TrendingDown} tone={unprofitable > 0 ? 'destructive' : 'primary'} loading={q.isLoading} />
      </div>

      {/* Source legend */}
      <div className="flex items-center gap-4 text-2xs text-muted-foreground flex-wrap">
        <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-success inline-block" /> {t('profit.sources.qbo')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-info inline-block" /> {t('profit.sources.invoiced')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 inline-block" /> {t('profit.sources.estimate')}</span>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-muted/60 border-b border-border sticky top-0 z-10">
            <tr>
              <HeaderCell column="property_name" label={t('profit.table.property')} />
              <HeaderCell column="cleans" label={t('profit.table.cleans')} />
              <HeaderCell column="revenue" label={t('profit.table.revenue')} />
              <HeaderCell column="cleaner_pay" label={t('profit.table.cleanerPay')} />
              <HeaderCell column="variable_costs" label={t('profit.table.variableCosts')} />
              <HeaderCell column="allocated_overhead" label={t('profit.table.overhead')} />
              <HeaderCell column="profit" label={t('profit.table.profit')} />
              <HeaderCell column="margin" label={t('profit.table.margin')} />
            </tr>
          </thead>
          <tbody>
            {q.isLoading ? (
              [...Array(10)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">{[...Array(8)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}</tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="py-12"><EmptyState icon={Building2} title={t('profit.emptyTitle')} description={t('profit.emptyDescription')} /></td></tr>
            ) : (
              <>
                {filtered.map(r => (
                  <tr key={r.property_id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${r.profit < 0 ? 'bg-destructive/5' : ''}`} data-testid={`row-profit-${r.property_id}`}>
                    <td className="py-2 px-3">
                      <button className="font-medium text-left hover:underline truncate max-w-[220px] block" onClick={() => openPropertyModal(String(r.property_id), 'profitability')} title={r.property_name}>
                        {r.property_name}
                      </button>
                      <span className="text-2xs text-muted-foreground">{r.stage_name ?? ''}</span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {r.cleans}{r.deep_cleans > 0 && <span className="text-2xs text-muted-foreground"> (+{r.deep_cleans}D)</span>}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      <span className="inline-flex items-center gap-1.5 justify-end">
                        {Array.from(r.revenueSources).map(s => <SourceDot key={s} source={s} t={t} />)}
                        {fmtCurrency(r.revenue)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      <span className="inline-flex items-center gap-1.5 justify-end">
                        {Array.from(r.paySources).map(s => <SourceDot key={s} source={s} t={t} />)}
                        {fmtCurrency(r.cleaner_pay)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{fmtCurrency(r.variable_costs)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5 justify-end">
                        {Array.from(r.overheadSources).map(s => <SourceDot key={s} source={s} t={t} />)}
                        {fmtCurrency(r.allocated_overhead)}
                      </span>
                    </td>
                    <td className={`py-2 px-3 text-right tabular-nums font-semibold ${r.profit < 0 ? 'text-destructive' : ''}`}>{fmtCurrency(r.profit)}</td>
                    <td className={`py-2 px-3 text-right tabular-nums ${profitColorClass(r.margin)}`}>{r.margin != null ? fmtPct(r.margin) : '—'}</td>
                  </tr>
                ))}
                <tr className="bg-muted/40 font-semibold border-t-2 border-border">
                  <td className="py-2 px-3">{t('profit.table.totals')}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{totals.cleans}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(totals.revenue)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(totals.pay)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(totals.variable)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(totals.overhead)}</td>
                  <td className={`py-2 px-3 text-right tabular-nums ${totals.profit < 0 ? 'text-destructive' : ''}`}>{fmtCurrency(totals.profit)}</td>
                  <td className={`py-2 px-3 text-right tabular-nums ${profitColorClass(totals.margin)}`}>{totals.margin != null ? fmtPct(totals.margin) : '—'}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-2xs text-muted-foreground max-w-3xl">{t('profit.methodology')}</p>
    </div>
  )
}
