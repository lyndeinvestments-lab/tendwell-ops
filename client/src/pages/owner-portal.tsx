import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Json } from '@shared/database.types'
import { invalidateAllPropertyQueries } from '@/lib/query-invalidations'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, LogOut, Home, CalendarClock, ClipboardList, ChevronDown, Lock, ArrowLeft, Package, Gift, Quote, MessageSquare, FileText, Plus, Eye, Image as ImageIcon } from 'lucide-react'
import { normalizeOwnerPermissions, changeOwnerEmail, type OwnerPermissions } from '@/lib/owners'
import { normalizeCalendarUrl } from '@/lib/url-safety'
import { PortalReadOnlyContext, usePortalReadOnly } from '@/components/owner/portal-context'
import { Field } from '@/components/owner/Field'
import { formatDate } from '@/components/owner/format'
import { AgreementSection } from '@/components/owner/AgreementSection'
import { TrellisPortalCard } from '@/components/owner/TrellisPortalCard'
import { OnboardingGuide } from '@/components/owner/OnboardingGuide'
import { useOnboardingGuide } from '@/components/owner/useOnboardingGuide'
import { RequestQuoteCard } from '@/components/owner/RequestQuoteCard'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'
import { thumbUrl } from '@/lib/image'
import { resizeImageFile } from '@/lib/resize-image'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import { LanguageToggle } from '@/components/LanguageToggle'

// A property as returned by the get_owner_properties() RPC. The RPC omits any
// field the owner can't see (visibility enforced in the DB), so every value
// field is optional. `permissions` carries the resolved visible/editable matrix
// so the portal can render read-only vs editable inputs.
type OwnerProperty = {
  id: number
  name: string
  stage?: string | null
  permissions: OwnerPermissions
  address?: string | null
  king_beds?: number | null
  queen_beds?: number | null
  full_beds?: number | null
  twin_beds?: number | null
  square_footage?: number | null
  door_code?: string | null
  other_codes?: string | null
  wifi_info?: string | null
  bedrooms?: number | null
  full_baths?: number | null
  half_baths?: number | null
  hot_tub?: boolean | null
  pool?: boolean | null
  check_in_time?: string | null
  check_out_time?: string | null
  filter_size?: string | null
  ical_url?: string | null
}

// Columns the owner may submit, grouped by permission field key. Used to build
// the update payload from only the fields the owner can edit (the DB guard
// trigger enforces this too — this just keeps the request honest).
const EDITABLE_COLUMNS: Record<keyof OwnerPermissions, (keyof OwnerProperty)[]> = {
  address: ['address'],
  bed_sizes: ['king_beds', 'queen_beds', 'full_beds', 'twin_beds'],
  square_footage: ['square_footage'],
  door_code: ['door_code'],
  other_codes: ['other_codes'],
  wifi_info: ['wifi_info'],
  bedrooms: ['bedrooms'],
  baths: ['full_baths', 'half_baths'],
  amenities: ['hot_tub', 'pool'],
  check_times: ['check_in_time', 'check_out_time'],
  filter_size: ['filter_size'],
  ical_url: ['ical_url'],
  // Photos live in property_photos (RLS-scoped), not on the properties row.
  photos: [],
}

type FormState = Partial<Record<keyof OwnerProperty, string | number | boolean | null>>

function initialForm(p: OwnerProperty): FormState {
  const form: FormState = {}
  for (const cols of Object.values(EDITABLE_COLUMNS)) {
    for (const c of cols) form[c] = (p[c] ?? null) as string | number | boolean | null
  }
  return form
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
type OwnerTask = { source: string; title: string; task_date: string | null; status: string | null }

function TasksSection({ propertyId }: { propertyId: number }) {
  const { t } = useLocale('ownerPortal')
  const { format } = useDateFormat()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-tasks', propertyId],
    queryFn: async (): Promise<OwnerTask[]> => {
      const { data, error } = await supabase.rpc('get_owner_property_tasks', { p_property_id: propertyId })
      if (error) throw error
      return (data ?? []) as OwnerTask[]
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-9 rounded-md" />)}
      </div>
    )
  }
  if (isError) return <ErrorState onRetry={() => refetch()} title={t('tasks.loadFailedTitle')} description={t('tasks.loadFailedDescription')} />
  if (!data || data.length === 0) {
    return <EmptyState icon={CalendarClock} title={t('tasks.emptyTitle')} description={t('tasks.emptyDescription')} />
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {data.map((task, i) => (
        <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm text-foreground truncate">{task.title}</p>
            <p className="text-2xs text-muted-foreground">{formatDate(task.task_date, format)}</p>
          </div>
          <Badge variant="outline" className="shrink-0 capitalize">
            {task.source === 'trellis' ? t('tasks.sourceTrellis') : task.source}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

// ─── Owner notes section ──────────────────────────────────────────────────────
type OwnerNote = { id: string; content: string; created_at: string }

function OwnerNotesSection({ propertyId }: { propertyId: number }) {
  const { t } = useLocale('ownerPortal')
  const { format } = useDateFormat()
  const readOnly = usePortalReadOnly()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [text, setText] = useState('')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-property-notes', propertyId],
    queryFn: async (): Promise<OwnerNote[]> => {
      const { data, error } = await supabase.rpc('get_owner_property_notes', { p_property_id: propertyId })
      if (error) throw error
      return (data ?? []) as OwnerNote[]
    },
  })

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('owner_add_property_note', {
        p_property_id: propertyId,
        p_content: text.trim(),
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: t('notes.added') })
      setText('')
      queryClient.invalidateQueries({ queryKey: ['owner-property-notes', propertyId] })
    },
    onError: (e: unknown) =>
      toast({ title: t('notes.addFailedTitle'), description: e instanceof Error ? e.message : t('notes.addFailedDefault'), variant: 'destructive' }),
  })

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">{t('notes.title')}</h3>
      {!readOnly && (
        <div className="space-y-2">
          <Textarea
            rows={2}
            placeholder={t('notes.placeholder')}
            value={text}
            onChange={e => setText(e.target.value)}
            data-testid={`textarea-owner-note-${propertyId}`}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => add.mutate()}
              disabled={!text.trim() || add.isPending}
              data-testid={`button-add-note-${propertyId}`}
            >
              {add.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('notes.addButton')}
            </Button>
          </div>
        </div>
      )}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-9 rounded-md" />)}
        </div>
      )}
      {isError && <ErrorState onRetry={() => refetch()} title={t('notes.loadFailedTitle')} description={t('notes.loadFailedDescription')} />}
      {!isLoading && !isError && (data ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">{t('notes.empty')}</p>
      )}
      {!isLoading && !isError && (data ?? []).length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {(data ?? []).map(n => (
            <li key={n.id} className="px-3 py-2 space-y-0.5">
              <p className="text-sm text-foreground whitespace-pre-wrap">{n.content}</p>
              <p className="text-2xs text-muted-foreground">{formatDate(n.created_at, format)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ─── Owner photos section ─────────────────────────────────────────────────────
// Owners can view and add photos for their properties. No delete — staff manage
// deletions via the staff property modal. RLS scopes reads/inserts to the
// owner's assigned properties.
type OwnerPhoto = { id: string; photo_url: string; sort_order: number | null }

function OwnerPhotosSection({ propertyId, canAdd }: { propertyId: number; canAdd: boolean }) {
  const { t } = useLocale('ownerPortal')
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [uploading, setUploading] = useState(false)

  const { data: photos, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-property-photos', propertyId],
    queryFn: async (): Promise<OwnerPhoto[]> => {
      const { data, error } = await supabase
        .from('property_photos')
        .select('id, photo_url, sort_order')
        .eq('property_id', propertyId)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as OwnerPhoto[]
    },
  })

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setUploading(true)
    try {
      for (const raw of files) {
        const file = await resizeImageFile(raw)
        const ext = file.name.split('.').pop()
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const path = `${propertyId}/${filename}`
        const { error: uploadErr } = await supabase.storage.from('property-photos').upload(path, file, { contentType: file.type || 'image/jpeg' })
        if (uploadErr) throw uploadErr
        const { data: urlData } = supabase.storage.from('property-photos').getPublicUrl(path)
        const currentCount = photos?.length ?? 0
        const { error: insertErr } = await supabase.from('property_photos').insert({
          property_id: propertyId,
          photo_url: urlData.publicUrl,
          sort_order: currentCount,
        })
        if (insertErr) throw insertErr
      }
      queryClient.invalidateQueries({ queryKey: ['owner-property-photos', propertyId] })
      toast({ title: t('photos.uploadedToast', { count: files.length }) })
    } catch (err: any) {
      toast({ title: t('photos.uploadFailedTitle'), description: err?.message, variant: 'destructive' })
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
        <ImageIcon className="w-3.5 h-3.5 text-muted-foreground" /> {t('photos.title')}
      </h3>
      {canAdd && (
        <label className={`flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-4 cursor-pointer hover:border-primary/50 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
          <input type="file" accept="image/*" multiple onChange={handleUpload} className="hidden" data-testid={`input-owner-photos-${propertyId}`} />
          <Plus className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{uploading ? t('photos.uploading') : t('photos.uploadCta')}</span>
        </label>
      )}
      {isLoading && (
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="aspect-square rounded-md" />)}
        </div>
      )}
      {isError && <ErrorState onRetry={() => refetch()} title={t('photos.loadFailedTitle')} description={t('photos.loadFailedDescription')} />}
      {!isLoading && !isError && (photos ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">{t('photos.empty')}</p>
      )}
      {!isLoading && !isError && (photos ?? []).length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos!.map(p => (
            <a key={p.id} href={p.photo_url} target="_blank" rel="noopener noreferrer" className="block aspect-square">
              <img
                src={thumbUrl(p.photo_url, { width: 300 })}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover rounded-md border border-border"
              />
            </a>
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Read-only field display ───────────────────────────────────────────────────
function ReadOnlyValue({ value }: { value: string | number | null | undefined }) {
  const text = value == null || value === '' ? '—' : String(value)
  return (
    <div className="flex items-center gap-1.5 min-h-9 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
      <Lock className="w-3 h-3 shrink-0 opacity-60" />
      <span className="truncate whitespace-pre-wrap">{text}</span>
    </div>
  )
}

// ─── Per-property editable card ────────────────────────────────────────────────
function PropertyCard({ property, focusSignal }: { property: OwnerProperty; focusSignal?: number }) {
  const { t } = useLocale('ownerPortal')
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(() => initialForm(property))
  const [open, setOpen] = useState(false)
  // True after a save skipped the calendar link because it is not a full link.
  const [icalInvalid, setIcalInvalid] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // "Edit details in your property card" in the Getting started guide: open this card and
  // bring it into view. The signal is a counter so pressing it twice still re-focuses.
  useEffect(() => {
    if (!focusSignal) return
    setOpen(true)
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focusSignal])

  const readOnly = usePortalReadOnly()
  const perms = property.permissions
  // In read-only preview every field renders through its existing "view only"
  // path, so the admin still sees exactly what the owner sees.
  const can = (key: keyof OwnerPermissions) => {
    const p = perms[key] ?? { visible: true, editable: true }
    return readOnly ? { ...p, editable: false } : p
  }

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initialForm(property)),
    [form, property],
  )
  // True when the owner can edit at least one field on this property.
  const anyEditable = useMemo(
    () => Object.keys(EDITABLE_COLUMNS).some(k => can(k as keyof OwnerPermissions).editable),
    [perms, readOnly],
  )

  const set = (key: keyof OwnerProperty, value: string | number | boolean | null) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const setNum = (key: 'king_beds' | 'queen_beds' | 'full_beds' | 'twin_beds' | 'square_footage' | 'bedrooms' | 'full_baths' | 'half_baths', raw: string) => {
    const trimmed = raw.trim()
    set(key, trimmed === '' ? null : Number(trimmed))
  }

  const save = useMutation({
    mutationFn: async () => {
      // Light validation
      for (const k of ['king_beds', 'queen_beds', 'full_beds', 'twin_beds', 'square_footage', 'bedrooms', 'full_baths', 'half_baths'] as const) {
        const v = form[k]
        if (typeof v === 'number' && (isNaN(v) || v < 0)) {
          throw new Error(t('properties.validationCountsPositive'))
        }
      }
      // Build a payload of only the columns this owner may edit. The DB guard
      // trigger enforces the same restriction server-side regardless.
      const payload: FormState = {}
      for (const [key, cols] of Object.entries(EDITABLE_COLUMNS)) {
        if (!can(key as keyof OwnerPermissions).editable) continue
        for (const c of cols) payload[c] = form[c] ?? null
      }
      // The database refuses any calendar link that is not http(s)/webcal. Check it here so
      // one bad optional field cannot make the server reject every other change: an invalid
      // link is left out of this save (it stays in the field, with an error), the rest saves.
      let skippedIcal = false
      if ('ical_url' in payload) {
        const ical = normalizeCalendarUrl(payload.ical_url as string | null)
        if (ical === 'invalid') {
          delete payload.ical_url
          skippedIcal = true
        } else {
          payload.ical_url = ical
        }
      }
      setIcalInvalid(skippedIcal)
      const ical = 'ical_url' in payload ? (payload.ical_url as string | null) : undefined
      if (Object.keys(payload).length === 0) return { skippedIcal, saved: false, ical }
      // Owners have no direct read/write on `properties` (it holds team notes and
      // financials). owner_update_property applies only owner-editable columns,
      // and the guard trigger re-checks per-field permissions.
      const { error } = await supabase.rpc('owner_update_property', {
        p_property_id: property.id,
        p_changes: payload as Json,
      })
      if (error) throw error
      return { skippedIcal, saved: true, ical }
    },
    onSuccess: res => {
      // webcal:// was rewritten to https:// on the way out; show what is actually stored.
      if (res?.saved && res.ical !== undefined) set('ical_url', res.ical)
      if (res?.skippedIcal) {
        toast({
          title: res.saved ? t('properties.savedExceptCalendar') : t('properties.icalNotSaved'),
          description: t('properties.icalInvalid'),
        })
      } else {
        toast({ title: t('properties.saved'), description: t('properties.savedDescription', { name: property.name }) })
      }
      // Owner edits shared property columns (address/beds/sqft/codes/wifi) — the
      // shared helper refreshes the owner's own list and, if a staff view is
      // open, every staff property cache too.
      invalidateAllPropertyQueries(queryClient)
    },
    onError: (e: unknown) => {
      // The RPC raises friendly messages (counts out of range, etc.); show them as written.
      // PostgrestError extends Error, but fall back to a plain { message } object too.
      const message = e instanceof Error ? e.message : (e as { message?: string } | null)?.message
      toast({ title: t('properties.saveFailedTitle'), description: message || t('properties.saveFailedDefault'), variant: 'destructive' })
    },
  })

  // Renders an editable input, a read-only value, or nothing, per permission.
  const renderField = (
    key: keyof OwnerPermissions,
    label: string,
    column: keyof OwnerProperty,
    input: (editable: boolean) => React.ReactNode,
    className?: string,
  ) => {
    const p = can(key)
    if (!p.visible) return null
    return (
      <Field label={label} locked={!p.editable} className={className}>
        {p.editable ? input(true) : <ReadOnlyValue value={property[column] as any} />}
      </Field>
    )
  }

  const detailKeys: (keyof OwnerPermissions)[] = [
    'address', 'bed_sizes', 'square_footage', 'door_code', 'other_codes', 'wifi_info',
    'bedrooms', 'baths', 'amenities', 'check_times', 'filter_size', 'ical_url',
  ]
  const showDetails = detailKeys.some(k => can(k).visible)

  return (
    <Card ref={cardRef} id={`property-${property.id}`} className="rounded-2xl shadow-sm overflow-hidden scroll-mt-20">
      <CardHeader className="flex flex-row items-center justify-between gap-2 py-4">
        <div className="flex items-center gap-2 min-w-0">
          <Home className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground truncate">{property.name}</h2>
            {can('address').visible && property.address && (
              <p className="text-xs text-muted-foreground truncate">{property.address}</p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
        >
          {open ? t('properties.hide') : t('properties.manage')}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </Button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-6 pb-6">
          {/* Property details */}
          {showDetails && (
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5 text-muted-foreground" /> {t('fields.sectionTitle')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {renderField('address', t('fields.address'), 'address', () => (
                <AddressAutocomplete value={(form.address as string) ?? ''} onChange={next => set('address', next || null)} />
              ), 'sm:col-span-2')}
              {(() => {
                const p = can('bed_sizes')
                if (!p.visible) return null
                return (
                  <>
                    <Field label={t('fields.kingBeds')} locked={!p.editable}>
                      {p.editable ? (
                        <Input type="number" min={0} value={(form.king_beds as number) ?? ''} onChange={e => setNum('king_beds', e.target.value)} />
                      ) : (
                        <ReadOnlyValue value={property.king_beds} />
                      )}
                    </Field>
                    <Field label={t('fields.queenBeds')} locked={!p.editable}>
                      {p.editable ? (
                        <Input type="number" min={0} value={(form.queen_beds as number) ?? ''} onChange={e => setNum('queen_beds', e.target.value)} />
                      ) : (
                        <ReadOnlyValue value={property.queen_beds} />
                      )}
                    </Field>
                    <Field label={t('fields.fullBeds')} locked={!p.editable}>
                      {p.editable ? (
                        <Input type="number" min={0} value={(form.full_beds as number) ?? ''} onChange={e => setNum('full_beds', e.target.value)} />
                      ) : (
                        <ReadOnlyValue value={property.full_beds} />
                      )}
                    </Field>
                    <Field label={t('fields.twinBeds')} locked={!p.editable}>
                      {p.editable ? (
                        <Input type="number" min={0} value={(form.twin_beds as number) ?? ''} onChange={e => setNum('twin_beds', e.target.value)} />
                      ) : (
                        <ReadOnlyValue value={property.twin_beds} />
                      )}
                    </Field>
                  </>
                )
              })()}
              {renderField('bedrooms', t('fields.bedrooms'), 'bedrooms', () => (
                <Input type="number" min={0} value={(form.bedrooms as number) ?? ''} onChange={e => setNum('bedrooms', e.target.value)} />
              ))}
              {(() => {
                const p = can('baths')
                if (!p.visible) return null
                return (
                  <>
                    <Field label={t('fields.fullBaths')} locked={!p.editable}>
                      {p.editable ? (
                        <Input type="number" min={0} value={(form.full_baths as number) ?? ''} onChange={e => setNum('full_baths', e.target.value)} />
                      ) : (
                        <ReadOnlyValue value={property.full_baths} />
                      )}
                    </Field>
                    <Field label={t('fields.halfBaths')} locked={!p.editable}>
                      {p.editable ? (
                        <Input type="number" min={0} value={(form.half_baths as number) ?? ''} onChange={e => setNum('half_baths', e.target.value)} />
                      ) : (
                        <ReadOnlyValue value={property.half_baths} />
                      )}
                    </Field>
                  </>
                )
              })()}
              {renderField('square_footage', t('fields.squareFootage'), 'square_footage', () => (
                <Input
                  type="number"
                  min={0}
                  value={(form.square_footage as number) ?? ''}
                  onChange={e => setNum('square_footage', e.target.value)}
                />
              ))}
              {renderField('door_code', t('fields.doorCode'), 'door_code', () => (
                <Input value={(form.door_code as string) ?? ''} onChange={e => set('door_code', e.target.value || null)} />
              ))}
              {renderField('other_codes', t('fields.otherCodes'), 'other_codes', () => (
                <Textarea
                  rows={2}
                  value={(form.other_codes as string) ?? ''}
                  onChange={e => set('other_codes', e.target.value || null)}
                  placeholder={t('fields.otherCodesPlaceholder')}
                />
              ), 'sm:col-span-2')}
              {renderField('wifi_info', t('fields.wifiInfo'), 'wifi_info', () => (
                <Textarea
                  rows={2}
                  value={(form.wifi_info as string) ?? ''}
                  onChange={e => set('wifi_info', e.target.value || null)}
                  placeholder={t('fields.wifiInfoPlaceholder')}
                />
              ), 'sm:col-span-2')}
              {(() => {
                const p = can('amenities')
                if (!p.visible) return null
                const boolSelect = (key: 'hot_tub' | 'pool') => (
                  <select
                    className="w-full border border-border rounded-md px-2 py-2 text-sm bg-background"
                    value={form[key] == null ? '' : String(form[key])}
                    onChange={e => set(key, e.target.value === '' ? null : e.target.value === 'true')}
                    data-testid={`select-${key.replace('_', '-')}-${property.id}`}
                  >
                    {/* Placeholder only: once a value exists, owners must pick Yes or No. */}
                    <option value="" disabled>{t('fields.notSet')}</option>
                    <option value="true">{t('common.actions.yes')}</option>
                    <option value="false">{t('common.actions.no')}</option>
                  </select>
                )
                const boolLabel = (v: boolean | null | undefined) => (v == null ? null : v ? t('common.actions.yes') : t('common.actions.no'))
                return (
                  <>
                    <Field label={t('fields.hotTub')} locked={!p.editable}>
                      {p.editable ? boolSelect('hot_tub') : <ReadOnlyValue value={boolLabel(property.hot_tub)} />}
                    </Field>
                    <Field label={t('fields.pool')} locked={!p.editable}>
                      {p.editable ? boolSelect('pool') : <ReadOnlyValue value={boolLabel(property.pool)} />}
                    </Field>
                  </>
                )
              })()}
              {(() => {
                const p = can('check_times')
                if (!p.visible) return null
                return (
                  <>
                    <Field label={t('fields.checkInTime')} locked={!p.editable}>
                      {p.editable ? (
                        <Input value={(form.check_in_time as string) ?? ''} onChange={e => set('check_in_time', e.target.value || null)} placeholder={t('fields.checkInPlaceholder')} />
                      ) : (
                        <ReadOnlyValue value={property.check_in_time} />
                      )}
                    </Field>
                    <Field label={t('fields.checkOutTime')} locked={!p.editable}>
                      {p.editable ? (
                        <Input value={(form.check_out_time as string) ?? ''} onChange={e => set('check_out_time', e.target.value || null)} placeholder={t('fields.checkOutPlaceholder')} />
                      ) : (
                        <ReadOnlyValue value={property.check_out_time} />
                      )}
                    </Field>
                  </>
                )
              })()}
              {renderField('filter_size', t('fields.filterSize'), 'filter_size', () => (
                <Input value={(form.filter_size as string) ?? ''} onChange={e => set('filter_size', e.target.value || null)} placeholder={t('fields.filterSizePlaceholder')} />
              ))}
              {renderField('ical_url', t('fields.icalUrl'), 'ical_url', () => (
                <>
                  <Input
                    type="url"
                    value={(form.ical_url as string) ?? ''}
                    onChange={e => {
                      set('ical_url', e.target.value || null)
                      setIcalInvalid(false)
                    }}
                    placeholder={t('fields.icalUrlPlaceholder')}
                    aria-invalid={icalInvalid || undefined}
                    aria-describedby={icalInvalid ? `ical-error-${property.id}` : undefined}
                    data-testid={`input-ical-url-${property.id}`}
                  />
                  {icalInvalid && (
                    <p id={`ical-error-${property.id}`} role="alert" className="text-xs text-destructive" data-testid={`text-ical-error-${property.id}`}>
                      {t('properties.icalInvalid')}
                    </p>
                  )}
                </>
              ), 'sm:col-span-2')}
            </div>
          </section>
          )}

          {showDetails && anyEditable && (
            <div className="flex justify-end">
              <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid={`button-save-${property.id}`}>
                {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('properties.saveChanges')}
              </Button>
            </div>
          )}

          {/* Photos */}
          {can('photos').visible && (
            <OwnerPhotosSection propertyId={property.id} canAdd={can('photos').editable} />
          )}

          {/* Owner notes */}
          <OwnerNotesSection propertyId={property.id} />

          {/* Scheduled tasks */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <CalendarClock className="w-3.5 h-3.5 text-muted-foreground" /> {t('tasks.title')}
            </h3>
            <TasksSection propertyId={property.id} />
          </section>
        </CardContent>
      )}
    </Card>
  )
}

// ─── Shipments ──────────────────────────────────────────────────────────────────
type OwnerShipment = {
  id: string
  property_name: string | null
  sender_name: string | null
  tracking_number: string | null
  estimated_delivery: string | null
  description: string | null
  delivery_responsible: string | null
  received_at: string | null
  submitted_at: string | null
}

function ShipmentsSection() {
  const { t } = useLocale('ownerPortal')
  const { format } = useDateFormat()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-shipments'],
    queryFn: async (): Promise<OwnerShipment[]> => {
      // Owner-scoped RPC: returns shipments only for the signed-in owner's properties.
      const { data, error } = await supabase.rpc('get_owner_shipments')
      if (error) throw error
      return (data ?? []) as OwnerShipment[]
    },
  })

  if (isLoading) return <Skeleton className="h-24 rounded-2xl" />
  if (isError) {
    return <ErrorState onRetry={() => refetch()} title={t('shipments.loadFailedTitle')} description={t('shipments.loadFailedDescription')} />
  }
  const shipments = data ?? []
  // Hide the section entirely when there's nothing to show (keeps the portal tidy).
  if (shipments.length === 0) return null

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="py-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Package className="w-4 h-4 text-muted-foreground" /> {t('shipments.title')}
        </h2>
      </CardHeader>
      <CardContent className="space-y-2 pb-4">
        {shipments.map(s => {
          const received = !!s.received_at
          return (
            <div key={s.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{s.description || s.sender_name || t('shipments.fallbackName')}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[s.property_name, s.sender_name ? t('shipments.fromPrefix', { name: s.sender_name }) : null, s.tracking_number].filter(Boolean).join(' · ')}
                </p>
                <p className="text-2xs text-muted-foreground">
                  {received
                    ? t('shipments.receivedOn', { date: formatDate(s.received_at, format) })
                    : s.estimated_delivery
                      ? t('shipments.estDelivery', { date: formatDate(s.estimated_delivery, format) })
                      : t('shipments.inTransit')}
                </p>
              </div>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium shrink-0 ${received ? 'bg-success/10 text-success' : 'bg-info/10 text-info'}`}>
                {received ? t('shipments.received') : t('shipments.inTransit')}
              </span>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ─── Referrals ──────────────────────────────────────────────────────────────────
type OwnerReferral = {
  id: string
  referred_name: string
  referred_email: string | null
  referred_phone: string | null
  note: string | null
  status: string
  reward_status: string
  reward_note: string | null
  created_at: string
}

const REFERRAL_STATUS_TONE: Record<string, string> = {
  submitted: 'bg-info/10 text-info',
  contacted: 'bg-warning/10 text-warning',
  converted: 'bg-success/10 text-success',
  declined: 'bg-muted text-muted-foreground',
}

function ReferralsSection({ ownerId }: { ownerId: string }) {
  const { t } = useLocale('ownerPortal')
  const { format } = useDateFormat()
  const readOnly = usePortalReadOnly()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ referred_name: '', referred_email: '', referred_phone: '', note: '' })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-referrals', ownerId],
    queryFn: async (): Promise<OwnerReferral[]> => {
      // RLS scopes rows to the signed-in owner — but a STAFF account viewing
      // the portal (owner view / admin emulation) passes the staff-wide policy
      // and would see EVERY owner's rows, so filter explicitly too.
      const { data, error } = await supabase
        .from('owner_referrals')
        .select('id, referred_name, referred_email, referred_phone, note, status, reward_status, reward_note, created_at')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as OwnerReferral[]
    },
  })

  const submit = useMutation({
    mutationFn: async () => {
      // owner_id must equal current_owner_id() per RLS; we send the owner's id
      // and the policy enforces it (a wrong id is rejected, not trusted).
      const { error } = await supabase.from('owner_referrals').insert({
        owner_id: ownerId,
        referred_name: form.referred_name.trim(),
        referred_email: form.referred_email.trim() || null,
        referred_phone: form.referred_phone.trim() || null,
        note: form.note.trim() || null,
      } as any)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: t('referrals.submittedToastTitle'), description: t('referrals.submittedToastDescription') })
      setForm({ referred_name: '', referred_email: '', referred_phone: '', note: '' })
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: ['owner-referrals'] })
    },
    onError: (e: any) => toast({ title: t('referrals.submitFailedTitle'), description: e?.message ?? t('referrals.submitFailedDefault'), variant: 'destructive' }),
  })

  const referrals = data ?? []

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 py-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Gift className="w-4 h-4 text-muted-foreground" /> {t('referrals.title')}
        </h2>
        {!readOnly && (
          <Button size="sm" variant={open ? 'ghost' : 'default'} onClick={() => setOpen(o => !o)} data-testid="button-toggle-referral-form">
            {open ? t('common.actions.cancel') : t('referrals.referSomeone')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4 pb-5">
        <p className="text-sm text-muted-foreground">{t('referrals.description')}</p>

        {open && (
          <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <Field label={t('referrals.theirName')}>
              <Input value={form.referred_name} onChange={e => setForm(f => ({ ...f, referred_name: e.target.value }))} data-testid="input-referral-name" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t('referrals.email')}>
                <Input type="email" value={form.referred_email} onChange={e => setForm(f => ({ ...f, referred_email: e.target.value }))} data-testid="input-referral-email" />
              </Field>
              <Field label={t('referrals.phone')}>
                <Input value={form.referred_phone} onChange={e => setForm(f => ({ ...f, referred_phone: e.target.value }))} data-testid="input-referral-phone" />
              </Field>
            </div>
            <Field label={t('referrals.note')}>
              <Textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} rows={2} data-testid="input-referral-note" />
            </Field>
            <div className="flex justify-end">
              <Button size="sm" disabled={!form.referred_name.trim() || submit.isPending} onClick={() => submit.mutate()} data-testid="button-submit-referral">
                {submit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('referrals.submit')}
              </Button>
            </div>
          </div>
        )}

        {isLoading && <Skeleton className="h-16 rounded-lg" />}
        {isError && <ErrorState onRetry={() => refetch()} title={t('referrals.loadFailedTitle')} description={t('referrals.loadFailedDescription')} />}
        {!isLoading && !isError && referrals.length === 0 && !open && (
          <p className="text-sm text-muted-foreground">{t('referrals.empty')}</p>
        )}
        {referrals.map(r => (
          <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{r.referred_name}</p>
              <p className="text-xs text-muted-foreground truncate">{[r.referred_email, r.referred_phone].filter(Boolean).join(' · ') || '—'}</p>
              <p className="text-2xs text-muted-foreground">
                {t('referrals.referredOn', { date: formatDate(r.created_at, format) })}
                {r.reward_status !== 'pending' ? t('referrals.rewardSuffix', { status: t(`referrals.reward.${r.reward_status}`, undefined, r.reward_status) }) : ''}
              </p>
            </div>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium shrink-0 ${REFERRAL_STATUS_TONE[r.status] ?? 'bg-muted text-muted-foreground'}`}>
              {t(`referrals.status.${r.status}`, undefined, r.status)}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ─── Testimonials ─────────────────────────────────────────────────────────────
type OwnerTestimonial = {
  id: string
  rating: number | null
  body: string
  display_preference: string
  allow_photo: boolean
  status: string
  created_at: string
}

const TESTIMONIAL_STATUS_TONE: Record<string, string> = {
  submitted: 'bg-info/10 text-info',
  approved: 'bg-warning/10 text-warning',
  published: 'bg-success/10 text-success',
  declined: 'bg-muted text-muted-foreground',
}

function TestimonialsSection({ ownerId }: { ownerId: string }) {
  const { t } = useLocale('ownerPortal')
  const { format } = useDateFormat()
  const readOnly = usePortalReadOnly()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ rating: '5', body: '', display_preference: 'full_name', allow_photo: false })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-testimonials', ownerId],
    queryFn: async (): Promise<OwnerTestimonial[]> => {
      // Explicit owner filter: staff accounts pass the staff-wide RLS policy
      // and would otherwise see every owner's rows in portal view.
      const { data, error } = await supabase
        .from('owner_testimonials')
        .select('id, rating, body, display_preference, allow_photo, status, created_at')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as OwnerTestimonial[]
    },
  })

  const submit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('owner_testimonials').insert({
        owner_id: ownerId,
        rating: form.rating ? Number(form.rating) : null,
        body: form.body.trim(),
        display_preference: form.display_preference,
        allow_photo: form.allow_photo,
      } as any)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: t('testimonials.thankYouToastTitle'), description: t('testimonials.thankYouToastDescription') })
      setForm({ rating: '5', body: '', display_preference: 'full_name', allow_photo: false })
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: ['owner-testimonials'] })
    },
    onError: (e: any) => toast({ title: t('testimonials.submitFailedTitle'), description: e?.message ?? t('testimonials.submitFailedDefault'), variant: 'destructive' }),
  })

  const items = data ?? []

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 py-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Quote className="w-4 h-4 text-muted-foreground" /> {t('testimonials.title')}
        </h2>
        {!readOnly && (
          <Button size="sm" variant={open ? 'ghost' : 'default'} onClick={() => setOpen(o => !o)} data-testid="button-toggle-testimonial-form">
            {open ? t('common.actions.cancel') : t('testimonials.writeButton')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4 pb-5">
        <p className="text-sm text-muted-foreground">{t('testimonials.description')}</p>

        {open && (
          <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t('testimonials.rating')}>
                <select
                  className="w-full border border-border rounded-md px-2 py-2 text-sm bg-background"
                  value={form.rating}
                  onChange={e => setForm(f => ({ ...f, rating: e.target.value }))}
                  data-testid="select-testimonial-rating"
                >
                  {[5, 4, 3, 2, 1].map(n => <option key={n} value={String(n)}>{'★'.repeat(n)} ({n})</option>)}
                </select>
              </Field>
              <Field label={t('testimonials.showNameAs')}>
                <select
                  className="w-full border border-border rounded-md px-2 py-2 text-sm bg-background"
                  value={form.display_preference}
                  onChange={e => setForm(f => ({ ...f, display_preference: e.target.value }))}
                  data-testid="select-testimonial-display"
                >
                  <option value="full_name">{t('testimonials.fullName')}</option>
                  <option value="first_name">{t('testimonials.firstNameOnly')}</option>
                  <option value="anonymous">{t('testimonials.anonymous')}</option>
                </select>
              </Field>
            </div>
            <Field label={t('testimonials.yourTestimonial')}>
              <Textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={4} data-testid="input-testimonial-body" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={form.allow_photo} onChange={e => setForm(f => ({ ...f, allow_photo: e.target.checked }))} data-testid="checkbox-testimonial-photo" />
              {t('testimonials.allowPhotoLabel')}
            </label>
            <div className="flex justify-end">
              <Button size="sm" disabled={!form.body.trim() || submit.isPending} onClick={() => submit.mutate()} data-testid="button-submit-testimonial">
                {submit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('testimonials.submit')}
              </Button>
            </div>
          </div>
        )}

        {isLoading && <Skeleton className="h-16 rounded-lg" />}
        {isError && <ErrorState onRetry={() => refetch()} title={t('testimonials.loadFailedTitle')} description={t('testimonials.loadFailedDescription')} />}
        {!isLoading && !isError && items.length === 0 && !open && (
          <p className="text-sm text-muted-foreground">{t('testimonials.empty')}</p>
        )}
        {items.map(item => (
          <div key={item.id} className="rounded-lg border border-border/60 p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-amber-500">{item.rating ? '★'.repeat(item.rating) : ''}</span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium shrink-0 ${TESTIMONIAL_STATUS_TONE[item.status] ?? 'bg-muted text-muted-foreground'}`}>
                {t(`testimonials.status.${item.status}`, undefined, item.status)}
              </span>
            </div>
            <p className="text-sm text-foreground/90">{item.body}</p>
            <p className="text-2xs text-muted-foreground">{t('testimonials.submittedOn', { date: formatDate(item.created_at, format) })}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ─── Feedback ─────────────────────────────────────────────────────────────────
type OwnerFeedback = {
  id: string
  category: string
  body: string
  status: string
  created_at: string
}

const FEEDBACK_STATUS_TONE: Record<string, string> = {
  open: 'bg-info/10 text-info',
  reviewing: 'bg-warning/10 text-warning',
  planned: 'bg-info/10 text-info',
  done: 'bg-success/10 text-success',
  declined: 'bg-muted text-muted-foreground',
}

function FeedbackSection({ ownerId }: { ownerId: string }) {
  const { t } = useLocale('ownerPortal')
  const { format } = useDateFormat()
  const readOnly = usePortalReadOnly()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ category: 'suggestion', body: '' })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-feedback', ownerId],
    queryFn: async (): Promise<OwnerFeedback[]> => {
      // Explicit owner filter: staff accounts pass the staff-wide RLS policy
      // and would otherwise see every owner's rows in portal view (this is
      // how Robin's feedback showed up in the admin's own portal view).
      const { data, error } = await supabase
        .from('owner_feedback')
        .select('id, category, body, status, created_at')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as OwnerFeedback[]
    },
  })

  const submit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('owner_feedback').insert({
        owner_id: ownerId,
        category: form.category,
        body: form.body.trim(),
      } as any)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: t('feedback.sentToastTitle'), description: t('feedback.sentToastDescription') })
      setForm({ category: 'suggestion', body: '' })
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: ['owner-feedback'] })
    },
    onError: (e: any) => toast({ title: t('feedback.sendFailedTitle'), description: e?.message ?? t('feedback.sendFailedDefault'), variant: 'destructive' }),
  })

  const items = data ?? []

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 py-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" /> {t('feedback.title')}
        </h2>
        {!readOnly && (
          <Button size="sm" variant={open ? 'ghost' : 'default'} onClick={() => setOpen(o => !o)} data-testid="button-toggle-feedback-form">
            {open ? t('common.actions.cancel') : t('feedback.sendButton')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4 pb-5">
        <p className="text-sm text-muted-foreground">{t('feedback.description')}</p>

        {open && (
          <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <Field label={t('feedback.type')}>
              <select
                className="w-full border border-border rounded-md px-2 py-2 text-sm bg-background"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                data-testid="select-feedback-category"
              >
                <option value="suggestion">{t('feedback.category.suggestion')}</option>
                <option value="issue">{t('feedback.category.issue')}</option>
                <option value="praise">{t('feedback.category.praise')}</option>
                <option value="other">{t('feedback.category.other')}</option>
              </select>
            </Field>
            <Field label={t('feedback.yourMessage')}>
              <Textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={3} data-testid="input-feedback-body" />
            </Field>
            <div className="flex justify-end">
              <Button size="sm" disabled={!form.body.trim() || submit.isPending} onClick={() => submit.mutate()} data-testid="button-submit-feedback">
                {submit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('feedback.send')}
              </Button>
            </div>
          </div>
        )}

        {isLoading && <Skeleton className="h-16 rounded-lg" />}
        {isError && <ErrorState onRetry={() => refetch()} title={t('feedback.loadFailedTitle')} description={t('feedback.loadFailedDescription')} />}
        {!isLoading && !isError && items.length === 0 && !open && (
          <p className="text-sm text-muted-foreground">{t('feedback.empty')}</p>
        )}
        {items.map(item => (
          <div key={item.id} className="rounded-lg border border-border/60 p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xs uppercase tracking-wide text-muted-foreground">{t(`feedback.category.${item.category}`, undefined, item.category)}</span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium shrink-0 ${FEEDBACK_STATUS_TONE[item.status] ?? 'bg-muted text-muted-foreground'}`}>
                {t(`feedback.status.${item.status}`, undefined, item.status)}
              </span>
            </div>
            <p className="text-sm text-foreground/90">{item.body}</p>
            <p className="text-2xs text-muted-foreground">{t('feedback.sentOn', { date: formatDate(item.created_at, format) })}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ─── Quotes ───────────────────────────────────────────────────────────────────
type OwnerQuote = {
  id: number
  name: string
  ce_charged: number | null
  deep_clean_3x_ce: number | null
  linen_program: boolean | null
  linen_program_cost: number | null
  bedrooms: number | null
  number_of_beds: number | null
  full_baths: number | null
  half_baths: number | null
  quote_sent_at: string | null
  quote_owner_response: string | null
  quote_responded_at: string | null
}

function formatMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function QuotesSection() {
  const { t } = useLocale('ownerPortal')
  const { format } = useDateFormat()
  const readOnly = usePortalReadOnly()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-quotes'],
    queryFn: async (): Promise<OwnerQuote[]> => {
      const { data, error } = await supabase.rpc('get_owner_quotes')
      if (error) throw error
      return (data ?? []) as OwnerQuote[]
    },
  })

  const respond = useMutation({
    mutationFn: async ({ id, response }: { id: number; response: 'approved' | 'declined' }) => {
      const { error } = await supabase.rpc('owner_respond_to_quote', { p_property_id: id, p_response: response })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      toast({
        title: v.response === 'approved' ? t('quotes.approvedToastTitle') : t('quotes.declinedToastTitle'),
        description: v.response === 'approved' ? t('quotes.approvedToastDescription') : t('quotes.declinedToastDescription'),
      })
      queryClient.invalidateQueries({ queryKey: ['owner-quotes'] })
    },
    onError: (e: any) => toast({ title: t('quotes.respondFailedTitle'), description: e?.message ?? t('quotes.respondFailedDefault'), variant: 'destructive' }),
  })

  if (isLoading) return <Skeleton className="h-28 rounded-2xl" />
  if (isError) return <ErrorState onRetry={() => refetch()} title={t('quotes.loadFailedTitle')} description={t('quotes.loadFailedDescription')} />
  const quotes = data ?? []
  if (quotes.length === 0) return null

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden border-primary/30">
      <CardHeader className="py-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" /> {quotes.length > 1 ? t('quotes.titlePlural') : t('quotes.titleSingular')}
        </h2>
      </CardHeader>
      <CardContent className="space-y-3 pb-5">
        {quotes.map(q => {
          const pending = !q.quote_owner_response || q.quote_owner_response === 'pending'
          const approved = q.quote_owner_response === 'approved'
          return (
            <div key={q.id} className="rounded-lg border border-border/60 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{q.name}</p>
                {!pending && (
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium shrink-0 ${approved ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                    {approved ? t('quotes.approved') : t('quotes.declined')}
                  </span>
                )}
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{t('quotes.cleaningFee')}</span>
                  <span className="font-medium text-foreground">{formatMoney(q.ce_charged)}</span>
                </div>
                {q.deep_clean_3x_ce ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t('quotes.onboardingDeepClean')}</span>
                    <span className="font-medium text-foreground">{formatMoney(q.deep_clean_3x_ce)}</span>
                  </div>
                ) : null}
                {q.linen_program && q.linen_program_cost ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t('quotes.linenProgram')}</span>
                    <span className="font-medium text-foreground">{formatMoney(q.linen_program_cost)}</span>
                  </div>
                ) : null}
              </div>
              {pending ? (
                <div className="flex gap-2 justify-end pt-1">
                  <Button size="sm" variant="outline" disabled={respond.isPending || readOnly} onClick={() => respond.mutate({ id: q.id, response: 'declined' })} data-testid={`button-decline-quote-${q.id}`}>
                    {t('quotes.decline')}
                  </Button>
                  <Button size="sm" disabled={respond.isPending || readOnly} onClick={() => respond.mutate({ id: q.id, response: 'approved' })} data-testid={`button-approve-quote-${q.id}`}>
                    {respond.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('quotes.approve')}
                  </Button>
                </div>
              ) : (
                <p className="text-2xs text-muted-foreground">{t('quotes.respondedOn', { date: formatDate(q.quote_responded_at, format) })}</p>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ─── Owner-wide contact & payment card ────────────────────────────────────────
function ContactPaymentCard() {
  const { t } = useLocale('ownerPortal')
  const { toast } = useToast()
  const readOnly = usePortalReadOnly()
  const queryClient = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-self'],
    queryFn: async () => {
      // current_owner_id() resolves the signed-in owner in the DB; RLS also
      // restricts property_owners rows to the owner themselves.
      const { data: oid } = await supabase.rpc('current_owner_id')
      const { data, error } = await supabase
        .from('property_owners')
        .select('name, phone, email, preferred_payment_method')
        .eq('id', (oid as any) ?? '')
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const [form, setForm] = useState({ name: '', phone: '', email: '', preferred_payment_method: '' })
  const [initialForm, setInitialForm] = useState({ name: '', phone: '', email: '', preferred_payment_method: '' })
  useEffect(() => {
    if (data) {
      const loaded = {
        name: data.name ?? '', phone: data.phone ?? '',
        email: data.email ?? '', preferred_payment_method: data.preferred_payment_method ?? '',
      }
      setForm(loaded)
      setInitialForm(loaded)
    }
  }, [data])

  const initialEmail = initialForm.email
  const dirty =
    form.name !== initialForm.name ||
    form.phone !== initialForm.phone ||
    form.email !== initialForm.email ||
    form.preferred_payment_method !== initialForm.preferred_payment_method

  const save = useMutation({
    mutationFn: async () => {
      const email = form.email.trim().toLowerCase()
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(t('contact.invalidEmail'))
      const emailChanged = email !== initialEmail.toLowerCase()
      if (emailChanged) {
        const r = await changeOwnerEmail(email)
        if (!r.ok) throw new Error(r.error || t('contact.emailChangeFailedDefault'))
      }
      const { error } = await supabase.rpc('owner_update_self_contact', {
        p_name: form.name.trim() || null,
        p_phone: form.phone.trim() || null,
        p_payment_method: form.preferred_payment_method.trim() || null,
      } as any)
      if (error) throw error
      if (emailChanged) await supabase.auth.refreshSession()
    },
    onSuccess: () => {
      toast({ title: t('contact.saved'), description: t('contact.savedDescription') })
      queryClient.invalidateQueries({ queryKey: ['owner-self'] })
    },
    onError: (e: unknown) =>
      toast({ title: t('contact.saveFailedTitle'), description: e instanceof Error ? e.message : t('contact.saveFailedDefault'), variant: 'destructive' }),
  })

  if (isLoading) return <Skeleton className="h-40 rounded-2xl" />
  if (isError) return <ErrorState onRetry={() => refetch()} title={t('contact.loadFailedTitle')} description={t('contact.loadFailedDescription')} />

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="py-4">
        <h2 className="text-base font-semibold text-foreground">{t('contact.title')}</h2>
      </CardHeader>
      <CardContent className="space-y-4 pb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('contact.contactName')}>
            <Input value={form.name} disabled={readOnly} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-owner-name" />
          </Field>
          <Field label={t('contact.contactPhone')}>
            <Input value={form.phone} disabled={readOnly} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} data-testid="input-owner-phone" />
          </Field>
          <Field label={t('contact.loginEmail')}>
            <Input type="email" value={form.email} disabled={readOnly} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} data-testid="input-owner-email" />
          </Field>
          <Field label={t('contact.preferredPaymentMethod')}>
            <select
              className="w-full border border-border rounded-md px-2 py-2 text-sm bg-background disabled:opacity-60"
              value={form.preferred_payment_method}
              disabled={readOnly}
              onChange={e => setForm(f => ({ ...f, preferred_payment_method: e.target.value }))}
              data-testid="select-owner-payment"
            >
              <option value="">{t('contact.selectMethod')}</option>
              <option value="QuickBooks">{t('contact.methodQuickBooks')}</option>
              <option value="Bill.com">{t('contact.methodBillCom')}</option>
            </select>
          </Field>
        </div>
        <p className="text-2xs text-muted-foreground">
          {t('contact.emailChangeNote')}
        </p>
        {!readOnly && (
          <div className="flex justify-end">
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid="button-save-owner-contact">
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('contact.saveChanges')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Account security ─────────────────────────────────────────────────────────
function AccountSecurityCard() {
  const { t } = useLocale('ownerPortal')
  const { toast } = useToast()
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      toast({ title: t('security.tooShortTitle'), description: t('security.tooShortDescription'), variant: 'destructive' })
      return
    }
    if (password !== confirm) {
      toast({ title: t('security.mismatchTitle'), description: t('security.mismatchDescription'), variant: 'destructive' })
      return
    }
    setSubmitting(true)
    const { error } = await updatePassword(password)
    setSubmitting(false)
    if (error) {
      toast({ title: t('security.updateFailedTitle'), description: error, variant: 'destructive' })
      return
    }
    setPassword(''); setConfirm('')
    toast({ title: t('security.updatedTitle'), description: t('security.updatedDescription') })
  }

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="py-4">
        <h2 className="text-base font-semibold text-foreground">{t('security.title')}</h2>
      </CardHeader>
      <CardContent className="pb-6">
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('security.newPassword')}>
              <Input type="password" autoComplete="new-password" value={password}
                onChange={e => setPassword(e.target.value)} placeholder={t('security.newPasswordPlaceholder')}
                data-testid="input-owner-new-password" />
            </Field>
            <Field label={t('security.confirmPassword')}>
              <Input type="password" autoComplete="new-password" value={confirm}
                onChange={e => setConfirm(e.target.value)} placeholder={t('security.confirmPasswordPlaceholder')}
                data-testid="input-owner-confirm-password" />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={submitting} data-testid="button-owner-update-password">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('security.updateButton')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ─── Portal shell ───────────────────────────────────────────────────────────────
export default function OwnerPortalPage() {
  const { t } = useLocale('ownerPortal')
  usePageTitle(t('header.pageTitle'))
  const { user, logout, canActAsOwner, setActingAsOwner, emulatedOwner, stopOwnerEmulation } = useAuth()
  // Admin previewing a specific owner: the whole portal is read-only.
  const readOnly = !!emulatedOwner
  // For a pure owner, user.id is the property_owners id; for a staff user acting
  // as owner it's on ownerIdentity; for an emulating admin it's the emulated
  // owner. Used as owner_id on owner-scoped inserts (all disabled in preview).
  const ownerId = emulatedOwner?.id ?? user?.ownerIdentity?.id ?? user?.id ?? ''
  const firstName = (emulatedOwner?.name ?? user?.label ?? '').trim().split(/\s+/)[0] ?? ''

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-properties'],
    queryFn: async (): Promise<OwnerProperty[]> => {
      // The RPC scopes to the signed-in owner's assigned properties and omits
      // any field they don't have visibility permission for.
      const { data, error } = await supabase.rpc('get_owner_properties')
      if (error) throw error
      return ((data ?? []) as any[]).map(row => ({
        ...row,
        permissions: normalizeOwnerPermissions(row?.permissions),
      })) as OwnerProperty[]
    },
  })

  // Guided onboarding. `guideExpanded` is the open stepper (not the folded "all set" line).
  const { guide, ready: guideReady } = useOnboardingGuide(data)
  const guideActive = !!guide?.show
  const guideExpanded = guideActive && !guide!.allDone
  const hasOnboardingProperty = (data ?? []).some(p => p.stage === 'Onboarding')
  // Which property card the guide asked us to open (nonce lets the same one be re-focused).
  const [focusProperty, setFocusProperty] = useState<{ id: number; nonce: number } | null>(null)

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      <header className="border-b border-border/60 bg-gradient-to-r from-primary/10 via-background to-background sticky top-0 z-10 backdrop-blur">
        <div className="w-full max-w-3xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-7 py-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <img
              src="/brand/tendwell-logo-black.png"
              alt="Tendwell"
              className="h-7 sm:h-8 w-auto max-w-[180px] object-contain object-left block dark:hidden"
            />
            <img
              src="/brand/tendwell-logo-white.png"
              alt="Tendwell"
              className="h-7 sm:h-8 w-auto max-w-[180px] object-contain object-left hidden dark:block"
            />
            <span className="text-2xs text-muted-foreground uppercase tracking-[0.2em]">{t('header.eyebrow')}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {firstName && (
              <span className="hidden sm:inline text-sm text-muted-foreground mr-1 truncate max-w-[160px]">
                {t('header.welcomeBack', { name: firstName })}
              </span>
            )}
            <LanguageToggle />
            {readOnly ? (
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => stopOwnerEmulation()} data-testid="button-exit-owner-emulation">
                <ArrowLeft className="w-4 h-4" /> {t('emulation.exit')}
              </Button>
            ) : canActAsOwner ? (
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setActingAsOwner(false)} data-testid="button-switch-staff-view">
                <ArrowLeft className="w-4 h-4" /> {t('header.staffView')}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={logout} data-testid="button-logout">
              <LogOut className="w-4 h-4" /> {t('header.signOut')}
            </Button>
          </div>
        </div>
      </header>

      {emulatedOwner && (
        <div className="bg-warning/15 border-b border-warning/30" data-testid="banner-owner-emulation">
          <div className="w-full max-w-3xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-7 py-2">
            <p className="text-sm text-foreground flex items-center gap-2 min-w-0">
              <Eye className="w-4 h-4 shrink-0 text-warning" />
              <span className="truncate">
                <span className="font-medium">{t('emulation.banner', { name: emulatedOwner.name })}</span>
                <span className="text-muted-foreground"> · {t('emulation.readOnlyNote')}</span>
              </span>
            </p>
            <Button size="sm" variant="outline" className="shrink-0 h-7 text-xs" onClick={() => stopOwnerEmulation()} data-testid="button-exit-owner-emulation-banner">
              {t('emulation.exit')}
            </Button>
          </div>
        </div>
      )}

      <main className="flex-1 w-full max-w-3xl mx-auto p-4 sm:p-7 space-y-5">
       <PortalReadOnlyContext.Provider value={readOnly}>
        {/* Getting started: a stepper while the owner has a property in onboarding or an
            unsigned agreement. While it is open it covers the agreement and the Trellis link
            (steps 1 and 3), so those cards are not rendered a second time below. */}
        {ownerId && !guideReady && <Skeleton className="h-28 rounded-2xl" />}
        {ownerId && guideActive && (
          <OnboardingGuide
            guide={guide!}
            onEditProperty={id => setFocusProperty(prev => ({ id, nonce: (prev?.nonce ?? 0) + 1 }))}
          />
        )}
        {ownerId && <QuotesSection />}
        {ownerId && <ContactPaymentCard />}
        {ownerId && guideReady && !guideExpanded && <TrellisPortalCard showPlaceholder={hasOnboardingProperty} />}
        {ownerId && guideReady && !guideExpanded && <AgreementSection />}
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t('properties.heading')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('properties.subtitle')}
          </p>
        </div>

        {isLoading && (
          <div className="space-y-4">
            {[1, 2].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}
          </div>
        )}

        {isError && <ErrorState onRetry={() => refetch()} title={t('properties.loadFailedTitle')} description={t('properties.loadFailedDescription')} />}

        {!isLoading && !isError && (data?.length ?? 0) === 0 && (
          <EmptyState
            icon={Home}
            title={t('properties.emptyTitle')}
            description={t('properties.emptyDescription')}
          />
        )}

        {!isLoading && !isError && (data?.length ?? 0) > 0 && (
          <div className="space-y-4">
            {data!.map(p => (
              <PropertyCard key={p.id} property={p} focusSignal={focusProperty?.id === p.id ? focusProperty.nonce : undefined} />
            ))}
          </div>
        )}

        {/* DRAFT, not live for real owners: shown to staff in Owner view, and disabled in an
            admin's read-only preview. owner_request_quote() refuses real owners until
            app_settings.owner_quote_request_enabled = 1. TO GO LIVE: set that setting AND
            replace this condition with `ownerId`. See supabase/migrations/20261007_owner_onboarding_guided.sql. */}
        {ownerId && (canActAsOwner || emulatedOwner) && <RequestQuoteCard previewOnly={readOnly} />}

        <ShipmentsSection />
        {ownerId && <ReferralsSection ownerId={ownerId} />}
        {ownerId && <TestimonialsSection ownerId={ownerId} />}
        {ownerId && <FeedbackSection ownerId={ownerId} />}
        {/* Hidden in preview: updatePassword changes the ADMIN's own login,
            not the owner's — showing it while emulating invites a mistake. */}
        {!readOnly && <AccountSecurityCard />}
       </PortalReadOnlyContext.Provider>
      </main>
    </div>
  )
}
