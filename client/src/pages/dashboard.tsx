import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, Link } from 'wouter'
import { usePageTitle } from '@/hooks/use-page-title'
import { supabase } from '@/lib/supabase'
import { useAuth, canAccessView } from '@/lib/auth'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { ErrorState } from '@/components/ErrorState'
import { TONE_SOFT } from '@/lib/status-colors'
import { Building2, TrendingUp, Activity, AlertTriangle, AlertCircle, UserCheck, UserMinus, Wrench, Users, ClipboardCheck, CalendarDays, ChevronDown, ChevronUp } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { profitTier, PROFIT_COLOR_HEX, PROFIT_TIER_LABELS } from '@/lib/profit-colors'
import { useTrellisTasksToday } from '@/hooks/use-trellis-tasks-today'
import { usePipelineStages } from '@/hooks/use-pipeline-stages'
import { useContacts } from '@/hooks/use-contacts'
import { useAlerts } from '@/pages/alerts'

/**
 * Thin adapter over the shared StatCard — preserves this page's
 * `data-testid="kpi-…"` contract on the value and the `hint` tooltip.
 */
function KpiCard({ title, value, subtitle, icon, loading, alert, onClick, hint }: {
  title: string; value: string | number; subtitle?: string
  icon: React.ComponentType<{ className?: string }>; loading: boolean; alert?: boolean
  onClick?: () => void; hint?: string
}) {
  return (
    <div title={hint} className="h-full">
      <StatCard
        title={title}
        value={
          <span
            data-testid={`kpi-${title.toLowerCase().replace(/\s+/g,'-')}`}
            className={alert ? 'text-destructive' : undefined}
          >
            {value}
          </span>
        }
        subtitle={subtitle}
        icon={icon}
        loading={loading}
        tone={alert ? 'destructive' : 'primary'}
        onClick={onClick}
        className="h-full"
      />
    </div>
  )
}

export default function DashboardPage() {
  const [, navigate] = useLocation()
  const { openPropertyModal } = usePropertyModal()
  usePageTitle('Dashboard')
  const { effectiveUser } = useAuth()
  const canViewFinancials = canAccessView('cost-tracking', effectiveUser) || canAccessView('financial-dashboard', effectiveUser)

  const { data: trellisTasks, isLoading: trellisLoading, error: trellisError } = useTrellisTasksToday()

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

  const { data: properties, isLoading, isError, refetch } = useQuery({
    queryKey: ['/supabase/dashboard-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, stage_id, ce_charged, cleaner_pay, monthly_revenue_estimate, monthly_profit_estimate, profit_percentage, estimated_profit, bedrooms, full_baths, square_footage, address, cleaning_frequency, exclude_from_financials')
      if (error) throw error
      return data || []
    },
  })

  const { data: stages } = usePipelineStages()
  const { activeAlerts } = useAlerts()

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
    // 500-row aggregate over a date range — used for period-level counts
    // and trends, not "what changed in the last minute". The 60s global
    // default forces a refetch on every back-to-dashboard navigation;
    // 5 min skips that without making the trend perceptibly stale.
    staleTime: 5 * 60 * 1000,
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
    // 90-day inspection feed consumed as an aggregate (avg score, count).
    // Inspections are logged a handful per day, so a 2 min window is
    // imperceptibly stale for the Quality widgets while skipping refetch
    // on rapid navigation. NOTE: today's Inspections page only invalidates
    // the `inspections-all` key, not this one — so the dashboard already
    // shows stale data after a new log until window-focus refetch fires;
    // bumping from 60s → 2 min extends that window. See PR for the
    // accompanying invalidation registration that closes the gap.
    staleTime: 2 * 60 * 1000,
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

  const { data: followUps } = useQuery({
    queryKey: ['/supabase/dashboard-followups'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, follow_up_date, pipeline_stages!properties_stage_id_fkey(name)')
        .not('pipeline_stages.name', 'in', '("Offboarded")')
        .lte('follow_up_date', today)
        .order('follow_up_date', { ascending: true })
      if (error) throw error
      return data || []
    },
  })

  const { data: onboardingVelocity } = useQuery({
    queryKey: ['/supabase/dashboard-velocity', sinceDate, untilDate],
    // Multi-query rollup over a date range (avg onboarding days, current
    // active count, conversion count). Pure aggregate — a 5 min cache
    // window is invisible at the user-facing precision (days→weeks) but
    // skips the most expensive query block on this page when navigating
    // back to the dashboard. The shared property-invalidation registry
    // already covers this key on any property mutation.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const activeStageId = stages?.find((s: any) => s.name === 'Active')?.id
      const onboardingStageId = stages?.find((s: any) => s.name === 'Onboarding')?.id

      // The `enabled: !!stages` gate doesn't tell TS that the Active/Onboarding
      // stages exist within the loaded list. Explicit early return both
      // satisfies the typed Supabase client and preserves today's behavior
      // (no metrics shown if a stage is missing).
      if (activeStageId == null || onboardingStageId == null) {
        return { avgDays: null, conversions: 0, currentAvgDays: null, currentCount: 0 }
      }

      // 1. Onboarding → Active conversions in the period
      const { data: toActive, error: e1 } = await supabase
        .from('stage_transitions')
        .select('property_id, created_at')
        .eq('to_stage_id', activeStageId)
        .gte('created_at', sinceDate)
        .lte('created_at', untilDate)
      if (e1) throw e1

      let conversionAvg: number | null = null
      const conversionCount = (toActive || []).length
      const convertedPropIds = (toActive || [])
        .map(t => t.property_id)
        .filter((id): id is number => id != null)
      if (convertedPropIds.length > 0) {
        const { data: toOnboardingForConverted, error: e2 } = await supabase
          .from('stage_transitions')
          .select('property_id, created_at')
          .in('property_id', convertedPropIds)
          .eq('to_stage_id', onboardingStageId)
        if (e2) throw e2
        const onboardMap: Record<string, string> = {}
        for (const t of (toOnboardingForConverted || [])) {
          if (t.property_id == null || t.created_at == null) continue
          const key = String(t.property_id)
          if (!onboardMap[key] || t.created_at > onboardMap[key]) {
            onboardMap[key] = t.created_at
          }
        }
        let totalDays = 0, count = 0
        for (const t of (toActive || [])) {
          if (t.property_id == null || t.created_at == null) continue
          const start = onboardMap[String(t.property_id)]
          if (start) {
            const days = (new Date(t.created_at).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)
            if (days >= 0) { totalDays += days; count++ }
          }
        }
        if (count > 0) conversionAvg = Math.round(totalDays / count)
      }

      // 2. Fallback: average time properties CURRENTLY in Onboarding have been there.
      // Answers "how long is onboarding taking right now?" when no conversions
      // happened in the selected period — otherwise the tile just says "No data".
      let currentAvg: number | null = null
      let currentCount = 0
      // Anchor on stage_transitions when available, fall back to
      // properties.created_at. Production has 35 Onboarding properties with
      // 0 matching transition rows, so without this fallback the metric
      // always returns null (April 2026 audit P0 finding).
      const { data: currentOnboarding } = await supabase
        .from('properties')
        .select('id, created_at')
        .eq('stage_id', onboardingStageId)
      const current = currentOnboarding || []
      if (current.length > 0) {
        const ids = current.map(p => p.id).filter((id): id is number => id != null)
        const { data: lastTransitions } = await supabase
          .from('stage_transitions')
          .select('property_id, created_at')
          .in('property_id', ids)
          .eq('to_stage_id', onboardingStageId)
        const latestByProp: Record<string, string> = {}
        for (const t of (lastTransitions || [])) {
          if (t.property_id == null || t.created_at == null) continue
          const key = String(t.property_id)
          if (!latestByProp[key] || t.created_at > latestByProp[key]) {
            latestByProp[key] = t.created_at
          }
        }
        const now = Date.now()
        let total = 0, n = 0
        for (const p of current) {
          if (p.id == null) continue
          const start = latestByProp[String(p.id)] ?? p.created_at
          if (!start) continue
          const days = (now - new Date(start).getTime()) / (1000 * 60 * 60 * 24)
          if (days >= 0) { total += days; n++ }
        }
        if (n > 0) { currentAvg = Math.round(total / n); currentCount = n }
      }

      return {
        avgDays: conversionAvg,
        conversions: conversionCount,
        currentAvgDays: currentAvg,
        currentCount,
      }
    },
    enabled: !!stages,
  })

  // CRM data — shared via useContacts (single cache across the app)
  const { data: crmContacts } = useContacts()

  const { data: unassignedCount } = useQuery({
    queryKey: ['/supabase/dashboard-unassigned'],
    // Single COUNT(*) — slow-moving operational figure. 5 min staleness
    // is invisible at the displayed precision. Already in the property
    // invalidation registry, so any property mutation refreshes it.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { count, error } = await supabase.from('properties').select('*', { count: 'exact', head: true }).is('contact_id', null)
      if (error) return 0
      return count ?? 0
    },
  })

  const crmStats = useMemo(() => {
    if (!crmContacts) return { total: 0, new30: 0, paymentBreakdown: [] as { method: string; count: number }[] }
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const new30 = crmContacts.filter(c => c.created_at != null && c.created_at >= thirtyDaysAgo).length
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

  // Today's Actions — one prioritized panel combining past-due follow-ups and
  // stalled onboardings. Stalled onboardings reuse the shared useAlerts() logic
  // so this panel, the Alerts page, and the bell never diverge.
  const todayStr = new Date().toISOString().split('T')[0]
  const stalledOnboardings = activeAlerts.filter((a: any) => a.category === 'Onboarding')
  const actionItems = [
    ...((followUps as any[]) || []).map((p: any) => {
      const overdue = p.follow_up_date < todayStr
      return {
        key: `fu_${p.id}`, kind: 'follow-up' as const, name: p.name,
        detail: overdue ? 'Follow-up overdue' : 'Follow-up due today',
        overdue, propertyId: String(p.id),
      }
    }),
    ...stalledOnboardings.map((a: any) => ({
      key: a.id, kind: 'onboarding' as const,
      name: (a.title || '').replace(/^Onboarding Stalled:\s*/, ''),
      detail: a.description, overdue: false, propertyId: a.propertyId,
    })),
  ].sort((x, y) => {
    const rank = (it: any) => (it.kind === 'follow-up' ? (it.overdue ? 0 : 1) : 2)
    return rank(x) - rank(y)
  })

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
  const profitBuckets = { high: 0, mid: 0, low: 0 }
  financialProps.forEach((p: any) => {
    const t = profitTier(p.profit_percentage ?? 0)
    if (t) profitBuckets[t]++
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
    <PageContainer className="space-y-5">
      <PageHeader title="Dashboard" subtitle="Operations overview" />

      {isError && (
        <ErrorState
          title="Failed to load dashboard data"
          onRetry={() => refetch()}
        />
      )}

      {/* Redesign: hero band — headline financial glance + active profit mix */}
      <Card className="relative overflow-hidden rounded-2xl border-primary/20 shadow-md bg-gradient-to-br from-primary/10 via-card to-card">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col lg:flex-row lg:items-end gap-6">
            {canViewFinancials ? (
              <div className="min-w-0">
                <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Monthly Revenue (active)</p>
                <div className="mt-1.5 flex items-baseline gap-3 flex-wrap">
                  <button
                    onClick={() => navigate('/revenue-report')}
                    className="text-4xl sm:text-5xl font-bold tabular-nums leading-none bg-gradient-to-r from-primary to-info bg-clip-text text-transparent hover:opacity-80 transition-opacity"
                  >
                    ${totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </button>
                  <span className="text-sm font-medium text-muted-foreground">
                    ${totalProfit.toLocaleString('en-US', { maximumFractionDigits: 0 })} profit
                    <span className="mx-1.5 text-border">•</span>
                    <span className={avgProfit < 15 ? 'text-destructive font-semibold' : 'text-success font-semibold'}>{avgProfit.toFixed(1)}% margin</span>
                  </span>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Portfolio</p>
                <div className="mt-1.5 flex items-baseline gap-3">
                  <span className="text-4xl sm:text-5xl font-bold tabular-nums leading-none bg-gradient-to-r from-primary to-info bg-clip-text text-transparent">{active}</span>
                  <span className="text-sm font-medium text-muted-foreground">active of {total} properties</span>
                </div>
              </div>
            )}

            {/* Active profit mix — mini stacked bar from real distribution data */}
            {canViewFinancials && financialProps.length > 0 && (
              <div className="flex-1 min-w-[200px] lg:max-w-md">
                <div className="flex items-center justify-between text-2xs text-muted-foreground mb-1.5">
                  <span className="uppercase tracking-wider font-semibold">Active profit mix</span>
                  <span className="tabular-nums">{financialProps.length} props</span>
                </div>
                <div className="flex h-2.5 rounded-full overflow-hidden bg-muted ring-1 ring-border/50">
                  {[
                    { k: 'high', count: profitBuckets.high, color: PROFIT_COLOR_HEX.high },
                    { k: 'mid', count: profitBuckets.mid, color: PROFIT_COLOR_HEX.mid },
                    { k: 'low', count: profitBuckets.low, color: PROFIT_COLOR_HEX.low },
                  ].filter(b => b.count > 0).map(b => (
                    <div key={b.k} style={{ width: `${b.count / financialProps.length * 100}%`, backgroundColor: b.color }} />
                  ))}
                </div>
                <div className="flex gap-3 mt-2 flex-wrap">
                  {[
                    { label: PROFIT_TIER_LABELS.high, count: profitBuckets.high, color: PROFIT_COLOR_HEX.high },
                    { label: PROFIT_TIER_LABELS.mid, count: profitBuckets.mid, color: PROFIT_COLOR_HEX.mid },
                    { label: PROFIT_TIER_LABELS.low, count: profitBuckets.low, color: PROFIT_COLOR_HEX.low },
                  ].map(b => (
                    <span key={b.label} className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
                      {b.label} <span className="tabular-nums font-semibold text-foreground">{b.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Portfolio chips */}
            <div className="flex gap-2 flex-wrap lg:ml-auto">
              {[
                { label: 'Active', value: active, to: '/master-list?stage=Active' },
                { label: 'Onboarding', value: onboarding, to: '/master-list?stage=Onboarding' },
                { label: 'Total', value: total, to: '/master-list' },
              ].map(s => (
                <button
                  key={s.label}
                  onClick={() => navigate(s.to)}
                  className="rounded-xl bg-background/70 ring-1 ring-border px-3.5 py-2 text-center hover:ring-primary/40 hover:bg-background transition-all"
                >
                  <p className="text-xl font-bold tabular-nums leading-none">{s.value}</p>
                  <p className="text-2xs text-muted-foreground mt-1">{s.label}</p>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

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

      {/* Redesign: priority row — Today's Actions + merged Needs Attention */}
      {!isLoading && (
        <div className={`grid gap-4 ${canViewFinancials ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
          {/* Today's Actions */}
          <Card className="rounded-2xl border-primary/30 bg-primary/5 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <ClipboardCheck className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Today's Actions</span>
                {actionItems.length > 0 && (
                  <span className="ml-1 text-xs font-medium text-primary bg-primary/10 rounded-full px-2 py-0.5 tabular-nums">{actionItems.length}</span>
                )}
              </div>
              {actionItems.length === 0 ? (
                <p className="text-xs text-muted-foreground">All caught up — nothing needs action today.</p>
              ) : (
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {actionItems.map((it) => (
                    <div key={it.key} className="flex items-center justify-between text-xs gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {it.kind === 'follow-up'
                          ? <CalendarDays className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                          : <TrendingUp className="w-3.5 h-3.5 text-info flex-shrink-0" />}
                        <span className="truncate cursor-pointer hover:underline" onClick={() => it.propertyId && openPropertyModal(it.propertyId)}>{it.name}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-muted-foreground hidden sm:inline">{it.detail}</span>
                        <span className={it.overdue ? 'text-destructive font-medium' : it.kind === 'onboarding' ? 'text-info' : 'text-primary'}>
                          {it.kind === 'follow-up' ? (it.overdue ? 'Overdue' : 'Today') : 'Stalled'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => navigate('/alerts')} className="text-xs text-primary hover:underline mt-2 block">
                View all alerts →
              </button>
            </CardContent>
          </Card>

          {/* Needs Attention — merged negative-profit + missing-data with severity chips */}
          {canViewFinancials && (
            <Card className="rounded-2xl border-card-border shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                  <span className="text-sm font-semibold">Needs Attention</span>
                  {(negativeProfit.length + missingData.length) > 0 && (
                    <span className="ml-1 text-xs font-medium text-warning bg-warning/10 rounded-full px-2 py-0.5 tabular-nums">{negativeProfit.length + missingData.length}</span>
                  )}
                </div>
                {negativeProfit.length === 0 && missingData.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No data issues — all active properties look healthy.</p>
                ) : (
                  <div className="space-y-3 max-h-72 overflow-y-auto">
                    {negativeProfit.length > 0 && (
                      <div>
                        <span className="inline-flex items-center gap-1 text-2xs font-semibold text-destructive bg-destructive/10 rounded-full px-2 py-0.5 mb-1.5">
                          <AlertTriangle className="w-3 h-3" /> {negativeProfit.length} negative profit
                        </span>
                        <div className="space-y-1 mt-1.5">
                          {negativeProfit.slice(0, 5).map((p: any) => (
                            <div key={p.id} className="flex justify-between text-xs">
                              <span className="truncate mr-2 cursor-pointer hover:underline" onClick={() => navigate('/cost-tracking')}>{p.name}</span>
                              <span className="text-destructive font-medium tabular-nums whitespace-nowrap">${(p.estimated_profit || 0).toFixed(2)}</span>
                            </div>
                          ))}
                          {negativeProfit.length > 5 && (
                            <button onClick={() => navigate('/cost-tracking')} className="text-xs text-primary hover:underline">View all {negativeProfit.length} →</button>
                          )}
                        </div>
                      </div>
                    )}
                    {missingData.length > 0 && (
                      <div>
                        <button className="flex items-center gap-1.5 w-full text-left" onClick={() => setMissingCollapsed(v => !v)}>
                          <span className="inline-flex items-center gap-1 text-2xs font-semibold text-warning bg-warning/10 rounded-full px-2 py-0.5">
                            <AlertCircle className="w-3 h-3" /> {missingData.length} missing data
                          </span>
                          <span className="ml-auto text-muted-foreground">
                            {missingCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                          </span>
                        </button>
                        {!missingCollapsed && (
                          <div className="space-y-1 mt-1.5">
                            {missingData.slice(0, 5).map((p: any) => {
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
                                    <span className="text-warning">{missingLabels.join(', ')}</span>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-5 px-1.5 text-xs gap-1"
                                      onClick={() => openPropertyModal(p.id, 'dashboard-missing', missingFields)}
                                      data-testid={`button-fix-missing-${p.id}`}
                                    >
                                      <Wrench className="w-2.5 h-2.5" /> Fix
                                    </Button>
                                  </div>
                                </div>
                              )
                            })}
                            {missingData.length > 5 && (
                              <button onClick={() => navigate('/master-list')} className="text-xs text-primary hover:underline">View all {missingData.length} →</button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Redesign: compact KPI strip — Revenue & Avg Profit % now live in the hero */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiCard title="Total Properties" value={total} icon={Building2} loading={isLoading} onClick={() => navigate('/master-list')} />
        <KpiCard title="Active" value={active} icon={Activity} loading={isLoading} onClick={() => navigate('/master-list?stage=Active')} />
        <KpiCard title="Onboarding" value={onboarding} icon={TrendingUp} loading={isLoading} onClick={() => navigate('/master-list?stage=Onboarding')} />
        <KpiCard title="Offboarding" value={offboarding} icon={Activity} loading={isLoading} onClick={() => navigate('/master-list?stage=Offboarding')} />
        <KpiCard
          title="Conversions"
          value={onboardingVelocity?.conversions ?? 0}
          subtitle={`in ${periodLabel}`}
          icon={UserCheck}
          loading={isLoading || !onboardingVelocity}
          hint="Properties that moved to Active stage during this period"
          onClick={() => navigate('/pipeline')}
        />
        <KpiCard
          title="Avg Onboarding"
          value={
            onboardingVelocity?.avgDays != null ? `${onboardingVelocity.avgDays}d`
            : onboardingVelocity?.currentAvgDays != null ? `${onboardingVelocity.currentAvgDays}d`
            : 'No data'
          }
          subtitle={
            onboardingVelocity?.avgDays != null ? 'days to active (this period)'
            : onboardingVelocity?.currentAvgDays != null ? `days in progress (${onboardingVelocity.currentCount} open)`
            : 'no transitions yet'
          }
          icon={Activity}
          loading={isLoading || !onboardingVelocity}
          hint={
            onboardingVelocity?.avgDays != null
              ? "Average days from Onboarding to Active stage for conversions in the selected period."
              : onboardingVelocity?.currentAvgDays != null
                ? "No conversions in the selected period — showing how long properties currently in Onboarding have been there."
                : "No onboarding activity recorded. A property needs at least one stage_transitions row to appear here."
          }
        />
        <KpiCard
          title="Trellis Tasks Today"
          value={trellisError ? '—' : (trellisTasks?.count ?? 0)}
          subtitle={trellisError ? 'Not configured' : `due ${trellisTasks?.date ?? 'today'}`}
          icon={ClipboardCheck}
          loading={trellisLoading}
          hint={
            trellisError
              ? `Couldn't reach Trellis: ${trellisError instanceof Error ? trellisError.message : String(trellisError)}`
              : 'Open Trellis tasks with a due date of today (America/Chicago). Pulled live from api.trellistech.com via the server-side proxy.'
          }
        />
      </div>

      {/* 30-Day Activity Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="rounded-2xl border-card-border shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <UserCheck className="w-4 h-4 text-info" />
              <span className="text-sm font-medium">New Properties ({periodLabel})</span>
              {trans30Loading ? <Skeleton className="h-4 w-6" /> : (
                <span className="ml-auto text-sm font-semibold tabular-nums text-info">{newProps30Deduped.length}</span>
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

        <Card className="rounded-2xl border-card-border shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <UserMinus className="w-4 h-4 text-muted-foreground" />
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
                      <span className="truncate mr-2 cursor-pointer hover:underline" onClick={() => navigate('/master-list')}>{t.properties?.name}</span>
                      <span className="text-muted-foreground whitespace-nowrap">{format(new Date(t.created_at), 'MMM d')}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => navigate('/master-list')} className="text-xs text-primary hover:underline mt-2 block">
                  View All →
                </button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Insights row — Profit Distribution + Properties by Stage + Recent Transitions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Profit Distribution */}
        {canViewFinancials && (
        <Card className="rounded-2xl border-card-border shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Profit Distribution (Active)<span className="font-normal text-xs text-muted-foreground ml-1.5">(current)</span></CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoading || !stages ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
            ) : financialProps.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No active properties with financial data.</p>
            ) : (
              <div className="space-y-4">
                {[
                  { label: PROFIT_TIER_LABELS.high, count: profitBuckets.high, color: PROFIT_COLOR_HEX.high, pct: (profitBuckets.high / financialProps.length * 100) },
                  { label: PROFIT_TIER_LABELS.mid, count: profitBuckets.mid, color: PROFIT_COLOR_HEX.mid, pct: (profitBuckets.mid / financialProps.length * 100) },
                  { label: PROFIT_TIER_LABELS.low, count: profitBuckets.low, color: PROFIT_COLOR_HEX.low, pct: (profitBuckets.low / financialProps.length * 100) },
                ].map(b => (
                  <div key={b.label} className="cursor-pointer group" onClick={() => navigate('/cost-tracking')}>
                    <div className="flex justify-between items-baseline mb-1.5">
                      <span className="text-sm font-medium flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                        {b.label}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        <span className="text-sm font-bold text-foreground">{b.count}</span> · {b.pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-3 rounded-full bg-muted overflow-hidden ring-1 ring-border/50">
                      <div className="h-full rounded-full transition-all duration-500 group-hover:brightness-110" style={{ width: `${b.pct}%`, backgroundColor: b.color }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        )}

        {/* Properties by Stage */}
        <Card className="rounded-2xl border-card-border shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Properties by Stage<span className="font-normal text-xs text-muted-foreground ml-1.5">(current)</span></CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoading ? (
              <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
            ) : (
              <div className="space-y-2.5">
                {(() => {
                  const counts = stages?.map((stage: any) => ({ stage, count: properties?.filter((p: any) => p.stage_id === stage.id).length ?? 0 })) ?? []
                  const maxCount = Math.max(1, ...counts.map((c: any) => c.count))
                  return counts.map(({ stage, count }: any) => (
                    <div key={stage.id} className="cursor-pointer group" onClick={() => navigate(`/master-list?stage=${encodeURIComponent(stage.name)}`)}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
                          {stage.name}
                        </span>
                        <span data-testid={`stage-count-${stage.name}`} className="text-sm font-bold tabular-nums">{count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500 group-hover:brightness-110" style={{ width: `${count / maxCount * 100}%`, backgroundColor: stage.color }} />
                      </div>
                    </div>
                  ))
                })()}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Stage Transitions */}
        <Card className="rounded-2xl border-card-border shadow-sm hover:shadow-md transition-shadow">
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
        <Card className="rounded-2xl border-card-border shadow-sm hover:shadow-md transition-shadow">
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
                const tone = avg >= 8 ? 'success' : avg >= 6 ? 'warning' : 'destructive'
                return <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${TONE_SOFT[tone]}`}>{avg.toFixed(1)}</span>
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

        <Card className="rounded-2xl border-card-border shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Scheduled This Week</p>
                <p className="text-xl font-semibold mt-1">{scheduledThisWeek?.length ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">cleaning assignments</p>
                {(scheduledThisWeek?.length ?? 0) === 0 && active > 0 && (
                  <p className="text-xs text-warning mt-1 flex items-center gap-1">
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
                  <AlertTriangle className="w-3 h-3 text-destructive" /> Quality Alerts
                </p>
                {recentInspections.filter((i: any) => (i.overall_score || 10) < 7).slice(0, 3).map((i: any) => (
                  <div key={i.property_id + i.inspected_at} className="flex items-center justify-between text-xs py-0.5">
                    <span className="truncate mr-2 cursor-pointer hover:underline" onClick={() => openPropertyModal(i.property_id)}>
                      {(i.properties as any)?.name}
                    </span>
                    <span className="text-destructive font-medium">{i.overall_score}/10</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* CRM Overview */}
      <Card className="rounded-2xl border-card-border shadow-sm hover:shadow-md transition-shadow">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> CRM Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <p className="text-xs text-muted-foreground">Total Clients</p>
              <p className="text-lg font-semibold tabular-nums">{crmStats.total}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">New (30 days)</p>
              <p className="text-lg font-semibold tabular-nums">
                {crmStats.new30}
                {crmStats.new30 > 0 && <span className="text-xs font-normal text-success ml-1">+{crmStats.new30}</span>}
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
              No clients yet.{' '}
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
    </PageContainer>
  )
}
