import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, logActivity } from '@/lib/supabase'
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
} from 'lucide-react'
import { format, differenceInDays } from 'date-fns'

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

type SortKey = 'name' | 'status' | 'last_verified'

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

  // Fetch active + onboarding properties with all verifiable fields
  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/property-verification-list'],
    queryFn: async () => {
      const fields = ['id', 'name', 'stage_id', ...ALL_VERIFY_FIELDS.map(f => f.key)].join(', ')
      const { data, error } = await supabase
        .from('properties')
        .select(`${fields}, pipeline_stages!properties_stage_id_fkey(name)`)
        .eq('pipeline_stages.name', 'Active')
        .order('name')
      if (error) throw error
      return data || []
    },
  })

  // Fetch verification records
  const { data: verifications } = useQuery({
    queryKey: ['/supabase/property-verifications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_verifications')
        .select('property_id, verified_at, verified_by')
      if (error) throw error
      return data || []
    },
  })

  // Build lookup: property_id → last verification
  const verificationMap = useMemo(() => {
    const map: Record<string, { verified_at: string; verified_by: string }> = {}
    for (const v of (verifications || [])) {
      map[String(v.property_id)] = v
    }
    return map
  }, [verifications])

  function getStatus(p: any): 'due' | 'verified' | 'never' {
    const v = verificationMap[String(p.id)]
    if (!v) return 'never'
    const daysSince = differenceInDays(new Date(), new Date(v.verified_at))
    return daysSince >= 180 ? 'due' : 'verified'
  }

  function getDaysSince(p: any): number | null {
    const v = verificationMap[String(p.id)]
    if (!v) return null
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
      // status: never first, then due, then verified
      const order = { never: 0, due: 1, verified: 2 }
      return (order[getStatus(a)] - order[getStatus(b)]) * dir
    })
    return result
  }, [properties, verificationMap, search, showDueOnly, sortKey, sortDir])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  function openWalkthrough(p: any) {
    // Pre-populate edit values with current property data
    const vals: Record<string, any> = {}
    for (const f of ALL_VERIFY_FIELDS) {
      vals[f.key] = p[f.key]
    }
    setEditValues(vals)
    setActiveProperty(p)
  }

  async function saveVerification() {
    if (!activeProperty) return
    if (!canEditView('inspections', effectiveUser)) {
      toast({ title: 'Edit access required', description: "You don't have edit access to this page.", variant: 'destructive' })
      return
    }
    setSaving(true)

    // Find which fields changed
    const changes: Record<string, { old: any; new: any }> = {}
    const updates: Record<string, any> = {}
    for (const f of ALL_VERIFY_FIELDS) {
      const oldVal = activeProperty[f.key]
      const newVal = editValues[f.key]
      // Normalize for comparison
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
        toast({ title: 'Failed to update property', variant: 'destructive' })
        setSaving(false)
        return
      }
    }

    // Upsert verification record
    const { error: vError } = await supabase.from('property_verifications').upsert({
      property_id: activeProperty.id,
      verified_by: user?.label ?? null,
      verified_at: new Date().toISOString(),
      notes: editValues.notes !== activeProperty.notes ? 'Notes updated' : null,
      fields_updated: Object.keys(changes).length > 0 ? changes : null,
    }, { onConflict: 'property_id' })

    if (vError) {
      toast({ title: 'Failed to save verification', variant: 'destructive' })
      setSaving(false)
      return
    }

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
    toast({ title: 'Verification complete', description: Object.keys(changes).length > 0 ? `${Object.keys(changes).length} field(s) updated` : 'All info confirmed' })
    setActiveProperty(null)
    setSaving(false)
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
        v ? format(new Date(v.verified_at), 'yyyy-MM-dd') : '',
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
        <div className="flex items-center gap-2">
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

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th className={`${thCls} sticky left-0 z-20 bg-muted/80`} onClick={() => toggleSort('name')}>Property <SortIcon col="name" /></th>
              <th className={thCls} onClick={() => toggleSort('status')}>Status <SortIcon col="status" /></th>
              <th className={thCls} onClick={() => toggleSort('last_verified')}>Last Verified <SortIcon col="last_verified" /></th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Verified By</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(5)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5}>
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
                return (
                  <tr
                    key={p.id}
                    className={`border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer ${status === 'never' ? 'bg-red-50/30 dark:bg-red-900/5' : status === 'due' ? 'bg-amber-50/30 dark:bg-amber-900/5' : ''}`}
                    onClick={() => openWalkthrough(p)}
                  >
                    <td className="py-2 px-3 font-medium text-xs sticky left-0 z-10 bg-background">{p.name}</td>
                    <td className="py-2 px-3"><StatusBadge status={status} /></td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">
                      {v ? (
                        <span>
                          {format(new Date(v.verified_at), 'MMM d, yyyy')}
                          <span className="ml-1 text-muted-foreground/60">({daysSince}d ago)</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 px-3 text-xs">{v?.verified_by || '—'}</td>
                    <td className="py-2 px-3">
                      <Button size="sm" variant={status === 'verified' ? 'outline' : 'default'} className="h-8 text-xs gap-1 px-2">
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
      <Sheet open={!!activeProperty} onOpenChange={v => !v && !saving && setActiveProperty(null)}>
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
                                  onClick={() => setEditValues(v => ({ ...v, [f.key]: false }))}
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
                                  onClick={() => setEditValues(v => ({ ...v, [f.key]: true }))}
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
                                onChange={e => setEditValues(v => ({ ...v, [f.key]: e.target.value }))}
                                className={`w-full h-16 rounded-md border px-2 py-1.5 text-xs resize-none bg-background focus:outline-none focus:ring-2 focus:ring-ring ${changed ? 'border-blue-400 bg-blue-50/30 dark:bg-blue-900/10' : 'border-input'}`}
                              />
                            ) : (
                              <Input
                                type={f.type === 'number' ? 'number' : 'text'}
                                value={currentVal ?? ''}
                                onChange={e => setEditValues(v => ({ ...v, [f.key]: f.type === 'number' ? (e.target.value ? Number(e.target.value) : null) : e.target.value }))}
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
                    disabled={saving || !canEditView('inspections', effectiveUser)}
                  >
                    <Check className="w-3.5 h-3.5" />
                    {saving ? 'Saving…' : canEditView('inspections', effectiveUser) ? 'Confirm Verification' : 'View Only'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setActiveProperty(null)}
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
