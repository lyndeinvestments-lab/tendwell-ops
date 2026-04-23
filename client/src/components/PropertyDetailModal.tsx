import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, STAGE_COLORS, logPropertyEdit, logActivity } from '@/lib/supabase'
import { useAuth, canAccessView, canEditView } from '@/lib/auth'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { useLocation } from 'wouter'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Pencil, X, Loader2, Copy, Check, Users, ExternalLink, CheckCircle2, Circle, Plus } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts'

// ── Access code cell (always visible, click to copy) ────────────────────────
function RevealCell({ value }: { value: string | null; field: string; id: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    if (!value) return
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (!value) return <span className="text-muted-foreground text-xs">—</span>

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-mono">{value}</span>
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
function VerificationHistory({ propertyId }: { propertyId: string }) {
  const { data: verifications, isLoading } = useQuery({
    queryKey: ['/supabase/property-verifications-history', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_verifications')
        .select('*')
        .eq('property_id', propertyId)
        .order('verified_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  if (isLoading) return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
  if (!verifications?.length) return <p className="text-sm text-muted-foreground text-center py-6">No verifications completed yet.</p>

  return (
    <div className="space-y-2">
      {verifications.map((v: any) => (
        <div key={v.id} className="rounded-md border border-border p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium">{new Date(v.verified_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <span className="text-muted-foreground">{v.verified_by || '—'}</span>
          </div>
          {v.fields_updated && Object.keys(v.fields_updated).length > 0 && (
            <p className="text-muted-foreground mt-1">{Object.keys(v.fields_updated).length} field(s) updated</p>
          )}
          {v.notes && <p className="text-muted-foreground mt-1">{v.notes}</p>}
        </div>
      ))}
    </div>
  )
}

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
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
          const path = `inspections/${propertyId}/${Date.now()}_${safeName}`
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
                  className="bg-background/90 text-foreground p-1.5 rounded text-xs hover:bg-background"
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

// ── Financials Enhancement: Profit History + Per-property breakdown ──
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

  const ce = Number(property.ce_charged || 0)
  const pay = Number(property.cleaner_pay || 0)
  const laundry = Number(property.est_laundry || 0)
  const consumables = Number(property.est_consumables || 0)
  const inspection = Number(property.inspection_cost ?? 15)
  const trash = Number(property.trash_cost ?? 5)
  const totalCost = pay + laundry + consumables + inspection + trash
  const profit = ce - totalCost
  const profitPct = ce > 0 ? (profit / ce) * 100 : 0
  const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const breakdownRows: Array<{ label: string; value: string; color?: string }> = [
    { label: 'Client Charged', value: fmt(ce) },
    { label: 'Cleaner Pay', value: fmt(pay) },
    { label: 'Laundry', value: fmt(laundry) },
    { label: 'Consumables', value: fmt(consumables) },
    { label: 'Inspection', value: fmt(inspection) },
    { label: 'Trash', value: fmt(trash) },
    { label: 'Total Cost', value: fmt(totalCost) },
    { label: 'Profit', value: fmt(profit), color: profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400' },
    { label: 'Profit %', value: `${profitPct.toFixed(1)}%`, color: profitPct < 0 ? 'text-red-600 dark:text-red-400' : profitPct < 15 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400' },
    { label: 'DC Cost', value: property.estimated_deep_clean_cost != null ? fmt(Number(property.estimated_deep_clean_cost)) : '—' },
    { label: 'DC Income (3x)', value: property.deep_clean_3x_ce != null ? fmt(Number(property.deep_clean_3x_ce)) : '—' },
    { label: 'DC Profit', value: property.profit_deep_clean != null ? fmt(Number(property.profit_deep_clean)) : '—', color: Number(property.profit_deep_clean || 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400' },
  ]

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

      <div className="space-y-1">
        <span className="text-xs text-muted-foreground block">Breakdown</span>
        <div className="grid grid-cols-1 gap-1">
          {breakdownRows.map(row => (
            <div key={row.label} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1.5">
              <span className="text-muted-foreground">{row.label}</span>
              <span className={`tabular-nums font-medium ${row.color || ''}`}>{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Editable field groups ─────────────────────────────────────────────────────
const LINEN_FIELD_KEYS = [
  'king_beds', 'queen_beds', 'full_beds', 'twin_beds',
  'bath_towels', 'washcloths', 'hand_towels', 'bathmats', 'pool_towels',
] as const
const ACCESS_FIELD_KEYS = ['auto_code', 'door_code', 'other_codes', 'wifi_info'] as const
const AC_FIELD_KEYS = ['filter_size', 'last_filter_changed'] as const

function buildFormFromProperty(property: any): Record<string, any> {
  const form: Record<string, any> = {
    address: property.address || '',
    bedrooms: property.bedrooms ?? '',
    full_baths: property.full_baths ?? '',
    square_footage: property.square_footage ?? '',
    guest_count: property.guest_count ?? '',
    ce_charged: property.ce_charged ?? '',
    cleaner_pay: property.cleaner_pay ?? '',
    notes: property.notes || '',
    linen_notes: property.linen_notes || '',
  }
  for (const k of LINEN_FIELD_KEYS) form[k] = property[k] ?? ''
  for (const k of ACCESS_FIELD_KEYS) form[k] = property[k] || ''
  form.filter_size = property.filter_size || ''
  form.last_filter_changed = property.last_filter_changed ? String(property.last_filter_changed).slice(0, 10) : ''
  return form
}

// ── Main component ────────────────────────────────────────────────────────────
export function PropertyDetailModal() {
  const { modalState, closePropertyModal } = usePropertyModal()
  const { user, effectiveUser } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState<Record<string, any>>({})
  const [inlineField, setInlineField] = useState<string | null>(null)
  const [inlineValue, setInlineValue] = useState('')
  const [savingMissing, setSavingMissing] = useState(false)

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
      toast({ title: 'Client updated' })
      setContactPopoverOpen(false)
    },
    onError: () => toast({ title: 'Failed to update client', variant: 'destructive' }),
  })

  // Reset form when property changes
  useEffect(() => {
    if (property) {
      setForm(buildFormFromProperty(property))
      setIsEditing(false)
    }
  }, [property?.id])

  const { mutate: saveEdits, isPending: saving } = useMutation({
    mutationFn: async () => {
      const updates: Record<string, any> = {}
      if (canEditProperty) {
        updates.address = form.address || null
        updates.bedrooms = form.bedrooms !== '' ? parseFloat(String(form.bedrooms)) : null
        updates.full_baths = form.full_baths !== '' ? parseFloat(String(form.full_baths)) : null
        updates.square_footage = form.square_footage !== '' ? parseFloat(String(form.square_footage)) : null
        updates.guest_count = form.guest_count !== '' ? parseFloat(String(form.guest_count)) : null
        updates.notes = form.notes || null
      }
      if (canEditFinancials) {
        updates.ce_charged = form.ce_charged !== '' ? parseFloat(String(form.ce_charged)) : null
        updates.cleaner_pay = form.cleaner_pay !== '' ? parseFloat(String(form.cleaner_pay)) : null
      }
      if (canEditAccess) {
        for (const k of ACCESS_FIELD_KEYS) updates[k] = form[k] || null
      }
      if (canEditLinens) {
        for (const k of LINEN_FIELD_KEYS) {
          updates[k] = form[k] !== '' ? parseFloat(String(form[k])) : null
        }
        updates.linen_notes = form.linen_notes || null
      }
      if (canEditAC) {
        updates.filter_size = form.filter_size || null
        updates.last_filter_changed = form.last_filter_changed || null
      }
      if (Object.keys(updates).length === 0) return
      const { error } = await supabase.from('properties').update(updates).eq('id', propertyId!)
      if (error) throw error
    },
    onSuccess: () => {
      // Log each changed field to activity_log
      const changedFields: string[] = []
      if (canEditProperty) changedFields.push('address', 'bedrooms', 'full_baths', 'square_footage', 'guest_count', 'notes')
      if (canEditFinancials) changedFields.push('ce_charged', 'cleaner_pay')
      if (canEditAccess) changedFields.push(...ACCESS_FIELD_KEYS)
      if (canEditLinens) changedFields.push(...LINEN_FIELD_KEYS, 'linen_notes')
      if (canEditAC) changedFields.push(...AC_FIELD_KEYS)
      for (const field of changedFields) {
        const oldVal = property?.[field] ?? null
        const newVal = form[field] !== '' ? form[field] : null
        if (String(oldVal ?? '') !== String(newVal ?? '')) {
          logPropertyEdit(propertyId!, field, oldVal, newVal, property?.name ?? null, user?.label ?? null)
        }
      }
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
      const numFields = ['bedrooms', 'full_baths', 'square_footage', 'guest_count', 'ce_charged', 'cleaner_pay', ...LINEN_FIELD_KEYS]
      const dbValue = numFields.includes(field) ? (value !== '' ? parseFloat(String(value)) : null) : (value || null)
      const { error } = await supabase.from('properties').update({ [field]: dbValue }).eq('id', propertyId!)
      if (error) throw error
      return { field, dbValue }
    },
    onSuccess: (result) => {
      const { field, dbValue } = result as { field: string; dbValue: any }
      logPropertyEdit(
        propertyId!,
        field,
        property?.[field] ?? null,
        dbValue ?? null,
        property?.name ?? null,
        user?.label ?? null,
      )
      qc.invalidateQueries({ queryKey: ['/supabase/property-detail', propertyId] })
      qc.invalidateQueries({ queryKey: ['/supabase/properties'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      qc.invalidateQueries({ queryKey: ['/supabase/master-list'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      toast({ title: 'Saved' })
      setInlineField(null)
    },
    onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
  })

  function startInlineEdit(field: string, currentValue: any, allowed: boolean = canEditProperty) {
    if (!allowed || isEditing) return
    setInlineField(field)
    setInlineValue(String(currentValue ?? ''))
  }

  function commitInlineEdit(field: string) {
    saveInlineField({ field, value: inlineValue })
  }

  const canEditProperty = canEditView('property-list', effectiveUser) || canEditView('master-list', effectiveUser)
  const canEditFinancials = canEditView('cost-tracking', effectiveUser)
  const canEditAccess = canEditView('access-codes', effectiveUser)
  const canEditLinens = canEditView('linen-tracker', effectiveUser)
  const canEditAC = canEditView('ac-filters', effectiveUser)
  const canEdit = canEditProperty || canEditFinancials || canEditAccess || canEditLinens || canEditAC
  const canViewFinancials = canAccessView('cost-tracking', effectiveUser) || canAccessView('financial-dashboard', effectiveUser)
  const canViewAccess = canAccessView('access-codes', effectiveUser)
  const canViewAssignments = canAccessView('cleaners', effectiveUser)
  const canViewVerification = canAccessView('inspections', effectiveUser)

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
                  onClick={() => { setIsEditing(false); if (property) setForm(buildFormFromProperty(property)) }}
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
        ) : sourceContext === 'dashboard-missing' && highlightFields.length > 0 ? (
          /* ── Focused Missing Data Form ── */
          <div className="mt-3 space-y-4">
            <p className="text-xs text-muted-foreground">Fill in the missing fields below:</p>
            <div className="space-y-3">
              {highlightFields.map(field => {
                const fieldConfig: Record<string, { label: string; type: string }> = {
                  address: { label: 'Address', type: 'text' },
                  bedrooms: { label: 'Bedrooms', type: 'number' },
                  full_baths: { label: 'Full Baths', type: 'number' },
                  half_baths: { label: 'Half Baths', type: 'number' },
                  square_footage: { label: 'Square Footage', type: 'number' },
                  guest_count: { label: 'Guest Count', type: 'number' },
                  ce_charged: { label: 'Client Charged ($)', type: 'number' },
                  cleaner_pay: { label: 'Cleaner Pay ($)', type: 'number' },
                  number_of_beds: { label: 'Number of Beds', type: 'number' },
                }
                const config = fieldConfig[field] || { label: field, type: 'text' }
                return (
                  <div key={field} className="grid grid-cols-[120px_1fr] items-center gap-2">
                    <Label className="text-xs text-muted-foreground">{config.label}</Label>
                    <Input
                      type={config.type}
                      value={form[field] ?? ''}
                      onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                      className="h-8 text-sm"
                      autoFocus={highlightFields[0] === field}
                      step={config.type === 'number' ? '0.01' : undefined}
                    />
                  </div>
                )
              })}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={closePropertyModal}>Cancel</Button>
              <Button
                size="sm"
                disabled={savingMissing}
                onClick={async () => {
                  setSavingMissing(true)
                  const updates: Record<string, any> = {}
                  for (const field of highlightFields) {
                    const val = form[field]
                    if (val !== '' && val != null) {
                      updates[field] = ['bedrooms', 'full_baths', 'half_baths', 'square_footage', 'guest_count', 'ce_charged', 'cleaner_pay', 'number_of_beds'].includes(field) ? parseFloat(val) : val
                    }
                  }
                  if (Object.keys(updates).length === 0) { setSavingMissing(false); return }
                  const { error } = await supabase.from('properties').update(updates).eq('id', property.id)
                  setSavingMissing(false)
                  if (error) {
                    toast({ title: 'Save failed', variant: 'destructive' })
                  } else {
                    toast({ title: 'Missing data filled in' })
                    qc.invalidateQueries({ queryKey: ['/supabase/property-detail'] })
                    qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
                    closePropertyModal()
                  }
                }}
              >
                {savingMissing ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="overview" className="mt-2">
            <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
              <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
              {sourceContext !== 'property-list' && canViewFinancials && <TabsTrigger value="financials" className="text-xs">Financials</TabsTrigger>}
              <TabsTrigger value="operations" className="text-xs">Operations</TabsTrigger>
              {sourceContext !== 'property-list' && canViewAccess && <TabsTrigger value="setup" className="text-xs">Access</TabsTrigger>}
              <TabsTrigger value="notes" className="text-xs">Notes</TabsTrigger>
              {canViewVerification && <TabsTrigger value="inspections" className="text-xs">Verification</TabsTrigger>}
              <TabsTrigger value="photos" className="text-xs">Photos</TabsTrigger>
            </TabsList>

            {/* ── Overview Tab ── */}
            <TabsContent value="overview" className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Stage', field: '_stage', value: stageName, editable: false },
                ].map(row => (
                  <div key={row.field}>
                    <span className="text-xs text-muted-foreground block mb-0.5">{row.label}</span>
                    <span className="text-sm">{row.value}</span>
                  </div>
                ))}
              </div>
              {/* Client */}
              <div>
                <Label className="text-xs text-muted-foreground">Client</Label>
                <div className="mt-0.5 flex items-center gap-2">
                  {linkedContact ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Users className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium">{linkedContact.full_name}</span>
                      {linkedContact.company && <span className="text-xs text-muted-foreground">({linkedContact.company})</span>}
                      {linkedContact.payment_method && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">{linkedContact.payment_method}</span>
                      )}
                      {canEditProperty && (
                        <button onClick={() => linkContact(null)} className="text-muted-foreground hover:text-destructive ml-1" title="Unlink client">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ) : canEditProperty ? (
                    <Popover open={contactPopoverOpen} onOpenChange={setContactPopoverOpen}>
                      <PopoverTrigger asChild>
                        <button className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-dashed border-border hover:border-primary/40">
                          Assign client…
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-2" align="start">
                        <Input
                          value={contactSearch}
                          onChange={e => setContactSearch(e.target.value)}
                          placeholder="Search clients…"
                          className="h-7 text-xs mb-2"
                          autoFocus
                        />
                        <div className="max-h-40 overflow-y-auto space-y-0.5">
                          {filteredContacts.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-2">No clients found</p>
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
                  {isEditing && canEditProperty ? (
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
                    <p className={`text-sm mt-0.5 ${canEditProperty ? 'cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors' : ''}`}
                       onClick={() => startInlineEdit('address', property.address, canEditProperty)}>
                      {property.address || '—'}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {([
                  { label: 'Bedrooms', field: 'bedrooms', value: property.bedrooms, editable: true },
                  { label: 'Baths', field: 'full_baths', value: property.full_baths != null ? `${property.full_baths}${property.half_baths ? `/${property.half_baths}h` : ''}` : null, editable: false },
                  { label: 'Sq Ft', field: 'square_footage', value: property.square_footage?.toLocaleString(), editable: true },
                  { label: 'Guests', field: 'guest_count', value: property.guest_count, editable: true },
                ] as { label: string; field: string; value: any; editable: boolean }[]).map(row => (
                  <div key={row.field}>
                    <Label className="text-xs text-muted-foreground">{row.label}</Label>
                    {isEditing && canEditProperty && row.editable !== false && row.field !== 'full_baths' ? (
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
                      <p className={`text-sm mt-0.5 ${highlightFields.includes(row.field) && isEditing ? 'text-destructive' : ''} ${canEditProperty && row.editable !== false ? 'cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors' : ''}`}
                         onClick={() => row.editable !== false && startInlineEdit(row.field, property[row.field], canEditProperty)}>
                        {row.value ?? '—'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {/* Cleaner Pay — shown in property-list context */}
              {sourceContext === 'property-list' && canViewFinancials && (
                <div className="bg-muted/40 rounded-md p-3">
                  <span className="text-xs text-muted-foreground block">Cleaner Pay</span>
                  <span className="text-sm font-medium">{property.cleaner_pay ? `$${Number(property.cleaner_pay).toFixed(2)}` : '—'}</span>
                </div>
              )}
            </TabsContent>

            {/* ── Financials Tab ── */}
            {canViewFinancials && (
              <TabsContent value="financials" className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { label: 'Client Charged', field: 'ce_charged', value: property.ce_charged, target: 0.14 },
                    { label: 'Cleaner Pay', field: 'cleaner_pay', value: property.cleaner_pay, target: 0.07 },
                  ] as { label: string; field: string; value: any; target: number }[]).map(row => {
                    const editingThisField = isEditing && canEditFinancials
                    const liveValue = editingThisField
                      ? (form[row.field] !== '' && form[row.field] != null ? Number(form[row.field]) : null)
                      : inlineField === row.field
                        ? (inlineValue !== '' ? Number(inlineValue) : null)
                        : (row.value != null ? Number(row.value) : null)
                    const sqft = Number(property.square_footage || 0)
                    const pricePerSqft = sqft > 0 && liveValue != null && !Number.isNaN(liveValue)
                      ? liveValue / sqft
                      : null
                    // 10% tolerance band: still green if within 10% of target on the worse side
                    const TOLERANCE = 0.1
                    const meetsTarget = pricePerSqft == null ? null :
                      row.field === 'ce_charged'
                        ? pricePerSqft >= row.target * (1 - TOLERANCE)
                        : pricePerSqft <= row.target * (1 + TOLERANCE)
                    const pctCls = meetsTarget == null ? 'text-muted-foreground'
                      : meetsTarget ? 'text-green-600 dark:text-green-400' : 'text-destructive'
                    return (
                      <div key={row.field}>
                        <Label className="text-xs text-muted-foreground">{row.label}</Label>
                        {editingThisField ? (
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
                          <p className={`text-sm mt-0.5 ${canEditFinancials ? 'cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors' : ''}`}
                             onClick={() => startInlineEdit(row.field, row.value, canEditFinancials)}>
                            {row.value != null ? `$${Number(row.value).toFixed(2)}` : '—'}
                          </p>
                        )}
                        <p className={`text-[11px] mt-0.5 ${pctCls}`} data-testid={`modal-${row.field}-psf`}>
                          {pricePerSqft != null
                            ? `$${pricePerSqft.toFixed(3)}/sqft · target $${row.target.toFixed(2)}`
                            : sqft > 0
                              ? `— · target $${row.target.toFixed(2)}/sqft`
                              : `target $${row.target.toFixed(2)}/sqft (set sqft)`}
                        </p>
                      </div>
                    )
                  })}
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
                <div className="grid grid-cols-3 gap-3 bg-muted/40 rounded-md p-3">
                  <div>
                    <span className="text-xs text-muted-foreground block">DC Cost</span>
                    <span className="text-sm font-medium">{property.estimated_deep_clean_cost != null ? `$${Number(property.estimated_deep_clean_cost).toFixed(2)}` : '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">DC Income (3x)</span>
                    <span className="text-sm font-medium">{property.deep_clean_3x_ce != null ? `$${Number(property.deep_clean_3x_ce).toFixed(2)}` : '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">DC Profit</span>
                    <span className={`text-sm font-medium ${(property.profit_deep_clean || 0) < 0 ? 'text-destructive' : ''}`}>
                      {property.profit_deep_clean != null ? `$${Number(property.profit_deep_clean).toFixed(2)}` : '—'}
                    </span>
                  </div>
                </div>
                <FinancialsEnhancement property={property} />
              </TabsContent>
            )}

            {/* ── Operations Tab (Linens, AC Filter, Supplies) ── */}
            <TabsContent value="operations" className="mt-3 space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Linens</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {LINEN_COLS.map(col => (
                    <div key={col.key} className="bg-muted/40 rounded p-2">
                      <span className="text-xs text-muted-foreground block">{col.label}</span>
                      {isEditing && canEditLinens ? (
                        <Input
                          type="number"
                          value={form[col.key] ?? ''}
                          onChange={e => setForm(f => ({ ...f, [col.key]: e.target.value }))}
                          className="mt-0.5 h-7 text-xs"
                          data-testid={`modal-input-${col.key}`}
                        />
                      ) : inlineField === col.key ? (
                        <Input
                          autoFocus
                          type="number"
                          value={inlineValue}
                          onChange={e => setInlineValue(e.target.value)}
                          onBlur={() => commitInlineEdit(col.key)}
                          onKeyDown={e => e.key === 'Enter' && commitInlineEdit(col.key)}
                          className="mt-0.5 h-7 text-xs"
                        />
                      ) : (
                        <span
                          className={`text-sm font-medium ${canEditLinens ? 'cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors inline-block' : ''}`}
                          onClick={() => startInlineEdit(col.key, property[col.key], canEditLinens)}
                        >
                          {property[col.key] ?? '—'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-2">
                  <span className="text-xs text-muted-foreground block">Notes</span>
                  {isEditing && canEditLinens ? (
                    <textarea
                      value={form.linen_notes ?? ''}
                      onChange={e => setForm(f => ({ ...f, linen_notes: e.target.value }))}
                      className="mt-0.5 w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      data-testid="modal-input-linen_notes"
                    />
                  ) : (
                    <p className="text-sm mt-0.5">{property.linen_notes || <span className="text-muted-foreground italic">—</span>}</p>
                  )}
                </div>
              </div>
              <Separator />
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">AC Filter</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <span className="text-xs text-muted-foreground block">Filter Size</span>
                    {isEditing && canEditAC ? (
                      <Input
                        value={form.filter_size ?? ''}
                        onChange={e => setForm(f => ({ ...f, filter_size: e.target.value }))}
                        className="mt-0.5 h-7 text-xs"
                        data-testid="modal-input-filter_size"
                      />
                    ) : inlineField === 'filter_size' ? (
                      <Input
                        autoFocus
                        value={inlineValue}
                        onChange={e => setInlineValue(e.target.value)}
                        onBlur={() => commitInlineEdit('filter_size')}
                        onKeyDown={e => e.key === 'Enter' && commitInlineEdit('filter_size')}
                        className="mt-0.5 h-7 text-xs"
                      />
                    ) : (
                      <span
                        className={`text-sm ${canEditAC ? 'cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors inline-block' : ''}`}
                        onClick={() => startInlineEdit('filter_size', property.filter_size, canEditAC)}
                      >
                        {property.filter_size || '—'}
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Last Changed</span>
                    {isEditing && canEditAC ? (
                      <Input
                        type="date"
                        value={form.last_filter_changed ?? ''}
                        onChange={e => setForm(f => ({ ...f, last_filter_changed: e.target.value }))}
                        className="mt-0.5 h-7 text-xs"
                        data-testid="modal-input-last_filter_changed"
                      />
                    ) : (
                      <span className="text-sm">{property.last_filter_changed ? property.last_filter_changed.slice(0, 10) : '—'}</span>
                    )}
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Next Due</span>
                    <span className="text-sm">{property.next_filter_due ? property.next_filter_due.slice(0, 10) : '—'}</span>
                  </div>
                </div>
              </div>
              {/* Access & WiFi — included in operations tab when from property-list */}
              {sourceContext === 'property-list' && canViewAccess && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Access & WiFi</h4>
                    <div className="space-y-2">
                      {ACCESS_FIELD_KEYS.map(k => {
                        const label = { auto_code: 'Auto Code', door_code: 'Door Code', other_codes: 'Other Codes', wifi_info: 'WiFi Info' }[k]
                        return (
                          <div key={k}>
                            <span className="text-xs text-muted-foreground block mb-0.5">{label}</span>
                            {isEditing && canEditAccess ? (
                              <Input
                                value={form[k] ?? ''}
                                onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                                className="mt-0.5 h-7 text-xs"
                                data-testid={`modal-input-${k}`}
                              />
                            ) : inlineField === k ? (
                              <Input
                                autoFocus
                                value={inlineValue}
                                onChange={e => setInlineValue(e.target.value)}
                                onBlur={() => commitInlineEdit(k)}
                                onKeyDown={e => e.key === 'Enter' && commitInlineEdit(k)}
                                className="mt-0.5 h-7 text-xs"
                              />
                            ) : (
                              <span
                                className={`text-sm ${canEditAccess ? 'cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors inline-block' : ''}`}
                                onClick={() => startInlineEdit(k, property[k], canEditAccess)}
                              >
                                {property[k] || '—'}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </TabsContent>

            {/* ── Setup Tab (Access Codes, Onboarding) ── */}
            {canViewAccess && (
              <TabsContent value="setup" className="mt-3 space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Access Codes</h4>
                  <div className="space-y-3">
                    {ACCESS_FIELD_KEYS.map(k => {
                      const label = { auto_code: 'Auto Code', door_code: 'Door Code', other_codes: 'Other Codes', wifi_info: 'WiFi Info' }[k]
                      return (
                        <div key={k}>
                          <span className="text-xs text-muted-foreground block mb-0.5">{label}</span>
                          {isEditing && canEditAccess ? (
                            <Input
                              value={form[k] ?? ''}
                              onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                              className="mt-0.5 h-7 text-xs"
                              data-testid={`modal-input-${k}`}
                            />
                          ) : inlineField === k ? (
                            <Input
                              autoFocus
                              value={inlineValue}
                              onChange={e => setInlineValue(e.target.value)}
                              onBlur={() => commitInlineEdit(k)}
                              onKeyDown={e => e.key === 'Enter' && commitInlineEdit(k)}
                              className="mt-0.5 h-7 text-xs"
                            />
                          ) : canEditAccess ? (
                            <span
                              className="text-sm font-mono cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors inline-block"
                              onClick={() => startInlineEdit(k, property[k], canEditAccess)}
                            >
                              {property[k] || '—'}
                            </span>
                          ) : (
                            <RevealCell value={property[k]} field={k} id={property.id} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
                {stageName === 'Onboarding' && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Onboarding Checklist</h4>
                      <OnboardingChecklist propertyId={property.id} />
                    </div>
                  </>
                )}
              </TabsContent>
            )}

            {/* ── Notes Tab ── */}
            <TabsContent value="notes" className="mt-3">
              {isEditing && canEditProperty ? (
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

            {/* ── Inspections Tab ── */}
            <TabsContent value="inspections" className="mt-3">
              {sourceContext === 'property-list' ? (
                <VerificationHistory propertyId={property.id} />
              ) : (
                <InspectionsTab propertyId={property.id} />
              )}
            </TabsContent>

            {/* ── Assignments Tab ── */}
            {/* ── Photos Tab ── */}
            <TabsContent value="photos" className="mt-3">
              <PhotosTab propertyId={property.id} />
            </TabsContent>

            {/* Supplies is now inside Operations tab */}
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
