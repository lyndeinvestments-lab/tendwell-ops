import { describe, expect, it } from 'vitest'
import {
  apPayForRatedLine,
  extractDateFromText,
  extraReasonFromNote,
  extraTitleFromNote,
  FLAGS,
  generateDraftLines,
  effectiveNoteText,
  isExcludedTitle,
  isOperatingExpenseText,
  matchToTask,
  standardExtraCharge,
  noteFromPropertyCell,
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

  it('negative split → whole line becomes a standalone extra, never a negative row', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 40, rawNoteText: 'extra trash pickup only' })]),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].lineKind).toBe('extra')
    expect(lines[0].cleanerPayAmount).toBe(40)
    // Standard-priced type (Jordan 2026-08-22): bills the $50 standard charge
    // and needs no review — the price list exists so routine extras flow.
    expect(lines[0].clientChargeAmount).toBe(50)
    expect(lines[0].flags).toContain(FLAGS.STANDARD_PRICED)
    expect(lines[0].reviewStatus).toBe('ok')
    expect(lines[0].flags).not.toContain(FLAGS.DISCREPANCY_UNEXPLAINED)
  })

  it('negative split on an UNPRICED extra type still goes to review', () => {
    // No standard price for generic Extra Cleaning → the old guard stands: a
    // spurious keyword hit would silently underpay the vendor.
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 40, rawNoteText: 'extra work only' })]),
    )
    expect(lines[0].lineKind).toBe('extra')
    expect(lines[0].serviceType).toBe('Extra Cleaning')
    expect(lines[0].clientChargeAmount).toBe(40)
    expect(lines[0].flags).toContain(FLAGS.NEGATIVE_SPLIT_STANDALONE)
    expect(lines[0].reviewStatus).toBe('needs_review')
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

  it('bills Onboarding Clean as TWO rows with the $50 on the CLIENT side only', () => {
    // Jordan 2026-08-22: the $50 onboarding surcharge is client-only — if the
    // vendor didn't bill it, we don't pay it. The split exists solely because
    // the QBO invoice needs the surcharge broken out (Nina's #1085 shape);
    // Ramp and bill.com collapse the group back to one line. Vendor billed the
    // plain rate → fully clean, pay = rate.
    const tasks: TaskRow[] = [
      { externalId: 'ob', propertyId: 1, dueDate: '2026-08-05', title: 'Onboarding Clean', isClean: true, isDeepClean: false, totalCostRef: null },
    ]
    const { lines, summary } = reconcile(
      input([vendorLine({ rawAmount: 100, rawNoteText: 'Onboarding clean for new cabin' })], { tasks }),
    )
    expect(lines).toHaveLength(2)
    const [base, surcharge] = lines
    expect(base.serviceType).toBe('Onboarding Clean')
    expect(base.lineKind).toBe('combined_split')
    expect(base.cleanerPayAmount).toBe(100) // the rate — exactly what was billed
    expect(base.clientChargeAmount).toBe(150) // ce_charged
    expect(base.reviewStatus).toBe('ok')
    expect(surcharge.serviceType).toBe('Onboarding Clean')
    expect(surcharge.lineKind).toBe('extra')
    expect(surcharge.cleanerPayAmount).toBeNull() // NOT paid to the vendor
    expect(surcharge.clientChargeAmount).toBe(50)
    expect(surcharge.rawAmount).toBe(0) // not part of the vendor's stated subtotal
    expect(surcharge.splitGroup).toBe(base.splitGroup)
    expect(summary.totalCleanerPay).toBe(100) // rate only, no +50
    expect(summary.totalClientCharge).toBe(200) // 150 + 50
    expect(summary.netDiscrepancy).toBe(0)
  })

  it('pays the $50 surcharge when the vendor billed rate + 50 (every onboarding line on TEST 3–6)', () => {
    // Philip Graves 194.04→244.04, Kumar Sanam 160→210, Jessee Cook 189→239,
    // Danae Downing 302.40→352: Busy Bee bills the onboarding surcharge
    // themselves. They charged it, so we pay it — and nothing queues.
    const tasks: TaskRow[] = [
      { externalId: 'ob', propertyId: 1, dueDate: '2026-08-05', title: 'Onboarding Clean', isClean: true, isDeepClean: false, totalCostRef: null },
    ]
    const { lines, summary } = reconcile(
      input([vendorLine({ rawAmount: 150, rawNoteText: 'Regular clean plus onboarding' })], { tasks }),
    )
    expect(lines).toHaveLength(2)
    const [base, surcharge] = lines
    expect(base.cleanerPayAmount).toBe(100) // the rate
    expect(base.clientChargeAmount).toBe(150)
    expect(base.reviewStatus).toBe('ok')
    expect(base.flags).not.toContain(FLAGS.DISCREPANCY_UNEXPLAINED)
    expect(surcharge.cleanerPayAmount).toBe(50) // billed → paid
    expect(surcharge.clientChargeAmount).toBe(50)
    expect(summary.totalCleanerPay).toBe(150) // sums to the vendor's amount
    expect(summary.netDiscrepancy).toBe(0)
  })

  it('the rounding band applies to the +50 too', () => {
    // Real line (Grant Chamberlain, TEST 5): rate 151.76, billed 202.76 —
    // rate + $51, within $1 of the surcharge. Same treatment.
    const tasks: TaskRow[] = [
      { externalId: 'ob', propertyId: 1, dueDate: '2026-08-05', title: 'Onboarding Clean', isClean: true, isDeepClean: false, totalCostRef: null },
    ]
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 151, rawNoteText: 'Onboarding clean' })], { tasks }),
    )
    const [base, surcharge] = lines
    expect(base.cleanerPayAmount).toBe(100)
    expect(base.reviewStatus).toBe('ok')
    expect(surcharge.cleanerPayAmount).toBe(50)
  })

  it('an onboarding billed at rate + an odd surcharge still queues', () => {
    // Real line (Manish Birla, TEST 6): rate 75, billed 100 — a $25 add-on is
    // neither "didn't charge it" nor the $50 surcharge. A human decides.
    const tasks: TaskRow[] = [
      { externalId: 'ob', propertyId: 1, dueDate: '2026-08-05', title: 'Onboarding Clean', isClean: true, isDeepClean: false, totalCostRef: null },
    ]
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 125, rawNoteText: 'Onboarding clean' })], { tasks }),
    )
    const base = lines.find(l => l.lineKind === 'combined_split')!
    expect(base.reviewStatus).toBe('needs_review')
    expect(base.flags).toContain(FLAGS.DISCREPANCY_UNEXPLAINED)
    expect(base.cleanerPayAmount).toBe(125) // over-billed: pay billed, never cut
    const surcharge = lines.find(l => l.lineKind === 'extra')!
    expect(surcharge.cleanerPayAmount).toBeNull()
  })

  it('flags an onboarding line whose vendor amount is not the Cleaner Pay rate', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 253.52, rawNoteText: 'Onboarding clean on 8/20/26 for new cabin', rawDateMentioned: null })]),
    )
    const base = lines.find(l => l.lineKind === 'combined_split')!
    expect(base.flags).toContain(FLAGS.DISCREPANCY_UNEXPLAINED)
    expect(base.reviewStatus).toBe('needs_review')
    // Over-billed vs the $100 rate: pay what was billed, never cut the invoice.
    expect(base.cleanerPayAmount).toBe(253.52)
    expect(base.flags).not.toContain(FLAGS.PAID_AT_RATE)
    // The client-only surcharge never adds pay.
    const surcharge = lines.find(l => l.lineKind === 'extra')!
    expect(surcharge.cleanerPayAmount).toBeNull()
  })

  // AP rule (Jordan 2026-08-21): the Cleaner Pay rate in Ops is the contract,
  // so it is a FLOOR on what we pay — an under-billing vendor is topped up to
  // rate. Above the rate we pay what was billed rather than cutting their
  // invoice. Net: AP = max(rate, invoiced), gap always flagged.
  it('routine top-ups pay the rate with a flag and NO review', () => {
    // Under-billed, task-matched, billed at least half the rate: Jordan's
    // "pay is the bible" rule applying deterministically — flag for
    // visibility, but ~30 such lines per month were pure review noise.
    const { lines } = reconcile(input([vendorLine({ rawAmount: 60 })]))
    expect(lines[0].flags).toContain(FLAGS.PAID_AT_RATE)
    expect(lines[0].cleanerPayAmount).toBe(100) // the rate, not the $60 billed
    expect(lines[0].clientChargeAmount).toBe(150)
    expect(lines[0].reviewStatus).toBe('ok')
    expect(lines[0].flags).not.toContain(FLAGS.DISCREPANCY_UNEXPLAINED)
  })

  it('a line billed far below the rate is NOT topped up — it pays billed and asks a human', () => {
    // Real case: $30 against a $140 rate is more likely a mislabeled extra
    // with no note than a discounted clean; topping up would manufacture pay.
    const { lines } = reconcile(input([vendorLine({ rawAmount: 30 })]))
    expect(lines[0].cleanerPayAmount).toBe(30)
    expect(lines[0].flags).not.toContain(FLAGS.PAID_AT_RATE)
    expect(lines[0].flags).toContain(FLAGS.DISCREPANCY_UNEXPLAINED)
    expect(lines[0].reviewStatus).toBe('needs_review')
  })

  it('treats a sub-dollar gap from the rate as an exact match, both directions', () => {
    // Busy Bee bills whole dollars; Ops rates carry cents. Real queued pairs:
    // $73.00 vs 73.08, $58.00 vs 58.52, $108.78 vs 108.00.
    const cents: PropertyRates[] = [
      { id: 1, name: 'Michael Rohwer 2455', ceCharged: 175, cleanerPay: 73.08, deepClean3xCe: null, billingChannel: 'qbo_haven' },
    ]
    const under = reconcile(input([vendorLine({ rawAmount: 73 })], { properties: cents })).lines[0]
    expect(under.cleanerPayAmount).toBe(73.08) // pays the rate — the bible
    expect(under.reviewStatus).toBe('ok')
    expect(under.flags).not.toContain(FLAGS.DISCREPANCY_UNEXPLAINED)
    const over = reconcile(input([vendorLine({ rawAmount: 73.99 })], { properties: cents })).lines[0]
    expect(over.cleanerPayAmount).toBe(73.08)
    expect(over.reviewStatus).toBe('ok')
  })

  it('a clean billed exactly at the contract rate passes with only the unmatched-task flag', () => {
    // No task within the window, but the amount IS the contract — flag stays
    // visible, review does not fire (11 such lines per run were noise).
    const { lines } = reconcile(input([vendorLine({ rawAmount: 100 })], { tasks: [] }))
    expect(lines[0].flags).toContain(FLAGS.UNMATCHED_TASK)
    expect(lines[0].cleanerPayAmount).toBe(100)
    expect(lines[0].serviceType).toBe('Turn Clean')
    expect(lines[0].reviewStatus).toBe('ok')
  })

  it('over-billed lines pay what the vendor billed, and are not marked paid_at_rate', () => {
    // We never unilaterally cut a vendor invoice — the overage is a review
    // question, not something the engine silently trims to the rate.
    const { lines } = reconcile(input([vendorLine({ rawAmount: 175 })]))
    expect(lines[0].flags).toContain(FLAGS.DISCREPANCY_UNEXPLAINED)
    expect(lines[0].flags).not.toContain(FLAGS.PAID_AT_RATE)
    expect(lines[0].cleanerPayAmount).toBe(175)
    expect(lines[0].clientChargeAmount).toBe(150)
  })

  it('leaves pay blank when the property has no Cleaner Pay rate', () => {
    // With the rate as the authority, no rate means no authoritative amount —
    // copying the invoiced figure is exactly what this rule removes. approve
    // blocks a billed line with no pay, so a human must resolve it.
    const { lines } = reconcile(input([
      vendorLine({ rawPropertyText: 'Rateless Retreat', rawAmount: 88 }),
    ]))
    expect(lines[0].flags).toContain(FLAGS.MISSING_RATE)
    expect(lines[0].reviewStatus).toBe('needs_review')
    expect(lines[0].cleanerPayAmount).toBeNull()
  })

  it('pays the exact rate without flagging a top-up when amounts agree', () => {
    const { lines } = reconcile(input([vendorLine({ rawAmount: 100 })]))
    expect(lines[0].cleanerPayAmount).toBe(100)
    expect(lines[0].flags).not.toContain(FLAGS.PAID_AT_RATE)
    expect(lines[0].flags).not.toContain(FLAGS.DISCREPANCY_UNEXPLAINED)
  })

  it('generated drafts state the plain Cleaner Pay for onboarding tasks (no self-flag on reconcile)', () => {
    // The $50 surcharge is client-only, so the vendor's expected bill — and
    // therefore the draft — is just the rate.
    const tasks: TaskRow[] = [
      { externalId: 'ob1', propertyId: 1, dueDate: '2026-08-05', title: 'Onboarding Clean', isClean: true, isDeepClean: false, totalCostRef: null },
    ]
    const drafts = generateDraftLines(tasks, new Map(PROPS.map(p => [p.id, p])))
    expect(drafts).toHaveLength(1)
    expect(drafts[0].rawAmount).toBe(100) // cleaner_pay, no +50
    const { lines } = reconcile(input(drafts, { tasks }))
    expect(lines.every(l => l.reviewStatus === 'ok')).toBe(true)
  })

  it('splits "regular clean plus onboarding" into base @ Client Charged + an Onboarding Clean extra', () => {
    // Real Busy Bee note (I260810797, Luning Wang) — previously fell through
    // to discrepancy_unexplained because EXTRA_RULES had no onboarding entry.
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 160, rawNoteText: 'Regular clean plus onboarding', rawDateMentioned: '2026-08-05' })]),
    )
    expect(lines).toHaveLength(2)
    const base = lines.find(l => l.lineKind === 'combined_split')!
    const extra = lines.find(l => l.lineKind === 'extra')!
    expect(base.cleanerPayAmount).toBe(100)
    expect(base.clientChargeAmount).toBe(150)
    expect(extra.serviceType).toBe('Onboarding Clean')
    expect(extra.cleanerPayAmount).toBe(60) // 160 − 100
    expect(extra.clientChargeAmount).toBe(60)
    expect(lines.every(l => l.reviewStatus === 'ok')).toBe(true)
  })

  it('a bare "onboarding" note with NO matched task goes to review, never priced as a plain extra', () => {
    // Whole onboarding cleans bill at Client Charged + $50 — without a task
    // the engine can't tell "whole onboarding" from "clean + onboarding", so
    // it must not guess.
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 330, rawNoteText: 'onboarding', rawDateMentioned: '2026-08-20' })]),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].serviceType).toBe('Onboarding Clean')
    expect(lines[0].reviewStatus).toBe('needs_review')
  })

  it('keeps Onboarding Clean single-line + review when the property has no Client Charged rate', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawPropertyText: 'Rateless Retreat', rawAmount: 253.52, rawNoteText: 'Onboarding clean', rawDateMentioned: null })]),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].reviewStatus).toBe('needs_review')
    expect(lines[0].flags).toContain(FLAGS.MISSING_RATE)
    expect(lines[0].clientChargeAmount).toBeNull()
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

// ─── Reason-required extras (Finance requirement 2026-08-17) ─────────────────

describe('reason-required extras', () => {
  it('extracts the vendor-stated reason from the note (keyword + $amounts stripped)', () => {
    expect(extraReasonFromNote('Pet fee — excess dog hair', 'Pet Fee')).toBe('excess dog hair')
    expect(extraReasonFromNote('$50 pet fee', 'Pet Fee')).toBeNull()
    expect(extraReasonFromNote('reimbursement for lightbulbs $12.50', 'Reimbursement')).toBe('for lightbulbs')
    expect(extraReasonFromNote(null, 'Pet Fee')).toBeNull()
  })

  it('keeps a Pet Fee with a stated reason out of the review queue', () => {
    // date outside any task window → standalone extra, not an underage split
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 30, rawNoteText: 'Pet fee — excess dog hair', rawDateMentioned: '2026-08-20' })]),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].serviceType).toBe('Pet Fee')
    expect(lines[0].flags).not.toContain(FLAGS.REASON_REQUIRED)
    // $30 cost bills the $45 standard Pet Fee charge.
    expect(lines[0].clientChargeAmount).toBe(45)
    expect(lines[0].reviewStatus).toBe('ok')
  })

  it('flags a reason-required extra with no derivable reason for review', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 50, rawNoteText: 'pet fee', rawDateMentioned: null })]),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].serviceType).toBe('Pet Fee')
    expect(lines[0].flags).toContain(FLAGS.REASON_REQUIRED)
    expect(lines[0].reviewStatus).toBe('needs_review')
  })

  it('"dog hair" notes split as a Pet Fee (pet evidence without the word pet)', () => {
    // Real Busy Bee note (I260810797 Jay Hwang): "Regular clean plus dog hair charge"
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 130, rawNoteText: 'Regular clean plus dog hair charge', rawDateMentioned: '2026-08-05' })]),
    )
    expect(lines).toHaveLength(2)
    const extra = lines.find(l => l.lineKind === 'extra')!
    expect(extra.serviceType).toBe('Pet Fee')
    expect(extra.cleanerPayAmount).toBe(30) // 130 − 100
    expect(extraReasonFromNote('Regular clean plus dog hair charge', 'Pet Fee')).toContain('dog hair')
  })

  it('does not demand a reason for extras outside the reason-required set', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 50, rawNoteText: 'hot tub', rawDateMentioned: null })]),
    )
    expect(lines[0].serviceType).toBe('Hot Tub Refresh Requested by Guest')
    expect(lines[0].flags).not.toContain(FLAGS.REASON_REQUIRED)
  })

  it('flags a vendor credit (auto-Reimbursement) with no reason', () => {
    const { lines } = reconcile(input([vendorLine({ rawAmount: -40, rawNoteText: null })]))
    expect(lines[0].serviceType).toBe('Reimbursement')
    expect(lines[0].flags).toContain(FLAGS.CREDIT_LINE)
    expect(lines[0].flags).toContain(FLAGS.REASON_REQUIRED)
  })
})

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

// ─── AP amount rule ──────────────────────────────────────────────────────────

describe('apPayForRatedLine', () => {
  it('tops up to the rate when the vendor under-billed', () => {
    expect(apPayForRatedLine(30, 100)).toEqual({ amount: 100, toppedUp: true })
  })

  it('pays the billed amount when it meets or beats the rate', () => {
    expect(apPayForRatedLine(175, 100)).toEqual({ amount: 175, toppedUp: false })
    expect(apPayForRatedLine(100, 100)).toEqual({ amount: 100, toppedUp: false })
  })

  it('does not treat a sub-penny gap as a top-up', () => {
    // Float noise must not produce a "vendor under-billed" flag on every line.
    // (The amount is rounded to cents, so 99.999 pays out as 100.00 either way.)
    expect(apPayForRatedLine(99.999, 100)).toEqual({ amount: 100, toppedUp: false })
    expect(apPayForRatedLine(99.98, 100)).toEqual({ amount: 100, toppedUp: true })
  })

  it('rounds to cents', () => {
    expect(apPayForRatedLine(10.005, 33.333).amount).toBe(33.33)
  })
})

// ─── WTN → CTN rename ────────────────────────────────────────────────────────

describe('resolveProperty across the WTN → CTN rename', () => {
  // Ops renamed the whole CTN group from WTN, but vendor invoices and Breezeway
  // exports still say WTN — which was dropping those lines into the
  // unresolved-property queue. All names below are real.
  const CTN: PropertyRates[] = [
    'CTN Engle Town 3030', 'CTN-Black Bear Cub', 'CTN-Mountain View', 'CTN-Pine Top 820',
    'CTN-Rebel Hill 1644', 'CTN - Tunnel Ridge 208',
  ].map((name, i) => ({ id: 100 + i, name, ceCharged: 150, cleanerPay: 100, deepClean3xCe: null, billingChannel: 'qbo_haven' as const }))

  const idOf = (name: string) => CTN.find(p => p.name === name)!.id

  it('resolves WTN-prefixed vendor text to the renamed property exactly', () => {
    for (const [raw, expected] of [
      ['WTN-Pine Top 820', 'CTN-Pine Top 820'],
      ['Wtn Pine Top 820', 'CTN-Pine Top 820'],
      ['WTN-Mountain View', 'CTN-Mountain View'],
      ['WTN-Rebel Hill 1644', 'CTN-Rebel Hill 1644'],
      // Separator styles differ between the two systems.
      ['WTN-Engle Town 3030', 'CTN Engle Town 3030'],
    ] as const) {
      const r = resolveProperty(raw, [], CTN, 'busybee')
      expect({ raw, id: r.propertyId, via: r.via }).toEqual({ raw, id: idOf(expected), via: 'exact' })
    }
  })

  it('still refuses the genuinely ambiguous ones instead of guessing', () => {
    // "Black Bear 1012" vs "Black Bear Cub" is a real difference — a wrong
    // auto-match here would bill the wrong owner. The review queue (which
    // persists a vendor alias once a human confirms) is the right place.
    expect(resolveProperty('Wtn Black Bear 1012', [], CTN, 'busybee').propertyId).toBeNull()
  })

  it('resolves through a note glued onto the property cell', () => {
    // Both fixes have to compose: peel the " - Hot tub refresh" note AND apply
    // the WTN → CTN rename to land on the right cabin.
    const r = resolveProperty('Wtn Pine Top 820 - Hot tub refresh', [], CTN, 'busybee')
    expect(r.propertyId).toBe(idOf('CTN-Pine Top 820'))
  })

  it('does not rewrite wtn inside a name', () => {
    const props: PropertyRates[] = [
      { id: 1, name: 'Newtn Ridge', ceCharged: 100, cleanerPay: 70, deepClean3xCe: null, billingChannel: 'qbo_haven' },
    ]
    expect(resolveProperty('Newtn Ridge', [], props, 'v').via).toBe('exact')
    expect(similarity('Newtn Ridge', 'Cewtn Ridge')).toBeLessThan(1)
  })
})

// ─── Note text glued into the property cell ──────────────────────────────────

describe('resolveProperty with a note suffix in the property cell', () => {
  // Busy Bee writes "Property - note". 8 of the 15 unresolved lines on run
  // "Test 1" were this rather than misspellings.
  const PROPS2: PropertyRates[] = [
    'Ashley May 1619', 'Kaley Eversgerd 933', 'CTN - 887 Sourwood', 'CTN-Pine Top 820',
  ].map((name, i) => ({ id: 200 + i, name, ceCharged: 150, cleanerPay: 100, deepClean3xCe: null, billingChannel: 'qbo_haven' as const }))
  const id = (name: string) => PROPS2.find(p => p.name === name)!.id

  it('peels the note and resolves the property', () => {
    for (const [raw, want] of [
      ['Ashley May 1619 - Deep clean', 'Ashley May 1619'],
      ['Kaley Eversgerd 933 - Trash pick up', 'Kaley Eversgerd 933'],
      ['Wtn Pine Top 820 - Hot tub refresh', 'CTN-Pine Top 820'],
    ] as const) {
      expect(resolveProperty(raw, [], PROPS2, 'busybee').propertyId).toBe(id(want))
    }
  })

  it('never breaks a property whose real name contains the separator', () => {
    // The full string is tried first, so "CTN - 887 Sourwood" matches whole and
    // is never peeled down to "CTN".
    expect(resolveProperty('CTN - 887 Sourwood', [], PROPS2, 'busybee').propertyId).toBe(id('CTN - 887 Sourwood'))
    expect(resolveProperty('CTN - 887 Sourwood', [], PROPS2, 'busybee').via).toBe('exact')
    // ...and it still resolves when a note is appended to such a name.
    expect(resolveProperty('CTN - 887 Sourwood - Touch up', [], PROPS2, 'busybee').propertyId)
      .toBe(id('CTN - 887 Sourwood'))
  })

  it('does not invent a match when the property is absent from Ops', () => {
    // Real cases: these cabins are not in the properties table at all, so
    // peeling the note must still leave them for a human.
    for (const raw of ['1214 Sky View - Touch up', 'Angela Mcville - Trash pick up request by guest',
                       'Irma Ispection - 51.52x20=1,030.4']) {
      expect(resolveProperty(raw, [], PROPS2, 'busybee').propertyId).toBeNull()
    }
  })

  it('leaves a bare separator or empty head alone', () => {
    expect(resolveProperty(' - Touch up', [], PROPS2, 'busybee').propertyId).toBeNull()
    expect(resolveProperty('-', [], PROPS2, 'busybee').propertyId).toBeNull()
  })
})

// ─── Inspection labor ────────────────────────────────────────────────────────

describe('inspection labor lines', () => {
  // Real pair from run "Test 1": the same block charge, one worded with "Work"
  // and one without. Only the first was being paid.
  it('treats a bare inspection block as a payable Tendwell expense', () => {
    expect(isOperatingExpenseText('Irma Ispection - 51.52x20=1,030.4')).toBe(true)
    expect(isOperatingExpenseText('Joshua Ispection Work - 59.35x20=1,187')).toBe(true)
    expect(isOperatingExpenseText('Irma Inspection')).toBe(true)
  })

  it('still excludes cleaner self-inspections, spelled either way', () => {
    // These are non-revenue tasks we do not pay for — the broad inspection
    // pattern must not flip them into a payable expense.
    expect(isOperatingExpenseText('Cleaner Self-Inspection')).toBe(false)
    expect(isOperatingExpenseText('Cleaner Self Ispection')).toBe(false)
    expect(isExcludedTitle('Cleaner Self-Ispection')).toBe(true)
    expect(isExcludedTitle('Cleaner Self-Inspection')).toBe(true)
  })

  it('pays the vendor the full amount on such a line', () => {
    const { lines } = reconcile(input([vendorLine({
      rawPropertyText: 'Irma Ispection - 51.52x20=1,030.4', rawAmount: 1030.4,
    })]))
    expect(lines[0].lineKind).toBe('operating_expense')
    expect(lines[0].cleanerPayAmount).toBe(1030.4)
    // Never billed onward to a client.
    expect(lines[0].clientChargeAmount).toBeNull()
  })
})

// ─── Notes crammed into the property cell ────────────────────────────────────

describe('noteFromPropertyCell', () => {
  it('returns the segment after the separator', () => {
    expect(noteFromPropertyCell('Angela Mcville - Trash pick up request by guest'))
      .toBe('Trash pick up request by guest')
    expect(noteFromPropertyCell('Wtn Pine Top 820 - Hot tub refresh')).toBe('Hot tub refresh')
  })

  it('returns null when there is no separator or no tail', () => {
    expect(noteFromPropertyCell('Kaley Eversgerd 933')).toBeNull()
    expect(noteFromPropertyCell('Kaley Eversgerd 933 - ')).toBeNull()
    expect(noteFromPropertyCell(null)).toBeNull()
  })

  it('never reads a property NAME as a service note', () => {
    // Only the tail is returned, so "CTN - 887 Sourwood" yields the address
    // half, not a keyword hit on the name.
    expect(noteFromPropertyCell('CTN - 887 Sourwood')).toBe('887 Sourwood')
  })

  it('prefers the real note column when the vendor filled it in', () => {
    expect(effectiveNoteText({ rawNoteText: 'Pet fee', rawPropertyText: 'X - Trash' })).toBe('Pet fee')
    expect(effectiveNoteText({ rawNoteText: null, rawPropertyText: 'X - Trash' })).toBe('Trash')
  })
})

describe('extras the vendor wrote into the property cell', () => {
  // Regression: these resolved to a property (via the note-peel fallback or a
  // human-confirmed alias), no extra was detected because rawNoteText is NULL,
  // so they became base cleans and the Cleaner Pay floor inflated them. On run
  // "Test 1" five such lines turned $130 invoiced into $957 of pay.
  const TASKS2: TaskRow[] = [
    { externalId: 't1', propertyId: 1, dueDate: '2026-08-05', title: 'Turn Clean', isClean: true, isDeepClean: false, totalCostRef: null },
  ]

  it('bills a $30 trash pickup as a $30 extra, not a full clean', () => {
    const { lines } = reconcile(input([vendorLine({
      rawPropertyText: 'Michael Rohwer 2455 - Trash pick up request by guest',
      rawNoteText: null,
      rawAmount: 30,
    })], { tasks: TASKS2 }))
    expect(lines).toHaveLength(1)
    expect(lines[0].lineKind).toBe('extra')
    expect(lines[0].serviceType).toBe('Excessive Trash Pickup')
    // Pay stays at the invoiced $30 — NOT the property's $100 rate — and the
    // client bills the $50 standard trash-pickup charge, review-free.
    expect(lines[0].cleanerPayAmount).toBe(30)
    expect(lines[0].clientChargeAmount).toBe(50)
    expect(lines[0].flags).not.toContain(FLAGS.PAID_AT_RATE)
    expect(lines[0].reviewStatus).toBe('ok')
  })

  it('bills a hot tub refresh as an extra', () => {
    const { lines } = reconcile(input([vendorLine({
      rawPropertyText: 'Michael Rohwer 2455 - Hot tub refresh', rawNoteText: null, rawAmount: 30,
    })], { tasks: TASKS2 }))
    expect(lines[0].serviceType).toBe('Hot Tub Refresh Requested by Guest')
    expect(lines[0].cleanerPayAmount).toBe(30)
  })

  it('bills a touch up as an extra', () => {
    const { lines } = reconcile(input([vendorLine({
      rawPropertyText: 'Michael Rohwer 2455 - Touch up', rawNoteText: null, rawAmount: 20,
    })], { tasks: TASKS2 }))
    expect(lines[0].lineKind).toBe('extra')
    expect(lines[0].cleanerPayAmount).toBe(20)
  })

  it('leaves a plain clean line alone', () => {
    // No separator, no note: still an ordinary rated clean.
    const { lines } = reconcile(input([vendorLine({ rawAmount: 100 })], { tasks: TASKS2 }))
    expect(lines[0].lineKind).toBe('clean')
    expect(lines[0].cleanerPayAmount).toBe(100)
  })
})

describe('the rate floor requires an evidenced clean', () => {
  it('does not top up a line with no matched task', () => {
    // Real case: line 71 billed $87 on a day whose only Breezeway task was a
    // Mid-Stay Trash Pickup. Topping up to the $100 rate would manufacture pay
    // for a clean we have no record of.
    const { lines } = reconcile(input([vendorLine({ rawAmount: 87, rawDateMentioned: '2026-08-05' })], { tasks: [] }))
    expect(lines[0].flags).toContain(FLAGS.UNMATCHED_TASK)
    expect(lines[0].flags).not.toContain(FLAGS.PAID_AT_RATE)
    expect(lines[0].cleanerPayAmount).toBe(87)
    expect(lines[0].reviewStatus).toBe('needs_review')
  })

  it('still tops up when the clean is evidenced', () => {
    const tasks: TaskRow[] = [
      { externalId: 't', propertyId: 1, dueDate: '2026-08-05', title: 'Turn Clean', isClean: true, isDeepClean: false, totalCostRef: null },
    ]
    const { lines } = reconcile(input([vendorLine({ rawAmount: 87, rawDateMentioned: '2026-08-05' })], { tasks }))
    expect(lines[0].flags).toContain(FLAGS.PAID_AT_RATE)
    expect(lines[0].cleanerPayAmount).toBe(100)
  })
})

describe('maintenance charges in the property cell', () => {
  it('passes a maintenance charge through at the invoiced amount, never the clean rate', () => {
    // Real line 78: "Priya Dhawan 2534 - Maintenance work replace …", $50
    // invoiced — the clean-rate floor paid $380 on it.
    const tasks: TaskRow[] = [
      { externalId: 't', propertyId: 1, dueDate: '2026-08-05', title: 'Turn Clean', isClean: true, isDeepClean: false, totalCostRef: null },
    ]
    const { lines } = reconcile(input([vendorLine({
      rawPropertyText: 'Michael Rohwer 2455 - Maintenance work replace shower head',
      rawNoteText: null,
      rawAmount: 50,
    })], { tasks }))
    expect(lines).toHaveLength(1)
    expect(lines[0].lineKind).toBe('extra')
    expect(lines[0].cleanerPayAmount).toBe(50)
    expect(lines[0].clientChargeAmount).toBe(50)
    expect(lines[0].flags).not.toContain(FLAGS.PAID_AT_RATE)
  })
})

// ─── Standard extra pricing ──────────────────────────────────────────────────

describe('TEST 3–6 review-queue fixes', () => {
  it('"Cool tub refresh" is a hot-tub refresh, standard-priced review-free', () => {
    // Real line (Wtn Pine Top 820, TEST 3): the variant spelling fell through
    // to the clean path and billed the client the full $395 Client Charged on
    // a $30 refresh.
    const { lines } = reconcile(
      input([vendorLine({ rawPropertyText: 'Michael Rohwer 2455 - Cool tub refresh', rawAmount: 30, rawDateMentioned: null })], { tasks: [] }),
    )
    expect(lines[0].serviceType).toBe('Hot Tub Refresh Requested by Guest')
    expect(lines[0].lineKind).toBe('extra')
    expect(lines[0].cleanerPayAmount).toBe(30)
    expect(lines[0].clientChargeAmount).toBe(50)
    expect(lines[0].reviewStatus).toBe('ok')
  })

  it('"Towell deliver" is a priced delivery, not an under-billed clean', () => {
    // Real line (Janine Patterson, TEST 6): $20 towel delivery went down the
    // clean path, queued, and would have billed the $269 clean rate.
    const { lines } = reconcile(
      input([vendorLine({ rawPropertyText: 'Michael Rohwer 2455 - Towell deliver', rawAmount: 20, rawDateMentioned: null })], { tasks: [] }),
    )
    expect(lines[0].serviceType).toBe('Reimbursement')
    expect(lines[0].lineKind).toBe('extra')
    expect(lines[0].cleanerPayAmount).toBe(20)
    expect(lines[0].clientChargeAmount).toBe(50)
    expect(lines[0].reviewStatus).toBe('ok')
  })

  it('"deliver extra supplies" routes to the priced delivery type, not generic Extra Cleaning', () => {
    // Real line (Jerry Pegram, TEST 4): /\bextra\b/ used to win, landing it on
    // the unpriced pass-through-and-review path.
    const { lines } = reconcile(
      input([vendorLine({ rawPropertyText: 'Michael Rohwer 2455 - Deliver extra supplies requested by the guest', rawAmount: 25, rawDateMentioned: null })], { tasks: [] }),
    )
    expect(lines[0].serviceType).toBe('Reimbursement')
    expect(lines[0].clientChargeAmount).toBe(50)
    expect(lines[0].reviewStatus).toBe('ok')
  })

  it('"doh hair" splits a Pet Fee off the clean', () => {
    // Real line (Michael Hooper, TEST 5): Busy Bee's misspelling of "dog
    // hair" — without the rule the $20 overage queued as an unexplained
    // discrepancy.
    const { lines } = reconcile(
      input([vendorLine({ rawAmount: 120, rawNoteText: 'Regular clean plus doh hair' })]),
    )
    expect(lines).toHaveLength(2)
    const base = lines.find(l => l.lineKind === 'combined_split')!
    const extra = lines.find(l => l.lineKind === 'extra')!
    expect(base.cleanerPayAmount).toBe(100)
    expect(extra.serviceType).toBe('Pet Fee')
    expect(extra.cleanerPayAmount).toBe(20)
    expect(lines.every(l => l.reviewStatus === 'ok')).toBe(true)
  })

  it('a bare "Linen pull" billed under half the rate is the standalone service', () => {
    // Real lines (Ken Brown $40 vs $150 rate, Brad Spurgin $40 vs $84.70):
    // TITLE_RULES made these base cleans, so they queued below-half-rate and
    // billed the client the full Client Charged for a $40 pull.
    const { lines } = reconcile(
      input([vendorLine({ rawPropertyText: 'Michael Rohwer 2455 - Linen pull', rawAmount: 40 })]),
    )
    expect(lines[0].lineKind).toBe('extra')
    expect(lines[0].serviceType).toBe('Linen Pull')
    expect(lines[0].cleanerPayAmount).toBe(40)
    expect(lines[0].clientChargeAmount).toBe(50)
    expect(lines[0].reviewStatus).toBe('ok')
  })

  it('"Vacancy clean" billed under half the rate is the touch-up service', () => {
    // Real line (Glen Peterson, TEST 5): $25 against a $96.60 rate.
    const { lines } = reconcile(
      input([vendorLine({ rawPropertyText: 'Michael Rohwer 2455 - Vacancy clean', rawAmount: 25 })]),
    )
    expect(lines[0].lineKind).toBe('extra')
    expect(lines[0].serviceType).toBe('Vacancy Clean / Touch Up Clean')
    expect(lines[0].cleanerPayAmount).toBe(25)
    expect(lines[0].clientChargeAmount).toBe(55)
    expect(lines[0].reviewStatus).toBe('ok')
  })

  it('a linen pull billed at the clean rate stays on the clean path', () => {
    // The half-rate guard: billed at rate means the vendor did the full
    // last-clean work, whatever the note says.
    const { lines } = reconcile(
      input([vendorLine({ rawPropertyText: 'Michael Rohwer 2455 - Linen pull', rawAmount: 100 })]),
    )
    expect(lines[0].lineKind).toBe('clean')
    expect(lines[0].cleanerPayAmount).toBe(100)
    expect(lines[0].clientChargeAmount).toBe(150)
    expect(lines[0].reviewStatus).toBe('ok')
  })

  it('"last clean & linen pull" never reroutes to the standalone extra', () => {
    const { lines } = reconcile(
      input([vendorLine({ rawNoteText: 'Last clean and linen pull', rawAmount: 100, rawDateMentioned: null })], { tasks: [] }),
    )
    expect(lines[0].lineKind).toBe('clean')
    expect(lines[0].serviceType).toBe('Last Clean & Linen Pull')
  })
})

describe('engine notes explain the review reason', () => {
  // Jordan 2026-08-22: "it's not very clear what is wrong?" — a badge alone
  // ("Unexplained discrepancy") forces the reviewer to know every property's
  // rate by heart. Every review site writes a plain-English explanation.
  it('an over-billed clean says how far above the rate it is', () => {
    const { lines } = reconcile(input([vendorLine({ rawAmount: 175 })]))
    expect(lines[0].engineNote).toBe(
      "Billed $175.00 — $75.00 above the Ops Cleaner Pay rate of $100.00. Pay is left at the billed amount (we never shortpay a vendor invoice on our own): accept their price by updating the property's Cleaner Pay, or dispute the line and edit the pay here.",
    )
  })

  it('a below-half-rate line says it is likely not a full clean', () => {
    const { lines } = reconcile(input([vendorLine({ rawAmount: 30 })]))
    expect(lines[0].engineNote).toMatch(/under half the Ops Cleaner Pay rate of \$100\.00/)
  })

  it('an odd onboarding add-on names both expected amounts', () => {
    const tasks: TaskRow[] = [
      { externalId: 'ob', propertyId: 1, dueDate: '2026-08-05', title: 'Onboarding Clean', isClean: true, isDeepClean: false, totalCostRef: null },
    ]
    const { lines } = reconcile(input([vendorLine({ rawAmount: 125, rawNoteText: 'Onboarding clean' })], { tasks }))
    const base = lines.find(l => l.lineKind === 'combined_split')!
    expect(base.engineNote).toMatch(/rate is \$100\.00 and rate \+ the \$50 surcharge would be \$150\.00/)
  })

  it('an unresolved property points at the alias fix', () => {
    const { lines } = reconcile(input([vendorLine({ rawPropertyText: 'Totally Unknown Cabin 999' })]))
    expect(lines[0].engineNote).toMatch(/doesn't match any Ops property or saved alias/)
  })

  it('an unpriced under-rate extra says a standard price is missing', () => {
    // Matched clean task + trip-fee note billed under rate: the unpriced
    // negative-split path, which passes through and queues.
    const { lines } = reconcile(input([vendorLine({ rawAmount: 50, rawNoteText: 'Trip fee for extra visit' })]))
    const extra = lines.find(l => l.serviceType === 'Trip Fee')!
    expect(extra.reviewStatus).toBe('needs_review')
    expect(extra.engineNote).toMatch(/no standard price/)
  })

  it('clean lines carry no note', () => {
    const { lines } = reconcile(input([vendorLine({ rawAmount: 100 })]))
    expect(lines[0].engineNote).toBeNull()
    expect(lines[0].reviewStatus).toBe('ok')
  })
})

describe('standardExtraCharge', () => {
  it('bills the standard charge for the normal case', () => {
    expect(standardExtraCharge('Hot Tub Refresh Requested by Guest', 30)).toEqual({ charge: 50, review: false })
    expect(standardExtraCharge('Vacancy Clean / Touch Up Clean', 20)).toEqual({ charge: 55, review: false })
    expect(standardExtraCharge('Pet Fee', 23.5)).toEqual({ charge: 45, review: false })
    expect(standardExtraCharge('Excessive Trash Pickup', 44.72)).toEqual({ charge: 50, review: false })
  })

  it('floors at the next $5 above cost and asks for review when the standard would be unprofitable', () => {
    // "We should be profitable on all tasks": a $62 hot-tub cost can't bill
    // the $50 standard, so the system won't invent a price — a human sets one.
    expect(standardExtraCharge('Hot Tub Refresh Requested by Guest', 62)).toEqual({ charge: 65, review: true })
    // At exactly the standard charge there is zero margin → same treatment.
    expect(standardExtraCharge('Excessive Trash Pickup', 50)).toEqual({ charge: 50, review: true })
  })

  it('returns null for types with no price history', () => {
    expect(standardExtraCharge('Extra Cleaning', 50)).toBeNull()
    expect(standardExtraCharge('Trip Fee', 30)).toBeNull()
    expect(standardExtraCharge(null, 30)).toBeNull()
  })

  it('prices the real lines 77/82/85 from run "Test 1"', () => {
    // Hot tub $30 → bill 50; trash $30 → bill 50; touch-up $30 → bill 55.
    expect(standardExtraCharge('Hot Tub Refresh Requested by Guest', 30)!.charge).toBe(50)
    expect(standardExtraCharge('Excessive Trash Pickup', 30)!.charge).toBe(50)
    expect(standardExtraCharge('Vacancy Clean / Touch Up Clean', 30)!.charge).toBe(55)
  })
})
