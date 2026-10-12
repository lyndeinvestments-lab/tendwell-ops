import { describe, expect, it } from 'vitest'
import { breezewayTaskInput, compactDetail, findTrellisTwin, trellisTaskInput, type TrellisTaskRow } from './_service-detail'

const tr = (id: string, title: string, status = 'COMPLETED', over: Partial<TrellisTaskRow> = {}): TrellisTaskRow => ({
  trellis_task_id: id, trellis_property_id: 'p1', title, department_name: 'Housekeeping', status, priority: null,
  assigned_to_name: 'Tendwell Cleaning Co.', scheduled_date: '2026-10-09', completed_at: null, ...over,
})

describe('findTrellisTwin', () => {
  it('matches the same title, case-insensitively', () => {
    expect(findTrellisTwin([tr('a', 'Hot Tub Refresh'), tr('b', 'Turn Clean')], 'turn clean')?.trellis_task_id).toBe('b')
  })

  it('never guesses: no exact title, no twin', () => {
    expect(findTrellisTwin([tr('a', 'Turn Clean')], 'Departure Clean')).toBeNull()
    expect(findTrellisTwin([tr('a', 'Turn Clean')], null)).toBeNull()
  })

  it('prefers a completed copy, then the lowest id', () => {
    expect(findTrellisTwin([tr('b', 'Turn Clean', 'SCHEDULED'), tr('c', 'Turn Clean'), tr('a', 'Turn Clean', 'CREATED')], 'Turn Clean')?.trellis_task_id).toBe('c')
    expect(findTrellisTwin([tr('c', 'Turn Clean'), tr('a', 'Turn Clean')], 'Turn Clean')?.trellis_task_id).toBe('a')
  })
})

describe('task inputs', () => {
  it('names the people from assignees, falling back to the assigned name', () => {
    expect(trellisTaskInput(tr('a', 'X', 'COMPLETED', { assignees: [{ assignee_name: 'Ana' }, { assignee_name: null }, { assignee_name: 'Ana' }] })).doneBy).toEqual(['Ana'])
    expect(trellisTaskInput(tr('a', 'X', 'COMPLETED', { assignees: [{ assignee_name: null }] })).doneBy).toEqual(['Tendwell Cleaning Co.'])
  })

  it('dedupes Breezeway assignee strings', () => {
    const t = breezewayTaskInput({
      external_id: 'h1', task_title: 'Turn Clean', department: 'Cleaning', priority: 'High', status: 'Closed',
      assignees: 'Crew Lead;  Vendor Co ; Crew Lead', completed_by: null, due_date: '2026-10-04', completed_date: '2026-10-04', created_date: '2026-09-12',
    })
    expect(t.doneBy).toEqual(['Crew Lead', 'Vendor Co'])
    expect(t.source).toBe('breezeway')
    expect(t.requestedDate).toBe('2026-09-12')
  })
})

describe('compactDetail', () => {
  it('drops nulls and empty arrays, keeps falsy values that mean something', () => {
    expect(compactDetail({ a: null, b: [], c: 0, d: false, e: { f: null, g: 'x' } })).toEqual({ c: 0, d: false, e: { g: 'x' } })
  })
})
