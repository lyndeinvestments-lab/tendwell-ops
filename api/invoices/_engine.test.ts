import { describe, expect, it } from 'vitest'
import {
  extractDateFromText,
  extraTitleFromNote,
  FLAGS,
  generateDraftLines,
  matchToTask,
  reconcile,
  resolveProperty,
  round2,
  similarity,
  standardizeTitle,
  validateSubtotal,
  type AliasRow,
  type EngineInput,
  type PropertyRates,
  type RawLine,
  type TaskRow,
} from './_engine.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PROPS: PropertyRates[] = [
  { id: 1, name: 'Michael Rohwer 2455', ceCharged: 150, cleanerPay: 100, deepClean3xCe: 450, billingChannel: 'qbo_haven' },
  { id: 2, name: 'Brandi Tropf 2505', ceCharged: 200, cleanerPay: 140, deepClean3xCe: null, billingChannel: 'qbo_haven' },
  { id: 3, name: 'Ctn Black Bear Cub', ceCharged: 120, cleanerPay: 80, deepClean3xCe: 360, billingChannel: 'bill_com' },
  { id: 4, name: 'No Contact Cabin', ceCharged: 100, cleanerPay: 70, deepClean3xCe: null, billingChannel: null },
  { id: 5, name: 'Rateless Retreat', ceCharged: null, cleanerPay: null, deepClean3xCe: null, billingChannel: 'qbo_haven' },
]

const ALIASES: AliasRow[] = [
  { aliasRaw: 'Rhower', propertyId: 1, vendorId: 'busybee' },
  { aliasRaw: 'Global Cabin', propertyId: 3, vendorId: null },
]

const TASKS: TaskRow[] = [
  { externalId: 't1', propertyId: 1, dueDate: '2026-08-05', title: 'Departure Clean', isClean: true, isDeepClean: false, totalCostRef: 100 },
  { externalId: 't2', propertyId: 2, dueDate: '2026-08-07', title: 'Deep Clean', isClean: false, isDeepClean: true, totalCostRef: 564 },
  { externalId: 't3', propertyId: 3, dueDate: '2026-08-06', title: 'Turn Clean', isClean: true, isDeepClean: false, totalCostRef: 80 },
  { externalId: 't4', propertyId: 1, dueDate: '2026-08-08', title: 'Cleaner Self-Inspection', isClean: false, isDeepClean: false, totalCostRef: null },
]

function input(lines: RawLine[], overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    vendorId: 'busybee',
    lines,
    aliases: ALIASES,
    properties: PROPS,
    tasks: TASKS,
    periodStart: '2026-08-03',
    periodEnd: '2026-08-09',
    ...overrides,
  }
}

function vendorLine(partial: Partial<RawLine>): RawLine {
  return {
    lineNo: 1,
    source: 'vendor',
    rawPropertyText: 'Michael Rohwer 2455',
    rawNoteText: null,
    rawAmount: 100,
    rawDateMentioned: '2026-08-05',
    ...partial,
  }
}

// ─── Property resolution ─────────────────────────────────────────────────────

describe('resolveProperty', () => {
  it('resolves a vendor-scoped alias exactly (case-insensitive)', () => {
    const r = resolveProperty('rhower', ALIASES, PROPS, 'busybee')
    expect(r).toEqual({ propertyId: 1, confidence: 1, via: 'alias' })
  })

  it('resolves a global alias for any vendor', () => {
    const r = resolveProperty('Global Cabin', ALIASES, PROPS, 'someone-else')
    expect(r.propertyId).toBe(3)
    expect(r.via).toBe('alias')
  })

  it('resolves an exact canonical name', () => {
    const r = resolveProperty('Brandi Tropf 2505', ALIASES, PROPS, 'busybee')
    expect(r).toEqual({ propertyId: 2, confidence: 1, via: 'exact' })
  })

  it('fuzzy-resolves a close misspelling above threshold', () => {
    const r = resolveProperty('Brandi Tropf 2505 ', ALIASES, PROPS, 'busybee')
    expect(r.propertyId).toBe(2)
  })

  it('fuzzy-resolves a name subset ("Brandi Tropf")', () => {
    const r = resolveProperty('Brandi Tropf', ALIASES, PROPS, 'busybee')
    expect(r.propertyId).toBe(2)
    expect(r.via).toBe('fuzzy')
  })

  it('never guesses below threshold', () => {
    const r = resolveProperty('Completely Unknown Chalet', ALIASES, PROPS, 'busybee')
    expect(r.propertyId).toBeNull()
  })

  it('returns null for empty text', () => {
    expect(resolveProperty(null, ALIASES, PROPS, 'busybee').propertyId).toBeNull()
    expect(resolveProperty('  ', ALIASES, PROPS, 'busybee').propertyId).toBeNull()
  })
})

describe('similarity', () => {
  it('is 1 for identical normalized strings', () => {
    expect(similarity('Rohwer!', 'rohwer')).toBe(1)
  })
  it('scores subsets high via containment', () => {
    expect(similarity('Rohwer', 'Michael Rohwer 2455')).toBeGreaterThanOrEqual(0.9)
  })
})

// ─── Text helpers ────────────────────────────────────────────────────────────

describe('extractDateFromText', () => {
  it('parses m/d/yy inside a note', () => {
    expect(extractDateFromText('Deep clean on 8/7/26')).toBe('2026-08-07')
  })
  it('parses m/d/yyyy', () => {
    expect(extractDateFromText('done 12/31/2026 late')).toBe('2026-12-31')
  })
  it('rejects invalid month/day', () => {
    expect(extractDateFromText('13/45/26')).toBeNull()
  })
  it('returns null with no date', () => {
    expect(extractDateFromText('regular clean')).toBeNull()
  })
})

describe('standardizeTitle / extraTitleFromNote', () => {
  it('maps base titles', () => {
    expect(standardizeTitle('Departure Clean - HT')?.title).toBe('Departure Clean')
    expect(standardizeTitle('Same Day Turn')?.title).toBe('Turn Clean')
    expect(standardizeTitle('Last Clean & Linen Pull')?.title).toBe('Last Clean & Linen Pull')
  })
  it('flags Double Clean as an extra', () => {
    expect(standardizeTitle('Double Clean')).toEqual({ title: 'Double Clean', isExtra: true })
  })
  it('maps note keywords to extra titles', () => {
    expect(extraTitleFromNote('regular clean plus extra trash charge')).toBe('Excessive Trash Pickup')
    expect(extraTitleFromNote('hot tub refresh requested')).toBe('Hot Tub Refresh Requested by Guest')
    expect(extraTitleFromNote('nothing to see')).toBeNull()
  })
})

// ─── Subtotal gate ───────────────────────────────────────────────────────────

describe('validateSubtotal', () => {
  it('passes to the penny', () => {
    expect(validateSubtotal([{ rawAmount: 564 }, { rawAmount: 320 }], 884).ok).toBe(true)
  })
  it('fails on a one-cent mismatch', () => {
    const r = validateSubtotal([{ rawAmount: 564 }, { rawAmount: 320.01 }], 884)
    expect(r.ok).toBe(false)
    expect(r.diff).toBe(0.01)
  })
  it('passes when no stated subtotal exists', () => {
    expect(validateSubtotal([{ rawAmount: 1 }], null).ok).toBe(true)
  })
  it('avoids float dust', () => {
    expect(validateSubtotal([{ rawAmount: 0.1 }, { rawAmount: 0.2 }], 0.3).ok).toBe(true)
  })
})

// ─── Task matching ───────────────────────────────────────────────────────────

describe('matchToTask', () => {
  it('matches property + exact date', () => {
    expect(matchToTask(1, '2026-08-05', TASKS, false)?.externalId).toBe('t1')
  })
  it('matches within ±3 days', () => {
    expect(matchToTask(1, '2026-08-07', TASKS, false)?.externalId).toBe('t1')
  })
  it('rejects beyond ±3 days', () => {
    expect(matchToTask(1, '2026-08-20', TASKS, false)).toBeNull()
  })
  it('returns null without a property', () => {
    expect(matchToTask(null, '2026-08-05', TASKS, false)).toBeNull()
  })
})

// ─── Classification & money math (via reconcile) ────────────────────────────

describe('reconcile — money rules', () => {
  it('bills a base clean at Client Charged, not the vendor amount', () => {
    const { lines } = reconcile(input([vendorLine({ rawAmount: 100 })]))
    expect(lines).toHaveLength(1)
    expect(lines[0].lineKind).toBe('clean')
    expect(lines[0].cleanerPayAmount).toBe(100)
    expect(lines[0].clientChargeAmount).toBe(150) // ce_charged, never raw
    expect(lines[0].reviewStatus).toBe('ok')
    expect(lines[0].billingChannel).toBe('qbo_haven')
  })

  it('splits a combined line: base @ Client Charged + extra = invoiced − Cleaner Pay', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 160, rawNoteText: 'Regular clean plus extra trash charge' })]),
    )
    expect(lines).toHaveLength(2)
    const base = lines.find(l => l.lineKind === 'combined_split')!
    const extra = lines.find(l => l.lineKind === 'extra')!
    expect(base.clientChargeAmount).toBe(150)
    expect(base.cleanerPayAmount).toBe(100)
    expect(extra.serviceType).toBe('Excessive Trash Pickup')
    expect(extra.cleanerPayAmount).toBe(60) // 160 − 100
    expect(extra.clientChargeAmount).toBe(60)
    expect(base.splitGroup).not.toBeNull()
    expect(base.splitGroup).toBe(extra.splitGroup)
  })

  it('negative split → whole line becomes a standalone extra (flagged for review), never a negative row', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 40, rawNoteText: 'extra trash pickup only' })]),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].lineKind).toBe('extra')
    expect(lines[0].cleanerPayAmount).toBe(40)
    expect(lines[0].flags).toContain(FLAGS.NEGATIVE_SPLIT_STANDALONE)
    expect(lines[0].reviewStatus).toBe('needs_review')
    expect(lines[0].flags).not.toContain(FLAGS.DISCREPANCY_UNEXPLAINED)
  })

  it('does NOT relabel an underpayment as an extra on a spurious keyword ("no pets seen")', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 40, rawNoteText: 'no pets seen at checkout, everything fine' })]),
    )
    expect(lines[0].lineKind).toBe('clean')
    expect(lines[0].serviceType).not.toBe('Pet Fee')
    expect(lines[0].flags).toContain(FLAGS.DISCREPANCY_UNEXPLAINED)
    expect(lines[0].reviewStatus).toBe('needs_review')
  })

  it('task verdict beats note text: "deep clean of the fridge" on a regular clean → review, not silent 3×', () => {
    const { lines } = reconcile(
      input([
        vendorLine({
          rawAmount: 100,
          rawDateMentioned: '2026-08-05',
          rawNoteText: 'Did a deep clean of the fridge and oven, otherwise normal turn',
        }),
      ]),
    )
    expect(lines[0].matchedTaskId).toBe('t1') // a regular Departure Clean
    expect(lines[0].flags).toContain(FLAGS.DEEP_MISMATCH)
    expect(lines[0].reviewStatus).toBe('needs_review') // never auto-approved either way
  })

  it('deep clean with NO matching task is a review case (large money swing)', () => {
    const { lines } = reconcile(
      input([
        vendorLine({ rawAmount: 300, rawNoteText: 'Deep clean on 8/20/26', rawDateMentioned: null }),
      ]),
    )
    expect(lines[0].lineKind).toBe('deep_clean')
    expect(lines[0].matchedTaskId).toBeNull()
    expect(lines[0].flags).toContain(FLAGS.UNMATCHED_TASK)
    expect(lines[0].reviewStatus).toBe('needs_review')
  })

  it('negative amounts (vendor credits) are never guessed — review with credit_line flag', () => {
    const { lines } = reconcile(input([vendorLine({ rawAmount: -45 })]))
    expect(lines[0].flags).toContain(FLAGS.CREDIT_LINE)
    expect(lines[0].reviewStatus).toBe('needs_review')
    expect(lines[0].cleanerPayAmount).toBe(-45) // passes through to AP, human decides
    expect(lines[0].clientChargeAmount).toBeNull()
  })

  it('flags an unexplained amount mismatch instead of guessing', () => {
    const { lines, summary } = reconcile(input([vendorLine({ rawAmount: 180 })]))
    expect(lines).toHaveLength(1)
    expect(lines[0].reviewStatus).toBe('needs_review')
    expect(lines[0].flags).toContain(FLAGS.DISCREPANCY_UNEXPLAINED)
    expect(summary.needsReviewCount).toBe(1)
  })

  it('bills a deep clean whole at deep_clean_3x_ce (fallback ce×3)', () => {
    const { lines } = reconcile(
      input([
        vendorLine({
          rawPropertyText: 'Brandi Tropf 2505',
          rawNoteText: 'Deep clean on 8/7/26',
          rawAmount: 564,
          rawDateMentioned: null,
        }),
      ]),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].lineKind).toBe('deep_clean')
    expect(lines[0].serviceType).toBe('Deep Clean')
    expect(lines[0].matchedTaskId).toBe('t2') // date pulled from the note
    expect(lines[0].cleanerPayAmount).toBe(564) // paid whole
    expect(lines[0].clientChargeAmount).toBe(600) // no deep_clean_3x_ce → ce 200 × 3
  })

  it('bills Onboarding Clean at Client Charged + $50, paid whole to the vendor', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 253.52, rawNoteText: 'Onboarding clean on 8/20/26 for new cabin', rawDateMentioned: null })]),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].serviceType).toBe('Onboarding Clean')
    expect(lines[0].cleanerPayAmount).toBe(253.52) // vendor paid what they billed
    expect(lines[0].clientChargeAmount).toBe(200) // ce_charged 150 + 50
    expect(lines[0].flags).not.toContain(FLAGS.BILLED_WHOLE)
  })

  it('excludes Cleaner Self-Inspection lines', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawNoteText: 'Cleaner Self-Inspection', rawAmount: 30, rawDateMentioned: '2026-08-08' })]),
    )
    expect(lines[0].lineKind).toBe('excluded')
    expect(lines[0].reviewStatus).toBe('excluded')
    expect(lines[0].clientChargeAmount).toBeNull()
  })

  it('keeps a mislabeled self-inspection within $5 of the clean rate', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawNoteText: 'Cleaner Self-Inspection', rawAmount: 98, rawDateMentioned: '2026-08-05' })]),
    )
    expect(lines[0].lineKind).not.toBe('excluded')
    expect(lines[0].flags).toContain(FLAGS.RELABELED_AS_CLEAN)
  })

  it('routes bulk/non-property lines to operating expenses', () => {
    const { lines, summary } = reconcile(
      input([vendorLine({ rawPropertyText: 'Toilet paper restock — warehouse', rawAmount: 250, rawNoteText: null, rawDateMentioned: null })]),
    )
    expect(lines[0].lineKind).toBe('operating_expense')
    expect(lines[0].cleanerPayAmount).toBe(250) // still owed to the vendor
    expect(lines[0].clientChargeAmount).toBeNull() // never billed to a client
    expect(summary.operatingExpenseTotal).toBe(250)
  })

  it('sends unknown property names to the review queue', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawPropertyText: 'Mystery Chalet 9999', rawAmount: 100 })]),
    )
    expect(lines[0].reviewStatus).toBe('needs_review')
    expect(lines[0].flags).toContain(FLAGS.UNRESOLVED_PROPERTY)
  })

  it('flags lines whose property has no billing channel', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawPropertyText: 'No Contact Cabin', rawAmount: 70, rawDateMentioned: null })]),
    )
    expect(lines[0].flags).toContain(FLAGS.NO_BILLING_CHANNEL)
    expect(lines[0].reviewStatus).toBe('needs_review')
  })

  it('flags missing rates instead of computing garbage', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawPropertyText: 'Rateless Retreat', rawAmount: 90, rawDateMentioned: null })]),
    )
    expect(lines[0].flags).toContain(FLAGS.MISSING_RATE)
    expect(lines[0].reviewStatus).toBe('needs_review')
  })

  it('routes bill.com properties to the bill_com channel', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawPropertyText: 'Ctn Black Bear Cub', rawAmount: 80, rawDateMentioned: '2026-08-06' })]),
    )
    expect(lines[0].billingChannel).toBe('bill_com')
    expect(lines[0].clientChargeAmount).toBe(120)
    expect(lines[0].reviewStatus).toBe('ok')
  })

  it('computes the net over/under position without double-counting splits', () => {
    const { summary } = reconcile(
      input([
        vendorLine({ lineNo: 1, rawAmount: 100 }), // exact
        vendorLine({ lineNo: 2, rawAmount: 160, rawNoteText: 'plus extra trash' }), // split
      ]),
    )
    // Split lines net to zero discrepancy (base 160−100 covered by the extra).
    expect(summary.totalInvoiced).toBe(260)
    expect(summary.netDiscrepancy).toBe(0)
  })
})

// ─── Real-invoice fixture: Busy Bee I260810795 (2026-08-09) ─────────────────
// Two lines, $884.00 total, rates/channels copied from the live DB at build
// time. Until Nina's hand-built golden fixture arrives, this is the canonical
// end-to-end regression for a real vendor invoice.

describe('real Busy Bee invoice I260810795', () => {
  const REAL_PROPS: PropertyRates[] = [
    { id: 505, name: 'Brandi Tropf 2505', ceCharged: 260, cleanerPay: 130, deepClean3xCe: 780, billingChannel: 'bill_com' },
    { id: 284, name: 'CTN-Black Bear Cub', ceCharged: 560, cleanerPay: 320, deepClean3xCe: 1680, billingChannel: 'bill_com' },
  ]
  const REAL_TASKS: TaskRow[] = [
    // Black Bear Cub's missed clean from the prior week; Brandi Tropf's deep
    // clean has NO Breezeway task (true in the live data for that week).
    { externalId: 'bbc-1', propertyId: 284, dueDate: '2026-07-29', title: 'Departure Clean', isClean: true, isDeepClean: false, totalCostRef: 320 },
  ]
  const REAL_LINES: RawLine[] = [
    {
      lineNo: 1,
      source: 'vendor',
      rawPropertyText: 'Brandi Tropf 2505',
      rawNoteText: 'Deep clean on 8/7/26',
      rawAmount: 564,
      rawDateMentioned: null,
    },
    {
      lineNo: 2,
      source: 'vendor',
      rawPropertyText: 'Ctn Black Bear Cub',
      rawNoteText: 'We forgot to add this cabin on last invoice from week 7/27/26 to 8/1/26',
      rawAmount: 320,
      rawDateMentioned: null,
    },
  ]

  const result = reconcile({
    vendorId: 'busybee',
    lines: REAL_LINES,
    aliases: [],
    properties: REAL_PROPS,
    tasks: REAL_TASKS,
    periodStart: '2026-07-27',
    periodEnd: '2026-08-09',
  })

  it('passes the subtotal gate at $884.00', () => {
    expect(validateSubtotal(REAL_LINES, 884).ok).toBe(true)
    expect(result.summary.totalInvoiced).toBe(884)
  })

  it('resolves "Ctn Black Bear Cub" to the hyphenated canonical name without an alias', () => {
    const bbc = result.lines.find(l => l.lineNo === 2)!
    expect(bbc.propertyId).toBe(284)
    expect(bbc.lineKind).toBe('clean')
    expect(bbc.cleanerPayAmount).toBe(320) // vendor amount == cleaner pay
    expect(bbc.clientChargeAmount).toBe(560) // billed at Client Charged
    expect(bbc.billingChannel).toBe('bill_com')
    expect(bbc.matchedTaskId).toBe('bbc-1') // note date 7/27 → task 7/29 (±3d)
    expect(bbc.reviewStatus).toBe('ok')
  })

  it('routes the taskless deep clean to review instead of silently billing $780', () => {
    const deep = result.lines.find(l => l.lineNo === 1)!
    expect(deep.propertyId).toBe(505)
    expect(deep.lineKind).toBe('deep_clean')
    expect(deep.cleanerPayAmount).toBe(564)
    expect(deep.clientChargeAmount).toBe(780) // provisional, pending review
    expect(deep.flags).toContain(FLAGS.UNMATCHED_TASK)
    expect(deep.reviewStatus).toBe('needs_review')
  })

  it('keeps every dollar off the Haven QBO file (both clients are bill.com)', () => {
    expect(result.lines.every(l => l.billingChannel === 'bill_com')).toBe(true)
  })
})

// ─── Draft generation ────────────────────────────────────────────────────────

describe('generateDraftLines', () => {
  it('drafts base cleans at cleaner pay and deep cleans at 3×, sorted by date', () => {
    const propsById = new Map(PROPS.map(p => [p.id, p]))
    const drafts = generateDraftLines(TASKS, propsById)
    expect(drafts).toHaveLength(3) // t4 (self-inspection, not clean/deep) skipped
    expect(drafts[0].rawDateMentioned).toBe('2026-08-05')
    const deep = drafts.find(d => d.rawNoteText?.includes('Deep clean'))!
    expect(deep.rawAmount).toBe(round2(140 * 3))
    const base = drafts.find(d => d.rawPropertyText === 'Michael Rohwer 2455')!
    expect(base.rawAmount).toBe(100)
  })

  it('feeds cleanly back into reconcile (round-trip: draft lines come out ok)', () => {
    const propsById = new Map(PROPS.map(p => [p.id, p]))
    const drafts = generateDraftLines(
      TASKS.filter(t => t.externalId === 't1' || t.externalId === 't3'),
      propsById,
    )
    const { lines, summary } = reconcile(input(drafts.map(d => ({ ...d }))))
    expect(summary.needsReviewCount).toBe(0)
    expect(lines.every(l => l.reviewStatus === 'ok')).toBe(true)
  })
})
