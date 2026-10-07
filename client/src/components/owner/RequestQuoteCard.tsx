import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Json } from '@shared/database.types'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { StatusBadge } from '@/components/StatusBadge'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'
import { CheckCircle2, Loader2, FilePlus2 } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { Field } from './Field'

// DRAFT: the owner "Request a quote" card.
// It is rendered only for staff in "Owner view" and, read-only, for an admin previewing
// an owner (see owner-portal.tsx). owner_request_quote() independently refuses real owners
// until app_settings.owner_quote_request_enabled = 1. The owner never sends or sees a
// price: the quote price is computed in the database from square footage.

type CountKey = 'bedrooms' | 'full_baths' | 'half_baths' | 'guest_count' | 'king_beds' | 'queen_beds' | 'full_beds' | 'twin_beds' | 'square_footage'

const COUNT_MAX: Record<CountKey, number> = {
  bedrooms: 30,
  full_baths: 30,
  half_baths: 30,
  guest_count: 100,
  king_beds: 30,
  queen_beds: 30,
  full_beds: 30,
  twin_beds: 30,
  square_footage: 50000,
}

interface FormState {
  property_name: string
  address: string
  counts: Record<CountKey, string>
  hot_tub: boolean
  pool: boolean
  linen_program: boolean
  notes: string
}

const emptyCounts = (): Record<CountKey, string> => ({
  bedrooms: '', full_baths: '', half_baths: '', guest_count: '',
  king_beds: '', queen_beds: '', full_beds: '', twin_beds: '', square_footage: '',
})

const emptyForm = (): FormState => ({
  property_name: '', address: '', counts: emptyCounts(), hot_tub: false, pool: false, linen_program: false, notes: '',
})

type Outcome = 'created' | 'already_yours' | 'received' | null

export function RequestQuoteCard({ previewOnly }: { previewOnly: boolean }) {
  const { t } = useLocale('ownerPortal')
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(null)

  const setCount = (key: CountKey, value: string) => setForm(f => ({ ...f, counts: { ...f.counts, [key]: value } }))

  const send = useMutation({
    mutationFn: async () => {
      // Whole numbers only, inside the same bounds the RPC enforces.
      const p: Record<string, Json> = { address: form.address.trim() }
      if (form.property_name.trim()) p.property_name = form.property_name.trim()
      for (const key of Object.keys(COUNT_MAX) as CountKey[]) {
        const raw = form.counts[key].trim()
        if (raw === '') continue
        if (!/^[0-9]{1,6}$/.test(raw) || Number(raw) > COUNT_MAX[key]) throw new Error(t('quoteRequest.errors.badNumber'))
        p[key] = Number(raw)
      }
      if (form.hot_tub) p.hot_tub = true
      if (form.pool) p.pool = true
      if (form.linen_program) p.linen_program = true
      if (form.notes.trim()) p.notes = form.notes.trim()

      const { data, error } = await supabase.rpc('owner_request_quote', { p: p as Json })
      if (error) throw error
      return data as { property_id: number | null; created: boolean } | null
    },
    onSuccess: res => {
      if (res?.created) {
        setOutcome('created')
        setForm(emptyForm())
      } else {
        setOutcome(res?.property_id ? 'already_yours' : 'received')
      }
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['owner-quotes'] })
      queryClient.invalidateQueries({ queryKey: ['owner-properties'] })
    },
    onError: (e: unknown) => {
      const message = e instanceof Error ? e.message : (e as { message?: string } | null)?.message
      toast({ title: t('quoteRequest.errors.failedTitle'), description: message || t('quoteRequest.errors.failedDefault'), variant: 'destructive' })
    },
  })

  function submit() {
    setError(null)
    if (form.address.trim().length < 5) {
      setError(t('quoteRequest.errors.addressRequired'))
      return
    }
    send.mutate()
  }

  const disabled = previewOnly || send.isPending

  const count = (key: CountKey, label: string, className?: string) => (
    <Field label={label} className={className}>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={COUNT_MAX[key]}
        disabled={disabled}
        value={form.counts[key]}
        onChange={e => setCount(key, e.target.value)}
        className="text-base sm:text-sm"
        data-testid={`input-quote-${key.replace(/_/g, '-')}`}
      />
    </Field>
  )

  const check = (key: 'hot_tub' | 'pool' | 'linen_program', label: string) => (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 rounded border border-border accent-primary"
        checked={form[key]}
        disabled={disabled}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
        data-testid={`checkbox-quote-${key.replace(/_/g, '-')}`}
      />
      <span className="text-sm text-foreground">{label}</span>
    </label>
  )

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden" data-testid="card-request-quote">
      <CardHeader className="space-y-1 py-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <FilePlus2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> {t('quoteRequest.title')}
          </h2>
          <StatusBadge tone="warning" className="shrink-0">
            {previewOnly ? t('quoteRequest.previewBadge') : t('quoteRequest.draftBadge')}
          </StatusBadge>
        </div>
        <p className="text-sm text-muted-foreground">{t('quoteRequest.intro')}</p>
      </CardHeader>
      <CardContent className="space-y-5 pb-6">
        {outcome && (
          <div className="flex items-start gap-3 rounded-lg border border-success/25 bg-success/10 p-3" role="status" data-testid="text-quote-request-outcome">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                {outcome === 'created'
                  ? t('quoteRequest.received')
                  : outcome === 'already_yours'
                    ? t('quoteRequest.alreadyYours')
                    : t('quoteRequest.receivedGeneric')}
              </p>
              <Button variant="outline" size="sm" onClick={() => setOutcome(null)} data-testid="button-quote-request-another">
                {t('quoteRequest.another')}
              </Button>
            </div>
          </div>
        )}

        {!outcome && (
          <>
            {previewOnly && <p className="text-sm text-muted-foreground">{t('quoteRequest.previewNote')}</p>}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('quoteRequest.address')} className="sm:col-span-2">
                {previewOnly ? (
                  <Input disabled value={form.address} className="text-base sm:text-sm" />
                ) : (
                  <AddressAutocomplete value={form.address} onChange={next => setForm(f => ({ ...f, address: next }))} />
                )}
                {error && <p className="text-xs text-destructive" role="alert" data-testid="text-quote-request-error">{error}</p>}
              </Field>
              <Field label={t('quoteRequest.propertyName')} className="sm:col-span-2">
                <Input
                  disabled={disabled}
                  value={form.property_name}
                  maxLength={120}
                  onChange={e => setForm(f => ({ ...f, property_name: e.target.value }))}
                  placeholder={t('quoteRequest.propertyNamePlaceholder')}
                  className="text-base sm:text-sm"
                  data-testid="input-quote-property-name"
                />
              </Field>
              {count('bedrooms', t('fields.bedrooms'))}
              {count('guest_count', t('quoteRequest.guestCount'))}
              {count('full_baths', t('fields.fullBaths'))}
              {count('half_baths', t('fields.halfBaths'))}
              {count('square_footage', t('fields.squareFootage'), 'sm:col-span-2')}
              {count('king_beds', t('fields.kingBeds'))}
              {count('queen_beds', t('fields.queenBeds'))}
              {count('full_beds', t('fields.fullBeds'))}
              {count('twin_beds', t('fields.twinBeds'))}
            </div>

            <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
              {check('hot_tub', t('fields.hotTub'))}
              {check('pool', t('fields.pool'))}
              {check('linen_program', t('quoteRequest.linenInterest'))}
            </div>

            <Field label={t('quoteRequest.notes')}>
              <Textarea
                rows={3}
                disabled={disabled}
                value={form.notes}
                maxLength={2000}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="text-base sm:text-sm"
                data-testid="textarea-quote-notes"
              />
            </Field>

            <Button className="w-full sm:w-auto" disabled={disabled} onClick={submit} data-testid="button-submit-quote-request">
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t('quoteRequest.submit')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
