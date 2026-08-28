import { describe, it, expect } from 'vitest'
import {
  isTurnOrDepartureClean,
  activationCutoff,
  qualifyingActivations,
  AUTO_ACTIVATE_LOOKBACK_DAYS,
  type PreActiveProp,
} from './_auto-stage'

const props: PreActiveProp[] = [
  { id: 1, name: 'Onboarding House', trellis_id: null, stage_id: 3 },
  { id: 2, name: 'Quote Cabin', trellis_id: 'aaaa-bbbb', stage_id: 2 },
  { id: 3, name: 'Lead Lodge', trellis_id: null, stage_id: 1 },
]

describe('isTurnOrDepartureClean', () => {
  it('matches the real title vocabulary', () => {
    expect(isTurnOrDepartureClean('Turn Clean')).toBe(true)
    expect(isTurnOrDepartureClean('Departure Clean')).toBe(true)
    expect(isTurnOrDepartureClean('Turnover clean')).toBe(true)
    expect(isTurnOrDepartureClean('TURN CLEAN — same day')).toBe(true)
  })
  it('rejects setup/maintenance work that happens during onboarding', () => {
    expect(isTurnOrDepartureClean('Deep Clean')).toBe(false)
    expect(isTurnOrDepartureClean('Onboarding Clean')).toBe(false)
    expect(isTurnOrDepartureClean('Inspection')).toBe(false)
    expect(isTurnOrDepartureClean('Air Filter Change')).toBe(false)
    // "return" must not match "turn" (word boundary)
    expect(isTurnOrDepartureClean('Return guest items')).toBe(false)
    expect(isTurnOrDepartureClean(null)).toBe(false)
    expect(isTurnOrDepartureClean('')).toBe(false)
  })
})

describe('activationCutoff', () => {
  it('is LOOKBACK days before today, as a date-only string', () => {
    const cutoff = activationCutoff(new Date('2026-08-28T12:00:00Z'))
    expect(cutoff).toBe('2026-07-29')
    expect(AUTO_ACTIVATE_LOOKBACK_DAYS).toBe(30)
  })
})

describe('qualifyingActivations', () => {
  const cutoff = '2026-07-29'

  it('recent Breezeway turn clean qualifies; stale one does not (the Dec-2025 Quote stragglers)', () => {
    const out = qualifyingActivations(
      props,
      [
        { property_id: 1, task_title: 'Turn Clean', due_date: '2026-09-01' },
        { property_id: 3, task_title: 'Turn Clean', due_date: '2025-12-05' },
      ],
      [],
      cutoff,
    )
    expect(out.get(1)).toEqual({ title: 'Turn Clean', date: '2026-09-01', source: 'Breezeway' })
    expect(out.has(3)).toBe(false)
  })

  it('Trellis tasks join via trellis_id and non-turn titles never qualify', () => {
    const out = qualifyingActivations(
      props,
      [],
      [
        { trellis_property_id: 'aaaa-bbbb', title: 'Departure Clean', scheduled_date: '2026-08-30' },
        { trellis_property_id: 'aaaa-bbbb', title: 'Deep Clean', scheduled_date: '2026-08-30' },
        { trellis_property_id: 'zzzz-none', title: 'Turn Clean', scheduled_date: '2026-08-30' },
      ],
      cutoff,
    )
    expect(out.get(2)).toEqual({ title: 'Departure Clean', date: '2026-08-30', source: 'Trellis' })
    expect(out.size).toBe(1)
  })

  it('keeps the most recent qualifying task as the evidence', () => {
    const out = qualifyingActivations(
      props,
      [
        { property_id: 1, task_title: 'Turn Clean', due_date: '2026-08-30' },
        { property_id: 1, task_title: 'Turn Clean', due_date: '2026-09-15' },
      ],
      [],
      cutoff,
    )
    expect(out.get(1)?.date).toBe('2026-09-15')
  })

  it('tasks with no date or for unknown properties are ignored', () => {
    const out = qualifyingActivations(
      props,
      [
        { property_id: 1, task_title: 'Turn Clean', due_date: null },
        { property_id: 999, task_title: 'Turn Clean', due_date: '2026-09-01' },
        { property_id: null, task_title: 'Turn Clean', due_date: '2026-09-01' },
      ],
      [],
      cutoff,
    )
    expect(out.size).toBe(0)
  })
})
