import { describe, it, expect } from 'vitest'
import {
  aggregateCleanerMetrics, cleanHistoryFor, cleanerStatus, countByStatus, crewLoginsFor,
  filterCleanersByStatus, isUpcomingTask, linkableRosterMembers, metricsRange, snippet,
  taskCleanerIds, unlinkedRosterMembers, CREW_ROW_ID,
  type CleanTaskRow, type RosterRow,
} from './cleaner-metrics'

const RANGE = { from: '2026-09-15', today: '2026-10-14', upcomingTo: '2026-10-28' }

function task(id: string, date: string, status: string, cleaners: string[] = []): CleanTaskRow {
  return {
    trellis_task_id: id, scheduled_date: date, status,
    cleaner_id: cleaners[0] ?? null, cleaner_ids: cleaners.length ? cleaners : null,
    property_id: 1, property_name: 'Cabin', trellis_property_name: 'Cabin', title: 'Turn Clean', clean_kind: 'turn',
  }
}

const CLEANERS = [
  { id: 'a', full_name: 'Ana Ochoa', status: 'active', trellis_user_id: 'ua' },
  { id: 'b', full_name: 'Belsi Diaz', status: 'active', trellis_user_id: 'ub' },
  { id: 'n', full_name: 'Nicoll Yanez', status: 'offboarded', is_active: false, trellis_user_id: 'un' },
  { id: 'c', full_name: 'Claudia Pavon', status: null, is_active: true, trellis_user_id: null },
]

describe('status filter', () => {
  it('reads status, falling back to is_active', () => {
    expect(cleanerStatus({ status: 'offboarded' })).toBe('offboarded')
    expect(cleanerStatus({ status: null, is_active: false })).toBe('offboarded')
    expect(cleanerStatus({ status: null, is_active: null })).toBe('active')
  })
  it('filters Active / Offboarded / All', () => {
    expect(filterCleanersByStatus(CLEANERS, 'active').map(c => c.id)).toEqual(['a', 'b', 'c'])
    expect(filterCleanersByStatus(CLEANERS, 'offboarded').map(c => c.id)).toEqual(['n'])
    expect(filterCleanersByStatus(CLEANERS, 'all')).toHaveLength(4)
    expect(countByStatus(CLEANERS)).toEqual({ active: 3, offboarded: 1, all: 4 })
  })
})

describe('metricsRange', () => {
  it('is an inclusive N-day window ending today plus 14 upcoming days', () => {
    expect(metricsRange('30', new Date(2026, 9, 14, 15))).toEqual(RANGE)
    expect(metricsRange('7', new Date(2026, 0, 3)).from).toBe('2025-12-28')
  })
})

describe('task helpers', () => {
  it('credits every cleaner in cleaner_ids, else cleaner_id', () => {
    expect(taskCleanerIds({ cleaner_id: 'a', cleaner_ids: ['a', 'b', 'a'] })).toEqual(['a', 'b'])
    expect(taskCleanerIds({ cleaner_id: 'a', cleaner_ids: null })).toEqual(['a'])
    expect(taskCleanerIds({ cleaner_id: null, cleaner_ids: [] })).toEqual([])
  })
  it('upcoming = not closed and within today..today+14', () => {
    expect(isUpcomingTask({ status: 'SCHEDULED', scheduled_date: '2026-10-14' }, RANGE.today, RANGE.upcomingTo)).toBe(true)
    expect(isUpcomingTask({ status: 'SCHEDULED', scheduled_date: '2026-10-29' }, RANGE.today, RANGE.upcomingTo)).toBe(false)
    expect(isUpcomingTask({ status: 'SCHEDULED', scheduled_date: '2026-10-13' }, RANGE.today, RANGE.upcomingTo)).toBe(false)
    expect(isUpcomingTask({ status: 'COMPLETED', scheduled_date: '2026-10-20' }, RANGE.today, RANGE.upcomingTo)).toBe(false)
    expect(isUpcomingTask({ status: 'CANCELLED', scheduled_date: '2026-10-20' }, RANGE.today, RANGE.upcomingTo)).toBe(false)
  })
})

describe('aggregateCleanerMetrics', () => {
  const tasks = [
    task('t1', '2026-10-01', 'COMPLETED', ['a']),
    task('t2', '2026-10-02', 'COMPLETED', ['a', 'b']),      // both cleaners credited
    task('t3', '2026-10-03', 'COMPLETED'),                  // crew: no identified cleaner
    task('t4', '2026-09-01', 'COMPLETED', ['a']),           // outside the window
    task('t5', '2026-10-20', 'SCHEDULED', ['b']),           // upcoming
    task('t6', '2026-10-20', 'SCHEDULED'),                  // upcoming crew
    task('t1', '2026-10-01', 'COMPLETED', ['a']),           // duplicate row ignored
    task('t7', '2026-10-05', 'IN_PROGRESS', ['a']),         // neither done nor upcoming
  ]
  const inspections = [
    { id: 'i1', rated_clean_task_id: 't1', overall_score: '4.0', cleanliness_score: 3, inspected_at: '2026-10-02' },
    { id: 'i1b', rated_clean_task_id: 't1', overall_score: 5, cleanliness_score: 5, inspected_at: '2026-10-03' }, // re-inspection wins
    { id: 'i2', rated_clean_task_id: 't2', overall_score: 3, cleanliness_score: 2, inspected_at: '2026-10-03' },
    { id: 'i3', rated_clean_task_id: 't3', overall_score: 4, cleanliness_score: 4, inspected_at: '2026-10-04' },
    { id: 'i4', rated_clean_task_id: 't4', overall_score: 1, cleanliness_score: 1, inspected_at: '2026-09-02' },   // clean outside window
  ]
  const reviews = [
    { trellis_review_id: 'r1', rated_clean_task_id: 't2', cleanliness_5: '5.00', normalized_rating: 1 },
    { trellis_review_id: 'r2', rated_clean_task_id: 't2', cleanliness_5: 3, normalized_rating: 0.6 },
    { trellis_review_id: 'r3', rated_clean_task_id: 't3', cleanliness_5: null, normalized_rating: 0.8 },
  ]
  const issues = [
    { last_touch: 'Ana Ochoa', category: 'Missed Clean', status: 'Completed', report_date: '2026-10-05' },
    { last_touch: ' ana ochoa ', category: 'Missed Clean', status: 'Needs Attention', report_date: '2026-10-06' },
    { last_touch: 'Ana Ochoa', category: 'Other', status: 'Completed', report_date: '2026-08-01' }, // outside window
    { last_touch: 'Ana', category: 'Other', status: 'Completed', report_date: '2026-10-06' },         // not a substring match
  ]
  const res = aggregateCleanerMetrics({ cleaners: CLEANERS, tasks, inspections, reviews, issues, ...RANGE })
  const row = (id: string) => res.rows.find(r => r.id === id)!

  it('counts completed Tendwell cleans per cleaner (shared cleans credit both)', () => {
    expect(row('a').completedCleans).toBe(2)
    expect(row('b').completedCleans).toBe(1)
    expect(row('n').completedCleans).toBe(0)
    expect(res.crew.completedCleans).toBe(1)
    expect(res.totals).toMatchObject({ completedCleans: 3, identifiedCleans: 2, upcomingCleans: 2 })
  })

  it('counts upcoming assigned cleans and the crew row', () => {
    expect(row('b').upcomingCleans).toBe(1)
    expect(row('a').upcomingCleans).toBe(0)
    expect(res.crew.upcomingCleans).toBe(1)
  })

  it('averages the latest inspection of each rated clean', () => {
    expect(row('a').inspectionCount).toBe(2)
    expect(row('a').avgInspectionOverall).toBe(4)          // (5 + 3) / 2
    expect(row('a').avgInspectionCleanliness).toBe(3.5)    // (5 + 2) / 2
    expect(row('b').avgInspectionOverall).toBe(3)
    expect(res.crew.avgInspectionOverall).toBe(4)
    expect(res.totals.inspectionCount).toBe(3)
  })

  it('averages review cleanliness and counts low reviews', () => {
    expect(row('b').reviewCount).toBe(2)
    expect(row('b').avgReviewCleanliness).toBe(4)
    expect(row('b').lowReviewCount).toBe(1)
    expect(res.crew.reviewCount).toBe(1)
    expect(res.crew.avgReviewCleanliness).toBeNull()
  })

  it('keeps issue metrics: exact name, in range, rate over Trellis cleans', () => {
    expect(row('a').issueCount).toBe(2)
    expect(row('a').issueRate).toBe(100)
    expect(row('a').resolutionRate).toBe(50)
    expect(row('a').topIssueCategory).toBe('Missed Clean')
    expect(row('b').resolutionRate).toBe(100)
  })

  it('marks status and Trellis link, sorted by cleans', () => {
    expect(res.rows.map(r => r.id)).toEqual(['a', 'b', 'c', 'n'])
    expect(row('n').status).toBe('offboarded')
    expect(row('c').linked).toBe(false)
    expect(res.crew.isCrew).toBe(true)
  })

  it('builds the drill-down: upcoming first, then newest completed with inspection + reviews', () => {
    const hist = cleanHistoryFor('b', tasks, inspections, reviews, RANGE)
    expect(hist.map(h => [h.task.trellis_task_id, h.upcoming])).toEqual([['t5', true], ['t2', false]])
    expect(hist[1].inspection?.id).toBe('i2')
    expect(hist[1].reviews.map(r => r.trellis_review_id)).toEqual(['r1', 'r2'])
    const crew = cleanHistoryFor(CREW_ROW_ID, tasks, inspections, reviews, RANGE)
    expect(crew.map(h => h.task.trellis_task_id)).toEqual(['t6', 't3'])
    const ana = cleanHistoryFor('a', tasks, inspections, reviews, RANGE)
    expect(ana.map(h => h.task.trellis_task_id)).toEqual(['t2', 't1'])
    expect(ana[1].inspection?.id).toBe('i1b')
  })
})

describe('snippet', () => {
  it('collapses whitespace and truncates', () => {
    expect(snippet('  a\n\nb  ')).toBe('a b')
    expect(snippet('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`)
    expect(snippet(null)).toBe('')
  })
})

describe('unlinked roster members', () => {
  const now = new Date('2026-10-14T23:30:00Z')
  const fresh = '2026-10-14T23:18:37Z'
  const member = (o: Partial<RosterRow> & { user_id: string; name: string | null }): RosterRow => ({
    email: null, role: 'MEMBER', departments: ['Cleaning'], is_active: true, last_seen_at: fresh, workspace: 'A', ...o,
  })
  const roster: RosterRow[] = [
    member({ user_id: 'u1', name: 'Gabriela Velasquez', email: 'gabi@example.com' }),
    member({ user_id: 'u2', name: 'Yeimi Munguia' }),
    member({ user_id: 'u3', name: 'Yeymi munguia', last_seen_at: '2026-10-02T03:00:00Z' }),
    member({ user_id: 'u4', name: 'Tendwell Cleaning Co.' }),
    member({ user_id: '00000000-0000-0000-0000-000000000000', name: 'AI Agent', role: 'ADMIN', departments: [] }),
    member({ user_id: 'u5', name: null }),
    member({ user_id: 'u6', name: 'Codex Tendwell Test', email: 'x@trellis.test' }),
    member({ user_id: 'u7', name: 'Front Desk', role: 'ADMIN', departments: ['Front Office'] }),
    member({ user_id: 'u8', name: 'Ana Ochoa' }),                                    // already linked
    member({ user_id: 'u9', name: 'Gone Person', is_active: false }),
    member({ user_id: 'u10', name: 'Claudia Pavon', email: 'shared@example.com' }),
    member({ user_id: 'u11', name: 'Other Ws', workspace: 'B' }),
  ]
  const cleaners = [
    { id: 'a', full_name: 'Ana Ochoa', trellis_user_id: 'u8' },
    { id: 'r', full_name: 'Roxana Pavon', email: 'shared@example.com', trellis_user_id: 'u99' },
    { id: 'c', full_name: 'Claudia Pavon', email: 'other@example.com', trellis_user_id: null },
  ]

  it('lists eligible active unlinked members only, same exclusions as the sync', () => {
    const list = unlinkedRosterMembers(roster, cleaners, new Set(['u1']), now)
    expect(list.map(u => u.member.user_id)).toEqual(['u10', 'u2', 'u3', 'u1'])
  })

  it('flags stale ghosts, duplicate accounts, similar cleaners and shared emails', () => {
    const list = unlinkedRosterMembers(roster, cleaners, new Set(['u1']), now)
    const by = (id: string) => list.find(u => u.member.user_id === id)!
    expect(by('u3').stale).toBe(true)
    expect(by('u2').stale).toBe(false)
    // The look-alike account stopped appearing in Trellis: it was replaced, not a duplicate.
    expect(by('u2').possibleDuplicateOf).toBeNull()
    expect(by('u3').possibleDuplicateOf).toBe('Yeimi Munguia')
    // An email match settles identity, so no name hint is shown.
    expect(by('u10').similarCleaner).toBeNull()
    expect(by('u10').emailUsedBy).toBe('Roxana Pavon')
    expect(by('u1').dismissed).toBe(true)
  })

  it('link picker excludes AI agent, vendor, nameless and members linked to someone else', () => {
    const ids = linkableRosterMembers(roster, cleaners, 'c').map(m => m.user_id)
    expect(ids).not.toContain('u4')
    expect(ids).not.toContain('u5')
    expect(ids).not.toContain('00000000-0000-0000-0000-000000000000')
    expect(ids).not.toContain('u8')
    expect(ids).not.toContain('u11')
    expect(ids).toContain('u9')                  // inactive members can still be linked (sorted last)
    expect(ids[ids.length - 1]).toBe('u9')
    expect(linkableRosterMembers(roster, cleaners, 'a').map(m => m.user_id)).toContain('u8')
  })
})

describe('crewLoginsFor', () => {
  it('matches email or alt email, crew roles only', () => {
    const users = [
      { id: 1, google_email: 'ANA@x.com', role: 'cleaning' },
      { id: 2, google_email: 'alt@x.com', role: 'inspector' },
      { id: 3, google_email: 'ana@x.com', role: 'admin' },
      { id: 4, google_email: 'other@x.com', role: 'cleaning' },
    ]
    expect(crewLoginsFor({ email: 'ana@x.com', alt_email: 'alt@x.com' }, users).map(u => u.id)).toEqual([1, 2])
    expect(crewLoginsFor({ email: null, alt_email: null }, users)).toEqual([])
  })
})
