import { describe, expect, it } from 'vitest'
import {
  buildRunClientInvoices,
  classifyRun,
  filterSentInvoices,
  formatQboNumbers,
  groupRuns,
  invoicingViewFromSearch,
  monthAbbr,
  sendProgressOf,
  sentInvoiceMonths,
  sortToSend,
  storedClientInvoiceRows,
  summarizeRunLines,
  type ClientInvoiceRow,
  type SendLineRow,
} from './invoicing-overview'

describe('invoicingViewFromSearch', () => {
  it('lands on Vendor invoices by default', () => {
    expect(invoicingViewFromSearch('')).toBe('runs')
    expect(invoicingViewFromSearch('?view=bogus')).toBe('runs')
  })
  it('keeps the old ids working', () => {
    expect(invoicingViewFromSearch('?view=runs')).toBe('runs')
    expect(invoicingViewFromSearch('?view=charges')).toBe('charges')
    expect(invoicingViewFromSearch('?view=audit')).toBe('audit')
    expect(invoicingViewFromSearch('?view=sent')).toBe('client')
  })
  it('accepts the new ids', () => {
    expect(invoicingViewFromSearch('?view=client')).toBe('client')
    expect(invoicingViewFromSearch('?view=prices')).toBe('prices')
  })
  it('sends ?linen=<id> to Credits & linen, even with another view', () => {
    expect(invoicingViewFromSearch('?linen=652')).toBe('charges')
    expect(invoicingViewFromSearch('?view=runs&linen=652')).toBe('charges')
  })
  it('ignores a malformed linen id', () => {
    expect(invoicingViewFromSearch('?linen=abc')).toBe('runs')
    expect(invoicingViewFromSearch('?linen=-3')).toBe('runs')
    expect(invoicingViewFromSearch('?linen=1.5')).toBe('runs')
  })
})

describe('classifyRun / groupRuns', () => {
  const run = (id: string, status: string, source = 'vendor_csv') => ({ id, status: status as never, source: source as never })

  it('puts runs awaiting review in Needs you', () => {
    for (const status of ['ingested', 'reconciled', 'review_needed']) {
      expect(classifyRun(run('a', status), 0)).toBe('needs_you')
    }
  })
  it('puts a submitted vendor-portal run in Needs you and its draft in Vendor still writing', () => {
    expect(classifyRun(run('a', 'review_needed', 'vendor_portal'), 0)).toBe('needs_you')
    expect(classifyRun(run('a', 'draft', 'vendor_portal'), 0)).toBe('writing')
  })
  it('keeps a non-portal draft in Needs you (nobody else is writing it)', () => {
    expect(classifyRun(run('a', 'draft', 'generated'), 0)).toBe('needs_you')
  })
  it('keeps an approved run in Needs you only while client invoices remain unsent', () => {
    expect(classifyRun(run('a', 'approved'), 2)).toBe('needs_you')
    expect(classifyRun(run('a', 'exported'), 1)).toBe('needs_you')
    expect(classifyRun(run('a', 'approved'), 0)).toBe('done')
    expect(classifyRun(run('a', 'exported'), 0)).toBe('done')
  })
  it('treats void as done even with unsent counts', () => {
    expect(classifyRun(run('a', 'void'), 3)).toBe('done')
  })
  it('groups in order and keeps each run once', () => {
    const runs = [
      run('1', 'review_needed'),
      run('2', 'approved'),
      run('3', 'approved'),
      run('4', 'draft', 'vendor_portal'),
      run('5', 'void'),
    ]
    const g = groupRuns(runs, new Map([['2', 2]]))
    expect(g.needsYou.map(r => r.id)).toEqual(['1', '2'])
    expect(g.writing.map(r => r.id)).toEqual(['4'])
    expect(g.done.map(r => r.id)).toEqual(['3', '5'])
  })
})

describe('summarizeRunLines', () => {
  it('counts lines needing review and sums pay and charge over non-excluded lines', () => {
    const stats = summarizeRunLines([
      { run_id: 'r1', review_status: 'needs_review', cleaner_pay_amount: 100, client_charge_amount: 150 },
      { run_id: 'r1', review_status: 'ok', cleaner_pay_amount: '80.10', client_charge_amount: '120.20' },
      { run_id: 'r1', review_status: 'excluded', cleaner_pay_amount: 999, client_charge_amount: 999 },
      { run_id: 'r1', review_status: 'resolved', cleaner_pay_amount: null, client_charge_amount: 50 },
      { run_id: 'r2', review_status: 'ok', cleaner_pay_amount: 10, client_charge_amount: null },
    ])
    expect(stats.get('r1')).toEqual({ needsReview: 1, vendorPay: 180.1, clientTotal: 320.2 })
    expect(stats.get('r2')).toEqual({ needsReview: 0, vendorPay: 10, clientTotal: 0 })
    expect(stats.get('missing')).toBeUndefined()
  })
  it('avoids float drift', () => {
    const rows = Array.from({ length: 10 }, () => ({ run_id: 'r', review_status: 'ok', cleaner_pay_amount: 0.1, client_charge_amount: 0.2 }))
    expect(summarizeRunLines(rows).get('r')).toEqual({ needsReview: 0, vendorPay: 1, clientTotal: 2 })
  })
})

describe('formatQboNumbers', () => {
  it('shows both numbers with their month when a run has two', () => {
    expect(formatQboNumbers({ '2026-09': 1096, '2026-10': 1097 }, 1096)).toBe('Sep 1096 · Oct 1097')
  })
  it('orders months regardless of key order', () => {
    expect(formatQboNumbers({ '2026-10': 1097, '2026-09': 1096 }, null)).toBe('Sep 1096 · Oct 1097')
  })
  it('shows just the number for one month', () => {
    expect(formatQboNumbers({ '2026-10': 1100 }, 1100)).toBe('1100')
  })
  it('falls back to the single number, then to nothing', () => {
    expect(formatQboNumbers(null, 1085)).toBe('1085')
    expect(formatQboNumbers({}, 1085)).toBe('1085')
    expect(formatQboNumbers(undefined, null)).toBeNull()
    expect(formatQboNumbers({}, undefined)).toBeNull()
  })
  it('ignores junk values', () => {
    expect(formatQboNumbers({ '2026-10': 'x', '2026-11': 0 }, 7)).toBe('7')
    expect(formatQboNumbers([1, 2], null)).toBeNull()
    expect(formatQboNumbers('1100', null)).toBeNull()
  })
})

describe('monthAbbr', () => {
  it('abbreviates yyyy-mm and passes anything else through', () => {
    expect(monthAbbr('2026-01')).toBe('Jan')
    expect(monthAbbr('2026-12')).toBe('Dec')
    expect(monthAbbr('2026-13')).toBe('2026-13')
    expect(monthAbbr('nope')).toBe('nope')
  })
})

describe('buildRunClientInvoices', () => {
  const line = (over: Partial<SendLineRow> & { id: string; line_no: number }): SendLineRow => ({
    line_kind: 'clean',
    review_status: 'ok',
    billing_channel: 'bill_com',
    client_charge_amount: 100,
    service_date: '2026-10-03',
    property_id: 1,
    flags: [],
    bill_hold_reason: null,
    ...over,
  })
  const clients = new Map([
    [1, { contactId: 'c-ann', name: 'Ann Weber' }],
    [2, { contactId: 'c-bo', name: 'Bo Hill' }],
  ])

  it('makes one client invoice per client, month and channel, held when never approved', () => {
    const rows = buildRunClientInvoices({
      runId: 'run1',
      invoiceDate: '2026-10-08',
      lines: [
        line({ id: 'a', line_no: 1 }),
        line({ id: 'b', line_no: 2, client_charge_amount: 50 }),
        line({ id: 'c', line_no: 3, property_id: 2, service_date: '2026-09-29' }),
        line({ id: 'd', line_no: 4, billing_channel: 'qbo_haven' }),
        line({ id: 'e', line_no: 5, review_status: 'excluded' }),
        line({ id: 'f', line_no: 6, line_kind: 'operating_expense' }),
      ],
      clientByProperty: clients,
      creditClients: null,
      states: [],
    })
    expect(rows.map(r => [r.clientName, r.serviceMonth, r.channel, r.total, r.status])).toEqual([
      ['Ann Weber', '2026-10', 'bill_com', 150, 'held'],
      ['Bo Hill', '2026-09', 'bill_com', 100, 'held'],
    ])
    expect(rows.every(r => r.runId === 'run1')).toBe(true)
  })

  it('joins stored statuses, and a sent invoice shows its stored total and number', () => {
    const rows = buildRunClientInvoices({
      runId: 'run1',
      invoiceDate: '2026-10-08',
      lines: [
        line({ id: 'a', line_no: 1 }),
        line({ id: 'c', line_no: 3, property_id: 2 }),
      ],
      clientByProperty: clients,
      creditClients: null,
      states: [
        { contactId: 'c-ann', channel: 'bill_com', serviceMonth: '2026-10', status: 'sent', billcomInvoiceNumber: 'B-77', sentAt: '2026-10-09T12:00:00Z', total: 99.5 },
        { contactId: 'c-bo', channel: 'bill_com', serviceMonth: '2026-10', status: 'approved' },
      ],
    })
    const ann = rows.find(r => r.clientName === 'Ann Weber')!
    expect(ann.status).toBe('sent')
    expect(ann.total).toBe(99.5)
    expect(ann.invoiceNumber).toBe('B-77')
    expect(rows.find(r => r.clientName === 'Bo Hill')!.status).toBe('approved')
    expect(sendProgressOf(rows)).toEqual({ total: 2, sent: 1, approved: 1, held: 0 })
  })

  it('keeps bill.com and QuickBooks invoices for one client apart, and a held line out of the total', () => {
    const rows = buildRunClientInvoices({
      runId: 'run1',
      invoiceDate: null,
      lines: [
        line({ id: 'a', line_no: 1 }),
        line({ id: 'b', line_no: 2, billing_channel: 'qbo_client', client_charge_amount: 40 }),
        line({ id: 'c', line_no: 3, bill_hold_reason: 'waiting on owner', client_charge_amount: 25 }),
      ],
      clientByProperty: clients,
      creditClients: null,
      states: [],
    })
    expect(rows).toHaveLength(2)
    const bill = rows.find(r => r.channel === 'bill_com')!
    expect(bill.total).toBe(100)
    expect(rows.find(r => r.channel === 'qbo_client')!.total).toBe(40)
  })

  it('bills a credit line to the client named on the credit, not a property', () => {
    const rows = buildRunClientInvoices({
      runId: 'run1',
      invoiceDate: '2026-10-08',
      lines: [
        line({ id: 'a', line_no: 1 }),
        line({ id: 'cr', line_no: 2, property_id: null, client_charge_amount: -20, flags: ['credit'] }),
      ],
      clientByProperty: clients,
      creditClients: new Map([['cr', { contactId: 'c-ann', clientName: 'Ann Weber' }]]),
      states: [],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].total).toBe(80)
  })

  it('returns nothing for a run with no billable client lines', () => {
    expect(buildRunClientInvoices({
      runId: 'r', invoiceDate: null, lines: [line({ id: 'a', line_no: 1, billing_channel: 'qbo_haven' })],
      clientByProperty: clients, creditClients: null, states: [],
    })).toEqual([])
  })
})

describe('storedClientInvoiceRows / sortToSend', () => {
  it('maps stored rows and tolerates a missing client', () => {
    const rows = storedClientInvoiceRows([
      { run_id: 'r1', contact_id: 'c1', billing_channel: 'qbo_client', service_month: '2026-08', status: 'approved', hold_reason: null, billcom_invoice_number: null, sent_at: null, total: '12.50', contacts: { full_name: 'Kay', company: null } },
      { run_id: 'r2', contact_id: null, billing_channel: 'bill_com', service_month: '2026-08', status: 'held', hold_reason: 'ask owner', billcom_invoice_number: null, sent_at: null, total: null, contacts: null },
    ])
    expect(rows[0]).toMatchObject({ clientName: 'Kay', channel: 'qbo_client', total: 12.5, status: 'approved' })
    expect(rows[1]).toMatchObject({ clientName: null, channel: 'bill_com', total: null, status: 'held', holdReason: 'ask owner' })
  })
  it('sorts approved first, then by client and month', () => {
    const mk = (clientName: string, serviceMonth: string, status: ClientInvoiceRow['status']): ClientInvoiceRow => ({
      key: `${clientName}${serviceMonth}`, runId: 'r', channel: 'bill_com', contactId: clientName, clientName, serviceMonth, status,
      holdReason: null, total: 1, invoiceNumber: null, sentAt: null,
    })
    const sorted = sortToSend([mk('Zed', '2026-09', 'held'), mk('Amy', '2026-10', 'held'), mk('Zed', '2026-09', 'approved'), mk('Amy', '2026-09', 'held')])
    expect(sorted.map(r => `${r.clientName} ${r.serviceMonth} ${r.status}`)).toEqual([
      'Zed 2026-09 approved', 'Amy 2026-09 held', 'Amy 2026-10 held', 'Zed 2026-09 held',
    ])
  })
})

describe('sent invoice filters', () => {
  const rows = [
    { invoice_number: '1361', client_name: 'Kristy Horn', recipient: 'kristy@example.com', period_start: '2026-09-01' },
    { invoice_number: 'B-204', client_name: 'Ann Weber', recipient: null, period_start: '2026-10-01' },
    { invoice_number: 'B-205', client_name: 'Bo Hill', recipient: 'ap@hill.test', period_start: '2026-10-15' },
  ]
  it('lists service months newest first, once each', () => {
    expect(sentInvoiceMonths(rows)).toEqual(['2026-10', '2026-09'])
    expect(sentInvoiceMonths([])).toEqual([])
  })
  it('searches client, number and recipient, case-insensitively', () => {
    expect(filterSentInvoices(rows, { search: 'weber', month: '' }).map(r => r.invoice_number)).toEqual(['B-204'])
    expect(filterSentInvoices(rows, { search: ' 1361 ', month: '' }).map(r => r.client_name)).toEqual(['Kristy Horn'])
    expect(filterSentInvoices(rows, { search: 'hill.test', month: '' })).toHaveLength(1)
  })
  it('filters by service month and combines with search', () => {
    expect(filterSentInvoices(rows, { search: '', month: '2026-10' })).toHaveLength(2)
    expect(filterSentInvoices(rows, { search: 'b-205', month: '2026-10' })).toHaveLength(1)
    expect(filterSentInvoices(rows, { search: 'b-205', month: '2026-09' })).toHaveLength(0)
  })
  it('returns everything with no filters', () => {
    expect(filterSentInvoices(rows, { search: '', month: '' })).toHaveLength(3)
  })
})
