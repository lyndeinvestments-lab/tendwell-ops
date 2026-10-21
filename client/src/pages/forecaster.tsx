import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePageTitle } from '@/hooks/use-page-title'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { slugify } from '@/lib/issues'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/EmptyState'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import {
  TrendingUp, Calculator, BarChart3, Sparkles,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  computeDerived, generateForecast, FORECAST_PRESETS, rollupEstimates, computeVariance,
  deriveCurrentPreset, partialWindowMonth, prorateEstimates,
  type ForecastSliders, type DerivedMonth,
} from '@/lib/forecaster'
import { useInProFormaWrapper } from '@/pages/pro-forma-wrapper'
import {
  qboRowToMonthRecord, propertiesPerMonth, cleansPerMonth, cleansByPropertyFromEstimate,
  deepCleansByPropertyFromEstimate, cutoverMonth, monthKey,
  type QboPlMonthRow, type EstimatePerProperty,
} from '@/lib/financials/clean-sources'

function fmt(n: number | null | undefined, prefix = '$') {
  if (n == null) return '—'
  return `${prefix}${Math.round(n).toLocaleString('en-US')}`
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return '—'
  return `${n.toFixed(1)}%`
}

function todayMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function priorMonth(yyyymm: string, n = 1): string {
  const [y, m] = yyyymm.split('-').map(Number)
  const d = new Date(y, m - 1 - n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}


export default function ForecasterPage() {
  const inWrapper = useInProFormaWrapper()
  const { t } = useLocale('financials')
  usePageTitle(inWrapper ? t('forecaster.page.titleWrapped') : t('forecaster.page.title', undefined, 'Forecaster'))

  // Default to the latest FULL month: QBO writes the current month from day 1,
  // so its KPIs are month to date.
  const [selectedMonth, setSelectedMonth] = useState<string>(priorMonth(todayMonth()))
  const [seasonal, setSeasonal] = useState(true)
  const [sliders, setSliders] = useState<ForecastSliders>(FORECAST_PRESETS.current)
  const slidersTouched = useRef(false)
  const editSliders = (next: ForecastSliders | ((s: ForecastSliders) => ForecastSliders)) => {
    slidersTouched.current = true
    setSliders(next)
  }

  // ── Monthly P&L actuals: qbo_pl_months (nightly QBO sync) ───────────────
  // Replaces the hand-seeded proforma_months table. Same source as the P&L tab.
  const { data: qboMonths, isLoading: loadingMonths } = useQuery({
    queryKey: ['/supabase/qbo-pl-months-forecaster'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('qbo_pl_months')
        .select('month, total_income, total_cogs, total_expenses, income_breakdown, cogs_breakdown')
        .order('month', { ascending: true })
      if (error) throw error
      return (data || []) as QboPlMonthRow[]
    },
  })

  // ── Canonical monthly clean counts (deduped view) ───────────────────────
  // financial_monthly_cleans is the same view the Financial Overview uses:
  // Trellis from the clean_source_cutover month on, the Breezeway archive
  // before it.
  const { data: monthlyCleans } = useQuery({
    queryKey: ['/supabase/financial-monthly-cleans'],
    queryFn: async () => {
      const { data, error } = await supabase.from('financial_monthly_cleans').select('month, cleans')
      if (error) throw error
      return (data || []) as Array<{ month: string; cleans: number }>
    },
  })

  // Properties with at least one clean per month (property_monthly_cleans,
  // same cutover rule). Paged: the view has a few thousand rows.
  const { data: pmcByMonth } = useQuery({
    queryKey: ['/supabase/property-monthly-cleans-forecaster'],
    staleTime: 300_000,
    queryFn: async () => {
      const rows: Array<{ property_id: number; month: string; cleans: number }> = []
      const PAGE = 1000
      for (let from = 0; from < 50_000; from += PAGE) {
        const { data, error } = await (supabase as any)
          .from('property_monthly_cleans')
          .select('property_id, month, cleans')
          .gt('cleans', 0)
          .order('month')
          .order('property_id')
          .range(from, from + PAGE - 1)
        if (error) throw error
        rows.push(...((data || []) as typeof rows))
        if (!data || data.length < PAGE) break
      }
      return { props: propertiesPerMonth(rows), cleans: cleansPerMonth(rows) }
    },
  })

  // Trellis sync status pill + cutover month (both staff-only definer RPCs).
  const { data: trellisSync } = useQuery({
    queryKey: ['/supabase/forecaster-trellis-sync'],
    staleTime: 300_000,
    queryFn: async () => {
      const [fresh, cut] = await Promise.all([
        (supabase as any).rpc('trellis_sync_freshness'),
        (supabase as any).rpc('clean_source_cutover'),
      ])
      const row = !fresh.error && Array.isArray(fresh.data) ? fresh.data[0] : null
      return {
        lastSuccessAt: (row?.last_success_at as string | null | undefined) ?? null,
        lastSuccessStatus: (row?.last_success_status as string | null | undefined) ?? null,
        cutover: cut.error ? null : cutoverMonth(cut.data as string | null),
      }
    },
  })

  const histData: DerivedMonth[] = useMemo(() => {
    if (!qboMonths) return []
    const cleanMap = new Map<string, number>()
    for (const c of monthlyCleans || []) cleanMap.set(c.month, Number(c.cleans))
    const partial = partialWindowMonth(Array.from(cleanMap.keys()), new Date())
    if (partial) cleanMap.delete(partial)
    return qboMonths.map(r => {
      const key = monthKey(r.month)
      // Months financial_monthly_cleans does not fully cover fall back to
      // property_monthly_cleans (month-aligned, trailing 14 months).
      const tasks = cleanMap.get(key) ?? pmcByMonth?.cleans.get(key)
      return computeDerived(qboRowToMonthRecord(r, tasks, pmcByMonth?.props.get(key)))
    })
  }, [qboMonths, monthlyCleans, pmcByMonth])

  // The forecast starts from the latest COMPLETE month (the current month is
  // partial in QBO).
  const derivedPreset = useMemo(
    () => deriveCurrentPreset(histData, { asOfMonth: todayMonth(), seasonal }),
    [histData, seasonal],
  )
  useEffect(() => {
    if (!slidersTouched.current && derivedPreset.sourceMonths.length > 0) setSliders(derivedPreset.sliders)
  }, [derivedPreset])

  const isCurrentMonth = selectedMonth === todayMonth()
  const monthProgress = useMemo(() => {
    const now = new Date()
    return { day: now.getDate(), days: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() }
  }, [])
  const prevMonth = useMemo(() => {
    const idx = histData.findIndex(m => m.month === selectedMonth)
    return idx > 0 ? histData[idx - 1] : undefined
  }, [histData, selectedMonth])

  // ── Operational properties for per-property estimate rollup ─────────────
  const { data: properties } = useQuery({
    queryKey: ['/supabase/operational_properties_forecaster'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, ce_charged, deep_clean_3x_ce, cleaner_pay, est_laundry, est_consumables, inspection_cost, trash_cost')
      if (error) throw error
      return data || []
    },
  })

  // ── Cleans per property for the selected month ──────────────────────────
  // compute_monthly_estimate(): from the cutover month on, Tendwell's Trellis
  // cleans (completed, plus scheduled from today on); before it, the
  // Breezeway archive. Drives the estimate column and the live estimate.
  const { data: monthEstimate } = useQuery({
    queryKey: ['/supabase/compute-monthly-estimate', selectedMonth],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('compute_monthly_estimate', { target_month: `${selectedMonth}-01` })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      return {
        perProperty: (row?.per_property ?? []) as EstimatePerProperty[],
        cleans: Number(row?.cleans_count ?? 0) + Number(row?.deep_cleans_count ?? 0),
        activeProperties: Number(row?.active_properties ?? 0),
      }
    },
  })

  const tasksByProperty = useMemo(
    () => cleansByPropertyFromEstimate(monthEstimate?.perProperty),
    [monthEstimate],
  )
  const deepByProperty = useMemo(
    () => deepCleansByPropertyFromEstimate(monthEstimate?.perProperty),
    [monthEstimate],
  )
  const totalPeriodTasks = monthEstimate?.cleans ?? 0
  const activePropsInPeriod = monthEstimate?.activeProperties ?? 0

  // Completed cleans for the selected month (financial_monthly_cleans, same
  // source as Financial Overview). For the current month this is "so far",
  // while totalPeriodTasks also counts cleans scheduled through month end.
  const completedTasks = useMemo<number | null>(() => {
    const canon = (monthlyCleans || []).find(c => c.month === selectedMonth)
    if (canon) return Number(canon.cleans)
    return pmcByMonth?.cleans.get(selectedMonth) ?? null
  }, [monthlyCleans, pmcByMonth, selectedMonth])

  // Estimated costs (rolled up from per-property cost-tracking estimates)
  const estimates = useMemo(() => {
    if (!properties) return null
    return rollupEstimates(properties as any[], tasksByProperty, deepByProperty)
  }, [properties, tasksByProperty, deepByProperty])

  // Current month: share of the month's estimated cleans already completed,
  // used to compare the estimate with QBO month-to-date like for like.
  const completedShare = isCurrentMonth && completedTasks != null && totalPeriodTasks > 0
    ? Math.min(completedTasks / totalPeriodTasks, 1)
    : null

  // ── LIVE ESTIMATE (cleans × per-property rates) ─────────────────────────
  // When QuickBooks has no posted actuals for the month (current/future
  // months), show the estimate as the month's numbers instead of $0 KPIs.
  const estimateRow = useMemo<DerivedMonth | null>(() => {
    if (!estimates) return null
    const cogs = estimates.contractorPay + estimates.laundry + estimates.supplies + estimates.inspections + estimates.trash
    if (estimates.revenue === 0 && cogs === 0) return null
    const d = computeDerived({
      month: selectedMonth,
      cleaningFee: estimates.revenue,
      contractorPay: estimates.contractorPay,
      laundry: estimates.laundry,
      supplies: estimates.supplies,
      inspections: estimates.inspections,
      trash: estimates.trash,
      tasks: totalPeriodTasks,
      properties: activePropsInPeriod,
    })
    return d
  }, [estimates, selectedMonth, totalPeriodTasks, activePropsInPeriod])

  // Actuals for the selected month: the QBO month when it has real signal,
  // otherwise the live estimate.
  const qboRow = useMemo<DerivedMonth | null>(
    () => histData.find(m => m.month === selectedMonth) || null,
    [histData, selectedMonth],
  )
  const qboHasSignal = !!qboRow && (Math.abs(qboRow.revenue) + Math.abs(qboRow.cogs) + Math.abs(qboRow.opex || 0)) >= 1

  const actualsSource: 'qbo' | 'estimate' | null = useMemo(() => {
    if (qboHasSignal) return 'qbo'
    if (estimateRow) return 'estimate'
    return null
  }, [qboHasSignal, estimateRow])
  const isMtd = isCurrentMonth && actualsSource === 'qbo'

  const actualsRow = useMemo<DerivedMonth | null>(() => {
    if (actualsSource === 'qbo') return qboRow
    if (actualsSource === 'estimate') return estimateRow
    return null
  }, [actualsSource, qboRow, estimateRow])

  // Variance per category: per-property estimates × cleans vs QBO actuals.
  // Current month: the estimate is prorated to cleans completed so far.
  // Leadership / Other COGS have no per-property formula (actual-only rows).
  const variance = useMemo(() => {
    if (!estimates || !actualsRow || actualsSource !== 'qbo') return null
    const est = completedShare != null ? prorateEstimates(estimates, completedShare) : estimates
    return computeVariance([
      { category: 'Laundry', estimated: est.laundry, actual: actualsRow.laundry || 0 },
      { category: 'Supplies', estimated: est.supplies, actual: actualsRow.supplies || 0 },
      { category: 'Inspections', estimated: est.inspections, actual: actualsRow.inspections || 0 },
      { category: 'Trash', estimated: est.trash, actual: actualsRow.trash || 0 },
      { category: 'Contractor Pay', estimated: est.contractorPay, actual: actualsRow.contractorPay || 0 },
      { category: 'Leadership', estimated: null, actual: actualsRow.leadership || 0 },
      { category: 'Other COGS', estimated: null, actual: actualsRow.otherCOGS || 0 },
      { category: 'Revenue', estimated: est.revenue, actual: actualsRow.revenue || 0 },
    ])
  }, [estimates, actualsRow, actualsSource, completedShare])

  // ── Forecast horizon ────────────────────────
  const forecast = useMemo(() => {
    const { startProperties, startMonth } = derivedPreset
    return generateForecast(sliders, {
      startProperties,
      startMonth: startMonth ? priorMonth(startMonth, -1) : todayMonth(),
      horizon: 12,
      seasonal,
    })
  }, [sliders, seasonal, derivedPreset])

  // ── Render ──────────────────────────────
  // QBO actuals refresh nightly; clean counts refresh with the Trellis sync.
  const monthOptions = useMemo(() => {
    const seen = new Set(histData.map(m => m.month))
    for (const c of monthlyCleans || []) seen.add(c.month)
    seen.add(todayMonth())
    seen.add(selectedMonth)
    return Array.from(seen).sort().reverse()
  }, [histData, monthlyCleans, selectedMonth])

  const isLoading = loadingMonths

  const controls = (
    <div className="flex items-center gap-2 flex-wrap">
      <Select value={selectedMonth} onValueChange={setSelectedMonth}>
        <SelectTrigger className="h-8 w-36 text-sm" data-testid="select-forecaster-month">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {monthOptions.map(m => (
            <SelectItem key={m} value={m}>{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-2xs text-muted-foreground" data-testid="text-qbo-refresh-note">
        {t('forecaster.page.qboRefreshNote')}
      </span>
    </div>
  )

  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      {!inWrapper ? (
        <PageHeader
          title={t('forecaster.page.title')}
          subtitle={t('forecaster.page.subtitle')}
          actions={controls}
        />
      ) : (
        <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
          <div className="text-xs text-muted-foreground">{t('forecaster.page.periodSources')}</div>
          {controls}
        </div>
      )}

      {trellisSync ? (
        <div
          className="rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs flex flex-wrap items-center gap-x-3 gap-y-1"
          data-testid="status-trellis-sync"
        >
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Sparkles className="w-3 h-3 text-primary" /> {t('forecaster.syncStatus.label')}
          </span>
          <span className="text-muted-foreground">
            {trellisSync.lastSuccessAt
              ? t('forecaster.syncStatus.lastSync', { time: formatDistanceToNow(new Date(trellisSync.lastSuccessAt), { addSuffix: true }) })
              : t('forecaster.syncStatus.never')}
            {trellisSync.lastSuccessStatus === 'partial' ? ` ${t('forecaster.syncStatus.partial')}` : ''}
          </span>
          <span className="text-muted-foreground">
            {trellisSync.cutover
              ? t('forecaster.syncStatus.cutover', { month: trellisSync.cutover })
              : t('forecaster.syncStatus.noCutover')}
          </span>
        </div>
      ) : null}

      {actualsSource === 'estimate' && (
        <div
          className="rounded-md border border-info/25 bg-info/10 px-3 py-2 text-xs text-info"
          data-testid="actuals-source-banner-estimate"
        >
          {t('forecaster.banners.estimatePrefix')} <strong>{t('forecaster.banners.estimateBold')}</strong> {t('forecaster.banners.estimateSuffix', { month: selectedMonth })}
        </div>
      )}
      {isMtd && (
        <div
          className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning"
          data-testid="actuals-source-banner-mtd"
        >
          {t('forecaster.banners.mtd', { month: selectedMonth, day: monthProgress.day, days: monthProgress.days })}
        </div>
      )}
      {actualsSource === null && (
        <div
          className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning"
          data-testid="actuals-source-banner-empty"
        >
          {t('forecaster.banners.emptyNoData', { month: selectedMonth })}
        </div>
      )}

      {/* KPI row — actuals vs prior month */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {isLoading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)
        ) : actualsRow ? (
          <>
            <StatCard
              title={t('forecaster.kpis.revenue')}
              value={fmt(actualsRow.revenue)}
              subtitle={isMtd
                ? t('forecaster.kpis.revenueMtd')
                : prevMonth && actualsSource === 'qbo'
                  ? t('forecaster.kpis.revenueVsPrior', { arrow: actualsRow.revenue >= prevMonth.revenue ? '▲' : '▼', pct: fmtPct(((actualsRow.revenue - prevMonth.revenue) / Math.max(prevMonth.revenue, 1)) * 100), month: prevMonth.label })
                  : actualsSource === 'qbo' ? t('forecaster.kpis.revenueSourceQbo') : undefined}
            />
            <StatCard
              title={t('forecaster.kpis.netIncome')}
              value={fmt(actualsRow.netIncome)}
              tone={actualsRow.netIncome < 0 ? 'destructive' : 'primary'}
              subtitle={t(isMtd ? 'forecaster.kpis.netIncomeMarginMtd' : 'forecaster.kpis.netIncomeMargin', { pct: fmtPct(actualsRow.netMargin) })}
            />
            <StatCard
              title={t('forecaster.kpis.tasks')}
              value={String(completedTasks ?? (totalPeriodTasks || actualsRow.tasks || 0))}
              subtitle={isCurrentMonth && completedTasks != null
                ? t('forecaster.kpis.tasksSubtitleMtd', { scheduled: totalPeriodTasks, count: actualsRow.properties ?? activePropsInPeriod ?? 0 })
                : t('forecaster.kpis.tasksSubtitle', { count: actualsRow.properties ?? activePropsInPeriod ?? 0 })}
            />
            <StatCard
              title={t('forecaster.kpis.grossMargin')}
              value={fmtPct(actualsRow.grossMargin)}
              subtitle={t(isMtd ? 'forecaster.kpis.grossMarginSubtitleMtd' : 'forecaster.kpis.grossMarginSubtitle', { amount: fmt(actualsRow.cogs) })}
            />
          </>
        ) : (
          <Card className="col-span-full border-dashed">
            <CardContent className="p-6">
              <EmptyState
                icon={Calculator}
                title={t('forecaster.kpis.emptyTitle')}
                description={t('forecaster.kpis.emptyDescription')}
              />
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs defaultValue="variance" className="flex-1 flex flex-col">
        <TabsList className="self-start">
          <TabsTrigger value="variance" data-testid="tab-variance">{t('forecaster.tabs.variance')}</TabsTrigger>
          <TabsTrigger value="historical" data-testid="tab-historical">{t('forecaster.tabs.historical')}</TabsTrigger>
          <TabsTrigger value="forecast" data-testid="tab-forecast">{t('forecaster.tabs.forecast')}</TabsTrigger>
        </TabsList>

        {/* ── Variance tab ───────────────────────── */}
        <TabsContent value="variance" className="flex-1 mt-3 space-y-3">
          <Card className="border-card-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">{t('forecaster.variance.heading', { month: selectedMonth })}</h3>
                </div>
                <span className="text-xs text-muted-foreground">
                  {isCurrentMonth && completedTasks != null
                    ? t('forecaster.variance.taskSummaryMtd', { completed: completedTasks, tasks: totalPeriodTasks, properties: activePropsInPeriod })
                    : t('forecaster.variance.taskSummary', { tasks: totalPeriodTasks, properties: activePropsInPeriod })}
                </span>
              </div>
              {variance && completedShare != null && (
                <p className="text-xs text-muted-foreground mb-3" data-testid="text-variance-prorated">
                  {t('forecaster.variance.proratedNote', { completed: completedTasks ?? 0, tasks: totalPeriodTasks, pct: fmtPct(completedShare * 100) })}
                </p>
              )}
              {actualsSource === 'estimate' ? (
                <p className="text-xs text-muted-foreground" data-testid="text-variance-estimate-source">
                  {t('forecaster.variance.estimateSourceNote', { month: selectedMonth })}
                </p>
              ) : !variance ? (
                <EmptyState
                  icon={Calculator}
                  title={t('forecaster.variance.emptyTitle')}
                  description={t('forecaster.variance.emptyDescription')}
                />
              ) : (
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.variance.headers.category')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.variance.headers.estimated')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.variance.headers.actual')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.variance.headers.variance')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.variance.headers.percentVariance')}</th>
                      <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 pl-3">{t('forecaster.variance.headers.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variance.map(row => {
                      const isRevenue = row.category === 'Revenue'
                      // For revenue, "favorable" = actual ≥ estimated (more revenue is good).
                      const fav = row.variance == null ? null : isRevenue ? row.variance >= 0 : row.favorable
                      const neutral = fav == null || isCurrentMonth
                      const tone = neutral ? 'text-muted-foreground' : fav ? 'text-success' : 'text-destructive'
                      // `row.category` is a plain UI string from the computeVariance
                      // call sites (not a DB enum) — displayed via slug lookup with
                      // the raw value as fallback; the data-testid below still keys
                      // off the untranslated category so selectors stay stable.
                      return (
                        <tr key={row.category} className="border-b border-border/50" data-testid={`variance-row-${row.category.toLowerCase().replace(/\s+/g, '-')}`}>
                          <td className="py-2 text-foreground">{t(`forecaster.variance.category.${slugify(row.category)}`, undefined, row.category)}</td>
                          <td className="py-2 text-right tabular-nums text-foreground">{fmt(row.estimated)}</td>
                          <td className="py-2 text-right tabular-nums text-foreground">{fmt(row.actual)}</td>
                          <td className={`py-2 text-right tabular-nums font-medium ${tone}`}>
                            {row.variance != null && row.variance > 0 ? '+' : ''}{fmt(row.variance)}
                          </td>
                          <td className={`py-2 text-right tabular-nums ${tone}`}>
                            {fmtPct(row.variancePct)}
                          </td>
                          <td className="py-2 pl-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${neutral
                              ? 'text-muted-foreground bg-muted/40 border-border'
                              : fav
                                ? 'text-success bg-success/10 border-success/25'
                                : 'text-destructive bg-destructive/10 border-destructive/25'}`}>
                              {fav == null
                                ? t('forecaster.variance.actualOnly')
                                : isCurrentMonth
                                  ? t('forecaster.variance.pending')
                                  : fav ? t('forecaster.variance.favorable') : t('forecaster.variance.unfavorable')}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Historical tab ───────────────────────── */}
        <TabsContent value="historical" className="flex-1 mt-3 space-y-3">
          <Card className="border-card-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-muted-foreground" /> {t('forecaster.historical.chartTitle')}
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="revenue" name={t('forecaster.kpis.revenue')} fill="hsl(var(--primary))" />
                    <Bar dataKey="netIncome" name={t('forecaster.kpis.netIncome')} fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border-card-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-3">{t('forecaster.historical.tableTitle')}</h3>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.month')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.tasks')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.properties')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.revenue')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.cogs')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.grossProfit')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.netIncome')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.gmPercent')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {histData.map(m => (
                      <tr key={m.month} className="border-b border-border/50">
                        <td className="py-2 font-medium">{m.label}</td>
                        <td className="py-2 text-right tabular-nums">{m.tasks ?? '—'}</td>
                        <td className="py-2 text-right tabular-nums">{m.properties ?? '—'}</td>
                        <td className="py-2 text-right tabular-nums">{fmt(m.revenue)}</td>
                        <td className="py-2 text-right tabular-nums">{fmt(m.cogs)}</td>
                        <td className="py-2 text-right tabular-nums">{fmt(m.grossProfit)}</td>
                        <td className={`py-2 text-right tabular-nums ${m.netIncome < 0 ? 'text-destructive' : ''}`}>{fmt(m.netIncome)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtPct(m.grossMargin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Forecast tab ───────────────────────── */}
        <TabsContent value="forecast" className="flex-1 mt-3 space-y-3">
          <Card className="border-card-border">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-muted-foreground" /> {t('forecaster.forecast.heading')}
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  {(['current', 'conservative', 'aggressive'] as const).map(p => (
                    <Button key={p} size="sm" variant="outline" className="h-7 text-xs" onClick={() => editSliders(p === 'current' ? derivedPreset.sliders : FORECAST_PRESETS[p])}>
                      {t(`forecaster.forecast.presets.${p}`)}
                    </Button>
                  ))}
                  <div className="flex items-center gap-2">
                    <Switch checked={seasonal} onCheckedChange={setSeasonal} id="seasonal-toggle" />
                    <Label htmlFor="seasonal-toggle" className="text-xs">{t('forecaster.forecast.seasonal')}</Label>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SliderInput label={t('forecaster.forecast.sliders.propGrowth')} value={sliders.propGrowth} onChange={v => editSliders(s => ({ ...s, propGrowth: v }))} step={1} />
                <SliderInput label={t('forecaster.forecast.sliders.tasksPerProp')} value={sliders.tasksPerProp} onChange={v => editSliders(s => ({ ...s, tasksPerProp: v }))} step={0.1} />
                <SliderInput label={t('forecaster.forecast.sliders.revPerTask')} value={sliders.revPerTask} onChange={v => editSliders(s => ({ ...s, revPerTask: v }))} step={5} />
                <SliderInput label={t('forecaster.forecast.sliders.contractorPct')} value={sliders.contractorPct} onChange={v => editSliders(s => ({ ...s, contractorPct: v }))} step={1} />
                <SliderInput label={t('forecaster.forecast.sliders.laundryPct')} value={sliders.laundryPct} onChange={v => editSliders(s => ({ ...s, laundryPct: v }))} step={1} />
                <SliderInput label={t('forecaster.forecast.sliders.suppliesPct')} value={sliders.suppliesPct} onChange={v => editSliders(s => ({ ...s, suppliesPct: v }))} step={1} />
                <SliderInput label={t('forecaster.forecast.sliders.leadership')} value={sliders.leadership} onChange={v => editSliders(s => ({ ...s, leadership: v }))} step={100} />
                <SliderInput label={t('forecaster.forecast.sliders.opex')} value={sliders.opex} onChange={v => editSliders(s => ({ ...s, opex: v }))} step={100} />
              </div>

              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={forecast}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Line type="monotone" dataKey="revenue" name={t('forecaster.kpis.revenue')} stroke="hsl(var(--primary))" strokeWidth={2} />
                    <Line type="monotone" dataKey="netIncome" name={t('forecaster.kpis.netIncome')} stroke="#10b981" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border-card-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-3">{t('forecaster.forecast.detailTitle')}</h3>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.month')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.properties')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.tasks')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.revenue')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.cogs')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.grossProfit')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.netIncome')}</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">{t('forecaster.historical.headers.gmPercent')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.map(m => (
                      <tr key={m.month} className="border-b border-border/50">
                        <td className="py-2 font-medium">{m.label}</td>
                        <td className="py-2 text-right tabular-nums">{m.properties}</td>
                        <td className="py-2 text-right tabular-nums">{m.tasks}</td>
                        <td className="py-2 text-right tabular-nums">{fmt(m.revenue)}</td>
                        <td className="py-2 text-right tabular-nums">{fmt(m.cogs)}</td>
                        <td className="py-2 text-right tabular-nums">{fmt(m.grossProfit)}</td>
                        <td className={`py-2 text-right tabular-nums ${m.netIncome < 0 ? 'text-destructive' : ''}`}>{fmt(m.netIncome)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtPct(m.grossMargin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}

function SliderInput({ label, value, onChange, step = 1 }: {
  label: string; value: number; onChange: (v: number) => void; step?: number
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="h-8 text-sm"
      />
    </div>
  )
}
