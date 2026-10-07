import { useState } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { SUBMISSIONS_KEY, useOnboardingProperties, useSubmissionCounts } from '@/hooks/use-onboarding'
import { SubmissionsSection, type SubmissionFilter } from '@/components/onboarding/SubmissionsSection'
import { PropertiesSection } from '@/components/onboarding/PropertiesSection'
import { Button } from '@/components/ui/button'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { RefreshCw } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'

type HubSection = 'submissions' | 'properties'

const READINESS_KEY = '/supabase/onboarding-readiness'

/**
 * The onboarding hub. Two sections, one workflow:
 *   1. Submissions to review: what clients and owners filled out on the intake
 *      form, ready to apply to a property (nothing they typed is dropped).
 *   2. Properties in onboarding: every property still in the Onboarding stage
 *      with a live go-live checklist, so nothing is forgotten before Active.
 * `?tab=properties` deep-links to the second section.
 */
export default function OnboardingQueuePage() {
  usePageTitle('Onboarding')
  const { t } = useLocale('onboardingAdmin')
  const { effectiveUser } = useAuth()
  const qc = useQueryClient()

  const [section, setSection] = useState<HubSection>(() =>
    new URLSearchParams(window.location.search).get('tab') === 'properties' ? 'properties' : 'submissions',
  )
  const [filter, setFilter] = useState<SubmissionFilter>('pending')

  const { data: counts } = useSubmissionCounts()
  const { data: onboardingRows } = useOnboardingProperties()

  const refreshing =
    useIsFetching({
      predicate: q => q.queryKey[0] === SUBMISSIONS_KEY || q.queryKey[0] === READINESS_KEY,
    }) > 0

  function refresh() {
    qc.invalidateQueries({ queryKey: [SUBMISSIONS_KEY] })
    qc.invalidateQueries({ queryKey: [READINESS_KEY] })
  }

  if (!effectiveUser) return null

  const tabs: { key: HubSection; label: string; count: number | undefined; attention?: boolean }[] = [
    { key: 'submissions', label: t('hub.tabs.submissions'), count: counts?.pending, attention: (counts?.pending ?? 0) > 0 },
    { key: 'properties', label: t('hub.tabs.properties'), count: onboardingRows?.length },
  ]

  return (
    <PageContainer width="lg">
      <PageHeader
        title={t('hub.title')}
        subtitle={<>{t('hub.subtitleBefore')} <code className="px-1 py-0.5 rounded bg-muted text-2xs">/onboarding</code>{t('hub.subtitleAfter')}</>}
        actions={
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} data-testid="button-refresh">
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} /> {t('common.actions.refresh')}
          </Button>
        }
      />

      <div className="flex gap-1 border-b border-border" role="tablist" aria-label={t('hub.title')}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={section === tab.key}
            onClick={() => setSection(tab.key)}
            data-testid={`hub-tab-${tab.key}`}
            className={`px-4 h-10 -mb-px text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              section === tab.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {tab.count != null && (
              <span
                className={`min-w-5 h-5 px-1.5 rounded-full text-2xs font-semibold flex items-center justify-center tabular-nums ${
                  tab.attention ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {section === 'submissions' ? (
        <SubmissionsSection filter={filter} onFilterChange={setFilter} />
      ) : (
        <PropertiesSection
          onReviewSubmissions={() => {
            setFilter('pending')
            setSection('submissions')
          }}
        />
      )}
    </PageContainer>
  )
}
