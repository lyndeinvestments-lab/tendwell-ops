import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase, STAGE_COLORS } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { StageTransitionModal } from '@/components/StageTransitionModal'
import { usePageTitle } from '@/hooks/use-page-title'
import { Plus, ArrowRight, Loader2, Copy, Printer, FileSpreadsheet, Search, X, ArrowUpDown, ArrowUp, ArrowDown, Download } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { profitColorClass } from '@/lib/profit-colors'
import { useAppSettings } from '@/hooks/use-app-settings'
import { calcConsumables as calcConsumablesFromCosts, AMENITY_SETTINGS_KEYS, DEFAULT_AMENITY_COSTS, type AmenityCosts } from '@/lib/amenity-costs'

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
  client_name: string
  ce_charged: string
  cleaner_pay: string
  bedrooms: string
  number_of_beds: string
  full_baths: string
  half_baths: string
  number_of_kitchens: string
  hot_tub: boolean
  sq_ft: string
  address: string
  contact_id: string
}

const EMPTY_PROP: NewProp = {
  name: '',
  client_name: '',
  ce_charged: '',
  cleaner_pay: '',
  bedrooms: '',
  number_of_beds: '',
  full_baths: '',
  half_baths: '',
  number_of_kitchens: '',
  hot_tub: false,
  sq_ft: '',
  address: '',
  contact_id: '',
}

export default function QuoteSheetPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  usePageTitle('Quote Sheet')
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
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<string | null>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = q
      ? (properties || []).filter((p: any) =>
          [p.name, p.client, p.address].some((v: any) => v && v.toLowerCase().includes(q))
        )
      : (properties || [])

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
  }, [properties, search, sortKey, sortDir])

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
        client: newProp.client_name || null,
        contact_id: newProp.contact_id ? parseInt(newProp.contact_id) : null,
        ce_charged: newProp.ce_charged ? parseFloat(newProp.ce_charged) : null,
        cleaner_pay: newProp.cleaner_pay ? parseFloat(newProp.cleaner_pay) : null,
        bedrooms: newProp.bedrooms ? parseInt(newProp.bedrooms) : null,
        number_of_beds: beds || null,
        full_baths: fullBaths || null,
        half_baths: newProp.half_baths ? parseFloat(newProp.half_baths) : null,
        number_of_kitchens: kitchens,
        hot_tub: newProp.hot_tub,
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

  const { mutate: convertToOnboarding, isPending: convertPending } = useGuardedMutation('quote-sheet', {
    mutationFn: async (prop: any) => {
      if (!onboardingStage) throw new Error('No Onboarding stage')
      const { error: updateErr } = await supabase.from('properties').update({ stage_id: onboardingStage.id }).eq('id', prop.id)
      if (updateErr) throw updateErr
      await supabase.from('stage_transitions').insert({
        property_id: prop.id,
        from_stage_id: quoteStage?.id,
        to_stage_id: onboardingStage.id,
        changed_by: 'ops-user',
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/quote-sheet'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      toast({ title: 'Moved to Onboarding' })
      setConverting(null)
    },
    onError: () => toast({ title: 'Failed', variant: 'destructive' }),
  })

  function handleDuplicate(prop: any) {
    setNewProp({
      name: '',
      client_name: prop.client || '',
      ce_charged: prop.ce_charged != null ? String(prop.ce_charged) : '',
      cleaner_pay: prop.cleaner_pay != null ? String(prop.cleaner_pay) : '',
      bedrooms: prop.bedrooms != null ? String(prop.bedrooms) : '',
      number_of_beds: prop.number_of_beds != null ? String(prop.number_of_beds) : '',
      full_baths: prop.full_baths != null ? String(prop.full_baths) : '',
      half_baths: prop.half_baths != null ? String(prop.half_baths) : '',
      number_of_kitchens: prop.number_of_kitchens != null ? String(prop.number_of_kitchens) : '',
      hot_tub: prop.hot_tub || false,
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

  // Compute estimates for display (fall back to client-side calc if DB value absent)
  function getEstimates(p: any) {
    const beds = p.number_of_beds || 0
    const laundry = p.est_laundry ?? calcLaundry(beds)
    const consumables = p.est_consumables ?? calcConsumablesFromCosts(amenityCosts, { ...p, kitchens: p.number_of_kitchens })
    return { laundry, consumables }
  }

  function exportCsv() {
    if (!filtered || filtered.length === 0) return
    const headers = ['Name', 'Client Charged', 'Cleaner Pay', 'Bedrooms', 'Beds', 'Full Baths', 'Half Baths', 'Sq Ft', 'Est Laundry', 'Est Consumables', 'Inspection', 'Trash', 'Profit %']
    const rows = filtered.map((p: any) => {
      const { laundry, consumables } = getEstimates(p)
      return [
        p.name || '',
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
        <div className="flex items-center gap-2">
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
              onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-7 h-8 w-48 text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)} data-testid="button-add-quote" className="gap-1.5 no-print">
            <Plus className="w-3.5 h-3.5" />
            New Quote
          </Button>
        </div>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              {([
                { col: 'name', label: 'Name' },
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
                  {[...Array(14)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}
                </tr>
              ))
            ) : !properties || properties.length === 0 ? (
              <tr>
                <td colSpan={14}>
                  <EmptyState icon={FileSpreadsheet} title="No quotes yet" description="Add a property to the Quote stage to get started." action={{ label: 'New Quote', onClick: () => setAddOpen(true) }} />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={14}>
                  <EmptyState icon={Search} title="No results" description={`No properties match "${search}".`} />
                </td>
              </tr>
            ) : (
              filtered.map((p: any) => {
                const { laundry, consumables } = getEstimates(p)
                return (
                  <tr key={p.id} data-testid={`row-quote-${p.id}`} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-2 px-3 font-medium text-xs sticky left-0 z-10 bg-background">{p.name}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.ce_charged)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.cleaner_pay)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.bedrooms ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.number_of_beds ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.full_baths ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.half_baths ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.square_footage?.toLocaleString() ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{fmt(laundry)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{fmt(consumables)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums text-muted-foreground">{fmt(INSPECTION_COST)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums text-muted-foreground">{fmt(TRASH_COST)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">
                      {p.profit_percentage != null ? (
                        <span className={`font-medium ${profitColorClass(p.profit_percentage)}`}>
                          {p.profit_percentage.toFixed(1)}%
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
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs gap-1 hover:text-primary px-2"
                          onClick={() => handleConvert(p)}
                          data-testid={`button-convert-${p.id}`}
                        >
                          <ArrowRight className="w-3 h-3" /> Onboard
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
            {filtered.length > 0 && (
              <tr className="bg-muted/60 border-t-2 border-border font-semibold">
                <td className="py-2 px-3 text-xs uppercase tracking-wide sticky left-0 z-10 bg-muted/60">Totals / Avg ({filtered.length})</td>
                <td className="py-2 px-3 text-xs tabular-nums">{fmt(filtered.reduce((s: number, p: any) => s + (p.ce_charged || 0), 0))}</td>
                <td className="py-2 px-3 text-xs tabular-nums">{fmt(filtered.reduce((s: number, p: any) => s + (p.cleaner_pay || 0), 0))}</td>
                <td className="py-2 px-3 text-xs tabular-nums" colSpan={5}></td>
                <td className="py-2 px-3 text-xs tabular-nums">{fmt(filtered.reduce((s: number, p: any) => s + (getEstimates(p).laundry || 0), 0))}</td>
                <td className="py-2 px-3 text-xs tabular-nums">{fmt(filtered.reduce((s: number, p: any) => s + (getEstimates(p).consumables || 0), 0))}</td>
                <td className="py-2 px-3 text-xs tabular-nums">{fmt(filtered.length * INSPECTION_COST)}</td>
                <td className="py-2 px-3 text-xs tabular-nums">{fmt(filtered.length * TRASH_COST)}</td>
                <td className="py-2 px-3 text-xs tabular-nums">
                  {(() => {
                    const validProfit = filtered.filter((p: any) => p.profit_percentage != null)
                    if (validProfit.length === 0) return '—'
                    const avg = validProfit.reduce((s: number, p: any) => s + p.profit_percentage, 0) / validProfit.length
                    return <span className={`font-medium ${profitColorClass(avg)}`}>{avg.toFixed(1)}%</span>
                  })()}
                </td>
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
              <Input value={newProp.address} onChange={e => setNewProp(prev => ({ ...prev, address: e.target.value }))} className="h-8 text-sm" data-testid="input-new-address" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Client Name</Label>
              <Input value={newProp.client_name} onChange={e => setNewProp(prev => ({ ...prev, client_name: e.target.value }))} className="h-8 text-sm" data-testid="input-new-client_name" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Client</Label>
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
                <Label className="text-xs text-muted-foreground">Number of Beds</Label>
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
                  const totalCost = laundry + consumables + INSPECTION_COST + TRASH_COST
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
    </div>
  )
}
