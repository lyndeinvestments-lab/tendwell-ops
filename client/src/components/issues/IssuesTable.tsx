import { format } from 'date-fns'
import { es as dateFnsEs } from 'date-fns/locale'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/StatusBadge'
import { ISSUE_STATUS_TONES, STATUSES, categoryLabel, statusLabel, type Issue } from '@/lib/issues'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { IssueBadges } from './IssueBadges'

export type SortKey = 'report_date' | 'property_name' | 'category' | 'status'

const thCls = 'text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap'

/**
 * Desktop issues table — lifted near-verbatim from the original `issues.tsx`
 * (sticky first column, sort, urgent-floats-top sort handled by the caller).
 * The old inline "⚠ URGENT" prefix is replaced by the shared `IssueBadges`
 * cluster (compact variant) in the property cell; the Status column keeps
 * its own StatusBadge so it isn't duplicated.
 */
export function IssuesTable({
  issues,
  isLoading,
  canEdit,
  search,
  statusFilter,
  categoryFilter,
  sortKey,
  sortDir,
  onSort,
  onRowClick,
  onStatusChange,
  translate,
}: {
  issues: Issue[]
  isLoading: boolean
  canEdit: boolean
  search: string
  statusFilter: string
  categoryFilter: string
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
  onRowClick: (issue: Issue) => void
  onStatusChange: (args: { id: string; status: string }) => void
  /** ES overlay lookup from `useIssueTranslations`, lifted from the page — a no-op passthrough when the UI isn't in Spanish. */
  translate: (sourceId: string, field: string, original: string | null | undefined) => string | null | undefined
}) {
  const { t, locale } = useLocale()

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 inline ml-1 opacity-40" />
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3 inline ml-1" /> : <ArrowDown className="w-3 h-3 inline ml-1" />
  }

  return (
    <div className="overflow-auto flex-1 rounded-2xl border border-border shadow-sm">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
          <tr>
            <th className={`${thCls} sticky left-0 top-0 z-30 bg-muted`} onClick={() => onSort('property_name')}>{t('table.property')} <SortIcon col="property_name" /></th>
            <th className={thCls} onClick={() => onSort('report_date')}>{t('table.date')} <SortIcon col="report_date" /></th>
            <th className={thCls} onClick={() => onSort('category')}>{t('table.category')} <SortIcon col="category" /></th>
            <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">{t('table.lastTouch')}</th>
            <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap min-w-[250px]">{t('table.details')}</th>
            <th className={thCls} onClick={() => onSort('status')}>{t('table.status')} <SortIcon col="status" /></th>
            <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">{t('table.slack')}</th>
            {canEdit && <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">{t('table.action')}</th>}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            [...Array(8)].map((_, i) => <tr key={i} className="border-b border-border/50">{[...Array(canEdit ? 8 : 7)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}</tr>)
          ) : issues.length === 0 ? (
            <tr><td colSpan={canEdit ? 8 : 7}><EmptyState icon={AlertTriangle} title={t('page.emptyTitle')} description={search || statusFilter !== 'all' || categoryFilter !== 'all' ? t('page.emptyFiltered') : t('page.emptyDefault')} /></td></tr>
          ) : issues.map((issue) => (
            <tr
              key={issue.id}
              className={`border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer ${issue.status === 'In Progress' ? 'bg-warning/5' : ''}`}
              onClick={() => onRowClick(issue)}
            >
              <td className="py-2 px-3 font-medium text-xs sticky left-0 z-10 bg-background">
                <div className="flex items-center gap-1.5">
                  <IssueBadges issue={issue} variant="compact" />
                  <span className="truncate">{issue.property_name}</span>
                </div>
              </td>
              <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(issue.report_date), 'MMM d, yyyy', { locale: locale === 'es' ? dateFnsEs : undefined })}</td>
              <td className="py-2 px-3"><span className="text-xs text-muted-foreground">{categoryLabel(issue.category, t)}</span></td>
              <td className="py-2 px-3 text-xs text-muted-foreground">{issue.last_touch || '—'}</td>
              <td className="py-2 px-3 text-xs max-w-[300px] truncate">{translate(issue.id, 'details', issue.details) || '—'}</td>
              <td className="py-2 px-3"><StatusBadge status={issue.status} tone={ISSUE_STATUS_TONES[issue.status] ?? 'neutral'}>{statusLabel(issue.status, t)}</StatusBadge></td>
              <td className="py-2 px-3" onClick={e => e.stopPropagation()}>
                {issue.slack_link ? (
                  <a href={issue.slack_link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1 text-xs">
                    <ExternalLink className="w-3 h-3" /> {t('table.link')}
                  </a>
                ) : <span className="text-muted-foreground text-xs">—</span>}
              </td>
              {canEdit && (
                <td className="py-2 px-3" onClick={e => e.stopPropagation()}>
                  <select
                    value={issue.status}
                    onChange={e => onStatusChange({ id: issue.id, status: e.target.value })}
                    className="h-6 text-xs border border-input rounded px-1 bg-background"
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s, t)}</option>)}
                  </select>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
