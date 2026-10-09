import { describe, expect, it } from 'vitest'
import {
  billComLineSendable,
  canTransition,
  creditClientsByLine,
  groupBillComInvoices,
  isMissingSchemaError,
  lineClient,
  normalizeBillcomInvoiceNumber,
  normalizeHoldReason,
  parseBillComAction,
  runAllowsSendControl,
  stateMap,
  statusFor,
  type BillComLineInput,
} from './billcom-send'

const RUN = '33333333-3333-4333-8333-333333333333'
const JANE = '11111111-1111-4111-8111-111111111111'
const BOB = '22222222-2222-4222-8222-222222222222'

describe('normalizers', () => {
  it('hold reason: trimmed and collapsed; blank means not held', () => {
    expect(normalizeHoldReason('  Client  disputes\n trip fee ')).toBe('Client disputes trip fee')
    expect(normalizeHoldReason('   ')).toBeNull()
    expect(normalizeHoldReason(null)).toBeNull()
    expect(normalizeHoldReason(42)).toBeNull()
    expect(normalizeHoldReason('x'.repeat(600))).toHaveLength(500)
  })
  it('bill.com invoice number: required, trimmed, capped', () => {
    expect(normalizeBillcomInvoiceNumber(' 10452 ')).toBe('10452')
    expect(normalizeBillcomInvoiceNumber(10452)).toBe('10452')
    expect(normalizeBillcomInvoiceNumber('   ')).toBeNull()
    expect(normalizeBillcomInvoiceNumber(undefined)).toBeNull()
    expect(normalizeBillcomInvoiceNumber('x'.repeat(65))).toBeNull()
  })
})

describe('status rules', () => {
  it('held and approved move both ways; sent needs approved; sent is final', () => {
    expect(canTransition('held', 'approved')).toBe(true)
    expect(canTransition('approved', 'held')).toBe(true)
    expect(canTransition('approved', 'sent')).toBe(true)
    expect(canTransition('held', 'sent')).toBe(false)
    expect(canTransition('sent', 'held')).toBe(false)
    expect(canTransition('sent', 'approved')).toBe(false)
    expect(canTransition('held', 'held')).toBe(false)
  })
  it('a client invoice with no stored row is held', () => {
    const states = stateMap([{ contactId: JANE, serviceMonth: '2026-08', status: 'approved' }])
    expect(statusFor(states, JANE, '2026-08')).toBe('approved')
    expect(statusFor(states, JANE, '2026-09')).toBe('held')
    expect(statusFor(states, BOB, '2026-08')).toBe('held')
    expect(statusFor(states, null, '2026-08')).toBe('held')
  })
  it('a line is sendable only when approved, not held and with a client', () => {
    const states = stateMap([
      { contactId: JANE, serviceMonth: '2026-08', status: 'approved' },
      { contactId: BOB, serviceMonth: '2026-08', status: 'sent', billcomInvoiceNumber: 'B-1' },
    ])
    expect(billComLineSendable({ contactId: JANE, serviceMonth: '2026-08' }, states)).toBe(true)
    expect(billComLineSendable({ contactId: JANE, serviceMonth: '2026-08', billHoldReason: 'Disputed' }, states)).toBe(false)
    expect(billComLineSendable({ contactId: BOB, serviceMonth: '2026-08' }, states)).toBe(false)
    expect(billComLineSendable({ contactId: null, serviceMonth: '2026-08' }, states)).toBe(false)
  })
  it('a row whose client was deleted (contact_id null) never approves client-less lines', () => {
    const states = stateMap([{ contactId: null, serviceMonth: '2026-08', status: 'approved' }])
    expect(statusFor(states, null, '2026-08')).toBe('held')
    expect(billComLineSendable({ contactId: null, serviceMonth: '2026-08' }, states)).toBe(false)
    expect(states.size).toBe(0)
  })
  it('send control only on approved or exported runs', () => {
    expect(runAllowsSendControl('approved')).toBe(true)
    expect(runAllowsSendControl('exported')).toBe(true)
    expect(runAllowsSendControl('review_needed')).toBe(false)
    expect(runAllowsSendControl('void')).toBe(false)
    expect(runAllowsSendControl(null)).toBe(false)
  })
})

describe('isMissingSchemaError (migration not applied yet)', () => {
  it('matches the PostgREST and Postgres codes', () => {
    for (const code of ['42P01', '42703', 'PGRST204', 'PGRST205']) expect(isMissingSchemaError({ code, message: '' })).toBe(true)
  })
  it('matches the message when a wrapper dropped the code', () => {
    expect(isMissingSchemaError(new Error('Failed to load invoice_lines: column invoice_lines.bill_hold_reason does not exist'))).toBe(true)
    expect(isMissingSchemaError({ message: 'relation "public.client_invoices" does not exist' })).toBe(true)
    expect(isMissingSchemaError({ message: "Could not find the table 'public.client_invoices' in the schema cache" })).toBe(true)
    expect(isMissingSchemaError({ message: "Could not find the 'bill_hold_reason' column of 'invoice_lines' in the schema cache" })).toBe(true)
  })
  it('does not swallow real failures', () => {
    expect(isMissingSchemaError(null)).toBe(false)
    expect(isMissingSchemaError({ code: '42501', message: 'permission denied for table client_invoices' })).toBe(false)
    expect(isMissingSchemaError(new Error('fetch failed'))).toBe(false)
  })
})

describe('parseBillComAction', () => {
  it('hold_line: blank reason clears the hold', () => {
    expect(parseBillComAction({ action: 'hold_line', run_id: RUN, line_no: 7, reason: ' Disputed ' }))
      .toEqual({ ok: true, value: { action: 'hold_line', runId: RUN, lineNo: 7, reason: 'Disputed' } })
    expect(parseBillComAction({ action: 'hold_line', run_id: RUN, line_no: 7, reason: '' }))
      .toEqual({ ok: true, value: { action: 'hold_line', runId: RUN, lineNo: 7, reason: null } })
    expect(parseBillComAction({ action: 'hold_line', run_id: RUN, line_no: 'x' }).ok).toBe(false)
  })
  it('set_status: held or approved only; the hold reason rides only on held', () => {
    const r = parseBillComAction({ action: 'set_status', run_id: RUN, contact_id: JANE, service_month: '2026-08', status: 'approved', hold_reason: 'ignored' })
    expect(r).toEqual({ ok: true, value: { action: 'set_status', runId: RUN, contactId: JANE, serviceMonth: '2026-08', status: 'approved', holdReason: null } })
    expect(parseBillComAction({ action: 'set_status', run_id: RUN, contact_id: JANE, service_month: '2026-08', status: 'sent' }).ok).toBe(false)
    expect(parseBillComAction({ action: 'set_status', run_id: RUN, contact_id: JANE, service_month: '2026-13', status: 'held' }).ok).toBe(false)
  })
  it('mark_sent: the bill.com invoice number is required and trimmed', () => {
    expect(parseBillComAction({ action: 'mark_sent', run_id: RUN, contact_id: JANE, service_month: '2026-08', billcom_invoice_number: '  INV-77 ' }))
      .toEqual({ ok: true, value: { action: 'mark_sent', runId: RUN, contactId: JANE, serviceMonth: '2026-08', billcomInvoiceNumber: 'INV-77' } })
    expect(parseBillComAction({ action: 'mark_sent', run_id: RUN, contact_id: JANE, service_month: '2026-08', billcom_invoice_number: '  ' }).ok).toBe(false)
    expect(parseBillComAction({ action: 'mark_sent', run_id: RUN, contact_id: JANE, service_month: '2026-08' }).ok).toBe(false)
  })
  it('refuses a missing run, client or unknown action', () => {
    expect(parseBillComAction({ action: 'hold_line', line_no: 1 }).ok).toBe(false)
    expect(parseBillComAction({ action: 'mark_sent', run_id: RUN, service_month: '2026-08', billcom_invoice_number: '1' }).ok).toBe(false)
    expect(parseBillComAction({ action: 'delete', run_id: RUN }).ok).toBe(false)
    expect(parseBillComAction(null).ok).toBe(false)
  })
})

describe('groupBillComInvoices', () => {
  const mk = (lineNo: number, contactId: string | null, client: string | null, date: string | null, amt: number | null, extra: Partial<BillComLineInput> = {}): BillComLineInput => ({
    lineNo, lineKind: 'clean', reviewStatus: 'ok', billingChannel: 'bill_com', clientChargeAmount: amt,
    serviceDate: date, contactId, clientName: client, ...extra,
  })

  it('one invoice per client per service month, held lines kept apart from the total', () => {
    const groups = groupBillComInvoices([
      mk(1, JANE, 'Jane Owner', '2026-08-30', 120),
      mk(2, JANE, 'Jane Owner', '2026-09-01', 150),
      mk(3, JANE, 'Jane Owner', '2026-09-02', 80, { billHoldReason: 'Disputed' }),
      mk(4, BOB, 'Bob Owner', null, 200), // undated → the run's invoice month
    ], '2026-09-05')
    expect(groups.map(g => [g.clientName, g.serviceMonth, g.total, g.heldTotal, g.lineNos, g.heldLineNos])).toEqual([
      ['Bob Owner', '2026-09', 200, 0, [4], []],
      ['Jane Owner', '2026-08', 120, 0, [1], []],
      ['Jane Owner', '2026-09', 150, 80, [2, 3], [3]],
    ])
  })

  it('skips what the bill.com worksheet skips', () => {
    const groups = groupBillComInvoices([
      mk(1, JANE, 'Jane Owner', '2026-08-30', 120, { billingChannel: 'qbo_haven' }),
      mk(2, JANE, 'Jane Owner', '2026-08-30', 120, { lineKind: 'excluded' }),
      mk(3, JANE, 'Jane Owner', '2026-08-30', 120, { reviewStatus: 'excluded' }),
      mk(4, JANE, 'Jane Owner', '2026-08-30', 120, { lineKind: 'operating_expense' }),
      mk(5, JANE, 'Jane Owner', '2026-08-30', 0),
      mk(6, JANE, 'Jane Owner', '2026-08-30', null),
    ], '2026-09-05')
    expect(groups).toEqual([])
  })

  it('split rows add up to one line; a hold on any row holds all of it', () => {
    const groups = groupBillComInvoices([
      mk(5, JANE, 'Jane Owner', '2026-08-07', 300),
      mk(5, JANE, 'Jane Owner', '2026-08-07', 50, { lineKind: 'extra', billHoldReason: 'Not their first clean' }),
      mk(6, JANE, 'Jane Owner', '2026-08-08', 100),
    ], '2026-08-10')
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ total: 100, heldTotal: 350, lineNos: [5, 6], heldLineNos: [5] })
  })

  it('lines without a client form their own (unsendable) group', () => {
    const groups = groupBillComInvoices([mk(1, null, null, '2026-08-07', 90)], '2026-08-10')
    expect(groups).toEqual([expect.objectContaining({ contactId: null, total: 90 })])
  })
})

describe('client credits join their client (lineClient + creditClientsByLine)', () => {
  const CREDIT_LINE_ID = '44444444-4444-4444-8444-444444444444'
  const CLEAN_LINE_ID = '55555555-5555-4555-8555-555555555555'
  // Raw rows as the API/panel get them: a clean on Jane's property, and a
  // credit with no property whose client lives on its adjustment.
  const raw = [
    { id: CLEAN_LINE_ID, lineNo: 1, propertyContactId: JANE, propertyClientName: 'Jane Owner', date: '2026-09-02', amt: 150 },
    { id: CREDIT_LINE_ID, lineNo: 9, propertyContactId: null, propertyClientName: null, date: '2026-09-02', amt: -40 },
  ]
  const toInputs = (credits: ReturnType<typeof creditClientsByLine> | null | undefined): BillComLineInput[] => raw.map(r => {
    const client = lineClient(r, credits)
    return {
      lineNo: r.lineNo, lineKind: r.lineNo === 9 ? 'extra' : 'clean', reviewStatus: 'ok', billingChannel: 'bill_com',
      clientChargeAmount: r.amt, serviceDate: r.date, contactId: client.contactId, clientName: client.clientName,
    }
  })

  it('reads adjustment rows (object or array embed), skipping incomplete ones', () => {
    const m = creditClientsByLine([
      { applied_line_id: CREDIT_LINE_ID, contact_id: JANE, contacts: [{ full_name: null, company: 'Jane Co' }] },
      { applied_line_id: null, contact_id: BOB, contacts: null },
      { applied_line_id: CLEAN_LINE_ID, contact_id: null, contacts: null },
    ])
    expect(Array.from(m.entries())).toEqual([[CREDIT_LINE_ID, { contactId: JANE, clientName: 'Jane Co' }]])
  })

  it('a credit with no property lands in its client\'s month group and nets the total', () => {
    const credits = creditClientsByLine([{ applied_line_id: CREDIT_LINE_ID, contact_id: JANE, contacts: { full_name: 'Jane Owner', company: null } }])
    const groups = groupBillComInvoices(toInputs(credits), '2026-09-05')
    expect(groups).toEqual([expect.objectContaining({ contactId: JANE, clientName: 'Jane Owner', serviceMonth: '2026-09', total: 110, lineNos: [1, 9] })])
  })

  it('the adjustment wins over a property the credit happens to carry', () => {
    const credits = creditClientsByLine([{ applied_line_id: CREDIT_LINE_ID, contact_id: JANE, contacts: null }])
    expect(lineClient({ id: CREDIT_LINE_ID, propertyContactId: BOB, propertyClientName: 'Bob Owner' }, credits))
      .toEqual({ contactId: JANE, clientName: 'Bob Owner' })
    expect(lineClient({ id: CLEAN_LINE_ID, propertyContactId: BOB, propertyClientName: 'Bob Owner' }, credits))
      .toEqual({ contactId: BOB, clientName: 'Bob Owner' })
  })

  it('adjustment lookup missing (migration pending): every line falls back to its property, as before', () => {
    for (const missing of [null, undefined, creditClientsByLine(null)]) {
      const groups = groupBillComInvoices(toInputs(missing), '2026-09-05')
      expect(groups.map(g => [g.contactId, g.total, g.lineNos])).toEqual([
        [null, -40, [9]],
        [JANE, 150, [1]],
      ])
    }
  })
})
