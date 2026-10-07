/**
 * Pure logic for the owner portal's guided onboarding ("Getting started").
 * No React, no I/O, so the stepper's rules are unit-testable.
 *
 * Three steps, in order:
 *   1. agreement : sign the service agreement
 *   2. property  : fill out the onboarding intake form for each onboarding property
 *   3. trellis   : receive the Trellis portal link (set by staff)
 *
 * The data comes from three places the portal already reads:
 *   - get_owner_agreement()          -> latest agreement (sent | signed | void)
 *   - get_owner_properties()         -> properties, each with its pipeline stage
 *   - get_owner_onboarding_status()  -> per-property submission status + time
 *     (never the submitted values: those hold door codes and API secrets)
 */

export type AgreementStatus = 'sent' | 'signed' | 'void'

/** Friendly submission states returned by get_owner_onboarding_status(). */
export type SubmissionStatus = 'under_review' | 'accepted' | 'needs_followup'

export interface OnboardingStatusRow {
  property_id: number
  status: string
  submitted_at: string | null
}

export interface GuideProperty {
  id: number
  name: string
}

export type StepKey = 'agreement' | 'property' | 'trellis'

/**
 * done    : finished
 * current : the owner's turn
 * waiting : nothing for the owner to do, Tendwell has to act
 * locked  : cannot start yet (reason says why)
 */
export type StepState = 'done' | 'current' | 'waiting' | 'locked'

/** Why a step is waiting or locked. Maps one-to-one to copy in the dictionaries. */
export type StepReason = 'agreement_preparing' | 'agreement_unsigned' | 'no_onboarding_property' | 'trellis_pending'

export interface GuideStep {
  key: StepKey
  state: StepState
  reason: StepReason | null
}

export interface PropertySubmission {
  property: GuideProperty
  /** 'none' when the owner has not submitted the form for this property. */
  status: 'none' | SubmissionStatus
  submittedAt: string | null
}

export interface OnboardingGuideInput {
  /** The owner's latest agreement, or null when none has been sent yet. */
  agreementStatus: AgreementStatus | null
  /** Properties whose stage is 'Onboarding'. */
  onboardingProperties: GuideProperty[]
  submissions: OnboardingStatusRow[]
  trellisUrl: string | null
}

export interface OnboardingGuide {
  /** False when there is nothing to guide: no onboarding property and no unsigned agreement. */
  show: boolean
  steps: GuideStep[]
  perProperty: PropertySubmission[]
  doneCount: number
  allDone: boolean
  /** The step to expand by default: the first one that is not done. */
  activeKey: StepKey | null
}

const SUBMISSION_STATUSES: readonly SubmissionStatus[] = ['under_review', 'accepted', 'needs_followup']

/** Narrow an RPC status string; anything unexpected reads as "under review". */
export function normalizeSubmissionStatus(raw: string | null | undefined): SubmissionStatus {
  return (SUBMISSION_STATUSES as readonly string[]).includes(raw ?? '') ? (raw as SubmissionStatus) : 'under_review'
}

/** A void agreement is the same as none: nothing for the owner to sign or wait on. */
export function normalizeAgreementStatus(raw: string | null | undefined): AgreementStatus | null {
  return raw === 'sent' || raw === 'signed' ? raw : null
}

/** Join each onboarding property with its submission status (one row per property). */
export function summarizeSubmissions(
  properties: GuideProperty[],
  submissions: OnboardingStatusRow[],
): PropertySubmission[] {
  const byProperty = new Map<number, OnboardingStatusRow>()
  for (const s of submissions) byProperty.set(Number(s.property_id), s)
  return properties.map(property => {
    const row = byProperty.get(property.id)
    return row
      ? { property, status: normalizeSubmissionStatus(row.status), submittedAt: row.submitted_at }
      : { property, status: 'none', submittedAt: null }
  })
}

/** A property counts as submitted unless it has no submission or staff asked for follow-up. */
export function isSubmitted(s: PropertySubmission): boolean {
  return s.status === 'under_review' || s.status === 'accepted'
}

/**
 * Derive the stepper state.
 *
 * Rules worth knowing:
 *  - The guide shows while any property is in Onboarding OR the agreement is sent and unsigned.
 *  - Step 2 is locked until the agreement is signed, EXCEPT when every onboarding property was
 *    already submitted (an owner who filled the form before signing): that is done, not locked,
 *    so they are never asked to repeat it.
 *  - Step 3 is never the owner's turn: it is done once staff set the Trellis URL, waiting before.
 */
export function deriveOnboardingGuide(input: OnboardingGuideInput): OnboardingGuide {
  const agreement = normalizeAgreementStatus(input.agreementStatus)
  const perProperty = summarizeSubmissions(input.onboardingProperties, input.submissions)
  const hasOnboarding = input.onboardingProperties.length > 0
  const show = hasOnboarding || agreement === 'sent'

  // Step 1: agreement
  const agreementStep: GuideStep =
    agreement === 'signed'
      ? { key: 'agreement', state: 'done', reason: null }
      : agreement === 'sent'
        ? { key: 'agreement', state: 'current', reason: null }
        : { key: 'agreement', state: 'waiting', reason: 'agreement_preparing' }

  // Step 2: property details
  const allSubmitted = hasOnboarding && perProperty.every(isSubmitted)
  let propertyStep: GuideStep
  if (allSubmitted) {
    propertyStep = { key: 'property', state: 'done', reason: null }
  } else if (agreement !== 'signed') {
    propertyStep = {
      key: 'property',
      state: 'locked',
      reason: agreement === 'sent' ? 'agreement_unsigned' : 'agreement_preparing',
    }
  } else if (!hasOnboarding) {
    propertyStep = { key: 'property', state: 'waiting', reason: 'no_onboarding_property' }
  } else {
    propertyStep = { key: 'property', state: 'current', reason: null }
  }

  // Step 3: Trellis portal link
  const hasTrellis = !!input.trellisUrl && input.trellisUrl.trim() !== ''
  const trellisStep: GuideStep = hasTrellis
    ? { key: 'trellis', state: 'done', reason: null }
    : { key: 'trellis', state: 'waiting', reason: 'trellis_pending' }

  const steps = [agreementStep, propertyStep, trellisStep]
  const doneCount = steps.filter(s => s.state === 'done').length
  const allDone = doneCount === steps.length
  const activeKey = steps.find(s => s.state !== 'done')?.key ?? null

  return { show, steps, perProperty, doneCount, allDone, activeKey }
}

/** What an owner still has to do before the Sign button will work. */
export type AgreementMissing = 'signature' | 'printed_name' | 'consent'

export function missingAgreementItems(input: {
  signature: string | null
  printedName: string
  consent: boolean
}): AgreementMissing[] {
  const missing: AgreementMissing[] = []
  if (!input.signature) missing.push('signature')
  if (!input.printedName.trim()) missing.push('printed_name')
  if (!input.consent) missing.push('consent')
  return missing
}

// ─── Intake deep link (/onboarding?property=<id>) ──────────────────────────────

/** Link to the intake form, optionally for one property. */
export function intakeHref(propertyId?: number | null): string {
  return propertyId != null && Number.isInteger(propertyId) && propertyId > 0
    ? `/onboarding?property=${propertyId}`
    : '/onboarding'
}

/** Read `?property=<id>`; anything but a positive integer is ignored. */
export function parsePropertyParam(search: string): number | null {
  const raw = new URLSearchParams(search).get('property')
  if (raw == null || !/^[1-9][0-9]{0,15}$/.test(raw)) return null
  return Number(raw)
}

/**
 * Which property the intake form starts on for an owner.
 * A valid `?property=` that is one of the owner's own properties wins (an id that is
 * not theirs is ignored, never trusted); otherwise exactly one Onboarding property is
 * the obvious choice, and anything else starts on "a new property".
 */
export function pickInitialIntakeChoice(
  properties: { id: number; stage?: string | null }[],
  requested: number | null,
): number | 'new' {
  if (requested != null && properties.some(p => p.id === requested)) return requested
  const onboarding = properties.filter(p => p.stage === 'Onboarding')
  return onboarding.length === 1 ? onboarding[0]!.id : 'new'
}
