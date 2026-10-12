import { describe, expect, it } from 'vitest'
import {
  buildServiceDetail,
  toIso,
  dayRelationLabel,
  headlineFor,
  redactCodes,
  stayContext,
  type StayInput,
  type TaskInput,
} from './service-detail'

const task = (over: Partial<TaskInput> = {}): TaskInput => ({
  source: 'trellis',
  ref: 't1',
  title: 'Reset Lockbox',
  description: 'Please reset the lockbox code 7928.',
  department: 'Runner',
  priority: 'URGENT',
  status: 'COMPLETED',
  requestedAt: '2026-10-09T16:48:22Z',
  requestedDate: null,
  scheduledDate: '2026-10-09',
  scheduledTime: null,
  completedAt: '2026-10-10T03:13:19Z',
  completedDate: null,
  doneBy: ['Runner One'],
  checklistTotal: 0,
  checklistCompleted: 0,
  linkedIssueCount: 0,
  noCharge: false,
  reservationId: 'r-prev',
  ...over,
})

const stay = (id: string, checkin: string, checkout: string, over: Partial<StayInput> = {}): StayInput => ({
  reservationId: id, guestName: `Guest ${id}`, checkin, checkout, channel: 'AIRBNB', ownerBlock: false, status: 'CONFIRMED', ...over,
})

describe('redactCodes', () => {
  it.each([
    ['Please reset the lockbox code 7928.', 'Please reset the lockbox code ••••.'],
    ['gate code is #4521 then left', 'gate code is •••• then left'],
    ['Door: 12-34', 'Door: ••••'],
    ['keypad 123456', 'keypad ••••'],
    ['wifi password: Smoky123, router upstairs', 'wifi password: ••••, router upstairs'],
    ['new passcode 4471', 'new passcode ••••'],
    ['codes 1234 and garage 9876', 'codes •••• and garage ••••'],
  ])('masks %s', (input, expected) => {
    expect(redactCodes(input)).toBe(expected)
  })

  it.each([
    'Refresh hot tub, guest says water is cloudy',
    'Deliver 2 extra towels to unit 3002',
    'Trash pickup, 6 bags at the curb',
  ])('leaves ordinary text alone: %s', text => {
    expect(redactCodes(text)).toBe(text)
  })

  it('passes null through', () => {
    expect(redactCodes(null)).toBeNull()
  })
})

describe('headlineFor', () => {
  it('turns the description into a code-free clause', () => {
    expect(headlineFor(task())).toBe('Reset the lockbox code ••••')
  })

  it('uses only the first sentence', () => {
    expect(headlineFor(task({ description: 'Guest reports hot tub is green. Refresh before 4pm.' }))).toBe('Guest reports hot tub is green')
  })

  it('drops "could someone please"', () => {
    expect(headlineFor(task({ description: 'Could someone please bring 4 bath towels' }))).toBe('Bring 4 bath towels')
  })

  it('falls back to the title, then the service type', () => {
    expect(headlineFor(task({ description: null }))).toBe('Reset Lockbox')
    expect(headlineFor(null, 'Trip Fee')).toBe('Trip Fee')
  })

  it('caps long descriptions', () => {
    const h = headlineFor(task({ description: 'x'.repeat(200) }))!
    expect(h.length).toBeLessThanOrEqual(90)
    expect(h.endsWith('…')).toBe(true)
  })
})

describe('stayContext', () => {
  const stays = [stay('a', '2026-10-02', '2026-10-04'), stay('b', '2026-10-11', '2026-10-14')]

  it('vacant between stays, with last-out and next-in', () => {
    const c = stayContext('2026-10-09', stays)
    expect(c.dayRelation).toBe('vacant')
    expect(c.lastOut?.reservationId).toBe('a')
    expect(c.nextIn?.reservationId).toBe('b')
  })

  it('mid-stay', () => {
    expect(stayContext('2026-10-12', stays)).toMatchObject({ dayRelation: 'mid_stay', onSite: { reservationId: 'b' } })
  })

  it('checkout day and check-in day', () => {
    expect(stayContext('2026-10-04', stays).dayRelation).toBe('checkout_day')
    expect(stayContext('2026-10-11', stays).dayRelation).toBe('checkin_day')
  })

  it('turnover day', () => {
    expect(stayContext('2026-10-04', [...stays, stay('c', '2026-10-04', '2026-10-06')]).dayRelation).toBe('turnover_day')
  })

  it('no reservation data is unknown, never vacant', () => {
    expect(stayContext('2026-10-09', []).dayRelation).toBe('unknown')
  })

  it('ignores cancelled stays', () => {
    expect(stayContext('2026-10-12', [stay('x', '2026-10-11', '2026-10-14', { status: 'CANCELLED' })]).dayRelation).toBe('unknown')
  })
})

describe('buildServiceDetail', () => {
  const base = { serviceType: 'Trip Fee', serviceDate: '2026-10-09', clientCharge: 50, expectsTask: true, isExtra: true, fromTrellisTwin: false, linkedStay: null }

  it('line 679: headline, masked description, vacant day, no warnings', () => {
    const d = buildServiceDetail({ ...base, task: task(), stays: [stay('r-prev', '2026-10-02', '2026-10-04')] })
    expect(d.headline).toBe('Reset the lockbox code ••••')
    expect(d.task?.description).toBe('Please reset the lockbox code ••••.')
    expect(d.dayRelation).toBe('vacant')
    expect(d.warnings).toEqual([])
  })

  it('never leaks a code through the title either', () => {
    const d = buildServiceDetail({ ...base, task: task({ title: 'Lockbox code 5521 reset', description: null }), stays: [] })
    expect(JSON.stringify(d)).not.toContain('5521')
  })

  it('warns on a charged no-charge task', () => {
    const d = buildServiceDetail({ ...base, task: task({ noCharge: true }), stays: [] })
    expect(d.warnings).toContain('Trellis marks this task "no charge", but the client is charged')
  })

  it('warns when the task is not completed', () => {
    expect(buildServiceDetail({ ...base, task: task({ status: 'IN_PROGRESS' }), stays: [] }).warnings)
      .toContain('Task status is in_progress, not completed')
  })

  it('warns on a charged task with no description', () => {
    expect(buildServiceDetail({ ...base, task: task({ description: null }), stays: [] }).warnings)
      .toContain('The task has no description: nothing says why this was needed')
  })

  it('no description warning for a regular clean, or before the detail sync ran', () => {
    expect(buildServiceDetail({ ...base, isExtra: false, task: task({ description: null }), stays: [] }).warnings).toEqual([])
    expect(buildServiceDetail({ ...base, task: task({ description: null, requestedAt: null }), stays: [] }).warnings).toEqual([])
  })

  it('no description warning for the onboarding fee', () => {
    expect(buildServiceDetail({ ...base, serviceType: 'Onboarding Clean', task: task({ description: null }), stays: [] }).warnings).toEqual([])
  })

  it('warns when the matched task is gone', () => {
    expect(buildServiceDetail({ ...base, task: null, stays: [] }).warnings)
      .toContain('The matched task is no longer in the synced task data')
  })

  it('warns on a Breezeway row with no Trellis twin', () => {
    const d = buildServiceDetail({ ...base, task: task({ source: 'breezeway', description: null }), stays: [] })
    expect(d.warnings).toContain('Only the Breezeway export row was found: no description or request time')
  })

  it('keeps an unfinished checklist as a fact, not a warning', () => {
    const d = buildServiceDetail({ ...base, task: task({ checklistTotal: 20, checklistCompleted: 17 }), stays: [] })
    expect(d.warnings).toEqual([])
    expect(d.task).toMatchObject({ checklistTotal: 20, checklistCompleted: 17 })
  })

  it('normalizes timestamps to strict ISO', () => {
    const d = buildServiceDetail({ ...base, task: task({ requestedAt: '2026-10-09 16:48:22.350000+00:00' }), stays: [] })
    expect(d.task?.requestedAt).toBe('2026-10-09T16:48:22.350Z')
  })
})

describe('dayRelationLabel', () => {
  it('reads naturally', () => {
    expect(dayRelationLabel({ dayRelation: 'mid_stay', onSite: stay('b', '2026-10-11', '2026-10-14') })).toBe("During Guest b's stay")
    expect(dayRelationLabel({ dayRelation: 'mid_stay', onSite: stay('o', '2026-10-11', '2026-10-14', { ownerBlock: true }) })).toBe('During an owner stay')
    expect(dayRelationLabel({ dayRelation: 'vacant', onSite: null })).toBe('Vacant that day')
    expect(dayRelationLabel({ dayRelation: 'unknown', onSite: null })).toBeNull()
  })
})

describe('toIso', () => {
  it('handles both forms and junk', () => {
    expect(toIso('2026-10-10T03:13:19+00:00')).toBe('2026-10-10T03:13:19.000Z')
    expect(toIso('2026-10-10 03:13:19+00:00')).toBe('2026-10-10T03:13:19.000Z')
    expect(toIso('nope')).toBeNull()
    expect(toIso(null)).toBeNull()
  })
})
