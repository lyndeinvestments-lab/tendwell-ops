import { useState, useMemo, useRef } from 'react'
import { TablePagination } from '@/components/TablePagination'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { useAuth, canEditView } from '@/lib/auth'
import { supabase, STAGE_COLORS } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { StageTransitionModal } from '@/components/StageTransitionModal'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { Plus, ArrowRight, Loader2, Copy, Printer, FileSpreadsheet, Search, X, ArrowUpDown, ArrowUp, ArrowDown, Download } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'
import { profitColorClass } from '@/lib/profit-colors'
import { useAppSettings } from '@/hooks/use-app-settings'
import { calcConsumables as calcConsumablesFromCosts, AMENITY_SETTINGS_KEYS, DEFAULT_AMENITY_COSTS, type AmenityCosts } from '@/lib/amenity-costs'
import { LaundryFormulaTooltip, ConsumablesFormulaTooltip } from '@/components/FormulaTooltip'

// ── Cost estimate formulas ────────────────────────────────────────────────────

// Laundry: number of beds × wash/dry cost per set
function calcLaundry(numberOfBeds: number): number {
  return numberOfBeds * 11.5 * 0.69
}

// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type NewProp = {
  name: string
  ce_charged: string
  cleaner_pay: string
  bedrooms: string
  number_of_beds: string
  king_beds: string
  queen_beds: string
  full_beds: string
  twin_beds: string
  full_baths: string
  half_baths: string
  number_of_kitchens: string
  hot_tub: boolean
  linen_program: boolean
  sq_ft: string
  address: string
  contact_id: string
}

const EMPTY_PROP: NewProp = {
  name: '',
  ce_charged: '',
  cleaner_pay: '',
  bedrooms: '',
  number_of_beds: '',
  king_beds: '',
  queen_beds: '',
  full_beds: '',
  twin_beds: '',
  full_baths: '',
  half_baths: '',
  number_of_kitchens: '',
  hot_tub: false,
  linen_program: false,
  sq_ft: '',
  address: '',
  contact_id: '',
}

export default function QuoteSheetPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { effectiveUser } = useAuth()
  usePageTitle('Quote Sheet')
  const { openPropertyModal } = usePropertyModal()
  const { getNumber } = useAppSettings()
  const INSPECTION_COST = getNumber('cost_inspection', 15)
  const TRASH_COST = getNumber('cost_trash', 5)
  const amenityCosts: AmenityCosts = {
    bathroom: getNumber(AMENITY_SETTINGS_KEYS.bathroom, DEFAULT_AMENITY_COSTS.bathroom),
    toiletPaper: getNumber(AMENITY_SETTINGS_KEYS.toiletPaper, DEFAULT_AMENITY_COSTS.toiletPaper),
    kitchen: getNumber(AMENITY_SETTINGS_KEYS.kitchen, DEFAULT_AMENITY_COSTS.kitchen),
    trashBag: getNumber(AMENITY_SETTINGS_KEYS.trashBag, DEFAULT_AMENITY_COSTS.trashBag),
    hotTub: getNumber(AMENITY_SETTINGS_KEYS.hotTub, DEFAULT_AMENITY_COSTS.hotTub),
  }
  const [addOpen, setAddOpen] = useState(false)
  const [converting, setConverting] = useState<any>(null)
  const [newProp, setNewProp] = useState<NewProp>(EMPTY_PROP)
  // Inline "create a client from this quote" flow — small dialog over the
  // Add Quote dialog. On success we invalidate the contacts query and
  // auto-select the newly created client on the Quote form.
  const [newClientOpen, setNewClientOpen] = useState(false)
  const [newClient, setNewClient] = useState({ full_name: '', email: '', phone: '' })
  const [search, setSearch] = useState('')
  // Quote-sheet negative path: hide quotes that didn't pan out, with a
  // required note. Default view is active-only; operators can flip to
  // 'archived' to see + restore them, or 'all' to audit both at once.
  const [viewMode, setViewMode] = useState<'active' | 'archived' | 'all'>('active')
  const [archivingTarget, setArchivingTarget] = useState<any>(null)
  const [archiveReason, setArchiveReason] = useState('')
  const [sortKey, setSortKey] = useState<string | null>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  // Google-sheet-style live edits: per-row field overrides that merge with the
  // server row during render so derived columns recompute while the user types.
  const [edits, setEdits] = useState<Record<number, Record<string, any>>>({})
  const canEdit = canEditView('quote-sheet', effectiveUser)

  function merged(p: any): any {
    const e = edits[p.id]
    return e ? { ...p, ...e } : p
  }

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortKey !== col) return <ArrowUpDown className="inline w-3 h-3 ml-1 opacity-40" />
    return sortDir === 'asc'
      ? <ArrowUp className="inline w-3 h-3 ml-1" />
      : <ArrowDown className="inline w-3 h-3 ml-1" />
  }

  const { data: stages } = useQuery({
    queryKey: ['/supabase/pipeline_stages'],
    queryFn: async () => {
      const { data } = await supabase.from('pipeline_stages').select('*').order('display_order')
      return data || []
    },
  })

  const { data: contacts } = useQuery({
    queryKey: ['/supabase/quote-contacts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('id, full_name, email').order('full_name')
      if (error) throw error
      return data || []
    },
  })

  const quoteStage = stages?.find((s: any) => s.name === 'Quote')
  const onboardingStage = stages?.find((s: any) => s.name === 'Onboarding')

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/quote-sheet'],
    queryFn: async () => {
      if (!quoteStage) return []
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .eq('stage_id', quoteStage.id)
      if (error) throw error
      return data || []
    },
    enabled: !!quoteStage,
  })

  const contactById = useMemo(
    () => new Map((contacts || []).map((c: any) => [String(c.id), c.full_name as string])),
    [contacts],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const allRows = (properties || []) as any[]
    // Apply the active/archived/all toggle BEFORE search so the search
    // operates over the chosen subset only.
    const scoped = viewMode === 'active'
      ? allRows.filter(p => !p.archived_at)
      : viewMode === 'archived'
        ? allRows.filter(p => p.archived_at)
        : allRows
    const base = q
      ? scoped.filter((p: any) => {
          const contactName = p.contact_id ? contactById.get(String(p.contact_id)) : null
          return [p.name, contactName, p.address, p.archived_reason].some((v: any) => v && String(v).toLowerCase().includes(q))
        })
      : scoped

    if (!sortKey) return base

    return [...base].sort((a: any, b: any) => {
      const dir = sortDir === 'asc' ? 1 : -1

      // Columns that use computed laundry/consumables values
      if (sortKey === 'est_laundry' || sortKey === 'est_consumables') {
        const getVal = (p: any) => {
          const beds = p.number_of_beds || 0
          if (sortKey === 'est_laundry') return p.est_laundry ?? calcLaundry(beds)
          return p.est_consumables ?? calcConsumablesFromCosts(amenityCosts, { ...p, kitchens: p.number_of_kitchens })
        }
        const av = getVal(a)
        const bv = getVal(b)
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return (av - bv) * dir
      }

      // Hardcoded numeric columns
      if (sortKey === 'inspection_cost') return 0
      if (sortKey === 'trash_cost') return 0

      // Client column sorts by the looked-up contact name (not contact_id)
      if (sortKey === 'client') {
        const av = a.contact_id ? contactById.get(String(a.contact_id)) ?? '' : ''
        const bv = b.contact_id ? contactById.get(String(b.contact_id)) ?? '' : ''
        if (!av && !bv) return 0
        if (!av) return 1
        if (!bv) return -1
        return av.localeCompare(bv) * dir
      }

      const av = a[sortKey]
      const bv = b[sortKey]

      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1

      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * dir
      }
      return (av - bv) * dir
    })
  }, [properties, contacts, contactById, search, sortKey, sortDir, viewMode])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  const { mutate: addProperty, isPending: addPending } = useGuardedMutation('quote-sheet', {
    mutationFn: async () => {
      if (!quoteStage) throw new Error('No Quote stage')
      const beds = newProp.number_of_beds ? parseInt(newProp.number_of_beds) : 0
      const fullBaths = newProp.full_baths ? parseFloat(newProp.full_baths) : 0
      const kitchens = newProp.number_of_kitchens ? parseInt(newProp.number_of_kitchens) : 1
      const estLaundry = calcLaundry(beds)
      const estConsumables = calcConsumablesFromCosts(amenityCosts, {
        full_baths: fullBaths,
        half_baths: newProp.half_baths ? parseFloat(newProp.half_baths) : 0,
        kitchens,
        number_of_beds: beds,
        hot_tub: newProp.hot_tub,
      })
      const { error } = await supabase.from('properties').insert({
        name: newProp.name,
        contact_id: newProp.contact_id || null,
        ce_charged: newProp.ce_charged ? parseFloat(newProp.ce_charged) : null,
        cleaner_pay: newProp.cleaner_pay ? parseFloat(newProp.cleaner_pay) : null,
        bedrooms: newProp.bedrooms ? parseInt(newProp.bedrooms) : null,
        number_of_beds: beds || null,
        king_beds: newProp.king_beds ? parseInt(newProp.king_beds) : null,
        queen_beds: newProp.queen_beds ? parseInt(newProp.queen_beds) : null,
        full_beds: newProp.full_beds ? parseInt(newProp.full_beds) : null,
        twin_beds: newProp.twin_beds ? parseInt(newProp.twin_beds) : null,
        full_baths: fullBaths || null,
        half_baths: newProp.half_baths ? parseFloat(newProp.half_baths) : null,
        kitchens,
        hot_tub: newProp.hot_tub,
        linen_program: newProp.linen_program,
        square_footage: newProp.sq_ft ? parseFloat(newProp.sq_ft) : null,
        address: newProp.address || null,
        est_laundry: estLaundry || null,
        est_consumables: estConsumables || null,
        stage_id: quoteStage.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/quote-sheet'] })
      toast({ title: 'Property added to Quote stage' })
      setAddOpen(false)
      setNewProp(EMPTY_PROP)
    },
    onError: (e: any) => toast({ title: 'Error: ' + (e.message || 'Failed'), variant: 'destructive' }),
  })

  // Inline client-create from the Add Quote dialog: insert into contacts,
  // refresh the dropdown, and auto-link the new client on the current quote.
  const { mutate: createClient, isPending: createClientPending } = useMutation({
    mutationFn: async () => {
      const full_name = newClient.full_name.trim()
      if (!full_name) throw new Error('Name is required')
      const { data, error } = await supabase
        .from('contacts')
        .insert({
          full_name,
          email: newClient.email.trim() || null,
          phone: newClient.phone.trim() || null,
        })
        .select('id, full_name, email')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (created: any) => {
      if (!created?.id) return
      qc.invalidateQueries({ queryKey: ['/supabase/quote-contacts'] })
      setNewProp(prev => ({ ...prev, contact_id: String(created.id) }))
      toast({ title: 'Client created', description: created.full_name })
      setNewClient({ full_name: '', email: '', phone: '' })
      setNewClientOpen(false)
    },
    onError: (e: any) => toast({ title: 'Could not create client', description: e?.message ?? 'Unknown error', variant: 'destructive' }),
  })

  const { mutate: convertToOnboarding, isPending: convertPending } = useGuardedMutation('quote-sheet', {
    mutationFn: async (prop: any) => {
      if (!onboardingStage) throw new Error('No Onboarding stage')
      if (!quoteStage) throw new Error('No Quote stage')
      const { executeStageTransition } = await import('@/lib/stage-transition')
      const result = await executeStageTransition({
        propertyId: Number(prop.id),
        propertyName: prop.name || '',
        fromStageId: Number(quoteStage.id),
        fromStageName: quoteStage.name,
        toStageId: Number(onboardingStage.id),
        toStageName: onboardingStage.name,
        changedBy: effectiveUser?.label || 'unknown',
      })
      if (!result.ok) throw new Error(result.error)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/quote-sheet'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
      toast({ title: 'Moved to Onboarding' })
      setConverting(null)
    },
    onError: (error: any) => toast({ title: 'Failed', description: error?.message, variant: 'destructive' }),
  })

  function handleDuplicate(prop: any) {
    setNewProp({
      name: '',
      ce_charged: prop.ce_charged != null ? String(prop.ce_charged) : '',
      cleaner_pay: prop.cleaner_pay != null ? String(prop.cleaner_pay) : '',
      bedrooms: prop.bedrooms != null ? String(prop.bedrooms) : '',
      number_of_beds: prop.number_of_beds != null ? String(prop.number_of_beds) : '',
      king_beds: prop.king_beds != null ? String(prop.king_beds) : '',
      queen_beds: prop.queen_beds != null ? String(prop.queen_beds) : '',
      full_beds: prop.full_beds != null ? String(prop.full_beds) : '',
      twin_beds: prop.twin_beds != null ? String(prop.twin_beds) : '',
      full_baths: prop.full_baths != null ? String(prop.full_baths) : '',
      half_baths: prop.half_baths != null ? String(prop.half_baths) : '',
      number_of_kitchens: prop.number_of_kitchens != null ? String(prop.number_of_kitchens) : '',
      hot_tub: prop.hot_tub || false,
      linen_program: prop.linen_program || false,
      sq_ft: prop.square_footage != null ? String(prop.square_footage) : '',
      address: '',
      contact_id: '',
    })
    setAddOpen(true)
  }

  function handleConvert(prop: any) {
    const reqFields = onboardingStage?.requires_fields || []
    const missing = reqFields.filter((f: string) => !prop[f])
    setConverting({ prop, missing })
  }

  // Compute estimates for display. When a row has local edits, always recompute
  // laundry/consumables/profit from the merged values rather than stale DB rows,
  // so numbers update live as the user types.
  function getEstimates(p: any) {
    const hasEdit = !!edits[p.id]
    const beds = Number(p.number_of_beds) || 0
    const laundry = hasEdit ? calcLaundry(beds) : (p.est_laundry ?? calcLaundry(beds))
    const consumables = hasEdit
      ? calcConsumablesFromCosts(amenityCosts, { ...p, kitchens: p.number_of_kitchens })
      : (p.est_consumables ?? calcConsumablesFromCosts(amenityCosts, { ...p, kitchens: p.number_of_kitchens }))
    const linenProgramCost = p.linen_program ? (beds * 300) / 12 / 4 : 0
    const ce = p.ce_charged != null && p.ce_charged !== '' ? Number(p.ce_charged) : null
    const pay = p.cleaner_pay != null && p.cleaner_pay !== '' ? Number(p.cleaner_pay) : null
    let profitPct: number | null
    if (hasEdit && ce != null && ce > 0) {
      const totalCost = laundry + consumables + INSPECTION_COST + TRASH_COST + (pay || 0) + linenProgramCost
      profitPct = ((ce - totalCost) / ce) * 100
    } else {
      profitPct = p.profit_percentage != null ? Number(p.profit_percentage) : null
    }
    return { laundry, consumables, linenProgramCost, profitPct }
  }

  // Persist a single field change to Supabase. Fires on blur/Enter of inline cells.
  const { mutate: persistField } = useMutation({
    mutationFn: async ({ id, field, value }: { id: number; field: string; value: any }) => {
      const numFields = ['ce_charged', 'cleaner_pay', 'bedrooms', 'number_of_beds', 'full_baths', 'half_baths', 'square_footage']
      const intFields = ['bedrooms', 'number_of_beds', 'square_footage']
      let dbValue: any = value
      if (value === '' || value == null) {
        dbValue = null
      } else if (numFields.includes(field)) {
        dbValue = intFields.includes(field) ? parseInt(String(value), 10) : parseFloat(String(value))
        if (Number.isNaN(dbValue)) dbValue = null
      }
      const { error } = await supabase.from('properties').update({ [field]: dbValue }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      // Clear the local edit for this field now that it's persisted; keep other
      // edits on the same row (server-side profit_percentage may still be stale
      // so derived values re-use the merged value until refetch completes).
      qc.invalidateQueries({ queryKey: ['/supabase/quote-sheet'] })
      setEdits(prev => {
        const row = prev[vars.id]
        if (!row) return prev
        const { [vars.field]: _removed, ...rest } = row
        const next = { ...prev }
        if (Object.keys(rest).length === 0) delete next[vars.id]
        else next[vars.id] = rest
        return next
      })
    },
    onError: (error: any) => toast({ title: 'Save failed', description: error?.message, variant: 'destructive' }),
  })

  // Archive a quote with a required reason. Stores who/when/why on the
  // properties row directly so the archive history is auditable on the
  // record itself (not in a separate audit table).
  const { mutate: archiveQuote, isPending: archivePending } = useGuardedMutation('quote-sheet', {
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const { error } = await supabase
        .from('properties')
        .update({
          archived_at: new Date().toISOString(),
          archived_reason: reason,
          archived_by: effectiveUser?.label ?? null,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Quote archived' })
      qc.invalidateQueries({ queryKey: ['/supabase/quote-sheet'] })
      setArchivingTarget(null)
      setArchiveReason('')
    },
    onError: (e: any) => toast({ title: 'Failed to archive', description: e?.message, variant: 'destructive' }),
  })

  const { mutate: restoreQuote } = useGuardedMutation('quote-sheet', {
    mutationFn: async (id: number) => {
      const { error } = await supabase
        .from('properties')
        .update({ archived_at: null, archived_reason: null, archived_by: null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Quote restored' })
      qc.invalidateQueries({ queryKey: ['/supabase/quote-sheet'] })
    },
    onError: (e: any) => toast({ title: 'Failed to restore', description: e?.message, variant: 'destructive' }),
  })

  function EditableNumberCell({
    p, field, step = '1', prefix = '', className = '',
  }: { p: any; field: string; step?: string; prefix?: string; className?: string }) {
    const m = merged(p)
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState<string>(() => {
      const v = m[field]
      return v == null ? '' : String(v)
    })
    // Set when the user presses Escape so the trailing blur from unmount
    // doesn't commit the typed draft (April 2026 audit P0 fix).
    const cancelRef = useRef(false)

    function commit() {
      setEditing(false)
      if (cancelRef.current) {
        cancelRef.current = false
        return
      }
      const current = p[field]
      const nextVal = draft === '' ? null : Number(draft)
      const isSame = String(current ?? '') === String(nextVal ?? '')
      if (!isSame) {
        persistField({ id: p.id, field, value: draft })
      } else {
        // No-op commit: drop any lingering edit override
        setEdits(prev => {
          const row = prev[p.id]
          if (!row) return prev
          const { [field]: _removed, ...rest } = row
          const next = { ...prev }
          if (Object.keys(rest).length === 0) delete next[p.id]
          else next[p.id] = rest
          return next
        })
      }
    }

    if (!canEdit) {
      const v = m[field]
      return <span className="tabular-nums">{v == null || v === '' ? '—' : (prefix ? `${prefix}${typeof v === 'number' ? v.toFixed(2) : v}` : (typeof v === 'number' ? v.toLocaleString() : v))}</span>
    }

    if (editing) {
      return (
        <input
          autoFocus
          type="number"
          step={step}
          value={draft}
          onChange={e => {
            setDraft(e.target.value)
            setEdits(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), [field]: e.target.value === '' ? null : Number(e.target.value) } }))
          }}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() }
            if (e.key === 'Escape') {
              cancelRef.current = true
              setEdits(prev => {
                const row = prev[p.id]
                if (!row) return prev
                const { [field]: _removed, ...rest } = row
                const next = { ...prev }
                if (Object.keys(rest).length === 0) delete next[p.id]
                else next[p.id] = rest
                return next
              })
              const v = p[field]
              setDraft(v == null ? '' : String(v))
              setEditing(false)
            }
          }}
          className={`h-6 w-20 rounded border border-input bg-background px-1.5 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-ring ${className}`}
          data-testid={`qs-cell-${field}-${p.id}`}
        />
      )
    }

    const v = m[field]
    const display = v == null || v === '' ? '—'
      : prefix
        ? `${prefix}${typeof v === 'number' ? v.toFixed(2) : v}`
        : (typeof v === 'number' ? v.toLocaleString() : String(v))
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(v == null ? '' : String(v))
          setEditing(true)
        }}
        className={`tabular-nums text-left w-full hover:bg-muted/60 rounded px-1 -mx-1 transition-colors ${className}`}
        data-testid={`qs-cell-${field}-${p.id}`}
      >
        {display}
      </button>
    )
  }

  function exportCsv() {
    if (!filtered || filtered.length === 0) return
    const headers = ['Name', 'Client', 'Client Charged', 'Cleaner Pay', 'Bedrooms', 'Beds', 'Full Baths', 'Half Baths', 'Sq Ft', 'Est Laundry', 'Est Consumables', 'Inspection', 'Trash', 'Profit %']
    const rows = filtered.map((p: any) => {
      const { laundry, consumables } = getEstimates(p)
      return [
        p.name || '',
        p.contact_id ? contactById.get(String(p.contact_id)) ?? '' : '',
        p.ce_charged ?? '',
        p.cleaner_pay ?? '',
        p.bedrooms ?? '',
        p.number_of_beds ?? '',
        p.full_baths ?? '',
        p.half_baths ?? '',
        p.square_footage ?? '',
        laundry?.toFixed(2) ?? '',
        consumables?.toFixed(2) ?? '',
        INSPECTION_COST.toFixed(2),
        TRASH_COST.toFixed(2),
        p.profit_percentage != null ? p.profit_percentage.toFixed(1) : '',
      ]
    })
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `quote-sheet-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-5 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Quote Sheet</h1>
          <p className="text-sm text-muted-foreground">Properties currently in Quote stage</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5 no-print" disabled={!filtered?.length}>
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5 no-print" data-testid="button-print-quote">
            <Printer className="w-3.5 h-3.5" />
            Print
          </Button>
          <div className="relative no-print">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              className="pl-8 pr-7 h-8 w-full sm:w-56 text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {/* Active / Archived / All filter — defaults to Active so the
              negative path doesn't clutter the daily view. */}
          <div className="inline-flex items-center rounded-md border border-border bg-card overflow-hidden h-8 no-print" data-testid="quote-view-mode">
            {(['active', 'archived', 'all'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => { setViewMode(m); setPage(1) }}
                className={`px-2.5 h-full text-xs capitalize ${viewMode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'} ${m !== 'active' ? 'border-l border-border' : ''}`}
                data-testid={`view-mode-${m}`}
              >
                {m}
                {m === 'archived' ? <span className="ml-1 text-[10px] opacity-70">({(properties || []).filter((p: any) => p.archived_at).length})</span> : null}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)} data-testid="button-add-quote" className="gap-1.5 no-print">
            <Plus className="w-3.5 h-3.5" />
            New Quote
          </Button>
        </div>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
            <tr>
              {([
                { col: 'name', label: 'Name' },
                { col: 'client', label: 'Client' },
                { col: 'ce_charged', label: 'Client Charged', title: 'Client Charged' },
                { col: 'cleaner_pay', label: 'Cleaner Pay' },
                { col: 'bedrooms', label: 'Bedrooms' },
                { col: 'number_of_beds', label: 'Beds' },
                { col: 'full_baths', label: 'Full Baths' },
                { col: 'half_baths', label: 'Half Baths' },
                { col: 'square_footage', label: 'Sq Ft' },
                { col: 'est_laundry', label: 'Est Laundry', title: 'Estimated Laundry Cost' },
                { col: 'est_consumables', label: 'Est Consumables', title: 'Estimated Consumables Cost' },
                { col: 'inspection_cost', label: 'Inspection' },
                { col: 'trash_cost', label: 'Trash' },
                { col: 'profit_percentage', label: 'Profit %' },
              ] as { col: string; label: string; title?: string }[]).map(({ col, label, title }) => (
                <th
                  key={col}
                  className={`text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap${col === 'name' ? ' sticky left-0 z-20 bg-muted/80' : ''}`}
                  title={title}
                  tabIndex={0}
                  role="columnheader"
                  aria-sort={sortKey === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  onClick={() => toggleSort(col)}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleSort(col)}
                >
                  {label}<SortIcon col={col} />
                </th>
              ))}
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(15)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}
                </tr>
              ))
            ) : !properties || properties.length === 0 ? (
              <tr>
                <td colSpan={15}>
                  <EmptyState icon={FileSpreadsheet} title="No quotes yet" description="Add a property to the Quote stage to get started." action={{ label: 'New Quote', onClick: () => setAddOpen(true) }} />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={15}>
                  <EmptyState icon={Search} title="No results" description={`No properties match "${search}".`} />
                </td>
              </tr>
            ) : (
              paged.map((rawP: any) => {
                const p = merged(rawP)
                const { laundry, consumables, profitPct } = getEstimates(p)
                return (
                  <tr key={p.id} data-testid={`row-quote-${p.id}`} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-2 px-3 font-medium text-xs sticky left-0 z-10 bg-background">
                      <button onClick={() => openPropertyModal(p.id)} className="text-primary hover:underline text-left">{p.name}</button>
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground truncate max-w-[14rem]" title={p.contact_id ? contactById.get(String(p.contact_id)) ?? '' : ''}>
                      {p.contact_id ? contactById.get(String(p.contact_id)) ?? '—' : '—'}
                    </td>
                    <td className="py-2 px-3 text-xs"><EditableNumberCell p={rawP} field="ce_charged" step="0.01" prefix="$" /></td>
                    <td className="py-2 px-3 text-xs"><EditableNumberCell p={rawP} field="cleaner_pay" step="0.01" prefix="$" /></td>
                    <td className="py-2 px-3 text-xs"><EditableNumberCell p={rawP} field="bedrooms" /></td>
                    <td className="py-2 px-3 text-xs"><EditableNumberCell p={rawP} field="number_of_beds" /></td>
                    <td className="py-2 px-3 text-xs"><EditableNumberCell p={rawP} field="full_baths" step="0.5" /></td>
                    <td className="py-2 px-3 text-xs"><EditableNumberCell p={rawP} field="half_baths" step="0.5" /></td>
                    <td className="py-2 px-3 text-xs"><EditableNumberCell p={rawP} field="square_footage" /></td>
                    <td className="py-2 px-3 text-xs tabular-nums">
                      <LaundryFormulaTooltip numberOfBeds={p.number_of_beds} override={p.est_laundry}>
                        <span>{fmt(laundry)}</span>
                      </LaundryFormulaTooltip>
                    </td>
                    <td className="py-2 px-3 text-xs tabular-nums">
                      <ConsumablesFormulaTooltip
                        fullBaths={p.full_baths}
                        halfBaths={p.half_baths}
                        kitchens={p.number_of_kitchens}
                        numberOfBeds={p.number_of_beds}
                        hotTub={p.hot_tub}
                        costs={amenityCosts}
                        override={p.est_consumables}
                      >
                        <span>{fmt(consumables)}</span>
                      </ConsumablesFormulaTooltip>
                    </td>
                    <td className="py-2 px-3 text-xs tabular-nums text-muted-foreground">{fmt(INSPECTION_COST)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums text-muted-foreground">{fmt(TRASH_COST)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">
                      {profitPct != null ? (
                        <span className={`font-medium ${profitColorClass(profitPct)}`}>
                          {profitPct.toFixed(1)}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs gap-1 hover:text-primary px-2"
                          onClick={() => handleDuplicate(p)}
                          data-testid={`button-duplicate-${p.id}`}
                          title="Duplicate quote"
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                        {p.archived_at ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs gap-1 hover:text-primary px-2"
                            onClick={(e) => { e.stopPropagation(); restoreQuote(p.id) }}
                            data-testid={`button-restore-${p.id}`}
                            title={`Archived ${p.archived_by ? 'by ' + p.archived_by : ''}: ${p.archived_reason ?? ''}`}
                          >
                            Restore
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs gap-1 hover:text-primary px-2"
                              onClick={(e) => { e.stopPropagation(); handleConvert(p) }}
                              data-testid={`button-convert-${p.id}`}
                            >
                              <ArrowRight className="w-3 h-3" /> Onboard
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs gap-1 hover:text-destructive text-muted-foreground px-2"
                              onClick={(e) => { e.stopPropagation(); setArchivingTarget(p); setArchiveReason('') }}
                              data-testid={`button-archive-${p.id}`}
                              title="Archive — quote didn't pan out"
                            >
                              Archive
                            </Button>
                          </>
                        )}
                      </div>
                      {p.archived_at && viewMode !== 'active' ? (
                        <div className="mt-1 text-[10px] text-muted-foreground italic">
                          Archived {new Date(p.archived_at).toLocaleDateString()}{p.archived_by ? ` by ${p.archived_by}` : ''}
                          {p.archived_reason ? <> — {p.archived_reason}</> : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                )
              })
            )}
            {filtered.length > 0 && (() => {
              const mergedRows = filtered.map(merged)
              const sum = (pick: (p: any) => number | null | undefined) =>
                mergedRows.reduce((s, p) => s + (Number(pick(p)) || 0), 0)
              const validProfit = mergedRows
                .map(p => getEstimates(p).profitPct)
                .filter((x): x is number => x != null)
              const avgProfit = validProfit.length > 0
                ? validProfit.reduce((s, v) => s + v, 0) / validProfit.length
                : null
              return (
                <tr className="bg-muted/60 border-t-2 border-border font-semibold">
                  <td className="py-2 px-3 text-xs uppercase tracking-wide sticky left-0 z-10 bg-muted/60">Totals ({filtered.length})</td>
                  <td className="py-2 px-3 text-xs"></td>
                  <td className="py-2 px-3 text-xs tabular-nums">{fmt(sum((p: any) => p.ce_charged))}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">{fmt(sum((p: any) => p.cleaner_pay))}</td>
                  <td className="py-2 px-3 text-xs tabular-nums" colSpan={5}></td>
                  <td className="py-2 px-3 text-xs tabular-nums">{fmt(mergedRows.reduce((s, p) => s + (getEstimates(p).laundry || 0), 0))}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">{fmt(mergedRows.reduce((s, p) => s + (getEstimates(p).consumables || 0), 0))}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">{fmt(filtered.length * INSPECTION_COST)}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">{fmt(filtered.length * TRASH_COST)}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">
                    {avgProfit == null ? '—' : (
                      <span className={`font-medium ${profitColorClass(avgProfit)}`} title="Average profit %">
                        {avgProfit.toFixed(1)}% <span className="text-muted-foreground font-normal">(avg)</span>
                      </span>
                    )}
                  </td>
                  <td></td>
                </tr>
              )
            })()}
          </tbody>
        </table>
      </div>
      {filtered.length > 0 && <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />}

      {/* Add Quote Dialog */}
      <Dialog open={addOpen} onOpenChange={v => !v && setAddOpen(false)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Add New Quote</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* Property info */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Property Name *</Label>
              <Input value={newProp.name} onChange={e => setNewProp(prev => ({ ...prev, name: e.target.value }))} className="h-8 text-sm" data-testid="input-new-name" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Address</Label>
              {/* Google Places-backed autocomplete; falls back to a plain
                  text input when VITE_GOOGLE_MAPS_API_KEY isn't configured,
                  so manual entry never breaks. */}
              <AddressAutocomplete
                value={newProp.address}
                onChange={next => setNewProp(prev => ({ ...prev, address: next }))}
                placeholder="Start typing an address…"
                className="h-8 text-sm"
                testId="input-new-address"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Client</Label>
                <button
                  type="button"
                  onClick={() => setNewClientOpen(true)}
                  className="text-[10px] uppercase tracking-wide text-primary hover:text-primary/80 px-1.5 py-0 rounded border border-primary/30 hover:border-primary/60 inline-flex items-center gap-1"
                  data-testid="button-new-client-from-quote"
                >
                  <Plus className="w-2.5 h-2.5" /> New
                </button>
              </div>
              <select
                value={newProp.contact_id}
                onChange={e => setNewProp(prev => ({ ...prev, contact_id: e.target.value }))}
                className="w-full h-8 text-sm border border-input rounded px-2 bg-background"
              >
                <option value="">No client linked</option>
                {(contacts || []).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.full_name}{c.email ? ` (${c.email})` : ''}</option>
                ))}
              </select>
            </div>

            {/* Property details grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Bedrooms</Label>
                <Input type="number" value={newProp.bedrooms} onChange={e => setNewProp(prev => ({ ...prev, bedrooms: e.target.value }))} className="h-8 text-sm" data-testid="input-new-bedrooms" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Number of Beds</Label>
                  <button
                    type="button"
                    onClick={() => {
                      const total =
                        (parseInt(newProp.king_beds) || 0) +
                        (parseInt(newProp.queen_beds) || 0) +
                        (parseInt(newProp.full_beds) || 0) +
                        (parseInt(newProp.twin_beds) || 0)
                      setNewProp(prev => ({ ...prev, number_of_beds: total > 0 ? String(total) : '' }))
                    }}
                    title="Sum king + queen + full + twin"
                    className="text-[9px] uppercase tracking-wide text-primary hover:text-primary/80 px-1.5 py-0 rounded border border-primary/30 hover:border-primary/60"
                  >
                    Auto
                  </button>
                </div>
                <Input type="number" value={newProp.number_of_beds} onChange={e => setNewProp(prev => ({ ...prev, number_of_beds: e.target.value }))} className="h-8 text-sm" data-testid="input-new-number_of_beds" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Full Baths</Label>
                <Input type="number" value={newProp.full_baths} onChange={e => setNewProp(prev => ({ ...prev, full_baths: e.target.value }))} className="h-8 text-sm" data-testid="input-new-full_baths" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Half Baths</Label>
                <Input type="number" value={newProp.half_baths} onChange={e => setNewProp(prev => ({ ...prev, half_baths: e.target.value }))} className="h-8 text-sm" data-testid="input-new-half_baths" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Kitchens</Label>
                <Input type="number" value={newProp.number_of_kitchens} onChange={e => setNewProp(prev => ({ ...prev, number_of_kitchens: e.target.value }))} className="h-8 text-sm" data-testid="input-new-number_of_kitchens" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Square Footage</Label>
                <Input
                  type="number"
                  value={newProp.sq_ft}
                  onChange={e => {
                    const sqft = e.target.value
                    const updates: Partial<NewProp> = { sq_ft: sqft }
                    // Auto-suggest CE at $0.14/sqft and cleaner pay at 50% of CE
                    if (sqft && parseFloat(sqft) > 0) {
                      const suggestedCe = (parseFloat(sqft) * 0.14).toFixed(2)
                      const suggestedPay = (parseFloat(suggestedCe) * 0.5).toFixed(2)
                      // Only auto-fill if user hasn't manually entered values
                      if (!newProp.ce_charged || newProp.ce_charged === ((parseFloat(newProp.sq_ft || '0') * 0.14).toFixed(2))) {
                        updates.ce_charged = suggestedCe
                        updates.cleaner_pay = suggestedPay
                      }
                    }
                    setNewProp(prev => ({ ...prev, ...updates }))
                  }}
                  className="h-8 text-sm"
                  data-testid="input-new-sq_ft"
                />
              </div>
            </div>

            {/* Bed sizes — optional. When filled in, the "Auto" button on
                Number of Beds derives the total from these. */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Bed Sizes (optional)</Label>
              <div className="grid grid-cols-4 gap-2">
                <Input type="number" value={newProp.king_beds} onChange={e => setNewProp(prev => ({ ...prev, king_beds: e.target.value }))} className="h-8 text-sm" placeholder="King" data-testid="input-new-king_beds" />
                <Input type="number" value={newProp.queen_beds} onChange={e => setNewProp(prev => ({ ...prev, queen_beds: e.target.value }))} className="h-8 text-sm" placeholder="Queen" data-testid="input-new-queen_beds" />
                <Input type="number" value={newProp.full_beds} onChange={e => setNewProp(prev => ({ ...prev, full_beds: e.target.value }))} className="h-8 text-sm" placeholder="Full" data-testid="input-new-full_beds" />
                <Input type="number" value={newProp.twin_beds} onChange={e => setNewProp(prev => ({ ...prev, twin_beds: e.target.value }))} className="h-8 text-sm" placeholder="Twin" data-testid="input-new-twin_beds" />
              </div>
            </div>

            {/* Hot Tub toggle */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Hot Tub</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setNewProp(prev => ({ ...prev, hot_tub: false }))}
                  data-testid="input-new-hot_tub-no"
                  className={`flex-1 h-8 rounded-md border text-sm transition-colors ${
                    !newProp.hot_tub
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  No
                </button>
                <button
                  type="button"
                  onClick={() => setNewProp(prev => ({ ...prev, hot_tub: true }))}
                  data-testid="input-new-hot_tub-yes"
                  className={`flex-1 h-8 rounded-md border text-sm transition-colors ${
                    newProp.hot_tub
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Yes
                </button>
              </div>
            </div>

            {/* Linen Program toggle — adds (beds × 300)/12/4 per clean */}
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={newProp.linen_program}
                onChange={e => setNewProp(prev => ({ ...prev, linen_program: e.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-input"
                data-testid="input-new-linen_program"
              />
              <div className="text-xs">
                <div className="font-medium">Linen Program</div>
                <div className="text-muted-foreground">
                  Adds {newProp.number_of_beds ? `$${(Number(newProp.number_of_beds) * 300 / 12 / 4).toFixed(2)}` : '$0'}/clean
                  {newProp.number_of_beds ? ` (${newProp.number_of_beds} beds × $300 / 12 / 4)` : ''}
                </div>
              </div>
            </label>

            {/* CE Charged and Cleaner Pay — with auto-suggestions */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Client Charged ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newProp.ce_charged}
                  onChange={e => {
                    const ce = e.target.value
                    const updates: Partial<NewProp> = { ce_charged: ce }
                    // Auto-suggest cleaner pay at 50% of CE
                    if (ce && parseFloat(ce) > 0) {
                      updates.cleaner_pay = (parseFloat(ce) * 0.5).toFixed(2)
                    }
                    setNewProp(prev => ({ ...prev, ...updates }))
                  }}
                  className="h-8 text-sm"
                  data-testid="input-new-ce_charged"
                  placeholder={newProp.sq_ft ? `Suggested: $${(parseFloat(newProp.sq_ft) * 0.14).toFixed(2)}` : ''}
                />
                {newProp.sq_ft && !newProp.ce_charged && (
                  <p className="text-xs text-muted-foreground">Suggested: ${(parseFloat(newProp.sq_ft || '0') * 0.14).toFixed(2)} ($0.14/sqft)</p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Cleaner Pay ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newProp.cleaner_pay}
                  onChange={e => setNewProp(prev => ({ ...prev, cleaner_pay: e.target.value }))}
                  className="h-8 text-sm"
                  data-testid="input-new-cleaner_pay"
                  placeholder={newProp.ce_charged ? `Suggested: $${(parseFloat(newProp.ce_charged) * 0.5).toFixed(2)}` : ''}
                />
                {newProp.ce_charged && !newProp.cleaner_pay && (
                  <p className="text-xs text-muted-foreground">Suggested: ${(parseFloat(newProp.ce_charged || '0') * 0.5).toFixed(2)} (50% of CE)</p>
                )}
              </div>
            </div>

            {/* Live estimate + profit % preview */}
            {(newProp.number_of_beds || newProp.full_baths || newProp.ce_charged) && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 space-y-1 text-xs">
                <p className="font-medium text-foreground mb-1">Estimated Costs</p>
                {(() => {
                  const beds = newProp.number_of_beds ? parseInt(newProp.number_of_beds) : 0
                  const fullBaths = newProp.full_baths ? parseFloat(newProp.full_baths) : 0
                  const kitchens = newProp.number_of_kitchens ? parseInt(newProp.number_of_kitchens) : 1
                  const laundry = calcLaundry(beds)
                  const consumables = calcConsumablesFromCosts(amenityCosts, {
                    full_baths: fullBaths,
                    half_baths: newProp.half_baths ? parseFloat(newProp.half_baths) : 0,
                    kitchens,
                    number_of_beds: beds,
                    hot_tub: newProp.hot_tub,
                  })
                  const linenProgramCost = newProp.linen_program ? (beds * 300) / 12 / 4 : 0
                  const totalCost = laundry + consumables + INSPECTION_COST + TRASH_COST + linenProgramCost
                  const ce = newProp.ce_charged ? parseFloat(newProp.ce_charged) : null
                  const pay = newProp.cleaner_pay ? parseFloat(newProp.cleaner_pay) : null
                  const totalWithPay = totalCost + (pay || 0)
                  const profitPct = ce && ce > 0 ? ((ce - totalWithPay) / ce) * 100 : null
                  return (
                    <>
                      {pay != null && <div className="flex justify-between"><span className="text-muted-foreground">Cleaner Pay</span><span className="tabular-nums">{fmt(pay)}</span></div>}
                      <div className="flex justify-between"><span className="text-muted-foreground">Est Laundry</span><span className="tabular-nums">{fmt(laundry)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Est Consumables</span><span className="tabular-nums">{fmt(consumables)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Inspection</span><span className="tabular-nums">{fmt(INSPECTION_COST)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Trash</span><span className="tabular-nums">{fmt(TRASH_COST)}</span></div>
                      {newProp.linen_program && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Linen Program</span><span className="tabular-nums">{fmt(linenProgramCost)}</span></div>
                      )}
                      <div className="flex justify-between border-t border-border pt-1 font-medium"><span>Total Costs</span><span className="tabular-nums">{fmt(totalWithPay)}</span></div>
                      {ce != null && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Client Charged</span><span className="tabular-nums font-medium">{fmt(ce)}</span></div>
                      )}
                      {profitPct !== null && (
                        <div className="flex justify-between border-t border-border pt-1 font-semibold">
                          <span>Profit %</span>
                          <span className={`tabular-nums ${profitColorClass(profitPct)}`}>
                            {profitPct.toFixed(1)}%
                          </span>
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => addProperty()} disabled={!newProp.name || addPending} data-testid="button-save-quote">
              {addPending ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Saving…</> : 'Add Quote'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {converting && (
        <StageTransitionModal
          open={true}
          onClose={() => setConverting(null)}
          onConfirm={() => convertToOnboarding(converting.prop)}
          propertyName={converting.prop.name}
          targetStage="Onboarding"
          missingFields={converting.missing}
          isPending={convertPending}
        />
      )}

      <Dialog open={!!archivingTarget} onOpenChange={v => !v && !archivePending && setArchivingTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Archive quote</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              Archive <span className="font-medium">{archivingTarget?.name ?? '—'}</span>?
              The property stays in the database; the quote sheet hides it by default
              and you can restore it any time.
            </p>
            <div>
              <Label htmlFor="archive-reason" className="text-xs">
                Reason <span className="text-destructive">*</span>
              </Label>
              <textarea
                id="archive-reason"
                value={archiveReason}
                onChange={e => setArchiveReason(e.target.value)}
                placeholder="e.g. Owner decided to self-manage; price gap; ghosted after follow-up…"
                rows={3}
                className="w-full mt-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                data-testid="input-archive-reason"
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Required. Visible in the archived view so you can audit why a quote didn't onboard.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setArchivingTarget(null)} disabled={archivePending}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => archivingTarget && archiveReason.trim() && archiveQuote({ id: archivingTarget.id, reason: archiveReason.trim() })}
              disabled={archivePending || !archiveReason.trim()}
              data-testid="button-confirm-archive"
            >
              {archivePending ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Archiving…</> : 'Archive quote'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New-client mini dialog (opens over the Add Quote dialog). Fields
          mirror the contacts table minimum: name required, email + phone
          optional. On success, contacts query refreshes and the new client
          is auto-selected on the current Quote form. */}
      <Dialog open={newClientOpen} onOpenChange={v => { if (!v) { setNewClientOpen(false); setNewClient({ full_name: '', email: '', phone: '' }) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">New Client</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Full name *</Label>
              <Input
                autoFocus
                value={newClient.full_name}
                onChange={e => setNewClient(prev => ({ ...prev, full_name: e.target.value }))}
                placeholder="Jane Doe"
                className="h-8 text-sm"
                data-testid="input-new-client-name"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input
                type="email"
                value={newClient.email}
                onChange={e => setNewClient(prev => ({ ...prev, email: e.target.value }))}
                placeholder="jane@example.com"
                className="h-8 text-sm"
                data-testid="input-new-client-email"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Phone</Label>
              <Input
                type="tel"
                value={newClient.phone}
                onChange={e => setNewClient(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="(555) 555-1212"
                className="h-8 text-sm"
                data-testid="input-new-client-phone"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              You can fill in company, address, payment method, and more later from the Clients page.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setNewClientOpen(false); setNewClient({ full_name: '', email: '', phone: '' }) }} disabled={createClientPending}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => createClient()}
              disabled={createClientPending || !newClient.full_name.trim()}
              data-testid="button-save-new-client"
            >
              {createClientPending
                ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Saving…</>
                : 'Create client'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
