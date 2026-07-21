import { format } from 'date-fns'
import { es as dateFnsEs } from 'date-fns/locale'
import { StatusBadge } from '@/components/StatusBadge'
import { TONE_SOFT, TONE_TEXT } from '@/lib/status-colors'
import { ISSUE_STATUS_TONES, dueLabel, isOverdue, overdueLabel, priorityTone, statusLabel, type Issue } from '@/lib/issues'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { cn } from '@/lib/utils'

type BadgeIssue = Pick<
  Issue,
  'status' | 'priority' | 'due_date' | 'is_unread' | 'issue_type' | 'acknowledged_at' | 'acknowledged_by'
>

/**
 * Shared badge cluster for issue rows/cards/detail — priority chip, overdue/due
 * text, unread dot, acknowledged line, and status badge. Always driven by the
 * TONE_* maps / StatusBadge (never hardcoded colors).
 *
 * - `compact` (table property cell, card header row): unread dot + priority
 *   chip + overdue/due text. No status badge — callers with a dedicated
 *   status column/row (the table's Status column, the card's status row)
 *   render that separately so it isn't duplicated.
 * - `full` (detail sheet): everything, including the status badge and the
 *   "✓ Acknowledged by …" line for guest feedback.
 */
export function IssueBadges({
  issue,
  variant = 'full',
  className,
}: {
  issue: BadgeIssue
  variant?: 'compact' | 'full'
  className?: string
}) {
  const { t, locale } = useLocale('issues')
  const showPriority = issue.priority === 'high' || issue.priority === 'urgent'
  const overdue = isOverdue(issue)
  const showDue = !!issue.due_date && issue.status !== 'Completed'
  const showAcknowledged = variant === 'full' && issue.issue_type === 'guest_feedback' && !!issue.acknowledged_at

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center gap-1.5 flex-wrap">
        {issue.is_unread && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" aria-label={t('badges.unread')} />}
        {showPriority && (
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap',
              TONE_SOFT[priorityTone(issue.priority)],
            )}
          >
            {issue.priority === 'urgent' ? t('badges.urgent') : t('badges.high')}
          </span>
        )}
        {variant === 'full' && (
          <StatusBadge status={issue.status} tone={ISSUE_STATUS_TONES[issue.status] ?? 'neutral'}>
            {statusLabel(issue.status, t)}
          </StatusBadge>
        )}
        {showDue && (
          <span className={cn('text-2xs font-medium whitespace-nowrap', overdue ? TONE_TEXT.destructive : TONE_TEXT.neutral)}>
            {overdue ? overdueLabel(issue.due_date!, t) : dueLabel(issue.due_date!, t, locale)}
          </span>
        )}
      </div>
      {showAcknowledged && (
        <p className={cn('text-xs', TONE_TEXT.neutral)}>
          {t('badges.acknowledgedBy', {
            name: issue.acknowledged_by || t('badges.someone'),
            time: format(new Date(issue.acknowledged_at!), 'MMM d, yyyy h:mm a', { locale: locale === 'es' ? dateFnsEs : undefined }),
          })}
        </p>
      )}
    </div>
  )
}
