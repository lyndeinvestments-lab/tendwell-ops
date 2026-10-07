import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  deriveOnboardingGuide,
  type OnboardingGuide,
  type OnboardingStatusRow,
} from '@/lib/owner-onboarding'
import { useOwnerAgreement } from './AgreementSection'
import { useOwnerTrellisUrl } from './TrellisPortalCard'

interface GuidePropertyInput {
  id: number
  name: string
  stage?: string | null
}

/**
 * Everything the "Getting started" guide needs, derived in one place so the page
 * (which decides what to render around it) and the guide itself agree.
 *
 * `ready` is false until the agreement, submission status and Trellis link have
 * all loaded. A failed status read degrades to "no submissions" rather than
 * hiding the guide: the status is an enhancement and must never block signing.
 * A failed agreement read hides the guide so the agreement card's own error
 * state (with Retry) shows instead.
 */
export function useOnboardingGuide(properties: GuidePropertyInput[] | undefined): {
  guide: OnboardingGuide | null
  ready: boolean
  agreementFailed: boolean
} {
  const agreement = useOwnerAgreement()
  const trellis = useOwnerTrellisUrl()
  const status = useQuery({
    queryKey: ['owner-onboarding-status'],
    queryFn: async (): Promise<OnboardingStatusRow[]> => {
      const { data, error } = await supabase.rpc('get_owner_onboarding_status')
      if (error) throw error
      return (data ?? []) as OnboardingStatusRow[]
    },
    retry: false,
  })

  const ready = !!properties && !agreement.isLoading && !trellis.isLoading && !status.isLoading
  const agreementFailed = agreement.isError

  const guide = useMemo(() => {
    if (!ready || agreementFailed) return null
    return deriveOnboardingGuide({
      agreementStatus: agreement.agreement?.status ?? null,
      onboardingProperties: (properties ?? [])
        .filter(p => p.stage === 'Onboarding')
        .map(p => ({ id: p.id, name: p.name })),
      submissions: status.data ?? [],
      trellisUrl: trellis.url,
    })
  }, [ready, agreementFailed, agreement.agreement?.status, properties, status.data, trellis.url])

  return { guide, ready, agreementFailed }
}
