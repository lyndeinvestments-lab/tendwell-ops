import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, logPropertyEdit } from '@/lib/supabase'
import { invalidateAllPropertyQueries } from '@/lib/query-invalidations'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Bed } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import type { TFunc } from '@/lib/i18n/t'

const ONBOARDING_STAGE_ID = 3

// Fields the questionnaire collects that map 1:1 onto a properties column.
// `key` is the submission field, `prop` is the properties column. `labelKey`
// resolves under the `onboarding.review.fields.*` dictionary namespace.
type FieldType = 'text' | 'number' | 'bool'
const FIELDS: { key: string; prop: string; labelKey: string; type: FieldType }[] = [
  { key: 'property_name', prop: 'name', labelKey: 'propertyName', type: 'text' },
  { key: 'address', prop: 'address', labelKey: 'address', type: 'text' },
  { key: 'bedrooms', prop: 'bedrooms', labelKey: 'bedrooms', type: 'number' },
  { key: 'number_of_beds', prop: 'number_of_beds', labelKey: 'numberOfBeds', type: 'number' },
  { key: 'full_baths', prop: 'full_baths', labelKey: 'fullBaths', type: 'number' },
  { key: 'half_baths', prop: 'half_baths', labelKey: 'halfBaths', type: 'number' },
  { key: 'square_footage', prop: 'square_footage', labelKey: 'squareFootage', type: 'number' },
  { key: 'hot_tub', prop: 'hot_tub', labelKey: 'hotTub', type: 'bool' },
  { key: 'linen_program', prop: 'linen_program', labelKey: 'linenProgram', type: 'bool' },
  { key: 'door_code', prop: 'door_code', labelKey: 'frontDoorCode', type: 'text' },
  { key: 'other_codes', prop: 'other_codes', labelKey: 'otherCodes', type: 'text' },
  { key: 'wifi_info', prop: 'wifi_info', labelKey: 'wifi', type: 'text' },
  { key: 'filter_size', prop: 'filter_size', labelKey: 'acFilterSize', type: 'text' },
  { key: 'check_in_time', prop: 'check_in_time', labelKey: 'checkInTime', type: 'text' },
  { key: 'check_out_time', prop: 'check_out_time', labelKey: 'checkOutTime', type: 'text' },
]

const BED_COLS = [
  { key: 'king', col: 'king_beds', labelKey: 'king' },
  { key: 'queen', col: 'queen_beds', labelKey: 'queen' },
  { key: 'full', col: 'full_beds', labelKey: 'full' },
  { key: 'twin', col: 'twin_beds', labelKey: 'twin' },
] as const

type Beds = { king: number; queen: number; full: number; twin: number }

const isBlank = (v: any) => v == null || v === ''

function fmt(v: any, type: FieldType, t: TFunc): string {
  if (type === 'bool') return v === true ? t('common.actions.yes') : v === false ? t('common.actions.no') : '—'
  return isBlank(v) ? '—' : String(v)
}

// Best-effort parse of the free-text bed sizes string into structured counts,
// as a starting suggestion the admin can correct. Captures an optional leading
// quantity right before each keyword ("2 Twins" -> 2, "King" -> 1). Room numbers
// ("Bedroom 3") are ignored because they aren't adjacent to a bed keyword.
function parseBeds(text: string | null | undefined): Beds {
  const res: Beds = { king: 0, queen: 0, full: 0, twin: 0 }
  if (!text) return res
  const tally = (words: string) => {
    const re = new RegExp(`(?:(\\d+)\\s*)?\\b(?:${words})s?\\b`, 'gi')
    let total = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) total += m[1] ? parseInt(m[1], 10) : 1
    return total
  }
  res.king = tally('king')
  res.queen = tally('queen')
  res.full = tally('full|double')
  res.twin = tally('twin|single')
  return res
}

export function OnboardingReviewDialog({
  submission,
  propertyId,
  onClose,
  onDone,
}: {
  submission: any | null
  propertyId: number | null // null = create new property
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useLocale('onboarding')
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const isMerge = propertyId != null

  const { data: existing, isLoading: existingLoading } = useQuery({
    queryKey: ['/onboarding-review/property', propertyId],
    enabled: isMerge && !!submission,
    queryFn: async () => {
      const { data, error } = await supabase.from('properties').select('*').eq('id', propertyId!).single()
      if (error) throw error
      return data as any
    },
  })

  const { data: existingContact } = useQuery({
    queryKey: ['/onboarding-review/contact', existing?.contact_id],
    enabled: isMerge && !!existing?.contact_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('id, full_name, email, phone').eq('id', existing!.contact_id).single()
      if (error) throw error
      return data as any
    },
  })

  // Per-field choice for merge mode: 'current' keeps the listing, 'submitted'
  // takes the questionnaire value.
  const [choices, setChoices] = useState<Record<string, 'current' | 'submitted'>>({})
  // Editable field values for create mode (prefilled from the submission).
  const [createVals, setCreateVals] = useState<Record<string, any>>({})
  const [beds, setBeds] = useState<Beds>({ king: 0, queen: 0, full: 0, twin: 0 })
  const [hasAutoCode, setHasAutoCode] = useState(false)
  const [linkContact, setLinkContact] = useState(true)
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')

  const ready = !!submission && (!isMerge || (!existingLoading && !!existing))

  // Initialise all editable state once the submission (and property, for merge)
  // are loaded.
  useEffect(() => {
    if (!submission) return
    if (isMerge && !existing) return

    if (isMerge) {
      const next: Record<string, 'current' | 'submitted'> = {}
      for (const f of FIELDS) {
        const cur = existing[f.prop]
        const sub = submission[f.key]
        // Default to the submitted value only when the listing has nothing yet.
        next[f.prop] = isBlank(cur) && !isBlank(sub) ? 'submitted' : 'current'
      }
      setChoices(next)
      // Prefill bed counts from the existing structured columns; if the listing
      // has none recorded, seed from a parse of the typed bed sizes.
      const hasStructured = BED_COLS.some(b => (existing[b.col] ?? 0) > 0)
      setBeds(hasStructured
        ? { king: existing.king_beds ?? 0, queen: existing.queen_beds ?? 0, full: existing.full_beds ?? 0, twin: existing.twin_beds ?? 0 }
        : parseBeds(submission.bed_sizes))
      setHasAutoCode(!!existing.has_auto_code)
      setContactName(existingContact?.full_name ?? submission.client_name ?? '')
      setContactEmail(existingContact?.email ?? submission.contact_email ?? '')
      setContactPhone(existingContact?.phone ?? submission.contact_phone ?? '')
    } else {
      const vals: Record<string, any> = {}
      for (const f of FIELDS) vals[f.prop] = submission[f.key]
      setCreateVals(vals)
      setBeds(parseBeds(submission.bed_sizes))
      setHasAutoCode(false)
      setContactName(submission.client_name ?? '')
      setContactEmail(submission.contact_email ?? '')
      setContactPhone(submission.contact_phone ?? '')
    }
  }, [submission?.id, existing?.id, existingContact?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const changedBy = user?.label || (user as any)?.google_email || 'admin'

  const markConverted = async (pid: number) => {
    const { error } = await supabase.from('onboarding_submissions').update({
      status: 'converted',
      approved_at: new Date().toISOString(),
      approved_by: changedBy,
      property_id: pid,
    }).eq('id', submission.id)
    if (error) throw error
  }

  const apply = useMutation({
    mutationFn: async () => {
      if (!isMerge) {
        // CREATE NEW PROPERTY
        let contactId: string | null = null
        if (linkContact && contactName.trim()) {
          const { data: c, error } = await supabase.from('contacts')
            .insert({ full_name: contactName.trim(), email: contactEmail || null, phone: contactPhone || null, source: 'Onboarding' } as any)
            .select('id').single()
          if (error) throw error
          contactId = c.id
        }
        const payload: Record<string, any> = {
          name: createVals.name || submission.property_name || submission.address || submission.client_name || 'New Property',
          stage_id: ONBOARDING_STAGE_ID,
          king_beds: beds.king, queen_beds: beds.queen, full_beds: beds.full, twin_beds: beds.twin,
          bed_sizes_text: submission.bed_sizes ?? null,
          has_auto_code: hasAutoCode,
        }
        for (const f of FIELDS) {
          if (f.prop === 'name') continue
          payload[f.prop] = createVals[f.prop]
        }
        if (contactId) payload.contact_id = contactId
        // Strip nulls so NOT NULL columns (check_in_time/check_out_time) fall
        // back to their defaults.
        for (const k of Object.keys(payload)) if (payload[k] == null) delete payload[k]
        const { data: np, error } = await supabase.from('properties').insert(payload as any).select('id').single()
        if (error) throw error
        await markConverted(np.id)
        return { propertyId: np.id, mode: 'create' as const, filled: 0 }
      }

      // MERGE INTO EXISTING PROPERTY
      const patch: Record<string, any> = {}
      for (const f of FIELDS) {
        if (choices[f.prop] === 'submitted') {
          const v = submission[f.key]
          if (v !== existing[f.prop]) patch[f.prop] = v
        }
      }
      // Structured beds always come from the admin-entered inputs.
      for (const b of BED_COLS) {
        if ((existing[b.col] ?? 0) !== beds[b.key]) patch[b.col] = beds[b.key]
      }
      if (submission.bed_sizes && existing.bed_sizes_text !== submission.bed_sizes) {
        patch.bed_sizes_text = submission.bed_sizes
      }
      if ((existing.has_auto_code ?? false) !== hasAutoCode) patch.has_auto_code = hasAutoCode

      if (linkContact && contactName.trim()) {
        if (existing.contact_id) {
          const { error } = await supabase.from('contacts')
            .update({ full_name: contactName.trim(), email: contactEmail || null, phone: contactPhone || null, updated_at: new Date().toISOString() } as any)
            .eq('id', existing.contact_id)
          if (error) throw error
        } else {
          const { data: c, error } = await supabase.from('contacts')
            .insert({ full_name: contactName.trim(), email: contactEmail || null, phone: contactPhone || null, source: 'Onboarding' } as any)
            .select('id').single()
          if (error) throw error
          patch.contact_id = c.id
        }
      }

      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from('properties').update(patch as any).eq('id', propertyId!)
        if (error) throw error
        for (const [field, newValue] of Object.entries(patch)) {
          await logPropertyEdit(propertyId!, field, existing[field] ?? null, newValue ?? null, existing.name ?? null, `${changedBy} (onboarding merge)`)
        }
      }
      await markConverted(propertyId!)
      return { propertyId: propertyId!, mode: 'merge' as const, filled: Object.keys(patch).length }
    },
    onSuccess: (res) => {
      toast({
        title: res.mode === 'create' ? t('toasts.propertyCreated') : t('toasts.merged'),
        description: res.mode === 'create'
          ? t('toasts.createdDescription', { id: res.propertyId })
          : t('toasts.mergedDescription', {
              count: res.filled,
              fieldWord: t(res.filled === 1 ? 'toasts.fieldSingular' : 'toasts.fieldPlural'),
              id: res.propertyId,
            }),
      })
      qc.invalidateQueries({ queryKey: ['/onboarding_submissions'] })
      // Newly created/merged property — refresh every property-derived view
      // (quote sheet, master list, pipeline, pro-forma, dashboards, …).
      invalidateAllPropertyQueries(qc)
      onDone()
    },
    onError: (e: any) => toast({ title: t('toasts.saveFailed'), description: e?.message || t('toasts.tryAgain'), variant: 'destructive' }),
  })

  const open = !!submission
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !apply.isPending) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isMerge ? t('review.title.merge') : t('review.title.create')}</DialogTitle>
          <DialogDescription>
            {isMerge ? t('review.description.merge') : t('review.description.create')}
          </DialogDescription>
        </DialogHeader>

        {!ready ? (
          <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
        ) : (
          <div className="space-y-4">
            {/* Field-by-field */}
            <div className="rounded-lg border border-border overflow-hidden">
              {isMerge && (
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-1.5 bg-muted/60 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>{t('review.table.field')}</span><span>{t('review.table.currentListing')}</span><span>{t('review.table.submitted')}</span>
                </div>
              )}
              {FIELDS.map((f, idx) => {
                const subVal = submission[f.key]
                const fieldLabel = t(`review.fields.${f.labelKey}`)
                if (!isMerge) {
                  return (
                    <div key={f.prop} className={`grid grid-cols-[1fr_2fr] gap-2 items-center px-3 py-1.5 ${idx % 2 ? 'bg-muted/10' : ''}`}>
                      <label className="text-xs text-muted-foreground">{fieldLabel}</label>
                      {f.type === 'bool' ? (
                        <div className="flex gap-1">
                          {[{ v: true, l: t('common.actions.yes') }, { v: false, l: t('common.actions.no') }].map(o => (
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
                        />
                      )}
                    </div>
                  )
                }
                const curVal = existing[f.prop]
                const conflict = f.type === 'bool'
                  ? (curVal != null && subVal != null && curVal !== subVal)
                  : (!isBlank(curVal) && !isBlank(subVal) && String(curVal) !== String(subVal))
                const choice = choices[f.prop] ?? 'current'
                return (
                  <div key={f.prop} className={`grid grid-cols-[1fr_1fr_1fr] gap-2 items-start px-3 py-2 border-t border-border ${conflict ? 'bg-amber-50/40 dark:bg-amber-900/10' : idx % 2 ? 'bg-muted/10' : ''}`}>
                    <span className="text-xs text-muted-foreground">{fieldLabel}{conflict && <span className="ml-1 text-amber-600 dark:text-amber-400" title={t('review.table.valuesDiffer')}>⚠</span>}</span>
                    <button type="button" onClick={() => setChoices(p => ({ ...p, [f.prop]: 'current' }))}
                      className={`text-left text-xs rounded border px-2 py-1 break-words ${choice === 'current' ? 'border-primary bg-primary/5 font-medium' : 'border-transparent hover:bg-muted/50'}`}>
                      {fmt(curVal, f.type, t)}
                    </button>
                    <button type="button" onClick={() => setChoices(p => ({ ...p, [f.prop]: 'submitted' }))}
                      className={`text-left text-xs rounded border px-2 py-1 break-words ${choice === 'submitted' ? 'border-primary bg-primary/5 font-medium' : 'border-transparent hover:bg-muted/50'}`}>
                      {fmt(subVal, f.type, t)}
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Bed sizes — free text in, structured out */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold"><Bed className="w-3.5 h-3.5" /> {t('review.bedSection.title')}</div>
              {submission.bed_sizes && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{t('review.bedSection.clientTyped')}</span> {submission.bed_sizes}
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {BED_COLS.map(b => (
                  <div key={b.key}>
                    <label className="text-[11px] text-muted-foreground">{t(`review.bedSizes.${b.labelKey}`)}</label>
                    <Input type="number" min={0} value={beds[b.key]}
                      onChange={e => setBeds(p => ({ ...p, [b.key]: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)) }))}
                      className="h-7 text-xs mt-0.5" data-testid={`bed-${b.key}`} />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{t('review.bedSection.hint')}</p>
            </div>

            {/* Auto code (smart lock) — admin sets; the code value lives in Settings */}
            <label className="flex items-start gap-2 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/30">
              <Checkbox checked={hasAutoCode} onCheckedChange={(v) => setHasAutoCode(!!v)} className="mt-0.5" />
              <div className="text-xs flex-1">
                <div className="font-medium">{t('review.autoCode.label')}</div>
                <div className="text-muted-foreground">{t('review.autoCode.hint')}</div>
              </div>
            </label>

            {/* Contact */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold">
                <Checkbox checked={linkContact} onCheckedChange={(v) => setLinkContact(!!v)} />
                {isMerge && existing?.contact_id ? t('review.contact.updateLinked') : t('review.contact.saveNew')}
              </label>
              {linkContact && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="text-[11px] text-muted-foreground">{t('common.labels.name')}</label>
                    <Input value={contactName} onChange={e => setContactName(e.target.value)} className="h-7 text-xs mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">{t('common.labels.email')}</label>
                    <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} className="h-7 text-xs mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">{t('common.labels.phone')}</label>
                    <Input value={contactPhone} onChange={e => setContactPhone(e.target.value)} className="h-7 text-xs mt-0.5" />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={apply.isPending}>{t('common.actions.cancel')}</Button>
          <Button onClick={() => apply.mutate()} disabled={!ready || apply.isPending || (linkContact && !contactName.trim())}>
            {apply.isPending ? t('review.actions.saving') : isMerge ? t('review.actions.saveMerge') : t('review.actions.createProperty')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
