import { describe, expect, it } from 'vitest'
import { buildPortalDraft, dayKey, type DraftProperty } from './_draft.js'
import type { TaskRow } from '../invoices/_engine.js'

const PROPS = new Map<number, DraftProperty>([
  [460, { id: 460, name: 'Raman Gurai 1118', cleanerPay: 95 }],
  [25, { id: 25, name: 'Derek Trainer 1687', cleanerPay: 110 }],
  [7, { id: 7, name: 'Rateless Retreat', cleanerPay: null }],
  [8, { id: 8, name: 'Lakeside 8', cleanerPay: 120 }],
])

function task(p: Partial<TaskRow> & Pick<TaskRow, 'externalId' | 'propertyId' | 'dueDate'>): TaskRow {
  return { title: 'Turn Clean', isClean: true, isDeepClean: false, totalCostRef: null, completed: true, source: 'breezeway', ...p }
}

const base = { periodStart: '2026-10-04', periodEnd: '2026-10-10', properties: PROPS, blockedDays: new Map<string, string>() }

describe('buildPortalDraft', () => {
  it('bills a property-day once when Breezeway re-keyed the same task (Raman Gurai 1118, 10/4)', () => {
    const { lines } = buildPortalDraft({
      ...base,
      tasks: [
        task({ externalId: 'c4e2', propertyId: 460, dueDate: '2026-10-04', completedOn: '2026-10-04' }),
        task({ externalId: '62cd', propertyId: 460, dueDate: '2026-10-04', completedOn: '2026-10-04' }),
      ],
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].amount).toBe(95)
    expect(lines[0].taskIds).toEqual(['62cd', 'c4e2'])
    expect(lines[0].flags).toContain('possible_duplicate')
  })

  it('flags a task closed days before its due date (Derek Trainer 1687, 10/7)', () => {
    const { lines } = buildPortalDraft({
      ...base,
      tasks: [
        task({ externalId: 'a-early', propertyId: 25, dueDate: '2026-10-07', completedOn: '2026-10-03' }),
        task({ externalId: 'b-real', propertyId: 25, dueDate: '2026-10-07', completedOn: '2026-10-07' }),
      ],
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].flags).toEqual(expect.arrayContaining(['possible_duplicate', 'completed_off_date']))
  })

  it('never bills an open task', () => {
    const { lines } = buildPortalDraft({
      ...base,
      tasks: [task({ externalId: 'x', propertyId: 8, dueDate: '2026-10-05', completed: false })],
    })
    expect(lines).toHaveLength(0)
  })

  it('ignores inspections, tasks outside the period and tasks without a property', () => {
    const { lines } = buildPortalDraft({
      ...base,
      tasks: [
        task({ externalId: 'i', propertyId: 8, dueDate: '2026-10-05', title: 'Cleaning Inspection', isClean: false }),
        task({ externalId: 'early', propertyId: 8, dueDate: '2026-10-03' }),
        task({ externalId: 'late', propertyId: 8, dueDate: '2026-10-11' }),
        task({ externalId: 'np', propertyId: null, dueDate: '2026-10-05' }),
      ],
    })
    expect(lines).toHaveLength(0)
  })

  it('skips a day already invoiced elsewhere and says where', () => {
    const { lines, skipped } = buildPortalDraft({
      ...base,
      blockedDays: new Map([[dayKey(8, '2026-10-05'), 'invoice 1096']]),
      tasks: [task({ externalId: 'a', propertyId: 8, dueDate: '2026-10-05' }), task({ externalId: 'b', propertyId: 8, dueDate: '2026-10-06' })],
    })
    expect(lines.map(l => l.date)).toEqual(['2026-10-06'])
    expect(skipped).toEqual([expect.objectContaining({ propertyId: 8, date: '2026-10-05', reason: 'already_invoiced', ref: 'invoice 1096' })])
  })

  it('a refresh adds only property-days not already on the run', () => {
    const { lines, skipped } = buildPortalDraft({
      ...base,
      existingDays: new Set([dayKey(8, '2026-10-05')]),
      tasks: [task({ externalId: 'a', propertyId: 8, dueDate: '2026-10-05' }), task({ externalId: 'b', propertyId: 8, dueDate: '2026-10-06' })],
    })
    expect(lines.map(l => l.date)).toEqual(['2026-10-06'])
    expect(skipped).toHaveLength(0)
  })

  it('bills a same-day deep + turn pair once, as the deep clean, for review', () => {
    const { lines } = buildPortalDraft({
      ...base,
      tasks: [
        task({ externalId: 't', propertyId: 8, dueDate: '2026-10-05' }),
        task({ externalId: 'd', propertyId: 8, dueDate: '2026-10-05', title: 'Deep Clean', isClean: false, isDeepClean: true }),
      ],
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ deep: true, title: 'Deep Clean', amount: 360, taskIds: ['d', 't'] })
    expect(lines[0].flags).toContain('possible_duplicate')
  })

  it('a property with no Cleaner Pay drafts at $0 (the engine sends it to review as missing_rate)', () => {
    const { lines } = buildPortalDraft({ ...base, tasks: [task({ externalId: 'r', propertyId: 7, dueDate: '2026-10-05' })] })
    expect(lines[0].amount).toBe(0)
  })

  it('reports tasks on a property Ops does not know', () => {
    const { lines, skipped } = buildPortalDraft({ ...base, tasks: [task({ externalId: 'u', propertyId: 999, dueDate: '2026-10-05' })] })
    expect(lines).toHaveLength(0)
    expect(skipped[0].reason).toBe('unknown_property')
  })

  it('prefers the Breezeway task as the primary and orders lines by date then property', () => {
    const { lines } = buildPortalDraft({
      ...base,
      tasks: [
        task({ externalId: 'trellis:z', propertyId: 8, dueDate: '2026-10-06', source: 'trellis', title: 'Departure Clean' }),
        task({ externalId: 'bw', propertyId: 8, dueDate: '2026-10-06', title: 'Turn Clean' }),
        task({ externalId: 'early', propertyId: 25, dueDate: '2026-10-05' }),
      ],
    })
    expect(lines.map(l => `${l.propertyId}@${l.date}`)).toEqual(['25@2026-10-05', '8@2026-10-06'])
    expect(lines[1].title).toBe('Turn Clean')
  })
})

describe('what counts as a full clean', () => {
  it('never drafts vacancy cleans, touch-ups, linen pulls or inspections as cleans', async () => {
    const { isFullCleanTask } = await import('./_draft.js')
    const t = (title: string, extra: Partial<TaskRow> = {}) => ({ title, isClean: true, isDeepClean: false, ...extra })
    expect(isFullCleanTask(t('Vacancy Clean'))).toBe(false)
    expect(isFullCleanTask(t('Vacancy Clean/Touch-up Clean'))).toBe(false)
    expect(isFullCleanTask(t('Touch Up Clean'))).toBe(false)
    expect(isFullCleanTask(t('Linen Pull'))).toBe(false)
    expect(isFullCleanTask(t('Cleaner inspection — assess touch-up vs. Departure Clean'))).toBe(false)
    expect(isFullCleanTask(t('Cleaning Inspection'))).toBe(false)
    expect(isFullCleanTask(t('Departure Clean'))).toBe(true)
    expect(isFullCleanTask(t('Turn Clean'))).toBe(true)
    expect(isFullCleanTask(t('HTLR Onboarding Clean'))).toBe(true)
    expect(isFullCleanTask(t('Last Clean & Linen Pull'))).toBe(true)
    expect(isFullCleanTask(t('Post-Owner Stay Clean - HT'))).toBe(true)
    expect(isFullCleanTask(t('Deep Clean', { isClean: false, isDeepClean: true }))).toBe(true)
  })

  it('drafts only full cleans from a mixed day', () => {
    const { lines } = buildPortalDraft({
      ...base,
      tasks: [
        task({ externalId: 'v', propertyId: 8, dueDate: '2026-10-05', title: 'Vacancy Clean' }),
        task({ externalId: 'a', propertyId: 25, dueDate: '2026-10-05', title: 'Cleaner inspection — assess touch-up vs. Departure Clean' }),
      ],
    })
    expect(lines).toHaveLength(0)
  })
})

describe('one house, two Ops records', () => {
  it('flags same-address same-day cleans on different records for review (Paladino 4420 #526/#543)', () => {
    const props = new Map<number, DraftProperty>([
      [526, { id: 526, name: 'Jason and Marsha Paladino 4420', cleanerPay: 200, address: '4420 Stackstone Rd, Sevierville, TN 37862, USA' }],
      [543, { id: 543, name: 'Jason Paladino 4420', cleanerPay: 240, address: '4420 Stackstone Rd, Sevierville, TN 37862' }],
    ])
    const { lines } = buildPortalDraft({
      ...base,
      properties: props,
      tasks: [task({ externalId: 'x', propertyId: 526, dueDate: '2026-10-05' }), task({ externalId: 'y', propertyId: 543, dueDate: '2026-10-05' })],
    })
    expect(lines).toHaveLength(2)
    expect(lines.every(l => l.flags.includes('possible_duplicate'))).toBe(true)
  })

  it('does not flag different units on one lot (Land Yacht / River Nook share an address)', () => {
    const props = new Map<number, DraftProperty>([
      [650, { id: 650, name: 'Land Yacht Air Stream', cleanerPay: 40, address: '2328 Business Ctr Cir, Sevierville, TN 37876, USA' }],
      [651, { id: 651, name: 'The River Nook - Tiny Home', cleanerPay: 40, address: '2328 Business Ctr Cir, Sevierville, TN 37876, USA' }],
    ])
    const { lines } = buildPortalDraft({
      ...base,
      properties: props,
      tasks: [task({ externalId: 'x', propertyId: 650, dueDate: '2026-10-05' }), task({ externalId: 'y', propertyId: 651, dueDate: '2026-10-05' })],
    })
    expect(lines.some(l => l.flags.includes('possible_duplicate'))).toBe(false)
  })

  it('maps an archived duplicate onto its active twin (Kelly Armsworth 3634 #507 → #499)', async () => {
    const { archivedDuplicateMap } = await import('./_draft.js')
    const m = archivedDuplicateMap([
      { id: 499, trellis_id: 'T', archived_at: null },
      { id: 507, trellis_id: 'T', archived_at: '2026-09-17' },
      { id: 600, trellis_id: 'U', archived_at: '2026-01-01' },
    ])
    expect(m.get(507)).toBe(499)
    expect(m.has(499)).toBe(false)
    expect(m.has(600)).toBe(false)
  })
})
