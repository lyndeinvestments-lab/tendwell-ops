import { useState, type ReactNode } from 'react'
import { Eye, EyeOff, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { submissionExtras, type OnboardingSubmission } from '@/lib/onboarding'

/** Small read-only building blocks shared by the queue rows and the review dialog. */

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{title}</p>
      {hint && <p className="text-xs text-muted-foreground mb-2">{hint}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">{children}</div>
    </div>
  )
}

export function KV({ k, v, wide }: { k: string; v: unknown; wide?: boolean }) {
  const display = v == null || v === '' ? '—' : String(v)
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <p className="text-2xs text-muted-foreground">{k}</p>
      <p className="text-sm break-words">{display}</p>
    </div>
  )
}

/**
 * An API key or client secret. Masked until someone asks to see it, so it is
 * not sitting in plain view on a shared screen or in a screenshot of the queue.
 */
export function SecretText({ value, testId }: { value: string; testId?: string }) {
  const { t } = useLocale('onboardingAdmin')
  const [shown, setShown] = useState(false)
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <span className="font-mono text-sm break-all" data-testid={testId}>
        {shown ? value : '•'.repeat(Math.min(Math.max(value.length, 8), 24))}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-xs text-muted-foreground shrink-0"
        onClick={() => setShown(s => !s)}
        aria-pressed={shown}
        data-testid={testId ? `${testId}-toggle` : undefined}
      >
        {shown ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
        {shown ? t('secret.hide') : t('secret.reveal')}
      </Button>
    </span>
  )
}

/**
 * "Also submitted (not stored on the property)": the answers the property has
 * no column for. Showing them is what keeps the review honest: an admin sees
 * everything the client filled out, including the booking API credentials,
 * which stay on the submission and are never copied anywhere else.
 */
export function ExtrasList({ submission }: { submission: Partial<OnboardingSubmission> }) {
  const { t } = useLocale('onboardingAdmin')
  const extras = submissionExtras(submission)
  if (extras.length === 0) return null
  return (
    <div className="space-y-1.5" data-testid="onboarding-extras">
      {extras.map(e => {
        let label: string
        let body: ReactNode
        switch (e.id) {
          case 'invoice_email':
            label = t('extras.invoiceEmail')
            body = e.sameAsContact ? t('extras.invoiceSame', { email: e.value }) : e.value
            break
          case 'onboarding_deep_clean':
            label = t('extras.deepClean')
            body = e.value === 'yes' ? t('extras.deepCleanYes') : t('extras.deepCleanNo')
            break
          case 'auto_code':
            label = t('extras.autoCode')
            body = e.value
            break
          case 'api_client_id':
            label = t('extras.apiClientId')
            body = <SecretText value={e.value} testId="secret-api-client-id" />
            break
          case 'api_key':
            label = t('extras.apiKey')
            body = <SecretText value={e.value} testId="secret-api-key" />
            break
          default:
            label = t('extras.pdfs')
            body = t('extras.pdfsValue', { count: e.value })
        }
        return (
          <div key={e.id} className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 text-sm">
            <span className="text-xs text-muted-foreground sm:w-44 shrink-0">{label}</span>
            <span className="min-w-0 break-words">{body}</span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Calendar links found inside the free-text notes. Clients paste a second
 * calendar (VRBO next to Airbnb) there because the iCal field fits only one.
 * `onUse` lets the review dialog adopt one as the property's iCal URL.
 */
export function IcalLinks({
  urls,
  inUse,
  onUse,
}: {
  urls: string[]
  inUse?: string | null
  onUse?: (url: string) => void
}) {
  const { t } = useLocale('onboardingAdmin')
  if (urls.length === 0) return null
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2" data-testid="ical-from-notes">
      <p className="text-xs font-semibold flex items-center gap-1.5">
        <Link2 className="w-3.5 h-3.5" /> {t('ical.foundTitle', { count: urls.length })}
      </p>
      <ul className="space-y-1.5">
        {urls.map(u => (
          <li key={u} className="flex items-center gap-2 text-xs">
            <a href={u} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all min-w-0 flex-1">{u}</a>
            {onUse && (
              inUse === u ? (
                <span className="shrink-0 text-success font-medium">{t('ical.inUse')}</span>
              ) : (
                <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs shrink-0" onClick={() => onUse(u)} data-testid="button-use-ical">
                  {t('ical.use')}
                </Button>
              )
            )}
          </li>
        ))}
      </ul>
      <p className="text-2xs text-muted-foreground">{t('ical.savedNote')}</p>
    </div>
  )
}
