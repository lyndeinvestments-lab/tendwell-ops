import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePageTitle } from '@/hooks/use-page-title'
import { useCleaners, useCleanerPayRates } from '@/hooks/use-cleaners'
import {
  useAttributedReviews, useCleanerTasks, useMetricIssues, useRatedInspections,
} from '@/hooks/use-cleaner-metrics'
import { useAuth, canEditView, canAccessView } from '@/lib/auth'
import { useCanViewFinancials } from '@/lib/financial-access'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { CleanerCleansSheet } from '@/components/cleaners/CleanerCleansSheet'
import { Users, AlertTriangle, CheckSquare, Flag, CalendarClock, ClipboardCheck, Star, Info } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import type { TFunc } from '@/lib/i18n/t'
import {
  aggregateCleanerMetrics, metricsRange, RANGE_PRESETS, CREW_ROW_ID,
  type CleanerMetricRow, type RangePreset,
} from '@/lib/cleaner-metrics'

// Cleaner Metrics on Trellis (WS3, 2026-10-14). Cleans are Tendwell's Trellis
// clean tasks (trellis_cleaner_tasks), not inspections. Inspection scores come
// from inspections linked to the clean they rated; guest-review cleanliness
// from review_clean_attribution (Reviews grant only). Pay figures render only
// for finance staff (can_view_financials); crews never fetch pay rates.

// Display-only lookup for `cleaning_issues.category` (free-text column) —
// falls back to the raw stored value. Mirrors the slugify pattern in
// client/src/lib/issues.ts, kept local to this page.
function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
function categoryLabel(category: string, t: TFunc): string {
  return t(`metrics.category.${slugify(category)}`, undefined, category)
}

// Advisory pay / coaching recommendation derived from issue-rate thresholds.
// Display only — this never changes cleaner pay. Thresholds now divide by
// completed Trellis cleans in the selected range (see perf.issueRateNote).
function payRecommendation(m: { completedCleans: number; issueRate: number; resolutionRate: number }, t: TFunc):
  { label: string; tone: 'good' | 'bad'; title: string } | null {
  if (m.completedCleans >= 5 && m.issueRate >= 20) {
    return {
      label: t('metrics.recommendation.reviewPayCoach'),
      tone: 'bad',
      title: t('metrics.recommendation.reviewPayCoachTitle', { rate: m.issueRate.toFixed(1), cleans: m.completedCleans }),
    }
  }
  if (m.completedCleans >= 10 && m.issueRate <= 3 && m.resolutionRate >= 90) {
    return {
      label: t('metrics.recommendation.raiseCandidate'),
      tone: 'good',
      title: t('metrics.recommendation.raiseCandidateTitle', { rate: m.issueRate.toFixed(1), cleans: m.completedCleans }),
    }
  }
  return null
}

const fmtScore = (v: number | null) => (v == null ? '-' : v.toFixed(2))
const fmtMoney = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const TH = 'text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3'

export default function CleanerMetricsPage() {
  usePageTitle('Cleaner Metrics')
  const { t } = useLocale('cleaners')
  const { effectiveUser, isEmulating } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canEdit = !isEmulating && canEditView('cleaner-metrics', effectiveUser)
  const canViewFinancials = useCanViewFinancials()
  const canSeeReviews = canAccessView('reviews', effectiveUser)

  const [preset, setPreset] = useState<RangePreset>('30')
  const [includeOffboarded, setIncludeOffboarded] = useState(false)
  const [drill, setDrill] = useState<{ id: string; name: string } | null>(null)
  const range = useMemo(() => metricsRange(preset), [preset])

  const cleanersQ = useCleaners()
  const tasksQ = useCleanerTasks(range.from, range.upcomingTo)
  const inspectionsQ = useRatedInspections(range.from)
  const reviewsQ = useAttributedReviews(range.from, canSeeReviews)
  const issuesQ = useMetricIssues(range.from)
  const { data: payRates } = useCleanerPayRates()

  const { data: coachingFlags } = useQuery({
    queryKey: ['/supabase/cleaner-coaching-flags'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cleaner_coaching_flags')
        .select('id, cleaner_id, status')
        .eq('status', 'open')
      if (error) throw error
      return data || []
    },
  })

  const openFlagByCleaner = useMemo(() => {
    const map = new Map<string, string>()
    for (const f of (coachingFlags || [])) map.set(String(f.cleaner_id), f.id)
    return map
  }, [coachingFlags])

  const flagMut = useMutation({
    mutationFn: async (m: CleanerMetricRow) => {
      const { error } = await supabase.from('cleaner_coaching_flags').insert({
        cleaner_id: m.id,
        reason: `Issue rate ${m.issueRate.toFixed(1)}% (${m.issueCount}/${m.completedCleans} Trellis cleans, last ${preset} days)`,
        issue_rate: Number(m.issueRate.toFixed(2)),
        total_cleans: m.completedCleans,
        issue_count: m.issueCount,
        flagged_by: effectiveUser?.label ?? null,
      } as any)
      if (error) throw error
    },
    onSuccess: () => { toast({ title: t('toasts.flaggedForCoaching') }); qc.invalidateQueries({ queryKey: ['/supabase/cleaner-coaching-flags'] }) },
    onError: (e: any) => toast({ title: t('toasts.flagFailed'), description: e?.message, variant: 'destructive' }),
  })

  const resolveMut = useMutation({
    mutationFn: async (flagId: string) => {
      const { error } = await supabase.from('cleaner_coaching_flags')
        .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: effectiveUser?.label ?? null })
        .eq('id', flagId)
      if (error) throw error
    },
    onSuccess: () => { toast({ title: t('toasts.coachingFlagResolved') }); qc.invalidateQueries({ queryKey: ['/supabase/cleaner-coaching-flags'] }) },
    onError: (e: any) => toast({ title: t('toasts.resolveFailed'), description: e?.message, variant: 'destructive' }),
  })

  // Reviews are optional: a missing grant or a failed read just hides them.
  const reviews = canSeeReviews && !reviewsQ.isError ? (reviewsQ.data ?? []) : []
  const showReviews = canSeeReviews && !reviewsQ.isError

  const result = useMemo(() => aggregateCleanerMetrics({
    cleaners: cleanersQ.data ?? [],
    tasks: tasksQ.data ?? [],
    inspections: inspectionsQ.data ?? [],
    reviews,
    issues: issuesQ.data ?? [],
    ...range,
  }), [cleanersQ.data, tasksQ.data, inspectionsQ.data, reviews, issuesQ.data, range])

  const rows = includeOffboarded ? result.rows : result.rows.filter(r => r.status === 'active')
  const anyLoading = cleanersQ.isLoading || tasksQ.isLoading || inspectionsQ.isLoading || issuesQ.isLoading
  const loadError = tasksQ.isError || cleanersQ.isError

  const { totals } = result
  const identifiedPct = totals.completedCleans > 0 ? Math.round((totals.identifiedCleans / totals.completedCleans) * 100) : 0
  const cleanerWithMostIssues = [...rows].sort((a, b) => b.issueRate - a.issueRate).find(m => m.completedCleans >= 5)
  const colCount = 10 + (showReviews ? 1 : 0) + (canViewFinancials ? 2 : 0)

  const renderInspections = (m: CleanerMetricRow) => (
    m.inspectionCount === 0 ? <span className="text-muted-foreground">-</span> : (
      <span className="tabular-nums">
        {m.inspectionCount}
        <span className="block text-2xs text-muted-foreground">{fmtScore(m.avgInspectionOverall)} · {fmtScore(m.avgInspectionCleanliness)}</span>
      </span>
    )
  )
  const renderReviews = (m: CleanerMetricRow) => (
    m.reviewCount === 0 ? <span className="text-muted-foreground">-</span> : (
      <span className="tabular-nums">
        {m.reviewCount}
        <span className="block text-2xs text-muted-foreground">
          {fmtScore(m.avgReviewCleanliness)}
          {m.lowReviewCount > 0 && <span className="text-destructive"> · {t('perf.lowReviews', { count: m.lowReviewCount })}</span>}
        </span>
      </span>
    )
  )

  return (
    <PageContainer width="full" className="h-full overflow-auto">
      <PageHeader
        title={t('metrics.pageTitle')}
        subtitle={t('perf.pageSubtitle')}
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center border rounded-md overflow-hidden" role="group" aria-label={t('perf.rangeAriaLabel')}>
              {RANGE_PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  aria-pressed={preset === p}
                  className={`px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${preset === p ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
                  data-testid={`range-${p}`}
                >
                  {t(`perf.range${p}`)}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={includeOffboarded} onCheckedChange={setIncludeOffboarded} data-testid="switch-include-offboarded" />
              {t('perf.includeOffboarded')}
            </label>
          </div>
        }
      />

      <div className={`grid grid-cols-2 gap-3 ${showReviews ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
        <StatCard
          title={t('perf.statCompletedCleans')}
          value={totals.completedCleans}
          subtitle={t('perf.statIdentified', { pct: identifiedPct })}
          icon={CheckSquare}
          tone="info"
          loading={anyLoading}
        />
        <StatCard title={t('perf.statUpcoming')} value={totals.upcomingCleans} icon={CalendarClock} tone="neutral" loading={anyLoading} />
        <StatCard
          title={t('perf.statAvgInspection')}
          value={totals.avgInspectionOverall == null ? '-' : `${totals.avgInspectionOverall.toFixed(2)} / 5`}
          subtitle={t('perf.statInspectionCount', { count: totals.inspectionCount })}
          icon={ClipboardCheck}
          tone="neutral"
          loading={anyLoading}
        />
        {showReviews && (
          <StatCard
            title={t('perf.statAvgReview')}
            value={totals.avgReviewCleanliness == null ? '-' : `${totals.avgReviewCleanliness.toFixed(2)} / 5`}
            subtitle={t('perf.statReviewCount', { count: totals.reviewCount })}
            icon={Star}
            tone="neutral"
            loading={anyLoading || reviewsQ.isLoading}
          />
        )}
        <StatCard
          title={t('metrics.statTotalIssues')}
          value={rows.reduce((s, m) => s + m.issueCount, 0)}
          icon={AlertTriangle}
          tone={rows.some(m => m.issueCount > 0) ? 'warning' : 'neutral'}
          loading={anyLoading}
        />
      </div>

      <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>{t('perf.issueRateNote')}</span>
      </p>
      {canSeeReviews && reviewsQ.isError && (
        <p className="text-2xs text-warning">{t('perf.reviewsUnavailable')}</p>
      )}

      {cleanerWithMostIssues && cleanerWithMostIssues.issueRate > 5 && (
        <div className="rounded-md border border-warning/25 bg-warning/5 p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />
          <p className="text-xs text-warning">
            {(() => {
              const [before, after] = t('metrics.highestIssueRateWarning', {
                rate: cleanerWithMostIssues.issueRate.toFixed(1),
                issueCount: cleanerWithMostIssues.issueCount,
                totalCleans: cleanerWithMostIssues.completedCleans,
              }).split('{{name}}')
              return <>{before}<strong>{cleanerWithMostIssues.name}</strong>{after}</>
            })()}
            {cleanerWithMostIssues.topIssueCategory && (
              <span>{t('metrics.mostCommonSuffix', { category: categoryLabel(cleanerWithMostIssues.topIssueCategory, t) })}</span>
            )}
          </p>
        </div>
      )}

      {loadError ? (
        <ErrorState title={t('perf.loadFailed')} onRetry={() => { tasksQ.refetch(); cleanersQ.refetch() }} />
      ) : (
        <div className="overflow-auto rounded-2xl border border-border shadow-sm">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted border-b border-border z-20">
              <tr>
                <th className={`text-left ${TH}`}>{t('metrics.table.cleaner')}</th>
                <th className={`text-right ${TH}`}>{t('metrics.table.cleans')}</th>
                <th className={`text-right ${TH}`}>{t('perf.upcoming')}</th>
                <th className={`text-right ${TH}`} title={t('perf.inspectionsTooltip')}>{t('perf.inspections')}</th>
                {showReviews && <th className={`text-right ${TH}`} title={t('perf.reviewsTooltip')}>{t('perf.reviews')}</th>}
                <th className={`text-right ${TH}`}>{t('metrics.table.issues')}</th>
                <th className={`text-right ${TH}`}>{t('metrics.table.issueRate')}</th>
                <th className={`text-right ${TH}`}>{t('metrics.table.resolution')}</th>
                {canViewFinancials && <th className={`text-right ${TH}`}>{t('metrics.table.totalPay')}</th>}
                {canViewFinancials && <th className={`text-right ${TH}`}>{t('metrics.table.avgClean')}</th>}
                <th className={`text-left ${TH}`}>{t('metrics.table.topIssue')}</th>
                <th className={`text-left ${TH}`}>{t('metrics.table.recommendation')}</th>
                <th className={`text-right ${TH}`}>{t('metrics.table.coaching')}</th>
              </tr>
            </thead>
            <tbody>
              {anyLoading ? (
                [...Array(5)].map((_, i) => <tr key={i} className="border-b border-border/50">{[...Array(colCount)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}</tr>)
              ) : rows.length === 0 ? (
                <tr><td colSpan={colCount}><EmptyState icon={Users} title={t('page.emptyTitle')} description={t('perf.emptyDescription')} /></td></tr>
              ) : (
                <>
                  {rows.map(m => {
                    const payRate = canViewFinancials ? (payRates?.get(m.id) ?? null) : null
                    const rec = payRecommendation(m, t)
                    const flagId = openFlagByCleaner.get(String(m.id))
                    return (
                      <tr
                        key={m.id}
                        className={`border-b border-border/50 hover:bg-muted/20 cursor-pointer ${m.issueRate > 10 ? 'bg-warning/5' : ''}`}
                        onClick={() => setDrill({ id: m.id, name: m.name })}
                        data-testid={`row-cleaner-${m.id}`}
                      >
                        <td className="py-2 px-3 text-xs font-medium">
                          <span className="flex flex-wrap items-center gap-1">
                            {m.name}
                            {m.status === 'offboarded' && <StatusBadge tone="neutral">{t('perf.offboardedBadge')}</StatusBadge>}
                            {!m.linked && (
                              <span title={t('perf.notLinkedTooltip')}><StatusBadge tone="warning">{t('perf.notLinkedBadge')}</StatusBadge></span>
                            )}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-xs tabular-nums text-right">{m.completedCleans}</td>
                        <td className="py-2 px-3 text-xs tabular-nums text-right">{m.upcomingCleans || <span className="text-muted-foreground">-</span>}</td>
                        <td className="py-2 px-3 text-xs text-right">{renderInspections(m)}</td>
                        {showReviews && <td className="py-2 px-3 text-xs text-right">{renderReviews(m)}</td>}
                        <td className="py-2 px-3 text-xs tabular-nums text-right">{m.issueCount}</td>
                        <td className={`py-2 px-3 text-xs tabular-nums text-right font-medium ${m.issueRate > 10 ? 'text-destructive' : m.issueRate > 5 ? 'text-warning' : 'text-success'}`}>{m.issueRate.toFixed(1)}%</td>
                        <td className="py-2 px-3 text-xs tabular-nums text-right">{m.resolutionRate.toFixed(0)}%</td>
                        {canViewFinancials && <td className="py-2 px-3 text-xs tabular-nums text-right">{payRate ? fmtMoney(payRate * m.completedCleans) : '-'}</td>}
                        {canViewFinancials && <td className="py-2 px-3 text-xs tabular-nums text-right">{payRate ? fmtMoney(payRate) : '-'}</td>}
                        <td className="py-2 px-3 text-xs text-muted-foreground">{m.topIssueCategory ? categoryLabel(m.topIssueCategory, t) : '-'}</td>
                        <td className="py-2 px-3 text-xs">
                          {rec ? (
                            <span title={rec.title} className={`inline-block rounded px-1.5 py-0.5 text-2xs font-medium ${rec.tone === 'bad' ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'}`}>
                              {rec.label}
                            </span>
                          ) : <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="py-2 px-3 text-xs text-right" onClick={e => e.stopPropagation()}>
                          {flagId ? (
                            <span className="inline-flex items-center gap-1.5 justify-end">
                              <span className="inline-flex items-center gap-1 text-warning"><Flag className="w-3 h-3" /> {t('metrics.flagged')}</span>
                              {canEdit && (
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => resolveMut.mutate(flagId)} disabled={resolveMut.isPending} data-testid={`button-resolve-flag-${m.id}`}>
                                  {t('metrics.resolve')}
                                </Button>
                              )}
                            </span>
                          ) : canEdit ? (
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1 hover:text-warning" onClick={() => flagMut.mutate(m)} disabled={flagMut.isPending} data-testid={`button-flag-${m.id}`}>
                              <Flag className="w-3 h-3" /> {t('metrics.flag')}
                            </Button>
                          ) : <span className="text-muted-foreground">-</span>}
                        </td>
                      </tr>
                    )
                  })}
                  {(result.crew.completedCleans > 0 || result.crew.upcomingCleans > 0) && (
                    <tr
                      className="border-t-2 border-border bg-muted/30 hover:bg-muted/50 cursor-pointer"
                      onClick={() => setDrill({ id: CREW_ROW_ID, name: t('perf.crewRow') })}
                      data-testid="row-tendwell-crew"
                    >
                      <td className="py-2 px-3 text-xs font-medium italic" title={t('perf.crewRowHint')}>
                        <span className="inline-flex items-center gap-1">{t('perf.crewRow')} <Info className="w-3 h-3 text-muted-foreground" /></span>
                      </td>
                      <td className="py-2 px-3 text-xs tabular-nums text-right">{result.crew.completedCleans}</td>
                      <td className="py-2 px-3 text-xs tabular-nums text-right">{result.crew.upcomingCleans || <span className="text-muted-foreground">-</span>}</td>
                      <td className="py-2 px-3 text-xs text-right">{renderInspections(result.crew)}</td>
                      {showReviews && <td className="py-2 px-3 text-xs text-right">{renderReviews(result.crew)}</td>}
                      <td colSpan={3 + (canViewFinancials ? 2 : 0) + 3} className="py-2 px-3 text-2xs text-muted-foreground">{t('perf.crewRowHint')}</td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      <CleanerCleansSheet
        target={drill}
        tasks={tasksQ.data ?? []}
        inspections={inspectionsQ.data ?? []}
        reviews={reviews}
        range={range}
        showReviews={showReviews}
        onClose={() => setDrill(null)}
      />
    </PageContainer>
  )
}
