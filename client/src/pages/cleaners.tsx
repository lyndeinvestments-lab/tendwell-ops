import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase, logActivity } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { useCleaners, CLEANERS_QUERY_KEY } from '@/hooks/use-cleaners'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { EmptyState } from '@/components/EmptyState'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import {
  DndContext, DragEndEvent, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core'
import { Users2, Plus, Search, X, ChevronLeft, ChevronRight, Download, Trash2, Mail, Loader2, Pencil } from 'lucide-react'
import { sendInviteEmail } from '@/lib/notify'
import { roleBadgeClasses } from '@/lib/role-colors'
import { format as dfFormat, startOfWeek, addDays, isSameDay } from 'date-fns'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import type { TFunc } from '@/lib/i18n/t'

type ViewMode = 'list' | 'calendar' | 'reconciliation'

const CLEANER_COLORS = [
  'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
  'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
]
const LEGEND_DOTS = [
  'bg-blue-500', 'bg-violet-500', 'bg-amber-500', 'bg-emerald-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-orange-500',
]

// Display-only lookup for `clean_assignments.status` — DB stays canonical
// English; unknown statuses fall back to the raw value (mirrors the
// slugify pattern in client/src/lib/issues.ts, kept local to this page).
function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
function assignmentStatusLabel(status: string, t: TFunc): string {
  return t(`calendar.status.${slugify(status)}`, undefined, status)
}

// ── Draggable assignment chip ──────────────────────────────────────────────
function DraggableChip({ assignment, colorClass, fmt, t }: { assignment: any; colorClass: string; fmt: (n: number) => string; t: TFunc }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: assignment.id })
  return (
    <Popover>
      <div ref={setNodeRef} {...listeners} {...attributes} className={`transition-opacity ${isDragging ? 'opacity-30' : ''}`}>
        <PopoverTrigger asChild>
          <button className={`text-xs rounded px-1 py-0.5 truncate w-full text-left cursor-grab active:cursor-grabbing ${colorClass}`}>
            {(assignment.properties as any)?.name?.slice(0, 15) || '—'}
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-48 p-2 text-xs space-y-1">
        <p className="font-medium">{(assignment.properties as any)?.name}</p>
        <p className="text-muted-foreground">{(assignment.properties as any)?.address || t('calendar.noAddress')}</p>
        {assignment.pay_amount && <p>{t('calendar.payLine', { amount: fmt(Number(assignment.pay_amount)) })}</p>}
        <p>{t('calendar.statusLine', { status: assignmentStatusLabel(assignment.status, t) })}</p>
        {assignment.notes && <p className="text-muted-foreground">{assignment.notes}</p>}
      </PopoverContent>
    </Popover>
  )
}

// ── Droppable day cell ─────────────────────────────────────────────────────
function DroppableDayCell({ cellId, children, onAssign, assignLabel }: { cellId: string; children: React.ReactNode; onAssign: () => void; assignLabel: string }) {
  const { isOver, setNodeRef } = useDroppable({ id: cellId })
  return (
    <div
      ref={setNodeRef}
      className={`border-b border-r border-border px-1 py-1 min-h-[52px] transition-colors group relative ${isOver ? 'bg-primary/10' : ''}`}
    >
      {children}
      <button
        onClick={onAssign}
        className="absolute bottom-0.5 right-0.5 opacity-0 group-hover:opacity-100 sm:opacity-0 max-sm:opacity-100 transition-opacity text-xs text-muted-foreground hover:text-primary"
        title={assignLabel}
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  )
}

export default function CleanersPage() {
  usePageTitle('Cleaners')
  const { t, locale } = useLocale('cleaners')
  const { format } = useDateFormat()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { openPropertyModal } = usePropertyModal()
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [detailCleaner, setDetailCleaner] = useState<any>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [reconMonth, setReconMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [newForm, setNewForm] = useState({ full_name: '', phone: '', email: '', pay_rate: '', notes: '', app_role: 'cleaning' as 'cleaning' | 'inspector' })
  const [invitingSendingId, setInvitingSendingId] = useState<string | null>(null)

  // Inline rename on the roster table's name cell
  const [editingNameId, setEditingNameId] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')

  // Inline alt-email edit (secondary email used in Trellis)
  const [editingAltId, setEditingAltId] = useState<string | null>(null)
  const [altDraft, setAltDraft] = useState('')

  // Assign dialog state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Assign dialog state
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignCleanerId, setAssignCleanerId] = useState('')
  const [assignPropertyId, setAssignPropertyId] = useState('')
  const [assignDate, setAssignDate] = useState('')
  const [assignPay, setAssignPay] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const { data: cleaners, isLoading } = useCleaners()

  const { data: assignments } = useQuery({
    queryKey: ['/supabase/all-assignments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clean_assignments')
        .select('*, cleaners(full_name), properties!clean_assignments_property_id_fkey(id, name, address, cleaner_pay)')
        .order('scheduled_date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: activeProps } = useQuery({
    queryKey: ['/supabase/cleaners-active-props'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, cleaner_pay, pipeline_stages!properties_stage_id_fkey(name)')
      if (error) throw error
      return (data || []).filter((p: any) => {
        const sn = (p.pipeline_stages as any)?.name
        return sn === 'Active' || sn === 'Onboarding'
      })
    },
  })

  // Distinct cleaner names from properties (for pre-populating roster)
  const suggestedCleaners = useMemo(() => {
    if (!activeProps) return []
    // Extract unique client-style cleaner identifiers from notes or use property data
    // Since there's no cleaner_name field, suggest based on assignments
    const existingNames = new Set((cleaners || []).map((c: any) => (c.full_name || '').toLowerCase()))
    // Show properties with cleaner_pay that have no assignment yet
    const unassigned = (activeProps || []).filter((p: any) =>
      p.cleaner_pay && p.cleaner_pay > 0 &&
      !(assignments || []).some((a: any) => a.property_id === p.id)
    )
    return unassigned
  }, [activeProps, cleaners, assignments])

  const { mutate: addCleaner, isPending: adding } = useGuardedMutation('cleaners', {
    mutationFn: async () => {
      const { error } = await supabase.from('cleaners').insert({
        full_name: newForm.full_name,
        phone: newForm.phone || null,
        email: newForm.email || null,
        pay_rate: newForm.pay_rate ? parseFloat(newForm.pay_rate) : null,
        notes: newForm.notes || null,
        app_role: newForm.app_role,
      })
      if (error) throw error
      // Create app_users entry so they can sign in immediately
      if (newForm.email.trim()) {
        await supabase.rpc('add_cleaner_app_user', {
          p_email: newForm.email.trim(),
          p_name: newForm.full_name.trim(),
          p_role: newForm.app_role,
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CLEANERS_QUERY_KEY })
      logActivity({
        entity_type: 'cleaner',
        entity_name: newForm.full_name,
        action: 'create',
        new_value: newForm.full_name,
        changed_by: user?.label ?? null,
      })
      toast({ title: t('toasts.cleanerAdded'), description: newForm.email ? t('toasts.cleanerAddedAccountDescription') : undefined })
      setAddOpen(false)
      setNewForm({ full_name: '', phone: '', email: '', pay_rate: '', notes: '', app_role: 'cleaning' })
    },
    onError: (error: any) => toast({ title: t('toasts.addCleanerFailed'), description: error?.message, variant: 'destructive' }),
  })

  const { mutate: renameCleaner } = useGuardedMutation('cleaners', {
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('cleaners').update({ full_name: name }).eq('id', id)
      if (error) throw error
      return { id, name }
    },
    onSuccess: ({ id, name }: { id: string; name: string }) => {
      const oldName = (cleaners || []).find((c: any) => c.id === id)?.full_name ?? null
      qc.invalidateQueries({ queryKey: CLEANERS_QUERY_KEY })
      logActivity({
        entity_type: 'cleaner',
        entity_id: id,
        entity_name: name,
        action: 'update',
        field_name: 'full_name',
        old_value: oldName,
        new_value: name,
        changed_by: user?.label ?? null,
      })
      toast({ title: t('toasts.nameUpdated') })
      setEditingNameId(null)
    },
    onError: (error: any) => toast({ title: t('toasts.renameFailed'), description: error?.message, variant: 'destructive' }),
  })

  const commitRename = (id: string, currentName: string) => {
    const next = nameDraft.trim()
    if (!next || next === currentName) { setEditingNameId(null); return }
    renameCleaner({ id, name: next })
  }

  const { mutate: updateAltEmail } = useGuardedMutation('cleaners', {
    mutationFn: async ({ id, alt }: { id: string; alt: string | null }) => {
      const { error } = await supabase.from('cleaners').update({ alt_email: alt }).eq('id', id)
      if (error) throw error
      return { id, alt }
    },
    onSuccess: ({ id, alt }: { id: string; alt: string | null }) => {
      const row = (cleaners || []).find((c: any) => c.id === id)
      qc.invalidateQueries({ queryKey: CLEANERS_QUERY_KEY })
      logActivity({
        entity_type: 'cleaner',
        entity_id: id,
        entity_name: row?.full_name ?? null,
        action: 'update',
        field_name: 'alt_email',
        old_value: row?.alt_email ?? null,
        new_value: alt,
        changed_by: user?.label ?? null,
      })
      toast({ title: alt ? t('toasts.altEmailSaved') : t('toasts.altEmailCleared') })
      setEditingAltId(null)
    },
    onError: (error: any) => toast({ title: t('toasts.altEmailSaveFailed'), description: error?.message, variant: 'destructive' }),
  })

  const commitAltEmail = (id: string, current: string | null) => {
    const next = altDraft.trim() || null
    if (next === (current ?? null)) { setEditingAltId(null); return }
    updateAltEmail({ id, alt: next })
  }

  const { mutate: addAssignment, isPending: assigning } = useGuardedMutation('cleaners', {
    mutationFn: async () => {
      // NOTE: `pay_amount` is collected from the UI but isn't a column on
      // clean_assignments, so the per-assignment override is dropped here
      // rather than silently swallowed by PostgREST. Reconciliation "Total Pay"
      // is derived from the property's standard cleaner_pay instead (see
      // cleanerStats); add a column + persist this value if per-assignment
      // overrides are ever needed.
      const { error } = await supabase.from('clean_assignments').insert({
        cleaner_id: assignCleanerId,
        property_id: Number(assignPropertyId),
        scheduled_date: assignDate,
        status: 'scheduled',
      })
      if (error) throw error
    },
    onSuccess: () => {
      const cleanerName = (cleaners || []).find((c: any) => c.id === assignCleanerId)?.full_name ?? null
      const propName = (activeProps || []).find((p: any) => String(p.id) === assignPropertyId)?.name ?? null
      logActivity({
        entity_type: 'cleaner',
        entity_id: assignCleanerId,
        entity_name: cleanerName,
        action: 'update',
        field_name: 'assignment',
        new_value: propName ?? assignPropertyId,
        changed_by: user?.label ?? null,
        metadata: { property_id: assignPropertyId, scheduled_date: assignDate, pay_amount: assignPay || null },
      })
      qc.invalidateQueries({ queryKey: ['/supabase/all-assignments'] })
      toast({ title: t('toasts.assignmentAdded') })
      setAssignOpen(false)
      setAssignCleanerId('')
      setAssignPropertyId('')
      setAssignDate('')
      setAssignPay('')
    },
    onError: (error: any) => toast({ title: t('toasts.assignmentAddFailed'), description: error?.message, variant: 'destructive' }),
  })

  const { mutate: moveAssignment } = useGuardedMutation('cleaners', {
    mutationFn: async ({ id, newDate }: { id: string; newDate: string }) => {
      const { error } = await supabase.from('clean_assignments').update({ scheduled_date: newDate }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      logActivity({
        entity_type: 'cleaner',
        entity_id: variables.id,
        action: 'update',
        field_name: 'scheduled_date',
        new_value: variables.newDate,
        changed_by: user?.label ?? null,
        metadata: { assignment_id: variables.id },
      })
      qc.invalidateQueries({ queryKey: ['/supabase/all-assignments'] })
      toast({ title: t('toasts.assignmentMoved') })
    },
    onError: (error: any) => toast({ title: t('toasts.assignmentMoveFailed'), description: error?.message, variant: 'destructive' }),
  })

  const { mutate: deleteCleaner, isPending: deleting } = useGuardedMutation('cleaners', {
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cleaners').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_data, id) => {
      const name = (cleaners || []).find((c: any) => c.id === id)?.full_name ?? null
      logActivity({
        entity_type: 'cleaner',
        entity_id: id,
        entity_name: name,
        action: 'delete',
        changed_by: user?.label ?? null,
      })
      qc.invalidateQueries({ queryKey: CLEANERS_QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['/supabase/all-assignments'] })
      toast({ title: t('toasts.cleanerDeleted') })
      setDeleteConfirmId(null)
      if (detailCleaner?.id === id) setDetailCleaner(null)
    },
    onError: (error: any) => toast({ title: t('toasts.deleteCleanerFailed'), description: error?.message, variant: 'destructive' }),
  })

  const filtered = useMemo(() => {
    if (!cleaners) return []
    if (!search.trim()) return cleaners
    const q = search.toLowerCase()
    return cleaners.filter((c: any) => c.full_name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q) || c.alt_email?.toLowerCase().includes(q))
  }, [cleaners, search])

  // Color map: cleaner index → color
  const cleanerColorMap = useMemo(() => {
    const map: Record<string, number> = {}
    ;(cleaners || []).forEach((c: any, i: number) => { map[c.id] = i % CLEANER_COLORS.length })
    return map
  }, [cleaners])

  // Assignment stats per cleaner.
  //
  // totalPay always evaluates to 0 because clean_assignments.pay_amount
  // doesn't exist in the schema (typed-supabase codegen surfaced this).
  // Pay is derived from each assignment's property cleaner_pay (joined in the
  // query) × the number of cleans — clean_assignments has no per-assignment
  // pay column, so this is the standard per-clean rate for the property.
  const cleanerStats = useMemo(() => {
    const map: Record<string, { total: number; totalPay: number }> = {}
    for (const a of (assignments || [])) {
      if (a.cleaner_id == null) continue
      const cid = a.cleaner_id
      if (!map[cid]) map[cid] = { total: 0, totalPay: 0 }
      map[cid].total++
      map[cid].totalPay += Number((a as any).properties?.cleaner_pay) || 0
    }
    return map
  }, [assignments])

  // Calendar data
  const weekStart = startOfWeek(addDays(new Date(), weekOffset * 7), { weekStartsOn: 1 })
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const calendarAssignments = useMemo(() => {
    if (!assignments) return {} as Record<string, any[]>
    const map: Record<string, any[]> = {}
    for (const a of assignments) {
      const key = `${a.cleaner_id}_${a.scheduled_date}`
      if (!map[key]) map[key] = []
      map[key].push(a)
    }
    return map
  }, [assignments])

  // Reconciliation: cleaner-based for selected month
  const reconciliationData = useMemo(() => {
    if (!cleaners || !assignments) return []
    const currentMonth = reconMonth
    return cleaners.map((c: any) => {
      const monthAssignments = assignments.filter((a: any) =>
        String(a.cleaner_id) === String(c.id) && a.scheduled_date?.startsWith(currentMonth)
      )
      const totalPay = monthAssignments.reduce((s: number, a: any) => s + Number(a.pay_amount || 0), 0)
      const avgPay = monthAssignments.length > 0 ? totalPay / monthAssignments.length : 0
      return { ...c, cleans: monthAssignments.length, totalPay, avgPay }
    }).sort((a: any, b: any) => b.cleans - a.cleans)
  }, [cleaners, assignments, reconMonth])

  function fmt(n: number) { return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

  function exportReconciliation() {
    if (!reconciliationData || reconciliationData.length === 0) return
    const headers = [
      t('reconciliation.csv.cleaner'), t('reconciliation.csv.status'), t('reconciliation.csv.payRate'),
      t('reconciliation.csv.cleansThisMonth'), t('reconciliation.csv.totalPay'), t('reconciliation.csv.avgPayPerClean'),
      t('reconciliation.csv.expectedPay'),
    ]
    const rows = reconciliationData.map((c: any) => {
      const expected = c.pay_rate && c.cleans > 0 ? c.pay_rate * c.cleans : null
      return [
        c.full_name || '',
        c.is_active ? t('table.statusActive') : t('table.statusInactive'),
        c.pay_rate ?? '',
        c.cleans,
        c.totalPay > 0 ? c.totalPay.toFixed(2) : '',
        c.avgPay > 0 ? c.avgPay.toFixed(2) : '',
        expected != null ? expected.toFixed(2) : '',
      ]
    })
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cleaner-reconciliation-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function openAssign(cleanerId: string, dateStr: string) {
    setAssignCleanerId(cleanerId)
    setAssignDate(dateStr)
    setAssignPropertyId('')
    setAssignPay('')
    setAssignOpen(true)
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over) return
    // over.id = "cell_{cleanerId}_{dateStr}"
    const parts = String(over.id).split('_')
    if (parts.length < 3 || parts[0] !== 'cell') return
    const newDate = parts.slice(2).join('_') // handles date like 2026-03-24
    moveAssignment({ id: String(active.id), newDate })
  }

  const activeCleaners = (cleaners || []).filter((c: any) => c.is_active)

  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center border rounded-md overflow-hidden">
              {(['list', 'calendar', 'reconciliation'] as ViewMode[]).map(v => (
                <button
                  key={v}
                  onClick={() => setViewMode(v)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${viewMode === v ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
                >
                  {v === 'list' ? t('page.tabRoster') : v === 'calendar' ? t('page.tabCalendar') : <><span className="sm:hidden">{t('page.tabReconciliationShort')}</span><span className="hidden sm:inline">{t('page.tabReconciliation')}</span></>}
                </button>
              ))}
            </div>
            {viewMode === 'list' && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  type="search" placeholder={t('page.searchPlaceholder')} value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 pr-8 h-8 w-full sm:w-56 text-sm"
                />
                {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2"><X className="w-3.5 h-3.5" /></button>}
              </div>
            )}
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> {t('page.addCleaner')}
            </Button>
          </div>
        }
      />

      {/* Roster View */}
      {viewMode === 'list' && (
        <div className="overflow-auto flex-1 rounded-2xl border border-border shadow-sm">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('table.name')}</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('table.phone')}</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('table.email')}</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('table.altEmail')}</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('table.role')}</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('table.payRate')}</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('table.assignments')}</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('table.avgPay')}</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('table.status')}</th>
                <th className="py-2 px-3 w-16" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(5)].map((_, i) => <tr key={i} className="border-b border-border/50">{[...Array(9)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}</tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10}>
                  <EmptyState
                    icon={Users2}
                    title={t('page.emptyTitle')}
                    description={`${t('page.emptyDescription')}${suggestedCleaners.length > 0 ? ` ${t('page.emptySuggestedCleaners', { count: suggestedCleaners.length })}` : ''}`}
                  />
                </td></tr>
              ) : (
                filtered.map((c: any) => {
                  const stats = cleanerStats[c.id] || { total: 0, totalPay: 0 }
                  const avgPay = stats.total > 0 ? stats.totalPay / stats.total : 0
                  return (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer group" onClick={() => setDetailCleaner(c)}>
                      <td className="py-2 px-3 font-medium text-xs" onClick={e => e.stopPropagation()}>
                        {editingNameId === c.id ? (
                          <Input
                            value={nameDraft}
                            autoFocus
                            onChange={e => setNameDraft(e.target.value)}
                            onBlur={() => commitRename(c.id, c.full_name)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitRename(c.id, c.full_name)
                              if (e.key === 'Escape') setEditingNameId(null)
                            }}
                            className="h-6 text-xs w-40"
                            data-testid={`input-rename-cleaner-${c.id}`}
                          />
                        ) : (
                          <button
                            type="button"
                            className="flex items-center gap-1 group/name text-left"
                            onClick={() => { setEditingNameId(c.id); setNameDraft(c.full_name ?? '') }}
                            title={t('table.clickToRename')}
                            data-testid={`button-rename-cleaner-${c.id}`}
                          >
                            {c.full_name}
                            <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover/name:opacity-100 transition-opacity" />
                          </button>
                        )}
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{c.phone || '—'}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{c.email || '—'}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground" onClick={e => e.stopPropagation()}>
                        {editingAltId === c.id ? (
                          <Input
                            value={altDraft}
                            autoFocus
                            placeholder={t('table.altEmailPlaceholder')}
                            onChange={e => setAltDraft(e.target.value)}
                            onBlur={() => commitAltEmail(c.id, c.alt_email ?? null)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitAltEmail(c.id, c.alt_email ?? null)
                              if (e.key === 'Escape') setEditingAltId(null)
                            }}
                            className="h-6 text-xs w-44"
                            data-testid={`input-alt-email-${c.id}`}
                          />
                        ) : (
                          <button
                            type="button"
                            className="flex items-center gap-1 group/alt text-left"
                            onClick={() => { setEditingAltId(c.id); setAltDraft(c.alt_email ?? '') }}
                            title={t('table.altEmailTooltip')}
                            data-testid={`button-alt-email-${c.id}`}
                          >
                            {c.alt_email || '—'}
                            <Pencil className="w-3 h-3 opacity-0 group-hover/alt:opacity-100 transition-opacity" />
                          </button>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        {c.app_role ? (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${roleBadgeClasses(c.app_role === 'inspector' ? 'inspector' : 'cleaner')}`}>
                            {c.app_role === 'inspector' ? t('table.roleInspector') : t('table.roleCleaner')}
                          </span>
                        ) : <span className="text-xs text-muted-foreground">-</span>}
                      </td>
                      <td className="py-2 px-3 text-xs tabular-nums">{c.pay_rate ? fmt(c.pay_rate) : '—'}</td>
                      <td className="py-2 px-3 text-xs tabular-nums">{stats.total}</td>
                      <td className="py-2 px-3 text-xs tabular-nums">{avgPay > 0 ? fmt(avgPay) : '—'}</td>
                      <td className="py-2 px-3">
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${c.is_active ? 'text-success bg-success/10 border-success/25' : 'text-muted-foreground bg-muted border-border'}`}>
                          {c.is_active ? t('table.statusActive') : t('table.statusInactive')}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {c.email && (
                            <button
                              disabled={invitingSendingId === c.id}
                              onClick={async () => {
                                setInvitingSendingId(c.id)
                                const result = await sendInviteEmail(c.email, c.full_name)
                                setInvitingSendingId(null)
                                if (result.ok) {
                                  await supabase.from('cleaners').update({ invite_sent_at: new Date().toISOString() }).eq('id', c.id)
                                  qc.invalidateQueries({ queryKey: CLEANERS_QUERY_KEY })
                                  toast({ title: t('toasts.inviteSent'), description: t('toasts.inviteSentDescription', { email: c.email }) })
                                } else {
                                  toast({ title: t('toasts.inviteFailed'), description: result.error, variant: 'destructive' })
                                }
                              }}
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors px-1.5 py-0.5 rounded border border-transparent hover:border-border"
                              title={c.invite_sent_at ? t('table.resendInviteTooltip', { date: new Date(c.invite_sent_at).toLocaleDateString(locale === 'es' ? 'es' : 'en-US') }) : t('table.sendInviteTooltip')}
                            >
                              {invitingSendingId === c.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Mail className="w-3 h-3" />}
                              <span className="hidden sm:inline">{c.invite_sent_at ? t('table.resend') : t('table.invite')}</span>
                            </button>
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); setDeleteConfirmId(c.id) }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                            title={t('table.deleteTooltip')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Calendar View */}
      {viewMode === 'calendar' && (
        <div className="overflow-auto flex-1">
          <div className="flex items-center justify-between mb-3">
            <Button variant="outline" size="sm" onClick={() => setWeekOffset(w => w - 1)}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-sm font-medium">{format(weekStart, 'MMM d')} - {format(addDays(weekStart, 6), 'MMM d, yyyy')}</span>
            <Button variant="outline" size="sm" onClick={() => setWeekOffset(w => w + 1)}><ChevronRight className="w-4 h-4" /></Button>
          </div>

          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="border border-border rounded-2xl shadow-sm overflow-auto">
              <div className="grid" style={{ gridTemplateColumns: '150px repeat(7, 1fr)', minWidth: '900px' }}>
                <div className="bg-muted/60 border-b border-r border-border px-2 py-1.5 text-xs font-medium text-muted-foreground sticky left-0 z-20">{t('calendar.cleanerColumn')}</div>
                {weekDays.map(d => (
                  <div key={d.toISOString()} className={`bg-muted/60 border-b border-r border-border px-2 py-1.5 text-xs font-medium text-center ${isSameDay(d, new Date()) ? 'text-primary' : 'text-muted-foreground'}`}>
                    {format(d, 'EEE M/d')}
                  </div>
                ))}
                {activeCleaners.map((c: any) => (
                  <React.Fragment key={c.id}>
                    <div className="border-b border-r border-border px-2 py-1.5 text-xs font-medium truncate flex items-center gap-1.5 sticky left-0 z-10 bg-background">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${LEGEND_DOTS[cleanerColorMap[c.id] ?? 0]}`} />
                      {c.full_name}
                    </div>
                    {weekDays.map(d => {
                      const dateStr = dfFormat(d, 'yyyy-MM-dd')
                      const dayAssignments = calendarAssignments[`${c.id}_${dateStr}`] || []
                      const cellId = `cell_${c.id}_${dateStr}`
                      return (
                        <DroppableDayCell
                          key={cellId}
                          cellId={cellId}
                          onAssign={() => openAssign(c.id, dateStr)}
                          assignLabel={t('calendar.assignTooltip')}
                        >
                          {dayAssignments.map((a: any) => (
                            <DraggableChip
                              key={a.id}
                              assignment={a}
                              colorClass={CLEANER_COLORS[cleanerColorMap[c.id] ?? 0]}
                              fmt={fmt}
                              t={t}
                            />
                          ))}
                        </DroppableDayCell>
                      )
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </DndContext>

          {/* Color legend */}
          {activeCleaners.length > 0 && (
            <div className="flex flex-wrap gap-3 mt-3">
              {activeCleaners.map((c: any) => (
                <div key={c.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={`w-2.5 h-2.5 rounded-full ${LEGEND_DOTS[cleanerColorMap[c.id] ?? 0]}`} />
                  {c.full_name}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reconciliation View — cleaner-based */}
      {viewMode === 'reconciliation' && (
        <div className="space-y-3 flex-1 flex flex-col">
          {/* Summary KPIs */}
          {reconciliationData.length > 0 && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <Input
                type="month"
                value={reconMonth}
                onChange={e => setReconMonth(e.target.value)}
                className="h-7 w-40 text-xs"
                aria-label={t('reconciliation.monthAriaLabel')}
              />
              <span>{t('reconciliation.totalCleans')}: <strong className="text-foreground">{reconciliationData.reduce((s: number, c: any) => s + c.cleans, 0)}</strong></span>
              <span>{t('reconciliation.totalPay')}: <strong className="text-foreground">{fmt(reconciliationData.reduce((s: number, c: any) => s + c.totalPay, 0))}</strong></span>
              <span>{t('reconciliation.activeCleaners')}: <strong className="text-foreground">{reconciliationData.filter((c: any) => c.is_active && c.cleans > 0).length}</strong></span>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs ml-auto" onClick={exportReconciliation}>
                <Download className="w-3 h-3" /> {t('common.actions.exportCsv')}
              </Button>
            </div>
          )}
          <div className="overflow-auto flex-1 rounded-2xl border border-border shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('reconciliation.table.cleaner')}</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('reconciliation.table.status')}</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('reconciliation.table.payRate')}</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('reconciliation.table.cleansThisMonth')}</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('reconciliation.table.totalPay')}</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('reconciliation.table.avgPayPerClean')}</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('reconciliation.table.expected')}</th>
                </tr>
              </thead>
              <tbody>
                {reconciliationData.length === 0 ? (
                  <tr><td colSpan={7}><EmptyState icon={Users2} title={t('page.emptyTitle')} description={t('reconciliation.emptyDescription')} /></td></tr>
                ) : (
                  reconciliationData.map((c: any) => {
                    const expected = c.pay_rate && c.cleans > 0 ? c.pay_rate * c.cleans : null
                    const diff = expected && c.totalPay > 0 ? c.totalPay - expected : null
                    return (
                      <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setDetailCleaner(c)}>
                        <td className="py-2 px-3 font-medium text-xs">{c.full_name}</td>
                        <td className="py-2 px-3">
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${c.is_active ? 'text-success bg-success/10 border-success/25' : 'text-muted-foreground bg-muted border-border'}`}>
                            {c.is_active ? t('table.statusActive') : t('table.statusInactive')}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-xs tabular-nums">{c.pay_rate ? fmt(c.pay_rate) : '—'}</td>
                        <td className="py-2 px-3 text-xs tabular-nums font-medium">{c.cleans}</td>
                        <td className="py-2 px-3 text-xs tabular-nums">{c.totalPay > 0 ? fmt(c.totalPay) : '—'}</td>
                        <td className="py-2 px-3 text-xs tabular-nums">{c.avgPay > 0 ? fmt(c.avgPay) : '—'}</td>
                        <td className="py-2 px-3 text-xs tabular-nums">
                          {expected ? (
                            <span>
                              {fmt(expected)}
                              {diff != null && Math.abs(diff) > 0.01 && (
                                <span className={`ml-1 ${diff > 0 ? 'text-destructive' : 'text-success'}`}>
                                  ({diff > 0 ? '+' : ''}{fmt(diff)})
                                </span>
                              )}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Cleaner Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('invite.addCleanerTitle')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('invite.fullName')}</label>
              <Input value={newForm.full_name} onChange={e => setNewForm(f => ({ ...f, full_name: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">{t('invite.role')}</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setNewForm(f => ({ ...f, app_role: 'cleaning' }))}
                  className={`h-10 rounded-md border-2 text-sm font-medium transition-colors ${newForm.app_role === 'cleaning' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/40'}`}
                >
                  {t('table.roleCleaner')}
                </button>
                <button
                  type="button"
                  onClick={() => setNewForm(f => ({ ...f, app_role: 'inspector' }))}
                  className={`h-10 rounded-md border-2 text-sm font-medium transition-colors ${newForm.app_role === 'inspector' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/40'}`}
                >
                  {t('table.roleInspector')}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('invite.phone')}</label>
                <Input value={newForm.phone} onChange={e => setNewForm(f => ({ ...f, phone: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('invite.email')}</label>
                <Input value={newForm.email} onChange={e => setNewForm(f => ({ ...f, email: e.target.value }))} className="mt-1" placeholder={t('invite.emailPlaceholder')} />
              </div>
            </div>
            <p className="text-2xs text-muted-foreground -mt-1">
              {t('invite.emailAccessHint')}
            </p>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('invite.payRate')}</label>
              <Input type="number" step="0.01" value={newForm.pay_rate} onChange={e => setNewForm(f => ({ ...f, pay_rate: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('invite.notes')}</label>
              <Input value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} className="mt-1" />
            </div>
            {newForm.email && (
              <p className="text-xs text-muted-foreground">{t('invite.accountWillBeCreatedHint')}</p>
            )}
          </div>
          <DialogFooter>
            <Button size="sm" disabled={!newForm.full_name.trim() || adding} onClick={() => addCleaner()}>
              {adding ? t('invite.adding') : t('invite.addCleanerTitle')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={assignOpen} onOpenChange={v => !v && setAssignOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('invite.assignTitle')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('invite.cleanerLabel')}</label>
              <select
                value={assignCleanerId}
                onChange={e => setAssignCleanerId(e.target.value)}
                className="mt-1 w-full h-8 text-xs border border-input rounded px-2 bg-background"
              >
                <option value="">{t('invite.selectCleanerPlaceholder')}</option>
                {(cleaners || []).filter((c: any) => c.is_active).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('invite.propertyLabel')}</label>
              <select
                value={assignPropertyId}
                onChange={e => setAssignPropertyId(e.target.value)}
                className="mt-1 w-full h-8 text-xs border border-input rounded px-2 bg-background"
              >
                <option value="">{t('invite.selectPropertyPlaceholder')}</option>
                {(activeProps || []).map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('invite.dateLabel')}</label>
              <Input
                type="date"
                value={assignDate}
                onChange={e => setAssignDate(e.target.value)}
                className="mt-1 h-8 text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('invite.payAmountLabel')}</label>
              <Input
                type="number"
                step="0.01"
                value={assignPay}
                onChange={e => setAssignPay(e.target.value)}
                className="mt-1 h-8 text-xs"
                placeholder={t('invite.payAmountPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAssignOpen(false)}>{t('common.actions.cancel')}</Button>
            <Button
              size="sm"
              disabled={!assignCleanerId || !assignPropertyId || !assignDate || assigning}
              onClick={() => addAssignment()}
            >
              {assigning ? t('invite.saving') : t('invite.assign')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cleaner Detail Modal */}
      <Dialog open={!!detailCleaner} onOpenChange={v => !v && setDetailCleaner(null)}>
        <DialogContent className="max-w-md max-h-[70vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{detailCleaner?.full_name}</DialogTitle></DialogHeader>
          {detailCleaner && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground block">{t('table.detailPhone')}</span>{detailCleaner.phone || '—'}</div>
                <div><span className="text-muted-foreground block">{t('table.detailEmail')}</span>{detailCleaner.email || '—'}</div>
                <div><span className="text-muted-foreground block">{t('table.detailAltEmail')}</span>{detailCleaner.alt_email || '—'}</div>
                <div><span className="text-muted-foreground block">{t('table.detailPayRate')}</span>{detailCleaner.pay_rate ? fmt(detailCleaner.pay_rate) : '—'}</div>
                <div><span className="text-muted-foreground block">{t('table.detailStatus')}</span>{detailCleaner.is_active ? t('table.statusActive') : t('table.statusInactive')}</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block mb-1">{t('table.assignmentHistory')}</span>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {(assignments || []).filter((a: any) => a.cleaner_id === detailCleaner.id).slice(0, 50).map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between text-xs border-b border-border/40 py-1">
                      <div>
                        <button onClick={() => { setDetailCleaner(null); openPropertyModal((a.properties as any)?.id) }} className="hover:underline font-medium">
                          {(a.properties as any)?.name || '—'}
                        </button>
                        <span className="text-muted-foreground ml-2">{a.scheduled_date}</span>
                      </div>
                      <span className="tabular-nums">{a.pay_amount ? fmt(Number(a.pay_amount)) : '—'}</span>
                    </div>
                  ))}
                  {(assignments || []).filter((a: any) => a.cleaner_id === detailCleaner.id).length === 0 && (
                    <p className="text-muted-foreground text-center py-4">{t('table.noAssignmentsYet')}</p>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { setDeleteConfirmId(detailCleaner?.id); setDetailCleaner(null) }}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              {t('table.deleteButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={v => !v && setDeleteConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('table.deleteDialogTitle')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {(() => {
              // Split the translated template on the {{name}} placeholder so the
              // cleaner's name can still render inside a <strong> tag.
              const [before, after] = t('table.deleteDialogConfirm').split('{{name}}')
              return <>{before}<strong>{(cleaners || []).find((c: any) => c.id === deleteConfirmId)?.full_name}</strong>{after}</>
            })()}
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>{t('common.actions.cancel')}</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => deleteConfirmId && deleteCleaner(deleteConfirmId)}
            >
              {deleting ? t('table.deleting') : t('table.deleteButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
