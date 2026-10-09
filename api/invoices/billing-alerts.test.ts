import { describe, expect, it } from 'vitest'
import type { TaskRow } from './_engine.js'
import {
  daysBetween,
  findUnpaidInvoices,
  findUninvoicedCleans,
  groupUninvoicedByClient,
  isMissingSchemaError,
  lineCoversClean,
  qboNumbersOf,
  type CoverageLine,
  type UnpaidRunInput,
} from './_billing-alerts.js'

const TODAY = '2026-10-08'

const task = (over: Partial<TaskRow> = {}): TaskRow => ({
  externalId: 'bw-1',
  propertyId: 101,
  dueDate: '2026-09-30',
  title: 'Turn Clean',
  isClean: true,
  isDeepClean: false,
  totalCostRef: null,
  completed: true,
  source: 'breezeway',
  ...over,
})

const line = (over: Partial<CoverageLine> = {}): CoverageLine => ({
  propertyId: 101,
  date: '2026-09-30',
  matchedTaskId: null,
  lineKind: 'clean',
  reviewStatus: 'ok',
  runStatus: 'exported',
  runArchived: false,
  ...over,
})

describe('daysBetween', () => {
  it('counts calendar days and ignores time of day', () => {
    expect(daysBetween('2026-10-01', TODAY)).toBe(7)
    expect(daysBetween('2026-10-01T23:59:00Z', '2026-10-08T00:01:00Z')).toBe(7)
    expect(daysBetween(TODAY, '2026-10-01')).toBe(-7)
  })
})

describe('findUninvoicedCleans: 7-day cut-off', () => {
  it('a clean exactly 7 days old is not yet flagged', () => {
    expect(findUninvoicedCleans([task({ dueDate: '2026-10-01' })], [], TODAY)).toEqual([])
  })

  it('a clean 8 days old is flagged', () => {
    const r = findUninvoicedCleans([task({ dueDate: '2026-09-30' })], [], TODAY)
    expect(r).toEqual([{ propertyId: 101, date: '2026-09-30', taskId: 'bw-1', source: 'breezeway', title: 'Turn Clean' }])
  })

  it('ignores cleans outside the lookback window', () => {
    expect(findUninvoicedCleans([task({ dueDate: '2026-08-01' })], [], TODAY)).toEqual([])
    expect(findUninvoicedCleans([task({ dueDate: '2026-09-28' })], [], TODAY, { lookbackDays: 10 })).toHaveLength(1)
    expect(findUninvoicedCleans([task({ dueDate: '2026-09-27' })], [], TODAY, { lookbackDays: 10 })).toEqual([])
  })

  it('only counts completed cleans with a property and date', () => {
    expect(findUninvoicedCleans([
      task({ completed: false }),
      task({ isClean: false, isDeepClean: false, title: 'Hot Tub Refresh' }),
      task({ propertyId: null }),
      task({ dueDate: null }),
    ], [], TODAY)).toEqual([])
  })

  it('counts deep cleans as cleans', () => {
    expect(findUninvoicedCleans([task({ isClean: false, isDeepClean: true })], [], TODAY)).toHaveLength(1)
  })
})

describe('findUninvoicedCleans: coverage', () => {
  it('a line on the same property-day covers the clean', () => {
    expect(findUninvoicedCleans([task()], [line()], TODAY)).toEqual([])
  })

  it('a line matched to the task covers it even when dated a day off', () => {
    expect(findUninvoicedCleans([task()], [line({ date: '2026-10-01', matchedTaskId: 'bw-1' })], TODAY)).toEqual([])
  })

  it('a line for another property or day does not cover it', () => {
    expect(findUninvoicedCleans([task()], [line({ propertyId: 202 }), line({ date: '2026-09-29' })], TODAY)).toHaveLength(1)
  })

  it('draft and in-review runs count as invoiced', () => {
    expect(findUninvoicedCleans([task()], [line({ runStatus: 'draft' })], TODAY)).toEqual([])
    expect(findUninvoicedCleans([task()], [line({ runStatus: 'review_needed' })], TODAY)).toEqual([])
  })

  it('a void run does not count', () => {
    expect(findUninvoicedCleans([task()], [line({ runStatus: 'void', matchedTaskId: 'bw-1' })], TODAY)).toHaveLength(1)
  })

  it('an archived run does not count', () => {
    expect(findUninvoicedCleans([task()], [line({ runArchived: true, matchedTaskId: 'bw-1' })], TODAY)).toHaveLength(1)
  })

  it('an excluded line does not count', () => {
    expect(findUninvoicedCleans([task()], [line({ reviewStatus: 'excluded', matchedTaskId: 'bw-1' })], TODAY)).toHaveLength(1)
  })

  it('an extra or expense line does not count as billing the clean', () => {
    expect(findUninvoicedCleans([task()], [line({ lineKind: 'extra' }), line({ lineKind: 'operating_expense' })], TODAY)).toHaveLength(1)
    expect(findUninvoicedCleans([task()], [line({ lineKind: 'combined_split' })], TODAY)).toEqual([])
    expect(findUninvoicedCleans([task()], [line({ lineKind: 'deep_clean' })], TODAY)).toEqual([])
  })

  it('reports one row per property-day, preferring the Breezeway task', () => {
    const r = findUninvoicedCleans([
      task({ externalId: 'trellis:t1', source: 'trellis' }),
      task({ externalId: 'bw-9', isClean: false, isDeepClean: true }),
    ], [], TODAY)
    expect(r).toHaveLength(1)
    expect(r[0].taskId).toBe('bw-9')
  })

  it('a matched task covers the whole day, not just itself', () => {
    const r = findUninvoicedCleans([
      task({ externalId: 'bw-1' }),
      task({ externalId: 'bw-2', isClean: false, isDeepClean: true }),
    ], [line({ date: '2026-10-01', matchedTaskId: 'bw-2' })], TODAY)
    expect(r).toEqual([])
  })
})

describe('lineCoversClean', () => {
  it('needs a live run, a clean kind and a non-excluded line', () => {
    expect(lineCoversClean(line())).toBe(true)
    expect(lineCoversClean(line({ lineKind: null }))).toBe(false)
    expect(lineCoversClean(line({ runStatus: 'void' }))).toBe(false)
    expect(lineCoversClean(line({ runArchived: true }))).toBe(false)
    expect(lineCoversClean(line({ reviewStatus: 'excluded' }))).toBe(false)
  })
})

describe('groupUninvoicedByClient', () => {
  const info = new Map([
    [101, { name: 'Alpha 1', contactId: 'c-1', clientName: 'Haven' }],
    [102, { name: 'Alpha 2', contactId: 'c-1', clientName: 'Haven' }],
    [201, { name: 'Solo', contactId: null, clientName: null }],
  ])

  it('groups by client with counts and oldest date, oldest backlog first', () => {
    const g = groupUninvoicedByClient([
      { propertyId: 101, date: '2026-09-25', taskId: 'a', source: 'breezeway', title: 'Turn Clean' },
      { propertyId: 101, date: '2026-09-28', taskId: 'b', source: 'breezeway', title: 'Turn Clean' },
      { propertyId: 102, date: '2026-09-29', taskId: 'c', source: 'trellis', title: 'Turn Clean' },
      { propertyId: 201, date: '2026-09-20', taskId: 'd', source: 'breezeway', title: 'Turn Clean' },
      { propertyId: 999, date: '2026-09-30', taskId: 'e', source: 'breezeway', title: 'Turn Clean' },
    ], info)
    expect(g.map(x => [x.contactId, x.count, x.oldestDate])).toEqual([
      [null, 2, '2026-09-20'],
      ['c-1', 3, '2026-09-25'],
    ])
    expect(g[1].properties.map(p => [p.propertyName, p.count, p.oldestDate])).toEqual([
      ['Alpha 1', 2, '2026-09-25'],
      ['Alpha 2', 1, '2026-09-29'],
    ])
    expect(g[0].properties.map(p => p.propertyName)).toEqual(['Solo', 'Property #999'])
  })
})

describe('findUnpaidInvoices: 30-day cut-off', () => {
  const run = (over: Partial<UnpaidRunInput> = {}): UnpaidRunInput => ({
    id: 'r1',
    status: 'exported',
    archivedAt: null,
    paidAt: null,
    approvedAt: '2026-09-07T15:00:00Z',
    createdAt: '2026-09-01T12:00:00Z',
    qboInvoiceNos: [1097, 1096],
    vendorName: 'Busy Bee Cleaning',
    periodStart: '2026-08-30',
    periodEnd: '2026-09-05',
    clientTotal: 12_000,
    ...over,
  })

  it('an invoice exactly 30 days old is not yet flagged', () => {
    expect(findUnpaidInvoices([run({ approvedAt: '2026-09-08T09:00:00Z' })], TODAY)).toEqual([])
  })

  it('an invoice 31 days old is flagged', () => {
    const r = findUnpaidInvoices([run()], TODAY)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ runId: 'r1', sentDate: '2026-09-07', daysOutstanding: 31, qboInvoiceNos: [1096, 1097] })
  })

  it('skips paid, archived, void and not-yet-exported runs', () => {
    expect(findUnpaidInvoices([
      run({ paidAt: '2026-09-20T00:00:00Z' }),
      run({ archivedAt: '2026-09-21T00:00:00Z' }),
      run({ status: 'void' }),
      run({ status: 'approved' }),
    ], TODAY)).toEqual([])
  })

  it('treats a missing paid_at column (undefined) as unpaid', () => {
    expect(findUnpaidInvoices([run({ paidAt: undefined })], TODAY)).toHaveLength(1)
  })

  it('skips a run with nothing to collect, keeps one whose total is unknown', () => {
    expect(findUnpaidInvoices([run({ clientTotal: 0 })], TODAY)).toEqual([])
    expect(findUnpaidInvoices([run({ clientTotal: null })], TODAY)).toHaveLength(1)
  })

  it('falls back to created_at with no approval stamp, longest outstanding first', () => {
    const r = findUnpaidInvoices([
      run({ id: 'a' }),
      run({ id: 'b', approvedAt: null, createdAt: '2026-08-01T00:00:00Z' }),
    ], TODAY)
    expect(r.map(x => [x.runId, x.daysOutstanding])).toEqual([['b', 68], ['a', 31]])
  })
})

describe('qboNumbersOf', () => {
  it('merges the per-month map with the legacy number, deduped', () => {
    expect(qboNumbersOf(1096, { '2026-09': 1096, '2026-10': 1097 }).sort()).toEqual([1096, 1097])
    expect(qboNumbersOf(null, null)).toEqual([])
    expect(qboNumbersOf(null, [1, 2])).toEqual([])
  })
})

describe('isMissingSchemaError', () => {
  it('recognises missing column / table errors only', () => {
    expect(isMissingSchemaError({ code: '42703', message: 'column invoice_runs.paid_at does not exist' })).toBe(true)
    expect(isMissingSchemaError({ code: 'PGRST204', message: "Could not find the 'paid_at' column" })).toBe(true)
    expect(isMissingSchemaError({ code: '42P01' })).toBe(true)
    expect(isMissingSchemaError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isMissingSchemaError(null)).toBe(false)
  })
})
