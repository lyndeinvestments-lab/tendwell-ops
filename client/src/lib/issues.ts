import { format, parseISO } from 'date-fns'
import { es as dateFnsEs } from 'date-fns/locale'
import type { StatusTone } from '@/lib/status-colors'

/**
 * Local, minimal translator shape (matches `TFunc` from `lib/i18n/t.ts`)
 * so this domain file doesn't need to import the i18n module — the
 * dependency direction stays one-way (i18n dictionaries reference nothing
 * here; components wire the two together via `useLocale()`).
 */
type TFunc = (key: string, vars?: Record<string, string | number>, fallback?: string) => string
type LocaleCode = 'en' | 'es'

/** `'Needs Attention'` → `'needs_attention'`; used to look up `status.*`/`priority.*`/`category.*` dictionary keys. */
export function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/** Translated status display name, falling back to the raw DB value if no dictionary key matches. */
export function statusLabel(status: string, t: TFunc): string {
  return t(`status.${slugify(status)}`, undefined, status)
}

/** Translated priority display name, falling back to the raw DB value if no dictionary key matches. */
export function priorityLabel(priority: string, t: TFunc): string {
  return t(`priority.${slugify(priority)}`, undefined, priority)
}

/** Translated category display name, falling back to the raw DB value if no dictionary key matches. */
export function categoryLabel(category: string, t: TFunc): string {
  return t(`category.${slugify(category)}`, undefined, category)
}

/** Translated issue-type display name ("Needs Attention" / "Guest Feedback"). */
export function issueTypeLabel(issueType: string, t: TFunc): string {
  const fallback = issueType === 'guest_feedback' ? 'Guest Feedback' : 'Needs Attention'
  return t(`issueType.${issueType}`, undefined, fallback)
}

/**
 * Shared Issues domain types + constants + helpers.
 *
 * Extracted from `pages/issues.tsx` so the table/card/badge/filter/add-sheet
 * components (client/src/components/issues/*) and the detail sheet can share
 * one definition instead of drifting `any`-typed copies.
 *
 * `Issue` matches the `cleaning_issues` table (writes still go there) plus
 * the extra view-only fields (`activity_at`, `is_unread`, `last_read_at`,
 * `marked_unread`) that come along for free when reading from the
 * `issue_catchup_feed` view — those are optional/undefined on raw
 * `cleaning_issues` rows (e.g. the CSV import preview).
 */

export interface Issue {
  id: string
  report_date: string
  issue_type: string
  priority: string
  property_id: number | null
  property_name: string | null
  category: string
  last_touch: string | null
  details: string | null
  assessment: string | null
  resolution: string | null
  coverage: string | null
  status: string
  remarks: string | null
  slack_link: string | null
  reference: string | null
  created_at: string
  created_by: string | null
  updated_at: string
  completed_at: string | null
  due_date: string | null
  acknowledged_at: string | null
  acknowledged_by: string | null
  share_link_disabled: boolean
  share_token: string | null
  // `issue_catchup_feed` view-only fields — undefined on raw `cleaning_issues` rows.
  activity_at?: string | null
  last_read_at?: string | null
  marked_unread?: boolean | null
  is_unread?: boolean | null
}

export interface IssueComment {
  id: string
  issue_id: string
  content: string
  author_name: string | null
  author_type: string
  created_at: string
}

export interface IssuePhoto {
  id: string
  issue_id: string
  photo_url: string
  photo_path: string | null
  phase: string
  uploaded_by: string | null
  author_type: string
  created_at: string
}

export const CATEGORIES = [
  'Cleaning Not As Expected',
  'Missed Clean',
  'Service Not As Expected',
  'Linen/Towel issue',
  'Foul Smell / Odor',
  'Damage/Loss',
  'Guest Related',
  'Trash Pick Up Request',
  'Hot Tub Servicing',
  'Touch-Up Clean',
  'Other',
]

export const STATUSES = ['Needs Attention', 'In Progress', 'Completed']

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

export const ISSUE_STATUS_TONES: Record<string, StatusTone> = {
  'Needs Attention': 'destructive',
  Completed: 'success',
  'In Progress': 'warning',
}

function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

/** True for a needs_attention issue that's past its due date and not yet completed. */
export function isOverdue(issue: Pick<Issue, 'due_date' | 'status'>): boolean {
  if (!issue.due_date || issue.status === 'Completed') return false
  // due_date is a plain YYYY-MM-DD date column — lexicographic compare is safe
  // and avoids the UTC-midnight day-shift bug from `new Date(dateOnlyString)`.
  return issue.due_date < todayStr()
}

/** Lower rank = more urgent. `PRIORITIES` is ordered low→urgent, so invert its index. */
export function priorityRank(priority: string | null | undefined): number {
  const idx = PRIORITIES.indexOf((priority || 'normal') as Priority)
  return idx === -1 ? PRIORITIES.length : PRIORITIES.length - 1 - idx
}

/** True for an open (non-completed) urgent/high issue — floats to the top of sorted lists. */
export function floatsToTop(issue: Pick<Issue, 'priority' | 'status'>): boolean {
  return issue.status !== 'Completed' && priorityRank(issue.priority) <= 1
}

/** Maps a priority string to a StatusTone for the priority chip. Never hardcode colors. */
export function priorityTone(priority: string | null | undefined): StatusTone {
  switch (priority) {
    case 'urgent':
      return 'destructive'
    case 'high':
      return 'warning'
    default:
      return 'neutral'
  }
}

/** "3 days overdue" / "Due today" for a due_date already known to be overdue. Localized via the caller's `t()`. */
export function overdueLabel(dueDate: string, t: TFunc): string {
  const due = parseISO(dueDate)
  const today = parseISO(todayStr())
  const days = Math.round((today.getTime() - due.getTime()) / 86_400_000)
  if (days <= 0) return t('badges.dueToday', undefined, 'Due today')
  return t('badges.overdueDays', { count: days }, `${days} day${days === 1 ? '' : 's'} overdue`)
}

/** "Due Jul 20" for a due_date that isn't overdue (yet). Localized via the caller's `t()`/`locale`. */
export function dueLabel(dueDate: string, t: TFunc, locale: LocaleCode = 'en'): string {
  const dateStr = format(parseISO(dueDate), 'MMM d', { locale: locale === 'es' ? dateFnsEs : undefined })
  return t('badges.dueOn', { date: dateStr }, `Due ${dateStr}`)
}

/**
 * True if an issue belongs in the Catch-up queue: unread (per
 * `issue_catchup_feed.is_unread`), an open needs_attention issue that's
 * overdue, or an unacknowledged guest_feedback issue.
 */
export function isInCatchUpQueue(issue: Issue): boolean {
  return !!issue.is_unread
    || (issue.status !== 'Completed' && isOverdue(issue))
    || (issue.issue_type === 'guest_feedback' && !issue.acknowledged_at)
}

/**
 * Builds the Catch-up queue from the full issues array: filters to
 * `isInCatchUpQueue`, then sorts unread first → overdue first → priority
 * (urgent→low) → oldest (due_date ?? report_date) first. Shared by
 * `CatchUpButton` (count/tone) and `CatchUpFlow` (frozen queue on open) so
 * they never disagree on what's in the queue.
 */
export function catchUpQueue(issues: Issue[]): Issue[] {
  return issues
    .filter(isInCatchUpQueue)
    .slice()
    .sort((a, b) => {
      const aUnread = a.is_unread ? 0 : 1
      const bUnread = b.is_unread ? 0 : 1
      if (aUnread !== bUnread) return aUnread - bUnread

      const aOverdue = isOverdue(a) ? 0 : 1
      const bOverdue = isOverdue(b) ? 0 : 1
      if (aOverdue !== bOverdue) return aOverdue - bOverdue

      const rankDiff = priorityRank(a.priority) - priorityRank(b.priority)
      if (rankDiff !== 0) return rankDiff

      const aDate = a.due_date ?? a.report_date
      const bDate = b.due_date ?? b.report_date
      return aDate < bDate ? -1 : aDate > bDate ? 1 : 0
    })
}
