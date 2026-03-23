import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { usePageTitle } from '@/hooks/use-page-title'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Building2, TrendingUp, DollarSign, Activity, AlertTriangle, AlertCircle, UserCheck, UserMinus } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'

function KpiCard({ title, value, subtitle, icon: Icon, loading, alert, onClick }: {
  title: string; value: string | number; subtitle?: string
  icon: React.ComponentType<{ className?: string }>; loading: boolean; alert?: boolean
  onClick?: () => void
}) {
  return (
    <Card
      className={`border-card-border ${alert ? 'border-destructive/40' : ''} ${onClick ? 'cursor-pointer hover:bg-muted/30 transition-colors' : ''}`}
      onClick={onClick}
    >
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
  const [, navigate] = useLocation()
  usePageTitle('Dashboard')

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

  const { data: transitions30, isLoading: trans30Loading } = useQuery({
    queryKey: ['/supabase/transitions-30d'],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from('stage_transitions')
        .select('property_id, to_stage_id, created_at, properties!stage_transitions_property_id_fkey(name), pipeline_stages!stage_transitions_to_stage_id_fkey(name)')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
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

  // Missing data detection — exclude Lead, Quote, Offboarded
  const missingData = properties?.filter((p: any) => {
    const stg = stageMap[p.stage_id]
    if (!stg || stg.name === 'Offboarded' || stg.name === 'Lead' || stg.name === 'Quote') return false
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

  // 30-day activity metrics
  const onboardingStageId = onboardingStage?.id
  const activeStageId = activeStage?.id
  const offboardingStageIdVal = offboardingStage?.id
  const offboardedStage = stages?.find((s: any) => s.name === 'Offboarded')
  const offboardedStageId = offboardedStage?.id

  const newProperties30 = transitions30?.filter((t: any) =>
    t.to_stage_id === onboardingStageId || t.to_stage_id === activeStageId
  ) || []
  const offboarded30 = transitions30?.filter((t: any) =>
    t.to_stage_id === offboardedStageId
  ) || []

  // De-duplicate by property (take most recent per property)
  const dedup = (arr: any[]) => {
    const seen = new Set()
    return arr.filter((t: any) => {
      if (seen.has(t.property_id)) return false
      seen.add(t.property_id)
      return true
    })
  }
  const newProps30Deduped = dedup(newProperties30)
  const offboarded30Deduped = dedup(offboarded30)

  return (
    <div className="p-5 space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Operations overview</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard title="Total Properties" value={total} icon={Building2} loading={isLoading} onClick={() => navigate('/master-list')} />
        <KpiCard title="Active" value={active} icon={Activity} loading={isLoading} onClick={() => navigate('/property-list')} />
        <KpiCard title="Onboarding" value={onboarding} icon={TrendingUp} loading={isLoading} onClick={() => navigate('/pipeline')} />
        <KpiCard title="Offboarding" value={offboarding} icon={Activity} loading={isLoading} onClick={() => navigate('/pipeline')} />
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

      {/* 30-Day Activity Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <UserCheck className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium">New Properties (30 days)</span>
              {trans30Loading ? <Skeleton className="h-4 w-6" /> : (
                <span className="ml-auto text-sm font-semibold tabular-nums text-blue-600 dark:text-blue-400">{newProps30Deduped.length}</span>
              )}
            </div>
            {trans30Loading ? (
              <div className="space-y-1">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>
            ) : newProps30Deduped.length === 0 ? (
              <p className="text-xs text-muted-foreground">No new properties in the last 30 days</p>
            ) : (
              <div className="space-y-0.5 max-h-28 overflow-y-auto">
                {newProps30Deduped.map((t: any) => (
                  <div key={t.property_id} className="flex justify-between text-xs">
                    <span className="truncate mr-2 cursor-pointer hover:underline" onClick={() => navigate('/pipeline')}>{t.properties?.name}</span>
                    <span className="text-muted-foreground whitespace-nowrap">{t.pipeline_stages?.name}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <UserMinus className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium">Offboarded (30 days)</span>
              {trans30Loading ? <Skeleton className="h-4 w-6" /> : (
                <span className="ml-auto text-sm font-semibold tabular-nums text-muted-foreground">{offboarded30Deduped.length}</span>
              )}
            </div>
            {trans30Loading ? (
              <div className="space-y-1">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>
            ) : offboarded30Deduped.length === 0 ? (
              <p className="text-xs text-muted-foreground">No offboarded properties in the last 30 days</p>
            ) : (
              <div className="space-y-0.5 max-h-28 overflow-y-auto">
                {offboarded30Deduped.map((t: any) => (
                  <div key={t.property_id} className="flex justify-between text-xs">
                    <span className="truncate mr-2 cursor-pointer hover:underline" onClick={() => navigate('/previous-properties')}>{t.properties?.name}</span>
                    <span className="text-muted-foreground whitespace-nowrap">{format(new Date(t.created_at), 'MMM d')}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
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
                      <span className="truncate mr-2 cursor-pointer hover:underline" onClick={() => navigate('/cost-tracking')}>{p.name}</span>
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
                        <span className="truncate cursor-pointer hover:underline" onClick={() => navigate('/master-list?highlight=' + p.id)}>{p.name}</span>
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
                  <div key={b.label} className="cursor-pointer" onClick={() => navigate('/cost-tracking')}>
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
                        <p className="text-sm font-medium leading-none cursor-pointer hover:underline" onClick={() => navigate('/pipeline')}>{t.properties?.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {fromStage?.name ?? 'New'} → {toStage?.name ?? '—'}
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
