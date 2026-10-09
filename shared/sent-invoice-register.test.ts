import { describe, expect, it } from 'vitest'
import {
  NOTE_REQUIRED_FLAGS,
  isMissingFunctionError,
  monthBounds,
  normalizeRecipient,
  normalizeSha256,
  parseMarkSentExtras,
  periodWithinOneMonth,
  preSendExceptions,
  registerPeriod,
  sendableTotal,
  shortHash,
  type PreSendInput,
  type PreSendLine,
} from './sent-invoice-register'
import { parseBillComAction } from './billcom-send'

const HASH = 'a'.repeat(64)

const line = (over: Partial<PreSendLine> = {}): PreSendLine => ({
  lineNo: 1,
  reviewStatus: 'ok',
  billHoldReason: null,
  flags: [],
  reviewNote: null,
  serviceDate: '2026-09-10',
  clientChargeAmount: 175,
  ...over,
})

const input = (over: Partial<PreSendInput> = {}): PreSendInput => ({
  run: { status: 'approved', archivedAt: null },
  invoice: { status: 'approved', serviceMonth: '2026-09' },
  lines: [line(), line({ lineNo: 2, clientChargeAmount: 50.5 })],
  confirmedTotal: 225.5,
  registered: null,
  ...over,
})

const codes = (i: PreSendInput) => preSendExceptions(i).map(e => e.code)

describe('month rule', () => {
  it('monthBounds: first and last day, leap years, malformed', () => {
    expect(monthBounds('2026-09')).toEqual({ start: '2026-09-01', end: '2026-09-30' })
    expect(monthBounds('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
    expect(monthBounds('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(monthBounds('2026-12')).toEqual({ start: '2026-12-01', end: '2026-12-31' })
    expect(monthBounds('2026-13')).toBeNull()
    expect(monthBounds('Sept')).toBeNull()
  })

  it('periodWithinOneMonth: one calendar month, ordered, inside the service month', () => {
    expect(periodWithinOneMonth('2026-09-01', '2026-09-30')).toBe(true)
    expect(periodWithinOneMonth('2026-09-15', '2026-09-15', '2026-09')).toBe(true)
    expect(periodWithinOneMonth('2026-09-28', '2026-10-03')).toBe(false) // spans two months
    expect(periodWithinOneMonth('2026-09-20', '2026-09-10')).toBe(false) // backwards
    expect(periodWithinOneMonth('2026-09-01', '2026-09-30', '2026-10')).toBe(false) // wrong month
    expect(periodWithinOneMonth(null, '2026-09-30')).toBe(false)
    expect(periodWithinOneMonth('9/1/26', '2026-09-30')).toBe(false)
  })

  it('registerPeriod: service month intersected with the run period', () => {
    // A weekly run inside one month.
    expect(registerPeriod('2026-09', '2026-09-07', '2026-09-13', ['2026-09-08'])).toEqual({ start: '2026-09-07', end: '2026-09-13' })
    // A run spanning September and October: each client invoice gets its own month's slice.
    expect(registerPeriod('2026-09', '2026-09-28', '2026-10-04', ['2026-09-29'])).toEqual({ start: '2026-09-28', end: '2026-09-30' })
    expect(registerPeriod('2026-10', '2026-09-28', '2026-10-04', ['2026-10-02'])).toEqual({ start: '2026-10-01', end: '2026-10-04' })
  })

  it('registerPeriod: widened to a late item dated before the run, never leaving the month', () => {
    // Vendor-portal late item: run Oct 1-15, item Sep 20 lands in the September invoice.
    expect(registerPeriod('2026-09', '2026-10-01', '2026-10-15', ['2026-09-20'])).toEqual({ start: '2026-09-20', end: '2026-09-30' })
  })

  it('registerPeriod: whole month without a run period or with an empty intersection', () => {
    expect(registerPeriod('2026-09', null, null, [])).toEqual({ start: '2026-09-01', end: '2026-09-30' })
    expect(registerPeriod('2026-09', '2026-10-01', '2026-10-15', [])).toEqual({ start: '2026-09-01', end: '2026-09-30' })
    expect(registerPeriod('bad', '2026-10-01', '2026-10-15', [])).toBeNull()
  })

  it('every period registerPeriod produces passes the one-month rule', () => {
    const cases: Array<[string, string | null, string | null, string[]]> = [
      ['2026-09', '2026-08-25', '2026-10-05', ['2026-09-03']],
      ['2026-02', '2026-01-30', '2026-03-02', []],
      ['2026-12', '2026-12-29', '2027-01-04', ['2026-12-30']],
    ]
    for (const [m, s, e, d] of cases) {
      const p = registerPeriod(m, s, e, d)!
      expect(periodWithinOneMonth(p.start, p.end, m)).toBe(true)
    }
  })
})

describe('preSendExceptions', () => {
  it('a clean approved invoice has no exceptions', () => {
    expect(preSendExceptions(input())).toEqual([])
  })

  it('judges every run source the same way (exported runs included)', () => {
    // Vendor-portal, CSV and generated runs are judged only on their lines.
    expect(preSendExceptions(input({ run: { status: 'exported', archivedAt: null } }))).toEqual([])
  })

  it('client invoice must be approved; a missing row counts as held', () => {
    expect(codes(input({ invoice: { status: null, serviceMonth: '2026-09' } }))).toEqual(['client_invoice_not_approved'])
    expect(codes(input({ invoice: { status: 'held', serviceMonth: '2026-09' } }))).toEqual(['client_invoice_not_approved'])
    expect(preSendExceptions(input({ invoice: { status: 'sent', serviceMonth: '2026-09' } }))[0].message).toMatch(/already sent/)
  })

  it('run must be approved or exported and not archived', () => {
    expect(codes(input({ run: { status: 'review_needed' } }))).toEqual(['run_not_approved'])
    expect(codes(input({ run: { status: 'void' } }))).toEqual(['run_not_approved'])
    expect(codes(input({ run: { status: 'approved', archivedAt: '2026-10-01T00:00:00Z' } }))).toEqual(['run_archived'])
  })

  it('needs_review lines block, one entry per vendor line', () => {
    const ex = preSendExceptions(input({
      lines: [line({ reviewStatus: 'needs_review' }), line({ reviewStatus: 'needs_review', clientChargeAmount: 50 }), line({ lineNo: 2, clientChargeAmount: 0.5 })],
      confirmedTotal: null,
    }))
    expect(ex).toEqual([{ code: 'needs_review', lineNo: 1, message: 'Line 1 still needs review' }])
  })

  it('a held line blocks, and its charge is left out of the total', () => {
    const i = input({ lines: [line(), line({ lineNo: 2, clientChargeAmount: 50.5, billHoldReason: '  Client disputes ' })], confirmedTotal: 175 })
    expect(sendableTotal(i.lines)).toBe(175)
    const ex = preSendExceptions(i)
    expect(ex.map(e => e.code)).toEqual(['held_line'])
    expect(ex[0]).toMatchObject({ lineNo: 2, message: 'Line 2 is held from billing (Client disputes); release it before sending' })
  })

  it('note-required flags need a review note on the line', () => {
    for (const flag of NOTE_REQUIRED_FLAGS) {
      expect(codes(input({ lines: [line({ flags: [flag] })], confirmedTotal: 175 }))).toEqual(['note_required'])
      expect(codes(input({ lines: [line({ flags: [flag], reviewNote: 'Owner agreed by text 9/12' })], confirmedTotal: 175 }))).toEqual([])
      expect(codes(input({ lines: [line({ flags: [flag], reviewNote: '   ' })], confirmedTotal: 175 }))).toEqual(['note_required'])
    }
  })

  it('other flags never need a note; a note on any split row resolves the line', () => {
    expect(codes(input({ lines: [line({ flags: ['standard_priced', 'owner_stay'] })], confirmedTotal: 175 }))).toEqual([])
    const split = [line({ flags: ['redo_pending'], reviewNote: 'Redo done 9/14' }), line({ flags: ['redo_pending'], clientChargeAmount: 50 })]
    expect(codes(input({ lines: split, confirmedTotal: 225 }))).toEqual([])
  })

  it('lists every note-required flag on the line, sorted', () => {
    const ex = preSendExceptions(input({ lines: [line({ flags: ['redo_pending', 'not_haven_listing'] })], confirmedTotal: 175 }))
    expect(ex[0].message).toBe('Line 1 is flagged not_haven_listing, redo_pending and needs a review note saying how it was resolved')
  })

  it('lines dated outside the service month block (undated lines do not)', () => {
    const ex = preSendExceptions(input({ lines: [line({ serviceDate: '2026-10-01' }), line({ lineNo: 2, serviceDate: null, clientChargeAmount: 50.5 })] }))
    expect(ex).toEqual([{ code: 'line_outside_month', lineNo: 1, message: 'Line 1 is dated 2026-10-01, outside 2026-09' }])
  })

  it('total must be positive and match the confirmed total', () => {
    expect(codes(input({ lines: [line({ clientChargeAmount: -20 })], confirmedTotal: -20 }))).toEqual(['total_not_positive'])
    expect(codes(input({ lines: [], confirmedTotal: null }))).toEqual(['no_lines'])
    expect(codes(input({ confirmedTotal: 225.49 }))).toEqual(['total_mismatch'])
    expect(codes(input({ confirmedTotal: 225.504 }))).toEqual([]) // rounds to the cent
    expect(codes(input({ confirmedTotal: null }))).toEqual([])
  })

  it('an every-line-held invoice reports the hold and the $0 total', () => {
    const ex = codes(input({ lines: [line({ billHoldReason: 'Waiting on owner' })], confirmedTotal: null }))
    expect(ex).toEqual(['held_line', 'total_not_positive'])
  })

  it('a number already in the register blocks', () => {
    const ex = preSendExceptions(input({ registered: { clientName: 'Jane Client', sentAt: '2026-09-30T14:00:00Z' } }))
    expect(ex).toEqual([{ code: 'already_registered', message: 'This invoice number was already recorded as sent to Jane Client on 2026-09-30' }])
  })

  it('reports every problem at once, invoice-level ones first', () => {
    const ex = codes(input({
      run: { status: 'reconciled', archivedAt: '2026-10-01T00:00:00Z' },
      invoice: { status: 'held', serviceMonth: '2026-09' },
      lines: [line({ lineNo: 3, reviewStatus: 'needs_review', billHoldReason: 'x' })],
      confirmedTotal: 10,
      registered: { clientName: null, sentAt: null },
    }))
    expect(ex).toEqual(['client_invoice_not_approved', 'run_not_approved', 'run_archived', 'needs_review', 'held_line', 'total_not_positive', 'total_mismatch', 'already_registered'])
  })
})

describe('request fields', () => {
  it('sha256: lowercase hex only', () => {
    expect(normalizeSha256(` ${'AB'.repeat(32)} `)).toBe('ab'.repeat(32))
    expect(normalizeSha256('abc')).toBeNull()
    expect(normalizeSha256('g'.repeat(64))).toBeNull()
    expect(normalizeSha256(42)).toBeNull()
  })

  it('recipient: trimmed, blank is null, capped', () => {
    expect(normalizeRecipient('  billing@example.com ')).toBe('billing@example.com')
    expect(normalizeRecipient('  ')).toBeNull()
    expect(normalizeRecipient(null)).toBeNull()
    expect(normalizeRecipient('x'.repeat(400))).toHaveLength(320)
  })

  it('parseMarkSentExtras: all optional; a bad hash or total is refused', () => {
    expect(parseMarkSentExtras({})).toEqual({ ok: true, value: { recipient: null, pdfSha256: null, confirmedTotal: null } })
    expect(parseMarkSentExtras({ recipient: 'a@example.com', pdf_sha256: HASH.toUpperCase(), total: '225.504' }))
      .toEqual({ ok: true, value: { recipient: 'a@example.com', pdfSha256: HASH, confirmedTotal: 225.5 } })
    expect(parseMarkSentExtras({ pdf_sha256: 'not-a-hash' }).ok).toBe(false)
    expect(parseMarkSentExtras({ total: 'abc' }).ok).toBe(false)
    expect(parseMarkSentExtras({ pdf_sha256: '', total: '' }).ok).toBe(true)
  })

  it('presend_check parses with or without a number', () => {
    const base = { action: 'presend_check', run_id: '33333333-3333-4333-8333-333333333333', contact_id: '11111111-1111-4111-8111-111111111111', service_month: '2026-09' }
    expect(parseBillComAction(base)).toMatchObject({ ok: true, value: { action: 'presend_check', billcomInvoiceNumber: null } })
    expect(parseBillComAction({ ...base, billcom_invoice_number: ' 10452 ' })).toMatchObject({ ok: true, value: { billcomInvoiceNumber: '10452' } })
    expect(parseBillComAction({ ...base, service_month: '2026-9' }).ok).toBe(false)
  })

  it('shortHash and missing-function detection', () => {
    expect(shortHash(HASH)).toBe('aaaaaaaa…aaaa')
    expect(shortHash(null)).toBe('-')
    expect(isMissingFunctionError({ code: 'PGRST202', message: 'Could not find the function public.client_invoice_mark_sent' })).toBe(true)
    expect(isMissingFunctionError({ message: 'Could not find the function public.x(a) in the schema cache' })).toBe(true)
    expect(isMissingFunctionError({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isMissingFunctionError(null)).toBe(false)
  })
})
