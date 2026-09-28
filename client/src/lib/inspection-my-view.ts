import type { InspectionStatus } from '@/lib/inspections'

// Saved filters behind the Inspections "My View" tab. Persisted per user in
// app_users.ui_prefs under MY_VIEW_PREF_KEY (see use-ui-prefs.ts).
export const MY_VIEW_PREF_KEY = 'inspections.myView'

export type MyViewFilters = {
  inspectorFilter: string // 'all' | 'unassigned' | cleaners.id
  statusFilter: 'all' | InspectionStatus
  minScore: string // 'any' | '1'..'5'
  dateFrom: string // yyyy-MM-dd or ''
  dateTo: string
  // Relative "today" range, re-evaluated each visit (a saved literal date
  // would go stale by tomorrow). Overrides dateFrom/dateTo when on.
  todayOnly: boolean
}

const STATUSES: ReadonlyArray<MyViewFilters['statusFilter']> = ['all', 'scheduled', 'completed', 'skipped']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SCORE_RE = /^(any|[1-5])$/

// Default: everything assigned to or done by the signed-in inspector
// (every status). Staff who aren't inspectors start from all inspectors.
export function defaultMyView(myInspectorId: string | null): MyViewFilters {
  return {
    inspectorFilter: myInspectorId ?? 'all',
    statusFilter: 'all',
    minScore: 'any',
    dateFrom: '',
    dateTo: '',
    todayOnly: false,
  }
}

// Saved JSON is untrusted: keep each field only if it has the expected shape.
export function sanitizeMyView(raw: unknown, fallback: MyViewFilters): MyViewFilters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const r = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  const inspector = str(r.inspectorFilter)
  const status = str(r.statusFilter) as MyViewFilters['statusFilter'] | null
  const minScore = str(r.minScore)
  const dateFrom = str(r.dateFrom)
  const dateTo = str(r.dateTo)
  return {
    inspectorFilter: inspector && inspector.length <= 64 ? inspector : fallback.inspectorFilter,
    statusFilter: status && STATUSES.includes(status) ? status : fallback.statusFilter,
    minScore: minScore && SCORE_RE.test(minScore) ? minScore : fallback.minScore,
    dateFrom: dateFrom === '' || (dateFrom && DATE_RE.test(dateFrom)) ? dateFrom : fallback.dateFrom,
    dateTo: dateTo === '' || (dateTo && DATE_RE.test(dateTo)) ? dateTo : fallback.dateTo,
    todayOnly: typeof r.todayOnly === 'boolean' ? r.todayOnly : fallback.todayOnly,
  }
}

export function sameMyView(a: MyViewFilters, b: MyViewFilters): boolean {
  return a.inspectorFilter === b.inspectorFilter
    && a.statusFilter === b.statusFilter
    && a.minScore === b.minScore
    && a.dateFrom === b.dateFrom
    && a.dateTo === b.dateTo
    && a.todayOnly === b.todayOnly
}

// The date range actually queried. `today` is the viewer's local yyyy-MM-dd.
export function effectiveMyViewDates(f: MyViewFilters, today: string): { dateFrom: string; dateTo: string } {
  return f.todayOnly ? { dateFrom: today, dateTo: today } : { dateFrom: f.dateFrom, dateTo: f.dateTo }
}
