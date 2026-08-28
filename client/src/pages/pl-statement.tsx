import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { StatCard } from '@/components/StatCard'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtCurrency, fmtPct } from '@/lib/financials/format'
import { profitColorClass } from '@/lib/profit-colors'
import { DollarSign, TrendingUp, Percent, Sparkles, RefreshCw, ChevronRight, Landmark } from 'lucide-react'
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip as ChartTooltip, Legend, CartesianGrid } from 'recharts'

// P&L tab — the QuickBooks Profit & Loss, mirrored monthly from the
// qbo_pl_months table (nightly api/cron/qbo-pl-sync + on-demand Refresh).
// Each month row expands into its QBO account-level breakdown, and an
// estimate column (Σ property sheet rates × real task counts) sits beside
// the actuals so drift is visible per month, not just in aggregate.

export interface QboPlMonthRow {
  month: string
  total_income: number
  total_cogs: number
  gross_profit: number
  total_expenses: number
  net_income: number
  income_breakdown: Record<string, number>
  cogs_breakdown: Record<string, number>
  expense_breakdown: Record<string, number>
  synced_at: string
}

interface EstimateRow {
  month: string
  est_revenue: number
  cleans: number
}

function monthLabel(iso: string, locale: string): string {
  const [y, m] = iso.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(locale === 'es' ? 'es' : 'en-US', { month: 'short', year: 'numeric' })
}

const STALE_AFTER_MS = 36 * 60 * 60 * 1000

export default function PlStatementPage() {
  const { t, locale } = useLocale('financials')
  const { toast } = useToast()
  const { effectiveUser } = useAuth()
  const isAdmin = effectiveUser?.role === 'admin'
  const [expanded, setExpanded] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const plQuery = useQuery({
    queryKey: ['/supabase/qbo-pl-months'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('qbo_pl_months')
        .select('*')
        .order('month', { ascending: true })
      if (error) throw error
      return (data ?? []) as QboPlMonthRow[]
    },
  })

  // Sheet estimates + clean counts per month, aggregated from the
  // per-property view so the two tabs can never disagree.
  const estQuery = useQuery({
    queryKey: ['/supabase/pl-month-estimates'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('property_month_financials')
        .select('month, est_revenue, cleans')
      if (error) throw error
      const byMonth = new Map<string, EstimateRow>()
      for (const r of (data ?? []) as Array<{ month: string; est_revenue: number; cleans: number }>) {
        const key = r.month.slice(0, 10)
        const acc = byMonth.get(key) ?? { month: key, est_revenue: 0, cleans: 0 }
        acc.est_revenue += Number(r.est_revenue) || 0
        acc.cleans += Number(r.cleans) || 0
        byMonth.set(key, acc)
      }
      return byMonth
    },
  })

  async function refreshNow() {
    setRefreshing(true)
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      const r = await fetch('/api/cron/qbo-pl-sync', { headers: { Authorization: `Bearer ${token}` } })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`)
      toast({ title: t('pl.refreshDone'), description: t('pl.refreshDoneDesc', { months: body.months ?? 0 }) })
      await plQuery.refetch()
      await estQuery.refetch()
    } catch (e: any) {
      toast({ title: t('pl.refreshFailed'), description: e?.message, variant: 'destructive' })
    } finally {
      setRefreshing(false)
    }
  }

  const rows = useMemo(() => {
    const months = (plQuery.data ?? []).map(m => ({ ...m, month: m.month.slice(0, 10) }))
    // Show trailing 13 months, newest first for the table.
    return months.slice(-13).reverse()
  }, [plQuery.data])

  const chartData = useMemo(
    () => rows.slice().reverse().map(m => ({
      name: monthLabel(m.month, locale),
      income: Math.round(m.total_income),
      costs: Math.round(m.total_cogs + m.total_expenses),
      margin: m.total_income > 0 ? Math.round((m.net_income / m.total_income) * 1000) / 10 : null,
    })),
    [rows, locale],
  )

  const latest = rows[0]
  const latestCleans = latest ? estQuery.data?.get(latest.month)?.cleans ?? 0 : 0
  const syncedAt = latest?.synced_at ? new Date(latest.synced_at) : null
  const isStale = !syncedAt || Date.now() - syncedAt.getTime() > STALE_AFTER_MS

  if (plQuery.isError) return <div className="p-5"><ErrorState onRetry={() => plQuery.refetch()} /></div>

  return (
    <div className="p-5 space-y-4">
      {/* Freshness + refresh */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${isStale ? 'border-warning/40 bg-warning/10 text-warning' : 'border-success/30 bg-success/10 text-success'}`}>
          <Landmark className="w-3.5 h-3.5" />
          {syncedAt
            ? t('pl.syncedAt', { when: syncedAt.toLocaleString(locale === 'es' ? 'es' : 'en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })
            : t('pl.neverSynced')}
        </div>
        {isAdmin && (
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={refreshNow} disabled={refreshing} data-testid="button-refresh-qbo-pl">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? t('pl.refreshing') : t('pl.refreshFromQbo')}
          </Button>
        )}
      </div>

      {/* KPI strip — latest month */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard title={t('pl.kpi.revenue')} value={latest ? fmtCurrency(latest.total_income) : '—'} subtitle={latest ? monthLabel(latest.month, locale) : undefined} icon={DollarSign} loading={plQuery.isLoading} />
        <StatCard title={t('pl.kpi.netIncome')} value={latest ? fmtCurrency(latest.net_income) : '—'} subtitle={latest ? monthLabel(latest.month, locale) : undefined} icon={TrendingUp} tone={latest && latest.net_income < 0 ? 'destructive' : 'primary'} loading={plQuery.isLoading} />
        <StatCard title={t('pl.kpi.netMargin')} value={latest && latest.total_income > 0 ? fmtPct((latest.net_income / latest.total_income) * 100) : '—'} icon={Percent} loading={plQuery.isLoading} />
        <StatCard title={t('pl.kpi.revPerClean')} value={latest && latestCleans > 0 ? fmtCurrency(latest.total_income / latestCleans) : '—'} subtitle={latestCleans > 0 ? t('pl.kpi.cleansCount', { count: latestCleans }) : undefined} icon={Sparkles} loading={plQuery.isLoading || estQuery.isLoading} />
        <StatCard title={t('pl.kpi.costPerClean')} value={latest && latestCleans > 0 ? fmtCurrency((latest.total_cogs + latest.total_expenses) / latestCleans) : '—'} icon={DollarSign} loading={plQuery.isLoading || estQuery.isLoading} className="col-span-2 lg:col-span-1" />
      </div>

      {/* Trend chart */}
      {chartData.length > 1 && (
        <div className="rounded-2xl border border-border bg-card shadow-sm p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{t('pl.chartTitle')}</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={44} />
                <YAxis yAxisId="pct" orientation="right" tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={36} />
                <ChartTooltip formatter={(v: number, name: string) => (name === t('pl.chart.margin') ? `${v}%` : fmtCurrency(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name={t('pl.chart.income')} fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                <Bar dataKey="costs" name={t('pl.chart.costs')} fill="hsl(var(--muted-foreground) / 0.45)" radius={[3, 3, 0, 0]} />
                <Line yAxisId="pct" dataKey="margin" name={t('pl.chart.margin')} stroke="hsl(var(--success))" strokeWidth={2} dot={false} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Monthly P&L table */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[840px]">
          <thead className="bg-muted/60 border-b border-border">
            <tr>
              {[t('pl.table.month'), t('pl.table.income'), t('pl.table.estRevenue'), t('pl.table.cogs'), t('pl.table.grossProfit'), t('pl.table.expenses'), t('pl.table.netIncome'), t('pl.table.margin'), t('pl.table.cleans')].map(h => (
                <th key={h} className="text-right first:text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plQuery.isLoading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">{[...Array(9)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}</tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="py-12">
                <EmptyState icon={Landmark} title={t('pl.emptyTitle')} description={t('pl.emptyDescription')} />
              </td></tr>
            ) : (
              rows.map(m => {
                const est = estQuery.data?.get(m.month)
                const margin = m.total_income > 0 ? (m.net_income / m.total_income) * 100 : null
                const isOpen = expanded === m.month
                return (
                  <Fragment key={m.month}>
                    <tr
                      className="border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors"
                      onClick={() => setExpanded(isOpen ? null : m.month)}
                      data-testid={`row-pl-${m.month}`}
                    >
                      <td className="py-2 px-3 font-medium whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                          {monthLabel(m.month, locale)}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-medium">{fmtCurrency(m.total_income)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{est ? fmtCurrency(est.est_revenue) : '—'}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(m.total_cogs)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(m.gross_profit)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtCurrency(m.total_expenses)}</td>
                      <td className={`py-2 px-3 text-right tabular-nums font-semibold ${m.net_income < 0 ? 'text-destructive' : ''}`}>{fmtCurrency(m.net_income)}</td>
                      <td className={`py-2 px-3 text-right tabular-nums ${profitColorClass(margin)}`}>{margin != null ? fmtPct(margin) : '—'}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{est?.cleans ?? '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-border/50 bg-muted/10">
                        <td colSpan={9} className="py-3 px-6">
                          <div className="grid md:grid-cols-3 gap-4 text-xs">
                            {([['pl.breakdown.income', m.income_breakdown], ['pl.breakdown.cogs', m.cogs_breakdown], ['pl.breakdown.expenses', m.expense_breakdown]] as const).map(([label, obj]) => (
                              <div key={label}>
                                <p className="font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{t(label)}</p>
                                {Object.keys(obj ?? {}).length === 0 ? (
                                  <p className="text-muted-foreground">—</p>
                                ) : (
                                  Object.entries(obj).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => (
                                    <div key={k} className="flex justify-between gap-3 py-0.5">
                                      <span className="truncate">{k}</span>
                                      <span className="tabular-nums shrink-0">{fmtCurrency(v)}</span>
                                    </div>
                                  ))
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
