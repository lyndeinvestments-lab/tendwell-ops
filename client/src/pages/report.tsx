import { useState, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePageTitle } from '@/hooks/use-page-title'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { profitColorClass } from '@/lib/profit-colors'
import { Download, TrendingUp, TrendingDown, DollarSign, Building2, AlertTriangle, CheckSquare } from 'lucide-react'
import { format } from 'date-fns'

function fmt(n: number | null | undefined) {
  if (n == null) return '$0'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ReportPage() {
  usePageTitle('Executive Summary')
  const reportRef = useRef<HTMLDivElement>(null)
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  // Properties data
  const { data: properties, isLoading: propsLoading } = useQuery({
    queryKey: ['/supabase/report-properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, ce_charged, total_estimated_cost, estimated_profit, profit_percentage, avg_cleans_per_month, monthly_revenue_estimate, monthly_profit_estimate, stage_name')
      if (error) throw error
      return data || []
    },
  })

  // Cleaning history for the selected month
  const { data: cleans } = useQuery({
    queryKey: ['/supabase/report-cleans', month],
    queryFn: async () => {
      const startDate = `${month}-01`
      const endDate = `${month}-31`
      const { data, error } = await supabase
        .from('cleaning_history')
        .select('id, property_id, clean_date')
        .gte('clean_date', startDate)
        .lte('clean_date', endDate)
      if (error) throw error
      return data || []
    },
  })

  // Issues for the selected month
  const { data: issues } = useQuery({
    queryKey: ['/supabase/report-issues', month],
    queryFn: async () => {
      const startDate = `${month}-01`
      const endDate = `${month}-31`
      const { data, error } = await supabase
        .from('cleaning_issues')
        .select('id, category, status, property_name')
        .gte('report_date', startDate)
        .lte('report_date', endDate)
      if (error) throw error
      return data || []
    },
  })

  // Tasks
  const { data: tasks } = useQuery({
    queryKey: ['/supabase/report-tasks'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tasks').select('id, status, priority')
      if (error) throw error
      return data || []
    },
  })

  // QBO P&L data
  const { data: qboRaw } = useQuery({
    queryKey: ['/supabase/report-qbo'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'qbo_pl_data').single()
      if (error || !data?.value) return null
      return typeof data.value === 'string' ? JSON.parse(data.value) : data.value
    },
  })

  // ─── Derived stats ────────────────────────────────────────────────────────
  const activeProps = properties?.filter((p: any) => p.stage_name === 'Active') || []
  const totalRevenue = activeProps.reduce((s: number, p: any) => s + (p.monthly_revenue_estimate || 0), 0)
  const totalProfit = activeProps.reduce((s: number, p: any) => s + (p.monthly_profit_estimate || 0), 0)
  const avgMargin = activeProps.length ? activeProps.reduce((s: number, p: any) => s + (p.profit_percentage || 0), 0) / activeProps.length : 0
  const negativeCount = activeProps.filter((p: any) => (p.estimated_profit || 0) < 0).length
  const totalCleans = cleans?.length || 0
  const totalIssues = issues?.length || 0
  const issueRate = totalCleans > 0 ? ((totalIssues / totalCleans) * 100).toFixed(1) : '0'
  const openTasks = tasks?.filter((t: any) => t.status !== 'Done').length || 0
  const overdueTasks = tasks?.filter((t: any) => t.priority === 'Urgent' && t.status !== 'Done').length || 0

  // Top/bottom properties by profit
  const sortedByProfit = [...activeProps].sort((a: any, b: any) => (b.profit_percentage || 0) - (a.profit_percentage || 0))
  const topProperties = sortedByProfit.slice(0, 5)
  const bottomProperties = sortedByProfit.slice(-5).reverse()

  // Issue categories
  const issueByCategory = useMemo(() => {
    if (!issues) return []
    const map: Record<string, number> = {}
    for (const i of issues) map[i.category] = (map[i.category] || 0) + 1
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [issues])

  const monthLabel = format(new Date(month + '-01'), 'MMMM yyyy')

  function handlePrint() {
    window.print()
  }

  const isLoading = propsLoading

  return (
    <div className="p-5 space-y-6 h-full overflow-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap no-print">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Executive Summary</h1>
          <p className="text-sm text-muted-foreground">Founder-level overview of operations and financials</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="h-8 text-xs border border-input rounded-md px-2 bg-background" />
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handlePrint}>
            <Download className="w-3.5 h-3.5" /> Print / PDF
          </Button>
        </div>
      </div>

      <div ref={reportRef}>
        {/* Report header (visible in print) */}
        <div className="hidden print:block mb-6">
          <h1 className="text-2xl font-bold">Tendwell Cleaning Co.</h1>
          <p className="text-lg text-muted-foreground">Executive Summary — {monthLabel}</p>
          <p className="text-sm text-muted-foreground">Generated {format(new Date(), 'MMMM d, yyyy')}</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Active Properties</p>
                  {isLoading ? <Skeleton className="h-7 w-12 mt-1" /> : <p className="text-2xl font-semibold">{activeProps.length}</p>}
                </div>
                <Building2 className="w-5 h-5 text-primary opacity-60" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Est. Monthly Revenue</p>
                  {isLoading ? <Skeleton className="h-7 w-20 mt-1" /> : <p className="text-2xl font-semibold">{fmt(totalRevenue)}</p>}
                </div>
                <DollarSign className="w-5 h-5 text-green-600 opacity-60" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Est. Monthly Profit</p>
                  {isLoading ? <Skeleton className="h-7 w-20 mt-1" /> : <p className={`text-2xl font-semibold ${totalProfit < 0 ? 'text-destructive' : ''}`}>{fmt(totalProfit)}</p>}
                </div>
                <TrendingUp className="w-5 h-5 text-primary opacity-60" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Avg Profit Margin</p>
                  {isLoading ? <Skeleton className="h-7 w-16 mt-1" /> : <p className={`text-2xl font-semibold ${profitColorClass(avgMargin)}`}>{avgMargin.toFixed(1)}%</p>}
                </div>
                <TrendingDown className="w-5 h-5 text-amber-500 opacity-60" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Operations Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Total Cleans ({monthLabel.split(' ')[0]})</p><p className="text-lg font-semibold">{totalCleans}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Issues Logged</p><p className={`text-lg font-semibold ${totalIssues > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>{totalIssues}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Issue Rate</p><p className="text-lg font-semibold">{issueRate}%</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Open Tasks</p><p className={`text-lg font-semibold ${overdueTasks > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{openTasks}{overdueTasks > 0 && <span className="text-xs ml-1">({overdueTasks} urgent)</span>}</p></CardContent></Card>
        </div>

        {/* QuickBooks Actuals */}
        {qboRaw && (
          <Card className="mt-4">
            <CardHeader className="pb-2"><CardTitle className="text-sm">QuickBooks Actuals (YTD)</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div><p className="text-xs text-muted-foreground">Revenue</p><p className="text-lg font-semibold text-green-600 dark:text-green-400">{fmt(qboRaw.totalIncome)}</p></div>
                <div><p className="text-xs text-muted-foreground">Total Costs</p><p className="text-lg font-semibold">{fmt((qboRaw.totalCOGS ?? 0) + (qboRaw.totalExpenses ?? 0))}</p></div>
                <div><p className="text-xs text-muted-foreground">Net Income</p><p className={`text-lg font-semibold ${qboRaw.netIncome < 0 ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>{fmt(qboRaw.netIncome)}</p></div>
              </div>
              {qboRaw.monthly && (
                <div className="mt-3 grid grid-cols-4 gap-3 text-xs">
                  {Object.entries(qboRaw.monthly).map(([m, d]: [string, any]) => (
                    <div key={m}>
                      <p className="text-muted-foreground">{m}</p>
                      <p className={`font-medium ${d.netIncome < 0 ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>{fmt(d.netIncome)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Top & Bottom Properties */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-green-600 dark:text-green-400">Top 5 by Margin</CardTitle></CardHeader>
            <CardContent className="pt-0">
              {topProperties.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between py-1.5 text-xs border-b border-border/30 last:border-0">
                  <span className="truncate mr-2">{p.name}</span>
                  <span className={`font-medium tabular-nums ${profitColorClass(p.profit_percentage)}`}>{(p.profit_percentage || 0).toFixed(1)}%</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-destructive">Bottom 5 by Margin</CardTitle></CardHeader>
            <CardContent className="pt-0">
              {bottomProperties.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between py-1.5 text-xs border-b border-border/30 last:border-0">
                  <span className="truncate mr-2">{p.name}</span>
                  <span className={`font-medium tabular-nums ${profitColorClass(p.profit_percentage)}`}>{(p.profit_percentage || 0).toFixed(1)}%</span>
                </div>
              ))}
              {negativeCount > 0 && <p className="text-xs text-destructive mt-2">{negativeCount} properties with negative margin</p>}
            </CardContent>
          </Card>
        </div>

        {/* Issues Breakdown */}
        {issueByCategory.length > 0 && (
          <Card className="mt-4">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Issues by Category ({monthLabel.split(' ')[0]})</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-1">
                {issueByCategory.map(([cat, count]) => (
                  <div key={cat} className="flex items-center justify-between text-xs py-1 border-b border-border/30 last:border-0">
                    <span>{cat}</span>
                    <span className="font-medium tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
