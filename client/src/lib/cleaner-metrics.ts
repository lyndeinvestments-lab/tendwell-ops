// Pure logic for the Cleaners page and Cleaner Metrics (Trellis API expansion
// WS3, 2026-10-14). No I/O: the hooks load rows, this module filters and
// aggregates them, and cleaner-metrics.test.ts pins the rules.
//
// Sources (all read through staff-only definer views, see 20261014c):
//   - cleans:       trellis_cleaner_tasks (Tendwell clean tasks, any status).
//                   A clean counts for EVERY cleaner in `cleaner_ids` (two
//                   people on one turn both did it); a Tendwell clean with no
//                   identified cleaner goes to the "Tendwell crew" row.
//   - inspections:  inspections.rated_clean_task_id -> the clean it rated.
//   - reviews:      review_clean_attribution.rated_clean_task_id -> the clean
//                   that prepared the stay (reviews grant only).
//   - issues:       cleaning_issues matched by exact `last_touch` name (the
//                   pre-Trellis rule, kept so coaching flags keep working).

import {
  rosterExclusionReason, likelySamePerson, normalizeEmail, CREATE_SEEN_WITHIN_DAYS,
  type RosterMember,
} from '@shared/trellis-sync-rules'

// ─── Rows ─────────────────────────────────────────────────────────────────

export type CleanerStatus = 'active' | 'offboarded'
export type StatusFilter = CleanerStatus | 'all'

export interface CleanerLite {
  id: string
  full_name: string
  status?: string | null
  is_active?: boolean | null
  trellis_user_id?: string | null
  source?: string | null
}

export interface CleanTaskRow {
  trellis_task_id: string
  scheduled_date: string | null
  status: string | null
  cleaner_id: string | null
  cleaner_ids: string[] | null
  property_id: number | null
  property_name: string | null
  trellis_property_name: string | null
  title: string | null
  clean_kind: string | null
}

export interface RatedInspectionRow {
  id: string
  rated_clean_task_id: string | null
  overall_score: number | string | null
  cleanliness_score: number | string | null
  inspected_at: string | null
}

export interface AttributedReviewRow {
  trellis_review_id: string
  rated_clean_task_id: string | null
  cleanliness_5: number | string | null
  normalized_rating: number | string | null
}

export interface IssueRow {
  last_touch: string | null
  category: string | null
  status: string | null
  report_date?: string | null
}

// ─── Status ───────────────────────────────────────────────────────────────

export function cleanerStatus(c: Pick<CleanerLite, 'status' | 'is_active'>): CleanerStatus {
  if (c.status === 'offboarded' || c.status === 'active') return c.status
  return c.is_active === false ? 'offboarded' : 'active'
}

export function filterCleanersByStatus<T extends CleanerLite>(cleaners: ReadonlyArray<T>, filter: StatusFilter): T[] {
  if (filter === 'all') return [...cleaners]
  return cleaners.filter(c => cleanerStatus(c) === filter)
}

export function countByStatus(cleaners: ReadonlyArray<CleanerLite>): Record<StatusFilter, number> {
  let active = 0
  for (const c of cleaners) if (cleanerStatus(c) === 'active') active++
  return { active, offboarded: cleaners.length - active, all: cleaners.length }
}

// ─── Date range ───────────────────────────────────────────────────────────

export type RangePreset = '7' | '30' | '90' | '180'
export const RANGE_PRESETS: readonly RangePreset[] = ['7', '30', '90', '180']
export const UPCOMING_DAYS = 14

function isoDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return isoDay(new Date(y, m - 1, d + days))
}

/** Inclusive [from, today] window for completed work plus the upcoming window
 *  (today .. today+14) for scheduled cleans. Dates are local calendar days,
 *  matching trellis `scheduled_date` (a DATE). */
export function metricsRange(preset: RangePreset, now: Date = new Date()): { from: string; today: string; upcomingTo: string } {
  const today = isoDay(now)
  return { from: addDaysIso(today, -(Number(preset) - 1)), today, upcomingTo: addDaysIso(today, UPCOMING_DAYS) }
}

// ─── Task helpers ─────────────────────────────────────────────────────────

/** Everyone credited with a clean (de-duplicated, never empty strings). */
export function taskCleanerIds(t: Pick<CleanTaskRow, 'cleaner_id' | 'cleaner_ids'>): string[] {
  const ids = (t.cleaner_ids && t.cleaner_ids.length > 0) ? t.cleaner_ids : (t.cleaner_id ? [t.cleaner_id] : [])
  return Array.from(new Set(ids.filter(Boolean)))
}

export function isCompletedTask(t: Pick<CleanTaskRow, 'status'>): boolean {
  return (t.status ?? '').toUpperCase() === 'COMPLETED'
}

const CLOSED_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'CANCELED', 'DELETED', 'DECLINED'])

export function isUpcomingTask(t: Pick<CleanTaskRow, 'status' | 'scheduled_date'>, today: string, upcomingTo: string): boolean {
  if (!t.scheduled_date || CLOSED_STATUSES.has((t.status ?? '').toUpperCase())) return false
  return t.scheduled_date >= today && t.scheduled_date <= upcomingTo
}

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function avg(values: number[]): number | null {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null
}

/** A cleanliness score at or below this (out of 5) counts as a low review. */
export const LOW_REVIEW_CLEANLINESS = 3

// ─── Aggregation ──────────────────────────────────────────────────────────

export const CREW_ROW_ID = '__tendwell_crew__'

export interface CleanerMetricRow {
  id: string
  name: string
  isCrew: boolean
  status: CleanerStatus
  linked: boolean
  completedCleans: number
  upcomingCleans: number
  inspectionCount: number
  avgInspectionOverall: number | null
  avgInspectionCleanliness: number | null
  reviewCount: number
  avgReviewCleanliness: number | null
  lowReviewCount: number
  issueCount: number
  issueRate: number
  resolutionRate: number
  topIssueCategory: string | null
}

export interface MetricsInput {
  cleaners: ReadonlyArray<CleanerLite>
  tasks: ReadonlyArray<CleanTaskRow>
  inspections: ReadonlyArray<RatedInspectionRow>
  reviews: ReadonlyArray<AttributedReviewRow>
  issues: ReadonlyArray<IssueRow>
  from: string
  today: string
  upcomingTo: string
}

export interface MetricsResult {
  rows: CleanerMetricRow[]
  crew: CleanerMetricRow
  totals: {
    completedCleans: number
    identifiedCleans: number
    upcomingCleans: number
    inspectionCount: number
    avgInspectionOverall: number | null
    reviewCount: number
    avgReviewCleanliness: number | null
  }
}

interface Acc {
  completed: Set<string>
  upcoming: Set<string>
  inspOverall: number[]
  inspClean: number[]
  inspCount: number
  reviewClean: number[]
  reviewCount: number
  low: number
}

function newAcc(): Acc {
  return { completed: new Set(), upcoming: new Set(), inspOverall: [], inspClean: [], inspCount: 0, reviewClean: [], reviewCount: 0, low: 0 }
}

/** Latest inspection per rated clean (a re-inspection replaces the first). */
export function latestInspectionByTask(inspections: ReadonlyArray<RatedInspectionRow>): Map<string, RatedInspectionRow> {
  const map = new Map<string, RatedInspectionRow>()
  for (const i of inspections) {
    if (!i.rated_clean_task_id) continue
    const prev = map.get(i.rated_clean_task_id)
    if (!prev || (i.inspected_at ?? '') > (prev.inspected_at ?? '')) map.set(i.rated_clean_task_id, i)
  }
  return map
}

export function reviewsByTask<T extends Pick<AttributedReviewRow, 'rated_clean_task_id'>>(reviews: ReadonlyArray<T>): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const r of reviews) {
    if (!r.rated_clean_task_id) continue
    map.set(r.rated_clean_task_id, [...(map.get(r.rated_clean_task_id) ?? []), r])
  }
  return map
}

function issueStats(name: string, issues: ReadonlyArray<IssueRow>, from: string, today: string) {
  const key = name.trim().toLowerCase()
  // Exact (trimmed, case-insensitive) match: substring matching once credited
  // "Ali"'s issues to "Malik".
  const mine = issues.filter(i =>
    !!i.last_touch && i.last_touch.trim().toLowerCase() === key &&
    (!i.report_date || (i.report_date.slice(0, 10) >= from && i.report_date.slice(0, 10) <= today)),
  )
  const completed = mine.filter(i => i.status === 'Completed').length
  const cats: Record<string, number> = {}
  for (const i of mine) if (i.category) cats[i.category] = (cats[i.category] ?? 0) + 1
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0]
  return { count: mine.length, completed, top: top ? top[0] : null }
}

function toRow(id: string, name: string, acc: Acc, extra: Partial<CleanerMetricRow>, issues?: { count: number; completed: number; top: string | null }): CleanerMetricRow {
  const completedCleans = acc.completed.size
  const issueCount = issues?.count ?? 0
  return {
    id,
    name,
    isCrew: false,
    status: 'active',
    linked: false,
    completedCleans,
    upcomingCleans: acc.upcoming.size,
    inspectionCount: acc.inspCount,
    avgInspectionOverall: avg(acc.inspOverall),
    avgInspectionCleanliness: avg(acc.inspClean),
    reviewCount: acc.reviewCount,
    avgReviewCleanliness: avg(acc.reviewClean),
    lowReviewCount: acc.low,
    issueCount,
    issueRate: completedCleans > 0 ? (issueCount / completedCleans) * 100 : 0,
    resolutionRate: issueCount > 0 ? ((issues?.completed ?? 0) / issueCount) * 100 : 100,
    topIssueCategory: issues?.top ?? null,
    ...extra,
  }
}

export function aggregateCleanerMetrics(input: MetricsInput): MetricsResult {
  const { cleaners, tasks, inspections, reviews, issues, from, today, upcomingTo } = input
  const accs = new Map<string, Acc>()
  const get = (id: string) => {
    let a = accs.get(id)
    if (!a) { a = newAcc(); accs.set(id, a) }
    return a
  }
  const inspByTask = latestInspectionByTask(inspections)
  const revByTask = reviewsByTask(reviews)

  let completedTotal = 0
  let identified = 0
  let upcomingTotal = 0
  const allInspOverall: number[] = []
  let allInspCount = 0
  const allReviewClean: number[] = []
  let allReviewCount = 0

  const seen = new Set<string>()
  for (const t of tasks) {
    if (seen.has(t.trellis_task_id)) continue
    seen.add(t.trellis_task_id)
    const ids = taskCleanerIds(t)
    const owners = ids.length ? ids : [CREW_ROW_ID]
    const date = t.scheduled_date ?? ''
    if (isCompletedTask(t) && date >= from && date <= today) {
      completedTotal++
      if (ids.length) identified++
      const insp = inspByTask.get(t.trellis_task_id)
      const overall = num(insp?.overall_score)
      const clean = num(insp?.cleanliness_score)
      const revs = revByTask.get(t.trellis_task_id) ?? []
      if (insp) { allInspCount++; if (overall != null) allInspOverall.push(overall) }
      for (const r of revs) { allReviewCount++; const c = num(r.cleanliness_5); if (c != null) allReviewClean.push(c) }
      for (const o of owners) {
        const a = get(o)
        a.completed.add(t.trellis_task_id)
        if (insp) {
          a.inspCount++
          if (overall != null) a.inspOverall.push(overall)
          if (clean != null) a.inspClean.push(clean)
        }
        for (const r of revs) {
          a.reviewCount++
          const c = num(r.cleanliness_5)
          if (c != null) {
            a.reviewClean.push(c)
            if (c <= LOW_REVIEW_CLEANLINESS) a.low++
          }
        }
      }
    } else if (isUpcomingTask(t, today, upcomingTo)) {
      upcomingTotal++
      for (const o of owners) get(o).upcoming.add(t.trellis_task_id)
    }
  }

  const rows = cleaners.map(c => toRow(c.id, c.full_name, get(c.id), {
    status: cleanerStatus(c),
    linked: !!c.trellis_user_id,
  }, issueStats(c.full_name, issues, from, today)))
    .sort((a, b) => (b.completedCleans - a.completedCleans) || (b.issueCount - a.issueCount) || a.name.localeCompare(b.name))

  const crew = toRow(CREW_ROW_ID, '', get(CREW_ROW_ID), { isCrew: true, linked: true })

  return {
    rows,
    crew,
    totals: {
      completedCleans: completedTotal,
      identifiedCleans: identified,
      upcomingCleans: upcomingTotal,
      inspectionCount: allInspCount,
      avgInspectionOverall: avg(allInspOverall),
      reviewCount: allReviewCount,
      avgReviewCleanliness: avg(allReviewClean),
    },
  }
}

// ─── Drill-down ───────────────────────────────────────────────────────────

export interface CleanHistoryItem<R extends AttributedReviewRow = AttributedReviewRow> {
  task: CleanTaskRow
  upcoming: boolean
  inspection: RatedInspectionRow | null
  reviews: R[]
}

/** One cleaner's (or the crew row's) cleans in the window: upcoming cleans
 *  first in date order, then completed cleans newest first. */
export function cleanHistoryFor<R extends AttributedReviewRow>(
  cleanerId: string,
  tasks: ReadonlyArray<CleanTaskRow>,
  inspections: ReadonlyArray<RatedInspectionRow>,
  reviews: ReadonlyArray<R>,
  window: { from: string; today: string; upcomingTo: string },
): CleanHistoryItem<R>[] {
  const inspByTask = latestInspectionByTask(inspections)
  const revByTask = reviewsByTask(reviews)
  const upcoming: CleanHistoryItem<R>[] = []
  const done: CleanHistoryItem<R>[] = []
  const seen = new Set<string>()
  for (const t of tasks) {
    if (seen.has(t.trellis_task_id)) continue
    seen.add(t.trellis_task_id)
    const ids = taskCleanerIds(t)
    const mine = cleanerId === CREW_ROW_ID ? ids.length === 0 : ids.includes(cleanerId)
    if (!mine) continue
    const date = t.scheduled_date ?? ''
    if (isCompletedTask(t) && date >= window.from && date <= window.today) {
      done.push({ task: t, upcoming: false, inspection: inspByTask.get(t.trellis_task_id) ?? null, reviews: revByTask.get(t.trellis_task_id) ?? [] })
    } else if (isUpcomingTask(t, window.today, window.upcomingTo)) {
      upcoming.push({ task: t, upcoming: true, inspection: null, reviews: [] })
    }
  }
  upcoming.sort((a, b) => (a.task.scheduled_date ?? '').localeCompare(b.task.scheduled_date ?? ''))
  done.sort((a, b) => (b.task.scheduled_date ?? '').localeCompare(a.task.scheduled_date ?? ''))
  return [...upcoming, ...done]
}

export function snippet(text: string | null | undefined, max = 160): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

// ─── Unlinked Trellis roster members ──────────────────────────────────────

export interface RosterRow extends RosterMember {
  workspace?: string | null
}

export interface CleanerIdentity extends CleanerLite {
  email?: string | null
  alt_email?: string | null
}

export interface UnlinkedMember {
  member: RosterRow
  dismissed: boolean
  /** Not returned by a recent workforce pull: likely left Trellis and still
   *  draining under the sync's deactivation cap. */
  stale: boolean
  /** Another roster account that looks like the same person. */
  possibleDuplicateOf: string | null
  /** A cleaner whose name looks like this member's. */
  similarCleaner: string | null
  /** A cleaner already using this email (linked to someone else in Trellis). */
  emailUsedBy: string | null
}

/**
 * Active roster members (workspace A) that no cleaner is linked to, excluding
 * the same accounts the sync never turns into cleaners (AI agent, vendor
 * account, nameless, test / Trellis staff, admins, non-cleaning departments).
 * Flags the identity questions a human has to settle instead of guessing.
 */
export function unlinkedRosterMembers(
  roster: ReadonlyArray<RosterRow>,
  cleaners: ReadonlyArray<CleanerIdentity>,
  dismissedUserIds: ReadonlySet<string>,
  now: Date = new Date(),
): UnlinkedMember[] {
  const linked = new Set(cleaners.map(c => c.trellis_user_id).filter((v): v is string => !!v))
  const eligible = roster.filter(m => (m.workspace ?? 'A') === 'A' && m.is_active && rosterExclusionReason(m) == null)
  const unlinked = eligible.filter(m => !linked.has(m.user_id))
  const cutoff = now.getTime() - CREATE_SEEN_WITHIN_DAYS * 86_400_000
  return unlinked.map(m => {
    const seen = m.last_seen_at ? Date.parse(m.last_seen_at) : NaN
    // Same rule as the sync: a look-alike account only matters while it is
    // also live; an email match settles identity, so it hides the name hint.
    const dup = eligible.find(o => o.user_id !== m.user_id && o.last_seen_at != null && Date.parse(o.last_seen_at) >= cutoff && likelySamePerson(o.name, m.name))
    const email = normalizeEmail(m.email)
    const emailUser = email ? cleaners.find(c => normalizeEmail(c.email) === email || normalizeEmail(c.alt_email) === email) : undefined
    const similar = emailUser ? undefined : cleaners.find(c => likelySamePerson(c.full_name, m.name))
    return {
      member: m,
      dismissed: dismissedUserIds.has(m.user_id),
      stale: !(seen >= cutoff),
      possibleDuplicateOf: dup?.name ?? null,
      similarCleaner: similar?.full_name ?? null,
      emailUsedBy: emailUser?.full_name ?? null,
    }
  }).sort((a, b) =>
    Number(a.dismissed) - Number(b.dismissed) ||
    Number(a.stale) - Number(b.stale) ||
    (a.member.name ?? '').localeCompare(b.member.name ?? ''))
}

/** Roster members a cleaner can be linked to: workspace A, not the AI agent /
 *  vendor / nameless accounts, not already linked to another cleaner. */
export function linkableRosterMembers(
  roster: ReadonlyArray<RosterRow>,
  cleaners: ReadonlyArray<CleanerLite>,
  forCleanerId: string,
): RosterRow[] {
  const taken = new Set(cleaners.filter(c => c.id !== forCleanerId).map(c => c.trellis_user_id).filter((v): v is string => !!v))
  return roster
    .filter(m => (m.workspace ?? 'A') === 'A' && !taken.has(m.user_id))
    .filter(m => {
      const r = rosterExclusionReason(m)
      return r !== 'ai_agent' && r !== 'vendor_account' && r !== 'no_name'
    })
    .sort((a, b) => Number(b.is_active) - Number(a.is_active) || (a.name ?? '').localeCompare(b.name ?? ''))
}

/** Crew logins (never staff/admin accounts) belonging to a cleaner's email(s):
 *  the only app_users rows the offboard dialog may offer to remove. */
export const CREW_LOGIN_ROLES = ['cleaning', 'inspector', 'supervisor'] as const

export function crewLoginsFor<T extends { google_email: string | null; role: string | null }>(
  cleaner: Pick<CleanerIdentity, 'email' | 'alt_email'>,
  users: ReadonlyArray<T>,
): T[] {
  const emails = new Set([normalizeEmail(cleaner.email), normalizeEmail(cleaner.alt_email)].filter((e): e is string => !!e))
  if (emails.size === 0) return []
  return users.filter(u => {
    const e = normalizeEmail(u.google_email)
    return !!e && emails.has(e) && (CREW_LOGIN_ROLES as readonly string[]).includes(u.role ?? '')
  })
}

/** 'YYYY-MM-DD' (or an ISO timestamp) as a local Date, so a DATE column never
 *  shifts a day when formatted in a US timezone. */
export function parseLocalDay(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}
