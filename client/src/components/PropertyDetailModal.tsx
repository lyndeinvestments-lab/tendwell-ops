import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, STAGE_COLORS } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { useLocation } from 'wouter'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Eye, EyeOff, Pencil, X, Loader2, Copy, Check, Users, ExternalLink, CheckCircle2, Circle, Plus } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts'

// ── Access code reveal cell ──────────────────────────────────────────────────
function RevealCell({ value, field, id }: { value: string | null; field: string; id: string }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    if (!value) return
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleReveal() {
    setRevealed(true)
    try {
      await supabase.from('access_audit_log').insert({
        property_id: id,
        field_name: field,
        action: 'reveal',
        timestamp: new Date().toISOString(),
      })
    } catch { /* silent */ }
  }

  if (!value) return <span className="text-muted-foreground text-xs">—</span>

  if (!revealed) {
    return (
      <button
        onClick={handleReveal}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors group"
        data-testid={`modal-reveal-${field}`}
      >
        <span className="tracking-widest">••••••</span>
        <Eye className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-mono">{value}</span>
      <button onClick={() => setRevealed(false)} className="text-muted-foreground hover:text-foreground">
        <EyeOff className="w-3 h-3" />
      </button>
      <button onClick={handleCopy} className="text-muted-foreground hover:text-foreground" title={copied ? 'Copied!' : 'Copy'}>
        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  )
}

// ── Onboarding Checklist ──────────────────────────────────────────────────────
function OnboardingChecklist({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [newTask, setNewTask] = useState('')

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['/supabase/onboarding-tasks', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('onboarding_tasks')
        .select('*')
        .eq('property_id', propertyId)
        .order('sort_order')
      if (error) throw error
      if (data && data.length === 0) {
        // Auto-create from templates
        const { data: templates } = await supabase
          .from('onboarding_task_templates')
          .select('task_name, sort_order')
          .eq('is_active', true)
          .order('sort_order')
        if (templates && templates.length > 0) {
          const rows = templates.map(t => ({
            property_id: propertyId,
            task_name: t.task_name,
            sort_order: t.sort_order,
          }))
          await supabase.from('onboarding_tasks').insert(rows)
          const { data: created } = await supabase
            .from('onboarding_tasks')
            .select('*')
            .eq('property_id', propertyId)
            .order('sort_order')
          return created || []
        }
      }
      return data || []
    },
  })

  const { mutate: toggleTask } = useMutation({
    mutationFn: async ({ id, complete }: { id: string; complete: boolean }) => {
      const { error } = await supabase
        .from('onboarding_tasks')
        .update({ is_complete: complete, completed_at: complete ? new Date().toISOString() : null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/onboarding-tasks', propertyId] })
    },
  })

  const { mutate: addTask } = useMutation({
    mutationFn: async (taskName: string) => {
      const maxOrder = (tasks || []).reduce((m: number, t: any) => Math.max(m, t.sort_order || 0), 0)
      const { error } = await supabase.from('onboarding_tasks').insert({
        property_id: propertyId,
        task_name: taskName,
        sort_order: maxOrder + 1,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/onboarding-tasks', propertyId] })
      setNewTask('')
    },
  })

  if (isLoading) return <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>

  const completed = (tasks || []).filter((t: any) => t.is_complete).length
  const total = (tasks || []).length
  const pct = total > 0 ? (completed / total) * 100 : 0

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-muted-foreground">{completed} of {total} complete</span>
          <span className="font-medium">{pct.toFixed(0)}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="space-y-1">
        {(tasks || []).map((t: any) => (
          <label
            key={t.id}
            className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer ${t.is_complete ? 'opacity-60' : ''}`}
          >
            <button
              onClick={() => toggleTask({ id: t.id, complete: !t.is_complete })}
              className="flex-shrink-0"
            >
              {t.is_complete ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Circle className="w-4 h-4 text-muted-foreground" />}
            </button>
            <span className={`text-sm ${t.is_complete ? 'line-through text-muted-foreground' : ''}`}>{t.task_name}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={newTask}
          onChange={e => setNewTask(e.target.value)}
          placeholder="Add a task…"
          className="h-7 text-xs flex-1"
          onKeyDown={e => e.key === 'Enter' && newTask.trim() && addTask(newTask.trim())}
        />
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!newTask.trim()} onClick={() => addTask(newTask.trim())}>
          <Plus className="w-3 h-3" />
        </Button>
      </div>
    </div>
  )
}

// ── Inspections Tab ──────────────────────────────────────────────────────────
function InspectionsTab({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [showForm, setShowForm] = useState(false)
  const [form, setInspForm] = useState({ overall: 5, cleanliness: 5, linens: 5, supplies: 5, exterior: 5, notes: '' })
  const [photos, setPhotos] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const { data: inspections, isLoading } = useQuery({
    queryKey: ['/supabase/inspections', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspections')
        .select('*')
        .eq('property_id', propertyId)
        .order('inspected_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { mutate: logInspection, isPending } = useMutation({
    mutationFn: async () => {
      let photoUrls: string[] = []
      if (photos.length > 0) {
        setUploading(true)
        for (const file of photos.slice(0, 5)) {
          const path = `inspections/${propertyId}/${Date.now()}_${file.name}`
          const { error: uploadError } = await supabase.storage.from('inspections').upload(path, file)
          if (!uploadError) {
            const { data: urlData } = supabase.storage.from('inspections').getPublicUrl(path)
            if (urlData?.publicUrl) photoUrls.push(urlData.publicUrl)
          }
        }
        setUploading(false)
      }
      const { error } = await supabase.from('inspections').insert({
        property_id: propertyId,
        overall_score: form.overall,
        cleanliness_score: form.cleanliness,
        linens_score: form.linens,
        supplies_score: form.supplies,
        exterior_score: form.exterior,
        notes: form.notes || null,
        photos_url: photoUrls.length > 0 ? photoUrls : null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/inspections', propertyId] })
      qc.invalidateQueries({ queryKey: ['/supabase/inspections-all'] })
      toast({ title: 'Inspection logged' })
      setShowForm(false)
      setInspForm({ overall: 5, cleanliness: 5, linens: 5, supplies: 5, exterior: 5, notes: '' })
      setPhotos([])
    },
    onError: () => toast({ title: 'Failed to log inspection', variant: 'destructive' }),
  })

  function ScoreSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-20">{label}</span>
        <input type="range" min={1} max={10} value={value} onChange={e => onChange(parseInt(e.target.value))} className="flex-1 h-1.5 accent-primary" />
        <span className={`text-xs font-medium w-6 text-center ${value >= 8 ? 'text-green-600' : value >= 6 ? 'text-amber-600' : 'text-red-600'}`}>{value}</span>
      </div>
    )
  }

  function ScoreBadge({ score }: { score: number }) {
    const cls = score >= 8 ? 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800' :
                score >= 6 ? 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-800' :
                'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800'
    return <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${cls}`}>{score}/10</span>
  }

  if (isLoading) return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>

  const chartData = (inspections || []).slice().reverse().map((i: any) => ({
    date: new Date(i.inspected_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    score: i.overall_score,
  }))

  return (
    <div className="space-y-3">
      {chartData.length >= 2 && (
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={chartData}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
            <RechartsTooltip />
            <Area type="monotone" dataKey="score" stroke="#3b82f6" fill="#3b82f680" />
          </AreaChart>
        </ResponsiveContainer>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{(inspections || []).length} inspection(s)</span>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowForm(f => !f)}>
          <Plus className="w-3 h-3" /> Log Inspection
        </Button>
      </div>

      {showForm && (
        <div className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
          <ScoreSlider label="Overall" value={form.overall} onChange={v => setInspForm(f => ({ ...f, overall: v }))} />
          <ScoreSlider label="Cleanliness" value={form.cleanliness} onChange={v => setInspForm(f => ({ ...f, cleanliness: v }))} />
          <ScoreSlider label="Linens" value={form.linens} onChange={v => setInspForm(f => ({ ...f, linens: v }))} />
          <ScoreSlider label="Supplies" value={form.supplies} onChange={v => setInspForm(f => ({ ...f, supplies: v }))} />
          <ScoreSlider label="Exterior" value={form.exterior} onChange={v => setInspForm(f => ({ ...f, exterior: v }))} />
          <textarea
            value={form.notes}
            onChange={e => setInspForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Notes…"
            className="w-full h-16 rounded-md border border-input bg-background px-2 py-1 text-xs resize-none"
          />
          <div>
            <label className="text-xs text-muted-foreground">Photos (max 5)</label>
            <input type="file" accept="image/*" multiple onChange={e => setPhotos(Array.from(e.target.files || []).slice(0, 5))} className="text-xs mt-1" />
            {uploading && <div className="h-1.5 bg-muted rounded-full mt-1 overflow-hidden"><div className="h-full bg-primary rounded-full animate-pulse w-2/3" /></div>}
          </div>
          <Button size="sm" className="text-xs" disabled={isPending || uploading} onClick={() => logInspection()}>
            {isPending ? 'Saving…' : 'Save Inspection'}
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {(inspections || []).map((insp: any) => (
          <div key={insp.id} className="border border-border/50 rounded p-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{new Date(insp.inspected_at).toLocaleDateString()}</span>
              <ScoreBadge score={insp.overall_score} />
            </div>
            <div className="flex gap-2 text-xs text-muted-foreground">
              <span>Clean: {insp.cleanliness_score}</span>
              <span>Linen: {insp.linens_score}</span>
              <span>Supply: {insp.supplies_score}</span>
              <span>Ext: {insp.exterior_score}</span>
            </div>
            {insp.notes && <p className="text-xs">{insp.notes}</p>}
            {insp.photos_url && insp.photos_url.length > 0 && (
              <div className="flex gap-1 mt-1">
                {insp.photos_url.map((url: string, i: number) => (
                  <button key={i} onClick={() => setLightboxUrl(url)} className="w-12 h-12 rounded border border-border overflow-hidden hover:opacity-80">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Lightbox */}
      <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
        <DialogContent className="max-w-3xl p-2">
          <DialogTitle className="sr-only">Photo preview</DialogTitle>
          {lightboxUrl && <img src={lightboxUrl} alt="Inspection photo" className="w-full rounded" />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Assignments Tab ──────────────────────────────────────────────────────────
function AssignmentsTab({ propertyId }: { propertyId: string }) {
  const { data: assignments, isLoading } = useQuery({
    queryKey: ['/supabase/assignments', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clean_assignments')
        .select('*, cleaners(full_name)')
        .eq('property_id', propertyId)
        .order('scheduled_date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  if (isLoading) return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>

  if (!assignments || assignments.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-4">No cleaning assignments yet.</p>
  }

  return (
    <div className="space-y-1">
      {assignments.map((a: any) => (
        <div key={a.id} className="flex items-center justify-between px-2 py-1.5 border-b border-border/40 text-xs">
          <div>
            <span className="font-medium">{(a.cleaners as any)?.full_name || '—'}</span>
            <span className="text-muted-foreground ml-2">{a.scheduled_date}</span>
          </div>
          <div className="flex items-center gap-2">
            {a.pay_amount != null && <span className="tabular-nums">${Number(a.pay_amount).toFixed(2)}</span>}
            <span className={`px-1.5 py-0.5 rounded text-xs ${
              a.status === 'completed' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' :
              a.status === 'cancelled' ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400' :
              'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
            }`}>{a.status}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Photos Tab ───────────────────────────────────────────────────────────────
function PhotosTab({ propertyId }: { propertyId: string }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [uploading, setUploading] = useState(false)

  const { data: photos, isLoading } = useQuery({
    queryKey: ['/supabase/property-photos', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_photos')
        .select('*')
        .eq('property_id', propertyId)
        .order('sort_order')
      if (error) throw error
      return data || []
    },
  })

  const { mutate: deletePhoto } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('property_photos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/property-photos', propertyId] })
      toast({ title: 'Photo deleted' })
    },
    onError: () => toast({ title: 'Failed to delete photo', variant: 'destructive' }),
  })

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setUploading(true)
    try {
      for (const file of files) {
        const ext = file.name.split('.').pop()
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const path = `${propertyId}/${filename}`
        const { error: uploadErr } = await supabase.storage.from('property-photos').upload(path, file)
        if (uploadErr) throw uploadErr
        const { data: urlData } = supabase.storage.from('property-photos').getPublicUrl(path)
        const currentCount = photos?.length ?? 0
        await supabase.from('property_photos').insert({
          property_id: propertyId,
          photo_url: urlData.publicUrl,
          sort_order: currentCount,
        })
      }
      qc.invalidateQueries({ queryKey: ['/supabase/property-photos', propertyId] })
      toast({ title: `${files.length} photo(s) uploaded` })
    } catch {
      toast({ title: 'Upload failed', variant: 'destructive' })
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  if (isLoading) return <div className="grid grid-cols-3 gap-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="aspect-square rounded-md" />)}</div>

  return (
    <div className="space-y-3">
      <label className={`flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-4 cursor-pointer hover:border-primary/50 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
        <input type="file" accept="image/*" multiple onChange={handleUpload} className="hidden" />
        <Plus className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{uploading ? 'Uploading…' : 'Click to upload photos'}</span>
      </label>
      {photos && photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p: any) => (
            <div key={p.id} className="relative group aspect-square">
              <img src={p.photo_url} alt="" className="w-full h-full object-cover rounded-md border border-border" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-md flex items-center justify-center gap-2">
                <button
                  onClick={() => window.open(p.photo_url, '_blank')}
                  className="bg-white/90 text-gray-800 p-1.5 rounded text-xs hover:bg-white"
                  title="Copy URL"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { if (confirm('Delete this photo?')) deletePhoto(p.id) }}
                  className="bg-red-500/90 text-white p-1.5 rounded text-xs hover:bg-red-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-4">No photos yet. Upload the first one above.</p>
      )}
    </div>
  )
}

// ── Supplies Tab ─────────────────────────────────────────────────────────────
const DEFAULT_SUPPLIES = [
  'Toilet Paper', 'Paper Towels', 'Dish Soap', 'Trash Bags',
  'Coffee Pods', 'Laundry Pods', 'Dryer Sheets',
]

function SuppliesTab({ propertyId }: { propertyId: string }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [newItem, setNewItem] = useState('')
  const [seeding, setSeeding] = useState(false)

  const { data: supplies, isLoading } = useQuery({
    queryKey: ['/supabase/property-supplies', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_supplies')
        .select('*')
        .eq('property_id', propertyId)
        .order('item_name')
      if (error) throw error
      // Auto-seed defaults if empty
      if (data && data.length === 0) {
        const rows = DEFAULT_SUPPLIES.map(name => ({ property_id: propertyId, item_name: name, par_level: 2, current_qty: 2 }))
        await supabase.from('property_supplies').insert(rows)
        const { data: seeded } = await supabase.from('property_supplies').select('*').eq('property_id', propertyId).order('item_name')
        return seeded || []
      }
      return data || []
    },
  })

  const { mutate: updateQty } = useMutation({
    mutationFn: async ({ id, current_qty }: { id: string; current_qty: number }) => {
      const { error } = await supabase.from('property_supplies').update({ current_qty }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/supabase/property-supplies', propertyId] }),
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  })

  const { mutate: addItem, isPending: adding } = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('property_supplies').insert({
        property_id: propertyId,
        item_name: newItem.trim(),
        par_level: 1,
        current_qty: 0,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/property-supplies', propertyId] })
      toast({ title: 'Item added' })
      setNewItem('')
    },
    onError: () => toast({ title: 'Failed to add item', variant: 'destructive' }),
  })

  async function markAllRestocked() {
    if (!supplies) return
    setSeeding(true)
    try {
      await Promise.all(supplies.map((s: any) =>
        supabase.from('property_supplies').update({ current_qty: s.par_level, last_restocked: new Date().toISOString() }).eq('id', s.id)
      ))
      qc.invalidateQueries({ queryKey: ['/supabase/property-supplies', propertyId] })
      toast({ title: 'All items marked restocked' })
    } catch {
      toast({ title: 'Failed to restock', variant: 'destructive' })
    } finally {
      setSeeding(false)
    }
  }

  if (isLoading) return <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>

  const needsRestock = (supplies || []).filter((s: any) => s.current_qty < s.par_level).length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        {needsRestock > 0 && (
          <span className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
            {needsRestock} item{needsRestock !== 1 ? 's' : ''} need restock
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs ml-auto"
          disabled={seeding || !supplies?.length}
          onClick={markAllRestocked}
        >
          Mark All Restocked
        </Button>
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/60">
            <tr>
              <th className="text-left py-1.5 px-3 font-medium text-muted-foreground">Item</th>
              <th className="text-center py-1.5 px-3 font-medium text-muted-foreground w-20">Par</th>
              <th className="text-center py-1.5 px-3 font-medium text-muted-foreground w-20">Qty</th>
              <th className="text-left py-1.5 px-3 font-medium text-muted-foreground w-24">Status</th>
            </tr>
          </thead>
          <tbody>
            {(supplies || []).map((s: any) => {
              const low = s.current_qty < s.par_level
              return (
                <tr key={s.id} className={`border-t border-border/50 ${low ? 'bg-amber-50/30 dark:bg-amber-900/5' : ''}`}>
                  <td className="py-2 px-3">{s.item_name}</td>
                  <td className="py-2 px-3 text-center tabular-nums text-muted-foreground">{s.par_level}</td>
                  <td className="py-2 px-3 text-center">
                    <input
                      type="number"
                      min={0}
                      value={s.current_qty}
                      onChange={e => updateQty({ id: s.id, current_qty: Number(e.target.value) })}
                      className="w-14 h-6 text-xs border border-input rounded px-1.5 bg-background tabular-nums text-center"
                    />
                  </td>
                  <td className="py-2 px-3">
                    {low ? (
                      <span className="px-1.5 py-0.5 rounded text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-800">
                        Needs Restock
                      </span>
                    ) : (
                      <span className="text-muted-foreground">OK</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && newItem.trim()) addItem() }}
          placeholder="Add custom item…"
          className="flex-1 h-7 text-xs border border-input rounded px-2 bg-background"
        />
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!newItem.trim() || adding} onClick={() => addItem()}>
          Add
        </Button>
      </div>
    </div>
  )
}

// ── Financials Enhancement: Profit History + vs. Portfolio Avg ──
function FinancialsEnhancement({ property }: { property: any }) {
  const { data: editHistory } = useQuery({
    queryKey: ['/supabase/property-edit-history', property.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_edit_log')
        .select('field_name, old_value, new_value, created_at')
        .eq('property_id', property.id)
        .in('field_name', ['ce_charged', 'cleaner_pay'])
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
  })

  const { data: allProperties } = useQuery({
    queryKey: ['/supabase/portfolio-averages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('est_laundry, est_consumables, inspection_cost, trash_cost')
      if (error) throw error
      return data || []
    },
    staleTime: 60_000,
  })

  const chartData = useMemo(() => {
    if (!editHistory || editHistory.length === 0) return []
    let ce = property.ce_charged || 0
    let pay = property.cleaner_pay || 0
    const points: { date: string; pct: number }[] = []
    for (const log of editHistory) {
      if (log.field_name === 'ce_charged') ce = parseFloat(log.new_value || '0')
      if (log.field_name === 'cleaner_pay') pay = parseFloat(log.new_value || '0')
      const pct = ce > 0 ? ((ce - pay) / ce) * 100 : 0
      points.push({ date: new Date(log.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), pct })
    }
    return points
  }, [editHistory, property])

  const portfolioAvg = useMemo(() => {
    if (!allProperties || allProperties.length === 0) return null
    const avg = (field: string) => {
      const vals = allProperties.filter((p: any) => p[field] != null).map((p: any) => Number(p[field]))
      return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
    }
    return {
      laundry: avg('est_laundry'),
      consumables: avg('est_consumables'),
      inspection: avg('inspection_cost'),
      trash: avg('trash_cost'),
    }
  }, [allProperties])

  function DeltaIndicator({ current, avg, label }: { current: number; avg: number; label: string }) {
    const delta = current - avg
    const isAbove = delta > 0.01
    return (
      <span className={`text-xs ${isAbove ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
        {isAbove ? '+' : ''}{delta.toFixed(2)}
      </span>
    )
  }

  return (
    <div className="space-y-3">
      {chartData.length >= 2 ? (
        <div>
          <span className="text-xs text-muted-foreground block mb-1">Profit % History</span>
          <ResponsiveContainer width="100%" height={100}>
            <AreaChart data={chartData}>
              <XAxis dataKey="date" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} />
              <Area type="monotone" dataKey="pct" stroke="#22c55e" fill="#22c55e40" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">Not enough history yet</p>
      )}

      {portfolioAvg && (
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground block">vs. Portfolio Average</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Laundry', current: property.est_laundry || 0, avg: portfolioAvg.laundry },
              { label: 'Consumables', current: property.est_consumables || 0, avg: portfolioAvg.consumables },
              { label: 'Inspection', current: property.inspection_cost || 15, avg: portfolioAvg.inspection },
              { label: 'Trash', current: property.trash_cost || 5, avg: portfolioAvg.trash },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1">
                <span className="text-muted-foreground">{item.label}</span>
                <DeltaIndicator current={item.current} avg={item.avg} label={item.label} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function PropertyDetailModal() {
  const { modalState, closePropertyModal } = usePropertyModal()
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState<Record<string, any>>({})
  const [inlineField, setInlineField] = useState<string | null>(null)
  const [inlineValue, setInlineValue] = useState('')

  const propertyId = modalState?.propertyId
  const highlightFields = modalState?.highlightFields ?? []
  const sourceContext = modalState?.sourceContext

  const { data: property, isLoading } = useQuery({
    queryKey: ['/supabase/property-detail', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('*, pipeline_stages!properties_stage_id_fkey(id, name, color)')
        .eq('id', propertyId!)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!propertyId,
  })

  // Contacts for linking
  const [contactSearch, setContactSearch] = useState('')
  const [contactPopoverOpen, setContactPopoverOpen] = useState(false)
  const { data: allContacts } = useQuery({
    queryKey: ['/supabase/contacts-lite'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('id, full_name, company, payment_method')
      if (error) throw error
      return data || []
    },
    enabled: !!propertyId,
    staleTime: 30_000,
  })

  const linkedContact = useMemo(() => {
    if (!property?.contact_id || !allContacts) return null
    return allContacts.find((c: any) => c.id === property.contact_id) || null
  }, [property?.contact_id, allContacts])

  const filteredContacts = useMemo(() => {
    if (!allContacts) return []
    const q = contactSearch.toLowerCase()
    if (!q) return allContacts.slice(0, 20)
    return allContacts.filter((c: any) => c.full_name?.toLowerCase().includes(q) || c.company?.toLowerCase().includes(q)).slice(0, 20)
  }, [allContacts, contactSearch])

  const { mutate: linkContact } = useMutation({
    mutationFn: async (contactId: string | null) => {
      const { error } = await supabase.from('properties').update({ contact_id: contactId }).eq('id', propertyId!)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/property-detail', propertyId] })
      qc.invalidateQueries({ queryKey: ['/supabase/contacts'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      toast({ title: 'Contact updated' })
      setContactPopoverOpen(false)
    },
    onError: () => toast({ title: 'Failed to update contact', variant: 'destructive' }),
  })

  // Reset form when property changes
  useEffect(() => {
    if (property) {
      setForm({
        address: property.address || '',
        bedrooms: property.bedrooms ?? '',
        full_baths: property.full_baths ?? '',
        square_footage: property.square_footage ?? '',
        guest_count: property.guest_count ?? '',
        ce_charged: property.ce_charged ?? '',
        cleaner_pay: property.cleaner_pay ?? '',
        notes: property.notes || '',
      })
      setIsEditing(false)
    }
  }, [property?.id])

  const { mutate: saveEdits, isPending: saving } = useMutation({
    mutationFn: async () => {
      const updates: Record<string, any> = {
        address: form.address || null,
        bedrooms: form.bedrooms !== '' ? parseFloat(String(form.bedrooms)) : null,
        full_baths: form.full_baths !== '' ? parseFloat(String(form.full_baths)) : null,
        square_footage: form.square_footage !== '' ? parseFloat(String(form.square_footage)) : null,
        guest_count: form.guest_count !== '' ? parseFloat(String(form.guest_count)) : null,
        ce_charged: form.ce_charged !== '' ? parseFloat(String(form.ce_charged)) : null,
        cleaner_pay: form.cleaner_pay !== '' ? parseFloat(String(form.cleaner_pay)) : null,
        notes: form.notes || null,
      }
      const { error } = await supabase.from('properties').update(updates).eq('id', propertyId!)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/property-detail', propertyId] })
      qc.invalidateQueries({ queryKey: ['/supabase/properties'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      qc.invalidateQueries({ queryKey: ['/supabase/master-list'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      toast({ title: 'Saved' })
      setIsEditing(false)
    },
    onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
  })

  // Per-field inline save (click a field to edit it without pencil icon)
  const { mutate: saveInlineField } = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: any }) => {
      const numFields = ['bedrooms', 'full_baths', 'square_footage', 'ce_charged', 'cleaner_pay']
      const dbValue = numFields.includes(field) ? (value !== '' ? parseFloat(String(value)) : null) : (value || null)
      const { error } = await supabase.from('properties').update({ [field]: dbValue }).eq('id', propertyId!)
      if (error) throw error
      // Write to property_edit_log
      try {
        await supabase.from('property_edit_log').insert({
          property_id: propertyId,
          field_name: field,
          old_value: String(property?.[field] ?? ''),
          new_value: String(dbValue ?? ''),
        })
      } catch { /* silent */ }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/property-detail', propertyId] })
      qc.invalidateQueries({ queryKey: ['/supabase/properties'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      qc.invalidateQueries({ queryKey: ['/supabase/master-list'] })
      toast({ title: 'Saved' })
      setInlineField(null)
    },
    onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
  })

  function startInlineEdit(field: string, currentValue: any) {
    if (!canEdit || isEditing) return
    setInlineField(field)
    setInlineValue(String(currentValue ?? ''))
  }

  function commitInlineEdit(field: string) {
    saveInlineField({ field, value: inlineValue })
  }

  const isAdmin = user?.role === 'admin'
  const isOperations = user?.role === 'operations'
  const canEdit = isAdmin || isOperations
  const canViewFinancials = user?.role !== 'cleaning'
  const canViewAccess = user?.role !== 'cleaning'

  const stageColor = property?.pipeline_stages?.color || '#6b7280'
  const stageName = property?.pipeline_stages?.name || '—'

  // Highlight field ring class
  function fieldCls(field: string) {
    const base = 'h-7 text-xs'
    if (highlightFields.includes(field) && isEditing) return `${base} ring-2 ring-destructive`
    return base
  }

  // Navigate to source context (e.g. pipeline column scroll)
  function handleViewInContext() {
    if (sourceContext === 'pipeline') {
      closePropertyModal()
      navigate('/pipeline')
      // Scroll to column after navigation
      setTimeout(() => {
        const col = document.querySelector(`[data-testid="column-${stageName}"]`)
        col?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      }, 300)
    }
  }

  const LINEN_COLS = [
    { key: 'king_beds', label: 'King Beds' },
    { key: 'queen_beds', label: 'Queen Beds' },
    { key: 'full_beds', label: 'Full Beds' },
    { key: 'twin_beds', label: 'Twin Beds' },
    { key: 'bath_towels', label: 'Bath Towels' },
    { key: 'washcloths', label: 'Washcloths' },
    { key: 'hand_towels', label: 'Hand Towels' },
    { key: 'bathmats', label: 'Bathmats' },
    { key: 'pool_towels', label: 'Pool Towels' },
  ]

  return (
    <Dialog open={!!propertyId} onOpenChange={v => !v && closePropertyModal()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="property-detail-modal">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {isLoading ? (
                <Skeleton className="h-5 w-48" />
              ) : (
                <DialogTitle className="text-base truncate">{property?.name ?? '—'}</DialogTitle>
              )}
              {!isLoading && property && (
                <span
                  className="text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0"
                  style={{
                    backgroundColor: stageColor + '20',
                    color: stageColor,
                    border: `1px solid ${stageColor}40`,
                  }}
                >
                  {stageName}
                </span>
              )}
            </div>
            {canEdit && !isLoading && (
              isEditing ? (
                <button
                  onClick={() => { setIsEditing(false); setForm({ address: property?.address || '', bedrooms: property?.bedrooms ?? '', full_baths: property?.full_baths ?? '', square_footage: property?.square_footage ?? '', guest_count: property?.guest_count ?? '', ce_charged: property?.ce_charged ?? '', cleaner_pay: property?.cleaner_pay ?? '', notes: property?.notes || '' }) }}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  title="Cancel editing"
                  data-testid="modal-cancel-edit"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  title="Edit property"
                  data-testid="modal-edit-btn"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )
            )}
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        ) : !property ? (
          <p className="text-sm text-muted-foreground py-4">Property not found.</p>
        ) : (
          <Tabs defaultValue="overview" className="mt-2">
            <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
              <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
              {canViewFinancials && <TabsTrigger value="financials" className="text-xs">Financials</TabsTrigger>}
              <TabsTrigger value="linens" className="text-xs">Linens</TabsTrigger>
              {canViewAccess && <TabsTrigger value="access" className="text-xs">Access</TabsTrigger>}
              {canViewAccess && <TabsTrigger value="ac-filter" className="text-xs">AC Filter</TabsTrigger>}
              <TabsTrigger value="notes" className="text-xs">Notes</TabsTrigger>
              {stageName === 'Onboarding' && <TabsTrigger value="onboarding" className="text-xs">Onboarding</TabsTrigger>}
              <TabsTrigger value="inspections" className="text-xs">Inspections</TabsTrigger>
              <TabsTrigger value="assignments" className="text-xs">Assignments</TabsTrigger>
              <TabsTrigger value="photos" className="text-xs">Photos</TabsTrigger>
              <TabsTrigger value="supplies" className="text-xs">Supplies</TabsTrigger>
            </TabsList>

            {/* ── Overview Tab ── */}
            <TabsContent value="overview" className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Client', field: 'client', value: property.client || '—', editable: false },
                  { label: 'Stage', field: '_stage', value: stageName, editable: false },
                ].map(row => (
                  <div key={row.field}>
                    <span className="text-xs text-muted-foreground block mb-0.5">{row.label}</span>
                    <span className="text-sm">{row.value}</span>
                  </div>
                ))}
              </div>
              {/* Point of Contact */}
              <div>
                <Label className="text-xs text-muted-foreground">Point of Contact</Label>
                <div className="mt-0.5 flex items-center gap-2">
                  {linkedContact ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Users className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium">{linkedContact.full_name}</span>
                      {linkedContact.company && <span className="text-xs text-muted-foreground">({linkedContact.company})</span>}
                      {linkedContact.payment_method && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">{linkedContact.payment_method}</span>
                      )}
                      {canEdit && (
                        <button onClick={() => linkContact(null)} className="text-muted-foreground hover:text-destructive ml-1" title="Unlink contact">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ) : canEdit ? (
                    <Popover open={contactPopoverOpen} onOpenChange={setContactPopoverOpen}>
                      <PopoverTrigger asChild>
                        <button className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-dashed border-border hover:border-primary/40">
                          Assign contact…
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-2" align="start">
                        <Input
                          value={contactSearch}
                          onChange={e => setContactSearch(e.target.value)}
                          placeholder="Search contacts…"
                          className="h-7 text-xs mb-2"
                          autoFocus
                        />
                        <div className="max-h-40 overflow-y-auto space-y-0.5">
                          {filteredContacts.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-2">No contacts found</p>
                          ) : (
                            filteredContacts.map((c: any) => (
                              <button
                                key={c.id}
                                onClick={() => { linkContact(c.id); setContactSearch('') }}
                                className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors"
                              >
                                <span className="font-medium">{c.full_name}</span>
                                {c.company && <span className="text-muted-foreground ml-1">({c.company})</span>}
                              </button>
                            ))
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Address</Label>
                  {isEditing ? (
                    <Input
                      value={form.address}
                      onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                      className={`mt-0.5 ${fieldCls('address')}`}
                      data-testid="modal-input-address"
                      autoFocus={highlightFields[0] === 'address'}
                    />
                  ) : inlineField === 'address' ? (
                    <Input
                      autoFocus
                      value={inlineValue}
                      onChange={e => setInlineValue(e.target.value)}
                      onBlur={() => commitInlineEdit('address')}
                      onKeyDown={e => e.key === 'Enter' && commitInlineEdit('address')}
                      className="mt-0.5 h-7 text-xs"
                    />
                  ) : (
                    <p className={`text-sm mt-0.5 ${canEdit ? 'cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors' : ''}`}
                       onClick={() => startInlineEdit('address', property.address)}>
                      {property.address || '—'}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Bedrooms', field: 'bedrooms', value: property.bedrooms },
                  { label: 'Baths', field: 'full_baths', value: property.full_baths != null ? `${property.full_baths}${property.half_baths ? `/${property.half_baths}h` : ''}` : null },
                  { label: 'Sq Ft', field: 'square_footage', value: property.square_footage?.toLocaleString() },
                  { label: 'Guests', field: 'guest_count', value: property.guest_count },
                ].map(row => (
                  <div key={row.field}>
                    <Label className="text-xs text-muted-foreground">{row.label}</Label>
                    {isEditing && row.editable !== false && row.field !== 'full_baths' ? (
                      <Input
                        type="number"
                        value={form[row.field] ?? ''}
                        onChange={e => setForm(f => ({ ...f, [row.field]: e.target.value }))}
                        className={`mt-0.5 ${fieldCls(row.field)}`}
                        data-testid={`modal-input-${row.field}`}
                        autoFocus={highlightFields[0] === row.field}
                      />
                    ) : inlineField === row.field ? (
                      <Input
                        autoFocus
                        type="number"
                        value={inlineValue}
                        onChange={e => setInlineValue(e.target.value)}
                        onBlur={() => commitInlineEdit(row.field)}
                        onKeyDown={e => e.key === 'Enter' && commitInlineEdit(row.field)}
                        className="mt-0.5 h-7 text-xs"
                      />
                    ) : (
                      <p className={`text-sm mt-0.5 ${highlightFields.includes(row.field) && isEditing ? 'text-destructive' : ''} ${canEdit && row.editable !== false ? 'cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors' : ''}`}
                         onClick={() => row.editable !== false && startInlineEdit(row.field, property[row.field])}>
                        {row.value ?? '—'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* ── Financials Tab ── */}
            {canViewFinancials && (
              <TabsContent value="financials" className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'CE Charged', field: 'ce_charged', value: property.ce_charged },
                    { label: 'Cleaner Pay', field: 'cleaner_pay', value: property.cleaner_pay },
                  ].map(row => (
                    <div key={row.field}>
                      <Label className="text-xs text-muted-foreground">{row.label}</Label>
                      {isEditing ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={form[row.field] ?? ''}
                          onChange={e => setForm(f => ({ ...f, [row.field]: e.target.value }))}
                          className={`mt-0.5 ${fieldCls(row.field)}`}
                          data-testid={`modal-input-${row.field}`}
                          autoFocus={highlightFields[0] === row.field}
                        />
                      ) : inlineField === row.field ? (
                        <Input
                          autoFocus
                          type="number"
                          step="0.01"
                          value={inlineValue}
                          onChange={e => setInlineValue(e.target.value)}
                          onBlur={() => commitInlineEdit(row.field)}
                          onKeyDown={e => e.key === 'Enter' && commitInlineEdit(row.field)}
                          className="mt-0.5 h-7 text-xs"
                        />
                      ) : (
                        <p className={`text-sm mt-0.5 ${canEdit ? 'cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors' : ''}`}
                           onClick={() => startInlineEdit(row.field, row.value)}>
                          {row.value != null ? `$${Number(row.value).toFixed(2)}` : '—'}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3 bg-muted/40 rounded-md p-3">
                  <div>
                    <span className="text-xs text-muted-foreground block">Total Cost</span>
                    <span className="text-sm font-medium">{property.total_estimated_cost != null ? `$${Number(property.total_estimated_cost).toFixed(2)}` : '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Profit $</span>
                    <span className={`text-sm font-medium ${(property.estimated_profit || 0) < 0 ? 'text-destructive' : ''}`}>
                      {property.estimated_profit != null ? `$${Number(property.estimated_profit).toFixed(2)}` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Profit %</span>
                    <span className={`text-sm font-medium ${
                      property.profit_percentage == null ? '' :
                      property.profit_percentage >= 30 ? 'text-green-600 dark:text-green-400' :
                      property.profit_percentage >= 15 ? 'text-amber-600' :
                      'text-destructive'
                    }`}>
                      {property.profit_percentage != null ? `${Number(property.profit_percentage).toFixed(1)}%` : '—'}
                    </span>
                  </div>
                </div>
                <FinancialsEnhancement property={property} />
              </TabsContent>
            )}

            {/* ── Linens Tab ── */}
            <TabsContent value="linens" className="mt-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {LINEN_COLS.map(col => (
                  <div key={col.key} className="bg-muted/40 rounded p-2">
                    <span className="text-xs text-muted-foreground block">{col.label}</span>
                    <span className="text-sm font-medium">{property[col.key] ?? '—'}</span>
                  </div>
                ))}
              </div>
              {property.linen_notes && (
                <div className="mt-3">
                  <span className="text-xs text-muted-foreground block">Notes</span>
                  <p className="text-sm mt-0.5">{property.linen_notes}</p>
                </div>
              )}
            </TabsContent>

            {/* ── Access Tab ── */}
            {canViewAccess && (
              <TabsContent value="access" className="mt-3 space-y-3">
                {[
                  { key: 'auto_code', label: 'Auto Code' },
                  { key: 'door_code', label: 'Door Code' },
                  { key: 'other_codes', label: 'Other Codes' },
                  { key: 'wifi_info', label: 'WiFi Info' },
                ].map(col => (
                  <div key={col.key}>
                    <span className="text-xs text-muted-foreground block mb-0.5">{col.label}</span>
                    <RevealCell value={property[col.key]} field={col.key} id={property.id} />
                  </div>
                ))}
              </TabsContent>
            )}

            {/* ── AC Filter Tab ── */}
            {canViewAccess && (
              <TabsContent value="ac-filter" className="mt-3 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <span className="text-xs text-muted-foreground block">Filter Size</span>
                    <span className="text-sm">{property.filter_size || '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Last Changed</span>
                    <span className="text-sm">{property.last_filter_changed ? property.last_filter_changed.slice(0, 10) : '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Next Due</span>
                    <span className="text-sm">{property.next_filter_due ? property.next_filter_due.slice(0, 10) : '—'}</span>
                  </div>
                </div>
              </TabsContent>
            )}

            {/* ── Notes Tab ── */}
            <TabsContent value="notes" className="mt-3">
              {isEditing ? (
                <div>
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    className="mt-1 w-full h-32 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    data-testid="modal-input-notes"
                  />
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{property.notes || <span className="text-muted-foreground italic">No notes</span>}</p>
              )}
            </TabsContent>

            {/* ── Onboarding Tab ── */}
            {stageName === 'Onboarding' && (
              <TabsContent value="onboarding" className="mt-3">
                <OnboardingChecklist propertyId={property.id} />
              </TabsContent>
            )}

            {/* ── Inspections Tab ── */}
            <TabsContent value="inspections" className="mt-3">
              <InspectionsTab propertyId={property.id} />
            </TabsContent>

            {/* ── Assignments Tab ── */}
            <TabsContent value="assignments" className="mt-3">
              <AssignmentsTab propertyId={property.id} />
            </TabsContent>

            {/* ── Photos Tab ── */}
            <TabsContent value="photos" className="mt-3">
              <PhotosTab propertyId={property.id} />
            </TabsContent>

            {/* ── Supplies Tab ── */}
            <TabsContent value="supplies" className="mt-3">
              <SuppliesTab propertyId={property.id} />
            </TabsContent>
          </Tabs>
        )}

        {/* Footer */}
        <DialogFooter className="flex items-center gap-2 pt-2">
          {sourceContext === 'pipeline' && (
            <Button variant="outline" size="sm" onClick={handleViewInContext} className="mr-auto">
              View in Pipeline
            </Button>
          )}
          {isEditing && canEdit ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => saveEdits()} disabled={saving} data-testid="modal-save-btn">
                {saving ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Saving…</> : 'Save Changes'}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={closePropertyModal}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
