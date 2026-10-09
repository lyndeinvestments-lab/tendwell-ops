import { describe, expect, it } from 'vitest'
import { FLAGS, findRedoAfterClean, reconcile, type EngineInput, type PropertyRates, type RawLine, type TaskRow } from './_engine.js'
import { buildEngineTasks } from './_lib.js'
import { undecidedRedoLines } from './approve.js'

const P: PropertyRates[] = [
  { id: 50, name: 'Kim Mills 2222', ceCharged: 175, cleanerPay: 90, deepClean3xCe: null, billingChannel: 'qbo_haven' },
  { id: 60, name: 'Daryl Nelson 159', ceCharged: 600, cleanerPay: 350, deepClean3xCe: null, billingChannel: 'qbo_haven' },
]
const clean = (id: string, pid: number, d: string): TaskRow =>
  ({ externalId: id, propertyId: pid, dueDate: d, title: 'Turn Clean', isClean: true, isDeepClean: false, totalCostRef: null, completed: true, source: 'breezeway' })
const redo = (id: string, pid: number, d: string, title = 'Cleaner Callback', source: 'breezeway' | 'trellis' = 'breezeway'): TaskRow =>
  ({ externalId: id, propertyId: pid, dueDate: d, title, isClean: false, isDeepClean: false, totalCostRef: null, completed: false, source })
const line = (lineNo: number, prop: string, d: string, amt: number): RawLine =>
  ({ lineNo, source: 'vendor', rawPropertyText: prop, rawNoteText: null, rawAmount: amt, rawDateMentioned: d })
const run = (lines: RawLine[], tasks: TaskRow[], extra: Partial<EngineInput> = {}) =>
  reconcile({ vendorId: 'busybee', lines, aliases: [], properties: P, tasks, periodStart: '2026-10-01', periodEnd: '2026-10-07', ...extra })

describe('findRedoAfterClean', () => {
  const redos = [redo('same', 50, '2026-10-01'), redo('d7', 50, '2026-10-08'), redo('d8', 50, '2026-10-09'), redo('before', 50, '2026-09-30')]

  it('matches on the clean day and up to 7 days after, never before or past day 7', () => {
    expect(findRedoAfterClean(50, '2026-10-01', redos)?.externalId).toBe('same')
    expect(findRedoAfterClean(50, '2026-10-01', [redos[1]])?.externalId).toBe('d7')
    expect(findRedoAfterClean(50, '2026-10-01', [redos[2]])).toBeNull()
    expect(findRedoAfterClean(50, '2026-10-01', [redos[3]])).toBeNull()
  })

  it('ignores other properties', () => {
    expect(findRedoAfterClean(60, '2026-10-01', redos)).toBeNull()
  })

  it('a redo after a later clean belongs to that later clean', () => {
    const r = [redo('cb', 50, '2026-10-05')]
    expect(findRedoAfterClean(50, '2026-10-01', r, ['2026-10-01', '2026-10-04'])).toBeNull()
    expect(findRedoAfterClean(50, '2026-10-04', r, ['2026-10-01', '2026-10-04'])?.externalId).toBe('cb')
  })
})

describe('reconcile: redo_pending', () => {
  it('flags a billed clean followed by a callback, with the task and date in the note', () => {
    const { lines } = run(
      [line(1, 'Kim Mills 2222', '2026-10-02', 90)],
      [clean('c1', 50, '2026-10-02')],
      { redoTasks: [redo('cb1', 50, '2026-10-04', 'Cleaner callback needed today - bathrooms')] },
    )
    expect(lines[0].flags).toContain(FLAGS.REDO_PENDING)
    expect(lines[0].reviewStatus).toBe('needs_review')
    expect(lines[0].engineNote).toContain('Cleaner callback needed today - bathrooms')
    expect(lines[0].engineNote).toContain('2026-10-04')
    // The money is untouched: the decision is the reviewer's.
    expect(lines[0].clientChargeAmount).toBe(175)
  })

  it('leaves the line alone with no redo, a redo elsewhere, or no redo data at all', () => {
    for (const extra of [{}, { redoTasks: [] }, { redoTasks: [redo('x', 60, '2026-10-03')] }, { redoTasks: [redo('late', 50, '2026-10-12')] }]) {
      const { lines } = run([line(1, 'Kim Mills 2222', '2026-10-02', 90)], [clean('c1', 50, '2026-10-02')], extra)
      expect(lines[0].flags).not.toContain(FLAGS.REDO_PENDING)
      expect(lines[0].reviewStatus).toBe('ok')
    }
  })

  it('flags only the base row of a split clean', () => {
    const { lines } = run(
      [{ ...line(1, 'Kim Mills 2222', '2026-10-02', 120), rawNoteText: 'turn clean plus hot tub refresh' }],
      [clean('c1', 50, '2026-10-02')],
      { redoTasks: [redo('cb1', 50, '2026-10-02')] },
    )
    const base = lines.find(l => l.lineKind === 'combined_split')!
    const extra = lines.find(l => l.lineKind === 'extra')!
    expect(base.flags).toContain(FLAGS.REDO_PENDING)
    expect(extra.flags).not.toContain(FLAGS.REDO_PENDING)
  })
})

describe('buildEngineTasks: redo pool and disappeared tasks', () => {
  const bw = (id: string, title: string, due: string, status: string, completed: string | null = null) => ({
    external_id: id, property_id: 50, due_date: due, task_title: title,
    is_clean: /clean/i.test(title), is_deep_clean: false, raw: null, status, completed_date: completed,
  })

  it('collects Breezeway and Trellis callbacks and never counts them as cleans', () => {
    const r = buildEngineTasks(
      [bw('cb', 'Cleaner Callback', '2026-10-03', 'Created'), bw('rc', 'Re-clean Turn Clean', '2026-10-04', 'Closed', '2026-10-04')],
      [{ trellis_task_id: 't1', trellis_property_id: 'tr-50', title: 'Cleaner: Callback', status: 'SCHEDULED', scheduled_date: '2026-10-05', completed_at: null }],
      new Map([['tr-50', 50]]),
    )
    expect(r.redoTasks.map(t => t.externalId).sort()).toEqual(['cb', 'rc', 'trellis:t1'])
    expect(r.tasks.find(t => t.externalId === 'rc')?.isClean).toBe(false)
  })

  it('a deleted_or_canceled task is neither clean evidence nor a redo', () => {
    const r = buildEngineTasks(
      [bw('gone', 'Turn Clean', '2026-10-02', 'deleted_or_canceled', '2026-10-02'), bw('gonecb', 'Cleaner Callback', '2026-10-03', 'deleted_or_canceled')],
      [],
      new Map(),
    )
    expect(r.tasks).toHaveLength(0)
    expect(r.redoTasks).toHaveLength(0)
  })
})

describe('approve: undecidedRedoLines', () => {
  const row = (line_no: number, over: Record<string, unknown> = {}) => ({
    line_no, raw_property_text: 'Kim Mills 2222', raw_amount: 90,
    flags: [FLAGS.REDO_PENDING], review_status: 'resolved', line_kind: 'clean', review_note: null as string | null, client_charge_amount: 175,
    ...over,
  })

  it('blocks unresolved and decision-less lines, reporting a split line once', () => {
    const out = undecidedRedoLines([
      row(1, { review_status: 'needs_review' }),
      row(2),
      row(2, { line_kind: 'extra' }),
      row(3, { review_note: '[redo: bill]' }),
      row(4, { review_note: '[redo: no charge]', client_charge_amount: 0 }),
      row(5, { review_note: '[redo: no charge]' }),
    ])
    expect(out.map(r => r.line_no)).toEqual([1, 2, 5])
    expect(out[0]).toEqual({ line_no: 1, raw_property_text: 'Kim Mills 2222', raw_amount: 90 })
  })
})
