import { useEffect, useId, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/StatusBadge'
import type { StatusTone } from '@/lib/status-colors'
import { CheckCircle2, Check, ChevronDown, Clock, Lock } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import { cn } from '@/lib/utils'
import {
  intakeHref,
  type GuideStep,
  type OnboardingGuide as OnboardingGuideModel,
  type PropertySubmission,
  type StepKey,
  type StepReason,
  type StepState,
} from '@/lib/owner-onboarding'
import { AgreementSection, useOwnerAgreement } from './AgreementSection'
import { TrellisPortalCard } from './TrellisPortalCard'
import { formatDate } from './format'

const STATE_TONE: Record<StepState, StatusTone> = {
  done: 'success',
  current: 'primary',
  waiting: 'info',
  locked: 'neutral',
}

const REASON_KEY: Record<StepReason, string> = {
  agreement_preparing: 'guide.property.lockedPreparing',
  agreement_unsigned: 'guide.property.lockedUnsigned',
  no_onboarding_property: 'guide.property.noProperty',
  trellis_pending: 'trellis.placeholder',
}

function StepIcon({ state, index }: { state: StepState; index: number }) {
  const base = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold'
  if (state === 'done') {
    return (
      <span className={cn(base, 'bg-success/10 text-success')} aria-hidden="true">
        <Check className="h-4 w-4" />
      </span>
    )
  }
  if (state === 'locked') {
    return (
      <span className={cn(base, 'bg-muted text-muted-foreground')} aria-hidden="true">
        <Lock className="h-4 w-4" />
      </span>
    )
  }
  if (state === 'waiting') {
    return (
      <span className={cn(base, 'bg-info/10 text-info')} aria-hidden="true">
        <Clock className="h-4 w-4" />
      </span>
    )
  }
  return (
    <span className={cn(base, 'bg-primary text-primary-foreground')} aria-hidden="true">
      {index + 1}
    </span>
  )
}

/**
 * "Getting started": a three-step stepper shown at the top of the owner portal while
 * the owner has a property in onboarding or an unsigned agreement. One step is
 * expanded at a time; the first step that is not done is marked as the current one.
 * All state comes from `deriveOnboardingGuide`; this component only renders it.
 */
export function OnboardingGuide({
  guide,
  onEditProperty,
}: {
  guide: OnboardingGuideModel
  /** Opens the owner's property card for this property and scrolls to it. */
  onEditProperty: (propertyId: number) => void
}) {
  const { t } = useLocale('ownerPortal')
  const { format } = useDateFormat()
  const baseId = useId()
  const { agreement } = useOwnerAgreement()

  // null = follow the default (the first step that is not done); 'none' = all closed.
  const [picked, setPicked] = useState<StepKey | 'none' | null>(null)
  useEffect(() => setPicked(null), [guide.activeKey])
  const expanded: StepKey | null = picked === null ? guide.activeKey : picked === 'none' ? null : picked

  // A step body stays mounted (hidden) once it has been opened, so half-filled state in it,
  // such as a drawn signature, survives closing the step or looking at another one. It is
  // only mounted while open the first time, because the signature pad measures itself on mount.
  const [visited, setVisited] = useState<Partial<Record<StepKey, true>>>({})
  useEffect(() => {
    if (expanded) setVisited(v => (v[expanded] ? v : { ...v, [expanded]: true }))
  }, [expanded])

  // Once everything is done the stepper folds into one line, with a way back in.
  const [showAll, setShowAll] = useState(false)
  if (guide.allDone && !showAll) {
    return (
      <Card className="rounded-2xl shadow-sm overflow-hidden" data-testid="card-guide-all-set">
        <CardContent className="flex items-center justify-between gap-3 py-3">
          <p className="flex min-w-0 items-center gap-2 text-sm text-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            <span className="font-medium">{t('guide.allSetTitle')}</span>
            <span className="hidden truncate text-muted-foreground sm:inline">{t('guide.allSetBody')}</span>
          </p>
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setShowAll(true)} data-testid="button-guide-show-steps">
            {t('guide.showSteps')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const submittedCount = guide.perProperty.filter(p => p.status === 'under_review' || p.status === 'accepted').length

  function titleOf(key: StepKey): string {
    return key === 'agreement' ? t('guide.agreement.title') : key === 'property' ? t('guide.property.title') : t('trellis.title')
  }

  function summaryOf(step: GuideStep): string {
    if (step.key === 'agreement') {
      if (step.state === 'done') {
        return agreement?.owner_signed_at
          ? t('guide.agreement.summaryDone', { date: formatDate(agreement.owner_signed_at, format) })
          : t('guide.agreement.summarySigned')
      }
      if (step.state === 'current') return t('guide.agreement.summaryCurrent')
      return t('guide.agreement.preparing')
    }
    if (step.key === 'property') {
      if (step.reason) return t(REASON_KEY[step.reason])
      if (guide.perProperty.length === 1) {
        const only = guide.perProperty[0]!
        return only.submittedAt
          ? t('guide.property.submittedOn', { date: formatDate(only.submittedAt, format) })
          : t('guide.property.notStarted')
      }
      return t('guide.property.summaryCount', { done: submittedCount, total: guide.perProperty.length })
    }
    return step.state === 'done' ? t('guide.trellis.summaryDone') : t('trellis.placeholder')
  }

  function submissionLine(p: PropertySubmission): string | null {
    if (p.status === 'none') return null
    const date = formatDate(p.submittedAt, format)
    if (p.status === 'accepted') return t('guide.property.submittedAccepted', { date })
    if (p.status === 'needs_followup') return t('guide.property.submittedFollowup', { date })
    return t('guide.property.submittedUnderReview', { date })
  }

  function propertyBadge(p: PropertySubmission): { tone: StatusTone; label: string } {
    switch (p.status) {
      case 'under_review':
        return { tone: 'info', label: t('guide.property.badgeUnderReview') }
      case 'accepted':
        return { tone: 'success', label: t('guide.property.badgeAccepted') }
      case 'needs_followup':
        return { tone: 'warning', label: t('guide.property.badgeFollowup') }
      default:
        return { tone: 'neutral', label: t('guide.property.notStarted') }
    }
  }

  function renderBody(step: GuideStep) {
    if (step.key === 'agreement') {
      if (step.state === 'waiting') {
        return <p className="text-sm text-muted-foreground" data-testid="text-agreement-preparing">{t('guide.agreement.preparing')}</p>
      }
      return <AgreementSection variant="embedded" />
    }

    if (step.key === 'trellis') {
      return <TrellisPortalCard variant="embedded" showPlaceholder />
    }

    // Step 2: property details
    if (step.state === 'locked' || step.state === 'waiting') {
      return (
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="text-property-locked">
            {step.state === 'locked' && <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            <span>{step.reason ? t(REASON_KEY[step.reason]) : null}</span>
          </p>
          {step.reason === 'agreement_unsigned' && (
            <Button variant="outline" size="sm" onClick={() => setPicked('agreement')} data-testid="button-guide-go-agreement">
              {t('guide.property.goToAgreement')}
            </Button>
          )}
        </div>
      )
    }

    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('guide.property.intro')}</p>
        <ul className="space-y-2">
          {guide.perProperty.map(p => {
            const badge = propertyBadge(p)
            const line = submissionLine(p)
            const needsForm = p.status === 'none' || p.status === 'needs_followup'
            return (
              <li key={p.property.id} className="space-y-2 rounded-lg border border-border/60 p-3" data-testid={`row-guide-property-${p.property.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-sm font-medium text-foreground">{p.property.name}</p>
                  <StatusBadge tone={badge.tone} className="shrink-0">{badge.label}</StatusBadge>
                </div>
                {line && <p className="text-xs text-muted-foreground">{line}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  {needsForm && (
                    <Button asChild size="sm" data-testid={`link-guide-fill-${p.property.id}`}>
                      <a href={intakeHref(p.property.id)}>
                        {p.status === 'needs_followup' ? t('guide.property.resendButton') : t('guide.property.fillButton')}
                      </a>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-primary"
                    onClick={() => onEditProperty(p.property.id)}
                    data-testid={`button-guide-edit-${p.property.id}`}
                  >
                    {t('guide.property.editInCard')}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden border-primary/30" data-testid="card-onboarding-guide">
      <CardHeader className="space-y-2 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">{t('guide.title')}</h2>
          <p className="text-xs text-muted-foreground" data-testid="text-guide-progress">
            {t('guide.progress', { done: guide.doneCount, total: guide.steps.length })}
          </p>
        </div>
        <div className="flex gap-1" aria-hidden="true">
          {guide.steps.map(s => (
            <span key={s.key} className={cn('h-1.5 flex-1 rounded-full', s.state === 'done' ? 'bg-success' : 'bg-muted')} />
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pb-5">
        <ol className="space-y-2">
          {guide.steps.map((step, i) => {
            const isOpen = expanded === step.key
            const isActive = guide.activeKey === step.key
            const buttonId = `${baseId}-${step.key}-button`
            const panelId = `${baseId}-${step.key}-panel`
            return (
              <li
                key={step.key}
                aria-current={isActive ? 'step' : undefined}
                className={cn('rounded-xl border bg-card', isActive ? 'border-primary/40' : 'border-border/60')}
                data-testid={`step-${step.key}`}
                data-state={step.state}
              >
                <h3 className="m-0">
                  <button
                    id={buttonId}
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setPicked(isOpen ? 'none' : step.key)}
                    className="flex min-h-[44px] w-full items-start gap-3 rounded-xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4"
                    data-testid={`button-step-${step.key}`}
                  >
                    <StepIcon state={step.state} index={i} />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t('guide.stepNumber', { n: i + 1 })}
                        </span>
                        <StatusBadge tone={STATE_TONE[step.state]}>{t(`guide.state.${step.state}`)}</StatusBadge>
                      </span>
                      <span className="block text-sm font-semibold text-foreground">{titleOf(step.key)}</span>
                      {!isOpen && <span className="block text-xs text-muted-foreground">{summaryOf(step)}</span>}
                    </span>
                    <ChevronDown
                      className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
                      aria-hidden="true"
                    />
                  </button>
                </h3>
                {(isOpen || visited[step.key]) && (
                  <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!isOpen} className="px-3 pb-4 sm:px-4 sm:pl-[3.75rem]">
                    {renderBody(step)}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
        {guide.allDone && (
          <div className="flex justify-end pt-1">
            <Button variant="ghost" size="sm" onClick={() => setShowAll(false)}>
              {t('guide.hideSteps')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
