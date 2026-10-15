import { describe, expect, it } from 'vitest'
import {
  EMPTY_AUTO_FIELD,
  applyHint,
  autoField,
  cleanLabel,
  cleanerAutoFilled,
  isCleanInspectionTitle,
  prefillFromTrellisTask,
  savedField,
  taskCleanLabel,
  trellisInspectionQueue,
  userSetField,
  type TrellisInspectionTask,
} from './trellis-inspections'

function task(p: Partial<TrellisInspectionTask>): TrellisInspectionTask {
  return {
    trellis_task_id: Math.random().toString(36).slice(2),
    workspace: 'B',
    title: 'Cleaning Inspection',
    status: 'SCHEDULED',
    scheduled_date: '2026-10-10',
    completed_at: null,
    assigned_to_name: 'Inspector',
    inspector_cleaner_id: 'insp-1',
    inspector_name: 'Inés',
    property_id: 10,
    property_name: 'Cabin 10',
    trellis_property_name: 'Cabin 10',
    prev_clean_task_id: 'clean-1',
    prev_clean_date: '2026-10-08',
    prev_clean_kind: 'turn',
    prev_clean_title: 'Turn Clean',
    prev_clean_is_tendwell: true,
    prev_cleaner_id: 'cl-1',
    prev_cleaner_name: 'Ana',
    ops_inspection_id: null,
    ops_inspection_status: null,
    ops_inspected_at: null,
    ops_overall_score: null,
    ops_cleanliness_score: null,
    ...p,
  }
}

describe('isCleanInspectionTitle', () => {
  it('accepts cleaning inspections only', () => {
    for (const t of ['Cleaning Inspection', 'Turn Cleaning Inspection', 'Urgent cleaner inspection', 'clean inspection']) {
      expect(isCleanInspectionTitle(t)).toBe(true)
    }
    for (const t of ['Inspect TVs at the property', 'Maintenance: Mold Inspection', 'Runner: Odor Inspection', null, '']) {
      expect(isCleanInspectionTitle(t)).toBe(false)
    }
  })
})

describe('trellisInspectionQueue', () => {
  const today = '2026-10-14'
  it('keeps recent cleaning inspections at Ops properties, split by rating', () => {
    const rows = [
      task({ trellis_task_id: 'a', scheduled_date: '2026-10-13' }),
      task({ trellis_task_id: 'b', scheduled_date: '2026-10-14', ops_inspection_id: 'i1', ops_overall_score: 4 }),
      task({ trellis_task_id: 'future', scheduled_date: '2026-10-16' }),
      task({ trellis_task_id: 'old', scheduled_date: '2026-08-01' }),
      task({ trellis_task_id: 'maint', title: 'Maintenance: Safety Inspection' }),
      task({ trellis_task_id: 'noprop', property_id: null }),
      task({ trellis_task_id: 'cancel', status: 'CANCELLED' }),
      task({ trellis_task_id: 'c', scheduled_date: null, completed_at: '2026-10-11T15:00:00Z', status: 'COMPLETED' }),
    ]
    const q = trellisInspectionQueue(rows, today)
    expect(q.toRate.map((r) => r.trellis_task_id)).toEqual(['a', 'c'])
    expect(q.rated.map((r) => r.trellis_task_id)).toEqual(['b'])
  })
  it('respects the window', () => {
    const q = trellisInspectionQueue([task({ scheduled_date: '2026-10-01' })], today, 7)
    expect(q.toRate).toHaveLength(0)
  })
})

describe('clean labels', () => {
  it('names the cleaner, the crew, or says not Tendwell / none', () => {
    expect(taskCleanLabel(task({}))).toEqual({ kind: 'cleaner', date: '2026-10-08', cleanerName: 'Ana' })
    expect(taskCleanLabel(task({ prev_cleaner_id: null, prev_cleaner_name: null }))).toMatchObject({ kind: 'crew', date: '2026-10-08' })
    expect(taskCleanLabel(task({ prev_clean_is_tendwell: false, prev_cleaner_name: null }))).toMatchObject({ kind: 'not_tendwell' })
    expect(cleanLabel({ taskId: null, date: null, isTendwell: null, cleanerName: null }).kind).toBe('none')
  })
})

describe('prefillFromTrellisTask', () => {
  it('carries property, date, task id, inspector and previous clean', () => {
    expect(prefillFromTrellisTask(task({ trellis_task_id: 't1' }), 'me')).toEqual({
      propertyId: 10,
      date: '2026-10-10',
      trellisTaskId: 't1',
      trellisTitle: 'Cleaning Inspection',
      inspectorId: 'insp-1',
      cleanerId: 'cl-1',
      lastCleanedOn: '2026-10-08',
      ratedCleanTaskId: 'clean-1',
    })
  })
  it('falls back to the signed-in inspector and refuses rows without a property', () => {
    expect(prefillFromTrellisTask(task({ inspector_cleaner_id: null }), 'me')?.inspectorId).toBe('me')
    expect(prefillFromTrellisTask(task({ property_id: null }), 'me')).toBeNull()
  })
})

describe('cleaner prefill state', () => {
  it('fills an empty field and follows later hints while untouched', () => {
    let s = applyHint(EMPTY_AUTO_FIELD, 'cl-1')
    expect(s.value).toBe('cl-1')
    expect(cleanerAutoFilled(s)).toBe(true)
    s = applyHint(s, 'cl-2')
    expect(s.value).toBe('cl-2')
    s = applyHint(s, null)
    expect(s.value).toBeNull()
  })
  it('never refills a cleaner the user cleared', () => {
    let s = autoField('cl-1')
    s = userSetField(null)
    s = applyHint(s, 'cl-1')
    expect(s.value).toBeNull()
    expect(cleanerAutoFilled(s)).toBe(false)
  })
  it('keeps a cleaner the user picked', () => {
    const s = applyHint(userSetField('cl-9'), 'cl-1')
    expect(s.value).toBe('cl-9')
    expect(cleanerAutoFilled(s)).toBe(false)
  })
  it('treats a saved person-chosen cleaner as touched, a saved auto-filled one as auto', () => {
    expect(applyHint(savedField('cl-9'), 'cl-1').value).toBe('cl-9')
    expect(applyHint(savedField('cl-1', true), 'cl-2').value).toBe('cl-2')
    expect(applyHint(savedField(null), 'cl-2').value).toBe('cl-2')
  })
})
