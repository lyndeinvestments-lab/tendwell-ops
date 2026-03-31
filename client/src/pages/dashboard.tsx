import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, Link } from 'wouter'
import { usePageTitle } from '@/hooks/use-page-title'
import { supabase } from '@/lib/supabase'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Building2, TrendingUp, DollarSign, Activity, AlertTriangle, AlertCircle, UserCheck, UserMinus, Wrench, Users, ClipboardCheck, CalendarDays, ChevronDown, ChevronUp } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'

function KpiCard({ title, value, subtitle, icon: Icon, loading, alert, onClick, hint }: {
  title: string; value: string | number; subtitle?: string
  icon: React.ComponentType<{ className?: string }>; loading: boolean; alert?: boolean
  onClick?: () => void; hint?: string
}) {
  return (
    <Card
      className={`border-card-border ${alert ? 'border-destructive/40' : ''} ${onClick ? 'cursor-pointer hover:bg-muted/30 transition-colors' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide" title={hint}>{title}</p>
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
  const { openPropertyModal } = usePropertyModal()
  usePageTitle('Dashboard')

  type Preset = '7d' | '30d' | '90d' | 'custom'
  const [preset, setPreset] = useState<Preset>(() => {
    try { return (localStorage.getItem('tendwell-dash-preset') as Preset) || '30d' } catch { return '30d' }
  })
  const [customFrom, setCustomFrom] = useState(() => {
    try { return localStorage.getItem('tendwell-dash-from') || '' } catch { return '' }
  })
  const [customTo, setCustomTo] = useState(() => {
    try { return localStorage.getItem('tendwell-dash-to') || '' } catch { return '' }
  })

  const [missingCollapsed, setMissingCollapsed] = useState(false)

  // Persist filter selection
  useEffect(() => {
    try {
      localStorage.setItem('tendwell-dash-preset', preset)
      localStorage.setItem('tendwell-dash-from', customFrom)
      localStorage.setItem('tendwell-dash-to', customTo)
    } catch { /* ignore */ }
  }, [preset, customFrom, customTo])

  const { sinceDate, untilDate, periodLabel } = useMemo(() => {
    if (preset === 'custom') {
      const since = customFrom
        ? new Date(customFrom).toISOString()
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const until = customTo
        ? new Date(new Date(customTo).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString()
        : new Date().toISOString()
      const label =
        customFrom && customTo
          ? `${format(new Date(customFrom), 'MMM d')}–${format(new Date(customTo), 'MMM d')}`
          : '30 days'
      return { sinceDate: since, untilDate: until, periodLabel: label }
    }
    const days = preset === '7d' ? 7 : preset === '90d' ? 90 : 30
    const label = preset === '7d' ? '7 days' : preset === '90d' ? '90 days' : '30 days'
    return {
      sinceDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
      untilDate: new Date().toISOString(),
      periodLabel: label,
    }
  }, [preset, customFrom, customTo])

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/dashboard-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, stage_id, ce_charged, cleaner_pay, monthly_revenue_estimate, monthly_profit_estimate, profit_percentage, estimated_profit, bedrooms, full_baths, square_footage, address, cleaning_frequency, exclude_from_financials')
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
    queryKey: ['/supabase/stage_transitions_recent', sinceDate, untilDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stage_transitions')
        .select('id, property_id, from_stage_id, to_stage_id, created_at, properties!stage_transitions_property_id_fkey(name)')
        .gte('created_at', sinceDate)
        .lte('created_at', untilDate)
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return data || []
    },
  })

  const { data: transitions30, isLoading: trans30Loading } = useQuery({
    queryKey: ['/supabase/transitions-period', sinceDate, untilDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stage_transitions')
        .select('property_id, to_stage_id, created_at, properties!stage_transitions_property_id_fkey(name), pipeline_stages!stage_transitions_to_stage_id_fkey(name)')
        .gte('created_at', sinceDate)
        .lte('created_at', untilDate)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return data || []
    },
  })

  // Inspections data for Quality widgets
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentInspections } = useQuery({
    queryKey: ['/supabase/dashboard-inspections'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspections')
        .select('property_id, overall_score, inspected_at, properties!inspections_property_id_fkey(name)')
        .gte('inspected_at', ninetyDaysAgo)
        .order('inspected_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // Scheduled this week
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const { data: scheduledThisWeek } = useQuery({
    queryKey: ['/supabase/dashboard-scheduled-week'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clean_assignments')
        .select('id')
        .gte('scheduled_date', weekStart.toISOString().split('T')[0])
        .lte('scheduled_date', weekEnd.toISOString().split('T')[0])
        .eq('status', 'scheduled')
      if (error) return []
      return data || []
    },
  })

  // CRM data
  const { data: crmContacts } = useQuery({
    queryKey: ['/supabase/dashboard-crm-contacts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('id, payment_method, created_at')
      if (error) throw error
      return data || []
    },
  })

  const { data: unassignedCount } = useQuery({
    queryKey: ['/supabase/dashboard-unassigned'],
    queryFn: async () => {
      const { count, error } = await supabase.from('properties').select('*', { count: 'exact', head: true }).is('contact_id', null)
      if (error) return 0
      return count ?? 0
    },
  })

  const crmStats = useMemo(() => {
    if (!crmContacts) return { total: 0, new30: 0, paymentBreakdown: [] as { method: string; count: number }[] }
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const new30 = crmContacts.filter(c => c.created_at >= thirtyDaysAgo).length
    const payMap: Record<string, number> = {}
    for (const c of crmContacts) {
      const m = c.payment_method || 'Unknown'
      payMap[m] = (payMap[m] || 0) + 1
    }
    const paymentBreakdown = Object.entries(payMap).map(([method, count]) => ({ method, count })).sort((a, b) => b.count - a.count)
    return { total: crmContacts.length, new30, paymentBreakdown }
  }, [crmContacts])

  const stageMap = stages?.reduce((acc: Record<number, any>, s: any) => ({ ...acc, [s.id]: s }), {}) || {}

  const total = properties?.length ?? 0
  const activeStage = stages?.find((s: any) => s.name === 'Active')
  const onboardingStage = stages?.find((s: any) => s.name === 'Onboarding')
  const offboardingStage = stages?.find((s: any) => s.name === 'Offboarding')

  const activeProps = properties?.filter((p: any) => p.stage_id === activeStage?.id) || []
  const active = activeProps.length
  const onboarding = properties?.filter((p: any) => p.stage_id === onboardingStage?.id).length ?? 0
  const offboarding = properties?.filter((p: any) => p.stage_id === offboardingStage?.id).length ?? 0

  const financialProps = activeProps.filter((p: any) => !p.exclude_from_financials)
  const totalRevenue = financialProps.reduce((sum: number, p: any) => sum + (p.monthly_revenue_estimate || 0), 0)
  const totalProfit = financialProps.reduce((sum: number, p: any) => sum + (p.monthly_profit_estimate || 0), 0)
  const avgProfit = financialProps.length
    ? financialProps.reduce((sum: number, p: any) => sum + (p.profit_percentage || 0), 0) / financialProps.length
    : 0

  // Negative profit properties — exclude $0 CE (those are missing data, not truly negative) and excluded props
  const negativeProfit = financialProps.filter((p: any) => (p.estimated_profit || 0) < 0 && (p.ce_charged || 0) > 0)

  // Missing data detection — exclude Lead, Quote, Offboarded
  const missingData = properties?.filter((p: any) => {
    const stg = stageMap[p.stage_id]
    if (!stg || stg.name === 'Offboarded' || stg.name === 'Lead' || stg.name === 'Quote' || stg.name === 'Offboarding') return false
    return !p.ce_charged || !p.cleaner_pay || !p.square_footage || !p.bedrooms || !p.address
  }) || []

  // Profit distribution buckets (exclude SCounty/excluded properties)
  const profitBuckets = { high: 0, mid: 0, low: 0, negative: 0 }
  financialProps.forEach((p: any) => {
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

      {/* Date Range Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 -mt-1">
        {(['7d', '30d', '90d', 'custom'] as Preset[]).map((p) => (
          <Button
            key={p}
            variant={preset === p ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPreset(p)}
          >
            {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : p === '90d' ? '90 Days' : 'Custom'}
          </Button>
        ))}
        {preset === 'custom' && (
          <>
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="w-auto"
              aria-label="From date"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="w-auto"
              aria-label="To date"
            />
          </>
        )}
        {preset === 'custom' && customFrom && customTo && (
          <span className="text-xs text-primary font-medium">
            Showing {format(new Date(customFrom), 'MMM d')}–{format(new Date(customTo), 'MMM d, yyyy')}
          </span>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard title="Total Properties" value={total} icon={Building2} loading={isLoading} onClick={() => navigate('/master-list')} />
        <KpiCard title="Active" value={active} icon={Activity} loading={isLoading} onClick={() => navigate('/master-list?stage=Active')} />
        <KpiCard title="Onboarding" value={onboarding} icon={TrendingUp} loading={isLoading} onClick={() => navigate('/master-list?stage=Onboarding')} />
        <KpiCard title="Offboarding" value={offboarding} icon={Activity} loading={isLoading} onClick={() => navigate('/master-list?stage=Offboarding')} />
        <KpiCard
          title="Monthly Revenue"
          value={`$${totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          subtitle={`$${totalProfit.toLocaleString('en-US', { maximumFractionDigits: 0 })} profit`}
          icon={DollarSign}
          loading={isLoading}
          hint="Includes all active properties × estimated cleans/month. See Revenue Report for actual CE charged totals."
          onClick={() => navigate('/revenue-report')}
        />
        <KpiCard
          title="Avg Profit %"
          value={`${avgProfit.toFixed(1)}%`}
          icon={TrendingUp}
          loading={isLoading}
          alert={avgProfit < 15}
          hint="Average profit margin across active properties. Numbers may differ from Revenue Report which uses actual CE charged totals."
          onClick={() => navigate('/revenue-report')}
        />
      </div>

      {/* 30-Day Activity Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <UserCheck className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium">New Properties ({periodLabel})</span>
              {trans30Loading ? <Skeleton className="h-4 w-6" /> : (
                <span className="ml-auto text-sm font-semibold tabular-nums text-blue-600 dark:text-blue-400">{newProps30Deduped.length}</span>
              )}
            </div>
            {trans30Loading ? (
              <div className="space-y-1">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>
            ) : newProps30Deduped.length === 0 ? (
              <p className="text-xs text-muted-foreground">No new properties in this period</p>
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
              <span className="text-sm font-medium">Offboarded ({periodLabel})</span>
              {trans30Loading ? <Skeleton className="h-4 w-6" /> : (
                <span className="ml-auto text-sm font-semibold tabular-nums text-muted-foreground">{offboarded30Deduped.length}</span>
              )}
            </div>
            {trans30Loading ? (
              <div className="space-y-1">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>
            ) : offboarded30Deduped.length === 0 ? (
              <p className="text-xs text-muted-foreground">No offboarded properties in this period</p>
            ) : (
              <>
                <div className="space-y-0.5 max-h-28 overflow-y-auto">
                  {offboarded30Deduped.map((t: any) => (
                    <div key={t.property_id} className="flex justify-between text-xs">
                      <span className="truncate mr-2 cursor-pointer hover:underline" onClick={() => navigate('/previous-properties')}>{t.properties?.name}</span>
                      <span className="text-muted-foreground whitespace-nowrap">{format(new Date(t.created_at), 'MMM d')}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => navigate('/previous-properties')} className="text-xs text-primary hover:underline mt-2 block">
                  View All →
                </button>
              </>
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
                  <span className="text-sm font-medium text-destructive">{negativeProfit.length} Negative Profit {negativeProfit.length === 1 ? 'Property' : 'Properties'}<span className="font-normal text-xs text-muted-foreground ml-1">(current)</span></span>
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {negativeProfit.slice(0, 8).map((p: any) => (
                    <div key={p.id} className="flex justify-between text-xs">
                      <span className="truncate mr-2 cursor-pointer hover:underline" onClick={() => navigate('/cost-tracking')}>{p.name}</span>
                      <span className="text-destructive font-medium tabular-nums whitespace-nowrap">${p.estimated_profit?.toFixed(2)}</span>
                    </div>
                  ))}
                  {negativeProfit.length > 8 && (
                    <button onClick={() => navigate('/cost-tracking')} className="text-xs text-primary hover:underline mt-1">
                      View all {negativeProfit.length} →
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          {missingData.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="p-4">
                <button className="flex items-center gap-2 mb-2 w-full text-left" onClick={() => setMissingCollapsed(v => !v)}>
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-medium text-amber-600 dark:text-amber-400">{missingData.length} Properties Missing Data<span className="font-normal text-xs text-muted-foreground ml-1">(current)</span></span>
                  <span className="ml-auto text-muted-foreground">
                    {missingCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  </span>
                </button>
                {!missingCollapsed && <div className="space-y-1 max-h-32 overflow-y-auto">
                  {missingData.slice(0, 8).map((p: any) => {
                    const missingFields: string[] = []
                    if (!p.ce_charged) missingFields.push('ce_charged')
                    if (!p.cleaner_pay) missingFields.push('cleaner_pay')
                    if (!p.square_footage) missingFields.push('square_footage')
                    if (!p.bedrooms) missingFields.push('bedrooms')
                    if (!p.address) missingFields.push('address')
                    const missingLabels = missingFields.map(f => ({ ce_charged: 'CE', cleaner_pay: 'Pay', square_footage: 'SqFt', bedrooms: 'Beds', address: 'Address' }[f] ?? f))
                    return (
                      <div key={p.id} className="flex items-center justify-between text-xs gap-2">
                        <span className="truncate cursor-pointer hover:underline" onClick={() => navigate('/master-list?highlight=' + p.id)}>{p.name}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-amber-600 dark:text-amber-400">{missingLabels.join(', ')}</span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-5 px-1.5 text-xs gap-1"
                            onClick={() => openPropertyModal(p.id, 'dashboard-missing', missingFields)}
                            data-testid={`button-fix-missing-${p.id}`}
                          >
                            <Wrench className="w-2.5 h-2.5" />
                            Fix
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                  {missingData.length > 8 && (
                    <button onClick={() => navigate('/master-list')} className="text-xs text-primary hover:underline mt-1">
                      View all {missingData.length} →
                    </button>
                  )}
                </div>}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Profit Distribution */}
        <Card className="border-card-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Profit Distribution (Active)<span className="font-normal text-xs text-muted-foreground ml-1.5">(current)</span></CardTitle>
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
            <CardTitle className="text-sm font-medium">Properties by Stage<span className="font-normal text-xs text-muted-foreground ml-1.5">(current)</span></CardTitle>
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
            <CardTitle className="text-sm font-medium">Recent Transitions ({periodLabel})</CardTitle>
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
                        <p
                          className="text-sm font-medium leading-none cursor-pointer hover:underline"
                          onClick={() => t.property_id && openPropertyModal(t.property_id)}
                          data-testid={`link-transition-${t.id}`}
                        >
                          {t.properties?.name}
                        </p>
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
                <Link
                  href="/master-list?stageChangeLast30=true"
                  className="block text-xs text-primary hover:underline text-right mt-1 pt-1 border-t border-border/40"
                >
                  View All Transitions →
                </Link>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Activity className="w-8 h-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No transitions in this period</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quality Leaderboard + Scheduled This Week */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-card-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-primary" /> Quality Leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {(() => {
              if (!recentInspections || recentInspections.length < 3) {
                return (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <ClipboardCheck className="w-8 h-8 text-muted-foreground/40 mb-2" />
                    <p className="text-sm text-muted-foreground">No inspections logged yet</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">Log at least 3 inspections to see your top and bottom performing properties ranked by score.</p>
                    <Button size="sm" variant="outline" className="mt-2 text-xs" onClick={() => navigate('/inspections')}>
                      Log First Inspection
                    </Button>
                  </div>
                )
              }
              // Compute averages per property
              const avgByProp: Record<string, { name: string; sum: number; count: number; propId: string }> = {}
              for (const i of recentInspections) {
                const pid = String(i.property_id)
                if (!avgByProp[pid]) avgByProp[pid] = { name: (i.properties as any)?.name || '—', sum: 0, count: 0, propId: pid }
                avgByProp[pid].sum += i.overall_score || 0
                avgByProp[pid].count++
              }
              const sorted = Object.values(avgByProp).map(p => ({ ...p, avg: p.sum / p.count })).sort((a, b) => b.avg - a.avg)
              const top = sorted.slice(0, 3)
              const bottom = sorted.slice(-3).reverse()

              function ScorePill({ avg }: { avg: number }) {
                const cls = avg >= 8 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                            avg >= 6 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                            'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                return <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${cls}`}>{avg.toFixed(1)}</span>
              }

              return (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Top Performers</p>
                    {top.map(p => (
                      <div key={p.propId} className="flex items-center justify-between text-xs py-1">
                        <span className="truncate mr-2 cursor-pointer hover:underline" onClick={() => openPropertyModal(p.propId)}>{p.name}</span>
                        <div className="flex items-center gap-1">
                          <ScorePill avg={p.avg} />
                          <span className="text-muted-foreground text-xs">({p.count})</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Needs Attention</p>
                    {bottom.map(p => (
                      <div key={p.propId} className="flex items-center justify-between text-xs py-1">
                        <span className="truncate mr-2 cursor-pointer hover:underline" onClick={() => openPropertyModal(p.propId)}>{p.name}</span>
                        <div className="flex items-center gap-1">
                          <ScorePill avg={p.avg} />
                          <span className="text-muted-foreground text-xs">({p.count})</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </CardContent>
        </Card>

        <Card className="border-card-border">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Scheduled This Week</p>
                <p className="text-xl font-semibold mt-1">{scheduledThisWeek?.length ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">cleaning assignments</p>
                {(scheduledThisWeek?.length ?? 0) === 0 && active > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <button onClick={() => navigate('/cleaners')} className="hover:underline">Set up assignments →</button>
                  </p>
                )}
              </div>
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                <CalendarDays className="w-4 h-4 text-primary" />
              </div>
            </div>
            {/* Quality Alerts - properties with recent low scores */}
            {recentInspections && recentInspections.filter((i: any) => (i.overall_score || 10) < 7).length > 0 && (
              <div className="mt-4 pt-3 border-t border-border/40">
                <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-red-500" /> Quality Alerts
                </p>
                {recentInspections.filter((i: any) => (i.overall_score || 10) < 7).slice(0, 3).map((i: any) => (
                  <div key={i.property_id + i.inspected_at} className="flex items-center justify-between text-xs py-0.5">
                    <span className="truncate mr-2 cursor-pointer hover:underline" onClick={() => openPropertyModal(i.property_id)}>
                      {(i.properties as any)?.name}
                    </span>
                    <span className="text-red-600 font-medium">{i.overall_score}/10</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* CRM Overview */}
      <Card className="border-card-border">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> CRM Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <p className="text-xs text-muted-foreground">Total Contacts</p>
              <p className="text-lg font-semibold tabular-nums">{crmStats.total}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">New (30 days)</p>
              <p className="text-lg font-semibold tabular-nums">
                {crmStats.new30}
                {crmStats.new30 > 0 && <span className="text-xs font-normal text-green-600 ml-1">+{crmStats.new30}</span>}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Unassigned Properties</p>
              <p
                className="text-lg font-semibold tabular-nums cursor-pointer hover:text-primary transition-colors"
                onClick={() => navigate('/property-list')}
              >
                {unassignedCount ?? 0}
              </p>
            </div>
          </div>
          {crmStats.total === 0 && (
            <p className="text-xs text-muted-foreground">
              No contacts yet.{' '}
              <button onClick={() => navigate('/contacts')} className="text-primary hover:underline">Import from Properties →</button>
            </p>
          )}
          {crmStats.paymentBreakdown.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Payment Methods</p>
              <div className="space-y-1.5">
                {crmStats.paymentBreakdown.map((pm, i) => {
                  const pct = crmStats.total > 0 ? (pm.count / crmStats.total * 100) : 0
                  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6b7280']
                  return (
                    <div key={pm.method}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground">{pm.method}</span>
                        <span className="font-medium tabular-nums">{pm.count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: colors[i % colors.length] }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
