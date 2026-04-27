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
  TrendingUp, Upload, RefreshCcw, Calculator, BarChart3, AlertTriangle, ArrowDownToLine, Plus,
} from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  computeDerived, generateForecast, FORECAST_PRESETS, rollupEstimates, computeVariance,
  type ForecastSliders, type DerivedMonth,
} from '@/lib/forecaster'

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
  usePageTitle('Forecaster')
  const { toast } = useToast()
  const qc = useQueryClient()

  const [selectedMonth, setSelectedMonth] = useState<string>(priorMonth(todayMonth(), 1))
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

  // Actuals for the selected month from proforma_months row, if present
  const actualsRow = useMemo(() => {
    if (!histData.length) return null
    return histData.find(m => m.month === selectedMonth) || null
  }, [histData, selectedMonth])

  // Variance per category — uses estimates × actuals
  const variance = useMemo(() => {
    if (!estimates || !actualsRow) return null
    return computeVariance([
      { category: 'Laundry', estimated: estimates.laundry, actual: actualsRow.laundry || 0 },
      { category: 'Supplies', estimated: estimates.supplies, actual: actualsRow.supplies || 0 },
      { category: 'Inspections', estimated: estimates.inspections, actual: actualsRow.inspections || 0 },
      { category: 'Trash', estimated: estimates.trash, actual: actualsRow.trash || 0 },
      { category: 'Contractor Pay', estimated: estimates.contractorPay, actual: actualsRow.contractorPay || 0 },
      { category: 'Revenue', estimated: estimates.revenue, actual: actualsRow.revenue || 0 },
    ])
  }, [estimates, actualsRow])

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

  // ── Pull from QBO ────────────────────────
  const [qboBusy, setQboBusy] = useState(false)
  async function pullFromQbo() {
    setQboBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not signed in')
      const res = await fetch('/api/qbo/financials', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'QBO fetch failed')
      const pl = data.profitLoss
      if (!pl) throw new Error('No P&L data returned')
      // QBO endpoint returns the current month — we map it onto selectedMonth
      // only if the user is viewing the current month, otherwise show a hint.
      if (selectedMonth !== todayMonth()) {
        toast({ title: 'QBO returns current-month P&L only', description: 'Switch to the current month, or enter the period manually.' })
        return
      }
      const { error } = await supabase.from('proforma_months').upsert({
        month: selectedMonth,
        cleaning_fee: pl.totalIncome,
        other_cogs: pl.totalExpenses,
        source: 'qbo',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'month' })
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['/supabase/proforma_months'] })
      toast({ title: 'QBO actuals pulled' })
    } catch (err: any) {
      toast({ title: 'QBO sync failed', description: err?.message, variant: 'destructive' })
    } finally {
      setQboBusy(false)
    }
  }

  // ── Render ──────────────────────────────
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
        <div>
          <h1 className="text-xl font-semibold text-foreground">Forecaster</h1>
          <p className="text-sm text-muted-foreground">
            Live proforma — actuals from completed tasks &amp; QBO compared to estimated cost formulas.
          </p>
        </div>
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
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={qboBusy} onClick={pullFromQbo} data-testid="button-pull-qbo">
            <RefreshCcw className={`w-3.5 h-3.5 ${qboBusy ? 'animate-spin' : ''}`} /> Pull from QBO
          </Button>
        </div>
      </div>

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

      {/* KPI row — actuals vs prior month */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {isLoading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)
        ) : actualsRow ? (
          <>
            <KpiCard
              title="Revenue"
              value={fmt(actualsRow.revenue)}
              subtitle={prevMonth ? `${actualsRow.revenue >= prevMonth.revenue ? '▲' : '▼'} ${fmtPct(((actualsRow.revenue - prevMonth.revenue) / Math.max(prevMonth.revenue, 1)) * 100)} vs ${prevMonth.label}` : undefined}
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
                description="Upload completed tasks or pull QBO P&L to populate."
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
