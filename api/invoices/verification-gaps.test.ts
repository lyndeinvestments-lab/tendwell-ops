import { describe, expect, it } from 'vitest'
import { buildEngineTasks } from './_lib.js'
import { DETAIL_REQUIRED_SERVICES, vendorInvoicedSum } from './approve.js'

describe('buildEngineTasks — Trellis coverage', () => {
  const byTrellis = new Map([['tr-4159', 4159]])
  const bw = (due: string) => ({
    external_id: `bw-${due}`, property_id: 4159, due_date: due, task_title: 'Departure Clean',
    is_clean: true, is_deep_clean: false, raw: null, status: 'Closed', completed_date: due,
  })
  const tr = (id: string, title: string, date: string, status: string) => ({
    trellis_task_id: id, trellis_property_id: 'tr-4159', title, status, scheduled_date: date, completed_at: status === 'COMPLETED' ? date : null,
  })

  it('records Trellis completed cleans even on days Breezeway wins the evidence pool', () => {
    const r = buildEngineTasks([bw('2026-10-01')], [tr('a', 'Departure Clean', '2026-10-01', 'COMPLETED')], byTrellis)
    expect(r.trellisTasks).toHaveLength(0)
    expect(r.trellisCoverage.doneCleanDays.has('4159|2026-10-01')).toBe(true)
  })

  it('an inspection marks the property as Trellis-run but is not a completed clean', () => {
    const r = buildEngineTasks([bw('2026-09-29')], [tr('i', 'Cleaner inspection — assess touch-up vs. Departure Clean', '2026-09-28', 'COMPLETED')], byTrellis)
    expect(r.trellisCoverage.taskDays.get(4159)).toEqual(['2026-09-28'])
    expect(r.trellisCoverage.doneCleanDays.size).toBe(0)
  })
})

describe('penny gate — vendor line total', () => {
  it('counts each vendor line once (split rows share it) and skips task-derived rows', () => {
    expect(vendorInvoicedSum([
      { line_no: 1, raw_amount: 290, split_group: 1, line_kind: 'clean', source: 'vendor' },
      { line_no: 1, raw_amount: 290, split_group: 1, line_kind: 'extra', source: 'vendor' },
      { line_no: 2, raw_amount: '45.10', split_group: null, line_kind: 'excluded', source: 'vendor' },
      { line_no: 3, raw_amount: 0, split_group: null, line_kind: 'extra', source: 'task' },
    ])).toBe(335.1)
  })

  it('an excluded split row never replaces the base amount, in any row order (I261012825 L445)', () => {
    const base = { line_no: 445, raw_amount: '210.84', split_group: 5, line_kind: 'excluded', source: 'vendor' }
    const surcharge = { line_no: 445, raw_amount: '0.00', split_group: 5, line_kind: 'excluded', source: 'vendor' }
    const other = { line_no: 446, raw_amount: 100, split_group: null, line_kind: 'clean', source: 'vendor' }
    expect(vendorInvoicedSum([base, surcharge, other])).toBe(310.84)
    expect(vendorInvoicedSum([surcharge, base, other])).toBe(310.84)
    // An excluded slice of a combined line (the vendor's onboarding add-on)
    // still counts once, at the base row's full amount.
    expect(vendorInvoicedSum([
      { line_no: 294, raw_amount: '49.85', split_group: 9, line_kind: 'excluded', source: 'vendor' },
      { line_no: 294, raw_amount: '221.00', split_group: 9, line_kind: 'combined_split', source: 'vendor' },
    ])).toBe(221)
  })

  it('a credit line keeps its negative amount', () => {
    expect(vendorInvoicedSum([
      { line_no: 7, raw_amount: '-35.00', split_group: null, line_kind: 'credit', source: 'vendor' },
      { line_no: 8, raw_amount: '135.00', split_group: null, line_kind: 'clean', source: 'vendor' },
    ])).toBe(100)
  })

  it('Trip Fee and mailed left items need the same detail as a reimbursement', () => {
    expect(DETAIL_REQUIRED_SERVICES).toEqual(expect.arrayContaining(['Reimbursement', 'Trip Fee', 'Mailed Left Items by the Guest']))
  })
})
