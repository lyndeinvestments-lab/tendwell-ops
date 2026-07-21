import { useState, useRef, useEffect, useMemo } from 'react'
import { MapPickerDialog } from '@/components/MapPickerDialog'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { resizeImageFile } from '@/lib/resize-image'
import { useToast } from '@/hooks/use-toast'
import { useCleaners } from '@/hooks/use-cleaners'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Star, Camera, X, Calendar, ClipboardCheck, Building2, Search, Wifi, KeyRound, Wind, CheckCircle2, Trash2, MapPin, Link2, Check } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import type { TFunc } from '@/lib/i18n/t'

type Mode = 'log' | 'schedule'
type Status = 'scheduled' | 'completed' | 'skipped'
type Urgency = 'none' | 'low' | 'medium' | 'high' | 'critical'

// Classes only — labels are resolved via `t('reinspect.'+value)` at render time.
const URGENCY_OPTIONS: { value: Urgency; ring: string; bg: string }[] = [
  { value: 'none',     ring: 'border-border',                bg: 'bg-muted text-muted-foreground' },
  { value: 'low',      ring: 'border-emerald-500',           bg: 'bg-emerald-500 text-primary-foreground' },
  { value: 'medium',   ring: 'border-amber-500',             bg: 'bg-amber-500 text-primary-foreground' },
  { value: 'high',     ring: 'border-orange-500',            bg: 'bg-orange-500 text-primary-foreground' },
  { value: 'critical', ring: 'border-red-600',               bg: 'bg-red-600 text-destructive-foreground' },
]

// Keys only — labels are resolved via `t('scores.'+labelKey)` at render time.
const SCORE_AREAS = [
  { key: 'overall_score',     labelKey: 'overall' },
  { key: 'cleanliness_score', labelKey: 'cleanliness' },
  { key: 'linens_score',      labelKey: 'linens' },
  { key: 'supplies_score',    labelKey: 'supplies' },
  { key: 'exterior_score',    labelKey: 'exterior' },
] as const

type ScoreKey = typeof SCORE_AREAS[number]['key']

export interface ExistingInspection {
  id: string
  property_id: number | null
  cleaner_id: string | null
  inspector_id: string | null
  status: Status
  scheduled_for: string | null
  inspected_at: string | null
  last_cleaned_on: string | null
  notes: string | null
  photos_url: string[] | null
  reinspect_urgency: Urgency
  reinspect_by: string | null
  overall_score: number | null
  cleanliness_score: number | null
  linens_score: number | null
  supplies_score: number | null
  exterior_score: number | null
  share_token?: string | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  existing?: ExistingInspection | null
  onDelete?: (inspection: ExistingInspection) => void
  /** Pre-select this inspector on new inspections (e.g. the logged-in inspector). */
  defaultInspectorId?: string | null
}

export function InspectionFormSheet({ open, onOpenChange, existing, onDelete, defaultInspectorId }: Props) {
  const { t } = useLocale('inspections')
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const today = format(new Date(), 'yyyy-MM-dd')

  // For new rows: user picks Log vs Schedule. For existing rows: editing a
  // scheduled inspection — the user can save edits or "Mark Complete" to
  // promote to log mode.
  const isEditing = !!existing
  const [mode, setMode] = useState<Mode>('log')
  const [propertyId, setPropertyId] = useState<number | null>(null)
  const [propertySearch, setPropertySearch] = useState('')
  const [showPropertyList, setShowPropertyList] = useState(false)
  const [cleanerId, setCleanerId] = useState<string | null>(null)
  const [inspectorId, setInspectorId] = useState<string | null>(null)
  const [date, setDate] = useState(today)
  const [lastCleanedOn, setLastCleanedOn] = useState('')
  const [scores, setScores] = useState<Record<ScoreKey, number | null>>({
    overall_score: null,
    cleanliness_score: null,
    linens_score: null,
    supplies_score: null,
    exterior_score: null,
  })
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([])
  const [existingPhotoUrls, setExistingPhotoUrls] = useState<string[]>([])
  const [urgency, setUrgency] = useState<Urgency>('none')
  const [reinspectBy, setReinspectBy] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [copiedShare, setCopiedShare] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Initialize / reset on open or when `existing` changes
  useEffect(() => {
    if (!open) {
      photos.forEach(p => URL.revokeObjectURL(p.preview))
      setPhotos([])
      setExistingPhotoUrls([])
      setSubmitting(false)
      return
    }
    // Re-initializing for a (possibly different) inspection — revoke any
    // in-progress new-photo previews so their object URLs don't leak when the
    // sheet is reused for another row without closing first.
    photos.forEach(p => URL.revokeObjectURL(p.preview))
    setPhotos([])
    if (existing) {
      setMode(existing.status === 'scheduled' ? 'schedule' : 'log')
      setPropertyId(existing.property_id)
      setCleanerId(existing.cleaner_id)
      setInspectorId(existing.inspector_id)
      setDate(existing.status === 'scheduled' && existing.scheduled_for
        ? existing.scheduled_for
        : (existing.inspected_at ?? today))
      setLastCleanedOn(existing.last_cleaned_on ?? '')
      setScores({
        overall_score: existing.overall_score,
        cleanliness_score: existing.cleanliness_score,
        linens_score: existing.linens_score,
        supplies_score: existing.supplies_score,
        exterior_score: existing.exterior_score,
      })
      setNotes(existing.notes ?? '')
      setExistingPhotoUrls(existing.photos_url ?? [])
      setUrgency(existing.reinspect_urgency ?? 'none')
      setReinspectBy(existing.reinspect_by ?? '')
    } else {
      setMode('log')
      setPropertyId(null)
      setPropertySearch('')
      setShowPropertyList(false)
      setCleanerId(null)
      setInspectorId(defaultInspectorId ?? null)
      setDate(today)
      setLastCleanedOn('')
      setScores({ overall_score: null, cleanliness_score: null, linens_score: null, supplies_score: null, exterior_score: null })
      setNotes('')
      setExistingPhotoUrls([])
      setUrgency('none')
      setReinspectBy('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing])

  useEffect(() => {
    return () => photos.forEach(p => URL.revokeObjectURL(p.preview))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: properties = [] } = useQuery({
    queryKey: ['/supabase/inspection-form-properties', 'operational'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, address, filter_size, last_filter_changed, next_filter_due, auto_code, door_code, other_codes, wifi_info, pipeline_stages!inner(name)')
        .in('pipeline_stages.name', ['Onboarding', 'Active', 'Offboarding'])
        .order('name')
      if (error) throw error
      return (data ?? []) as PropertyRow[]
    },
    enabled: open,
    staleTime: 60_000,
  })

  const { data: cleaners = [] } = useCleaners({ enabled: open })

  const filteredProperties = useMemo(() => {
    const q = propertySearch.trim().toLowerCase()
    if (!q) return properties.slice(0, 50)
    return properties
      .filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.address ?? '').toLowerCase().includes(q),
      )
      .slice(0, 50)
  }, [properties, propertySearch])

  const selectedProperty = useMemo(
    () => properties.find(p => p.id === propertyId) ?? null,
    [properties, propertyId],
  )

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    const next = files.map(file => ({ file, preview: URL.createObjectURL(file) }))
    setPhotos(prev => [...prev, ...next])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeNewPhoto(idx: number) {
    setPhotos(prev => {
      URL.revokeObjectURL(prev[idx].preview)
      return prev.filter((_, i) => i !== idx)
    })
  }

  function removeExistingPhoto(idx: number) {
    setExistingPhotoUrls(prev => prev.filter((_, i) => i !== idx))
  }

  // submitMode: 'save' keeps the row's current status; 'complete' promotes to completed
  const submitMut = useMutation({
    mutationFn: async (submitMode: 'save' | 'complete') => {
      if (!propertyId) throw new Error(t('form.errorPickProperty'))
      if (!date) throw new Error(t('form.errorPickDate'))

      const targetStatus: Status =
        submitMode === 'complete' ? 'completed'
        : isEditing ? (existing!.status)
        : (mode === 'schedule' ? 'scheduled' : 'completed')

      const row: Record<string, unknown> = {
        property_id: propertyId,
        cleaner_id: cleanerId,
        inspector_id: inspectorId,
        status: targetStatus,
        last_cleaned_on: lastCleanedOn || null,
        notes: notes.trim() || null,
      }

      if (targetStatus === 'scheduled') {
        row.scheduled_for = date
        row.inspected_at = date
        // Don't set scores/urgency on scheduled rows
        row.overall_score = null
        row.cleanliness_score = null
        row.linens_score = null
        row.supplies_score = null
        row.exterior_score = null
        row.reinspect_urgency = 'none'
        row.reinspect_by = null
      } else {
        // completed (either fresh "Log Now" or "Mark Complete" on a scheduled)
        row.inspected_at = date
        row.scheduled_for = existing?.scheduled_for ?? null
        for (const a of SCORE_AREAS) row[a.key] = scores[a.key]
        row.reinspect_urgency = urgency
        row.reinspect_by = reinspectBy || null
      }

      let inspectionId: string
      if (isEditing) {
        const { error } = await supabase.from('inspections').update(row).eq('id', existing!.id)
        if (error) throw error
        inspectionId = existing!.id
      } else {
        const { data: inserted, error } = await supabase
          .from('inspections')
          .insert(row)
          .select('id')
          .single()
        if (error) throw error
        inspectionId = inserted.id as string
      }

      // Upload any newly-added photos and merge with kept existing photos.
      if (photos.length > 0 || (isEditing && existingPhotoUrls.length !== (existing!.photos_url ?? []).length)) {
        const newUrls: string[] = []
        for (let i = 0; i < photos.length; i++) {
          const file = await resizeImageFile(photos[i].file)
          const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
          const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'jpg'
          const rand = (crypto?.randomUUID?.() || `${Date.now()}-${i}`)
          const path = `${inspectionId}/${rand}.${safeExt}`
          const { error: upErr } = await supabase
            .storage
            .from('inspections')
            .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
          if (upErr) throw upErr
          const { data: urlData } = supabase.storage.from('inspections').getPublicUrl(path)
          newUrls.push(urlData.publicUrl)
        }
        const merged = [...existingPhotoUrls, ...newUrls]
        const { error: updErr } = await supabase
          .from('inspections')
          .update({ photos_url: merged.length ? merged : null })
          .eq('id', inspectionId)
        if (updErr) throw updErr
      }

      return { inspectionId, targetStatus }
    },
    onSuccess: ({ targetStatus }) => {
      const wasScheduled = !!(existing && existing.status === 'scheduled')
      toast({
        title:
          targetStatus === 'completed' && wasScheduled ? t('form.toastCompleted')
          : isEditing ? t('form.toastUpdated')
          : targetStatus === 'scheduled' ? t('form.toastScheduled')
          : t('form.toastLogged'),
      })
      queryClient.invalidateQueries({ queryKey: ['/supabase/inspections-all'] })
      // Dashboard Quality widgets read from a separate 90-day aggregate;
      // bump it too so a fresh inspection log surfaces on /dashboard
      // immediately instead of waiting for the cache window to expire.
      queryClient.invalidateQueries({ queryKey: ['/supabase/dashboard-inspections'] })
      onOpenChange(false)
    },
    onError: (e: Error) => {
      toast({ title: t('form.toastSaveFailed'), description: e.message, variant: 'destructive' })
      setSubmitting(false)
    },
  })

  function fireSubmit(submitMode: 'save' | 'complete') {
    if (!propertyId) {
      toast({ title: t('form.toastPickProperty'), variant: 'destructive' })
      return
    }
    if (!date) {
      toast({ title: t('form.toastPickDate'), variant: 'destructive' })
      return
    }
    setSubmitting(true)
    submitMut.mutate(submitMode)
  }

  // Drives whether scorecard / urgency sections render. They show only when the
  // submission will result in a *completed* row.
  const showCompletionFields = isEditing
    ? true // always allow editing a row's completion fields (Save keeps status if scheduled)
    : mode === 'log'

  // Sticky footer button copy
  const isCompletingScheduled = isEditing && existing?.status === 'scheduled'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 flex flex-col h-[100dvh] sm:h-screen overflow-x-hidden"
      >
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <SheetTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-primary" />
            {isEditing
              ? (existing!.status === 'scheduled' ? t('form.titleEditScheduled') : t('form.titleEdit'))
              : t('form.titleNew')}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4 space-y-5">
          {/* Shareable link — available once the inspection exists (scheduled
              or completed). The same link shows the scheduled state now and
              the full report once completed; opens for anyone, no login. */}
          {isEditing && existing?.share_token && (
            <button
              type="button"
              onClick={() => {
                const url = `${window.location.origin}/inspection/${existing.share_token}`
                navigator.clipboard.writeText(url).then(() => { setCopiedShare(true); setTimeout(() => setCopiedShare(false), 2000) })
              }}
              className="w-full flex items-center justify-center gap-2 h-9 rounded-md border border-primary/40 bg-primary/5 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
            >
              {copiedShare ? (
                <><Check className="w-4 h-4" /> {t('shareLink.copied')}</>
              ) : (
                <><Link2 className="w-4 h-4" /> {existing.status === 'scheduled' ? t('shareLink.copyInspection') : t('shareLink.copyReport')}</>
              )}
            </button>
          )}

          {/* Mode toggle — only for fresh creates */}
          {!isEditing && (
            <div className="grid grid-cols-2 gap-2">
              <ModeButton active={mode === 'log'} onClick={() => setMode('log')} icon={<ClipboardCheck className="w-4 h-4" />} label={t('form.modeLog')} />
              <ModeButton active={mode === 'schedule'} onClick={() => setMode('schedule')} icon={<Calendar className="w-4 h-4" />} label={t('form.modeSchedule')} />
            </div>
          )}

          {/* Property */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{t('form.property')}</Label>
            {selectedProperty ? (
              <div className="flex items-center justify-between gap-2 p-3 rounded-md border bg-muted/40">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{selectedProperty.name}</div>
                  {selectedProperty.address && (
                    <div className="text-xs text-muted-foreground truncate">{selectedProperty.address}</div>
                  )}
                </div>
                {!isEditing && (
                  <Button variant="ghost" size="sm" className="shrink-0" onClick={() => { setPropertyId(null); setShowPropertyList(true) }}>
                    {t('form.change')}
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={propertySearch}
                    onChange={e => { setPropertySearch(e.target.value); setShowPropertyList(true) }}
                    onFocus={() => setShowPropertyList(true)}
                    placeholder={t('form.searchProperties')}
                    className="pl-9 h-11"
                  />
                </div>
                {showPropertyList && (
                  <div className="border rounded-md max-h-60 overflow-y-auto divide-y">
                    {filteredProperties.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground">{t('form.noMatches')}</div>
                    ) : (
                      filteredProperties.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setPropertyId(p.id); setShowPropertyList(false); setPropertySearch('') }}
                          className="w-full text-left p-3 hover:bg-muted/50 active:bg-muted"
                        >
                          <div className="text-sm font-medium flex items-center gap-2 min-w-0">
                            <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate">{p.name}</span>
                          </div>
                          {p.address && (
                            <div className="text-xs text-muted-foreground mt-0.5 ml-5 truncate">{p.address}</div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Property info card — appears when a property is selected */}
          {selectedProperty && <PropertyInfoCard property={selectedProperty} />}

          {/* Dates: scheduled or inspected, plus last cleaned */}
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                {(!isEditing && mode === 'schedule') || (isEditing && existing!.status === 'scheduled')
                  ? t('form.scheduledDateLabel')
                  : t('form.inspectionDateLabel')}
              </Label>
              <Input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t('form.lastCleanedLabel')}</Label>
              <Input
                type="date"
                value={lastCleanedOn}
                onChange={e => setLastCleanedOn(e.target.value)}
                className="h-11"
                placeholder={t('form.lastCleanedPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {t('form.lastCleanedHint')}
              </p>
            </div>
          </div>

          {/* People */}
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t('form.cleanerFieldLabel')}</Label>
              <select
                value={cleanerId ?? ''}
                onChange={e => setCleanerId(e.target.value || null)}
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t('form.notSpecified')}</option>
                {cleaners.map(c => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t('form.inspectorFieldLabel')}</Label>
              <select
                value={inspectorId ?? ''}
                onChange={e => setInspectorId(e.target.value || null)}
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t('form.notSpecified')}</option>
                {cleaners.map(c => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Scorecard — only when row will be a completed inspection */}
          {showCompletionFields && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">{t('form.scorecardLabel')}</Label>
              <div className="space-y-2">
                {SCORE_AREAS.map(a => (
                  <StarRow
                    key={a.key}
                    label={t(`scores.${a.labelKey}`)}
                    value={scores[a.key]}
                    onChange={v => setScores(s => ({ ...s, [a.key]: v }))}
                    t={t}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Photos — always available */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{t('form.photosLabel')}</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handlePhotoChange}
              className="hidden"
            />
            <div className="flex flex-wrap gap-2">
              {existingPhotoUrls.map((url, i) => (
                <div key={`existing-${i}`} className="relative w-20 h-20 rounded-md overflow-hidden border">
                  <img src={url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeExistingPhoto(i)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                    aria-label={t('form.removePhoto')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {photos.map((p, i) => (
                <div key={`new-${i}`} className="relative w-20 h-20 rounded-md overflow-hidden border">
                  <img src={p.preview} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeNewPhoto(i)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                    aria-label={t('form.removePhoto')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-20 h-20 rounded-md border-2 border-dashed border-border hover:border-primary/60 flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
              >
                <Camera className="w-5 h-5" />
                <span>{t('form.addPhoto')}</span>
              </button>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{t('form.notesLabel')}</Label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={t('form.notesPlaceholder')}
            />
          </div>

          {/* Re-inspect urgency — completion-only */}
          {showCompletionFields && (
            <>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{t('form.reinspectUrgencyLabel')}</Label>
                <div className="grid grid-cols-5 gap-1.5">
                  {URGENCY_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setUrgency(opt.value)}
                      className={cn(
                        'h-11 rounded-md border-2 text-xs font-medium transition-colors min-w-0',
                        urgency === opt.value ? `${opt.bg} ${opt.ring}` : 'bg-background border-border hover:border-primary/30',
                      )}
                    >
                      {t(`reinspect.${opt.value}`)}
                    </button>
                  ))}
                </div>
              </div>

              {urgency !== 'none' && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">{t('form.reinspectByLabel')}</Label>
                  <Input
                    type="date"
                    value={reinspectBy}
                    onChange={e => setReinspectBy(e.target.value)}
                    className="h-11"
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Sticky submit */}
        <div className="border-t bg-background px-4 py-3 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2">
          {isCompletingScheduled ? (
            <>
              <Button
                className="w-full h-12 text-base"
                onClick={() => fireSubmit('complete')}
                disabled={submitting || !propertyId}
              >
                <CheckCircle2 className="w-5 h-5 mr-2" />
                {submitting ? t('common.actions.saving') : t('form.markComplete')}
              </Button>
              <Button
                variant="outline"
                className="w-full h-11"
                onClick={() => fireSubmit('save')}
                disabled={submitting || !propertyId}
              >
                {t('form.saveChangesKeepScheduled')}
              </Button>
            </>
          ) : (
            <Button
              className="w-full h-12 text-base"
              onClick={() => fireSubmit('save')}
              disabled={submitting || !propertyId}
            >
              {submitting
                ? t('common.actions.saving')
                : isEditing ? t('form.saveChanges')
                : mode === 'schedule' ? t('form.scheduleInspection') : t('form.logInspection')}
            </Button>
          )}
          {isEditing && existing && onDelete && (
            <Button
              type="button"
              variant="ghost"
              className="w-full h-10 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onDelete(existing)}
              disabled={submitting}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {t('form.deleteInspection')}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

type PropertyRow = {
  id: number
  name: string
  address: string | null
  filter_size: string | null
  last_filter_changed: string | null
  next_filter_due: string | null
  auto_code: string | null
  door_code: string | null
  other_codes: string | null
  wifi_info: string | null
}

function PropertyInfoCard({ property }: { property: PropertyRow }) {
  const { t } = useLocale('inspections')
  const [mapOpen, setMapOpen] = useState(false)
  const hasFilter = !!(property.filter_size || property.next_filter_due || property.last_filter_changed)
  const hasCodes = !!(property.auto_code || property.door_code || property.other_codes)
  const hasWifi = !!property.wifi_info
  if (!hasFilter && !hasCodes && !hasWifi && !property.address) {
    return (
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {t('form.noInfoOnFile')}
      </div>
    )
  }
  return (
    <>
    <div className="rounded-md border bg-muted/30 divide-y">
      {property.address && (
        <InfoRow icon={<MapPin className="w-3.5 h-3.5" />} label={t('form.infoAddress')}>
          <button
            type="button"
            onClick={() => setMapOpen(true)}
            className="text-sm text-left hover:underline underline-offset-2 text-primary"
          >
            {property.address}
          </button>
        </InfoRow>
      )}
      {hasFilter && (
        <InfoRow icon={<Wind className="w-3.5 h-3.5" />} label={t('form.infoAcFilter')}>
          <div className="space-y-0.5">
            {property.filter_size && <div className="font-medium">{property.filter_size}</div>}
            <div className="text-xs text-muted-foreground space-x-2">
              {property.last_filter_changed && <span>{t('form.infoChanged', { date: property.last_filter_changed })}</span>}
              {property.next_filter_due && <span>{t('form.infoDue', { date: property.next_filter_due })}</span>}
            </div>
          </div>
        </InfoRow>
      )}
      {hasCodes && (
        <InfoRow icon={<KeyRound className="w-3.5 h-3.5" />} label={t('form.infoAccessCodes')}>
          <div className="space-y-0.5 text-sm">
            {property.auto_code && <div><span className="text-muted-foreground text-xs">{t('form.infoAuto')}</span> <span className="font-mono">{property.auto_code}</span></div>}
            {property.door_code && <div><span className="text-muted-foreground text-xs">{t('form.infoDoor')}</span> <span className="font-mono">{property.door_code}</span></div>}
            {property.other_codes && <div className="text-xs whitespace-pre-line">{property.other_codes}</div>}
          </div>
        </InfoRow>
      )}
      {hasWifi && (
        <InfoRow icon={<Wifi className="w-3.5 h-3.5" />} label={t('form.infoWifi')}>
          <div className="text-sm whitespace-pre-line break-words">{property.wifi_info}</div>
        </InfoRow>
      )}
    </div>
    {property.address && (
      <MapPickerDialog
        open={mapOpen}
        onOpenChange={setMapOpen}
        address={property.address}
      />
    )}
    </>
  )
}

function InfoRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2 flex items-start gap-3">
      <div className="w-20 shrink-0 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground pt-0.5">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function ModeButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-12 rounded-md border-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background border-border hover:border-primary/30',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function StarRow({ label, value, onChange, t }: { label: string; value: number | null; onChange: (v: number | null) => void; t: TFunc }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3 py-1">
      <span className="text-sm">{label}</span>
      <div className="flex items-center justify-between sm:justify-start gap-1 w-full sm:w-auto">
        {[1, 2, 3, 4, 5].map(n => {
          const filled = value != null && n <= value
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(value === n ? null : n)}
              className="flex-1 sm:flex-none w-auto sm:w-11 h-11 flex items-center justify-center rounded-md hover:bg-muted active:bg-muted/70"
              aria-label={t('form.starAria', { label, count: n })}
            >
              <Star
                className={cn(
                  'w-6 h-6 transition-colors',
                  filled
                    ? 'fill-amber-400 text-amber-400'
                    : 'text-muted-foreground/40',
                )}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
