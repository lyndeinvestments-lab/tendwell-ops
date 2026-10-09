import { describe, it, expect } from 'vitest'
import {
  DISAPPEARED_STATUS,
  buildPropertyMatcherFrom,
  countRowsInWindow,
  disappearanceLimit,
  isMissingSchemaError,
  normalizePropertyName,
  parseFullExportRequest,
  planDisappearances,
} from './breezeway-import.js'
import { DISAPPEARED_TASK_STATUS } from '../../shared/aux-tasks.js'

// This matcher runs over every row of every daily import (~2,600 rows/day), so
// a regression here silently unlinks tasks from properties — and a task with
// property_id NULL is invisible to invoicing's reconciliation and to the
// per-property coverage panel.

describe('normalizePropertyName', () => {
  it('matches Ops and Breezeway across the WTN → CTN rename', () => {
    // The CTN group was renamed from WTN. Breezeway exports still say WTN.
    // Real case: "WTN-Engle Town 3030" imported with property_id NULL against
    // the Ops row "CTN Engle Town 3030".
    expect(normalizePropertyName('WTN-Engle Town 3030')).toBe(normalizePropertyName('CTN Engle Town 3030'))
    expect(normalizePropertyName('WTN-Pine Top 820')).toBe(normalizePropertyName('CTN-Pine Top 820'))
    expect(normalizePropertyName('Wtn-mountain View')).toBe(normalizePropertyName('CTN-Mountain View'))
    expect(normalizePropertyName('WTN-Rebel Hill 1644')).toBe(normalizePropertyName('CTN-Rebel Hill 1644'))
  })

  it('collapses the separator styles Ops actually uses', () => {
    // Live data has all three: "CTN - X", "CTN X", "CTN-X".
    const a = normalizePropertyName('CTN - Tunnel Ridge 208')
    expect(normalizePropertyName('CTN-Tunnel Ridge 208')).toBe(a)
    expect(normalizePropertyName('CTN Tunnel Ridge 208')).toBe(a)
  })

  it('only rewrites a LEADING wtn token', () => {
    // A name that merely contains the letters must not be mangled.
    expect(normalizePropertyName('Newtn Ridge')).toBe('newtn ridge')
    expect(normalizePropertyName('Smith WTN Cabin')).toBe('smith wtn cabin')
    // ...and not a longer word that happens to start with wtn.
    expect(normalizePropertyName('Wtnsomething 4')).toBe('wtnsomething 4')
  })

  it('does not conflate distinct properties', () => {
    // The rename must not make different cabins look identical.
    expect(normalizePropertyName('CTN-Pine Top 820')).not.toBe(normalizePropertyName('CTN-Pine Top 830'))
    expect(normalizePropertyName('CTN-Black Bear Cub')).not.toBe(normalizePropertyName('Wtn Black Bear 1012'))
  })

  it('is case- and whitespace-insensitive', () => {
    expect(normalizePropertyName('  CTN-Loafers   Glory  ')).toBe('ctn loafers glory')
  })

  it('handles empty and punctuation-only input', () => {
    expect(normalizePropertyName('')).toBe('')
    expect(normalizePropertyName(' --- ')).toBe('')
  })
})

describe('buildPropertyMatcherFrom — never guesses between units', () => {
  const rows = [
    { id: 31, name: 'Eric Fleming 1260', address: '1260 Ski View Dr Apt 6203, Gatlinburg, TN 37738' },
    { id: 285, name: 'Stephanie Keegan 1260-1306', address: '1260 Ski View Dr #1306, Gatlinburg, TN 37738' },
    { id: 286, name: 'Stephanie Keegan 1260-5307', address: '1260 Ski View Dr #5307, Gatlinburg, TN 37738' },
    { id: 327, name: 'Mike Gunter 2691-8', address: '2691 Jessie Rd, Sevierville, TN 37876' },
    { id: 380, name: 'Lewis Anderson 2691', address: '2691 Jessie Rd Unit 7, Sevierville, TN 37876' },
  ]
  const m = buildPropertyMatcherFrom(rows)

  it('a unit-less address shared by several units resolves to nobody', () => {
    expect(m.byAddress('1260 Ski View Drive')).toBeNull()
  })
  it('the Breezeway name with a unit suffix still finds the Ops name by unique prefix', () => {
    expect(m.byName('Eric Fleming 1260-6203')).toBe(31)
  })
  it('Mike Gunter 2691-8 matches by exact name, never Lewis Anderson 2691', () => {
    expect(m.byName('Mike Gunter 2691-8')).toBe(327)
  })
  it('an exact unique address still matches', () => {
    expect(m.byAddress('1260 Ski View Dr #5307, Gatlinburg, TN 37738')).toBe(286)
  })
})

// ─── Full-export mode (tasks that disappeared from Breezeway) ───────────────

describe('parseFullExportRequest', () => {
  it('is off unless full_export is explicitly set: the daily import never marks anything', () => {
    expect(parseFullExportRequest({})).toEqual({ request: null })
    expect(parseFullExportRequest({ source: 'current_month' })).toEqual({ request: null })
    expect(parseFullExportRequest({ full_export: 'false', window_start: '2026-10-01', window_end: '2026-10-31' })).toEqual({ request: null })
  })

  it('needs a valid, ordered window of at most 93 days', () => {
    expect(parseFullExportRequest({ full_export: 'true' }).error).toMatch(/window_start/)
    expect(parseFullExportRequest({ full_export: 'true', window_start: '10/01/2026', window_end: '2026-10-31' }).error).toMatch(/YYYY-MM-DD/)
    expect(parseFullExportRequest({ full_export: 'true', window_start: '2026-10-31', window_end: '2026-10-01' }).error).toMatch(/after/)
    expect(parseFullExportRequest({ full_export: '1', window_start: '2025-10-01', window_end: '2026-10-31' }).error).toMatch(/maximum/)
  })

  it('reads query strings, arrays and JSON booleans, force defaulting to false', () => {
    expect(parseFullExportRequest({ full_export: 'true', window_start: '2026-10-01', window_end: '2026-10-31' }))
      .toEqual({ request: { start: '2026-10-01', end: '2026-10-31', force: false } })
    expect(parseFullExportRequest({ full_export: ['1'], window_start: ['2026-10-01'], window_end: ['2026-11-30'], force: 'yes' }))
      .toEqual({ request: { start: '2026-10-01', end: '2026-11-30', force: true } })
    expect(parseFullExportRequest({ full_export: true, window_start: '2026-10-01', window_end: '2026-10-01', force: true }).request?.force).toBe(true)
  })
})

describe('disappearanceLimit', () => {
  it('is 25% of the window or 50 tasks, whichever is smaller', () => {
    expect(disappearanceLimit(0)).toBe(0)
    expect(disappearanceLimit(7)).toBe(1)
    expect(disappearanceLimit(100)).toBe(25)
    expect(disappearanceLimit(200)).toBe(50)
    expect(disappearanceLimit(2600)).toBe(50)
  })
})

describe('planDisappearances', () => {
  const window = (n: number, status: string | null = 'Closed') =>
    Array.from({ length: n }, (_, i) => ({ external_id: `t${i}`, status }))

  it('marks only live window tasks missing from the export', () => {
    const existing = [...window(8), { external_id: 'gone', status: DISAPPEARED_STATUS }, { external_id: 'cx', status: 'Cancelled' }]
    const plan = planDisappearances(existing, new Set(['t0', 't1', 't2', 't3', 't4', 't5', 't6']), false)
    expect(plan.windowCount).toBe(8)
    expect(plan.toMark.map(t => t.external_id)).toEqual(['t7'])
    expect(plan.limit).toBe(2)
    expect(plan.refused).toBe(false)
  })

  it('refuses past the limit unless forced', () => {
    const existing = window(100)
    const present = new Set(existing.slice(0, 70).map(t => t.external_id)) // 30 missing > 25
    expect(planDisappearances(existing, present, false).refused).toBe(true)
    const forced = planDisappearances(existing, present, true)
    expect(forced.refused).toBe(false)
    expect(forced.toMark).toHaveLength(30)
  })

  it('never lets more than 50 through without force, even on a big window', () => {
    const existing = window(1000)
    const present = new Set(existing.slice(0, 949).map(t => t.external_id)) // 51 missing, 5.1%
    expect(planDisappearances(existing, present, false).refused).toBe(true)
  })

  it('a complete export marks nothing', () => {
    const existing = window(40)
    const plan = planDisappearances(existing, new Set(existing.map(t => t.external_id)), false)
    expect(plan.toMark).toEqual([])
    expect(plan.refused).toBe(false)
  })
})

describe('full-export helpers', () => {
  it('counts CSV rows inside the window, inclusive', () => {
    const rows = [{ due_date: '2026-09-30' }, { due_date: '2026-10-01' }, { due_date: '2026-10-31' }, { due_date: '2026-11-01' }, { due_date: null }]
    expect(countRowsInWindow(rows, '2026-10-01', '2026-10-31')).toBe(2)
    expect(countRowsInWindow(rows, '2027-01-01', '2027-01-31')).toBe(0)
  })

  it('recognises a not-yet-applied migration so the import degrades to a normal one', () => {
    expect(isMissingSchemaError({ code: '42703', message: 'column breezeway_tasks.disappeared_at does not exist' })).toBe(true)
    expect(isMissingSchemaError({ code: 'PGRST204', message: "Could not find the 'disappeared_at' column" })).toBe(true)
    expect(isMissingSchemaError({ code: '42P01' })).toBe(true)
    expect(isMissingSchemaError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false)
    expect(isMissingSchemaError(null)).toBe(false)
  })

  it('writes the same status the invoicing engine treats as cancelled', () => {
    expect(DISAPPEARED_STATUS).toBe(DISAPPEARED_TASK_STATUS)
  })
})
