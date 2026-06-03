import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, logActivity } from '@/lib/supabase'
import { invalidateAllPropertyQueries } from '@/lib/query-invalidations'
import { useAuth, canEditView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { EmptyState } from '@/components/EmptyState'
import { TablePagination } from '@/components/TablePagination'
import {
  Search, X, ClipboardCheck, Check, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Download,
  UserPlus, Calendar, CheckSquare, Square, Trash2,
} from 'lucide-react'
import { format, differenceInDays, addMonths } from 'date-fns'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000

// Fields to verify during a walkthrough (non-financial property info)
const VERIFY_SECTIONS = [
  {
    title: 'Property Details',
    fields: [
      { key: 'address', label: 'Address', type: 'text' },
      { key: 'bedrooms', label: 'Bedrooms', type: 'number' },
      { key: 'full_baths', label: 'Full Baths', type: 'number' },
      { key: 'half_baths', label: 'Half Baths', type: 'number' },
      { key: 'square_footage', label: 'Square Footage', type: 'number' },
      { key: 'guest_count', label: 'Max Guests', type: 'number' },
      { key: 'hot_tub', label: 'Hot Tub', type: 'boolean' },
      { key: 'pet_friendly', label: 'Pet Friendly', type: 'text' },
    ],
  },
  {
    title: 'Bed Counts',
    fields: [
      { key: 'king_beds', label: 'King Beds', type: 'number' },
      { key: 'queen_beds', label: 'Queen Beds', type: 'number' },
      { key: 'full_beds', label: 'Full Beds', type: 'number' },
      { key: 'twin_beds', label: 'Twin Beds', type: 'number' },
      { key: 'number_of_beds', label: 'Total Beds', type: 'number' },
    ],
  },
  {
    title: 'Access & Wi-Fi',
    fields: [
      { key: 'auto_code', label: 'Auto Code', type: 'text' },
      { key: 'door_code', label: 'Door Code', type: 'text' },
      { key: 'other_codes', label: 'Other Codes', type: 'text' },
      { key: 'wifi_info', label: 'Wi-Fi Info', type: 'text' },
    ],
  },
  {
    title: 'Operations',
    fields: [
      { key: 'filter_size', label: 'AC Filter Size', type: 'text' },
      { key: 'cleaning_frequency', label: 'Cleaning Frequency', type: 'text' },
      { key: 'notes', label: 'Special Notes', type: 'textarea' },
    ],
  },
]

const ALL_VERIFY_FIELDS = VERIFY_SECTIONS.flatMap(s => s.fields)

type SortKey = 'name' | 'status' | 'last_verified' | 'assignee' | 'due_date'

export default function InspectionsPage() {
  usePageTitle('Property Verification')
  const { toast } = useToast()
  const { user, effectiveUser } = useAuth()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showDueOnly, setShowDueOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [activeProperty, setActiveProperty] = useState<any>(null)
  const [editValues, setEditValues] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false)
  const [bulkDueOpen, setBulkDueOpen] = useState(false)
  const [bulkDueDate, setBulkDueDate] = useState('')

  // Fetch active + onboarding properties with all verifiable fields
  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/property-verification-list'],
    queryFn: async () => {
      const fields = ['id', 'name', 'stage_id', ...ALL_VERIFY_FIELDS.map(f => f.key)].join(', ')
      const { data, error } = await supabase
        .from('properties')
        .select(`${fields}, pipeline_stages!properties_stage_id_fkey(name)`)
        .eq('exempt_from_inspections', false)
        .order('name')
      if (error) throw error
      return (data || []).filter((p: any) => (p.pipeline_stages as any)?.name === 'Active')
    },
  })

  // Fetch verification records (now includes assignee + due_date)
  const { data: verifications } = useQuery({
    queryKey: ['/supabase/property-verifications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_verifications')
        .select('property_id, verified_at, verified_by, assignee_name, due_date')
      if (error) throw error
      return data || []
    },
  })

  // Fetch users for assignee dropdown
  const { data: users } = useQuery({
    queryKey: ['/supabase/verification-users'],
    queryFn: async () => {
      const { data } = await supabase.from('app_users').select('id, label').order('label')
      return data || []
    },
  })

  // Build lookup: property_id → last verification
  const verificationMap = useMemo(() => {
    const map: Record<string, { verified_at?: string; verified_by?: string; assignee_name?: string; due_date?: string }> = {}
    for (const v of (verifications || [])) {
      map[String(v.property_id)] = v as any
    }
    return map
  }, [verifications])

  function getStatus(p: any): 'due' | 'verified' | 'never' {
    const v = verificationMap[String(p.id)]
    if (!v || !v.verified_at) return 'never'
    const daysSince = differenceInDays(new Date(), new Date(v.verified_at))
    return daysSince >= 180 ? 'due' : 'verified'
  }

  function getDaysSince(p: any): number | null {
    const v = verificationMap[String(p.id)]
    if (!v || !v.verified_at) return null
    return differenceInDays(new Date(), new Date(v.verified_at))
  }

  const dueCount = useMemo(() => {
    if (!properties) return 0
    return properties.filter((p: any) => getStatus(p) !== 'verified').length
  }, [properties, verificationMap])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    if (!properties) return []
    let result = properties.filter((p: any) => {
      const matchSearch = !search.trim() || p.name?.toLowerCase().includes(search.toLowerCase())
      const matchDue = !showDueOnly || getStatus(p) !== 'verified'
      return matchSearch && matchDue
    })

    result = [...result].sort((a: any, b: any) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'name') return (a.name || '').localeCompare(b.name || '') * dir
      if (sortKey === 'last_verified') {
        const da = getDaysSince(a) ?? 9999
        const db = getDaysSince(b) ?? 9999
        return (da - db) * dir
      }
      if (sortKey === 'assignee') {
        const aa = verificationMap[String(a.id)]?.assignee_name || ''
        const bb = verificationMap[String(b.id)]?.assignee_name || ''
        return aa.localeCompare(bb) * dir
      }
      if (sortKey === 'due_date') {
        const aa = verificationMap[String(a.id)]?.due_date || '9999-12-31'
        const bb = verificationMap[String(b.id)]?.due_date || '9999-12-31'
        return aa.localeCompare(bb) * dir
      }
      // status: never first, then due, then verified
      const order = { never: 0, due: 1, verified: 2 }
      return (order[getStatus(a)] - order[getStatus(b)]) * dir
    })
    return result
  }, [properties, verificationMap, search, showDueOnly, sortKey, sortDir])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  function openWalkthrough(p: any) {
    const vals: Record<string, any> = {}
    for (const f of ALL_VERIFY_FIELDS) {
      vals[f.key] = p[f.key]
    }
    setEditValues(vals)
    setActiveProperty(p)
    setIsDirty(false)
  }

  async function saveVerification() {
    if (!activeProperty) return
    if (!canEditView('property-verifications', effectiveUser)) {
      toast({ title: 'Edit access required', description: "You don't have edit access to this page.", variant: 'destructive' })
      return
    }
    setSaving(true)

    try {
      // Find which fields changed
      const changes: Record<string, { old: any; new: any }> = {}
      const updates: Record<string, any> = {}
      for (const f of ALL_VERIFY_FIELDS) {
        const oldVal = activeProperty[f.key]
        const newVal = editValues[f.key]
        const oldNorm = oldVal == null ? null : oldVal
        const newNorm = newVal == null || newVal === '' ? null : (f.type === 'number' ? Number(newVal) : f.type === 'boolean' ? Boolean(newVal) : newVal)
        if (String(oldNorm ?? '') !== String(newNorm ?? '')) {
          changes[f.key] = { old: oldNorm, new: newNorm }
          updates[f.key] = newNorm
        }
      }

      // Update property fields if any changed
      if (Object.keys(updates).length > 0) {
        const { error } = await supabase.from('properties').update(updates).eq('id', activeProperty.id)
        if (error) {
          toast({ title: 'Failed to update property', description: error.message, variant: 'destructive' })
          setSaving(false)
          return
        }
      }

      // Upsert verification record (clears assignee + due_date on completion)
      const { error: vError } = await supabase.from('property_verifications').upsert({
        property_id: activeProperty.id,
        verified_by: user?.label ?? null,
        verified_at: new Date().toISOString(),
        notes: editValues.notes !== activeProperty.notes ? 'Notes updated' : null,
        fields_updated: Object.keys(changes).length > 0 ? changes : null,
        assignee_name: null,
        due_date: null,
      }, { onConflict: 'property_id' })

      if (vError) {
        toast({ title: 'Failed to save verification', description: vError.message, variant: 'destructive' })
        setSaving(false)
        return
      }

      // Close any linked task on the Tasks board (non-critical — errors ignored)
      await closeVerificationTask(activeProperty.id).catch(() => {})

      // Log activity
      logActivity({
        entity_type: 'property',
        entity_id: String(activeProperty.id),
        entity_name: activeProperty.name,
        action: 'update',
        field_name: 'verification',
        new_value: Object.keys(changes).length > 0 ? `${Object.keys(changes).length} fields updated` : 'Verified, no changes',
        changed_by: user?.label ?? null,
      })

      qc.invalidateQueries({ queryKey: ['/supabase/property-verification-list'] })
      qc.invalidateQueries({ queryKey: ['/supabase/property-verifications'] })
      // Verification can write arbitrary properties.<field> updates above
      // (line 228); if any changed, every property-derived cache should
      // refresh. Gated on actual changes — invalidate triggers refetch
      // of mounted active queries regardless of staleTime, so calling it
      // on a confirm-with-no-changes would be wasteful.
      if (Object.keys(changes).length > 0) invalidateAllPropertyQueries(qc)
      toast({ title: 'Verification complete', description: Object.keys(changes).length > 0 ? `${Object.keys(changes).length} field(s) updated` : 'All info confirmed' })
      setIsDirty(false)
      setActiveProperty(null)
    } catch (err: any) {
      toast({ title: 'Unexpected error saving verification', description: err?.message ?? 'Please try again.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // ─── Sync linked Task in tasks table for assigned/scheduled verifications ──
  async function syncVerificationTask(propertyId: number, propertyName: string, assignee: string | null, dueDate: string | null) {
    // Find existing task linked to this property
    const { data: existing } = await supabase
      .from('tasks')
      .select('id, status')
      .eq('verification_property_id', propertyId)
      .neq('status', 'Done')
      .limit(1)

    const taskRow = existing?.[0]

    if (!assignee && !dueDate) {
      // Cleared — delete any open task
      if (taskRow) await supabase.from('tasks').delete().eq('id', taskRow.id)
      return
    }

    if (taskRow) {
      await supabase.from('tasks').update({
        assignee_name: assignee || null,
        due_date: dueDate || null,
        updated_at: new Date().toISOString(),
      }).eq('id', taskRow.id)
    } else {
      await supabase.from('tasks').insert({
        title: `Verify: ${propertyName}`,
        description: 'Run the 6-month property verification walkthrough.',
        status: 'To Do',
        priority: 'Medium',
        category: 'Onboarding',
        property_name: propertyName,
        assignee_name: assignee || null,
        due_date: dueDate || null,
        created_by: user?.label || null,
        verification_property_id: propertyId,
      })
    }
  }

  async function closeVerificationTask(propertyId: number) {
    await supabase
      .from('tasks')
      .update({ status: 'Done', updated_at: new Date().toISOString() })
      .eq('verification_property_id', propertyId)
      .neq('status', 'Done')
  }

  // ─── Bulk actions ─────────────────────────────────────────────────────────
  async function bulkAssign(assigneeName: string | null) {
    if (selected.size === 0) return
    const targets = (paged as any[]).filter(p => selected.has(p.id))
    const rows = targets.map(p => {
      const existing = verificationMap[String(p.id)] || {}
      return {
        property_id: p.id,
        assignee_name: assigneeName,
        due_date: existing.due_date || null,
        verified_at: existing.verified_at || null,
        verified_by: existing.verified_by || null,
      }
    })
    const { error } = await supabase.from('property_verifications').upsert(rows, { onConflict: 'property_id' })
    if (error) {
      toast({ title: 'Bulk assign failed', description: error.message, variant: 'destructive' })
      return
    }
    await Promise.all(targets.map(p => syncVerificationTask(p.id, p.name, assigneeName, verificationMap[String(p.id)]?.due_date || null)))
    qc.invalidateQueries({ queryKey: ['/supabase/property-verifications'] })
    qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
    toast({ title: assigneeName ? `Assigned ${selected.size} to ${assigneeName}` : `Cleared assignment on ${selected.size}` })
    setSelected(new Set())
    setBulkAssignOpen(false)
  }

  async function bulkSetDue(date: string) {
    if (selected.size === 0 || !date) return
    const targets = (paged as any[]).filter(p => selected.has(p.id))
    const rows = targets.map(p => {
      const existing = verificationMap[String(p.id)] || {}
      return {
        property_id: p.id,
        due_date: date,
        assignee_name: existing.assignee_name || null,
        verified_at: existing.verified_at || null,
        verified_by: existing.verified_by || null,
      }
    })
    const { error } = await supabase.from('property_verifications').upsert(rows, { onConflict: 'property_id' })
    if (error) {
      toast({ title: 'Bulk schedule failed', description: error.message, variant: 'destructive' })
      return
    }
    await Promise.all(targets.map(p => syncVerificationTask(p.id, p.name, verificationMap[String(p.id)]?.assignee_name || null, date)))
    qc.invalidateQueries({ queryKey: ['/supabase/property-verifications'] })
    qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
    toast({ title: `Set due date on ${selected.size}` })
    setSelected(new Set())
    setBulkDueOpen(false)
    setBulkDueDate('')
  }

  async function bulkMarkVerified() {
    if (selected.size === 0) return
    if (!confirm(`Mark ${selected.size} as verified now? This won't update property fields, only the verification record.`)) return
    const targets = (paged as any[]).filter(p => selected.has(p.id))
    const now = new Date().toISOString()
    const rows = targets.map(p => ({
      property_id: p.id,
      verified_at: now,
      verified_by: user?.label || null,
      assignee_name: null,
      due_date: null,
    }))
    const { error } = await supabase.from('property_verifications').upsert(rows, { onConflict: 'property_id' })
    if (error) {
      toast({ title: 'Bulk verify failed', description: error.message, variant: 'destructive' })
      return
    }
    await Promise.all(targets.map(p => closeVerificationTask(p.id)))
    qc.invalidateQueries({ queryKey: ['/supabase/property-verifications'] })
    qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
    toast({ title: `Marked ${selected.size} verified` })
    setSelected(new Set())
  }

  async function bulkClear() {
    if (selected.size === 0) return
    const targets = (paged as any[]).filter(p => selected.has(p.id))
    const rows = targets.map(p => {
      const existing = verificationMap[String(p.id)] || {}
      return {
        property_id: p.id,
        assignee_name: null,
        due_date: null,
        verified_at: existing.verified_at || null,
        verified_by: existing.verified_by || null,
      }
    })
    const { error } = await supabase.from('property_verifications').upsert(rows, { onConflict: 'property_id' })
    if (error) {
      toast({ title: 'Clear failed', description: error.message, variant: 'destructive' })
      return
    }
    await Promise.all(targets.map(p => syncVerificationTask(p.id, p.name, null, null)))
    qc.invalidateQueries({ queryKey: ['/supabase/property-verifications'] })
    qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
    toast({ title: `Cleared assignment on ${selected.size}` })
    setSelected(new Set())
  }

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === paged.length) setSelected(new Set())
    else setSelected(new Set((paged as any[]).map(p => p.id)))
  }

  function exportCsv() {
    if (!filtered?.length) return
    const headers = ['Property', 'Status', 'Last Verified', 'Verified By', 'Days Since']
    const rows = filtered.map((p: any) => {
      const v = verificationMap[String(p.id)]
      const status = getStatus(p)
      return [
        p.name || '',
        status === 'verified' ? 'Verified' : status === 'due' ? 'Due' : 'Never',
        v?.verified_at ? format(new Date(v.verified_at), 'yyyy-MM-dd') : '',
        v?.verified_by || '',
        getDaysSince(p) ?? '',
      ]
    })
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `property-verifications-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 inline ml-1 opacity-40" />
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3 inline ml-1" /> : <ArrowDown className="w-3 h-3 inline ml-1" />
  }

  function StatusBadge({ status }: { status: 'due' | 'verified' | 'never' }) {
    if (status === 'verified') return <span className="text-xs px-1.5 py-0.5 rounded border text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800">Verified</span>
    if (status === 'due') return <span className="text-xs px-1.5 py-0.5 rounded border text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-800">Due</span>
    return <span className="text-xs px-1.5 py-0.5 rounded border text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800">Never</span>
  }

  const thCls = 'text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap'

  return (
    <div className="p-5 h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Property Verification</h1>
          <p className="text-sm text-muted-foreground">Verify property details every 6 months — click a property to start walkthrough</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dueCount > 0 && (
            <button
              onClick={() => { setShowDueOnly(v => !v); setPage(1) }}
              className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md border transition-colors ${
                showDueOnly
                  ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                  : 'border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
              }`}
            >
              <AlertTriangle className="w-3 h-3" />
              {dueCount} need{dueCount === 1 ? 's' : ''} verification
            </button>
          )}
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={exportCsv} disabled={!filtered?.length}>
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              className="pl-8 pr-8 h-8 w-full sm:w-56 text-sm"
            />
            {search && (
              <button onClick={() => { setSearch(''); setPage(1) }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/60 px-3 py-2 text-xs">
          <span className="font-medium">{selected.size} selected</span>
          <Popover open={bulkAssignOpen} onOpenChange={setBulkAssignOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"><UserPlus className="w-3 h-3" /> Assign</Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-1" align="start">
              <div className="max-h-64 overflow-y-auto">
                {(users || []).map((u: any) => (
                  <button key={u.id} type="button" onClick={() => bulkAssign(u.label)} className="w-full text-left px-2 py-1.5 text-xs hover:bg-accent rounded">
                    {u.label}
                  </button>
                ))}
                <div className="border-t border-border my-1" />
                <button type="button" onClick={() => bulkAssign(null)} className="w-full text-left px-2 py-1.5 text-xs hover:bg-accent rounded text-muted-foreground">
                  Clear assignment
                </button>
              </div>
            </PopoverContent>
          </Popover>
          <Popover open={bulkDueOpen} onOpenChange={setBulkDueOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"><Calendar className="w-3 h-3" /> Set due date</Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="start">
              <Input type="date" value={bulkDueDate} onChange={e => setBulkDueDate(e.target.value)} className="h-8 text-xs mb-2" />
              <div className="flex gap-1">
                <Button size="sm" className="h-7 text-xs flex-1" onClick={() => bulkSetDue(bulkDueDate)} disabled={!bulkDueDate}>Apply</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setBulkDueDate(addMonths(new Date(), 1).toISOString().slice(0,10)); }}>+1mo</Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={bulkMarkVerified}><Check className="w-3 h-3" /> Mark verified</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-muted-foreground" onClick={bulkClear}><Trash2 className="w-3 h-3" /> Clear</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={() => setSelected(new Set())}>Cancel</Button>
        </div>
      )}

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
            <tr>
              <th className="w-8 px-2 py-2 sticky left-0 top-0 z-30 bg-muted">
                <Checkbox
                  checked={paged.length > 0 && selected.size === paged.length}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </th>
              <th className={`${thCls} sticky left-8 top-0 z-30 bg-muted`} onClick={() => toggleSort('name')}>Property <SortIcon col="name" /></th>
              <th className={thCls} onClick={() => toggleSort('status')}>Status <SortIcon col="status" /></th>
              <th className={thCls} onClick={() => toggleSort('assignee')}>Assignee <SortIcon col="assignee" /></th>
              <th className={thCls} onClick={() => toggleSort('due_date')}>Due <SortIcon col="due_date" /></th>
              <th className={thCls} onClick={() => toggleSort('last_verified')}>Last Verified <SortIcon col="last_verified" /></th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Verified By</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(8)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    icon={ClipboardCheck}
                    title={showDueOnly ? 'All verified' : 'No properties'}
                    description={showDueOnly ? 'All properties have been verified within the last 6 months.' : 'No properties found matching your search.'}
                  />
                </td>
              </tr>
            ) : (
              paged.map((p: any) => {
                const status = getStatus(p)
                const v = verificationMap[String(p.id)]
                const daysSince = getDaysSince(p)
                const isSelected = selected.has(p.id)
                const dueOverdue = v?.due_date && v.due_date < new Date().toISOString().slice(0,10)
                return (
                  <tr
                    key={p.id}
                    className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${isSelected ? 'bg-primary/5' : status === 'never' ? 'bg-red-50/30 dark:bg-red-900/5' : status === 'due' ? 'bg-amber-50/30 dark:bg-amber-900/5' : ''}`}
                  >
                    <td className="px-2 py-2 sticky left-0 z-10 bg-background" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(p.id)} aria-label={`Select ${p.name}`} />
                    </td>
                    <td className="py-2 px-3 font-medium text-xs sticky left-8 z-10 bg-background cursor-pointer" onClick={() => openWalkthrough(p)}>{p.name}</td>
                    <td className="py-2 px-3 cursor-pointer" onClick={() => openWalkthrough(p)}><StatusBadge status={status} /></td>
                    <td className="py-2 px-3 text-xs">{v?.assignee_name || <span className="text-muted-foreground">—</span>}</td>
                    <td className={`py-2 px-3 text-xs ${dueOverdue ? 'text-red-600 dark:text-red-400 font-medium' : ''}`}>{v?.due_date ? format(new Date(v.due_date + 'T00:00'), 'MMM d') : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground cursor-pointer" onClick={() => openWalkthrough(p)}>
                      {v?.verified_at ? (
                        <span>
                          {format(new Date(v.verified_at), 'MMM d, yyyy')}
                          <span className="ml-1 text-muted-foreground/60">({daysSince}d ago)</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 px-3 text-xs cursor-pointer" onClick={() => openWalkthrough(p)}>{v?.verified_by || '—'}</td>
                    <td className="py-2 px-3">
                      <Button size="sm" variant={status === 'verified' ? 'outline' : 'default'} className="h-8 text-xs gap-1 px-2" onClick={() => openWalkthrough(p)}>
                        <ClipboardCheck className="w-3 h-3" />
                        {status === 'verified' ? 'Re-verify' : 'Verify'}
                      </Button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      {/* Verification Walkthrough Sheet */}
      <Sheet open={!!activeProperty} onOpenChange={v => {
        if (!v && !saving) {
          if (isDirty && !confirm('You have unsaved changes. Close without saving?')) return
          setActiveProperty(null)
          setIsDirty(false)
        }
      }}>
        <SheetContent side="right" className="w-full sm:w-[480px] overflow-y-auto">
          {activeProperty && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base">{activeProperty.name}</SheetTitle>
                <p className="text-xs text-muted-foreground">{activeProperty.address || 'No address'}</p>
              </SheetHeader>

              <div className="mt-4 space-y-6">
                {VERIFY_SECTIONS.map(section => (
                  <div key={section.title}>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{section.title}</h3>
                    <div className="space-y-3">
                      {section.fields.map(f => {
                        const currentVal = editValues[f.key]
                        const originalVal = activeProperty[f.key]
                        const changed = String(currentVal ?? '') !== String(originalVal ?? '')
                        return (
                          <div key={f.key} className="grid grid-cols-[120px_1fr] items-center gap-2">
                            <label className="text-xs text-muted-foreground">{f.label}</label>
                            {f.type === 'boolean' ? (
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => { setEditValues(v => ({ ...v, [f.key]: false })); setIsDirty(true) }}
                                  className={`flex-1 h-7 rounded-md border text-xs transition-colors ${
                                    !currentVal
                                      ? 'bg-primary text-primary-foreground border-primary'
                                      : 'bg-background border-border text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  No
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setEditValues(v => ({ ...v, [f.key]: true })); setIsDirty(true) }}
                                  className={`flex-1 h-7 rounded-md border text-xs transition-colors ${
                                    currentVal
                                      ? 'bg-primary text-primary-foreground border-primary'
                                      : 'bg-background border-border text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  Yes
                                </button>
                              </div>
                            ) : f.type === 'textarea' ? (
                              <textarea
                                value={currentVal ?? ''}
                                onChange={e => { setEditValues(v => ({ ...v, [f.key]: e.target.value })); setIsDirty(true) }}
                                className={`w-full h-16 rounded-md border px-2 py-1.5 text-xs resize-none bg-background focus:outline-none focus:ring-2 focus:ring-ring ${changed ? 'border-blue-400 bg-blue-50/30 dark:bg-blue-900/10' : 'border-input'}`}
                              />
                            ) : (
                              <Input
                                type={f.type === 'number' ? 'number' : 'text'}
                                value={currentVal ?? ''}
                                onChange={e => { setEditValues(v => ({ ...v, [f.key]: f.type === 'number' ? (e.target.value ? Number(e.target.value) : null) : e.target.value })); setIsDirty(true) }}
                                className={`h-7 text-xs ${changed ? 'border-blue-400 bg-blue-50/30 dark:bg-blue-900/10' : ''}`}
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}

                <div className="pt-4 border-t border-border flex gap-2">
                  <Button
                    className="flex-1 gap-1.5"
                    onClick={saveVerification}
                    disabled={saving || !canEditView('property-verifications', effectiveUser)}
                  >
                    <Check className="w-3.5 h-3.5" />
                    {saving ? 'Saving…' : canEditView('property-verifications', effectiveUser) ? 'Confirm Verification' : 'View Only'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (isDirty && !confirm('You have unsaved changes. Close without saving?')) return
                      setActiveProperty(null)
                      setIsDirty(false)
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
