import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Building2, TrendingUp, DollarSign, Activity, AlertTriangle, AlertCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

function KpiCard({ title, value, subtitle, icon: Icon, loading, alert }: {
  title: string; value: string | number; subtitle?: string
  icon: React.ComponentType<{ className?: string }>; loading: boolean; alert?: boolean
}) {
  return (
    <Card className={`border-card-border ${alert ? 'border-destructive/40' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{title}</p>
            {loading ? (
              <Skeleton className="h-7 w-16 mt-1.5" />
            ) : (
              <>
                <p data-testid={`kpi-${title.toLowerCase().replace(/\s+/g,'-')}`} className={`text-xl font-semibold mt-1 ${alert ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
                {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
              </>
            )}
          </div>
          <div className={`w-8 h-8 rounded-md ${alert ? 'bg-destructive/10' : 'bg-primary/10'} flex items-center justify-center`}>
            <Icon className={`w-4 h-4 ${alert ? 'text-destructive' : 'text-primary'}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/dashboard-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, stage_id, ce_charged, cleaner_pay, monthly_revenue_estimate, monthly_profit_estimate, profit_percentage, estimated_profit, bedrooms, full_baths, square_footage, address, cleaning_frequency')
      if (error) throw error
      return data || []
    },
  })

  const { data: stages } = useQuery({
    queryKey: ['/supabase/pipeline_stages'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pipeline_stages').select('*').order('display_order')
      if (error) throw error
      return data || []
    },
  })

  const { data: transitions, isLoading: transLoading } = useQuery({
    queryKey: ['/supabase/stage_transitions_recent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stage_transitions')
        .select('id, property_id, from_stage_id, to_stage_id, created_at, properties!stage_transitions_property_id_fkey(name)')
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return data || []
    },
  })

  const stageMap = stages?.reduce((acc: Record<number, any>, s: any) => ({ ...acc, [s.id]: s }), {}) || {}
  
  const total = properties?.length ?? 0
  const activeStage = stages?.find((s: any) => s.name === 'Active')
  const onboardingStage = stages?.find((s: any) => s.name === 'Onboarding')
  const offboardingStage = stages?.find((s: any) => s.name === 'Offboarding')
  
  const activeProps = properties?.filter((p: any) => p.stage_id === activeStage?.id) || []
  const active = activeProps.length
  const onboarding = properties?.filter((p: any) => p.stage_id === onboardingStage?.id).length ?? 0
  const offboarding = properties?.filter((p: any) => p.stage_id === offboardingStage?.id).length ?? 0
  
  const totalRevenue = activeProps.reduce((sum: number, p: any) => sum + (p.monthly_revenue_estimate || 0), 0)
  const totalProfit = activeProps.reduce((sum: number, p: any) => sum + (p.monthly_profit_estimate || 0), 0)
  const avgProfit = activeProps.length
    ? activeProps.reduce((sum: number, p: any) => sum + (p.profit_percentage || 0), 0) / activeProps.length
    : 0

  // Negative profit properties
  const negativeProfit = activeProps.filter((p: any) => (p.estimated_profit || 0) < 0)

  // Missing data detection
  const missingData = properties?.filter((p: any) => {
    const stg = stageMap[p.stage_id]
    if (!stg || stg.name === 'Offboarded' || stg.name === 'Lead') return false
    return !p.ce_charged || !p.cleaner_pay || !p.square_footage || !p.bedrooms || !p.address
  }) || []

  // Profit distribution buckets
  const profitBuckets = { high: 0, mid: 0, low: 0, negative: 0 }
  activeProps.forEach((p: any) => {
    const pct = p.profit_percentage || 0
    if (pct >= 30) profitBuckets.high++
    else if (pct >= 15) profitBuckets.mid++
    else if (pct >= 0) profitBuckets.low++
    else profitBuckets.negative++
  })

  return (
    <div className="p-5 max-w-6xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Operations overview</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard title="Total Properties" value={total} icon={Building2} loading={isLoading} />
        <KpiCard title="Active" value={active} icon={Activity} loading={isLoading} />
        <KpiCard title="Onboarding" value={onboarding} icon={TrendingUp} loading={isLoading} />
        <KpiCard title="Offboarding" value={offboarding} icon={Activity} loading={isLoading} />
        <KpiCard
          title="Monthly Revenue"
          value={`$${totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          subtitle={`$${totalProfit.toLocaleString('en-US', { maximumFractionDigits: 0 })} profit`}
          icon={DollarSign}
          loading={isLoading}
        />
        <KpiCard
          title="Avg Profit %"
          value={`${avgProfit.toFixed(1)}%`}
          icon={TrendingUp}
          loading={isLoading}
          alert={avgProfit < 15}
        />
      </div>

      {/* Alerts Row */}
      {!isLoading && (negativeProfit.length > 0 || missingData.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {negativeProfit.length > 0 && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  <span className="text-sm font-medium text-destructive">{negativeProfit.length} Negative Profit {negativeProfit.length === 1 ? 'Property' : 'Properties'}</span>
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {negativeProfit.slice(0, 8).map((p: any) => (
                    <div key={p.id} className="flex justify-between text-xs">
                      <span className="truncate mr-2">{p.name}</span>
                      <span className="text-destructive font-medium tabular-nums whitespace-nowrap">${p.estimated_profit?.toFixed(2)}</span>
                    </div>
                  ))}
                  {negativeProfit.length > 8 && <p className="text-xs text-muted-foreground">+{negativeProfit.length - 8} more</p>}
                </div>
              </CardContent>
            </Card>
          )}
          {missingData.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-medium text-amber-600 dark:text-amber-400">{missingData.length} Properties Missing Data</span>
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {missingData.slice(0, 8).map((p: any) => {
                    const missing: string[] = []
                    if (!p.ce_charged) missing.push('CE')
                    if (!p.cleaner_pay) missing.push('Pay')
                    if (!p.square_footage) missing.push('SqFt')
                    if (!p.bedrooms) missing.push('Beds')
                    if (!p.address) missing.push('Address')
                    return (
                      <div key={p.id} className="flex justify-between text-xs gap-2">
                        <span className="truncate">{p.name}</span>
                        <span className="text-amber-600 dark:text-amber-400 whitespace-nowrap">{missing.join(', ')}</span>
                      </div>
                    )
                  })}
                  {missingData.length > 8 && <p className="text-xs text-muted-foreground">+{missingData.length - 8} more</p>}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Profit Distribution */}
        <Card className="border-card-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Profit Distribution (Active)</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoading ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
            ) : (
              <div className="space-y-2.5">
                {[
                  { label: 'High (≥30%)', count: profitBuckets.high, color: '#22c55e', pct: active > 0 ? (profitBuckets.high / active * 100) : 0 },
                  { label: 'Mid (15-30%)', count: profitBuckets.mid, color: '#f59e0b', pct: active > 0 ? (profitBuckets.mid / active * 100) : 0 },
                  { label: 'Low (0-15%)', count: profitBuckets.low, color: '#ef4444', pct: active > 0 ? (profitBuckets.low / active * 100) : 0 },
                  { label: 'Negative', count: profitBuckets.negative, color: '#dc2626', pct: active > 0 ? (profitBuckets.negative / active * 100) : 0 },
                ].map(b => (
                  <div key={b.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{b.label}</span>
                      <span className="font-medium tabular-nums">{b.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${b.pct}%`, backgroundColor: b.color }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Properties by Stage */}
        <Card className="border-card-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Properties by Stage</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoading ? (
              <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
            ) : (
              <div className="space-y-2">
                {stages?.map((stage: any) => {
                  const count = properties?.filter((p: any) => p.stage_id === stage.id).length ?? 0
                  return (
                    <div key={stage.id} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
                        <span className="text-sm">{stage.name}</span>
                      </div>
                      <span data-testid={`stage-count-${stage.name}`} className="text-sm font-medium tabular-nums">{count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Stage Transitions */}
        <Card className="border-card-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Recent Transitions</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {transLoading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : transitions && transitions.length > 0 ? (
              <div className="space-y-2">
                {transitions.map((t: any) => {
                  const fromStage = stageMap[t.from_stage_id]
                  const toStage = stageMap[t.to_stage_id]
                  return (
                    <div key={t.id} className="flex items-start justify-between gap-2 py-1 border-b border-border/40 last:border-0">
                      <div>
                        <p className="text-sm font-medium leading-none">{t.properties?.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {fromStage?.name ?? '—'} → {toStage?.name ?? '—'}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Activity className="w-8 h-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No transitions yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
