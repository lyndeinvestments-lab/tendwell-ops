import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Building2, TrendingUp, DollarSign, Activity } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

function KpiCard({ title, value, icon: Icon, loading }: {
  title: string; value: string | number
  icon: React.ComponentType<{ className?: string }>; loading: boolean
}) {
  return (
    <Card className="border-card-border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{title}</p>
            {loading ? (
              <Skeleton className="h-7 w-16 mt-1.5" />
            ) : (
              <p data-testid={`kpi-${title.toLowerCase().replace(/\s+/g,'-')}`} className="text-xl font-semibold mt-1 text-foreground">{value}</p>
            )}
          </div>
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  // Use properties with stage join
  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/dashboard-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, stage_id, monthly_revenue_estimate, profit_percentage')
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

  // Build stage id → name map
  const stageMap = stages?.reduce((acc: Record<number, any>, s: any) => ({ ...acc, [s.id]: s }), {}) || {}
  
  const total = properties?.length ?? 0
  
  // Stage 4 = Active, 3 = Onboarding, 5 = Offboarding
  const activeStage = stages?.find((s: any) => s.name === 'Active')
  const onboardingStage = stages?.find((s: any) => s.name === 'Onboarding')
  const offboardingStage = stages?.find((s: any) => s.name === 'Offboarding')
  
  const active = properties?.filter((p: any) => p.stage_id === activeStage?.id).length ?? 0
  const onboarding = properties?.filter((p: any) => p.stage_id === onboardingStage?.id).length ?? 0
  const offboarding = properties?.filter((p: any) => p.stage_id === offboardingStage?.id).length ?? 0
  
  const totalRevenue = properties?.reduce((sum: number, p: any) => sum + (p.monthly_revenue_estimate || 0), 0) ?? 0
  const avgProfit = properties?.length
    ? properties.reduce((sum: number, p: any) => sum + (p.profit_percentage || 0), 0) / properties.length
    : 0

  return (
    <div className="p-5 max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Operations overview</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard title="Total Properties" value={total} icon={Building2} loading={isLoading} />
        <KpiCard title="Active" value={active} icon={Activity} loading={isLoading} />
        <KpiCard title="Onboarding" value={onboarding} icon={TrendingUp} loading={isLoading} />
        <KpiCard title="Offboarding" value={offboarding} icon={Activity} loading={isLoading} />
        <KpiCard
          title="Monthly Revenue"
          value={`$${totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          icon={DollarSign}
          loading={isLoading}
        />
        <KpiCard
          title="Avg Profit %"
          value={`${avgProfit.toFixed(1)}%`}
          icon={TrendingUp}
          loading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

        <Card className="border-card-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Recent Stage Transitions</CardTitle>
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
