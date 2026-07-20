import { usePageTitle } from '@/hooks/use-page-title'
import { useFinancialOverview } from '@/hooks/use-financial-overview'
import { fmtCurrency, fmtPct, fmtDelta } from '@/lib/financials/format'
import { lastTwo } from '@/lib/financials/perClean'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { ErrorState } from '@/components/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Percent,
  Sparkles,
  CreditCard,
  AlertCircle,
  CheckCircle2,
  CalendarClock,
} from 'lucide-react'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function DeltaChip({ curr, prev }: { curr: number | null; prev: number | null }) {
  const d = fmtDelta(curr, prev)
  if (d.text === '—') return <span className="text-muted-foreground">{d.text}</span>
  return (
    <span
      className={cn(
        'tabular-nums',
        d.dir === 'up' ? 'text-success' : d.dir === 'down' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {d.text} MoM
    </span>
  )
}

function FreshnessChip({
  qboUpdatedAt,
  qboConnected,
}: {
  qboUpdatedAt: string | null
  qboConnected: boolean
}) {
  if (!qboConnected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-warning/10 text-warning border border-warning/25">
        <AlertCircle className="w-3 h-3" />
        QuickBooks not connected
      </span>
    )
  }
  const dateStr = qboUpdatedAt
    ? new Date(qboUpdatedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null
  return (
    <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-success/10 text-success border border-success/25">
      <CheckCircle2 className="w-3 h-3" />
      QBO synced{dateStr ? ` · ${dateStr}` : ''}
    </span>
  )
}

// Tooltip styling mirroring financial-dashboard.tsx
const tooltipStyle: React.CSSProperties = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '6px',
  fontSize: '12px',
}
const tooltipLabelStyle: React.CSSProperties = { color: 'hsl(var(--foreground))' }

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function ymToAbbr(v: string): string {
  const [, m] = v.split('-')
  return MONTH_ABBR[Number(m) - 1] ?? v
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinancialOverviewPage() {
  usePageTitle('Financial Overview')
  const o = useFinancialOverview()
  const { curr, prev } = lastTwo(o.series)

  // ── Error state ──
  if (o.isError) {
    return (
      <PageContainer width="full" className="md:h-full md:flex md:flex-col">
        <PageHeader
          title="Financial Overview"
          subtitle="QuickBooks actuals, clean throughput, and card spend - last 12 months."
        />
        <ErrorState
          title="Failed to load financial data"
          description="Something went wrong fetching the financial overview. Check your connection and try again."
          onRetry={o.refetch}
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      {/* ── Header ── */}
      <PageHeader
        title="Financial Overview"
        subtitle="QuickBooks actuals, clean throughput, and card spend - last 12 months."
        actions={
          o.isLoading ? (
            <Skeleton className="h-7 w-48" />
          ) : (
            <FreshnessChip qboUpdatedAt={o.qboUpdatedAt} qboConnected={o.qboConnected} />
          )
        }
      />

      {/* ── QBO disconnected notice (non-blocking) ── */}
      {!o.qboConnected && !o.isLoading && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            QuickBooks data not connected or stale - financial figures unavailable.
            Throughput and card spend sections are still shown below.
          </span>
        </div>
      )}

      {/* ── KPI tiles ── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {o.isLoading ? (
          [...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          <>
            {/* Revenue */}
            <StatCard
              title="Revenue"
              value={fmtCurrency(curr?.income ?? null)}
              subtitle={<DeltaChip curr={curr?.income ?? null} prev={prev?.income ?? null} />}
              icon={DollarSign}
              tone="primary"
            />

            {/* Expenses */}
            <StatCard
              title="Expenses"
              value={fmtCurrency(curr?.totalExpenses ?? null)}
              subtitle={<DeltaChip curr={curr?.totalExpenses ?? null} prev={prev?.totalExpenses ?? null} />}
              icon={TrendingDown}
              tone="neutral"
            />

            {/* Net Income */}
            <StatCard
              title="Net Income"
              value={fmtCurrency(curr?.netIncome ?? null)}
              subtitle={<DeltaChip curr={curr?.netIncome ?? null} prev={prev?.netIncome ?? null} />}
              icon={TrendingUp}
              tone={
                curr?.netIncome != null
                  ? curr.netIncome < 0
                    ? 'destructive'
                    : 'success'
                  : 'neutral'
              }
            />

            {/* Margin */}
            <StatCard
              title="Margin"
              value={fmtPct(curr?.marginPct ?? null)}
              subtitle={<DeltaChip curr={curr?.marginPct ?? null} prev={prev?.marginPct ?? null} />}
              icon={Percent}
              tone={
                curr?.marginPct != null
                  ? curr.marginPct < 0
                    ? 'destructive'
                    : curr.marginPct < 10
                    ? 'warning'
                    : 'success'
                  : 'neutral'
              }
            />

            {/* Cleans */}
            <StatCard
              title="Cleans"
              value={curr?.cleans != null ? String(curr.cleans) : '—'}
              subtitle={<DeltaChip curr={curr?.cleans ?? null} prev={prev?.cleans ?? null} />}
              icon={Sparkles}
              tone="info"
            />

            {/* Revenue / Clean */}
            <StatCard
              title="Revenue / Clean"
              value={fmtCurrency(curr?.revPerClean ?? null)}
              subtitle={<DeltaChip curr={curr?.revPerClean ?? null} prev={prev?.revPerClean ?? null} />}
              icon={BarChart3}
              tone="primary"
            />
          </>
        )}
      </div>

      {/* ── Tasks due tile ── */}
      {(o.isLoading || o.taskLoad) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {o.isLoading ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : o.taskLoad ? (
            <StatCard
              title="Tasks Due"
              value={String(o.taskLoad.today + o.taskLoad.overdue)}
              subtitle={`${o.taskLoad.overdue} overdue`}
              icon={CalendarClock}
              tone={o.taskLoad.overdue > 0 ? 'destructive' : 'success'}
            />
          ) : null}
        </div>
      )}

      {/* ── Charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Margin Trend: Revenue + Expenses bars, Margin% line on right axis */}
        <Card className="border-card-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Margin Trend - Last 12 Months
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {o.isLoading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : o.series.length === 0 ? (
              <p className="text-xs text-muted-foreground py-12 text-center">No QuickBooks data available</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={o.series} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <XAxis
                    dataKey="ym"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={ymToAbbr}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                    width={48}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                    width={36}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                    formatter={(val: unknown, name: string) => {
                      const n = typeof val === 'number' ? val : null
                      if (name === 'Margin %') return [fmtPct(n), name]
                      return [fmtCurrency(n), name]
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="income" name="Revenue" fill="#3b82f6" fillOpacity={0.85} radius={[3, 3, 0, 0] as [number, number, number, number]} />
                  <Bar yAxisId="left" dataKey="totalExpenses" name="Expenses" fill="#ef4444" fillOpacity={0.75} radius={[3, 3, 0, 0] as [number, number, number, number]} />
                  <Line yAxisId="right" type="monotone" dataKey="marginPct" name="Margin %" stroke="#22c55e" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Throughput: Cleans bars + Rev/clean line */}
        <Card className="border-card-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-info" />
              Throughput - Cleans &amp; Revenue per Clean
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {o.isLoading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : o.series.length === 0 ? (
              <p className="text-xs text-muted-foreground py-12 text-center">No data available</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={o.series} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <XAxis
                    dataKey="ym"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={ymToAbbr}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    width={32}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `$${v}`}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                    formatter={(val: unknown, name: string): [string, string] => {
                      const n = typeof val === 'number' ? val : null
                      if (name === 'Rev/Clean') return [fmtCurrency(n), name]
                      return [String(val ?? '—'), name]
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="cleans" name="Cleans" fill="#8b5cf6" fillOpacity={0.85} radius={[3, 3, 0, 0] as [number, number, number, number]} />
                  <Line yAxisId="right" type="monotone" dataKey="revPerClean" name="Rev/Clean" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Ramp Card Spend Panel ── */}
      <Card className="border-card-border shadow-xs">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" />
            Ramp Card Spend
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <p className="text-xs text-muted-foreground">
            Ramp card spend - already included within QuickBooks expenses; shown here by category.
          </p>
          {o.isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          ) : !o.ramp ? (
            <p className="text-xs text-muted-foreground py-3 text-center">Ramp not connected</p>
          ) : (
            <div className="space-y-1.5">
              {/* Total spend summary */}
              {(o.ramp as any).totalSpend != null && (
                <div className="flex items-center justify-between pb-2 border-b border-border/40">
                  <span className="text-xs font-medium text-foreground">Total Spend</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {fmtCurrency((o.ramp as any).totalSpend)}
                  </span>
                </div>
              )}
              {/* By category */}
              {o.ramp.byCategory && o.ramp.byCategory.length > 0 ? (
                <>
                  <p className="text-2xs text-muted-foreground uppercase tracking-wide font-medium pt-1">
                    By Category
                  </p>
                  {o.ramp.byCategory.map((c: { category: string; total: number }) => (
                    <div key={c.category} className="flex items-center justify-between text-xs">
                      <span className="truncate mr-2 text-foreground">{c.category}</span>
                      <span className="tabular-nums font-medium shrink-0">{fmtCurrency(c.total)}</span>
                    </div>
                  ))}
                </>
              ) : (
                <p className="text-xs text-muted-foreground py-2 text-center">
                  No category breakdown available
                </p>
              )}
              {/* Window info */}
              {o.ramp.windowMonths != null && (
                <p className="text-2xs text-muted-foreground pt-2">
                  Window: last {o.ramp.windowMonths} month{o.ramp.windowMonths !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Footnote ── */}
      <p className="text-2xs text-muted-foreground">
        Clean &amp; task counts are de-duplicated across Breezeway and Trellis (one source per property).
      </p>
    </PageContainer>
  )
}
