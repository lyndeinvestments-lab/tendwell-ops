import { describe, expect, it } from 'vitest'
import {
  FLAGS,
  checkChargeChanged,
  checkHavenListing,
  havenListingIdsFromRows,
  lastChargeIndex,
  reconcile,
  type EngineInput,
  type EngineLine,
  type PreviousCharge,
  type PropertyRates,
  type RawLine,
  type TaskRow,
} from './_engine.js'
import { isMissingSchemaError } from './_lib.js'

function el(partial: Partial<EngineLine> = {}): EngineLine {
  return {
    lineNo: 1,
    source: 'vendor',
    rawPropertyText: 'Alpha Cabin',
    rawNoteText: null,
    rawAmount: 140,
    rawDateMentioned: '2026-08-05',
    splitGroup: null,
    propertyId: 1,
    aliasConfidence: 1,
    matchedTaskId: 't1',
    serviceType: 'Departure Clean',
    lineKind: 'clean',
    cleanerPayAmount: 140,
    clientChargeAmount: 200,
    billingChannel: 'qbo_haven',
    flags: [],
    reviewStatus: 'ok',
    engineNote: null,
    ...partial,
  }
}

const prev = (partial: Partial<PreviousCharge> = {}): PreviousCharge => ({
  propertyId: 1,
  serviceType: 'Departure Clean',
  charge: 190,
  date: '2026-07-29',
  ref: 'invoice 1095',
  ...partial,
})

describe('lastChargeIndex', () => {
  it('keeps only the most recent date per property + service', () => {
    const idx = lastChargeIndex([
      prev({ charge: 180, date: '2026-07-01', ref: 'invoice 1090' }),
      prev({ charge: 190, date: '2026-07-29', ref: 'invoice 1095' }),
      prev({ charge: 185, date: '2026-07-15', ref: 'invoice 1092' }),
    ])
    expect(idx.get('1|Departure Clean')).toEqual({ date: '2026-07-29', ref: 'invoice 1095', charges: [190] })
  })

  it('keeps every distinct charge on the latest date (onboarding base + surcharge)', () => {
    const idx = lastChargeIndex([
      prev({ serviceType: 'Onboarding Clean', charge: 200, date: '2026-07-29' }),
      prev({ serviceType: 'Onboarding Clean', charge: 50, date: '2026-07-29' }),
      prev({ serviceType: 'Onboarding Clean', charge: 50, date: '2026-07-29' }),
    ])
    expect(idx.get('1|Onboarding Clean')?.charges).toEqual([200, 50])
  })

  it('ignores $0 charges and treats an absent list as empty', () => {
    expect(lastChargeIndex([prev({ charge: 0 })]).size).toBe(0)
    expect(lastChargeIndex(undefined).size).toBe(0)
  })
})

describe('checkChargeChanged', () => {
  const idx = lastChargeIndex([prev()])

  it('flags a different charge, requires review and names the old and new price', () => {
    const out = checkChargeChanged(el(), idx)
    expect(out.flags).toContain(FLAGS.CHARGE_CHANGED_SINCE_LAST_INVOICE)
    expect(out.reviewStatus).toBe('needs_review')
    expect(out.engineNote).toContain('Charge changed: was $190.00 on 2026-07-29 (invoice 1095), now $200.00')
  })

  it('does not flag an identical charge (to the penny)', () => {
    expect(checkChargeChanged(el({ clientChargeAmount: 190.004 }), idx).flags).toEqual([])
  })

  it('does not flag a different service, a different property, or no history', () => {
    expect(checkChargeChanged(el({ serviceType: 'Turn Clean' }), idx).flags).toEqual([])
    expect(checkChargeChanged(el({ propertyId: 2 }), idx).flags).toEqual([])
    expect(checkChargeChanged(el(), new Map()).flags).toEqual([])
  })

  it('skips lines that are not billed to a client', () => {
    expect(checkChargeChanged(el({ clientChargeAmount: null }), idx).flags).toEqual([])
    expect(checkChargeChanged(el({ clientChargeAmount: 0 }), idx).flags).toEqual([])
    expect(checkChargeChanged(el({ lineKind: 'operating_expense' }), idx).flags).toEqual([])
    expect(checkChargeChanged(el({ lineKind: 'excluded', reviewStatus: 'excluded' }), idx).flags).toEqual([])
    expect(checkChargeChanged(el({ propertyId: null }), idx).flags).toEqual([])
    expect(checkChargeChanged(el({ serviceType: null }), idx).flags).toEqual([])
  })

  it('appends to an existing engine note instead of replacing it', () => {
    const out = checkChargeChanged(el({ engineNote: 'Standard price applied.' }), idx)
    expect(out.engineNote?.startsWith('Standard price applied. Charge changed:')).toBe(true)
  })
})

describe('checkHavenListing', () => {
  const listed = new Set([1])

  it('flags a Haven-billed line whose property has no Hostaway listing', () => {
    const out = checkHavenListing(el({ propertyId: 2 }), listed)
    expect(out.flags).toContain(FLAGS.NOT_HAVEN_LISTING)
    expect(out.reviewStatus).toBe('needs_review')
    expect(out.engineNote).toContain('no matched Hostaway listing')
  })

  it('leaves a listed property alone', () => {
    expect(checkHavenListing(el({ propertyId: 1 }), listed).flags).toEqual([])
  })

  it('does nothing when the snapshot is empty or unreadable', () => {
    expect(checkHavenListing(el({ propertyId: 2 }), null).flags).toEqual([])
    expect(checkHavenListing(el({ propertyId: 2 }), undefined).flags).toEqual([])
    expect(checkHavenListing(el({ propertyId: 2 }), new Set()).flags).toEqual([])
  })

  it('only applies to Haven (QBO) lines that have a property', () => {
    expect(checkHavenListing(el({ propertyId: 2, billingChannel: 'bill_com' }), listed).flags).toEqual([])
    expect(checkHavenListing(el({ propertyId: null }), listed).flags).toEqual([])
    expect(checkHavenListing(el({ propertyId: 2, lineKind: 'operating_expense' }), listed).flags).toEqual([])
  })
})

describe('havenListingIdsFromRows', () => {
  it('collects matched property ids and returns null when none match', () => {
    expect(havenListingIdsFromRows([{ property_id: 1 }, { property_id: '7' }, { property_id: null }])).toEqual(new Set([1, 7]))
    expect(havenListingIdsFromRows([{ property_id: null }])).toBeNull()
    expect(havenListingIdsFromRows([])).toBeNull()
    expect(havenListingIdsFromRows(undefined)).toBeNull()
  })
})

describe('reconcile wiring', () => {
  const props: PropertyRates[] = [
    { id: 1, name: 'Alpha Cabin', ceCharged: 200, cleanerPay: 140, deepClean3xCe: null, billingChannel: 'qbo_haven' },
    { id: 2, name: 'Beta Cabin', ceCharged: 150, cleanerPay: 100, deepClean3xCe: null, billingChannel: 'qbo_haven' },
  ]
  const tasks: TaskRow[] = [
    { externalId: 't1', propertyId: 1, dueDate: '2026-08-05', title: 'Departure Clean', isClean: true, isDeepClean: false, totalCostRef: null, completed: true, source: 'breezeway' },
    { externalId: 't2', propertyId: 2, dueDate: '2026-08-05', title: 'Departure Clean', isClean: true, isDeepClean: false, totalCostRef: null, completed: true, source: 'breezeway' },
  ]
  const line = (lineNo: number, name: string, amount: number): RawLine => ({
    lineNo, source: 'vendor', rawPropertyText: name, rawNoteText: null, rawAmount: amount, rawDateMentioned: '2026-08-05',
  })
  const base = (over: Partial<EngineInput>): EngineInput => ({
    vendorId: 'busybee',
    lines: [line(1, 'Alpha Cabin', 140), line(2, 'Beta Cabin', 100)],
    aliases: [],
    properties: props,
    tasks,
    periodStart: '2026-08-03',
    periodEnd: '2026-08-09',
    ...over,
  })

  it('flags only the line whose charge moved, and only the property with no listing', () => {
    const { lines, summary } = reconcile(base({
      previousCharges: [prev({ propertyId: 1, charge: 190 }), prev({ propertyId: 2, charge: 150 })],
      havenListingPropertyIds: new Set([1]),
    }))
    const alpha = lines.find(l => l.propertyId === 1)!
    const beta = lines.find(l => l.propertyId === 2)!
    expect(alpha.flags).toContain(FLAGS.CHARGE_CHANGED_SINCE_LAST_INVOICE)
    expect(alpha.flags).not.toContain(FLAGS.NOT_HAVEN_LISTING)
    expect(beta.flags).toContain(FLAGS.NOT_HAVEN_LISTING)
    expect(beta.flags).not.toContain(FLAGS.CHARGE_CHANGED_SINCE_LAST_INVOICE)
    expect(summary.needsReviewCount).toBe(2)
  })

  it('behaves exactly as before when no history or listings are supplied', () => {
    const plain = reconcile(base({}))
    const withNulls = reconcile(base({ previousCharges: [], havenListingPropertyIds: null }))
    expect(withNulls).toEqual(plain)
    expect(plain.lines.every(l => !l.flags.includes(FLAGS.CHARGE_CHANGED_SINCE_LAST_INVOICE) && !l.flags.includes(FLAGS.NOT_HAVEN_LISTING))).toBe(true)
  })
})

describe('isMissingSchemaError', () => {
  it('recognizes the Postgres and PostgREST missing-object codes', () => {
    for (const code of ['42P01', '42703', 'PGRST204', 'PGRST205']) {
      expect(isMissingSchemaError(Object.assign(new Error('boom'), { code }))).toBe(true)
    }
  })

  it('recognizes the message text when no code survived', () => {
    expect(isMissingSchemaError(new Error('relation "public.property_rate_history" does not exist'))).toBe(true)
    expect(isMissingSchemaError(new Error("Could not find the table 'public.x' in the schema cache"))).toBe(true)
  })

  it('does not swallow unrelated errors', () => {
    expect(isMissingSchemaError(new Error('connection reset'))).toBe(false)
    expect(isMissingSchemaError(Object.assign(new Error('permission denied'), { code: '42501' }))).toBe(false)
    expect(isMissingSchemaError(null)).toBe(false)
  })
})
