import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Star, Camera, X, Calendar, ClipboardCheck, Building2, Search } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'

type Mode = 'log' | 'schedule'
type Urgency = 'none' | 'low' | 'medium' | 'high' | 'critical'

const URGENCY_OPTIONS: { value: Urgency; label: string; ring: string; bg: string }[] = [
  { value: 'none',     label: 'None',     ring: 'border-border',                bg: 'bg-muted text-muted-foreground' },
  { value: 'low',      label: 'Low',      ring: 'border-emerald-500',           bg: 'bg-emerald-500 text-white' },
  { value: 'medium',   label: 'Medium',   ring: 'border-amber-500',             bg: 'bg-amber-500 text-white' },
  { value: 'high',     label: 'High',     ring: 'border-orange-500',            bg: 'bg-orange-500 text-white' },
  { value: 'critical', label: 'Critical', ring: 'border-red-600',               bg: 'bg-red-600 text-white' },
]

const SCORE_AREAS = [
  { key: 'overall_score',     label: 'Overall' },
  { key: 'cleanliness_score', label: 'Cleanliness' },
  { key: 'linens_score',      label: 'Linens' },
  { key: 'supplies_score',    label: 'Supplies' },
  { key: 'exterior_score',    label: 'Exterior' },
] as const

type ScoreKey = typeof SCORE_AREAS[number]['key']

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InspectionFormSheet({ open, onOpenChange }: Props) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const today = format(new Date(), 'yyyy-MM-dd')

  const [mode, setMode] = useState<Mode>('log')
  const [propertyId, setPropertyId] = useState<number | null>(null)
  const [propertySearch, setPropertySearch] = useState('')
  const [showPropertyList, setShowPropertyList] = useState(false)
  const [cleanerId, setCleanerId] = useState<string | null>(null)
  const [date, setDate] = useState(today)
  const [scores, setScores] = useState<Record<ScoreKey, number | null>>({
    overall_score: null,
    cleanliness_score: null,
    linens_score: null,
    supplies_score: null,
    exterior_score: null,
  })
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([])
  const [urgency, setUrgency] = useState<Urgency>('none')
  const [reinspectBy, setReinspectBy] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setMode('log')
      setPropertyId(null)
      setPropertySearch('')
      setShowPropertyList(false)
      setCleanerId(null)
      setDate(today)
      setScores({ overall_score: null, cleanliness_score: null, linens_score: null, supplies_score: null, exterior_score: null })
      setNotes('')
      photos.forEach(p => URL.revokeObjectURL(p.preview))
      setPhotos([])
      setUrgency('none')
      setReinspectBy('')
      setSubmitting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    return () => photos.forEach(p => URL.revokeObjectURL(p.preview))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: properties = [] } = useQuery({
    queryKey: ['/supabase/inspection-form-properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, address')
        .order('name')
      if (error) throw error
      return (data ?? []) as { id: number; name: string; address: string | null }[]
    },
    enabled: open,
    staleTime: 60_000,
  })

  const { data: cleaners = [] } = useQuery({
    queryKey: ['/supabase/inspection-form-cleaners'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cleaners')
        .select('id, full_name')
        .order('full_name')
      if (error) throw error
      return (data ?? []) as { id: string; full_name: string }[]
    },
    enabled: open,
    staleTime: 60_000,
  })

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

  function removePhoto(idx: number) {
    setPhotos(prev => {
      URL.revokeObjectURL(prev[idx].preview)
      return prev.filter((_, i) => i !== idx)
    })
  }

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!propertyId) throw new Error('Pick a property.')
      if (!date) throw new Error('Pick a date.')

      const baseRow: Record<string, unknown> = {
        property_id: propertyId,
        cleaner_id: cleanerId,
        status: mode === 'schedule' ? 'scheduled' : 'completed',
        notes: notes.trim() || null,
        reinspect_urgency: urgency,
        reinspect_by: reinspectBy || null,
      }

      if (mode === 'schedule') {
        baseRow.scheduled_for = date
        baseRow.inspected_at = date
      } else {
        baseRow.inspected_at = date
        for (const a of SCORE_AREAS) {
          baseRow[a.key] = scores[a.key]
        }
      }

      const { data: inserted, error: insertErr } = await supabase
        .from('inspections')
        .insert(baseRow)
        .select('id')
        .single()
      if (insertErr) throw insertErr
      const inspectionId = inserted.id as string

      if (photos.length > 0) {
        const urls: string[] = []
        for (let i = 0; i < photos.length; i++) {
          const file = photos[i].file
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
          urls.push(urlData.publicUrl)
        }
        const { error: updErr } = await supabase
          .from('inspections')
          .update({ photos_url: urls })
          .eq('id', inspectionId)
        if (updErr) throw updErr
      }

      return inspectionId
    },
    onSuccess: () => {
      toast({ title: mode === 'schedule' ? 'Inspection scheduled' : 'Inspection logged' })
      queryClient.invalidateQueries({ queryKey: ['/supabase/inspections-all'] })
      onOpenChange(false)
    },
    onError: (e: Error) => {
      toast({ title: 'Could not save', description: e.message, variant: 'destructive' })
      setSubmitting(false)
    },
  })

  function handleSubmit() {
    if (!propertyId) {
      toast({ title: 'Pick a property', variant: 'destructive' })
      return
    }
    if (!date) {
      toast({ title: 'Pick a date', variant: 'destructive' })
      return
    }
    setSubmitting(true)
    submitMut.mutate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 flex flex-col h-[100dvh] sm:h-screen overflow-x-hidden"
      >
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <SheetTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-primary" />
            New Inspection
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4 space-y-5">
          <div className="grid grid-cols-2 gap-2">
            <ModeButton active={mode === 'log'} onClick={() => setMode('log')} icon={<ClipboardCheck className="w-4 h-4" />} label="Log Now" />
            <ModeButton active={mode === 'schedule'} onClick={() => setMode('schedule')} icon={<Calendar className="w-4 h-4" />} label="Schedule" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Property</Label>
            {selectedProperty ? (
              <div className="flex items-center justify-between gap-2 p-3 rounded-md border bg-muted/40">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{selectedProperty.name}</div>
                  {selectedProperty.address && (
                    <div className="text-xs text-muted-foreground truncate">{selectedProperty.address}</div>
                  )}
                </div>
                <Button variant="ghost" size="sm" className="shrink-0" onClick={() => { setPropertyId(null); setShowPropertyList(true) }}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={propertySearch}
                    onChange={e => { setPropertySearch(e.target.value); setShowPropertyList(true) }}
                    onFocus={() => setShowPropertyList(true)}
                    placeholder="Search properties…"
                    className="pl-9 h-11"
                  />
                </div>
                {showPropertyList && (
                  <div className="border rounded-md max-h-60 overflow-y-auto divide-y">
                    {filteredProperties.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground">No matches.</div>
                    ) : (
                      filteredProperties.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setPropertyId(p.id); setShowPropertyList(false); setPropertySearch('') }}
                          className="w-full text-left p-3 hover:bg-muted/50 active:bg-muted"
                        >
                          <div className="text-sm font-medium flex items-center gap-2">
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

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              {mode === 'schedule' ? 'Scheduled date' : 'Inspection date'}
            </Label>
            <Input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="h-11"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Cleaner who previously cleaned</Label>
            <select
              value={cleanerId ?? ''}
              onChange={e => setCleanerId(e.target.value || null)}
              className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— Not specified —</option>
              {cleaners.map(c => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>
          </div>

          {mode === 'log' && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Scorecard (1-5 stars)</Label>
              <div className="space-y-2">
                {SCORE_AREAS.map(a => (
                  <StarRow
                    key={a.key}
                    label={a.label}
                    value={scores[a.key]}
                    onChange={v => setScores(s => ({ ...s, [a.key]: v }))}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Photos</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handlePhotoChange}
              className="hidden"
            />
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={i} className="relative w-20 h-20 rounded-md overflow-hidden border">
                  <img src={p.preview} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                    aria-label="Remove photo"
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
                <span>Add</span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Notes</Label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Anything noteworthy about this inspection?"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Re-inspect urgency</Label>
            <div className="grid grid-cols-5 gap-1.5">
              {URGENCY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setUrgency(opt.value)}
                  className={cn(
                    'h-11 rounded-md border-2 text-xs font-medium transition-colors',
                    urgency === opt.value ? `${opt.bg} ${opt.ring}` : 'bg-background border-border hover:border-primary/30',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {urgency !== 'none' && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Re-inspect by (optional)</Label>
              <Input
                type="date"
                value={reinspectBy}
                onChange={e => setReinspectBy(e.target.value)}
                className="h-11"
              />
            </div>
          )}
        </div>

        <div className="border-t bg-background px-4 py-3 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button
            className="w-full h-12 text-base"
            onClick={handleSubmit}
            disabled={submitting || !propertyId}
          >
            {submitting
              ? 'Saving…'
              : mode === 'schedule' ? 'Schedule Inspection' : 'Log Inspection'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
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

function StarRow({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
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
              aria-label={`${label} ${n} stars`}
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
