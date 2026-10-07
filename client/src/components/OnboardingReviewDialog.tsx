import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { invalidateAllPropertyQueries } from '@/lib/query-invalidations'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { SUBMISSIONS_KEY, useSubmissionContactMatch, useSubmissionLookups } from '@/hooks/use-onboarding'
import {
  BED_COLS,
  SUBMISSION_FIELDS,
  defaultChoices,
  defaultHasAutoCode,
  extractIcalUrls,
  initialCreateValues,
  isBlank,
  isImagePath,
  normalizeUrlInput,
  parseBeds,
  safeHref,
  sourceLabel,
  submissionExtras,
  submittedValue,
  urlProblem,
  visibleFields,
  type Beds,
  type FieldType,
  type OnboardingSubmission,
  type Pick,
} from '@/lib/onboarding'
import { applySubmission, ApplyError, onboardingPhotoUrl, type ApplyResult, type ContactAction } from '@/lib/onboarding-apply'
import { ExtrasList, IcalLinks } from '@/components/onboarding/shared'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Bed, ExternalLink } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import type { TFunc } from '@/lib/i18n/t'

type ContactKind = 'use' | 'create' | 'update' | 'none'

function fmt(v: unknown, type: FieldType, t: TFunc): string {
  if (type === 'bool') return v === true ? t('common.actions.yes') : v === false ? t('common.actions.no') : '—'
  return isBlank(v) ? '—' : String(v)
}

export function OnboardingReviewDialog({
  submission,
  propertyId,
  onClose,
  onDone,
}: {
  submission: OnboardingSubmission | null
  propertyId: number | null // null = create new property
  onClose: () => void
  onDone: () => void
}) {
  const { t: tt, locale } = useLocale() // unscoped: field labels carry their full dictionary path
  const { t: to } = useLocale('onboarding')
  const { t: ta } = useLocale('onboardingAdmin')
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  // After a create whose "mark applied" write failed, the property exists but the
  // submission is still pending. Switch this dialog to apply-to-that-property so
  // pressing Apply again cannot insert a second one.
  const [retargetId, setRetargetId] = useState<number | null>(null)
  const targetId = retargetId ?? propertyId
  const isMerge = targetId != null
  const isReapply = isMerge && !!submission && submission.status !== 'pending'

  // gcTime 0: always read the property fresh when the dialog opens, so the
  // "current listing" column and the default picks never come from a cache.
  const { data: existing, isLoading: existingLoading } = useQuery({
    queryKey: ['/onboarding-review/property', targetId],
    enabled: isMerge && !!submission,
    gcTime: 0,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('properties').select('*').eq('id', targetId!).single()
      if (error) throw error
      return data as any
    },
  })

  const { data: existingContact, isLoading: existingContactLoading, isError: existingContactError } = useQuery({
    queryKey: ['/onboarding-review/contact', existing?.contact_id],
    enabled: isMerge && !!existing?.contact_id,
    gcTime: 0,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('id, full_name, email, phone').eq('id', existing!.contact_id).single()
      if (error) throw error
      return data as any
    },
  })

  // Reuse the client this person already is instead of creating a duplicate.
  const { data: contactMatch, isLoading: matchLoading } = useSubmissionContactMatch(submission, !!submission)
  const { owners } = useSubmissionLookups(submission ? [submission] : undefined)
  const ownerName = submission?.owner_id ? (owners?.get(submission.owner_id)?.name || owners?.get(submission.owner_id)?.email || null) : null

  // Per-field choice for merge mode: 'current' keeps the listing, 'submitted'
  // takes the questionnaire value.
  const [choices, setChoices] = useState<Record<string, Pick>>({})
  // Submitted values the admin swapped in (an iCal link found in the notes).
  const [overrides, setOverrides] = useState<Record<string, unknown>>({})
  // Editable field values for create mode (prefilled from the submission).
  const [createVals, setCreateVals] = useState<Record<string, any>>({})
  const [beds, setBeds] = useState<Beds>({ king: 0, queen: 0, full: 0, twin: 0 })
  const [hasAutoCode, setHasAutoCode] = useState(false)
  const [copyPhotos, setCopyPhotos] = useState(true)
  const [contactKind, setContactKind] = useState<ContactKind>('none')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactInit, setContactInit] = useState<string | null>(null)

  useEffect(() => { setRetargetId(null) }, [submission?.id])

  const noteIcalUrls = useMemo(() => extractIcalUrls(submission?.notes), [submission?.notes])
  const photos = submission?.photos ?? []
  const imagePhotos = photos.filter(isImagePath)
  const fields = submission ? visibleFields(submission, isMerge ? existing ?? null : null) : []

  const ready = !!submission && (!isMerge || (!existingLoading && !!existing))

  // Initialise all editable state once the submission (and property, for merge)
  // are loaded.
  useEffect(() => {
    if (!submission) return
    if (isMerge && !existing) return
    setOverrides({})
    setCopyPhotos(true)
    if (isMerge) {
      setChoices(defaultChoices(existing, submission))
      // Prefill bed counts from the existing structured columns; if the listing
      // has none recorded, seed from a parse of the typed bed sizes.
      const hasStructured = BED_COLS.some(b => (existing[b.col] ?? 0) > 0)
      setBeds(hasStructured
        ? { king: existing.king_beds ?? 0, queen: existing.queen_beds ?? 0, full: existing.full_beds ?? 0, twin: existing.twin_beds ?? 0 }
        : parseBeds(submission.bed_sizes))
      setHasAutoCode(defaultHasAutoCode(submission, existing))
    } else {
      setCreateVals(initialCreateValues(submission))
      setBeds(parseBeds(submission.bed_sizes))
      setHasAutoCode(defaultHasAutoCode(submission, null))
    }
  }, [submission?.id, existing?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Decide the client choice once everything it depends on has loaded.
  useEffect(() => {
    if (!submission) { setContactInit(null); return }
    if (contactInit === submission.id) return
    if (matchLoading) return
    if (isMerge && (!existing || (existing.contact_id && existingContactLoading))) return
    if (isMerge && existing.contact_id) {
      if (existingContactError || !existingContact) {
        // Could not read the linked client. Never fall back to overwriting it with
        // the submitter's details: leave it alone and say so.
        setContactKind('none')
      } else {
        setContactKind('update')
        setContactName(existingContact.full_name ?? submission.client_name ?? '')
        setContactEmail(existingContact.email ?? submission.contact_email ?? '')
        setContactPhone(existingContact.phone ?? submission.contact_phone ?? '')
      }
    } else {
      // Only the owner's own linked client is pre-selected. An email match is
      // shown as a suggestion the staff member has to choose.
      setContactKind(contactMatch?.how === 'owner' ? 'use' : submission.client_name?.trim() ? 'create' : 'none')
      setContactName(submission.client_name ?? '')
      setContactEmail(submission.contact_email ?? '')
      setContactPhone(submission.contact_phone ?? '')
    }
    setContactInit(submission.id)
  }, [submission?.id, existing?.id, existingContact?.id, existingContactLoading, existingContactError, matchLoading, contactMatch?.id, contactInit]) // eslint-disable-line react-hooks/exhaustive-deps

  const changedBy = user?.label || (user as any)?.google_email || 'admin'

  // The iCal link that would be saved right now (and whether it is a real link).
  const icalDef = SUBMISSION_FIELDS.find(f => f.prop === 'ical_url')!
  const icalValue = isMerge
    ? (choices.ical_url === 'submitted' ? submittedValue(icalDef, submission ?? {}, overrides) : null)
    : createVals.ical_url
  const icalProblem = urlProblem(icalValue)
  const icalInUse = isBlank(icalValue) ? null : normalizeUrlInput(String(icalValue))

  function useIcalFromNotes(url: string) {
    if (isMerge) {
      setOverrides(p => ({ ...p, ical_url: url }))
      setChoices(p => ({ ...p, ical_url: 'submitted' }))
    } else {
      setCreateVals(p => ({ ...p, ical_url: url }))
    }
  }

  const apply = useGuardedMutation('onboarding-queue', {
    mutationFn: async (): Promise<ApplyResult> => {
      let contact: ContactAction = { kind: 'none' }
      if (contactKind === 'use' && contactMatch) contact = { kind: 'use', contactId: contactMatch.id }
      else if (contactKind === 'create' && contactName.trim()) contact = { kind: 'create', name: contactName, email: contactEmail, phone: contactPhone }
      else if (contactKind === 'update' && existing?.contact_id && existingContact && contactName.trim()) {
        contact = { kind: 'update', contactId: existing.contact_id, name: contactName, email: contactEmail, phone: contactPhone }
      }
      return applySubmission({
        submission: submission!,
        propertyId: targetId,
        existing: isMerge ? existing : null,
        values: createVals,
        choices,
        overrides,
        beds,
        hasAutoCode,
        contact,
        copyPhotos,
        changedBy,
        staff: { id: user?.id ? Number(user.id) : null, label: user?.label ?? null },
      })
    },
    onSuccess: (res) => {
      const parts: string[] = []
      if (res.mode === 'create') parts.push(to('toasts.createdDescription', { id: res.propertyId }))
      else if (res.filled === 0 && !res.noteAdded && res.photosAdded === 0) parts.push(ta('toasts.nothingNew', { id: res.propertyId }))
      else {
        parts.push(to('toasts.mergedDescription', {
          count: res.filled,
          fieldWord: to(res.filled === 1 ? 'toasts.fieldSingular' : 'toasts.fieldPlural'),
          id: res.propertyId,
        }))
      }
      if (res.noteAdded) parts.push(ta('toasts.noteAdded'))
      if (res.photosAdded > 0) parts.push(ta('toasts.photosAdded', { count: res.photosAdded }))
      if (res.ownerLinked) parts.push(ta('toasts.ownerLinked'))
      toast({ title: res.mode === 'create' ? to('toasts.propertyCreated') : to('toasts.merged'), description: parts.join(' ') })
      if (res.warnings.length > 0) {
        toast({
          title: ta('toasts.warningsTitle'),
          description: res.warnings.map(w => ta(`warnings.${w.code}`)).join(' '),
          variant: 'destructive',
        })
      }
      refreshAfterWrite()
      onDone()
    },
    onError: (e: any) => {
      if (e?.message === 'edit_blocked') return
      if (e instanceof ApplyError) {
        if (e.code === 'already_applied') {
          // Someone else got there first. Refresh and close; do not write again.
          toast({
            title: to('toasts.saveFailed'),
            description: ta(e.propertyId == null ? 'toasts.alreadyApplied' : 'toasts.alreadyAppliedAfterWrite', { id: e.propertyId ?? '' }),
            variant: 'destructive',
          })
          refreshAfterWrite()
          onDone()
          return
        }
        // The property exists; only the "applied" marker failed. Retarget this
        // dialog at it so Apply can no longer create a second property.
        toast({
          title: to('toasts.saveFailed'),
          description: ta(e.mode === 'create' ? 'toasts.markFailedCreate' : 'toasts.markFailedMerge', { id: e.propertyId ?? '', error: e.detail }),
          variant: 'destructive',
        })
        if (e.mode === 'create' && e.propertyId != null) {
          setRetargetId(e.propertyId)
          setContactInit(null)
        }
        refreshAfterWrite()
        return
      }
      toast({ title: to('toasts.saveFailed'), description: e?.message || to('toasts.tryAgain'), variant: 'destructive' })
    },
  })

  function refreshAfterWrite() {
    qc.invalidateQueries({ queryKey: [SUBMISSIONS_KEY] })
    // Newly created/merged property: refresh every property-derived view
    // (quote sheet, master list, pipeline, pro-forma, dashboards, readiness, ...).
    invalidateAllPropertyQueries(qc)
    qc.invalidateQueries({ queryKey: ['/supabase/property-photos'] })
    qc.invalidateQueries({ queryKey: ['/supabase/owner-assigned-props'] })
  }

  const open = !!submission
  const needsName = (contactKind === 'create' || contactKind === 'update') && !contactName.trim()
  const targetName = existing?.name ?? ''

  const titleKey = !isMerge ? 'create' : isReapply ? 'reapply' : 'apply'
  const saveLabel = apply.isPending
    ? to('review.actions.saving')
    : ta(`dialog.actions.${titleKey}`)

  const matchHow = contactMatch ? ta(contactMatch.how === 'owner' ? 'contact.matchOwner' : 'contact.matchEmail') : ''

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !apply.isPending) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ta(`dialog.title.${titleKey}`, { name: targetName })}</DialogTitle>
          <DialogDescription>{ta(`dialog.description.${titleKey}`)}</DialogDescription>
        </DialogHeader>

        {!ready || !submission ? (
          <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
        ) : (
          <div className="space-y-4">
            {/* Who sent this, and where it is going */}
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-0.5" data-testid="review-summary">
              <p>
                <span className="font-medium">{submission.client_name || to('queue.row.unknownClient')}</span>
                {' · '}{ta(`submissions.source.${sourceLabel(submission.source)}`)}
                {' · '}{ta('dialog.submittedOn', { date: new Date(submission.submitted_at).toLocaleDateString(locale === 'es' ? 'es' : 'en-US') })}
              </p>
              {submission.owner_id && <p className="text-muted-foreground">{ta('dialog.ownerLogin', { name: ownerName ?? '—' })}</p>}
              {isMerge && <p className="text-muted-foreground">{ta('dialog.applyingTo', { name: targetName, id: targetId! })}</p>}
            </div>

            {/* Calendar links the client buried in the notes */}
            <IcalLinks urls={noteIcalUrls} inUse={icalInUse} onUse={useIcalFromNotes} />

            {/* Field-by-field */}
            <div className="rounded-lg border border-border overflow-hidden">
              {isMerge && (
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-1.5 bg-muted/60 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>{to('review.table.field')}</span><span>{to('review.table.currentListing')}</span><span>{to('review.table.submitted')}</span>
                </div>
              )}
              {fields.map((f, idx) => {
                const subVal = submittedValue(f, submission, overrides)
                const fieldLabel = tt(f.labelKey)
                const rowError = f.url
                  ? (isMerge ? (choices[f.prop] === 'submitted' ? urlProblem(subVal) : null) : urlProblem(createVals[f.prop]))
                  : null
                if (!isMerge) {
                  return (
                    <div key={f.prop} className={`px-3 py-1.5 ${idx % 2 ? 'bg-muted/10' : ''}`}>
                      <div className="grid grid-cols-[1fr_2fr] gap-2 items-center">
                        <label className="text-xs text-muted-foreground">{fieldLabel}</label>
                        {f.type === 'bool' ? (
                          <div className="flex gap-1">
                            {[{ v: true, l: tt('common.actions.yes') }, { v: false, l: tt('common.actions.no') }].map(o => (
                              <button key={String(o.v)} type="button"
                                onClick={() => setCreateVals(p => ({ ...p, [f.prop]: o.v }))}
                                className={`h-7 px-3 text-xs rounded border ${createVals[f.prop] === o.v ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input hover:bg-muted'}`}>
                                {o.l}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <Input
                            type={f.type === 'number' ? 'number' : 'text'}
                            value={createVals[f.prop] ?? ''}
                            onChange={e => setCreateVals(p => ({ ...p, [f.prop]: f.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value }))}
                            className="h-7 text-xs"
                            data-testid={`field-${f.prop}`}
                          />
                        )}
                      </div>
                      {rowError && <p className="text-xs text-destructive mt-1 sm:ml-[33%]">{ta('ical.invalid')}</p>}
                    </div>
                  )
                }
                const curVal = existing[f.prop]
                const conflict = f.type === 'bool'
                  ? (curVal != null && subVal != null && curVal !== subVal)
                  : (!isBlank(curVal) && !isBlank(subVal) && String(curVal) !== String(subVal))
                const choice = choices[f.prop] ?? 'current'
                return (
                  <div key={f.prop} className={`border-t border-border ${conflict ? 'bg-warning/10' : idx % 2 ? 'bg-muted/10' : ''}`}>
                    <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-start px-3 py-2">
                      <span className="text-xs text-muted-foreground">{fieldLabel}{conflict && <span className="ml-1 text-warning" title={to('review.table.valuesDiffer')}>⚠</span>}</span>
                      <button type="button" onClick={() => setChoices(p => ({ ...p, [f.prop]: 'current' }))}
                        className={`text-left text-xs rounded border px-2 py-1 break-words ${choice === 'current' ? 'border-primary bg-primary/5 font-medium' : 'border-transparent hover:bg-muted/50'}`}>
                        {fmt(curVal, f.type, tt)}
                      </button>
                      <button type="button" onClick={() => setChoices(p => ({ ...p, [f.prop]: 'submitted' }))}
                        className={`text-left text-xs rounded border px-2 py-1 break-words ${choice === 'submitted' ? 'border-primary bg-primary/5 font-medium' : 'border-transparent hover:bg-muted/50'}`}>
                        {fmt(subVal, f.type, tt)}
                      </button>
                    </div>
                    {rowError && <p className="text-xs text-destructive px-3 pb-2">{ta('ical.invalid')}</p>}
                  </div>
                )
              })}
            </div>

            {/* Bed sizes: free text in, structured out */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold"><Bed className="w-3.5 h-3.5" /> {to('review.bedSection.title')}</div>
              {submission.bed_sizes && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{to('review.bedSection.clientTyped')}</span> {submission.bed_sizes}
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {BED_COLS.map(b => (
                  <div key={b.key}>
                    <label className="text-2xs text-muted-foreground">{to(`review.bedSizes.${b.labelKey}`)}</label>
                    <Input type="number" min={0} value={beds[b.key]}
                      onChange={e => setBeds(p => ({ ...p, [b.key]: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)) }))}
                      className="h-7 text-xs mt-0.5" data-testid={`bed-${b.key}`} />
                  </div>
                ))}
              </div>
              <p className="text-2xs text-muted-foreground">{to('review.bedSection.hint')}</p>
            </div>

            {/* Auto code (smart lock): pre-checked when the client entered one */}
            <label className="flex items-start gap-2 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/30">
              <Checkbox checked={hasAutoCode} onCheckedChange={(v) => setHasAutoCode(!!v)} className="mt-0.5" />
              <div className="text-xs flex-1">
                <div className="font-medium">{to('review.autoCode.label')}</div>
                <div className="text-muted-foreground">{to('review.autoCode.hint')}</div>
                {!isBlank(submission.auto_code) && (
                  <div className="mt-1 text-foreground">{ta('dialog.autoCodeSubmitted', { code: submission.auto_code!.trim() })}</div>
                )}
              </div>
            </label>

            {/* Client (contact) */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <p className="text-xs font-semibold">{ta('contact.title')}</p>
              <RadioGroup value={contactKind} onValueChange={(v) => setContactKind(v as ContactKind)} className="gap-1.5">
                {isMerge && existing?.contact_id ? (
                  <>
                    {existingContact && !existingContactError && <ContactOption value="update" label={to('review.contact.updateLinked')} />}
                    <ContactOption value="none" label={ta('contact.leaveLinked')} />
                  </>
                ) : (
                  <>
                    {contactMatch && (
                      <ContactOption
                        value="use"
                        label={ta(contactMatch.how === 'owner' ? 'contact.useExisting' : 'contact.useSuggested', { name: contactMatch.full_name || contactMatch.email || '' })}
                        hint={[matchHow, contactMatch.email, contactMatch.phone].filter(Boolean).join(' · ')}
                      />
                    )}
                    <ContactOption value="create" label={ta('contact.createNew')} />
                    <ContactOption value="none" label={ta('contact.none')} />
                  </>
                )}
              </RadioGroup>
              {contactMatch?.how === 'email' && contactKind === 'create' && (
                <p className="text-xs text-warning" data-testid="contact-duplicate-warning">{ta('contact.duplicateWarning')}</p>
              )}
              {isMerge && existing?.contact_id && !existingContactLoading && (existingContactError || !existingContact) && (
                <p className="text-xs text-destructive" data-testid="contact-load-failed">{ta('contact.loadFailed')}</p>
              )}
              {(contactKind === 'create' || contactKind === 'update') && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  <div>
                    <label className="text-2xs text-muted-foreground">{tt('common.labels.name')}</label>
                    <Input value={contactName} onChange={e => setContactName(e.target.value)} className="h-7 text-xs mt-0.5" />
                  </div>
                  <div>
                    <label className="text-2xs text-muted-foreground">{tt('common.labels.email')}</label>
                    <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} className="h-7 text-xs mt-0.5" />
                  </div>
                  <div>
                    <label className="text-2xs text-muted-foreground">{tt('common.labels.phone')}</label>
                    <Input value={contactPhone} onChange={e => setContactPhone(e.target.value)} className="h-7 text-xs mt-0.5" />
                  </div>
                </div>
              )}
            </div>

            {/* Notes: saved as a property note */}
            {!isBlank(submission.notes) && (
              <div className="rounded-lg border border-border p-3 space-y-1.5">
                <p className="text-xs font-semibold">{ta('dialog.notesTitle')}</p>
                <div className="whitespace-pre-wrap text-sm bg-muted/30 rounded p-2 break-words">{submission.notes}</div>
                <p className="text-2xs text-muted-foreground">{ta('dialog.notesHint')}</p>
              </div>
            )}

            {/* Photos */}
            {photos.length > 0 && (
              <div className="rounded-lg border border-border p-3 space-y-2">
                {imagePhotos.length > 0 && (
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                    <Checkbox checked={copyPhotos} onCheckedChange={(v) => setCopyPhotos(!!v)} data-testid="checkbox-copy-photos" />
                    {ta('dialog.copyPhotos', { count: imagePhotos.length })}
                  </label>
                )}
                <div className="flex gap-2 flex-wrap">
                  {photos.slice(0, 8).map(p => {
                    const url = onboardingPhotoUrl(p)
                    return (
                      <a key={p} href={safeHref(url) ?? undefined} target="_blank" rel="noopener noreferrer" className="block w-14 h-14 rounded border border-border overflow-hidden bg-muted/30 hover:opacity-80">
                        {isImagePath(p) ? <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" /> : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ExternalLink className="w-4 h-4" /></div>
                        )}
                      </a>
                    )
                  })}
                </div>
                {photos.length > imagePhotos.length && (
                  <p className="text-2xs text-muted-foreground">{ta('dialog.pdfsHint', { count: photos.length - imagePhotos.length })}</p>
                )}
              </div>
            )}

            {/* Everything with no home on the property */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <p className="text-xs font-semibold">{ta('extras.title')}</p>
              <p className="text-2xs text-muted-foreground">{ta('extras.intro')}</p>
              {submissionExtras(submission).length > 0
                ? <ExtrasList submission={submission} />
                : <p className="text-sm text-muted-foreground">{ta('extras.none')}</p>}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={apply.isPending}>{tt('common.actions.cancel')}</Button>
          <Button
            onClick={() => apply.mutate()}
            disabled={!ready || apply.isPending || needsName || (!!icalProblem)}
            data-testid="button-apply-submission"
          >
            {saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ContactOption({ value, label, hint }: { value: ContactKind; label: string; hint?: string }) {
  const id = `contact-kind-${value}`
  return (
    <div className="flex items-start gap-2">
      <RadioGroupItem value={value} id={id} className="mt-0.5" />
      <label htmlFor={id} className="text-xs cursor-pointer">
        <span>{label}</span>
        {hint && <span className="block text-2xs text-muted-foreground">{hint}</span>}
      </label>
    </div>
  )
}
