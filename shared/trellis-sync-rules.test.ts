import { describe, it, expect } from 'vitest'
import {
  cleanKindForTitle, trellisTaskCategory, isInspectionTitle, classifyTrellisTask,
  planRosterDeactivation, workforcePullComplete,
  planCleanerSync, rosterExclusionReason, likelySamePerson, normalizePersonName,
  reviewRow, pickRatedClean, SYNC_OFFBOARDED_BY, TRELLIS_NIL_USER,
  type RosterMember, type CleanerRow,
} from './trellis-sync-rules'

describe('cleanKindForTitle', () => {
  it.each([
    ['Departure Clean', 'departure'],
    ['Turn Clean', 'turn'],
    ['Onboarding Clean', 'onboarding'],
    ['Deep Clean', 'deep'],
    ['Last Clean & Linen Pull', 'last'],
    ['Owner Stay - Turn Clean', 'owner_stay'],
    ['Post-Owner Stay Clean - HT', 'owner_stay'],
    ['Same Day Turn', 'turn'],
    ['Double Clean', 'double'],
    ['Pre-Check-In Clean', 'arrival'],
  ])('%s → %s', (title, kind) => {
    expect(cleanKindForTitle(title)).toBe(kind)
  })

  it.each([
    'Vacancy Clean/Touch-up Clean', // vacancy + touch-up are not cleans (invoicing rule)
    'Vacancy Clean',
    'Urgent vacancy cleaning',
    'Touch Up Clean',
    'Touch-up Clean',
    'Cleaning Inspection',
    'Turn Cleaning Inspection', // aux classifier says clean; inspections never are
    'Cleaner Self-Inspection',
    'Cleaner inspection — assess touch-up vs. Departure Clean',
    'Property Walkthrough',
    'Pre-Owner Stay Walkthrough',
    'Hot Tub Refresh',
    'Air Filter Change',
    'NO CLEAN NEEDED - Departure Clean',
    'Leave the dirty linens',
    'Maintenance: Deck Board',
    '',
    null,
  ])('%s → null', title => {
    expect(cleanKindForTitle(title as string | null)).toBeNull()
  })
})

describe('trellisTaskCategory / isInspectionTitle', () => {
  it('forces rating inspections to inspection', () => {
    expect(trellisTaskCategory('Turn Cleaning Inspection')).toBe('inspection')
    expect(trellisTaskCategory('Cleaning Inspection')).toBe('inspection')
    expect(isInspectionTitle('Cleaning Inspection')).toBe(true)
  })
  it('keeps self-inspections and walkthroughs out', () => {
    expect(isInspectionTitle('Cleaner Self-Inspection')).toBe(false)
    expect(trellisTaskCategory('Cleaner Self-Inspection')).toBe('self_inspection')
    expect(isInspectionTitle('Green Light Doc Walkthrough / Element Gathering Inspection 2.0')).toBe(false)
  })
  it('falls through to the aux classifier', () => {
    expect(trellisTaskCategory('Departure Clean')).toBe('clean')
    expect(trellisTaskCategory('Mid-Stay Trash Pickup Request')).toBe('trash')
  })
})

describe('classifyTrellisTask', () => {
  const roster = new Set(['u-crew'])
  it('workspace A is always Tendwell', () => {
    expect(classifyTrellisTask({ workspace: 'A', title: 'Turn Clean' }, roster))
      .toEqual({ clean_kind: 'turn', is_tendwell: true, task_category: 'clean' })
  })
  it('B: vendor, roster assignee, or roster member in assignees', () => {
    expect(classifyTrellisTask({ workspace: 'B', title: 'Departure Clean', assigned_to_name: 'Tendwell Cleaning Co.' }, roster).is_tendwell).toBe(true)
    expect(classifyTrellisTask({ workspace: 'B', title: 'Departure Clean', assigned_to_id: 'u-crew' }, roster).is_tendwell).toBe(true)
    expect(classifyTrellisTask({ workspace: 'B', title: 'Departure Clean', assigned_to_id: 'u-haven', assignees: [{ assignee_id: 'u-crew' }] }, roster).is_tendwell).toBe(true)
    expect(classifyTrellisTask({ workspace: 'B', title: 'Departure Clean', assigned_to_id: 'u-haven', assigned_to_name: 'Haven Person' }, roster).is_tendwell).toBe(false)
  })
})

describe('planRosterDeactivation', () => {
  const rows = (n: number, missed = 0) => Array.from({ length: n }, (_, i) => ({ user_id: `u${String(i).padStart(2, '0')}`, is_active: true, missed_runs: missed }))
  it('does nothing when the pull is incomplete', () => {
    expect(planRosterDeactivation(rows(10), new Set(), false)).toEqual({ missed: [], deactivate: [], deferred: [] })
  })
  it('first miss only counts; second miss deactivates', () => {
    const existing = rows(20)
    const seen = new Set(existing.slice(1).map(r => r.user_id))
    const p1 = planRosterDeactivation(existing, seen, true)
    expect(p1.deactivate).toEqual([])
    expect(p1.missed).toEqual([{ user_id: 'u00', missed_runs: 1 }])
    const p2 = planRosterDeactivation([{ ...existing[0], missed_runs: 1 }, ...existing.slice(1)], seen, true)
    expect(p2.deactivate).toEqual(['u00'])
  })
  it('caps removals at ~10% of active members per run', () => {
    const existing = rows(40, 5)
    const p = planRosterDeactivation(existing, new Set(existing.slice(0, 20).map(r => r.user_id)), true)
    expect(p.deactivate).toHaveLength(4)
    expect(p.deferred).toHaveLength(16)
    // deferred members keep counting misses
    expect(p.missed.filter(m => m.missed_runs === 6)).toHaveLength(16)
  })
  it('drains the least recently seen first when capped', () => {
    const existing = [
      ...rows(10).map(r => ({ ...r, missed_runs: 4, last_seen_at: '2026-10-01' })),
      { user_id: 'zz-old', is_active: true, missed_runs: 4, last_seen_at: '2026-06-01' },
    ]
    const p = planRosterDeactivation(existing, new Set(), true)
    expect(p.deactivate).toEqual(['zz-old'])
  })
  it('inactive rows are ignored', () => {
    const p = planRosterDeactivation([{ user_id: 'x', is_active: false, missed_runs: 9 }], new Set(['y']), true)
    expect(p).toEqual({ missed: [], deactivate: [], deferred: [] })
  })
  it('workforcePullComplete', () => {
    expect(workforcePullComplete(44, 44, true)).toBe(true)
    expect(workforcePullComplete(40, 44, true)).toBe(false)
    expect(workforcePullComplete(44, null, false)).toBe(false)
    expect(workforcePullComplete(0, 0, true)).toBe(false)
  })
})

const member = (p: Partial<RosterMember> & { user_id: string }): RosterMember => ({
  name: 'Someone', email: null, role: 'MEMBER', departments: ['Cleaning'], is_active: true,
  last_seen_at: '2026-10-14T03:00:00Z', ...p,
})
const NOW = new Date('2026-10-14T12:00:00Z')
const cleaner = (p: Partial<CleanerRow> & { id: string; full_name: string }): CleanerRow => ({
  email: null, alt_email: null, trellis_user_id: null, status: 'active', offboarded_by: null, ...p,
})

describe('rosterExclusionReason', () => {
  it.each([
    [{ user_id: TRELLIS_NIL_USER, name: 'AI Agent', role: 'ADMIN' }, 'ai_agent'],
    [{ user_id: 'v', name: 'Tendwell Cleaning Co.' }, 'vendor_account'],
    [{ user_id: 'n', name: null }, 'no_name'],
    [{ user_id: 't', name: 'Codex Tendwell Test', email: 'codex-vendor@trellis.test' }, 'test_or_trellis_staff'],
    [{ user_id: 'k', name: 'Karim G', email: 'karim@trellistech.com', role: 'ADMIN' }, 'test_or_trellis_staff'],
    [{ user_id: 'a', name: 'Andrea Garcia', role: 'ADMIN', departments: ['Front Office'] }, 'admin'],
    [{ user_id: 'f', name: 'Nina Ocampo', role: 'MANAGER', departments: ['Front Office'] }, 'not_cleaning_department'],
    [{ user_id: 'c', name: 'Ana Ochoa' }, null],
    [{ user_id: 'q', name: 'Ben Lynde', departments: ['Inspection', 'Maintenance'] }, null],
  ] as Array<[Partial<RosterMember> & { user_id: string }, string | null]>)('%o → %s', (m, reason) => {
    expect(rosterExclusionReason(member(m))).toBe(reason)
  })
})

describe('likelySamePerson / normalizePersonName', () => {
  it('handles accents, case and one-letter variants', () => {
    expect(normalizePersonName('Justin Henríquez')).toBe('justin henriquez')
    expect(likelySamePerson('Yeimi Munguia', 'Yeymi munguia')).toBe(true)
    expect(likelySamePerson('Yeimi Munguia', 'Yeimi Herrera')).toBe(false)
    expect(likelySamePerson('Ana', 'Ann')).toBe(false) // too short for fuzzy
  })
})

describe('planCleanerSync', () => {
  it('links by email first, including alt_email, case-insensitively', () => {
    const p = planCleanerSync(
      [member({ user_id: 'u1', name: 'Irma Betancourth', email: 'irma@x.com' }),
        member({ user_id: 'u2', name: 'joshua cruz', email: 'Joshua@X.com' })],
      [cleaner({ id: 'c1', full_name: 'Irma Betancourth', email: 'other@x.com', alt_email: 'irma@x.com' }),
        cleaner({ id: 'c2', full_name: 'Joshua Cruz', email: 'joshua@x.com' })],
      { autoCreate: false },
    )
    expect(p.links).toEqual([
      { cleaner_id: 'c1', user_id: 'u1', via: 'email' },
      { cleaner_id: 'c2', user_id: 'u2', via: 'email' },
    ])
  })

  it('email wins over name and never links one roster user twice', () => {
    // Shape of a live case: cleaner "Roxana Pavon" carries the email of the
    // roster member named "Claudia Pavon"; cleaner "Claudia Pavon" has another.
    const p = planCleanerSync(
      [member({ user_id: 'u-claudia', name: 'Claudia Pavon', email: 'shared@x.com' })],
      [cleaner({ id: 'c-claudia', full_name: 'Claudia Pavon', email: 'own@x.com' }),
        cleaner({ id: 'c-roxana', full_name: 'Roxana Pavon', email: 'shared@x.com' })],
      { autoCreate: false },
    )
    expect(p.links).toEqual([{ cleaner_id: 'c-roxana', user_id: 'u-claudia', via: 'email' }])
    expect(p.skipped).toContainEqual(expect.objectContaining({ cleaner_id: 'c-claudia', reason: 'name_member_already_linked' }))
  })

  it('links by exact normalized name only when unique and eligible', () => {
    const p = planCleanerSync(
      [member({ user_id: 'u1', name: 'Justin Henríquez' }),
        member({ user_id: 'u2', name: 'Andrea Garcia', role: 'ADMIN', departments: ['Front Office'] })],
      [cleaner({ id: 'c1', full_name: 'justin henriquez' }), cleaner({ id: 'c2', full_name: 'Andrea Garcia' })],
      { autoCreate: false },
    )
    expect(p.links).toEqual([{ cleaner_id: 'c1', user_id: 'u1', via: 'name' }])
  })

  it('never links to the vendor account or AI agent by email', () => {
    const p = planCleanerSync(
      [member({ user_id: 'v', name: 'Tendwell Cleaning Co.', email: 'vendor@x.com' })],
      [cleaner({ id: 'c', full_name: 'Office', email: 'vendor@x.com' })],
      { autoCreate: true },
    )
    expect(p.links).toEqual([])
    expect(p.creates).toEqual([])
  })

  it('auto-create is gated and skips duplicates, dismissed and similar names', () => {
    const roster = [
      member({ user_id: 'u1', name: 'Alejandra Ruiz', email: 'a@x.com' }),
      member({ user_id: 'u2', name: 'Yeimi Munguia' }),
      member({ user_id: 'u3', name: 'Yeymi munguia' }),
      member({ user_id: 'u4', name: 'Belsi Diaz' }),
      member({ user_id: 'u5', name: 'Gabriela Velasquez', is_active: false }),
      member({ user_id: 'u6', name: 'Saira Vega' }),
      member({ user_id: 'u7', name: 'Ghost Person', last_seen_at: '2026-08-01T00:00:00Z' }),
    ]
    const cleaners = [cleaner({ id: 'c', full_name: 'Saira  Vega ', trellis_user_id: 'other' })]
    expect(planCleanerSync(roster, cleaners, { autoCreate: false, now: NOW }).creates).toEqual([])
    const p = planCleanerSync(roster, cleaners, { autoCreate: true, dismissedUserIds: new Set(['u4']), now: NOW })
    expect(p.creates).toEqual([{ user_id: 'u1', full_name: 'Alejandra Ruiz', email: 'a@x.com' }])
    expect(p.skipped.map(s => s.reason).sort()).toEqual(
      ['dismissed', 'not_seen_recently', 'possible_duplicate_member', 'possible_duplicate_member', 'similar_cleaner_exists'].sort())
  })

  it('creates the live account when its look-alike stopped appearing in Trellis', () => {
    const roster = [
      member({ user_id: 'new', name: 'Yeimi Munguia', email: 'new@x.com' }),
      member({ user_id: 'old', name: 'Yeymi munguia', email: 'old@x.com', last_seen_at: '2026-10-02T03:00:00Z' }),
    ]
    const p = planCleanerSync(roster, [], { autoCreate: true, now: NOW })
    expect(p.creates).toEqual([{ user_id: 'new', full_name: 'Yeimi Munguia', email: 'new@x.com' }])
    expect(p.skipped).toEqual([{ user_id: 'old', name: 'Yeymi munguia', reason: 'not_seen_recently' }])
  })

  it('offboards linked cleaners whose roster row went inactive and only reactivates sync offboards', () => {
    const roster = [member({ user_id: 'gone', is_active: false }), member({ user_id: 'back' }), member({ user_id: 'manual' })]
    const p = planCleanerSync(roster, [
      cleaner({ id: 'c-gone', full_name: 'A', trellis_user_id: 'gone' }),
      cleaner({ id: 'c-back', full_name: 'B', trellis_user_id: 'back', status: 'offboarded', offboarded_by: SYNC_OFFBOARDED_BY }),
      cleaner({ id: 'c-manual', full_name: 'C', trellis_user_id: 'manual', status: 'offboarded', offboarded_by: 'Jordan' }),
    ], { autoCreate: false })
    expect(p.offboard).toEqual(['c-gone'])
    expect(p.reactivate).toEqual(['c-back'])
  })
})

describe('reviewRow', () => {
  const at = '2026-10-14T00:00:00.000Z'
  it('maps a review with its reservation and keeps ratings on their own scale', () => {
    const row = reviewRow({
      id: 'r1', overall_rating: 4.5, max_rating: 5, normalized_rating: 0.9, content: ' Great ', title: null,
      host_response: null, source: 'BOOKING', reviewer_name: 'Guest A', review_date: '2026-10-13T15:20:46+00:00',
      property_id: 'p1', property_name: 'Prop', category_ratings: { cleanliness: 3.75, staff: 5 }, reservation_id: 'res1',
      reservation: { guest_name: 'Guest A B', checkin_date: '2026-10-09', checkout_date: '2026-10-13', total: 999 },
    }, 'B', at)
    expect(row).toEqual({
      trellis_review_id: 'r1', workspace: 'B', trellis_property_id: 'p1', property_name: 'Prop', reservation_id: 'res1',
      checkin_date: '2026-10-09', checkout_date: '2026-10-13', guest_name: 'Guest A B', reviewer_name: 'Guest A',
      overall_rating: 4.5, max_rating: 5, normalized_rating: 0.9, cleanliness_rating: 3.75,
      category_ratings: { cleanliness: 3.75, staff: 5 }, content: 'Great', title: null, source: 'BOOKING',
      review_date: '2026-10-13T15:20:46+00:00', host_response_status: 'none', synced_at: at,
    })
    expect(JSON.stringify(row)).not.toContain('999') // no amounts
  })
  it('derives normalized_rating, tolerates missing parts, rejects id-less rows', () => {
    const row = reviewRow({ id: 'r2', overall_rating: 8, max_rating: 10, host_response: 'Thanks!' }, 'B', at)!
    expect(row.normalized_rating).toBe(0.8)
    expect(row.cleanliness_rating).toBeNull()
    expect(row.checkin_date).toBeNull()
    expect(row.host_response_status).toBe('responded')
    expect(reviewRow({ overall_rating: 5 }, 'B', at)).toBeNull()
  })
})

describe('pickRatedClean', () => {
  const c = (id: string, date: string, extra: Partial<{ completed_at: string; prop: string; is_tendwell: boolean }> = {}) => ({
    trellis_task_id: id, trellis_property_id: extra.prop ?? 'P', scheduled_date: date,
    completed_at: extra.completed_at ?? null, is_tendwell: extra.is_tendwell ?? true,
  })
  const cleans = [
    c('old', '2026-09-01'), c('d1', '2026-09-20'), c('d2', '2026-09-25', { is_tendwell: false }),
    c('same-a', '2026-09-28', { completed_at: '2026-09-28T15:00:00Z' }),
    c('same-b', '2026-09-28', { completed_at: '2026-09-28T18:00:00Z' }),
    c('after', '2026-09-30'), c('other', '2026-09-27', { prop: 'Q' }),
  ]
  it('takes the last clean by anyone on/before the anchor', () => {
    expect(pickRatedClean(cleans, 'P', '2026-09-26')?.trellis_task_id).toBe('d2')
    expect(pickRatedClean(cleans, 'P', '2026-09-26')?.is_tendwell).toBe(false)
  })
  it('includes a clean on the anchor day; latest completion wins a tie', () => {
    expect(pickRatedClean(cleans, 'P', '2026-09-28')?.trellis_task_id).toBe('same-b')
  })
  it('respects the 14-day window and the property', () => {
    expect(pickRatedClean(cleans, 'P', '2026-09-16')).toBeNull() // 2026-09-01 is 15 days back
    expect(pickRatedClean(cleans, 'P', '2026-09-15')?.trellis_task_id).toBe('old')
    expect(pickRatedClean(cleans, 'Q', '2026-09-28')?.trellis_task_id).toBe('other')
    expect(pickRatedClean(cleans, 'P', null)).toBeNull()
  })
})
