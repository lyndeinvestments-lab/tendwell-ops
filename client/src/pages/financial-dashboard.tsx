import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Building2,
  BarChart3,
  AlertTriangle,
  AlertCircle,
  RotateCcw,
  Percent,
  ExternalLink,
  CreditCard,
  BookOpen,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Property {
  id: string
  name: string
  ce_charged: number | null
  total_estimated_cost: number | null
  estimated_profit: number | null
  profit_percentage: number | null
  cleaning_frequency: string | null
  avg_cleans_per_month: number | null
  monthly_revenue_estimate: number | null
  monthly_cost_estimate: number | null
  monthly_profit_estimate: number | null
  stage_name: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, prefix = '$') {
  if (n == null) return '—'
  return `${prefix}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return '—'
  return `${n.toFixed(1)}%`
}

const CPM_OPTIONS = [
  { label: '1 clean/mo', value: 1 },
  { label: '2 cleans/mo', value: 2 },
  { label: '2.17 cleans/mo (biweekly)', value: 2.17 },
  { label: '3 cleans/mo', value: 3 },
  { label: '4 cleans/mo', value: 4 },
  { label: '4.33 cleans/mo (weekly)', value: 4.33 },
  { label: '5 cleans/mo', value: 5 },
  { label: '6 cleans/mo', value: 6 },
  { label: 'Custom…', value: -1 },
]

// ─── KpiCard ──────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  loading,
  alert,
  scenario,
}: {
  title: string
  value: string | number
  subtitle?: string
  icon: React.ComponentType<{ className?: string }>
  loading: boolean
  alert?: boolean
  scenario?: string | number | null
}) {
  return (
    <Card className={`border-card-border ${alert ? 'border-destructive/40' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{title}</p>
            {loading ? (
              <Skeleton className="h-7 w-24 mt-1.5" />
            ) : (
              <>
                <div className="flex items-end gap-3 mt-1 flex-wrap">
                  <p
                    data-testid={`kpi-${title.toLowerCase().replace(/\s+/g, '-')}`}
                    className={`text-xl font-semibold ${alert ? 'text-destructive' : 'text-foreground'}`}
                  >
                    {value}
                  </p>
                  {scenario != null && scenario !== '' && (
                    <span className="text-base font-semibold text-blue-500 dark:text-blue-400">
                      {scenario}
                    </span>
                  )}
                </div>
                {(subtitle || scenario != null) && (
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
                    {scenario != null && scenario !== '' && (
                      <p className="text-xs text-blue-500 dark:text-blue-400">scenario</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div
            className={`w-8 h-8 rounded-md ${alert ? 'bg-destructive/10' : 'bg-primary/10'} flex items-center justify-center flex-shrink-0 ml-2`}
          >
            <Icon className={`w-4 h-4 ${alert ? 'text-destructive' : 'text-primary'}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Custom Tooltip for bar charts ────────────────────────────────────────────

function PropertyBarTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-popover border border-border rounded-md px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-foreground mb-1">{d.name}</p>
      <p className={`tabular-nums ${d.value < 0 ? 'text-destructive' : 'text-primary'}`}>
        Monthly Profit: {fmt(d.value)}
      </p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinancialDashboardPage() {
  usePageTitle('Financial Dashboard')
  const { openPropertyModal } = usePropertyModal()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // ── Scenario state ──
  const [scenarioCpmSelect, setScenarioCpmSelect] = useState<string>('')
  const [customCpm, setCustomCpm] = useState<string>('')

  // ── Chart state ──
  const [useScenarioChart, setUseScenarioChart] = useState(false)
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc' | 'name'>('desc')

  // ── Data ──
  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/financial-dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select(
          'id, name, ce_charged, total_estimated_cost, estimated_profit, profit_percentage, cleaning_frequency, avg_cleans_per_month, monthly_revenue_estimate, monthly_cost_estimate, monthly_profit_estimate, stage_name'
        )
        .eq('stage_name', 'Active')
        .limit(5000)
      if (error) throw error
      return (data || []) as Property[]
    },
  })

  // ── Derive scenario CPM ──
  const scenarioCpm = useMemo<number | null>(() => {
    if (!scenarioCpmSelect) return null
    const val = parseFloat(scenarioCpmSelect)
    if (val === -1) {
      const c = parseFloat(customCpm)
      return isNaN(c) || c <= 0 ? null : c
    }
    return isNaN(val) ? null : val
  }, [scenarioCpmSelect, customCpm])

  const hasScenario = scenarioCpm !== null

  // ── Actuals KPIs ──
  const actuals = useMemo(() => {
    if (!properties?.length) return null
    const totalRevenue = properties.reduce((s, p) => s + (p.monthly_revenue_estimate ?? 0), 0)
    const totalCost = properties.reduce((s, p) => s + (p.monthly_cost_estimate ?? 0), 0)
    const totalProfit = properties.reduce((s, p) => s + (p.monthly_profit_estimate ?? 0), 0)
    const avgProfitPerClean =
      properties.reduce((s, p) => s + (p.estimated_profit ?? 0), 0) / properties.length
    const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
    return { totalRevenue, totalCost, totalProfit, avgProfitPerClean, avgMargin, count: properties.length }
  }, [properties])

  // ── Scenario KPIs ──
  const scenario = useMemo(() => {
    if (!properties?.length || scenarioCpm === null) return null
    const totalRevenue = properties.reduce(
      (s, p) => s + (p.ce_charged ?? 0) * scenarioCpm,
      0
    )
    const totalCost = properties.reduce(
      (s, p) => s + (p.total_estimated_cost ?? 0) * scenarioCpm,
      0
    )
    const totalProfit = properties.reduce(
      (s, p) => s + ((p.ce_charged ?? 0) - (p.total_estimated_cost ?? 0)) * scenarioCpm,
      0
    )
    const avgProfitPerClean = scenarioCpm > 0
      ? (totalRevenue - totalCost) / Math.max(1, properties.length) / scenarioCpm
      : properties.reduce((s, p) => s + (p.estimated_profit ?? 0), 0) / properties.length
    const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
    return { totalRevenue, totalCost, totalProfit, avgProfitPerClean, avgMargin }
  }, [properties, scenarioCpm])

  // ── Alert panels ──
  const negativeProperties = useMemo(
    () => properties?.filter((p) => (p.estimated_profit ?? 0) < 0) ?? [],
    [properties]
  )

  const nearBreakEvenProperties = useMemo(
    () =>
      properties?.filter(
        (p) => (p.profit_percentage ?? 0) > 0 && (p.profit_percentage ?? 0) < 5
      ) ?? [],
    [properties]
  )

  // ── Profitability distribution ──
  const distributionData = useMemo(() => {
    if (!properties?.length) return []
    const high = properties.filter((p) => (p.profit_percentage ?? 0) >= 30).length
    const mid = properties.filter(
      (p) => (p.profit_percentage ?? 0) >= 15 && (p.profit_percentage ?? 0) < 30
    ).length
    const low = properties.filter(
      (p) => (p.profit_percentage ?? 0) > 0 && (p.profit_percentage ?? 0) < 15
    ).length
    const negative = properties.filter((p) => (p.profit_percentage ?? 0) < 0).length
    return [
      { label: 'High (≥30%)', count: high, color: '#22c55e' },
      { label: 'Mid (15–30%)', count: mid, color: '#3b82f6' },
      { label: 'Low (0–15%)', count: low, color: '#f59e0b' },
      { label: 'Negative (<0%)', count: negative, color: '#ef4444' },
    ]
  }, [properties])

  // ── Integrations (admin only) ──
  const { data: rampData, isLoading: rampLoading } = useQuery({
    queryKey: ['/api/ramp/spend'],
    enabled: isAdmin,
    staleTime: 300_000, // 5 min cache
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return null
      const res = await fetch('/api/ramp/spend', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) return null
      return res.json()
    },
  })

  // QBO data synced to Supabase via Claude MCP (no serverless function needed)
  const { data: qboData, isLoading: qboLoading } = useQuery({
    queryKey: ['/supabase/qbo-pl-data'],
    enabled: isAdmin,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'qbo_pl_data')
        .single()
      if (error || !data?.value) return null
      const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
      return {
        connected: true,
        companyName: parsed.company,
        profitLoss: {
          totalIncome: parsed.totalIncome,
          totalExpenses: parsed.totalCOGS + parsed.totalExpenses,
          netIncome: parsed.netIncome,
          period: parsed.period,
        },
        monthly: parsed.monthly,
        cogsBreakdown: parsed.cogsBreakdown,
        incomeBreakdown: parsed.incomeBreakdown,
        expenseBreakdown: parsed.expenseBreakdown,
        updatedAt: parsed.updated_at,
      }
    },
  })

  // ── Per-property bar chart data ──
  const propertyChartData = useMemo(() => {
    if (!properties?.length) return []
    const rows = properties.map((p) => ({
      id: p.id,
      name: p.name ?? '—',
      value: useScenarioChart && scenarioCpm !== null
        ? ((p.ce_charged ?? 0) - (p.total_estimated_cost ?? 0)) * scenarioCpm
        : (p.monthly_profit_estimate ?? 0),
    }))
    if (sortOrder === 'desc') return [...rows].sort((a, b) => b.value - a.value)
    if (sortOrder === 'asc') return [...rows].sort((a, b) => a.value - b.value)
    return [...rows].sort((a, b) => a.name.localeCompare(b.name))
  }, [properties, useScenarioChart, scenarioCpm, sortOrder])

  // ── Helpers for display ──
  function resetScenario() {
    setScenarioCpmSelect('')
    setCustomCpm('')
    setUseScenarioChart(false)
  }

  const showCustomInput = scenarioCpmSelect === '-1'

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-5 space-y-6 h-full overflow-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Financial Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Monthly financial overview for active properties
          </p>
        </div>
        {hasScenario && (
          <Button
            variant="outline"
            size="sm"
            onClick={resetScenario}
            className="h-8 text-xs gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Scenario
          </Button>
        )}
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard
          title="Monthly Revenue (Est.)"
          value={fmt(actuals?.totalRevenue)}
          subtitle="Active properties only"
          icon={DollarSign}
          loading={isLoading}
          scenario={hasScenario ? fmt(scenario?.totalRevenue) : null}
        />
        <KpiCard
          title="Monthly Cost"
          value={fmt(actuals?.totalCost)}
          icon={TrendingDown}
          loading={isLoading}
          scenario={hasScenario ? fmt(scenario?.totalCost) : null}
        />
        <KpiCard
          title="Monthly Profit"
          value={fmt(actuals?.totalProfit)}
          icon={TrendingUp}
          loading={isLoading}
          alert={(actuals?.totalProfit ?? 0) < 0}
          scenario={hasScenario ? fmt(scenario?.totalProfit) : null}
        />
        <KpiCard
          title="Avg Profit / Clean"
          value={fmt(actuals?.avgProfitPerClean)}
          icon={BarChart3}
          loading={isLoading}
          alert={(actuals?.avgProfitPerClean ?? 0) < 0}
          scenario={hasScenario ? fmt(scenario?.avgProfitPerClean) : null}
        />
        <KpiCard
          title="Avg Profit Margin"
          value={fmtPct(actuals?.avgMargin)}
          icon={Percent}
          loading={isLoading}
          alert={(actuals?.avgMargin ?? 0) < 0}
          scenario={hasScenario ? fmtPct(scenario?.avgMargin) : null}
        />
        <KpiCard
          title="Active Properties"
          value={actuals?.count ?? '—'}
          icon={Building2}
          loading={isLoading}
        />
      </div>

      {/* ── Scenario Simulator ── */}
      <Card className="border-card-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            Scenario Simulator
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Cleans / month:</span>
              <Select value={scenarioCpmSelect} onValueChange={setScenarioCpmSelect}>
                <SelectTrigger className="h-8 w-52 text-xs" data-testid="select-scenario-cpm">
                  <SelectValue placeholder="Select cleans per month…" />
                </SelectTrigger>
                <SelectContent>
                  {CPM_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)} className="text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {showCustomInput && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Custom value:</span>
                <Input
                  type="number"
                  min="0.1"
                  step="0.1"
                  placeholder="e.g. 3.5"
                  value={customCpm}
                  onChange={(e) => setCustomCpm(e.target.value)}
                  data-testid="input-custom-cpm"
                  className="h-8 w-28 text-xs"
                />
              </div>
            )}

            {hasScenario && (
              <div className="flex items-center gap-1.5 text-xs text-blue-500 dark:text-blue-400 ml-1">
                <span className="font-medium">
                  Scenario active: {scenarioCpm} clean{scenarioCpm !== 1 ? 's' : ''}/mo
                </span>
              </div>
            )}

            {hasScenario && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetScenario}
                className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Overrides each property's cleaning frequency for the scenario calculation.
          </p>

          {hasScenario && actuals && scenario && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 p-3 rounded-lg bg-muted/30 border border-border/60">
              {[
                { label: 'Revenue', current: fmt(actuals.totalRevenue), next: fmt(scenario.totalRevenue) },
                { label: 'Cost', current: fmt(actuals.totalCost), next: fmt(scenario.totalCost) },
                { label: 'Profit', current: fmt(actuals.totalProfit), next: fmt(scenario.totalProfit) },
                { label: 'Avg Profit/Clean', current: fmt(actuals.avgProfitPerClean), next: fmt(scenario.avgProfitPerClean) },
                { label: 'Avg Margin', current: fmtPct(actuals.avgMargin), next: fmtPct(scenario.avgMargin) },
              ].map((row) => (
                <div key={row.label} className="text-xs">
                  <p className="text-muted-foreground font-medium uppercase tracking-wide text-[10px] mb-1">{row.label}</p>
                  <p className="text-foreground tabular-nums">{row.current}</p>
                  <p className="text-blue-500 dark:text-blue-400 tabular-nums font-medium">{row.next}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Alert Panels ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Negative profit */}
        <Card className="border-destructive/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-destructive">
              <AlertCircle className="w-4 h-4" />
              Negative Profit Properties
              {!isLoading && (
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {negativeProperties.length} {negativeProperties.length === 1 ? 'property' : 'properties'}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : negativeProperties.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">
                No properties with negative monthly profit
              </p>
            ) : (
              <ul className="space-y-1.5 max-h-52 overflow-y-auto">
                {negativeProperties.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between text-xs py-1.5 px-2 rounded-md bg-destructive/5 hover:bg-destructive/10 transition-colors cursor-pointer"
                    onClick={() => openPropertyModal(p.id)}
                  >
                    <span className="font-medium text-foreground truncate pr-2">{p.name}</span>
                    <span className="text-destructive tabular-nums font-semibold flex-shrink-0">
                      {fmt(p.estimated_profit)}/clean
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Near break-even */}
        <Card className="border-amber-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4" />
              Near Break-Even Properties
              {!isLoading && (
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {nearBreakEvenProperties.length} {nearBreakEvenProperties.length === 1 ? 'property' : 'properties'}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : nearBreakEvenProperties.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">
                No properties in the 0–5% margin range
              </p>
            ) : (
              <ul className="space-y-1.5 max-h-52 overflow-y-auto">
                {nearBreakEvenProperties.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between text-xs py-1.5 px-2 rounded-md bg-amber-500/5 hover:bg-amber-500/10 transition-colors cursor-pointer"
                    onClick={() => openPropertyModal(p.id)}
                  >
                    <span className="font-medium text-foreground truncate pr-2">{p.name}</span>
                    <span className="text-amber-600 dark:text-amber-400 tabular-nums font-semibold flex-shrink-0">
                      {fmt(p.estimated_profit)}/clean · {fmtPct(p.profit_percentage)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Profitability Distribution */}
        <Card className="border-card-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Profitability Distribution</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : !properties?.length ? (
              <p className="text-xs text-muted-foreground py-12 text-center">No data available</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={distributionData}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                >
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={110}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    formatter={(value: number) => [`${value} properties`, 'Count']}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {distributionData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Per-property monthly profit */}
        <Card className="border-card-border">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-sm font-medium">Monthly Profit by Property</CardTitle>
              <div className="flex items-center gap-3">
                {hasScenario && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Actuals</span>
                    <Switch
                      checked={useScenarioChart}
                      onCheckedChange={setUseScenarioChart}
                      data-testid="toggle-scenario-chart"
                    />
                    <span className={useScenarioChart ? 'text-blue-500 dark:text-blue-400' : ''}>
                      Scenario
                    </span>
                  </div>
                )}
                <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as typeof sortOrder)}>
                  <SelectTrigger className="h-7 w-32 text-xs" data-testid="select-sort-order">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc" className="text-xs">Highest first</SelectItem>
                    <SelectItem value="asc" className="text-xs">Lowest first</SelectItem>
                    <SelectItem value="name" className="text-xs">By name</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : !properties?.length ? (
              <p className="text-xs text-muted-foreground py-12 text-center">No data available</p>
            ) : (
              <div className="overflow-x-auto">
                <div style={{ minWidth: Math.max(400, propertyChartData.length * 48) }}>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={propertyChartData}
                      margin={{ top: 4, right: 8, left: 0, bottom: 80 }}
                    >
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 9 }}
                        tickLine={false}
                        axisLine={false}
                        angle={-45}
                        textAnchor="end"
                        interval={0}
                        tickFormatter={(v: string) => v.length > 15 ? v.slice(0, 15) + '...' : v}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `$${v}`}
                        width={52}
                      />
                      <Tooltip content={<PropertyBarTooltip />} />
                      <Bar
                        dataKey="value"
                        radius={[3, 3, 0, 0]}
                        cursor="pointer"
                        onClick={(data: any) => {
                          if (data?.id) openPropertyModal(data.id)
                        }}
                      >
                        {propertyChartData.map((entry, index) => (
                          <Cell
                            key={index}
                            fill={entry.value >= 0 ? '#22c55e' : '#ef4444'}
                            fillOpacity={0.85}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Property List */}
        <Card className="border-card-border lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">All Active Properties — Monthly Profit</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr>
                    <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Property</th>
                    <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Revenue</th>
                    <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Cost</th>
                    <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Profit</th>
                    <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {propertyChartData.map((p: any) => {
                    const prop = properties?.find(pr => pr.id === p.id)
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-border/30 hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => openPropertyModal(p.id)}
                      >
                        <td className="py-1.5 px-2 font-medium">{p.name}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{fmt(prop?.monthly_revenue_estimate)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{fmt(prop?.monthly_cost_estimate)}</td>
                        <td className={`py-1.5 px-2 text-right tabular-nums font-medium ${p.value < 0 ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>{fmt(p.value)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{fmtPct(prop?.profit_percentage)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Integrations (admin only) ── */}
      {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Ramp Spend */}
          <Card className="border-card-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-primary" />
                Ramp Spend (30 days)
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {rampLoading ? (
                <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
              ) : !rampData ? (
                <p className="text-xs text-muted-foreground py-3 text-center">Unable to load Ramp data</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Total Spend</span>
                    <span className="text-lg font-semibold">{fmt(rampData.totalSpend)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{rampData.transactionCount} transactions</span>
                    <span>{rampData.period}</span>
                  </div>
                  {rampData.topCategories?.length > 0 && (
                    <>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-1">Top Categories</p>
                      <div className="space-y-1">
                        {rampData.topCategories.slice(0, 5).map((c: any) => (
                          <div key={c.name} className="flex items-center justify-between text-xs">
                            <span className="truncate mr-2">{c.name}</span>
                            <span className="tabular-nums font-medium">{fmt(c.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {rampData.topMerchants?.length > 0 && (
                    <>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-1">Top Merchants</p>
                      <div className="space-y-1">
                        {rampData.topMerchants.slice(0, 5).map((m: any) => (
                          <div key={m.name} className="flex items-center justify-between text-xs">
                            <span className="truncate mr-2">{m.name}</span>
                            <span className="tabular-nums font-medium">{fmt(m.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* QuickBooks P&L */}
          <Card className="border-card-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-primary" />
                QuickBooks P&L
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {qboLoading ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
              ) : !qboData?.connected ? (
                <p className="text-xs text-muted-foreground py-3 text-center">No QuickBooks data synced yet</p>
              ) : (
                <div className="space-y-3">
                  {qboData.companyName && (
                    <p className="text-xs text-muted-foreground">{qboData.companyName}{qboData.updatedAt && <span> · Updated {new Date(qboData.updatedAt).toLocaleDateString()}</span>}</p>
                  )}
                  {qboData.profitLoss ? (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <span className="text-xs text-muted-foreground block">Revenue</span>
                          <span className="text-sm font-medium text-green-600 dark:text-green-400">{fmt(qboData.profitLoss.totalIncome)}</span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Total Costs</span>
                          <span className="text-sm font-medium">{fmt(qboData.profitLoss.totalExpenses)}</span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Net Income</span>
                          <span className={`text-sm font-medium ${qboData.profitLoss.netIncome < 0 ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>{fmt(qboData.profitLoss.netIncome)}</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">{qboData.profitLoss.period}</p>
                      {/* Monthly trend */}
                      {qboData.monthly && (
                        <>
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-2">Monthly Net Income</p>
                          <div className="space-y-1">
                            {Object.entries(qboData.monthly).map(([month, data]: [string, any]) => (
                              <div key={month} className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">{month}</span>
                                <span className={`tabular-nums font-medium ${data.netIncome < 0 ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>{fmt(data.netIncome)}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                      {/* Top COGS */}
                      {qboData.cogsBreakdown && (
                        <>
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-2">Top Costs (COGS)</p>
                          <div className="space-y-1">
                            {Object.entries(qboData.cogsBreakdown).slice(0, 5).map(([name, amount]: [string, any]) => (
                              <div key={name} className="flex items-center justify-between text-xs">
                                <span className="truncate mr-2">{name}</span>
                                <span className="tabular-nums font-medium">{fmt(amount)}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">No P&L data available</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
