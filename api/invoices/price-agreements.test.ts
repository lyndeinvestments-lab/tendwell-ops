import { describe, expect, it } from 'vitest'
import {
  agreedPriceKind,
  applyPriceAgreements,
  FLAGS,
  priceAgreementMismatch,
  reconcile,
  type EngineInput,
  type EngineLine,
  type PriceAgreement,
  type PropertyRates,
  type RawLine,
  type TaskRow,
} from './_engine.js'
import { loadPriceAgreements } from './_lib.js'

const AGREED: PriceAgreement = {
  cleanPrice: 150,
  linenFee: 35,
  onboardingFee: 50,
  acceptedDate: '2026-09-01',
  sourceLink: 'https://example.com/quote/42',
}

const BASE_PROPS: PropertyRates[] = [
  { id: 1, name: 'Michael Rohwer 2455', ceCharged: 150, cleanerPay: 100, deepClean3xCe: 450, billingChannel: 'qbo_haven' },
  { id: 2, name: 'Brandi Tropf 2505', ceCharged: 200, cleanerPay: 140, deepClean3xCe: 600, billingChannel: 'bill_com' },
]

const TASKS: TaskRow[] = [
  { externalId: 't1', propertyId: 1, dueDate: '2026-08-05', title: 'Departure Clean', isClean: true, isDeepClean: false, totalCostRef: null, completed: true },
  { externalId: 't2', propertyId: 2, dueDate: '2026-08-07', title: 'Deep Clean', isClean: false, isDeepClean: true, totalCostRef: null, completed: true },
  { externalId: 't3', propertyId: 2, dueDate: '2026-08-05', title: 'Onboarding Clean', isClean: true, isDeepClean: false, totalCostRef: null, completed: true },
]

function props(agreement: Partial<Record<number, PriceAgreement>>): PropertyRates[] {
  return BASE_PROPS.map(p => (agreement[p.id] ? { ...p, priceAgreement: agreement[p.id] } : p))
}

function input(lines: RawLine[], properties: PropertyRates[]): EngineInput {
  return { vendorId: 'busybee', lines, aliases: [], properties, tasks: TASKS, periodStart: '2026-08-03', periodEnd: '2026-08-09' }
}

function vendorLine(partial: Partial<RawLine>): RawLine {
  return { lineNo: 1, source: 'vendor', rawPropertyText: 'Michael Rohwer 2455', rawNoteText: null, rawAmount: 100, rawDateMentioned: '2026-08-05', ...partial }
}

function engineLine(partial: Partial<EngineLine>): EngineLine {
  return {
    lineNo: 1, source: 'vendor', rawPropertyText: null, rawNoteText: null, rawAmount: 0, rawDateMentioned: null,
    splitGroup: null, propertyId: 1, aliasConfidence: null, matchedTaskId: null, serviceType: 'Turn Clean',
    lineKind: 'clean', cleanerPayAmount: 100, clientChargeAmount: 150, billingChannel: 'qbo_haven',
    flags: [], reviewStatus: 'ok', engineNote: null,
    ...partial,
  }
}

describe('agreedPriceKind', () => {
  it('maps clean, onboarding surcharge and linen fee lines', () => {
    expect(agreedPriceKind(engineLine({}))).toBe('clean')
    expect(agreedPriceKind(engineLine({ lineKind: 'combined_split', splitGroup: 1 }))).toBe('clean')
    expect(agreedPriceKind(engineLine({ lineKind: 'extra', serviceType: 'Onboarding Clean', splitGroup: 1, clientChargeAmount: 50 }))).toBe('onboarding')
    expect(agreedPriceKind(engineLine({ lineKind: 'extra', serviceType: 'Linen Fee', clientChargeAmount: 35 }))).toBe('linen')
  })

  it('skips deep cleans, other extras, unbilled and excluded rows', () => {
    expect(agreedPriceKind(engineLine({ lineKind: 'deep_clean', serviceType: 'Deep Clean' }))).toBeNull()
    expect(agreedPriceKind(engineLine({ lineKind: 'extra', serviceType: 'Pet Fee' }))).toBeNull()
    expect(agreedPriceKind(engineLine({ clientChargeAmount: null }))).toBeNull()
    expect(agreedPriceKind(engineLine({ propertyId: null }))).toBeNull()
    expect(agreedPriceKind(engineLine({ lineKind: 'operating_expense' }))).toBeNull()
    expect(agreedPriceKind(engineLine({ reviewStatus: 'excluded' }))).toBeNull()
    // A whole-line "Onboarding" extra with no split is not the surcharge.
    expect(agreedPriceKind(engineLine({ lineKind: 'extra', serviceType: 'Onboarding Clean', splitGroup: null }))).toBeNull()
    // The disputed $0 "not first clean" row is deliberately unbilled.
    expect(agreedPriceKind(engineLine({
      lineKind: 'extra', serviceType: 'Onboarding Clean', splitGroup: 1, clientChargeAmount: 0, flags: [FLAGS.ONBOARDING_NOT_FIRST_CLEAN],
    }))).toBeNull()
  })
})

describe('priceAgreementMismatch', () => {
  it('returns null with no agreement, or when the agreement does not cover the kind', () => {
    expect(priceAgreementMismatch(engineLine({ clientChargeAmount: 999 }), undefined)).toBeNull()
    expect(priceAgreementMismatch(engineLine({ clientChargeAmount: 999 }), { ...AGREED, cleanPrice: null })).toBeNull()
  })

  it('tolerates up to one cent', () => {
    expect(priceAgreementMismatch(engineLine({ clientChargeAmount: 150.01 }), AGREED)).toBeNull()
    expect(priceAgreementMismatch(engineLine({ clientChargeAmount: 149.99 }), AGREED)).toBeNull()
    expect(priceAgreementMismatch(engineLine({ clientChargeAmount: 150.02 }), AGREED)).not.toBeNull()
  })

  it('writes the agreed price, date, link and billed amount into the note', () => {
    const m = priceAgreementMismatch(engineLine({ clientChargeAmount: 165 }), AGREED)!
    expect(m).toMatchObject({ kind: 'clean', agreed: 150, billed: 165 })
    expect(m.note).toMatch(/^Agreed \$150\.00 on 2026-09-01 \(https:\/\/example\.com\/quote\/42\), billed \$165\.00/)
    expect(m.note).not.toContain(String.fromCharCode(0x2014))
  })

  it('leaves out a missing date or link rather than printing a placeholder', () => {
    const m = priceAgreementMismatch(engineLine({ clientChargeAmount: 165 }), { ...AGREED, acceptedDate: null, sourceLink: null })!
    expect(m.note).toMatch(/^Agreed \$150\.00, billed \$165\.00/)
  })

  it('checks the linen fee and onboarding fee against their own agreed numbers', () => {
    expect(priceAgreementMismatch(engineLine({ lineKind: 'extra', serviceType: 'Linen Fee', clientChargeAmount: 40 }), AGREED)?.agreed).toBe(35)
    expect(priceAgreementMismatch(engineLine({ lineKind: 'extra', serviceType: 'Onboarding Clean', splitGroup: 1, clientChargeAmount: 75 }), AGREED)?.agreed).toBe(50)
  })
})

describe('applyPriceAgreements', () => {
  it('sends a mismatch to review and appends to an existing note', () => {
    const byId = new Map(props({ 1: AGREED }).map(p => [p.id, p]))
    const [out] = applyPriceAgreements([engineLine({ clientChargeAmount: 165, engineNote: 'Something else.' })], byId)
    expect(out.reviewStatus).toBe('needs_review')
    expect(out.flags).toContain(FLAGS.PRICE_MISMATCH_AGREEMENT)
    expect(out.engineNote).toMatch(/^Something else\. Agreed \$150\.00/)
  })

  it('leaves agreeing lines and clients with no agreement untouched', () => {
    const byId = new Map(props({ 1: AGREED }).map(p => [p.id, p]))
    const ok = engineLine({ clientChargeAmount: 150 })
    const noAgreement = engineLine({ propertyId: 2, clientChargeAmount: 1 })
    expect(applyPriceAgreements([ok, noAgreement], byId)).toEqual([ok, noAgreement])
  })
})

describe('reconcile with agreed prices', () => {
  it('flags a clean billed at Client Charged when the client agreed a different price', () => {
    const { lines, summary } = reconcile(input([vendorLine({})], props({ 1: { ...AGREED, cleanPrice: 140 } })))
    expect(lines[0].clientChargeAmount).toBe(150)
    expect(lines[0].flags).toContain(FLAGS.PRICE_MISMATCH_AGREEMENT)
    expect(lines[0].reviewStatus).toBe('needs_review')
    expect(lines[0].engineNote).toContain('Agreed $140.00 on 2026-09-01 (https://example.com/quote/42), billed $150.00')
    expect(summary.needsReviewCount).toBe(1)
  })

  it('does not flag a clean that matches the agreement, nor a client with none', () => {
    expect(reconcile(input([vendorLine({})], props({ 1: AGREED }))).lines[0].flags).not.toContain(FLAGS.PRICE_MISMATCH_AGREEMENT)
    const none = reconcile(input([vendorLine({})], props({}))).lines[0]
    expect(none.flags).not.toContain(FLAGS.PRICE_MISMATCH_AGREEMENT)
    expect(none.reviewStatus).toBe('ok')
  })

  it('checks the onboarding surcharge row against the agreed onboarding fee', () => {
    const line = vendorLine({ rawPropertyText: 'Brandi Tropf 2505', rawAmount: 140 })
    const { lines } = reconcile(input([line], props({ 2: { ...AGREED, cleanPrice: 200, onboardingFee: 75 } })))
    const surcharge = lines.find(l => l.lineKind === 'extra' && l.serviceType === 'Onboarding Clean')!
    const base = lines.find(l => l.lineKind === 'combined_split')!
    expect(surcharge.flags).toContain(FLAGS.PRICE_MISMATCH_AGREEMENT)
    expect(surcharge.engineNote).toContain('Agreed $75.00')
    expect(base.flags).not.toContain(FLAGS.PRICE_MISMATCH_AGREEMENT)
  })

  it('never checks a deep clean against the clean price', () => {
    const line = vendorLine({ rawPropertyText: 'Brandi Tropf 2505', rawAmount: 564, rawDateMentioned: '2026-08-07' })
    const { lines } = reconcile(input([line], props({ 2: { ...AGREED, cleanPrice: 1 } })))
    expect(lines[0].lineKind).toBe('deep_clean')
    expect(lines[0].flags).not.toContain(FLAGS.PRICE_MISMATCH_AGREEMENT)
  })
})

describe('loadPriceAgreements', () => {
  function fakeSupabase(result: { data: unknown[] | null; error: { message: string; code?: string } | null }) {
    const q = { select: () => q, order: () => q, range: () => Promise.resolve(result) }
    return { from: () => q } as never
  }

  it('reads as "no agreements" before the migration is applied', async () => {
    for (const code of ['42P01', 'PGRST205', '42703', 'PGRST204']) {
      const m = await loadPriceAgreements(fakeSupabase({ data: null, error: { message: 'missing', code } }))
      expect(m.size).toBe(0)
    }
  })

  it('throws on any other failure', async () => {
    await expect(loadPriceAgreements(fakeSupabase({ data: null, error: { message: 'timeout', code: '57014' } }))).rejects.toThrow(/timeout/)
  })

  it('maps rows by client', async () => {
    const m = await loadPriceAgreements(fakeSupabase({
      data: [{ id: 'a', contact_id: 'c1', accepted_clean_price: '150.00', linen_fee: null, onboarding_fee: 50, accepted_date: '2026-09-01', source_link: 'https://example.com/q' }],
      error: null,
    }))
    expect(m.get('c1')).toEqual({ cleanPrice: 150, linenFee: null, onboardingFee: 50, acceptedDate: '2026-09-01', sourceLink: 'https://example.com/q' })
  })
})
