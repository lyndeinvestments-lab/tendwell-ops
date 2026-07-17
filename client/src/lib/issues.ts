import { format, parseISO } from 'date-fns'
import type { StatusTone } from '@/lib/status-colors'

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

/** "3 days overdue" / "Due today" for a due_date already known to be overdue. */
export function overdueLabel(dueDate: string): string {
  const due = parseISO(dueDate)
  const today = parseISO(todayStr())
  const days = Math.round((today.getTime() - due.getTime()) / 86_400_000)
  if (days <= 0) return 'Due today'
  return `${days} day${days === 1 ? '' : 's'} overdue`
}

/** "Due Jul 20" for a due_date that isn't overdue (yet). */
export function dueLabel(dueDate: string): string {
  return `Due ${format(parseISO(dueDate), 'MMM d')}`
}
