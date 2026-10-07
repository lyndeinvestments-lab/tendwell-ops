import { describe, expect, it } from 'vitest'
import {
  deriveOnboardingGuide,
  intakeHref,
  isSubmitted,
  missingAgreementItems,
  normalizeAgreementStatus,
  normalizeSubmissionStatus,
  parsePropertyParam,
  pickInitialIntakeChoice,
  summarizeSubmissions,
  type OnboardingGuideInput,
} from './owner-onboarding'

const P1 = { id: 582, name: 'Buck Creek Cottage' }
const P2 = { id: 583, name: 'Second Cabin' }

const base = (over: Partial<OnboardingGuideInput> = {}): OnboardingGuideInput => ({
  agreementStatus: null,
  onboardingProperties: [P1],
  submissions: [],
  trellisUrl: null,
  ...over,
})

const stateOf = (g: ReturnType<typeof deriveOnboardingGuide>, key: string) => g.steps.find(s => s.key === key)!

describe('deriveOnboardingGuide: when to show', () => {
  it('shows for an onboarding property even with no agreement', () => {
    expect(deriveOnboardingGuide(base()).show).toBe(true)
  })

  it('shows for an unsigned (sent) agreement with no onboarding property', () => {
    expect(deriveOnboardingGuide(base({ agreementStatus: 'sent', onboardingProperties: [] })).show).toBe(true)
  })

  it('hides when nothing is onboarding and the agreement is signed, void or missing', () => {
    expect(deriveOnboardingGuide(base({ agreementStatus: 'signed', onboardingProperties: [] })).show).toBe(false)
    expect(deriveOnboardingGuide(base({ agreementStatus: 'void', onboardingProperties: [] })).show).toBe(false)
    expect(deriveOnboardingGuide(base({ agreementStatus: null, onboardingProperties: [] })).show).toBe(false)
  })
})

describe('deriveOnboardingGuide: no agreement yet', () => {
  const g = deriveOnboardingGuide(base())

  it('waits on Tendwell for step 1 and keeps step 2 locked with the preparing reason', () => {
    expect(stateOf(g, 'agreement')).toMatchObject({ state: 'waiting', reason: 'agreement_preparing' })
    expect(stateOf(g, 'property')).toMatchObject({ state: 'locked', reason: 'agreement_preparing' })
  })

  it('expands step 1 by default so the "being prepared" message is visible', () => {
    expect(g.activeKey).toBe('agreement')
  })

  it('treats a void agreement exactly like none', () => {
    expect(deriveOnboardingGuide(base({ agreementStatus: 'void' })).steps).toEqual(g.steps)
  })
})

describe('deriveOnboardingGuide: agreement sent, unsigned', () => {
  const g = deriveOnboardingGuide(base({ agreementStatus: 'sent' }))

  it('makes signing the owner turn and locks step 2 because of the unsigned agreement', () => {
    expect(stateOf(g, 'agreement')).toMatchObject({ state: 'current', reason: null })
    expect(stateOf(g, 'property')).toMatchObject({ state: 'locked', reason: 'agreement_unsigned' })
    expect(g.activeKey).toBe('agreement')
  })
})

describe('deriveOnboardingGuide: signed', () => {
  it('unlocks step 2 as the owner turn when a property has not been submitted', () => {
    const g = deriveOnboardingGuide(base({ agreementStatus: 'signed' }))
    expect(stateOf(g, 'agreement').state).toBe('done')
    expect(stateOf(g, 'property')).toMatchObject({ state: 'current', reason: null })
    expect(g.activeKey).toBe('property')
    expect(g.doneCount).toBe(1)
  })

  it('stays current while ANY onboarding property is not submitted', () => {
    const g = deriveOnboardingGuide(
      base({
        agreementStatus: 'signed',
        onboardingProperties: [P1, P2],
        submissions: [{ property_id: 582, status: 'under_review', submitted_at: '2026-10-01T12:00:00Z' }],
      }),
    )
    expect(stateOf(g, 'property').state).toBe('current')
    expect(g.perProperty.map(p => p.status)).toEqual(['under_review', 'none'])
  })

  it('is done once every onboarding property is submitted (under review or accepted)', () => {
    const g = deriveOnboardingGuide(
      base({
        agreementStatus: 'signed',
        onboardingProperties: [P1, P2],
        submissions: [
          { property_id: 582, status: 'under_review', submitted_at: '2026-10-01T12:00:00Z' },
          { property_id: 583, status: 'accepted', submitted_at: '2026-10-02T12:00:00Z' },
        ],
      }),
    )
    expect(stateOf(g, 'property').state).toBe('done')
    expect(g.activeKey).toBe('trellis')
  })

  it('keeps step 2 as the owner turn when staff asked for follow-up', () => {
    const g = deriveOnboardingGuide(
      base({
        agreementStatus: 'signed',
        submissions: [{ property_id: 582, status: 'needs_followup', submitted_at: '2026-10-01T12:00:00Z' }],
      }),
    )
    expect(stateOf(g, 'property').state).toBe('current')
  })
})

describe('deriveOnboardingGuide: submitted before signing', () => {
  it('marks step 2 done (not locked) so the owner is never asked to refill the form', () => {
    // Real case: an owner submitted intake for 582 before signing the agreement.
    const g = deriveOnboardingGuide(
      base({
        agreementStatus: 'sent',
        submissions: [{ property_id: 582, status: 'accepted', submitted_at: '2026-09-24T14:16:08Z' }],
      }),
    )
    expect(stateOf(g, 'agreement').state).toBe('current')
    expect(stateOf(g, 'property').state).toBe('done')
    expect(g.activeKey).toBe('agreement')
  })
})

describe('deriveOnboardingGuide: Trellis step', () => {
  it('waits on Tendwell until the URL is set, then is done', () => {
    const waiting = deriveOnboardingGuide(base({ agreementStatus: 'signed', trellisUrl: null }))
    expect(stateOf(waiting, 'trellis')).toMatchObject({ state: 'waiting', reason: 'trellis_pending' })
    const blank = deriveOnboardingGuide(base({ agreementStatus: 'signed', trellisUrl: '   ' }))
    expect(stateOf(blank, 'trellis').state).toBe('waiting')
    const done = deriveOnboardingGuide(base({ agreementStatus: 'signed', trellisUrl: 'https://portal.example/abc' }))
    expect(stateOf(done, 'trellis')).toMatchObject({ state: 'done', reason: null })
  })
})

describe('deriveOnboardingGuide: all done', () => {
  it('collapses (allDone) only when all three steps are done', () => {
    const g = deriveOnboardingGuide(
      base({
        agreementStatus: 'signed',
        submissions: [{ property_id: 582, status: 'under_review', submitted_at: '2026-10-01T12:00:00Z' }],
        trellisUrl: 'https://portal.example/abc',
      }),
    )
    expect(g.allDone).toBe(true)
    expect(g.doneCount).toBe(3)
    expect(g.activeKey).toBeNull()
  })

  it('is not all done while the Trellis link is missing', () => {
    const g = deriveOnboardingGuide(
      base({
        agreementStatus: 'signed',
        submissions: [{ property_id: 582, status: 'under_review', submitted_at: '2026-10-01T12:00:00Z' }],
      }),
    )
    expect(g.allDone).toBe(false)
    expect(g.doneCount).toBe(2)
    expect(g.activeKey).toBe('trellis')
  })
})

describe('deriveOnboardingGuide: no onboarding property but signing is pending', () => {
  it('locks step 2 behind the unsigned agreement', () => {
    const g = deriveOnboardingGuide(base({ agreementStatus: 'sent', onboardingProperties: [] }))
    expect(stateOf(g, 'property')).toMatchObject({ state: 'locked', reason: 'agreement_unsigned' })
    expect(g.perProperty).toEqual([])
  })

  it('waits (not locked, not current) once signed with no onboarding property', () => {
    const g = deriveOnboardingGuide(base({ agreementStatus: 'signed', onboardingProperties: [] }))
    expect(stateOf(g, 'property')).toMatchObject({ state: 'waiting', reason: 'no_onboarding_property' })
  })
})

describe('submission status helpers', () => {
  it('normalizes the RPC status and never surfaces anything unexpected', () => {
    expect(normalizeSubmissionStatus('accepted')).toBe('accepted')
    expect(normalizeSubmissionStatus('needs_followup')).toBe('needs_followup')
    expect(normalizeSubmissionStatus('under_review')).toBe('under_review')
    expect(normalizeSubmissionStatus('pending')).toBe('under_review')
    expect(normalizeSubmissionStatus('converted')).toBe('under_review')
    expect(normalizeSubmissionStatus(null)).toBe('under_review')
  })

  it('normalizes agreement status: void and unknown become null', () => {
    expect(normalizeAgreementStatus('sent')).toBe('sent')
    expect(normalizeAgreementStatus('signed')).toBe('signed')
    expect(normalizeAgreementStatus('void')).toBeNull()
    expect(normalizeAgreementStatus(undefined)).toBeNull()
  })

  it('joins submissions to properties and defaults to none', () => {
    const rows = summarizeSubmissions(
      [P1, P2],
      [{ property_id: 583, status: 'accepted', submitted_at: '2026-10-02T12:00:00Z' }],
    )
    expect(rows[0]).toMatchObject({ status: 'none', submittedAt: null })
    expect(rows[1]).toMatchObject({ status: 'accepted', submittedAt: '2026-10-02T12:00:00Z' })
    expect(rows.map(isSubmitted)).toEqual([false, true])
  })

  it('ignores submissions for properties that are not in the onboarding list', () => {
    const rows = summarizeSubmissions([P1], [{ property_id: 999, status: 'accepted', submitted_at: null }])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('none')
  })
})

describe('missingAgreementItems', () => {
  it('lists everything missing, in the order the form asks for it', () => {
    expect(missingAgreementItems({ signature: null, printedName: '', consent: false })).toEqual([
      'signature',
      'printed_name',
      'consent',
    ])
  })

  it('treats a whitespace-only printed name as missing', () => {
    expect(missingAgreementItems({ signature: 'data:image/png;base64,xx', printedName: '   ', consent: true })).toEqual([
      'printed_name',
    ])
  })

  it('returns nothing when ready to sign', () => {
    expect(missingAgreementItems({ signature: 'data:image/png;base64,xx', printedName: 'A B', consent: true })).toEqual([])
  })
})

describe('intake deep link', () => {
  it('builds /onboarding?property=<id> and falls back to the bare path', () => {
    expect(intakeHref(582)).toBe('/onboarding?property=582')
    expect(intakeHref()).toBe('/onboarding')
    expect(intakeHref(null)).toBe('/onboarding')
    expect(intakeHref(0)).toBe('/onboarding')
    expect(intakeHref(1.5)).toBe('/onboarding')
  })

  it('parses only a positive integer property param', () => {
    expect(parsePropertyParam('?property=582')).toBe(582)
    expect(parsePropertyParam('property=7&x=1')).toBe(7)
    expect(parsePropertyParam('?property=0')).toBeNull()
    expect(parsePropertyParam('?property=-3')).toBeNull()
    expect(parsePropertyParam('?property=12abc')).toBeNull()
    expect(parsePropertyParam('?property=1e3')).toBeNull()
    expect(parsePropertyParam('?property=')).toBeNull()
    expect(parsePropertyParam('')).toBeNull()
  })

  it('preselects a requested property only when it is one of the owner properties', () => {
    const props = [
      { id: 1, stage: 'Active' },
      { id: 2, stage: 'Onboarding' },
      { id: 3, stage: 'Onboarding' },
    ]
    expect(pickInitialIntakeChoice(props, 1)).toBe(1)
    // an id that is not theirs is ignored, never trusted
    expect(pickInitialIntakeChoice(props, 999)).toBe('new')
  })

  it('falls back to the single onboarding property, else a new property', () => {
    expect(pickInitialIntakeChoice([{ id: 1, stage: 'Active' }, { id: 2, stage: 'Onboarding' }], null)).toBe(2)
    expect(pickInitialIntakeChoice([{ id: 2, stage: 'Onboarding' }, { id: 3, stage: 'Onboarding' }], null)).toBe('new')
    expect(pickInitialIntakeChoice([{ id: 1, stage: 'Active' }], null)).toBe('new')
    expect(pickInitialIntakeChoice([], null)).toBe('new')
  })
})
