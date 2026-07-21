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
import { ErrorState } from '@/components/ErrorState'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { TablePagination } from '@/components/TablePagination'
import {
  Search, X, ClipboardCheck, Check, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Download,
  UserPlus, Calendar, CheckSquare, Square, Trash2, ShieldCheck, CheckCircle2, Clock,
} from 'lucide-react'
import { format, differenceInDays, addMonths } from 'date-fns'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000

// Maps a VERIFY_SECTIONS title to its `form.sections.*` dictionary key —
// the section titles below stay as plain identifiers (used for the React
// `key` prop too); translation is a display-only lookup at render time.
const SECTION_TITLE_KEYS: Record<string, string> = {
  'Property Details': 'propertyDetails',
  'Bed Counts': 'bedCounts',
  'Access & Wi-Fi': 'accessWifi',
  'Operations': 'operations',
}

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
  const { t } = useLocale('verifications')
  const { format: formatLocale } = useDateFormat()
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
  const { data: properties, isLoading, isError, refetch } = useQuery({
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

  // Summary-strip counts — computed from already-loaded rows only (no new query)
  const summary = useMemo(() => {
    if (!properties) return { total: 0, verified: 0, needs: 0, overdue: 0 }
    const today = new Date().toISOString().slice(0, 10)
    let verified = 0, needs = 0, overdue = 0
    for (const p of properties as any[]) {
      if (getStatus(p) === 'verified') verified++
      else needs++
      const dd = verificationMap[String(p.id)]?.due_date
      if (dd && dd < today) overdue++
    }
    return { total: (properties as any[]).length, verified, needs, overdue }
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
      toast({ title: t('toasts.editAccessRequired'), description: t('toasts.editAccessDescription'), variant: 'destructive' })
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
          toast({ title: t('toasts.updatePropertyFailed'), description: error.message, variant: 'destructive' })
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
        toast({ title: t('toasts.saveVerificationFailed'), description: vError.message, variant: 'destructive' })
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
      toast({ title: t('toasts.verificationComplete'), description: Object.keys(changes).length > 0 ? t('toasts.fieldsUpdated', { count: Object.keys(changes).length }) : t('toasts.allInfoConfirmed') })
      setIsDirty(false)
      setActiveProperty(null)
    } catch (err: any) {
      toast({ title: t('toasts.unexpectedError'), description: err?.message ?? t('toasts.tryAgain'), variant: 'destructive' })
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
      toast({ title: t('toasts.bulkAssignFailed'), description: error.message, variant: 'destructive' })
      return
    }
    await Promise.all(targets.map(p => syncVerificationTask(p.id, p.name, assigneeName, verificationMap[String(p.id)]?.due_date || null)))
    qc.invalidateQueries({ queryKey: ['/supabase/property-verifications'] })
    qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
    toast({ title: assigneeName ? t('toasts.assignedTo', { count: selected.size, name: assigneeName }) : t('toasts.clearedAssignment', { count: selected.size }) })
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
      toast({ title: t('toasts.bulkScheduleFailed'), description: error.message, variant: 'destructive' })
      return
    }
    await Promise.all(targets.map(p => syncVerificationTask(p.id, p.name, verificationMap[String(p.id)]?.assignee_name || null, date)))
    qc.invalidateQueries({ queryKey: ['/supabase/property-verifications'] })
    qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
    toast({ title: t('toasts.setDueDateOn', { count: selected.size }) })
    setSelected(new Set())
    setBulkDueOpen(false)
    setBulkDueDate('')
  }

  async function bulkMarkVerified() {
    if (selected.size === 0) return
    if (!confirm(t('confirm.bulkMarkVerified', { count: selected.size }))) return
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
      toast({ title: t('toasts.bulkVerifyFailed'), description: error.message, variant: 'destructive' })
      return
    }
    await Promise.all(targets.map(p => closeVerificationTask(p.id)))
    qc.invalidateQueries({ queryKey: ['/supabase/property-verifications'] })
    qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
    toast({ title: t('toasts.markedVerified', { count: selected.size }) })
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
      toast({ title: t('toasts.clearFailed'), description: error.message, variant: 'destructive' })
      return
    }
    await Promise.all(targets.map(p => syncVerificationTask(p.id, p.name, null, null)))
    qc.invalidateQueries({ queryKey: ['/supabase/property-verifications'] })
    qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
    toast({ title: t('toasts.clearedAssignment', { count: selected.size }) })
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
    const headers = [t('table.property'), t('table.status'), t('table.lastVerified'), t('table.verifiedBy'), t('csv.headerDaysSince')]
    const rows = filtered.map((p: any) => {
      const v = verificationMap[String(p.id)]
      const status = getStatus(p)
      return [
        p.name || '',
        t(`status.${status}`),
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
    if (status === 'verified') return <span className="text-xs px-1.5 py-0.5 rounded border text-success bg-success/10 border-success/25">{t('status.verified')}</span>
    if (status === 'due') return <span className="text-xs px-1.5 py-0.5 rounded border text-warning bg-warning/10 border-warning/25">{t('status.due')}</span>
    return <span className="text-xs px-1.5 py-0.5 rounded border text-destructive bg-destructive/10 border-destructive/25">{t('status.never')}</span>
  }

  const thCls = 'text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap'

  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {dueCount > 0 && (
              <button
                onClick={() => { setShowDueOnly(v => !v); setPage(1) }}
                className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md border transition-colors ${
                  showDueOnly
                    ? 'bg-warning/10 border-warning/30 text-warning'
                    : 'border-warning/30 text-warning hover:bg-warning/10'
                }`}
              >
                <AlertTriangle className="w-3 h-3" />
                {t('page.needsVerification', { count: dueCount })}
              </button>
            )}
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={exportCsv} disabled={!filtered?.length}>
              <Download className="w-3.5 h-3.5" /> {t('common.actions.exportCsv')}
            </Button>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t('page.searchPlaceholder')}
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
        }
      />

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/60 px-3 py-2 text-xs">
          <span className="font-medium">{t('bulk.selected', { count: selected.size })}</span>
          <Popover open={bulkAssignOpen} onOpenChange={setBulkAssignOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"><UserPlus className="w-3 h-3" /> {t('bulk.assign')}</Button>
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
                  {t('bulk.clearAssignment')}
                </button>
              </div>
            </PopoverContent>
          </Popover>
          <Popover open={bulkDueOpen} onOpenChange={setBulkDueOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"><Calendar className="w-3 h-3" /> {t('bulk.setDueDate')}</Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="start">
              <Input type="date" value={bulkDueDate} onChange={e => setBulkDueDate(e.target.value)} className="h-8 text-xs mb-2" />
              <div className="flex gap-1">
                <Button size="sm" className="h-7 text-xs flex-1" onClick={() => bulkSetDue(bulkDueDate)} disabled={!bulkDueDate}>{t('bulk.apply')}</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setBulkDueDate(addMonths(new Date(), 1).toISOString().slice(0,10)); }}>{t('bulk.plusOneMonth')}</Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={bulkMarkVerified}><Check className="w-3 h-3" /> {t('bulk.markVerified')}</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-muted-foreground" onClick={bulkClear}><Trash2 className="w-3 h-3" /> {t('bulk.clear')}</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={() => setSelected(new Set())}>{t('common.actions.cancel')}</Button>
        </div>
      )}

      {!isLoading && !isError && properties && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm p-4">
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><ShieldCheck className="w-3.5 h-3.5" /> {t('tiles.totalProperties')}</div>
            <p className="mt-1 text-3xl font-bold tabular-nums leading-none">{summary.total}</p>
          </div>
          <div className="rounded-2xl border border-card-border bg-card shadow-sm p-4">
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><CheckCircle2 className="w-3.5 h-3.5" /> {t('tiles.verified')}</div>
            <p className="mt-1 text-3xl font-bold tabular-nums leading-none text-success">{summary.verified}</p>
          </div>
          <div className={`rounded-2xl border shadow-sm p-4 ${summary.needs > 0 ? 'border-warning/30 bg-warning/5' : 'border-card-border bg-card'}`}>
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><AlertTriangle className="w-3.5 h-3.5" /> {t('tiles.needsVerification')}</div>
            <p className={`mt-1 text-3xl font-bold tabular-nums leading-none ${summary.needs > 0 ? 'text-warning' : ''}`}>{summary.needs}</p>
          </div>
          <div className={`rounded-2xl border shadow-sm p-4 ${summary.overdue > 0 ? 'border-destructive/30 bg-destructive/5' : 'border-card-border bg-card'}`}>
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><Clock className="w-3.5 h-3.5" /> {t('tiles.overdue')}</div>
            <p className={`mt-1 text-3xl font-bold tabular-nums leading-none ${summary.overdue > 0 ? 'text-destructive' : ''}`}>{summary.overdue}</p>
          </div>
        </div>
      )}

      {isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
      <div className="overflow-auto flex-1 rounded-2xl border border-border shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
            <tr>
              <th className="w-8 px-2 py-2 sticky left-0 top-0 z-30 bg-muted">
                <Checkbox
                  checked={paged.length > 0 && selected.size === paged.length}
                  onCheckedChange={toggleSelectAll}
                  aria-label={t('table.selectAllAria')}
                />
              </th>
              <th className={`${thCls} sticky left-8 top-0 z-30 bg-muted`} onClick={() => toggleSort('name')}>{t('table.property')} <SortIcon col="name" /></th>
              <th className={thCls} onClick={() => toggleSort('status')}>{t('table.status')} <SortIcon col="status" /></th>
              <th className={thCls} onClick={() => toggleSort('assignee')}>{t('table.assignee')} <SortIcon col="assignee" /></th>
              <th className={thCls} onClick={() => toggleSort('due_date')}>{t('table.due')} <SortIcon col="due_date" /></th>
              <th className={thCls} onClick={() => toggleSort('last_verified')}>{t('table.lastVerified')} <SortIcon col="last_verified" /></th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">{t('table.verifiedBy')}</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">{t('table.action')}</th>
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
                    title={showDueOnly ? t('table.emptyAllVerifiedTitle') : t('table.emptyNoPropertiesTitle')}
                    description={showDueOnly ? t('table.emptyAllVerifiedDescription') : t('table.emptyNoPropertiesDescription')}
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
                    className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${isSelected ? 'bg-primary/5' : status === 'never' ? 'bg-destructive/5' : status === 'due' ? 'bg-warning/5' : ''}`}
                  >
                    <td className="px-2 py-2 sticky left-0 z-10 bg-background" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(p.id)} aria-label={t('table.selectRowAria', { name: p.name })} />
                    </td>
                    <td className="py-2 px-3 font-medium text-xs sticky left-8 z-10 bg-background cursor-pointer" onClick={() => openWalkthrough(p)}>{p.name}</td>
                    <td className="py-2 px-3 cursor-pointer" onClick={() => openWalkthrough(p)}><StatusBadge status={status} /></td>
                    <td className="py-2 px-3 text-xs">{v?.assignee_name || <span className="text-muted-foreground">-</span>}</td>
                    <td className={`py-2 px-3 text-xs ${dueOverdue ? 'text-destructive font-medium' : ''}`}>{v?.due_date ? formatLocale(new Date(v.due_date + 'T00:00'), 'MMM d') : <span className="text-muted-foreground">-</span>}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground cursor-pointer" onClick={() => openWalkthrough(p)}>
                      {v?.verified_at ? (
                        <span>
                          {formatLocale(new Date(v.verified_at), 'MMM d, yyyy')}
                          <span className="ml-1 text-muted-foreground/60">{t('table.daysAgo', { count: daysSince ?? 0 })}</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 px-3 text-xs cursor-pointer" onClick={() => openWalkthrough(p)}>{v?.verified_by || '—'}</td>
                    <td className="py-2 px-3">
                      <Button size="sm" variant={status === 'verified' ? 'outline' : 'default'} className="h-8 text-xs gap-1 px-2" onClick={() => openWalkthrough(p)}>
                        <ClipboardCheck className="w-3 h-3" />
                        {status === 'verified' ? t('table.reVerify') : t('table.verify')}
                      </Button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      {/* Verification Walkthrough Sheet */}
      <Sheet open={!!activeProperty} onOpenChange={v => {
        if (!v && !saving) {
          if (isDirty && !confirm(t('confirm.unsavedChanges'))) return
          setActiveProperty(null)
          setIsDirty(false)
        }
      }}>
        <SheetContent side="right" className="w-full sm:w-[480px] overflow-y-auto">
          {activeProperty && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base">{activeProperty.name}</SheetTitle>
                <p className="text-xs text-muted-foreground">{activeProperty.address || t('form.noAddress')}</p>
              </SheetHeader>

              <div className="mt-4 space-y-6">
                {VERIFY_SECTIONS.map(section => (
                  <div key={section.title}>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t(`form.sections.${SECTION_TITLE_KEYS[section.title]}`, undefined, section.title)}</h3>
                    <div className="space-y-3">
                      {section.fields.map(f => {
                        const currentVal = editValues[f.key]
                        const originalVal = activeProperty[f.key]
                        const changed = String(currentVal ?? '') !== String(originalVal ?? '')
                        return (
                          <div key={f.key} className="grid grid-cols-[120px_1fr] items-center gap-2">
                            <label className="text-xs text-muted-foreground">{t(`form.fields.${f.key}`, undefined, f.label)}</label>
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
                                  {t('common.actions.no')}
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
                                  {t('common.actions.yes')}
                                </button>
                              </div>
                            ) : f.type === 'textarea' ? (
                              <textarea
                                value={currentVal ?? ''}
                                onChange={e => { setEditValues(v => ({ ...v, [f.key]: e.target.value })); setIsDirty(true) }}
                                className={`w-full h-16 rounded-md border px-2 py-1.5 text-xs resize-none bg-background focus:outline-none focus:ring-2 focus:ring-ring ${changed ? 'border-info/40 bg-info/10' : 'border-input'}`}
                              />
                            ) : (
                              <Input
                                type={f.type === 'number' ? 'number' : 'text'}
                                value={currentVal ?? ''}
                                onChange={e => { setEditValues(v => ({ ...v, [f.key]: f.type === 'number' ? (e.target.value ? Number(e.target.value) : null) : e.target.value })); setIsDirty(true) }}
                                className={`h-7 text-xs ${changed ? 'border-info/40 bg-info/10' : ''}`}
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
                    {saving ? t('common.actions.saving') : canEditView('property-verifications', effectiveUser) ? t('form.confirmVerification') : t('form.viewOnly')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (isDirty && !confirm(t('confirm.unsavedChanges'))) return
                      setActiveProperty(null)
                      setIsDirty(false)
                    }}
                    disabled={saving}
                  >
                    {t('common.actions.cancel')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageContainer>
  )
}
