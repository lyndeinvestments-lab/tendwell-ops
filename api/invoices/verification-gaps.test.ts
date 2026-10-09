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

  it('Trip Fee and mailed left items need the same detail as a reimbursement', () => {
    expect(DETAIL_REQUIRED_SERVICES).toEqual(expect.arrayContaining(['Reimbursement', 'Trip Fee', 'Mailed Left Items by the Guest']))
  })
})
