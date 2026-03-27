import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { EmptyState } from '@/components/EmptyState'
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core'
import { Users2, Plus, Search, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { format, startOfWeek, addDays, isSameDay } from 'date-fns'

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

// ── Draggable assignment chip ──────────────────────────────────────────────
function DraggableChip({ assignment, colorClass, fmt }: { assignment: any; colorClass: string; fmt: (n: number) => string }) {
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
        <p className="text-muted-foreground">{(assignment.properties as any)?.address || 'No address'}</p>
        {assignment.pay_amount && <p>Pay: {fmt(Number(assignment.pay_amount))}</p>}
        <p>Status: {assignment.status}</p>
        {assignment.notes && <p className="text-muted-foreground">{assignment.notes}</p>}
      </PopoverContent>
    </Popover>
  )
}

// ── Droppable day cell ─────────────────────────────────────────────────────
function DroppableDayCell({ cellId, children, onAssign }: { cellId: string; children: React.ReactNode; onAssign: () => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: cellId })
  return (
    <div
      ref={setNodeRef}
      className={`border-b border-r border-border px-1 py-1 min-h-[52px] transition-colors group relative ${isOver ? 'bg-primary/10' : ''}`}
    >
      {children}
      <button
        onClick={onAssign}
        className="absolute bottom-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-muted-foreground hover:text-primary"
        title="Assign"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  )
}

export default function CleanersPage() {
  usePageTitle('Cleaners')
  const { toast } = useToast()
  const qc = useQueryClient()
  const { openPropertyModal } = usePropertyModal()
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [detailCleaner, setDetailCleaner] = useState<any>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [newForm, setNewForm] = useState({ full_name: '', phone: '', email: '', pay_rate: '', notes: '' })

  // Assign dialog state
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignCleanerId, setAssignCleanerId] = useState('')
  const [assignPropertyId, setAssignPropertyId] = useState('')
  const [assignDate, setAssignDate] = useState('')
  const [assignPay, setAssignPay] = useState('')

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const { data: cleaners, isLoading } = useQuery({
    queryKey: ['/supabase/cleaners'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cleaners').select('*').order('full_name')
      if (error) throw error
      return data || []
    },
  })

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

  const { mutate: addCleaner, isPending: adding } = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('cleaners').insert({
        full_name: newForm.full_name,
        phone: newForm.phone || null,
        email: newForm.email || null,
        pay_rate: newForm.pay_rate ? parseFloat(newForm.pay_rate) : null,
        notes: newForm.notes || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/cleaners'] })
      toast({ title: 'Cleaner added' })
      setAddOpen(false)
      setNewForm({ full_name: '', phone: '', email: '', pay_rate: '', notes: '' })
    },
    onError: () => toast({ title: 'Failed to add cleaner', variant: 'destructive' }),
  })

  const { mutate: addAssignment, isPending: assigning } = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('clean_assignments').insert({
        cleaner_id: assignCleanerId,
        property_id: assignPropertyId,
        scheduled_date: assignDate,
        status: 'scheduled',
        pay_amount: assignPay ? parseFloat(assignPay) : null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/all-assignments'] })
      toast({ title: 'Assignment added' })
      setAssignOpen(false)
      setAssignCleanerId('')
      setAssignPropertyId('')
      setAssignDate('')
      setAssignPay('')
    },
    onError: () => toast({ title: 'Failed to add assignment', variant: 'destructive' }),
  })

  const { mutate: moveAssignment } = useMutation({
    mutationFn: async ({ id, newDate }: { id: string; newDate: string }) => {
      const { error } = await supabase.from('clean_assignments').update({ scheduled_date: newDate }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/all-assignments'] })
      toast({ title: 'Assignment moved' })
    },
    onError: () => toast({ title: 'Failed to move assignment', variant: 'destructive' }),
  })

  const filtered = useMemo(() => {
    if (!cleaners) return []
    if (!search.trim()) return cleaners
    const q = search.toLowerCase()
    return cleaners.filter((c: any) => c.full_name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q))
  }, [cleaners, search])

  // Color map: cleaner index → color
  const cleanerColorMap = useMemo(() => {
    const map: Record<string, number> = {}
    ;(cleaners || []).forEach((c: any, i: number) => { map[c.id] = i % CLEANER_COLORS.length })
    return map
  }, [cleaners])

  // Assignment stats per cleaner
  const cleanerStats = useMemo(() => {
    const map: Record<string, { total: number; totalPay: number }> = {}
    for (const a of (assignments || [])) {
      const cid = a.cleaner_id
      if (!map[cid]) map[cid] = { total: 0, totalPay: 0 }
      map[cid].total++
      map[cid].totalPay += Number(a.pay_amount || 0)
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

  // Reconciliation: cleaner-based for current month
  const reconciliationData = useMemo(() => {
    if (!cleaners || !assignments) return []
    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return cleaners.map((c: any) => {
      const monthAssignments = assignments.filter((a: any) =>
        String(a.cleaner_id) === String(c.id) && a.scheduled_date?.startsWith(currentMonth)
      )
      const totalPay = monthAssignments.reduce((s: number, a: any) => s + Number(a.pay_amount || 0), 0)
      const avgPay = monthAssignments.length > 0 ? totalPay / monthAssignments.length : 0
      return { ...c, cleans: monthAssignments.length, totalPay, avgPay }
    }).sort((a: any, b: any) => b.cleans - a.cleans)
  }, [cleaners, assignments])

  function fmt(n: number) { return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

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
    <div className="p-5 h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Cleaners</h1>
          <p className="text-sm text-muted-foreground">Roster, assignments, and cost reconciliation</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center border rounded-md overflow-hidden">
            {(['list', 'calendar', 'reconciliation'] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === v ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
              >
                {v === 'list' ? 'Roster' : v === 'calendar' ? 'Calendar' : 'Reconciliation'}
              </button>
            ))}
          </div>
          {viewMode === 'list' && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="search" placeholder="Search…" value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-8 h-8 w-48 text-sm"
              />
              {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2"><X className="w-3.5 h-3.5" /></button>}
            </div>
          )}
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Add Cleaner
          </Button>
        </div>
      </div>

      {/* Roster View */}
      {viewMode === 'list' && (
        <div className="overflow-auto flex-1 rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Name</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Phone</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Email</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Pay Rate</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Assignments</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Avg Pay</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(5)].map((_, i) => <tr key={i} className="border-b border-border/50">{[...Array(7)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}</tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7}>
                  <EmptyState icon={Users2} title="No cleaners" description={`Add your first cleaner to get started.${suggestedCleaners.length > 0 ? ` ${suggestedCleaners.length} active properties have cleaner pay set but no assignments.` : ''}`} />
                </td></tr>
              ) : (
                filtered.map((c: any) => {
                  const stats = cleanerStats[c.id] || { total: 0, totalPay: 0 }
                  const avgPay = stats.total > 0 ? stats.totalPay / stats.total : 0
                  return (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setDetailCleaner(c)}>
                      <td className="py-2 px-3 font-medium text-xs">{c.full_name}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{c.phone || '—'}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{c.email || '—'}</td>
                      <td className="py-2 px-3 text-xs tabular-nums">{c.pay_rate ? fmt(c.pay_rate) : '—'}</td>
                      <td className="py-2 px-3 text-xs tabular-nums">{stats.total}</td>
                      <td className="py-2 px-3 text-xs tabular-nums">{avgPay > 0 ? fmt(avgPay) : '—'}</td>
                      <td className="py-2 px-3">
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${c.is_active ? 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800' : 'text-gray-600 bg-gray-50 border-gray-200'}`}>
                          {c.is_active ? 'Active' : 'Inactive'}
                        </span>
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
            <span className="text-sm font-medium">{format(weekStart, 'MMM d')} — {format(addDays(weekStart, 6), 'MMM d, yyyy')}</span>
            <Button variant="outline" size="sm" onClick={() => setWeekOffset(w => w + 1)}><ChevronRight className="w-4 h-4" /></Button>
          </div>

          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="border border-border rounded-lg overflow-auto">
              <div className="grid" style={{ gridTemplateColumns: '150px repeat(7, 1fr)', minWidth: '900px' }}>
                <div className="bg-muted/60 border-b border-r border-border px-2 py-1.5 text-xs font-medium text-muted-foreground">Cleaner</div>
                {weekDays.map(d => (
                  <div key={d.toISOString()} className={`bg-muted/60 border-b border-r border-border px-2 py-1.5 text-xs font-medium text-center ${isSameDay(d, new Date()) ? 'text-primary' : 'text-muted-foreground'}`}>
                    {format(d, 'EEE M/d')}
                  </div>
                ))}
                {activeCleaners.map((c: any) => (
                  <>
                    <div key={`name-${c.id}`} className="border-b border-r border-border px-2 py-1.5 text-xs font-medium truncate flex items-center gap-1.5">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${LEGEND_DOTS[cleanerColorMap[c.id] ?? 0]}`} />
                      {c.full_name}
                    </div>
                    {weekDays.map(d => {
                      const dateStr = format(d, 'yyyy-MM-dd')
                      const dayAssignments = calendarAssignments[`${c.id}_${dateStr}`] || []
                      const cellId = `cell_${c.id}_${dateStr}`
                      return (
                        <DroppableDayCell
                          key={cellId}
                          cellId={cellId}
                          onAssign={() => openAssign(c.id, dateStr)}
                        >
                          {dayAssignments.map((a: any) => (
                            <DraggableChip
                              key={a.id}
                              assignment={a}
                              colorClass={CLEANER_COLORS[cleanerColorMap[c.id] ?? 0]}
                              fmt={fmt}
                            />
                          ))}
                        </DroppableDayCell>
                      )
                    })}
                  </>
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
              <span>Total cleans: <strong className="text-foreground">{reconciliationData.reduce((s: number, c: any) => s + c.cleans, 0)}</strong></span>
              <span>Total pay: <strong className="text-foreground">{fmt(reconciliationData.reduce((s: number, c: any) => s + c.totalPay, 0))}</strong></span>
              <span>Active cleaners: <strong className="text-foreground">{reconciliationData.filter((c: any) => c.is_active && c.cleans > 0).length}</strong></span>
            </div>
          )}
          <div className="overflow-auto flex-1 rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Cleaner</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Status</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Pay Rate</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Cleans This Month</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Total Pay</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Avg Pay / Clean</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Expected (Rate x Cleans)</th>
                </tr>
              </thead>
              <tbody>
                {reconciliationData.length === 0 ? (
                  <tr><td colSpan={7}><EmptyState icon={Users2} title="No cleaners" description="Add cleaners to see reconciliation." /></td></tr>
                ) : (
                  reconciliationData.map((c: any) => {
                    const expected = c.pay_rate && c.cleans > 0 ? c.pay_rate * c.cleans : null
                    const diff = expected && c.totalPay > 0 ? c.totalPay - expected : null
                    return (
                      <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setDetailCleaner(c)}>
                        <td className="py-2 px-3 font-medium text-xs">{c.full_name}</td>
                        <td className="py-2 px-3">
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${c.is_active ? 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800' : 'text-gray-600 bg-gray-50 border-gray-200'}`}>
                            {c.is_active ? 'Active' : 'Inactive'}
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
                                <span className={`ml-1 ${diff > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
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
          <DialogHeader><DialogTitle>Add Cleaner</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Full Name *</label>
              <Input value={newForm.full_name} onChange={e => setNewForm(f => ({ ...f, full_name: e.target.value }))} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Phone</label>
                <Input value={newForm.phone} onChange={e => setNewForm(f => ({ ...f, phone: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <Input value={newForm.email} onChange={e => setNewForm(f => ({ ...f, email: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Pay Rate ($)</label>
              <Input type="number" step="0.01" value={newForm.pay_rate} onChange={e => setNewForm(f => ({ ...f, pay_rate: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <Input value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" disabled={!newForm.full_name.trim() || adding} onClick={() => addCleaner()}>
              {adding ? 'Adding…' : 'Add Cleaner'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={assignOpen} onOpenChange={v => !v && setAssignOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Assign Cleaner</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Cleaner</label>
              <select
                value={assignCleanerId}
                onChange={e => setAssignCleanerId(e.target.value)}
                className="mt-1 w-full h-8 text-xs border border-input rounded px-2 bg-background"
              >
                <option value="">Select cleaner…</option>
                {(cleaners || []).filter((c: any) => c.is_active).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Property</label>
              <select
                value={assignPropertyId}
                onChange={e => setAssignPropertyId(e.target.value)}
                className="mt-1 w-full h-8 text-xs border border-input rounded px-2 bg-background"
              >
                <option value="">Select property…</option>
                {(activeProps || []).map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Date</label>
              <Input
                type="date"
                value={assignDate}
                onChange={e => setAssignDate(e.target.value)}
                className="mt-1 h-8 text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Pay Amount ($)</label>
              <Input
                type="number"
                step="0.01"
                value={assignPay}
                onChange={e => setAssignPay(e.target.value)}
                className="mt-1 h-8 text-xs"
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!assignCleanerId || !assignPropertyId || !assignDate || assigning}
              onClick={() => addAssignment()}
            >
              {assigning ? 'Saving…' : 'Assign'}
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
                <div><span className="text-muted-foreground block">Phone</span>{detailCleaner.phone || '—'}</div>
                <div><span className="text-muted-foreground block">Email</span>{detailCleaner.email || '—'}</div>
                <div><span className="text-muted-foreground block">Pay Rate</span>{detailCleaner.pay_rate ? fmt(detailCleaner.pay_rate) : '—'}</div>
                <div><span className="text-muted-foreground block">Status</span>{detailCleaner.is_active ? 'Active' : 'Inactive'}</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block mb-1">Assignment History</span>
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
                    <p className="text-muted-foreground text-center py-4">No assignments yet.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
