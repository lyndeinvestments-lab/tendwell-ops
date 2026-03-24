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
import { Users2, Plus, Search, X, Calendar, List, ChevronLeft, ChevronRight } from 'lucide-react'
import { format, startOfWeek, addDays, isSameDay } from 'date-fns'

type ViewMode = 'list' | 'calendar' | 'reconciliation'

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

  const { data: operationalProps } = useQuery({
    queryKey: ['/supabase/reconciliation-props'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, cleaner_pay, stage_name')
        .in('stage_name', ['Active', 'Onboarding'])
      if (error) throw error
      return data || []
    },
    enabled: viewMode === 'reconciliation',
  })

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

  const filtered = useMemo(() => {
    if (!cleaners) return []
    if (!search.trim()) return cleaners
    const q = search.toLowerCase()
    return cleaners.filter((c: any) => c.full_name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q))
  }, [cleaners, search])

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
    if (!assignments) return {}
    const map: Record<string, any[]> = {}
    for (const a of assignments) {
      const key = `${a.cleaner_id}_${a.scheduled_date}`
      if (!map[key]) map[key] = []
      map[key].push(a)
    }
    return map
  }, [assignments])

  // Reconciliation data
  const reconciliationData = useMemo(() => {
    if (!operationalProps || !assignments) return []
    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return operationalProps.map((p: any) => {
      const expected = (p.cleaner_pay || 0) * 4.33
      const monthAssignments = assignments.filter((a: any) =>
        String(a.property_id) === String(p.id) && a.scheduled_date?.startsWith(currentMonth)
      )
      const actual = monthAssignments.reduce((s: number, a: any) => s + Number(a.pay_amount || 0), 0)
      const diff = actual - expected
      const pct = expected > 0 ? Math.abs(diff / expected) * 100 : 0
      let status = 'No Data'
      if (monthAssignments.length > 0) {
        if (pct <= 10) status = 'On Track'
        else if (diff > 0) status = 'Over'
        else status = 'Under'
      }
      return { ...p, expected, actual, diff, status }
    }).sort((a: any, b: any) => Math.abs(b.diff) - Math.abs(a.diff))
  }, [operationalProps, assignments])

  const statusColors: Record<string, string> = {
    'On Track': 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800',
    'Over': 'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800',
    'Under': 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-800',
    'No Data': 'text-gray-600 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-900/20 dark:border-gray-800',
  }

  function fmt(n: number) { return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

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
                <tr><td colSpan={7}><EmptyState icon={Users2} title="No cleaners" description="Add your first cleaner to get started." /></td></tr>
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
          <div className="border border-border rounded-lg overflow-auto">
            <div className="grid" style={{ gridTemplateColumns: '150px repeat(7, 1fr)', minWidth: '900px' }}>
              <div className="bg-muted/60 border-b border-r border-border px-2 py-1.5 text-xs font-medium text-muted-foreground">Cleaner</div>
              {weekDays.map(d => (
                <div key={d.toISOString()} className={`bg-muted/60 border-b border-r border-border px-2 py-1.5 text-xs font-medium text-center ${isSameDay(d, new Date()) ? 'text-primary' : 'text-muted-foreground'}`}>
                  {format(d, 'EEE M/d')}
                </div>
              ))}
              {(cleaners || []).filter((c: any) => c.is_active).map((c: any) => (
                <>
                  <div key={`name-${c.id}`} className="border-b border-r border-border px-2 py-1.5 text-xs font-medium truncate">{c.full_name}</div>
                  {weekDays.map(d => {
                    const dateStr = format(d, 'yyyy-MM-dd')
                    const dayAssignments = calendarAssignments[`${c.id}_${dateStr}`] || []
                    return (
                      <div key={`${c.id}_${dateStr}`} className="border-b border-r border-border px-1 py-1 min-h-[40px]">
                        {dayAssignments.map((a: any) => {
                          const chipColor = a.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                                           a.status === 'cancelled' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                                           'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                          return (
                            <Popover key={a.id}>
                              <PopoverTrigger asChild>
                                <button className={`text-xs rounded px-1 py-0.5 truncate w-full text-left ${chipColor}`}>
                                  {(a.properties as any)?.name?.slice(0, 15) || '—'}
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-48 p-2 text-xs space-y-1">
                                <p className="font-medium">{(a.properties as any)?.name}</p>
                                <p className="text-muted-foreground">{(a.properties as any)?.address || 'No address'}</p>
                                {a.pay_amount && <p>Pay: {fmt(Number(a.pay_amount))}</p>}
                                <p>Status: {a.status}</p>
                              </PopoverContent>
                            </Popover>
                          )
                        })}
                      </div>
                    )
                  })}
                </>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Reconciliation View */}
      {viewMode === 'reconciliation' && (
        <div className="overflow-auto flex-1 rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Property</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Expected Pay</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Actual Logged</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Difference</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {reconciliationData.length === 0 ? (
                <tr><td colSpan={5}><EmptyState icon={Users2} title="No data" description="No active properties to reconcile." /></td></tr>
              ) : (
                reconciliationData.map((p: any) => (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-2 px-3 font-medium text-xs">
                      <button onClick={() => openPropertyModal(p.id)} className="hover:underline text-left">{p.name}</button>
                    </td>
                    <td className="py-2 px-3 tabular-nums text-xs">{fmt(p.expected)}</td>
                    <td className="py-2 px-3 tabular-nums text-xs">{fmt(p.actual)}</td>
                    <td className={`py-2 px-3 tabular-nums text-xs font-medium ${p.diff > 0 ? 'text-red-600' : p.diff < 0 ? 'text-amber-600' : ''}`}>
                      {p.diff > 0 ? '+' : ''}{fmt(p.diff)}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${statusColors[p.status]}`}>{p.status}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
