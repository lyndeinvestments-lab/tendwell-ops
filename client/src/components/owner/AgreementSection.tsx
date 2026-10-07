import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { ErrorState } from '@/components/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, FileText, ExternalLink, Download, PenLine } from 'lucide-react'
import { signAgreement, downloadAgreementPdf } from '@/lib/agreements'
import { SignaturePad } from '@/components/SignaturePad'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import { cn } from '@/lib/utils'
import { missingAgreementItems } from '@/lib/owner-onboarding'
import { Field } from './Field'
import { formatDate } from './format'
import { usePortalReadOnly } from './portal-context'

// ─── Agreement section ─────────────────────────────────────────────────────────
export type OwnerAgreement = {
  id: string
  status: 'sent' | 'signed' | 'void'
  owner_name: string | null
  entity: string | null
  mailing_address: string | null
  property_addresses: string | null
  email: string | null
  phone: string | null
  owner_signed_at: string | null
}

/**
 * The owner's latest agreement. get_owner_agreement returns a SETOF (jsonb array)
 * with at most one element; an empty array means none is assigned. Shared by the
 * agreement card and the onboarding guide so both read one cache entry.
 */
export function useOwnerAgreement() {
  const query = useQuery({
    queryKey: ['owner-agreement'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_owner_agreement')
      if (error) throw error
      return data as OwnerAgreement[] | null
    },
  })
  const agreement = (query.data as any)?.[0] as OwnerAgreement | undefined
  return { ...query, agreement }
}

function Shell({
  variant,
  title,
  icon,
  accent,
  bodyClass,
  children,
}: {
  variant: 'card' | 'embedded'
  title: string
  icon: ReactNode
  accent?: string
  bodyClass: string
  children: ReactNode
}) {
  // Embedded in the onboarding guide: the step supplies the heading and the frame.
  if (variant === 'embedded') return <div className="space-y-5">{children}</div>
  return (
    <Card className={cn('rounded-2xl shadow-sm overflow-hidden', accent)}>
      <CardHeader className="py-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          {icon} {title}
        </h2>
      </CardHeader>
      <CardContent className={bodyClass}>{children}</CardContent>
    </Card>
  )
}

/**
 * The service agreement: sign it, or download it once signed.
 * `variant="embedded"` renders the same content without its own card, for the
 * onboarding guide's first step. All signing logic lives here, once.
 */
export function AgreementSection({ variant = 'card' }: { variant?: 'card' | 'embedded' }) {
  const { t } = useLocale('ownerPortal')
  const { format } = useDateFormat()
  const readOnly = usePortalReadOnly()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { agreement: a, isLoading, isError, refetch } = useOwnerAgreement()

  // Form state for party fields + signing fields
  const [ownerName, setOwnerName] = useState('')
  const [entity, setEntity] = useState('')
  const [mailingAddress, setMailingAddress] = useState('')
  const [propertyAddresses, setPropertyAddresses] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [ownerPrintedName, setOwnerPrintedName] = useState('')
  const [ownerTitle, setOwnerTitle] = useState('')
  const [sig, setSig] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [isPending, setIsPending] = useState(false)
  // Set once the owner presses Sign while something is missing, so the hint turns urgent.
  const [attempted, setAttempted] = useState(false)

  // Pre-fill form when agreement data arrives
  useEffect(() => {
    if (a) {
      setOwnerName(a.owner_name ?? '')
      setEntity(a.entity ?? '')
      setMailingAddress(a.mailing_address ?? '')
      setPropertyAddresses(a.property_addresses ?? '')
      setEmail(a.email ?? '')
      setPhone(a.phone ?? '')
    }
  }, [a?.id])

  if (isLoading) return <Skeleton className="h-28 rounded-2xl" />
  if (isError) return <ErrorState onRetry={() => refetch()} title={t('agreements.loadFailedTitle')} description={t('agreements.loadFailedDescription')} />

  // No agreement assigned for this owner.
  if (!a) return null
  // void agreements are hidden.
  if (a.status === 'void') return null

  if (a.status === 'signed') {
    return (
      <Shell
        variant={variant}
        title={t('agreements.signedTitle')}
        icon={<FileText className="w-4 h-4 text-muted-foreground" />}
        bodyClass="space-y-4 pb-5"
      >
        <p className="text-sm text-muted-foreground">
          {t('agreements.signedOn', { date: formatDate(a.owner_signed_at, format) })}
        </p>
        <Button
          variant="outline"
          className="gap-2"
          onClick={async () => {
            const result = await downloadAgreementPdf(a.id)
            if (!result.ok) {
              toast({ title: t('agreements.downloadFailedTitle'), description: result.error ?? t('agreements.downloadFailedDefault'), variant: 'destructive' })
            }
          }}
          data-testid="button-download-agreement"
        >
          <Download className="w-4 h-4" />
          {t('agreements.downloadButton')}
        </Button>
      </Shell>
    )
  }

  // status === 'sent'
  // Read-only preview: an emulating admin sees THAT an agreement is pending,
  // never the signing flow (signing must come from the owner's own session —
  // the sign endpoint enforces this server-side too).
  if (readOnly) {
    return (
      <Shell
        variant={variant}
        title={t('agreements.previewSentTitle')}
        icon={<FileText className="w-4 h-4 text-muted-foreground" />}
        accent="border-primary/40"
        bodyClass="pb-5"
      >
        <p className="text-sm text-muted-foreground">{t('agreements.previewSentBody')}</p>
      </Shell>
    )
  }

  const today = format(new Date(), 'MMMM d, yyyy')
  const missing = missingAgreementItems({ signature: sig, printedName: ownerPrintedName, consent })

  function focusFirstMissing() {
    const first = missing[0]
    const id =
      first === 'signature' ? 'agreement-signature' : first === 'printed_name' ? 'agreement-printed-name' : 'agreement-consent'
    const el = document.getElementById(id)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el?.focus({ preventScroll: true })
  }

  async function handleSign() {
    if (isPending) return
    // Not disabled on purpose: a greyed-out button says nothing. Pressing it
    // while something is missing points at exactly what.
    if (missing.length > 0) {
      setAttempted(true)
      focusFirstMissing()
      return
    }
    setIsPending(true)
    const result = await signAgreement({
      agreementId: a!.id,
      signatureDataUrl: sig!,
      ownerName: ownerName.trim(),
      entity: entity.trim(),
      mailingAddress: mailingAddress.trim(),
      propertyAddresses: propertyAddresses.trim(),
      email: email.trim(),
      phone: phone.trim(),
      ownerPrintedName: ownerPrintedName.trim(),
      ownerTitle: ownerTitle.trim(),
      consent: true,
    })
    setIsPending(false)
    if (result.ok) {
      toast({ title: t('agreements.signedToast') })
      queryClient.invalidateQueries({ queryKey: ['owner-agreement'] })
    } else {
      toast({ title: t('agreements.signFailedTitle'), description: result.error ?? t('agreements.signFailedDefault'), variant: 'destructive' })
    }
  }

  return (
    <Shell
      variant={variant}
      title={t('agreements.actionNeededTitle')}
      icon={<PenLine className="w-4 h-4 text-primary" />}
      accent="border-primary/40"
      bodyClass="space-y-6 pb-6"
    >
      {/* Open agreement */}
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {t('agreements.intro')}
        </p>
        <a
          href="/agreements/service-agreement-v1.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          data-testid="link-open-agreement"
        >
          <ExternalLink className="w-4 h-4" />
          {t('agreements.openAgreement')}
        </a>
      </div>

      {/* Party fields */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">{t('agreements.yourInformation')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('agreements.ownerName')}>
            <Input
              className="text-base sm:text-sm"
              value={ownerName}
              onChange={e => setOwnerName(e.target.value)}
              data-testid="input-agreement-owner-name"
            />
          </Field>
          <Field label={t('agreements.entityOptional')}>
            <Input
              className="text-base sm:text-sm"
              value={entity}
              onChange={e => setEntity(e.target.value)}
              placeholder={t('agreements.entityPlaceholder')}
              data-testid="input-agreement-entity"
            />
          </Field>
          <Field label={t('agreements.mailingAddress')} className="sm:col-span-2">
            <Input
              className="text-base sm:text-sm"
              value={mailingAddress}
              onChange={e => setMailingAddress(e.target.value)}
              data-testid="input-agreement-mailing-address"
            />
          </Field>
          <Field label={t('agreements.propertyAddresses')} className="sm:col-span-2">
            <Textarea
              className="text-base sm:text-sm"
              rows={2}
              value={propertyAddresses}
              onChange={e => setPropertyAddresses(e.target.value)}
              placeholder={t('agreements.propertyAddressesPlaceholder')}
              data-testid="textarea-agreement-property-addresses"
            />
          </Field>
          <Field label={t('agreements.email')}>
            <Input
              type="email"
              className="text-base sm:text-sm"
              value={email}
              onChange={e => setEmail(e.target.value)}
              data-testid="input-agreement-email"
            />
          </Field>
          <Field label={t('agreements.phone')}>
            <Input
              className="text-base sm:text-sm"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              data-testid="input-agreement-phone"
            />
          </Field>
        </div>
      </section>

      {/* Signature block */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">{t('agreements.yourSignature')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('agreements.printedName')}>
            <Input
              id="agreement-printed-name"
              className="text-base sm:text-sm"
              value={ownerPrintedName}
              onChange={e => setOwnerPrintedName(e.target.value)}
              placeholder={t('agreements.printedNamePlaceholder')}
              data-testid="input-agreement-printed-name"
            />
          </Field>
          <Field label={t('agreements.titleOrCapacity')}>
            <Input
              className="text-base sm:text-sm"
              value={ownerTitle}
              onChange={e => setOwnerTitle(e.target.value)}
              placeholder={t('agreements.titleOrCapacityPlaceholder')}
              data-testid="input-agreement-title"
            />
          </Field>
        </div>
        <div className="text-sm text-muted-foreground">
          {t('agreements.date')}: <span className="font-medium text-foreground">{today}</span>
        </div>
        <div id="agreement-signature" tabIndex={-1} className="outline-none">
          <Field label={t('agreements.signatureLabel')}>
            <SignaturePad onChange={setSig} data-testid="signature-pad" />
          </Field>
        </div>
      </section>

      {/* Consent */}
      <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
        <input
          id="agreement-consent"
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border border-border accent-primary"
          checked={consent}
          onChange={e => setConsent(e.target.checked)}
          data-testid="checkbox-agreement-consent"
        />
        <span className="text-sm text-foreground leading-snug">
          {t('agreements.consentText')}
        </span>
      </label>

      {/* Sign button + what is still missing */}
      <div className="space-y-2">
        {missing.length > 0 && (
          <p
            id="agreement-sign-help"
            role="status"
            aria-live="polite"
            className={cn('text-sm', attempted ? 'text-destructive' : 'text-muted-foreground')}
            data-testid="text-agreement-missing"
          >
            {t('agreements.missingIntro')}{' '}
            {missing
              .map(m => t(m === 'signature' ? 'agreements.missingSignature' : m === 'printed_name' ? 'agreements.missingPrintedName' : 'agreements.missingConsent'))
              .join(', ')}
            .
          </p>
        )}
        <Button
          className={cn('w-full', missing.length > 0 && 'opacity-60')}
          size="lg"
          disabled={isPending}
          aria-disabled={missing.length > 0}
          aria-describedby={missing.length > 0 ? 'agreement-sign-help' : undefined}
          onClick={handleSign}
          data-testid="button-sign-agreement"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {t('agreements.signButton')}
        </Button>
      </div>
    </Shell>
  )
}
