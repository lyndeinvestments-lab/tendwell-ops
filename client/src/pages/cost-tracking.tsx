import React, { useState, useMemo, Fragment, useCallback, useEffect } from 'react'
import { useAlerts } from '@/pages/alerts'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase, logPropertyEdit } from '@/lib/supabase'
import { invalidateAllPropertyQueries } from '@/lib/query-invalidations'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { InlineEdit } from '@/components/InlineEdit'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { useAppSettings } from '@/hooks/use-app-settings'
import { ArrowUpDown, Search, Download, X, ChevronRight, ChevronDown, DollarSign as DollarSignIcon, RotateCcw, BedDouble, Lock, Wifi, Wind, ExternalLink, Trash2 } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { TablePagination } from '@/components/TablePagination'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/lib/auth'
import Papa from 'papaparse'
import { profitTier } from '@/lib/profit-colors'

type SortKey = 'name' | 'ce_charged' | 'cleaner_pay' | 'est_laundry' | 'est_consumables' | 'total_estimated_cost' | 'estimated_profit' | 'profit_percentage' | 'break_even_ce'

const STATUS_OPTIONS = ['Active', 'Onboarding', 'Offboarding', 'Offboarded']

function ProfitBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>
  const t = profitTier(pct)
  const cls = t === 'high' ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' :
              t === 'mid'  ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' :
                             'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
  const tier = t === 'high' ? 'High' : t === 'mid' ? 'Mid' : 'Low'
  return (
    <div className="flex items-center gap-1">
      <span data-testid={`badge-profit-${Math.round(pct)}`} className={`text-xs font-medium px-1.5 py-0.5 rounded border ${cls}`}>
        {pct.toFixed(1)}%
      </span>
      <span className={`text-xs font-medium px-1 py-0.5 rounded ${cls}`}>{tier}</span>
    </div>
  )
}

function StageBadge({ stage }: { stage: string | null }) {
  if (!stage) return <span className="text-muted-foreground text-xs">—</span>
  const colors: Record<string, string> = {
    Active: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    Onboarding: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    Offboarding: 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
    Lead: 'text-gray-600 bg-gray-50 border-gray-200',
    Quote: 'text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
  }
  const cls = colors[stage] || 'text-gray-600 bg-gray-50 border-gray-200'
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${cls}`}>{stage}</span>
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-muted-foreground block">{label}</span>
      <span className="font-medium break-words">{value}</span>
    </div>
  )
}

// Setup status tiles for the expanded Master List row. Surfaces the four
// operational onboarding signals (linen, lock access, Wi-Fi, AC filter) with
// Complete / Partial / Missing badges and a deep link to the relevant page.
// Linen logic intentionally does NOT treat individual zero bed types as
// missing — a property can legitimately have no king/queen/full/twin beds.
// Linen is "complete" when the aggregate bed count is positive AND the core
// towel set is populated.
function SetupStatusTiles({
  property,
  canEdit,
  onUpdate,
}: {
  property: any
  canEdit: boolean
  onUpdate: (field: string, value: number | string | boolean | null) => void
}) {
  const bedTotal =
    (Number(property.king_beds) || 0) +
    (Number(property.queen_beds) || 0) +
    (Number(property.full_beds) || 0) +
    (Number(property.twin_beds) || 0)
  const coreTowels = ['bath_towels', 'hand_towels', 'washcloths'] as const
  const hasAnyTowel = coreTowels.some(k => property[k] != null && Number(property[k]) > 0)
  const hasAllCoreTowels = coreTowels.every(k => property[k] != null && Number(property[k]) > 0)
  const hasBathmats = property.bathmats != null && Number(property.bathmats) > 0
  const hasBedConfig = bedTotal > 0
  const linenMissing: string[] = []
  if (!hasBedConfig) linenMissing.push('bed counts')
  if (!hasAllCoreTowels) {
    for (const t of coreTowels) {
      if (property[t] == null || Number(property[t]) === 0) linenMissing.push(t.replace('_', ' '))
    }
  }
  if (!hasBathmats && (Number(property.full_baths) || 0) > 0) linenMissing.push('bathmats')
  const linenStatus: 'complete' | 'partial' | 'missing' =
    !hasAnyTowel && !hasBedConfig
      ? 'missing'
      : hasBedConfig && hasAllCoreTowels
        ? 'complete'
        : 'partial'

  const hasAuto = !!(property.auto_code && String(property.auto_code).trim())
  const hasDoor = !!(property.door_code && String(property.door_code).trim())
  const hasOther = !!(property.other_codes && String(property.other_codes).trim())
  const lockStatus: 'complete' | 'missing' = (hasAuto || hasDoor || hasOther) ? 'complete' : 'missing'

  const hasWifi = !!(property.wifi_info && String(property.wifi_info).trim())
  const wifiStatus: 'complete' | 'missing' = hasWifi ? 'complete' : 'missing'

  const hasFilterSize = !!(property.filter_size && String(property.filter_size).trim())
  const filterStatus: 'complete' | 'missing' = hasFilterSize ? 'complete' : 'missing'

  const STATUS_STYLES: Record<string, string> = {
    complete: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-800',
    partial: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    missing: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800',
  }
  const STATUS_LABELS: Record<string, string> = { complete: 'Complete', partial: 'Partial', missing: 'Missing' }

  function StatusBadge({ status }: { status: 'complete' | 'partial' | 'missing' }) {
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-medium ${STATUS_STYLES[status]}`}
        data-testid={`setup-badge-${status}`}
      >
        {STATUS_LABELS[status]}
      </span>
    )
  }

  function Tile({
    icon: Icon,
    title,
    status,
    href,
    children,
    testId,
  }: {
    icon: React.ComponentType<{ className?: string }>
    title: string
    status: 'complete' | 'partial' | 'missing'
    href: string
    children: React.ReactNode
    testId: string
  }) {
    return (
      <div className="rounded-md border border-border bg-card p-3 flex flex-col gap-2" data-testid={testId}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Icon className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold">{title}</span>
          </div>
          <StatusBadge status={status} />
        </div>
        <div className="text-xs text-muted-foreground space-y-1">{children}</div>
        <a
          href={href}
          className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 self-start mt-1"
        >
          Open {title} <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    )
  }

  // Inline editable cell — reuses the table-cell InlineEdit component when the
  // user has edit permission, otherwise renders a plain value. Numeric fields
  // store null when cleared so empty cells stay distinguishable from zero.
  function NumCell({ field, parse = 'int' }: { field: string; parse?: 'int' | 'float' }) {
    const v = property[field]
    if (!canEdit) {
      return <span className="text-foreground tabular-nums text-right">{v ?? '—'}</span>
    }
    return (
      <span className="text-right">
        <InlineEdit
          value={v}
          type="number"
          placeholder="—"
          onSave={raw => {
            const trimmed = raw.trim()
            if (trimmed === '') return onUpdate(field, null)
            const n = parse === 'int' ? parseInt(trimmed, 10) : parseFloat(trimmed)
            onUpdate(field, Number.isFinite(n) ? n : null)
          }}
          testId={`setup-edit-${field}-${property.id}`}
        />
      </span>
    )
  }

  function TextCell({ field, placeholder = '—' }: { field: string; placeholder?: string }) {
    const v = property[field]
    if (!canEdit) {
      return <span className="text-foreground truncate text-right">{v && String(v).trim() ? v : placeholder}</span>
    }
    return (
      <span className="text-right block min-w-0">
        <InlineEdit
          value={v}
          type="text"
          placeholder={placeholder}
          onSave={raw => onUpdate(field, raw.trim() === '' ? null : raw.trim())}
          testId={`setup-edit-${field}-${property.id}`}
        />
      </span>
    )
  }

  function DateCell({ field }: { field: string }) {
    const v = property[field]
    if (!canEdit) {
      return <span className="text-foreground text-right">{v ? String(v).slice(0, 10) : '—'}</span>
    }
    return (
      <span className="text-right block">
        <InlineEdit
          value={v ? String(v).slice(0, 10) : ''}
          type="date"
          placeholder="—"
          onSave={raw => onUpdate(field, raw.trim() === '' ? null : raw.trim())}
          testId={`setup-edit-${field}-${property.id}`}
        />
      </span>
    )
  }

  return (
    <div data-testid={`setup-status-tiles-${property.id}`}>
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Setup Status
        {canEdit && (
          <span className="ml-2 text-[10px] font-normal text-muted-foreground/70 normal-case tracking-normal">
            · Click any value to edit
          </span>
        )}
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={BedDouble} title="Linen Setup" status={linenStatus} href="/linen-tracker" testId={`tile-linen-${property.id}`}>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            <span>King beds</span>
            <NumCell field="king_beds" />
            <span>Queen beds</span>
            <NumCell field="queen_beds" />
            <span>Full beds</span>
            <NumCell field="full_beds" />
            <span>Twin beds</span>
            <NumCell field="twin_beds" />
            <span>Bath towels</span>
            <NumCell field="bath_towels" />
            <span>Hand towels</span>
            <NumCell field="hand_towels" />
            <span>Washcloths</span>
            <NumCell field="washcloths" />
            <span>Bath mats</span>
            <NumCell field="bathmats" />
            <span>Pool towels</span>
            <NumCell field="pool_towels" />
          </div>
          {linenStatus !== 'complete' && linenMissing.length > 0 && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400">Missing: {linenMissing.join(', ')}</p>
          )}
        </Tile>

        <Tile icon={Lock} title="Lock Access Setup" status={lockStatus} href="/access-codes" testId={`tile-lock-${property.id}`}>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <span>Auto code</span>
            <TextCell field="auto_code" />
            <span>Door code</span>
            <TextCell field="door_code" />
            <span>Other</span>
            <TextCell field="other_codes" />
          </div>
          {lockStatus === 'missing' && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400">
              Add at least one: auto code, door code, or other access info.
            </p>
          )}
        </Tile>

        <Tile icon={Wifi} title="Wi-Fi Setup" status={wifiStatus} href="/access-codes" testId={`tile-wifi-${property.id}`}>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <span>Wi-Fi info</span>
            <TextCell field="wifi_info" placeholder="SSID / password / notes" />
          </div>
          {!hasWifi && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400">Add SSID and password (or unit instructions).</p>
          )}
        </Tile>

        <Tile icon={Wind} title="AC Filter Setup" status={filterStatus} href="/ac-filters" testId={`tile-filter-${property.id}`}>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <span>Filter size</span>
            <TextCell field="filter_size" placeholder='e.g. 16x25x1' />
            <span>Last change</span>
            <DateCell field="last_filter_changed" />
            {property.next_filter_due && (
              <>
                <span>Next due</span>
                <span className="text-foreground text-right">{String(property.next_filter_due).slice(0, 10)}</span>
              </>
            )}
          </div>
          {filterStatus === 'missing' && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400">Filter size required for filter scheduling.</p>
          )}
        </Tile>
      </div>
    </div>
  )
}

function AssignCleanerInline({ propertyId }: { propertyId: string }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [date, setDate] = useState('')
  const [cleanerId, setCleanerId] = useState('')

  const { data: cleaners } = useQuery({
    queryKey: ['/supabase/cleaners-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cleaners').select('id, full_name').eq('is_active', true).order('full_name')
      if (error) throw error
      return data || []
    },
    staleTime: 60_000,
  })

  const { mutate: addAssignment, isPending } = useGuardedMutation('cost-tracking', {
    mutationFn: async () => {
      const { error } = await supabase.from('clean_assignments').insert({
        property_id: propertyId,
        cleaner_id: cleanerId,
        scheduled_date: date,
        status: 'scheduled',
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/all-assignments'] })
      toast({ title: 'Assignment added' })
      setDate('')
      setCleanerId('')
    },
    onError: () => toast({ title: 'Failed to add assignment', variant: 'destructive' }),
  })

  return (
    <div className="mt-3 pt-2 border-t border-border/40">
      <span className="text-muted-foreground block mb-1 text-xs">Assign Cleaner</span>
      <div className="flex items-center gap-2">
        <select
          value={cleanerId}
          onChange={e => setCleanerId(e.target.value)}
          className="h-6 text-xs border border-input rounded px-1 bg-background flex-1"
        >
          <option value="">Select cleaner…</option>
          {(cleaners || []).map((c: any) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
        </select>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="h-6 text-xs border border-input rounded px-1 bg-background"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs px-2"
          disabled={!cleanerId || !date || isPending}
          onClick={() => addAssignment()}
        >
          Add
        </Button>
      </div>
    </div>
  )
}

export default function CostTrackingPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { openPropertyModal } = usePropertyModal()
  const { effectiveUser, isEmulating } = useAuth()
  // Mirror the master-list permission model: editing requires the
  // master-list edit grant, archive requires admin role. Emulated sessions
  // (admin viewing as another user) are read-only on both.
  const canEditSetup = !isEmulating && (
    !!effectiveUser?.resolvedPermissions['master-list']?.edit
    || !!effectiveUser?.resolvedPermissions['cost-tracking']?.edit
    || !!effectiveUser?.resolvedPermissions['property-list']?.edit
  )
  const isAdmin = !isEmulating && effectiveUser?.role === 'admin'
  usePageTitle('Master List')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [bulkEditMode, setBulkEditMode] = useState(false)
  const [bulkChanges, setBulkChanges] = useState<Record<string, number>>({})
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [localProperties, setLocalProperties] = useState<any[] | null>(null)
  const [flashedCells, setFlashedCells] = useState<Set<string>>(new Set())
  // Master-list consolidation: when true, query the full `properties` table to
  // include non-operational stages (Lead, Quote, Offboarded). Default off so
  // existing Cost Tracking users see the same set of rows they're used to.
  const [showAllStages, setShowAllStages] = useState(false)

  // Read ?stage= deep link from /master-list → /cost-tracking redirects so old
  // links from the dashboard cards keep working post-consolidation.
  useEffect(() => {
    const hash = window.location.hash || ''
    const qIdx = hash.indexOf('?')
    if (qIdx === -1) return
    const params = new URLSearchParams(hash.slice(qIdx))
    const urlStage = params.get('stage')
    if (urlStage) {
      const normalized = urlStage.charAt(0).toUpperCase() + urlStage.slice(1)
      if (STATUS_OPTIONS.includes(normalized)) {
        setStatusFilter(normalized)
        setPage(1)
      } else if (urlStage === 'all') {
        setShowAllStages(true)
      }
      window.history.replaceState(null, '', window.location.pathname + hash.slice(0, qIdx))
    }
  }, [])

  const { getNumber } = useAppSettings()
  const inspectionCost = getNumber('cost_inspection', 15)
  const trashCost = getNumber('cost_trash', 5)
  const breakEvenMargin = getNumber('break_even_target_margin', 0.20)

  const { activeAlerts } = useAlerts()
  const alertByPropertyId = useMemo(() => {
    const map: Record<string, { severity: string; title: string }> = {}
    for (const a of activeAlerts) {
      if (a.propertyId && (a.category === 'Financial' || a.category === 'Data Quality')) {
        if (!map[a.propertyId] || a.severity === 'critical') {
          map[a.propertyId] = { severity: a.severity, title: a.title }
        }
      }
    }
    return map
  }, [activeAlerts])

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/operational_properties', showAllStages ? 'all-stages' : 'operational'],
    queryFn: async () => {
      // Pull every operational_properties view column so the merged Master List
      // expanded row can show all property details — address, bed mix, codes,
      // linen counts, dates — without a second round-trip.
      if (showAllStages) {
        // Note: properties RLS already filters out soft-deleted rows
        // (deleted_at IS NULL), so no client-side archived/deleted filter
        // is needed. (Earlier code referenced a non-existent `archived_at`
        // column, which caused PostgREST to error and silently return no
        // rows — that's why expanded-row Client showed "—".)
        const { data, error } = await supabase
          .from('properties')
          .select('*, pipeline_stages!properties_stage_id_fkey(name, slug, color)')
        if (error) throw error
        // Flatten stage_name/slug/color into top-level fields so the row
        // renderer matches the operational_properties view shape.
        return (data || []).map((p: any) => ({
          ...p,
          stage_name: p.pipeline_stages?.name || null,
          stage_slug: p.pipeline_stages?.slug || null,
          stage_color: p.pipeline_stages?.color || null,
        }))
      }
      const { data, error } = await supabase
        .from('operational_properties')
        .select('*')
      if (error) throw error
      return data || []
    },
  })

  // Sync local state from server data (replaces deprecated onSuccess)
  useEffect(() => {
    if (properties) setLocalProperties(properties as any[])
  }, [properties])

  // Contacts lookup so the expanded row Client cell can display the same
  // linked contact (full_name / company / payment_method) as the full
  // PropertyDetailModal. The operational_properties view does not expose
  // contact_id, so we pull contact_id from the underlying `properties`
  // table joined to `contacts` in one round-trip. Mirrors the embedded
  // join used in client/src/pages/master-list.tsx so behavior matches.
  const { data: propertyContacts } = useQuery({
    queryKey: ['/supabase/properties_contact_join_cost_tracking'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, contact_id, client, contact:contacts(id, full_name, company, payment_method)')
      if (error) throw error
      return data || []
    },
  })

  // Index by property id. Each entry carries the joined contact (when set)
  // plus the legacy free-text `client` column as a final fallback.
  const contactByPropertyId = useMemo(() => {
    const m: Record<string, {
      contact: { full_name?: string; company?: string; payment_method?: string } | null
      legacyClient: string | null
    }> = {}
    for (const r of (propertyContacts as any[]) || []) {
      const c = Array.isArray(r.contact) ? r.contact[0] : r.contact
      m[String(r.id)] = {
        contact: c && c.full_name ? c : null,
        legacyClient: r.client || null,
      }
    }
    return m
  }, [propertyContacts])

  // Resolve a single, consistent client display string for a property row.
  // Preference order:
  //   1) Joined contact (full_name + optional company)
  //   2) Embedded contact already on the row (showAllStages joins it)
  //   3) Legacy free-text `client` / `client_name` / `company` fields
  function resolveClient(p: any): {
    label: string | null
    paymentMethod: string | null
  } {
    const joined = contactByPropertyId[String(p.id)]
    const embedded = p?.contact && (Array.isArray(p.contact) ? p.contact[0] : p.contact)
    const c = joined?.contact
      || (embedded && embedded.full_name ? embedded : null)
    if (c?.full_name) {
      const label = c.company && c.company !== c.full_name
        ? `${c.full_name} (${c.company})`
        : c.full_name
      return { label, paymentMethod: c.payment_method || null }
    }
    const fallback = joined?.legacyClient
      || p.client
      || p.client_name
      || p.company
      || null
    return { label: fallback, paymentMethod: null }
  }

  const displayProperties: any[] = localProperties ?? (properties as any[]) ?? []

  function flashCell(cellId: string) {
    setFlashedCells(prev => new Set(prev).add(cellId))
    setTimeout(() => setFlashedCells(prev => { const s = new Set(prev); s.delete(cellId); return s }), 1500)
  }

  // Live-preview the derivatives while the user is still typing into a cell.
  // Doesn't hit the DB — just patches localProperties so Total Cost / Profit /
  // Profit % / Totals row reflect the in-progress draft value. On blur/Enter,
  // updateProperty.onMutate does the same recompute and persists.
  function previewCostChange(id: string, field: string, draft: string) {
    const COST_FIELDS = new Set(['ce_charged', 'cleaner_pay', 'est_laundry', 'est_consumables'])
    if (!COST_FIELDS.has(field)) return
    const parsed = draft === '' ? null : parseFloat(draft)
    const nextValue = parsed != null && Number.isNaN(parsed) ? null : parsed
    setLocalProperties(prev => prev ? prev.map(p => {
      if (p.id !== id) return p
      const updated: any = { ...p, [field]: nextValue }
      const pay = Number(updated.cleaner_pay) || 0
      const laundry = Number(updated.est_laundry) || 0
      const consumables = Number(updated.est_consumables) || 0
      const linen = updated.linen_program
        ? (Number(updated.number_of_beds) || 0) * 300 / 12 / 4
        : 0
      const totalCost = pay + laundry + consumables + inspectionCost + trashCost + linen
      updated.total_estimated_cost = Math.round(totalCost * 100) / 100
      updated.linen_program_cost = Math.round(linen * 100) / 100
      const ce = Number(updated.ce_charged) || 0
      updated.estimated_profit = Math.round((ce - totalCost) * 100) / 100
      updated.profit_percentage = ce > 0
        ? Math.round(((ce - totalCost) / ce * 100) * 10) / 10
        : 0
      return updated
    }) : prev)
  }

  const { mutate: updateProperty } = useGuardedMutation('cost-tracking', {
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: number | string | boolean | null }) => {
      const { error } = await supabase.from('properties').update({ [field]: value }).eq('id', id)
      if (error) throw error
    },
    onMutate: ({ id, field, value }) => {
      const snapshot = localProperties ? [...localProperties] : null
      const oldProp = snapshot?.find(p => p.id === id)
      const oldValue = oldProp?.[field] ?? null
      const propName = oldProp?.name ?? null
      const COST_FIELDS = new Set(['ce_charged', 'cleaner_pay', 'est_laundry', 'est_consumables'])
      setLocalProperties(prev => prev ? prev.map(p => {
        if (p.id !== id) return p
        const updated: any = { ...p, [field]: value }
        // Live-recompute derivatives so Total Cost / Profit / Profit % update
        // immediately. Mirrors the DB trigger in 20260413_fix_laundry_constant.sql.
        if (COST_FIELDS.has(field)) {
          const pay = Number(updated.cleaner_pay) || 0
          const laundry = Number(updated.est_laundry) || 0
          const consumables = Number(updated.est_consumables) || 0
          const linen = updated.linen_program
            ? (Number(updated.number_of_beds) || 0) * 300 / 12 / 4
            : 0
          const totalCost = pay + laundry + consumables + inspectionCost + trashCost + linen
          updated.total_estimated_cost = Math.round(totalCost * 100) / 100
          updated.linen_program_cost = Math.round(linen * 100) / 100
          const ce = Number(updated.ce_charged) || 0
          updated.estimated_profit = Math.round((ce - totalCost) * 100) / 100
          updated.profit_percentage = ce > 0
            ? Math.round(((ce - totalCost) / ce * 100) * 10) / 10
            : 0
        }
        return updated
      }) : prev)
      return { snapshot, oldValue, propName }
    },
    onSuccess: (_, { id, field, value }, ctx: any) => {
      // Audit log is typed for primitives; coerce booleans (hot_tub /
      // pet_friendly toggles) into 1/0 so the entry stays comparable.
      const logValue: string | number | null =
        typeof value === 'boolean' ? (value ? 1 : 0) : value
      logPropertyEdit(id, field, ctx?.oldValue, logValue, ctx?.propName)
      invalidateAllPropertyQueries(qc)
      qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
      flashCell(`${id}-${field}`)
      toast({ title: 'Saved' })
    },
    onError: (_, __, ctx: any) => {
      if (ctx?.snapshot) setLocalProperties(ctx.snapshot)
      toast({ title: 'Update failed', variant: 'destructive' })
    },
  })

  // Admin-only soft-delete. Mirrors master-list behavior: writes deleted_at
  // so the property disappears from any view that uses the standard RLS
  // (deleted_at IS NULL) policy. Recoverable for 30 days from the Master List
  // archive panel.
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)
  const { mutate: archiveProperty, isPending: archivePending } = useGuardedMutation('master-list', {
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('properties')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, id) => {
      const prop = (localProperties ?? properties)?.find((p: any) => p.id === id)
      // Drop the row locally so the table updates before the refetch lands.
      setLocalProperties(prev => prev ? prev.filter(p => p.id !== id) : prev)
      if (expandedRow === id) setExpandedRow(null)
      invalidateAllPropertyQueries(qc)
      qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      setConfirmArchiveId(null)
      toast({
        title: `Archived ${prop?.name ?? 'property'}`,
        description: 'Recoverable for 30 days from the Master List archive panel.',
      })
    },
    onError: (e: any) => {
      setConfirmArchiveId(null)
      toast({ title: 'Archive failed: ' + (e?.message || 'Unknown error'), variant: 'destructive' })
    },
  })

  const resetRow = useCallback(async (id: string) => {
    const { error } = await supabase.from('properties')
      .update({ est_laundry: null, est_consumables: null })
      .eq('id', id)
    if (error) { toast({ title: 'Reset failed', variant: 'destructive' }); return }
    invalidateAllPropertyQueries(qc)
    toast({ title: 'Row reset to defaults' })
  }, [qc, toast])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    if (!displayProperties.length && isLoading) return []
    let arr = displayProperties.filter((p: any) => {
      const q = search.toLowerCase()
      const matchSearch = !q || (
        p.name?.toLowerCase().includes(q)
        || p.stage_name?.toLowerCase().includes(q)
        || p.address?.toLowerCase().includes(q)
        || p.client?.toLowerCase().includes(q)
      )
      const matchStatus = statusFilter === 'all' || p.stage_name === statusFilter
      return matchSearch && matchStatus
    })
    arr = [...arr].sort((a: any, b: any) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [displayProperties, search, statusFilter, sortKey, sortDir])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  // Stage tally across the loaded set (pre-filter) so the badge bar always
  // reflects portfolio composition, not the active filter view.
  const stageTally = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of displayProperties) {
      const k = p.stage_name || 'Unknown'
      counts[k] = (counts[k] || 0) + 1
    }
    return counts
  }, [displayProperties])

  const totals = useMemo(() => {
    if (!filtered?.length) return null
    const ceTotal = filtered.reduce((s: number, p: any) => s + (p.ce_charged || 0), 0)
    const payTotal = filtered.reduce((s: number, p: any) => s + (p.cleaner_pay || 0), 0)
    const laundryTotal = filtered.reduce((s: number, p: any) => s + (p.est_laundry || 0), 0)
    const consumablesTotal = filtered.reduce((s: number, p: any) => s + (p.est_consumables || 0), 0)
    const costTotal = filtered.reduce((s: number, p: any) => s + (p.total_estimated_cost || 0), 0)
    const profitTotal = filtered.reduce((s: number, p: any) => s + (p.estimated_profit || 0), 0)
    const avgProfitPct = ceTotal > 0
      ? filtered.reduce((s: number, p: any) => {
          const w = (p.ce_charged || 0) / ceTotal
          return s + (p.profit_percentage || 0) * w
        }, 0)
      : filtered.length > 0
        ? filtered.reduce((s: number, p: any) => s + (p.profit_percentage || 0), 0) / filtered.length
        : 0
    return { ceTotal, payTotal, laundryTotal, consumablesTotal, costTotal, profitTotal, avgProfitPct }
  }, [filtered])

  function exportCsv() {
    const rows = filtered.map((p: any) => ({
      'Property': p.name || '',
      'Status': p.stage_name || '',
      'Client Charged': p.ce_charged ?? '',
      'Cleaner Pay': p.cleaner_pay ?? '',
      'Laundry': p.est_laundry ?? '',
      'Consumables': p.est_consumables ?? '',
      'Total Cost': p.total_estimated_cost ?? '',
      'Profit': p.estimated_profit ?? '',
      'Profit %': p.profit_percentage != null ? `${p.profit_percentage.toFixed(1)}%` : '',
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'cost-tracking.csv'; a.click()
    URL.revokeObjectURL(url)
    toast({ title: 'CSV exported', description: `${rows.length} rows exported` })
  }

  async function bulkSaveAll() {
    try {
      await Promise.all(
        Object.entries(bulkChanges).map(([id, value]) =>
          supabase.from('properties').update({ cleaner_pay: value }).eq('id', id).then(({ error }) => { if (error) throw error })
        )
      )
      invalidateAllPropertyQueries(qc)
      toast({ title: `Updated ${Object.keys(bulkChanges).length} properties` })
      setBulkEditMode(false)
      setBulkChanges({})
    } catch {
      toast({ title: 'Bulk update failed', variant: 'destructive' })
    }
  }

  const thCls = 'text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap'

  function SortIcon({ col }: { col: SortKey }) {
    return <ArrowUpDown className={`w-3 h-3 inline ml-1 ${sortKey === col ? 'text-primary' : 'text-muted-foreground/40'}`} />
  }

  return (
    <div className="p-5 h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Master List <span className="text-muted-foreground text-sm font-normal">· Cost Tracking</span></h1>
          <p className="text-sm text-muted-foreground">Unified property + cost view. Click cells to edit financials. Expand a row for full Master List details (address, beds/baths, codes, linens, dates).</p>
          {!isLoading && Object.keys(stageTally).length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap" data-testid="stage-tally">
              <span className="text-xs text-muted-foreground">Showing:</span>
              {(['Active', 'Onboarding', 'Offboarding', 'Lead', 'Quote', 'Offboarded'] as const).map(stage => {
                const n = stageTally[stage] || 0
                if (n === 0) return null
                return (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => { setStatusFilter(statusFilter === stage ? 'all' : stage); setPage(1) }}
                    className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
                    title={`Filter to ${stage}`}
                    data-testid={`tally-${stage}`}
                  >
                    <span className="inline-flex items-center gap-1 align-middle">
                      <StageBadge stage={stage} />
                      <span className={`text-xs font-semibold ${statusFilter === stage ? 'text-primary' : 'text-foreground'}`}>{n}</span>
                    </span>
                  </button>
                )
              })}
              <span className="text-xs text-muted-foreground">· Total {displayProperties.length}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none" title="Include Lead, Quote, and Offboarded properties">
            <input
              type="checkbox"
              checked={showAllStages}
              onChange={e => { setShowAllStages(e.target.checked); setPage(1) }}
              className="h-3.5 w-3.5"
              data-testid="checkbox-all-stages"
            />
            All stages
          </label>
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1) }}>
            <SelectTrigger className="h-8 w-44 text-sm" data-testid="select-status-filter">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUS_OPTIONS.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              data-testid="input-search-cost"
              className="pl-8 pr-8 h-8 w-56 text-sm"
            />
            {search && (
              <button
                onClick={() => { setSearch(''); setPage(1) }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0} className="h-8 gap-1.5 text-xs" data-testid="button-export-csv">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
          <Button
            variant={bulkEditMode ? "default" : "outline"}
            size="sm"
            onClick={() => { setBulkEditMode(m => !m); setBulkChanges({}) }}
            className="h-8 gap-1.5 text-xs"
            data-testid="button-bulk-edit"
          >
            {bulkEditMode ? 'Exit Bulk Edit' : 'Bulk Edit'}
          </Button>
        </div>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
            <tr>
              <th className={`${thCls} sticky left-0 top-0 z-30 bg-muted`} onClick={() => toggleSort('name')}><span className="pl-6">Property</span> <SortIcon col="name" /></th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Status</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Address</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Bd / Ba</th>
              <th className={thCls} onClick={() => toggleSort('ce_charged')}>Client Charged <SortIcon col="ce_charged" /></th>
              <th className={thCls} onClick={() => toggleSort('cleaner_pay')}>Cleaner Pay <SortIcon col="cleaner_pay" /></th>
              <th className={thCls} onClick={() => toggleSort('est_laundry')} title="Formula: beds × 11.5 lbs × $0.69/lb (≈ $7.94 per bed). Editable per row.">Laundry <SortIcon col="est_laundry" /></th>
              <th className={thCls} onClick={() => toggleSort('est_consumables')} title="Formula: (baths × (bath + TP)) + (kitchens × kitchen) + (beds × trash bag) + (hot tub chems). Rates from Settings. Editable per row.">Consumables <SortIcon col="est_consumables" /></th>
              <th className={thCls}>Inspection</th>
              <th className={thCls}>Trash</th>
              <th className={thCls} onClick={() => toggleSort('total_estimated_cost')}>Total Cost <SortIcon col="total_estimated_cost" /></th>
              <th className={thCls} onClick={() => toggleSort('estimated_profit')}>Profit <SortIcon col="estimated_profit" /></th>
              <th className={thCls} onClick={() => toggleSort('profit_percentage')}>Profit % <SortIcon col="profit_percentage" /></th>
              <th className={thCls} onClick={() => toggleSort('break_even_ce')} title={`CE needed to break even at ${Math.round(breakEvenMargin * 100)}% margin`}>B/E CE <SortIcon col="break_even_ce" /></th>
              <th className={thCls} title="$0.30 / sq ft">DC Cost</th>
              <th className={thCls} title="3× Client Charged">DC Income</th>
              <th className={thCls} title="DC Income − DC Cost">DC Profit</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(17)].map((_, j) => (
                    <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={17}>
                  <EmptyState icon={DollarSignIcon} title="No properties found" description="No operational properties match your current filters." />
                </td>
              </tr>
            ) : (
              paged.map((p: any) => (
                <Fragment key={p.id}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                <tr data-testid={`row-property-${p.id}`} className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${alertByPropertyId[String(p.id)]?.severity === 'critical' ? 'bg-red-50/50 dark:bg-red-900/10' : alertByPropertyId[String(p.id)]?.severity === 'warning' ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}>
                  <td className="py-2 px-3 font-medium text-xs sticky left-0 z-10 bg-card">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setExpandedRow(prev => prev === p.id ? null : p.id)}
                        className="p-0.5 rounded hover:bg-muted"
                        data-testid={`chevron-${p.id}`}
                      >
                        {expandedRow === p.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                      {alertByPropertyId[String(p.id)] && (
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${alertByPropertyId[String(p.id)].severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'}`}
                          title={alertByPropertyId[String(p.id)].title}
                        />
                      )}
                      <button
                        onClick={() => openPropertyModal(p.id)}
                        className="hover:underline text-left max-w-[200px] truncate"
                        title={p.name}
                        data-testid={`link-property-${p.id}`}
                      >
                        {p.name}
                      </button>
                    </div>
                  </td>
                  <td className="py-2 px-3"><StageBadge stage={p.stage_name} /></td>
                  <td className="py-2 px-3 text-xs text-muted-foreground max-w-[200px] truncate" title={p.address || ''}>{p.address || '—'}</td>
                  <td className="py-2 px-3 text-xs whitespace-nowrap">
                    {(p.bedrooms != null || p.full_baths != null) ? (
                      <span>
                        <span className="font-medium">{p.bedrooms ?? '—'}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="font-medium">{p.full_baths ?? '—'}</span>
                        {p.half_baths ? <span className="text-muted-foreground">+{p.half_baths}½</span> : null}
                        {p.square_footage ? <span className="text-muted-foreground"> · {Number(p.square_footage).toLocaleString()} sf</span> : null}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={`py-2 px-3 transition-all duration-300 ${flashedCells.has(`${p.id}-ce_charged`) ? 'ring-2 ring-green-400 rounded' : ''}`}>
                    <InlineEdit
                      value={p.ce_charged}
                      type="number"
                      onDraftChange={v => previewCostChange(p.id, 'ce_charged', v)}
                      onSave={v => {
                        const parsed = v ? parseFloat(v) : null
                        if ((parsed === 0 || parsed === null) && p.stage_name === 'Active') {
                          toast({ title: 'Warning: $0 CE will show as negative profit', description: 'This property will appear in Missing Financial Data alerts.', variant: 'destructive' })
                        }
                        updateProperty({ id: p.id, field: 'ce_charged', value: parsed })
                      }}
                      testId={`inline-ce-${p.id}`}
                    />
                  </td>
                  <td className={`py-2 px-3 transition-all duration-300 ${flashedCells.has(`${p.id}-cleaner_pay`) ? 'ring-2 ring-green-400 rounded' : ''}`}>
                    {bulkEditMode ? (
                      <input
                        type="number"
                        defaultValue={p.cleaner_pay}
                        onChange={e => setBulkChanges(prev => ({...prev, [p.id]: parseFloat(e.target.value) || 0}))}
                        className="h-6 text-xs w-20 border border-input rounded px-1"
                        data-testid={`bulk-pay-${p.id}`}
                      />
                    ) : (
                      <InlineEdit
                        value={p.cleaner_pay}
                        type="number"
                        onDraftChange={v => previewCostChange(p.id, 'cleaner_pay', v)}
                        onSave={v => updateProperty({ id: p.id, field: 'cleaner_pay', value: v ? parseFloat(v) : null })}
                        testId={`inline-pay-${p.id}`}
                      />
                    )}
                  </td>
                  <td className={`py-2 px-3 transition-all duration-300 ${flashedCells.has(`${p.id}-est_laundry`) ? 'ring-2 ring-green-400 rounded' : ''}`}>
                    <InlineEdit
                      value={p.est_laundry}
                      type="number"
                      onDraftChange={v => previewCostChange(p.id, 'est_laundry', v)}
                      onSave={v => updateProperty({ id: p.id, field: 'est_laundry', value: v ? parseFloat(v) : null })}
                      testId={`inline-laundry-${p.id}`}
                    />
                  </td>
                  <td className={`py-2 px-3 transition-all duration-300 ${flashedCells.has(`${p.id}-est_consumables`) ? 'ring-2 ring-green-400 rounded' : ''}`}>
                    <InlineEdit
                      value={p.est_consumables}
                      type="number"
                      onDraftChange={v => previewCostChange(p.id, 'est_consumables', v)}
                      onSave={v => updateProperty({ id: p.id, field: 'est_consumables', value: v ? parseFloat(v) : null })}
                      testId={`inline-consumables-${p.id}`}
                    />
                  </td>
                  <td className="py-2 px-3 tabular-nums text-xs text-muted-foreground">{fmt(inspectionCost)}</td>
                  <td className="py-2 px-3 tabular-nums text-xs text-muted-foreground">{fmt(trashCost)}</td>
                  <td className="py-2 px-3 tabular-nums text-xs font-medium">{fmt(p.total_estimated_cost)}</td>
                  <td className="py-2 px-3 tabular-nums text-xs font-medium">{fmt(p.estimated_profit)}</td>
                  <td className="py-2 px-3"><ProfitBadge pct={p.profit_percentage} /></td>
                  <td className="py-2 px-3 tabular-nums text-xs text-muted-foreground italic">
                    {p.total_estimated_cost != null ? '$' + (p.total_estimated_cost / (1 - breakEvenMargin)).toFixed(2) : '—'}
                  </td>
                  <td className="py-2 px-3 tabular-nums text-xs text-muted-foreground">{p.estimated_deep_clean_cost != null ? '$' + Number(p.estimated_deep_clean_cost).toFixed(2) : '—'}</td>
                  <td className="py-2 px-3 tabular-nums text-xs text-muted-foreground">{p.deep_clean_3x_ce != null ? '$' + Number(p.deep_clean_3x_ce).toFixed(2) : '—'}</td>
                  <td className={`py-2 px-3 tabular-nums text-xs font-medium ${(p.profit_deep_clean || 0) < 0 ? 'text-destructive' : ''}`}>{p.profit_deep_clean != null ? '$' + Number(p.profit_deep_clean).toFixed(2) : '—'}</td>
                </tr>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => resetRow(p.id)} className="gap-2">
                      <RotateCcw className="w-3.5 h-3.5" /> Reset Row
                    </ContextMenuItem>
                    {isAdmin && (
                      <ContextMenuItem
                        onClick={() => setConfirmArchiveId(p.id)}
                        className="gap-2 text-destructive focus:text-destructive"
                        data-testid={`menu-archive-${p.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Archive property
                      </ContextMenuItem>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
                {expandedRow === p.id && (
                  <tr className="bg-muted/30 border-b border-border/50">
                    <td colSpan={17} className="py-4 px-6 space-y-4">
                      {/* Banner — makes the expanded panel obviously a "Master List record" */}
                      {(() => {
                        const { label: clientLabel, paymentMethod } = resolveClient(p)
                        return (
                      <div className="flex items-center justify-between gap-4 pb-2 border-b border-border/60">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">{p.name}</span>
                          <StageBadge stage={p.stage_name} />
                          {clientLabel ? (
                            <span className="text-xs text-muted-foreground" data-testid={`expanded-client-${p.id}`}>
                              · {clientLabel}
                              {paymentMethod && (
                                <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary">{paymentMethod}</span>
                              )}
                            </span>
                          ) : null}
                          {p.address && <span className="text-xs text-muted-foreground">· {p.address}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          {isAdmin && (
                            <button
                              onClick={() => setConfirmArchiveId(p.id)}
                              className="text-xs text-destructive hover:underline inline-flex items-center gap-1"
                              data-testid={`button-archive-${p.id}`}
                              title="Archive (recoverable for 30 days)"
                            >
                              <Trash2 className="w-3 h-3" /> Archive property
                            </button>
                          )}
                          <button
                            onClick={() => openPropertyModal(p.id)}
                            className="text-xs text-primary hover:underline"
                            data-testid={`button-open-modal-${p.id}`}
                          >
                            Open full property →
                          </button>
                        </div>
                      </div>
                        )
                      })()}

                      {/* Setup Status — operational onboarding readiness. Financials
                          live in the main row + Pro Forma; intentionally absent here.
                          When the user has master-list edit permission, all setup
                          fields are inline-editable; view-only users see the same
                          summary read-only. */}
                      <SetupStatusTiles
                        property={p}
                        canEdit={canEditSetup}
                        onUpdate={(field, value) => updateProperty({ id: p.id, field, value })}
                      />

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Master List details — every field preserved */}
                        <div className="rounded-md border border-border/60 bg-card p-3">
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Property Details</div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                            <Field label="Address" value={p.address || '—'} />
                            <Field
                              label="Client"
                              value={resolveClient(p).label || '—'}
                            />
                            <Field label="Bedrooms" value={p.bedrooms ?? '—'} />
                            <Field label="Full Baths" value={p.full_baths ?? '—'} />
                            <Field
                              label="Half Baths"
                              value={
                                canEditSetup ? (
                                  <InlineEdit
                                    value={p.half_baths}
                                    type="number"
                                    placeholder="—"
                                    onSave={raw => {
                                      const t = raw.trim()
                                      if (t === '') return updateProperty({ id: p.id, field: 'half_baths', value: null })
                                      const n = parseInt(t, 10)
                                      updateProperty({ id: p.id, field: 'half_baths', value: Number.isFinite(n) ? n : null })
                                    }}
                                    testId={`setup-edit-half_baths-${p.id}`}
                                  />
                                ) : (p.half_baths ?? '—')
                              }
                            />
                            <Field label="Kitchens" value={p.kitchens ?? '—'} />
                            <Field label="Sq Footage" value={p.square_footage ? Number(p.square_footage).toLocaleString() : '—'} />
                            <Field label="Beds (count)" value={p.number_of_beds ?? '—'} />
                            <Field label="Guest Count" value={p.guest_count ?? '—'} />
                            <Field
                              label="Hot Tub"
                              value={
                                canEditSetup ? (
                                  <button
                                    type="button"
                                    onClick={() => updateProperty({ id: p.id, field: 'hot_tub', value: !p.hot_tub })}
                                    className={`px-2 py-0.5 rounded-md border text-[11px] font-medium transition-colors ${p.hot_tub ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-muted-foreground hover:bg-muted'}`}
                                    data-testid={`setup-edit-hot_tub-${p.id}`}
                                  >
                                    {p.hot_tub ? 'Yes' : 'No'}
                                  </button>
                                ) : (p.hot_tub ? 'Yes' : 'No')
                              }
                            />
                            <Field
                              label="Pet Friendly"
                              value={
                                canEditSetup ? (
                                  <button
                                    type="button"
                                    onClick={() => updateProperty({ id: p.id, field: 'pet_friendly', value: !p.pet_friendly })}
                                    className={`px-2 py-0.5 rounded-md border text-[11px] font-medium transition-colors ${p.pet_friendly ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-muted-foreground hover:bg-muted'}`}
                                    data-testid={`setup-edit-pet_friendly-${p.id}`}
                                  >
                                    {p.pet_friendly ? 'Yes' : 'No'}
                                  </button>
                                ) : (p.pet_friendly ? 'Yes' : 'No')
                              }
                            />
                            <Field label="$/Sq Ft" value={p.price_per_sq_foot != null ? `$${Number(p.price_per_sq_foot).toFixed(2)}` : '—'} />
                            <Field label="CE/Sq Ft" value={p.ce_per_sq != null ? `$${Number(p.ce_per_sq).toFixed(2)}` : '—'} />
                            <Field label="Suggested Pay" value={fmt(p.suggested_pay)} />
                            <Field label="Frequency" value={p.cleaning_frequency || '—'} />
                            <Field label="Cleans / Mo" value={p.avg_cleans_per_month ?? '—'} />
                            <Field label="First Clean" value={p.first_clean_date || '—'} />
                            <Field label="Onboarding" value={p.onboarding_date || '—'} />
                            <Field label="Offboarding" value={p.offboarding_date || '—'} />
                            <Field label="Filter Size" value={p.filter_size || '—'} />
                            <Field label="Last Filter" value={p.last_filter_changed || '—'} />
                            <Field label="Next Filter Due" value={p.next_filter_due || '—'} />
                            <Field label="Breezeway" value={p.breezeway_name || p.breezeway_id || '—'} />
                          </div>
                        </div>

                        {/* Linen counts */}
                        <div className="rounded-md border border-border/60 bg-card p-3">
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Linens &amp; Beds</div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                            <Field label="King Beds" value={p.king_beds ?? '—'} />
                            <Field label="Queen Beds" value={p.queen_beds ?? '—'} />
                            <Field label="Full Beds" value={p.full_beds ?? '—'} />
                            <Field label="Twin Beds" value={p.twin_beds ?? '—'} />
                            <Field label="Bath Towels" value={p.bath_towels ?? '—'} />
                            <Field label="Hand Towels" value={p.hand_towels ?? '—'} />
                            <Field label="Washcloths" value={p.washcloths ?? '—'} />
                            <Field label="Bath Mats" value={p.bathmats ?? '—'} />
                            <Field label="Pool Towels" value={p.pool_towels ?? '—'} />
                            {/* Bed Sizes free-text was redundant with the
                                King/Queen/Full/Twin counts above — only show
                                it as a fallback if no individual counts exist
                                AND the legacy text is non-empty. */}
                            {p.bed_sizes_text && (p.king_beds == null && p.queen_beds == null && p.full_beds == null && p.twin_beds == null) && (
                              <Field label="Bed Sizes (legacy)" value={p.bed_sizes_text} />
                            )}
                          </div>
                          {p.linen_notes && (
                            <div className="text-xs text-muted-foreground mt-2"><span className="font-medium">Linen notes:</span> {p.linen_notes}</div>
                          )}
                        </div>

                        {/* Codes & access — always rendered so the "info architecture" stays consistent */}
                        <div className="rounded-md border border-border/60 bg-card p-3">
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Access &amp; Codes</div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                            <Field label="Auto Code" value={p.auto_code || '—'} />
                            <Field label="Door Code" value={p.door_code || '—'} />
                            <Field label="Other Codes" value={p.other_codes || '—'} />
                            <Field label="WiFi" value={p.wifi_info || '—'} />
                          </div>
                        </div>
                      </div>

                      <div className="rounded-md border border-border/60 bg-card p-3 space-y-3">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes &amp; Cleaner</div>
                        <div className="text-xs">
                          <span className="text-muted-foreground block mb-1">Notes</span>
                          <InlineEdit
                            value={p.notes}
                            type="text"
                            placeholder="Add notes…"
                            onSave={v => updateProperty({ id: p.id, field: 'notes', value: v || null })}
                            testId={`inline-notes-${p.id}`}
                          />
                        </div>
                        <AssignCleanerInline propertyId={p.id} />
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))
            )}
            {totals && !isLoading && (
              <tr className="bg-muted/60 border-t-2 border-border font-semibold sticky bottom-0">
                <td colSpan={4} className="py-2 px-3 text-xs uppercase tracking-wide">Totals ({filtered?.length})</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.ceTotal)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.payTotal)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.laundryTotal)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.consumablesTotal)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt((filtered?.length ?? 0) * inspectionCost)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt((filtered?.length ?? 0) * trashCost)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.costTotal)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.profitTotal)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{totals.avgProfitPct.toFixed(1)}%</td>
                <td className="py-2 px-3 tabular-nums text-xs text-muted-foreground italic">{fmt(totals.costTotal / (1 - breakEvenMargin))}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}
      {bulkEditMode && Object.keys(bulkChanges).length > 0 && (
        <div className="sticky bottom-0 left-0 right-0 bg-background border-t border-border p-3 flex items-center justify-between z-20 shadow-lg">
          <span className="text-sm text-muted-foreground">{Object.keys(bulkChanges).length} change(s) pending</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { setBulkEditMode(false); setBulkChanges({}) }} data-testid="button-bulk-cancel">
              Cancel
            </Button>
            <Button size="sm" onClick={bulkSaveAll} data-testid="button-bulk-save">
              Save All
            </Button>
          </div>
        </div>
      )}

      {/* Admin archive confirmation. Soft-delete sets deleted_at; the row stays
          recoverable for 30 days from the Master List archive panel and is then
          purged by the scheduled cleanup. Hard delete is intentionally not
          exposed here — admins must use the archive panel. */}
      <Dialog
        open={!!confirmArchiveId}
        onOpenChange={v => { if (!v && !archivePending) setConfirmArchiveId(null) }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Archive property?</DialogTitle>
          </DialogHeader>
          {(() => {
            const target = displayProperties.find((p: any) => p.id === confirmArchiveId)
            return (
              <div className="space-y-3 text-sm">
                <p>
                  <span className="font-medium">{target?.name ?? 'This property'}</span>{' '}
                  will be removed from active lists. It stays recoverable for 30 days from the Master List archive panel, then is purged automatically.
                </p>
                <p className="text-xs text-muted-foreground">
                  This is a soft delete — historical financial records remain intact.
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmArchiveId(null)}
                    disabled={archivePending}
                    data-testid="button-archive-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={archivePending}
                    onClick={() => confirmArchiveId && archiveProperty(confirmArchiveId)}
                    data-testid="button-archive-confirm"
                  >
                    {archivePending ? 'Archiving…' : 'Archive'}
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
