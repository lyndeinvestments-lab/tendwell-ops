import { format } from 'date-fns'
import { es as dateFnsEs } from 'date-fns/locale'
import { ExternalLink, UserCheck } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { ISSUE_STATUS_TONES, STATUSES, categoryLabel, statusLabel, type Issue } from '@/lib/issues'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { IssueBadges } from './IssueBadges'

/**
 * Mobile card for the issues list. Visual language mirrors
 * `MyInspectionsTab`'s queue cards (rounded-2xl, shadow-sm, tap-to-open).
 */
export function IssueCard({
  issue,
  canEdit,
  onOpen,
  onStatusChange,
  onAcknowledge,
  translate,
}: {
  issue: Issue
  canEdit: boolean
  onOpen: (issue: Issue) => void
  onStatusChange: (args: { id: string; status: string }) => void
  /** Lifted from the page — same acknowledge mutation the detail sheet uses. */
  onAcknowledge: (id: string) => void
  /** ES overlay lookup from `useIssueTranslations`, lifted from the page — a no-op passthrough when the UI isn't in Spanish. */
  translate: (sourceId: string, field: string, original: string | null | undefined) => string | null | undefined
}) {
  const { t, locale } = useLocale()
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(issue)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(issue) } }}
      className={`w-full text-left rounded-2xl border shadow-sm p-4 cursor-pointer transition-colors hover:bg-muted/20 ${
        issue.status === 'In Progress' ? 'border-warning/30 bg-warning/5' : 'border-card-border bg-card'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-semibold text-sm truncate">{issue.property_name || t('common.noProperty')}</div>
          <IssueBadges issue={issue} variant="compact" />
        </div>
        {issue.slack_link && (
          <a
            href={issue.slack_link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-primary flex-shrink-0 mt-0.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      <div className="mt-1.5 text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
        <span>{categoryLabel(issue.category, t)}</span>
        <span>·</span>
        <span>{format(new Date(issue.report_date), 'MMM d, yyyy', { locale: locale === 'es' ? dateFnsEs : undefined })}</span>
        {issue.last_touch && (
          <>
            <span>·</span>
            <span>{issue.last_touch}</span>
          </>
        )}
      </div>

      {issue.details && <p className="mt-2 text-sm text-foreground/90 line-clamp-2">{translate(issue.id, 'details', issue.details)}</p>}

      {canEdit && issue.issue_type === 'guest_feedback' && !issue.acknowledged_at && (
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={e => { e.stopPropagation(); onAcknowledge(issue.id) }}
          >
            <UserCheck className="w-3.5 h-3.5" /> {t('common.acknowledge')}
          </Button>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between gap-2">
        <StatusBadge status={issue.status} tone={ISSUE_STATUS_TONES[issue.status] ?? 'neutral'}>{statusLabel(issue.status, t)}</StatusBadge>
        {canEdit && (
          <select
            value={issue.status}
            onChange={e => onStatusChange({ id: issue.id, status: e.target.value })}
            onClick={e => e.stopPropagation()}
            className="h-7 text-xs border border-input rounded px-1.5 bg-background"
          >
            {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s, t)}</option>)}
          </select>
        )}
      </div>
    </div>
  )
}
