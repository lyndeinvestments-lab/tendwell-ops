import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase } from '@/lib/supabase'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/EmptyState'
import {
  TrendingUp, Upload, Calculator, BarChart3, AlertTriangle, ArrowDownToLine, Plus, Sparkles,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  computeDerived, generateForecast, FORECAST_PRESETS, rollupEstimates, computeVariance,
  type ForecastSliders, type DerivedMonth,
} from '@/lib/forecaster'
import { useInProFormaWrapper } from '@/pages/pro-forma-wrapper'

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

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

function priorMonth(yyyymm: string, n = 1): string {
  const [y, m] = yyyymm.split('-').map(Number)
  const d = new Date(y, m - 1 - n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Bound a date string to YYYY-MM-DD (Supabase timestamptz comparable).
function monthBounds(yyyymm: string): { start: string; end: string } {
  const [y, m] = yyyymm.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const next = new Date(y, m, 1)
  const end = next.toISOString().slice(0, 10) // exclusive upper bound
  return { start, end }
}

function KpiCard({ title, value, subtitle, alert }: {
  title: string; value: string; subtitle?: string; alert?: boolean
}) {
  return (
    <Card className={`border-card-border ${alert ? 'border-destructive/40' : ''}`}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{title}</p>
        <p className={`text-xl font-semibold mt-1 ${alert ? 'text-destructive' : 'text-foreground'}`}>
          {value}
        </p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </CardContent>
    </Card>
  )
}

export default function ForecasterPage() {
  const inWrapper = useInProFormaWrapper()
  usePageTitle(inWrapper ? 'Pro Forma — Live' : 'Forecaster')
  const { toast } = useToast()
  const qc = useQueryClient()

  // Default to the CURRENT calendar month. We used to default to last month
  // (when QBO had necessarily landed) but now we synthesize a live estimate
  // from breezeway_tasks when QBO is empty, so current-month is the correct
  // default — operators want to see today's expected pro forma.
  const [selectedMonth, setSelectedMonth] = useState<string>(todayMonth())
  const [seasonal, setSeasonal] = useState(true)
  const [sliders, setSliders] = useState<ForecastSliders>(FORECAST_PRESETS.current)

  // ── Historical proforma rows ─────────────────
  const { data: rawMonths, isLoading: loadingMonths } = useQuery({
    queryKey: ['/supabase/proforma_months'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proforma_months')
        .select('*')
        .order('month', { ascending: true })
      if (error) throw error
      return (data || []) as Array<Record<string, any>>
    },
  })

  // ── QBO P&L fallback ─────────────────────────
  // Live Pro Forma actuals come from `proforma_months`. If a row is missing
  // for the selected month (or its values are zero) we synthesize one from
  // the same QBO P&L blob the Financial Dashboard reads, keyed under
  // `app_settings.qbo_pl_data`. Same source label is shown so users know
  // the variance row is comparing against QBO totals, not a manually-entered
  // proforma row. Refreshes from the scheduled overnight QBO import.
  // Latest Breezeway import — surfaced as a small status pill at the top
  // of the page so operators can see at a glance whether last night's
  // automated import landed.
  const { data: lastBreezeway } = useQuery({
    queryKey: ['/supabase/breezeway-last-import'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('breezeway_import_log')
        .select('imported_at, source_label, rows_inserted, cleans_in_batch, deep_cleans_in_batch, notes')
        .order('imported_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) return null
      return data
    },
  })

  const { data: qboPL } = useQuery({
    queryKey: ['/supabase/qbo-pl-data-forecaster'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'qbo_pl_data')
        .single()
      if (error || !data?.value) return null
      const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
      // Monthly entries arrive from the nightly QBO import in either shape:
      //   long form: { totalIncome, totalCOGS, totalExpenses, netIncome }
      //   short form: { income, cogs, expenses, netIncome }
      // The Financial Dashboard only reads netIncome from each entry, so the
      // short form has been live in production. Forecaster needs the topline
      // numbers — we accept both shapes and normalize at lookup time.
      return parsed as {
        company?: string
        totalIncome?: number
        totalCOGS?: number
        totalExpenses?: number
        netIncome?: number
        period?: string
        monthly?: Record<string, {
          totalIncome?: number; income?: number
          totalExpenses?: number; expenses?: number
          totalCOGS?: number; cogs?: number
          netIncome?: number
        }>
        cogsBreakdown?: Record<string, number>
        incomeBreakdown?: Record<string, number>
        expenseBreakdown?: Record<string, number>
        updated_at?: string
      }
    },
  })

  const histData: DerivedMonth[] = useMemo(() => {
    if (!rawMonths) return []
    return rawMonths.map(r => computeDerived({
      month: r.month,
      cleaningFee: Number(r.cleaning_fee) || 0,
      services: Number(r.services) || 0,
      onboardingRevenue: Number(r.onboarding_revenue) || 0,
      otherIncome: Number(r.other_income) || 0,
      contractorPay: Number(r.contractor_pay) || 0,
      laundry: Number(r.laundry) || 0,
      leadership: Number(r.leadership) || 0,
      supplies: Number(r.supplies) || 0,
      inspections: Number(r.inspections) || 0,
      trash: Number(r.trash) || 0,
      otherCOGS: Number(r.other_cogs) || 0,
      opex: Number(r.opex) || 0,
      tasks: Number(r.tasks) || 0,
      properties: Number(r.properties) || 0,
    }))
  }, [rawMonths])

  const latestMonth = histData[histData.length - 1]
  const prevMonth = histData[histData.length - 2]

  // ── Tasks completed in selected period (from `tasks` table) ─────────────
  const { data: completedTasks, isLoading: loadingTasks } = useQuery({
    queryKey: ['/supabase/proforma_tasks_in_month', selectedMonth],
    queryFn: async () => {
      const { start, end } = monthBounds(selectedMonth)
      const { data, error } = await supabase
        .from('tasks')
        .select('id, property_id, status, completed_at, category')
        .eq('status', 'Done')
        .gte('completed_at', start)
        .lt('completed_at', end)
      if (error) throw error
      return data || []
    },
  })

  // ── Operational properties for per-property estimate rollup ─────────────
  const { data: properties } = useQuery({
    queryKey: ['/supabase/operational_properties_forecaster'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, ce_charged, cleaner_pay, est_laundry, est_consumables, inspection_cost, trash_cost')
      if (error) throw error
      return data || []
    },
  })

  // ── Breezeway-derived cleans for the selected month ─────────────────────
  // Used to build the LIVE ESTIMATE when QBO has no actuals for the period.
  // Filters to is_clean / is_deep_clean rows scheduled within the month,
  // grouped by property so we can multiply by per-property rates.
  const { data: breezewayMonthRows } = useQuery({
    queryKey: ['/supabase/breezeway_for_month', selectedMonth],
    queryFn: async () => {
      const { start, end } = monthBounds(selectedMonth)
      const { data, error } = await supabase
        .from('breezeway_tasks')
        .select('property_id, is_clean, is_deep_clean')
        .gte('due_date', start)
        .lt('due_date', end)
      if (error) throw error
      return data || []
    },
  })

  // Tasks per property for the period
  const tasksByProperty = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of completedTasks || []) {
      const id = String(t.property_id ?? '')
      if (!id) continue
      m[id] = (m[id] || 0) + 1
    }
    return m
  }, [completedTasks])

  const totalPeriodTasks = (completedTasks || []).length
  const activePropsInPeriod = Object.keys(tasksByProperty).length

  // Estimated costs (rolled up from per-property cost-tracking estimates)
  const estimates = useMemo(() => {
    if (!properties) return null
    return rollupEstimates(properties as any[], tasksByProperty)
  }, [properties, tasksByProperty])

  // Pulls the QBO monthly entry that matches a YYYY-MM key. The QBO blob
  // can key months by either "YYYY-MM" or by a label like "Jan 2026" / "January 2026"
  // depending on how the import normalizes them — try both.
  function lookupQboMonth(yyyymm: string): {
    totalIncome?: number; income?: number
    totalExpenses?: number; expenses?: number
    totalCOGS?: number; cogs?: number
    netIncome?: number
  } | null {
    const monthly = qboPL?.monthly
    if (!monthly) return null
    if (monthly[yyyymm]) return monthly[yyyymm]
    const [y, m] = yyyymm.split('-').map(Number)
    if (!y || !m) return null
    const longLabel = `${MONTH_NAMES[m - 1]} ${y}`           // e.g. "March 2026"
    const shortLabel = `${MONTH_NAMES[m - 1].slice(0, 3)} ${y}` // e.g. "Mar 2026"
    return monthly[longLabel] || monthly[shortLabel] || null
  }

  // Synthesizes a DerivedMonth from the QBO P&L blob for a single month so
  // Live Pro Forma can show actuals when proforma_months has no row yet.
  // Mirrors the parsing the Financial Dashboard uses: total cost is
  // totalCOGS + totalExpenses, with a netIncome fallback of revenue − cost
  // when QBO didn't supply it. Per-category splits (laundry vs supplies vs
  // trash) are not in the QBO summary, so those variance rows fall back to
  // proforma rows when present and show 0 otherwise.
  const qboFallbackRow = useMemo<DerivedMonth | null>(() => {
    const q = lookupQboMonth(selectedMonth)
    if (!q) return null
    // Accept either field-name shape — the nightly import currently writes
    // the short form (income/cogs/expenses) which the Financial Dashboard
    // tolerates because it only reads netIncome. ?? prefers the long form
    // when both are present so manual edits keep working.
    const revenue = Number(q.totalIncome ?? q.income) || 0
    // Financial Dashboard treats totalCost as COGS + OpEx; match that so the
    // two pages agree on monthly totals when both render the same QBO blob.
    const cogs = Number(q.totalCOGS ?? q.cogs) || 0
    const opex = Number(q.totalExpenses ?? q.expenses) || 0
    const totalCost = cogs + opex
    // Treat an all-zero (or sub-dollar) QBO entry as "no data" — the import
    // wrote a stub, QuickBooks hasn't booked the period yet, or only a stray
    // residual landed in the period. Showing $0 actuals from such a stub
    // misleads the user into thinking the business ran zero, so we collapse
    // the UI back to the "no QBO data" path. We require non-trivial *topline*
    // signal (revenue + cogs + opex); netIncome alone does not qualify, since
    // a leftover adjusting entry can leave a small netIncome on a period that
    // otherwise has no real activity.
    const EPSILON = 1 // dollars
    const toplineMagnitude = Math.abs(revenue) + Math.abs(cogs) + Math.abs(opex)
    if (toplineMagnitude < EPSILON) return null
    const netIncome = q.netIncome != null ? Number(q.netIncome) : revenue - totalCost
    const grossProfit = revenue - cogs
    return {
      month: selectedMonth,
      label: `${MONTH_NAMES[Number(selectedMonth.split('-')[1]) - 1].slice(0, 3)} ${selectedMonth.split('-')[0].slice(2)}`,
      cleaningFee: 0, services: 0, onboardingRevenue: 0, otherIncome: 0,
      contractorPay: 0, laundry: 0, leadership: 0, supplies: 0,
      inspections: 0, trash: 0,
      // Bucket the unallocated COGS into otherCOGS so grand totals are right
      // even though we can't split it into laundry/supplies/etc.
      otherCOGS: cogs,
      opex,
      tasks: undefined, properties: undefined,
      revenue,
      cogs,
      totalCOGS: cogs,
      grossProfit,
      grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
      netIncome,
      netMargin: revenue > 0 ? (netIncome / revenue) * 100 : 0,
    }
  }, [qboPL, selectedMonth])

  // Did the QBO blob even mention this month, regardless of whether it had
  // values? Used by the banner to distinguish "QBO doesn't track this period"
  // from "QBO has the period but all values are zero".
  const qboMonthExists = useMemo(() => lookupQboMonth(selectedMonth) != null, [qboPL, selectedMonth])

  // ── LIVE ESTIMATE from breezeway_tasks × per-property rates ─────────────
  // When QBO has no posted actuals for the selected month (current/future
  // months, typically), synthesize a DerivedMonth from scheduled cleans
  // multiplied by per-property revenue and cost rates pulled from
  // operational_properties. This is the "estimated pro forma that's live
  // at all times" path the operator asked for — no longer shows $0 KPIs
  // when QBO is empty.
  const breezewayEstimateRow = useMemo<DerivedMonth | null>(() => {
    if (!breezewayMonthRows || !properties || breezewayMonthRows.length === 0) return null
    // Index per-property rates by property_id.
    const rates = new Map<number, any>()
    for (const p of properties as any[]) rates.set(Number(p.id), p)
    let revenue = 0
    let cleanerPay = 0
    let laundry = 0
    let supplies = 0
    let inspections = 0
    let trash = 0
    let cleansCount = 0
    let deepCleansCount = 0
    for (const r of breezewayMonthRows as any[]) {
      const rate = r.property_id != null ? rates.get(Number(r.property_id)) : null
      if (!rate) continue
      if (r.is_clean) {
        cleansCount += 1
        revenue       += Number(rate.ce_charged)        || 0
        cleanerPay    += Number(rate.cleaner_pay)       || 0
        laundry       += Number(rate.est_laundry)       || 0
        supplies      += Number(rate.est_consumables)   || 0
        inspections   += Number(rate.inspection_cost)   || 0
        trash         += Number(rate.trash_cost)        || 0
      } else if (r.is_deep_clean) {
        // Deep cleans currently use the same per-clean cost model as a
        // baseline; the operator can layer a deep-clean premium on top
        // once we have a configured rate. Keeping the structure here so
        // the variance ledger can be updated cleanly later.
        deepCleansCount += 1
        revenue       += Number(rate.ce_charged)        || 0
        cleanerPay    += Number(rate.cleaner_pay)       || 0
        laundry       += Number(rate.est_laundry)       || 0
        supplies      += Number(rate.est_consumables)   || 0
        inspections   += Number(rate.inspection_cost)   || 0
        trash         += Number(rate.trash_cost)        || 0
      }
    }
    const cogs = cleanerPay + laundry + supplies + inspections + trash
    if (revenue === 0 && cogs === 0) return null
    const grossProfit = revenue - cogs
    const yyyy = selectedMonth.split('-')[0]
    const mm = Number(selectedMonth.split('-')[1]) - 1
    return {
      month: selectedMonth,
      label: `${MONTH_NAMES[mm].slice(0, 3)} ${yyyy.slice(2)}`,
      cleaningFee: revenue, services: 0, onboardingRevenue: 0, otherIncome: 0,
      contractorPay: cleanerPay, laundry, leadership: 0, supplies, inspections, trash,
      otherCOGS: 0, opex: 0,
      tasks: cleansCount + deepCleansCount, properties: undefined,
      revenue,
      cogs,
      totalCOGS: cogs,
      grossProfit,
      grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
      netIncome: grossProfit,
      netMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    }
  }, [breezewayMonthRows, properties, selectedMonth])

  // Actuals for the selected month: prefer a real proforma_months row when
  // it exists AND has any non-zero financial signal. Otherwise fall back to
  // the QBO P&L blob. We treat an all-zeros proforma row as "no data" so a
  // placeholder upsert (e.g. tasks-only count) doesn't suppress the QBO
  // fallback the user actually wants to see.
  const proformaRow = useMemo<DerivedMonth | null>(
    () => histData.find(m => m.month === selectedMonth) || null,
    [histData, selectedMonth],
  )
  const proformaHasSignal = useMemo(() => !!proformaRow && (
    (proformaRow.revenue ?? 0) > 0 ||
    (proformaRow.cogs ?? 0) > 0 ||
    (proformaRow.netIncome ?? 0) !== 0
  ), [proformaRow])

  // Source decision is independent of the rendered row. Priority:
  //   proforma (manually-curated truth) > qbo (posted actuals) > estimate
  //   (live from breezeway × rates). 'null' fires the empty-state banner.
  const actualsSource: 'proforma' | 'qbo' | 'estimate' | null = useMemo(() => {
    if (proformaHasSignal) return 'proforma'
    if (qboFallbackRow) return 'qbo'
    if (breezewayEstimateRow) return 'estimate'
    return null
  }, [proformaHasSignal, qboFallbackRow, breezewayEstimateRow])

  const actualsRow = useMemo<DerivedMonth | null>(() => {
    if (actualsSource === 'proforma') return proformaRow
    if (actualsSource === 'qbo') return qboFallbackRow
    if (actualsSource === 'estimate') return breezewayEstimateRow
    // Keep the proforma row visible (so tasks/properties counts still render)
    // when it exists but lacks financial signal — the banner explains the $0.
    return proformaRow
  }, [actualsSource, proformaRow, qboFallbackRow, breezewayEstimateRow])

  // Variance per category — uses estimates × actuals.
  //
  // QBO fallback caveat: when actualsSource === 'qbo' the source blob only
  // gives us topline numbers (revenue, total cost, net income) — laundry vs
  // supplies vs trash vs contractor pay aren't broken out. Rather than
  // showing all zeros (misleading: "we spent $0 on laundry" is false), we
  // collapse the per-category rows into a single "Total Costs" row backed
  // by the QBO total cost (COGS + OpEx) and keep the Revenue row, so the
  // user sees real numbers and a clear topline variance. The banner above
  // the variance table tells them per-category breakdowns will fill in
  // after the next nightly proforma import.
  const variance = useMemo(() => {
    if (!estimates || !actualsRow) return null
    if (actualsSource === 'qbo') {
      const totalEstimated =
        estimates.laundry + estimates.supplies + estimates.inspections +
        estimates.trash + estimates.contractorPay
      const totalActual = (actualsRow.cogs || 0) + (actualsRow.opex || 0)
      return computeVariance([
        { category: 'Total Costs (QBO topline)', estimated: totalEstimated, actual: totalActual },
        { category: 'Revenue', estimated: estimates.revenue, actual: actualsRow.revenue || 0 },
      ])
    }
    return computeVariance([
      { category: 'Laundry', estimated: estimates.laundry, actual: actualsRow.laundry || 0 },
      { category: 'Supplies', estimated: estimates.supplies, actual: actualsRow.supplies || 0 },
      { category: 'Inspections', estimated: estimates.inspections, actual: actualsRow.inspections || 0 },
      { category: 'Trash', estimated: estimates.trash, actual: actualsRow.trash || 0 },
      { category: 'Contractor Pay', estimated: estimates.contractorPay, actual: actualsRow.contractorPay || 0 },
      { category: 'Revenue', estimated: estimates.revenue, actual: actualsRow.revenue || 0 },
    ])
  }, [estimates, actualsRow, actualsSource])

  // ── Forecast horizon ────────────────────────
  const forecast = useMemo(() => {
    const startProperties = latestMonth?.properties ?? 70
    const startMonth = latestMonth ? priorMonth(latestMonth.month, -1) : todayMonth()
    return generateForecast(sliders, { startProperties, startMonth, horizon: 12, seasonal })
  }, [sliders, seasonal, latestMonth])

  // ── Upload tasks CSV → bumps tasks count + creates entries via Pivot table ──
  // (The user said "upload tasks completed within a time period" — we accept a
  // simple CSV and count rows by completed_at date, then the existing tasks
  // query will pick them up. For now this just sums and writes the count to
  // proforma_months for the period.)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadCount, setUploadCount] = useState('')

  const { mutate: applyTaskCount, isPending: applying } = useGuardedMutation('forecaster', {
    mutationFn: async () => {
      const n = parseInt(uploadCount, 10)
      if (!Number.isFinite(n) || n < 0) throw new Error('Enter a non-negative integer')
      const { error } = await supabase.from('proforma_months').upsert({
        month: selectedMonth,
        tasks: n,
        source: 'upload',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'month' })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/proforma_months'] })
      toast({ title: 'Tasks count saved' })
      setUploadOpen(false)
      setUploadCount('')
    },
    onError: (err: any) => toast({ title: 'Upload failed', description: err?.message, variant: 'destructive' }),
  })

  // ── Render ──────────────────────────────
  // QBO actuals refresh nightly via a scheduled import on the backend; no user-facing pull button.
  const monthOptions = useMemo(() => {
    const seen = new Set(histData.map(m => m.month))
    // Always include the current and selected months even if not in DB.
    seen.add(todayMonth())
    seen.add(selectedMonth)
    return Array.from(seen).sort().reverse()
  }, [histData, selectedMonth])

  const isLoading = loadingMonths

  return (
    <div className="p-5 h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {inWrapper ? (
          <div className="text-xs text-muted-foreground">
            Period &amp; sources
          </div>
        ) : (
          <div>
            <h1 className="text-xl font-semibold text-foreground">Forecaster</h1>
            <p className="text-sm text-muted-foreground">
              Live proforma — actuals from completed tasks &amp; QBO compared to estimated cost formulas.
            </p>
          </div>
        )}
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
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setUploadOpen(o => !o)} data-testid="button-upload-tasks">
            <Upload className="w-3.5 h-3.5" /> Upload Tasks
          </Button>
          <span className="text-[11px] text-muted-foreground" data-testid="text-qbo-refresh-note">
            Actuals refresh nightly from the scheduled QBO import.
          </span>
        </div>
      </div>

      {lastBreezeway ? (
        <div
          className="rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs flex flex-wrap items-center gap-x-3 gap-y-1"
          data-testid="status-breezeway-last-import"
        >
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Sparkles className="w-3 h-3 text-primary" /> Breezeway
          </span>
          <span className="text-muted-foreground">
            last import {formatDistanceToNow(new Date(lastBreezeway.imported_at), { addSuffix: true })}
          </span>
          <span className="text-foreground">
            {lastBreezeway.source_label ?? '—'} · {lastBreezeway.rows_inserted} tasks
            <span className="text-muted-foreground">
              {' ('}{lastBreezeway.cleans_in_batch} cleans
              {lastBreezeway.deep_cleans_in_batch ? <> · {lastBreezeway.deep_cleans_in_batch} deep</> : null}
              {')'}
            </span>
          </span>
          {lastBreezeway.notes ? (
            <span className="text-amber-700 dark:text-amber-400 truncate max-w-[40ch]" title={lastBreezeway.notes}>
              · {lastBreezeway.notes}
            </span>
          ) : null}
        </div>
      ) : null}

      {uploadOpen && (
        <Card className="border-card-border">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Upload className="w-4 h-4 text-muted-foreground" /> Upload completed tasks for {selectedMonth}
            </div>
            <p className="text-xs text-muted-foreground">
              Quick entry — type the total number of completed tasks for the period. Tendwell Ops automatically rolls per-property estimates × tasks completed → expected cost; QBO P&amp;L gives the actual cost; the variance below shows the gap. CSV import will be wired to <code>/api/trellis/tasks-today</code> for live sync once Trellis is in production.
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="# tasks completed"
                value={uploadCount}
                onChange={e => setUploadCount(e.target.value)}
                className="h-8 w-44 text-sm"
                data-testid="input-task-count"
              />
              <Button size="sm" className="h-8 text-xs" disabled={applying || !uploadCount} onClick={() => applyTaskCount()}>
                {applying ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {actualsSource === 'qbo' && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid="actuals-source-banner">
          Showing QuickBooks actuals for {selectedMonth} — the <code className="font-mono">proforma_months</code> row hasn't been written yet by the nightly import. Per-category breakdowns (laundry vs supplies vs trash) populate after the next overnight sync.
        </div>
      )}
      {actualsSource === 'estimate' && (
        <div
          className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-800 dark:text-blue-200"
          data-testid="actuals-source-banner-estimate"
        >
          Showing <strong>live estimate</strong> for {selectedMonth} — derived from scheduled Breezeway tasks × per-property rates.
          QuickBooks actuals haven't posted yet; KPIs below will switch to QBO automatically once the next nightly import lands.
        </div>
      )}
      {actualsSource === null && (
        <div
          className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          data-testid="actuals-source-banner-empty"
        >
          No data available for {selectedMonth}
          {qboMonthExists ? ' (QBO returned zero totals for this period)' : ''}.
          {proformaRow
            ? <> The <code className="font-mono mx-1">proforma_months</code> row that exists for the period has no financial signal, and</>
            : <> No <code className="font-mono mx-1">proforma_months</code> row has been written, and</>}
          {' '}no Breezeway tasks are scheduled for this period.
        </div>
      )}

      {/* KPI row — actuals vs prior month */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {isLoading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)
        ) : actualsRow ? (
          <>
            <KpiCard
              title="Revenue"
              value={fmt(actualsRow.revenue)}
              subtitle={prevMonth ? `${actualsRow.revenue >= prevMonth.revenue ? '▲' : '▼'} ${fmtPct(((actualsRow.revenue - prevMonth.revenue) / Math.max(prevMonth.revenue, 1)) * 100)} vs ${prevMonth.label}` : actualsSource === 'qbo' ? 'Source: QBO P&L' : undefined}
            />
            <KpiCard
              title="Net Income"
              value={fmt(actualsRow.netIncome)}
              alert={actualsRow.netIncome < 0}
              subtitle={`Margin ${fmtPct(actualsRow.netMargin)}`}
            />
            <KpiCard
              title="Tasks"
              value={String(actualsRow.tasks ?? totalPeriodTasks ?? 0)}
              subtitle={`${actualsRow.properties ?? activePropsInPeriod ?? 0} properties`}
            />
            <KpiCard
              title="Gross Margin"
              value={fmtPct(actualsRow.grossMargin)}
              subtitle={`COGS ${fmt(actualsRow.cogs)}`}
            />
          </>
        ) : (
          <Card className="col-span-full border-dashed">
            <CardContent className="p-6">
              <EmptyState
                icon={Calculator}
                title="No actuals yet for this month"
                description="Actuals refresh nightly from the scheduled QuickBooks import. You can also enter the completed-task count for this period above to populate task estimates."
              />
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs defaultValue="variance" className="flex-1 flex flex-col">
        <TabsList className="self-start">
          <TabsTrigger value="variance" data-testid="tab-variance">Variance</TabsTrigger>
          <TabsTrigger value="historical" data-testid="tab-historical">Historical</TabsTrigger>
          <TabsTrigger value="forecast" data-testid="tab-forecast">Forecast</TabsTrigger>
        </TabsList>

        {/* ── Variance tab ───────────────────────── */}
        <TabsContent value="variance" className="flex-1 mt-3 space-y-3">
          <Card className="border-card-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Estimated vs Actual — {selectedMonth}</h3>
                </div>
                <span className="text-xs text-muted-foreground">
                  {totalPeriodTasks} completed task{totalPeriodTasks === 1 ? '' : 's'} · {activePropsInPeriod} active propert{activePropsInPeriod === 1 ? 'y' : 'ies'}
                </span>
              </div>
              {!variance ? (
                <EmptyState
                  icon={Calculator}
                  title="Need both estimates and actuals"
                  description="Estimates roll up from per-property Cost Tracking. Actuals come from this month's proforma row. Make sure tasks are marked Done for the period."
                />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Category</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Estimated</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Actual</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Variance</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">% Variance</th>
                      <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 pl-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variance.map(row => {
                      const isRevenue = row.category === 'Revenue'
                      // For revenue, "favorable" = actual ≥ estimated (more revenue is good).
                      const fav = isRevenue ? row.variance >= 0 : row.favorable
                      return (
                        <tr key={row.category} className="border-b border-border/50" data-testid={`variance-row-${row.category.toLowerCase().replace(/\s+/g, '-')}`}>
                          <td className="py-2 text-foreground">{row.category}</td>
                          <td className="py-2 text-right tabular-nums text-foreground">{fmt(row.estimated)}</td>
                          <td className="py-2 text-right tabular-nums text-foreground">{fmt(row.actual)}</td>
                          <td className={`py-2 text-right tabular-nums font-medium ${fav ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {row.variance > 0 ? '+' : ''}{fmt(row.variance)}
                          </td>
                          <td className={`py-2 text-right tabular-nums ${fav ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {fmtPct(row.variancePct)}
                          </td>
                          <td className="py-2 pl-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${fav
                              ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                              : 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'}`}>
                              {fav ? 'Favorable' : 'Unfavorable'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Historical tab ───────────────────────── */}
        <TabsContent value="historical" className="flex-1 mt-3 space-y-3">
          <Card className="border-card-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-muted-foreground" /> Monthly Revenue &amp; Net Income
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="revenue" name="Revenue" fill="hsl(var(--primary))" />
                    <Bar dataKey="netIncome" name="Net Income" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border-card-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-3">All Months</h3>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Month</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Tasks</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Properties</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Revenue</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">COGS</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Gross Profit</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Net Income</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">GM %</th>
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
                  <TrendingUp className="w-4 h-4 text-muted-foreground" /> 12-Month Forecast
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  {(['current', 'conservative', 'aggressive'] as const).map(p => (
                    <Button key={p} size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSliders(FORECAST_PRESETS[p])}>
                      {p[0].toUpperCase() + p.slice(1)}
                    </Button>
                  ))}
                  <div className="flex items-center gap-2">
                    <Switch checked={seasonal} onCheckedChange={setSeasonal} id="seasonal-toggle" />
                    <Label htmlFor="seasonal-toggle" className="text-xs">Seasonal</Label>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SliderInput label="Property growth /mo" value={sliders.propGrowth} onChange={v => setSliders(s => ({ ...s, propGrowth: v }))} step={1} />
                <SliderInput label="Tasks per property" value={sliders.tasksPerProp} onChange={v => setSliders(s => ({ ...s, tasksPerProp: v }))} step={0.1} />
                <SliderInput label="Revenue / task ($)" value={sliders.revPerTask} onChange={v => setSliders(s => ({ ...s, revPerTask: v }))} step={5} />
                <SliderInput label="Contractor %" value={sliders.contractorPct} onChange={v => setSliders(s => ({ ...s, contractorPct: v }))} step={1} />
                <SliderInput label="Laundry %" value={sliders.laundryPct} onChange={v => setSliders(s => ({ ...s, laundryPct: v }))} step={1} />
                <SliderInput label="Supplies %" value={sliders.suppliesPct} onChange={v => setSliders(s => ({ ...s, suppliesPct: v }))} step={1} />
                <SliderInput label="Leadership ($/mo)" value={sliders.leadership} onChange={v => setSliders(s => ({ ...s, leadership: v }))} step={100} />
                <SliderInput label="OpEx ($/mo)" value={sliders.opex} onChange={v => setSliders(s => ({ ...s, opex: v }))} step={100} />
              </div>

              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={forecast}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Line type="monotone" dataKey="revenue" name="Revenue" stroke="hsl(var(--primary))" strokeWidth={2} />
                    <Line type="monotone" dataKey="netIncome" name="Net Income" stroke="#10b981" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border-card-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-3">Forecast Detail</h3>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Month</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Properties</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Tasks</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Revenue</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">COGS</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Gross Profit</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">Net Income</th>
                      <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2">GM %</th>
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
    </div>
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
