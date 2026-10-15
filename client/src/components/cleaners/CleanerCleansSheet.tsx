import { useMemo } from 'react'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useReviewDetails, type ReviewDetail } from '@/hooks/use-cleaner-metrics'
import {
  cleanHistoryFor, parseLocalDay, snippet,
  type AttributedReviewRow, type CleanTaskRow, type RatedInspectionRow,
} from '@/lib/cleaner-metrics'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { StatusBadge } from '@/components/StatusBadge'
import type { StatusTone } from '@/lib/status-colors'
import { EmptyState } from '@/components/EmptyState'
import { CalendarDays, ClipboardCheck, Star } from 'lucide-react'

const STATUS_KEY: Record<string, { key: string; tone: StatusTone }> = {
  COMPLETED: { key: 'perf.statusCompleted', tone: 'success' },
  SCHEDULED: { key: 'perf.statusScheduled', tone: 'info' },
  IN_PROGRESS: { key: 'perf.statusInProgress', tone: 'warning' },
  OPEN: { key: 'perf.statusOpen', tone: 'neutral' },
  PAUSED: { key: 'perf.statusPaused', tone: 'neutral' },
}

function score(v: number | string | null | undefined): string | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(1) : null
}

/** Drill-down: one cleaner's (or the Tendwell crew row's) cleans in the
 *  selected window with the inspection that rated each one and the guest
 *  review of the stay it prepared. */
export function CleanerCleansSheet({
  target,
  tasks,
  inspections,
  reviews,
  range,
  showReviews,
  onClose,
}: {
  target: { id: string; name: string } | null
  tasks: CleanTaskRow[]
  inspections: RatedInspectionRow[]
  reviews: AttributedReviewRow[]
  range: { from: string; today: string; upcomingTo: string }
  showReviews: boolean
  onClose: () => void
}) {
  const { t } = useLocale('cleaners')
  const { format } = useDateFormat()
  const { openPropertyModal } = usePropertyModal()

  const history = useMemo(
    () => (target ? cleanHistoryFor(target.id, tasks, inspections, reviews, range) : []),
    [target, tasks, inspections, reviews, range],
  )
  const reviewedTaskIds = useMemo(
    () => history.filter(h => h.reviews.length > 0).map(h => h.task.trellis_task_id),
    [history],
  )
  const details = useReviewDetails(reviewedTaskIds, showReviews && !!target)
  const detailsByTask = useMemo(() => {
    const map = new Map<string, ReviewDetail[]>()
    for (const d of details.data ?? []) {
      if (!d.rated_clean_task_id) continue
      map.set(d.rated_clean_task_id, [...(map.get(d.rated_clean_task_id) ?? []), d])
    }
    return map
  }, [details.data])

  const completed = history.filter(h => !h.upcoming)
  const upcoming = history.filter(h => h.upcoming)

  const renderItem = (h: (typeof history)[number]) => {
    const tk = h.task
    const day = parseLocalDay(tk.scheduled_date)
    const st = STATUS_KEY[(tk.status ?? '').toUpperCase()]
    const insp = h.inspection
    const overall = score(insp?.overall_score)
    const cleanliness = score(insp?.cleanliness_score)
    const revs = detailsByTask.get(tk.trellis_task_id) ?? []
    return (
      <li key={tk.trellis_task_id} className="py-2.5 space-y-1" data-testid={`clean-${tk.trellis_task_id}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground tabular-nums">{day ? format(day, 'EEE MMM d, yyyy') : tk.scheduled_date}</div>
            {tk.property_id ? (
              <button
                type="button"
                className="text-sm font-medium hover:underline text-left truncate max-w-full"
                onClick={() => openPropertyModal(String(tk.property_id), 'cleaner-metrics')}
              >
                {tk.property_name || tk.trellis_property_name || t('perf.unknownProperty')}
              </button>
            ) : (
              <div className="text-sm font-medium truncate">{tk.trellis_property_name || t('perf.unknownProperty')}</div>
            )}
            {tk.title && <div className="text-2xs text-muted-foreground truncate">{tk.title}</div>}
          </div>
          <StatusBadge tone={st?.tone ?? 'neutral'}>{st ? t(st.key) : (tk.status ?? '')}</StatusBadge>
        </div>
        {!h.upcoming && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1">
              <ClipboardCheck className="w-3 h-3 text-muted-foreground" />
              {insp && overall
                ? <>{t('perf.inspectionScore', { overall })}{cleanliness && <span className="text-muted-foreground">, {t('perf.inspectionCleanliness', { score: cleanliness })}</span>}</>
                : <span className="text-muted-foreground">{t('perf.notInspected')}</span>}
            </span>
            {showReviews && (
              <span className="inline-flex items-center gap-1">
                <Star className="w-3 h-3 text-muted-foreground" />
                {h.reviews.length === 0
                  ? <span className="text-muted-foreground">{t('perf.noReview')}</span>
                  : h.reviews.map(r => {
                      const rating = r.normalized_rating != null ? (Number(r.normalized_rating) * 5).toFixed(1) : null
                      const c = score(r.cleanliness_5)
                      return (
                        <span key={r.trellis_review_id}>
                          {rating ? t('perf.reviewRating', { rating }) : '?'}
                          {c && <span className={Number(c) <= 3 ? 'text-destructive' : 'text-muted-foreground'}>, {t('perf.reviewCleanliness', { score: c })}</span>}
                        </span>
                      )
                    })}
              </span>
            )}
          </div>
        )}
        {showReviews && h.reviews.length > 0 && (
          details.isLoading
            ? <p className="text-2xs text-muted-foreground">{t('perf.loadingReviews')}</p>
            : revs.filter(r => r.content).map(r => (
                <blockquote key={r.trellis_review_id} className="border-l-2 border-border pl-2 text-xs text-muted-foreground italic">
                  {snippet(r.content, 220)}
                  {(r.reviewer_name || r.guest_name) && <span className="not-italic"> ({r.reviewer_name || r.guest_name})</span>}
                </blockquote>
              ))
        )}
      </li>
    )
  }

  return (
    <Sheet open={!!target} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('perf.drillTitle', { name: target?.name ?? '' })}</SheetTitle>
          <SheetDescription>{t('perf.drillSubtitle', { count: completed.length, upcoming: upcoming.length })}</SheetDescription>
        </SheetHeader>
        {history.length === 0 ? (
          <EmptyState icon={CalendarDays} title={t('perf.drillEmpty')} description="" />
        ) : (
          <div className="mt-4 space-y-4">
            {upcoming.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('perf.drillUpcoming')}</h3>
                <ul className="divide-y divide-border/60">{upcoming.map(renderItem)}</ul>
              </section>
            )}
            {completed.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('perf.drillCompleted')}</h3>
                <ul className="divide-y divide-border/60">{completed.map(renderItem)}</ul>
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
