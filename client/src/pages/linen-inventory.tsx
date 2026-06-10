import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Boxes, Check, ChevronDown, ChevronUp, Download, Plus,
} from 'lucide-react'
import { format } from 'date-fns'
import Papa from 'papaparse'

type ViewMode = 'snapshot' | 'record' | 'history'

// ─── Linen type definitions ─────────────────────────────────────────────────
// "Standard" items shown by default during a count
const STANDARD_ITEMS = [
  { key: 'king_rolls', label: 'King Rolls', reqKey: 'king_beds', description: '1 fitted + 1 flat + 4 pillowcases' },
  { key: 'queen_rolls', label: 'Queen Rolls', reqKey: 'queen_beds', description: '1 fitted + 1 flat + 4 pillowcases' },
  { key: 'full_rolls', label: 'Full Rolls', reqKey: 'full_beds', description: '1 fitted + 1 flat + 4 pillowcases' },
  { key: 'twin_rolls', label: 'Twin Rolls', reqKey: 'twin_beds', description: '1 fitted + 1 flat + 2 pillowcases' },
  { key: 'king_top_sheets', label: 'King Top Sheets', reqKey: 'king_beds' },
  { key: 'queen_top_sheets', label: 'Queen Top Sheets', reqKey: 'queen_beds' },
  { key: 'full_top_sheets', label: 'Full Top Sheets', reqKey: 'full_beds' },
  { key: 'twin_top_sheets', label: 'Twin Top Sheets', reqKey: 'twin_beds' },
  { key: 'bath_towels', label: 'Bath Towels', reqKey: 'bath_towels' },
  { key: 'washcloths', label: 'Washcloths', reqKey: 'washcloths' },
  { key: 'hand_towels', label: 'Hand Towels', reqKey: 'hand_towels' },
  { key: 'bathmats', label: 'Bathmats', reqKey: 'bathmats' },
  { key: 'pool_towels', label: 'Pool Towels', reqKey: 'pool_towels' },
  // Requirement = 3 × total kitchens across the operational set (computed in
  // the requirements query under the synthetic `kitchen_towels_required` key).
  { key: 'kitchen_towels', label: 'Kitchen Towels', reqKey: 'kitchen_towels_required', description: '3 per kitchen' },
] as const

// On-hand-only items: tracked quantity with NO required target / variance.
// Mattress encasements (one per bed size) and pillows (the pillow itself,
// not pillowcases — king + standard).
const ENCASEMENT_ITEMS = [
  { key: 'king_encasements', label: 'King Encasements' },
  { key: 'queen_encasements', label: 'Queen Encasements' },
  { key: 'full_encasements', label: 'Full Encasements' },
  { key: 'twin_encasements', label: 'Twin Encasements' },
] as const

const PILLOW_ITEMS = [
  { key: 'king_pillows', label: 'King Pillows' },
  { key: 'standard_pillows', label: 'Standard Pillows' },
] as const

const ON_HAND_ITEMS = [...ENCASEMENT_ITEMS, ...PILLOW_ITEMS] as const

// "Extra" individual pieces (not in rolls)
const EXTRA_ITEMS = [
  { key: 'king_fitted_extras', label: 'King Fitted (extras)' },
  { key: 'king_flat_extras', label: 'King Flat (extras)' },
  { key: 'king_pillowcase_extras', label: 'King Pillowcases (extras)' },
  { key: 'queen_fitted_extras', label: 'Queen Fitted (extras)' },
  { key: 'queen_flat_extras', label: 'Queen Flat (extras)' },
  { key: 'queen_pillowcase_extras', label: 'Queen Pillowcases (extras)' },
  { key: 'full_fitted_extras', label: 'Full Fitted (extras)' },
  { key: 'full_flat_extras', label: 'Full Flat (extras)' },
  { key: 'full_pillowcase_extras', label: 'Full Pillowcases (extras)' },
  { key: 'twin_fitted_extras', label: 'Twin Fitted (extras)' },
  { key: 'twin_flat_extras', label: 'Twin Flat (extras)' },
  { key: 'twin_pillowcase_extras', label: 'Twin Pillowcases (extras)' },
] as const

const ALL_ITEMS = [...STANDARD_ITEMS, ...EXTRA_ITEMS, ...ON_HAND_ITEMS]

function VarianceBadge({ value }: { value: number }) {
  if (value > 0) return <span className="text-xs font-medium text-success">+{value}</span>
  if (value < 0) return <span className="text-xs font-medium text-destructive">{value}</span>
  return <span className="text-xs text-muted-foreground">0</span>
}

export default function LinenInventoryPage() {
  usePageTitle('Linen Inventory')
  const { toast } = useToast()
  const { effectiveUser } = useAuth()
  const qc = useQueryClient()
  const canEdit = canEditView('linen-inventory', effectiveUser)

  const [viewMode, setViewMode] = useState<ViewMode>('snapshot')
  const [showExtras, setShowExtras] = useState(false)
  const [countValues, setCountValues] = useState<Record<string, string>>({})
  const [countBy, setCountBy] = useState(effectiveUser?.label || '')
  const [countNotes, setCountNotes] = useState('')

  // ─── Queries ──────────────────────────────────────────────────────────────

  // Company totals — must match the Linen Requirements page exactly. Both
  // pages now read from the `operational_properties` view (which excludes
  // soft-deleted rows via the 20260428 migration) and filter to
  // stage_name IN ('Active', 'Onboarding').
  //
  // Previously this page queried `properties` directly with a NOT-IN filter
  // that included Offboarding stage AND missed the deleted_at filter, so the
  // "Required" totals here disagreed with /linen-tracker (e.g. 271 vs 268
  // king beds, 1720 vs 1703 bath towels) by Offboarding inventory plus any
  // soft-deleted property's bed/towel counts.
  const { data: requirements, isLoading: reqLoading } = useQuery({
    queryKey: ['/supabase/linen-inventory-requirements'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('king_beds, queen_beds, full_beds, twin_beds, bath_towels, washcloths, hand_towels, bathmats, pool_towels, kitchens, stage_name')
        .in('stage_name', ['Active', 'Onboarding'])
      if (error) throw error
      const totals: Record<string, number> = {}
      const keys = ['king_beds', 'queen_beds', 'full_beds', 'twin_beds', 'bath_towels', 'washcloths', 'hand_towels', 'bathmats', 'pool_towels']
      for (const k of keys) totals[k] = 0
      let kitchens = 0
      for (const p of (data || [])) {
        for (const k of keys) totals[k] += (p as any)[k] ?? 0
        kitchens += (p as any).kitchens ?? 0
      }
      // Kitchen towels: 3 per kitchen across the operational set.
      totals['kitchen_towels_required'] = Math.round(kitchens * 3)
      return totals
    },
  })

  // Latest inventory count
  const { data: latestCount, isLoading: countLoading } = useQuery({
    queryKey: ['/supabase/linen-inventory-latest'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('linen_inventory_counts')
        .select('*')
        .order('counted_at', { ascending: false })
        .limit(1)
        .single()
      if (error && error.code !== 'PGRST116') throw error // PGRST116 = no rows
      return data || null
    },
  })

  // Count history
  const [detailCount, setDetailCount] = useState<any>(null)
  const { data: history, isLoading: histLoading } = useQuery({
    queryKey: ['/supabase/linen-inventory-history'],
    enabled: viewMode === 'history',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('linen_inventory_counts')
        .select('*')
        .order('counted_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data || []
    },
  })

  // ─── Derived snapshot data ────────────────────────────────────────────────
  const snapshotRows = useMemo(() => {
    if (!requirements) return []
    return STANDARD_ITEMS.map(item => {
      const required = requirements[item.reqKey] ?? 0
      const onHand = latestCount ? (latestCount as any)[item.key] ?? 0 : null
      const variance = onHand != null ? onHand - required : null
      return { ...item, required, onHand, variance }
    })
  }, [requirements, latestCount])

  const extraRows = useMemo(() => {
    if (!latestCount) return []
    return EXTRA_ITEMS.map(item => ({
      ...item,
      onHand: (latestCount as any)[item.key] ?? 0,
    })).filter(r => r.onHand > 0)
  }, [latestCount])

  // On-hand-only rows (encasements + pillows): always shown, no required/variance.
  const onHandRows = useMemo(() => {
    return ON_HAND_ITEMS.map(item => ({
      ...item,
      onHand: latestCount ? (latestCount as any)[item.key] ?? 0 : null,
    }))
  }, [latestCount])

  const totalRequired = snapshotRows.reduce((s, r) => s + r.required, 0)
  const totalOnHand = snapshotRows.reduce((s, r) => s + (r.onHand ?? 0), 0)
  const totalVariance = latestCount ? totalOnHand - totalRequired : null
  const shortages = snapshotRows.filter(r => r.variance != null && r.variance < 0)

  // ─── Record Count ─────────────────────────────────────────────────────────
  const { mutate: saveCount, isPending: saving } = useGuardedMutation('linen-inventory', {
    mutationFn: async () => {
      const insert: Record<string, any> = {
        counted_at: new Date().toISOString(),
        counted_by: countBy.trim() || null,
        notes: countNotes.trim() || null,
      }
      for (const item of ALL_ITEMS) {
        const v = countValues[item.key]
        insert[item.key] = v ? parseInt(v) || 0 : 0
      }
      const { error } = await supabase.from('linen_inventory_counts').insert(insert)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/linen-inventory-latest'] })
      qc.invalidateQueries({ queryKey: ['/supabase/linen-inventory-history'] })
      toast({ title: 'Inventory count saved' })
      setViewMode('snapshot')
      setCountValues({})
      setCountNotes('')
      setShowExtras(false)
    },
    onError: (error: any) => toast({ title: 'Save failed', description: error?.message, variant: 'destructive' }),
  })

  function prefillFromLatest() {
    if (!latestCount) return
    const vals: Record<string, string> = {}
    for (const item of ALL_ITEMS) {
      const v = (latestCount as any)[item.key]
      if (v) vals[item.key] = String(v)
    }
    setCountValues(vals)
    toast({ title: 'Prefilled from last count' })
  }

  function exportHistory() {
    if (!history?.length) return
    const rows = history.map((h: any) => {
      const row: Record<string, any> = {
        'Counted At': format(new Date(h.counted_at), 'yyyy-MM-dd HH:mm'),
        'Counted By': h.counted_by || '',
      }
      for (const item of STANDARD_ITEMS) row[item.label] = h[item.key] ?? 0
      for (const item of ON_HAND_ITEMS) row[item.label] = h[item.key] ?? 0
      for (const item of EXTRA_ITEMS) {
        if (h[item.key]) row[item.label] = h[item.key]
      }
      row['Notes'] = h.notes || ''
      return row
    })
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `linen-inventory-${new Date().toISOString().split('T')[0]}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const isLoading = reqLoading || countLoading

  return (
    <PageContainer width="full" className="h-full flex flex-col">
      <PageHeader
        title="Linen Inventory"
        subtitle={
          <span>
            Company-wide linen counts vs. total requirements
            {latestCount && <span className="ml-2">· Last counted {format(new Date(latestCount.counted_at), 'MMM d, yyyy')}</span>}
          </span>
        }
        actions={
          <div className="flex items-center border rounded-md overflow-hidden">
            {(['snapshot', 'record', 'history'] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === v ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
              >
                {v === 'snapshot' ? 'Current Status' : v === 'record' ? 'Record Count' : 'Count History'}
              </button>
            ))}
          </div>
        }
      />

      {/* ═══ SNAPSHOT VIEW ═══ */}
      {viewMode === 'snapshot' && (
        <>
          {/* Prominent empty state when no counts have been recorded yet —
              moved up from the buried table empty cell so the on-hand status
              isn't hidden behind dashes. */}
          {!isLoading && !latestCount && (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-5 flex items-start gap-4">
              <div className="w-10 h-10 rounded-md bg-background border border-border flex items-center justify-center flex-shrink-0">
                <Boxes className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">No on-hand counts yet</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                  Record your first inventory count to see variance vs the company-wide requirement on this page. Until then,
                  the “On Hand” and “Variance” columns will show <span className="font-mono">—</span>.
                </p>
              </div>
              <button
                onClick={() => setViewMode('record')}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 flex-shrink-0"
              >
                Record Count
              </button>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard title="Total Required" value={totalRequired.toLocaleString()} icon={Boxes} />
            <StatCard title="Total On Hand" value={latestCount ? totalOnHand.toLocaleString() : '—'} icon={Boxes} />
            <StatCard
              title="Overall Variance"
              value={totalVariance != null ? (totalVariance > 0 ? '+' : '') + totalVariance.toLocaleString() : '—'}
              tone={totalVariance != null && totalVariance < 0 ? 'destructive' : totalVariance != null && totalVariance > 0 ? 'success' : 'neutral'}
              icon={Boxes}
            />
            <StatCard
              title="Shortages"
              value={latestCount ? String(shortages.length) : '—'}
              tone={shortages.length > 0 ? 'destructive' : 'success'}
              icon={Boxes}
            />
          </div>

          {/* Main table */}
          <div className="overflow-auto flex-1 rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted border-b border-border z-20">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Item</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Required</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">On Hand</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Variance</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(13)].map((_, i) => <tr key={i} className="border-b border-border/50">{[...Array(4)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}</tr>)
                ) : (
                  <>
                    {snapshotRows.map(row => (
                      <tr key={row.key} className={`border-b border-border/50 ${row.variance != null && row.variance < 0 ? 'bg-destructive/5' : ''}`}>
                        <td className="py-2 px-3 text-xs font-medium">
                          {row.label}
                          {'description' in row && row.description && <span className="text-muted-foreground font-normal ml-1.5">({(row as any).description})</span>}
                        </td>
                        <td className="py-2 px-3 text-xs tabular-nums text-right">{row.required}</td>
                        <td className="py-2 px-3 text-xs tabular-nums text-right font-medium">{row.onHand ?? '—'}</td>
                        <td className="py-2 px-3 text-right">{row.variance != null ? <VarianceBadge value={row.variance} /> : <span className="text-xs text-muted-foreground">—</span>}</td>
                      </tr>
                    ))}
                    {/* Encasements & pillows — on-hand only, no required target */}
                    <tr className="bg-muted/40">
                      <td colSpan={4} className="py-1.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Encasements & Pillows</td>
                    </tr>
                    {onHandRows.map(row => (
                      <tr key={row.key} className="border-b border-border/50">
                        <td className="py-2 px-3 text-xs font-medium">{row.label}</td>
                        <td className="py-2 px-3 text-xs tabular-nums text-right text-muted-foreground">—</td>
                        <td className="py-2 px-3 text-xs tabular-nums text-right font-medium">{row.onHand ?? '—'}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground text-xs">—</td>
                      </tr>
                    ))}
                    {/* Extras section */}
                    {extraRows.length > 0 && (
                      <>
                        <tr className="bg-muted/40">
                          <td colSpan={4} className="py-1.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Individual Extras</td>
                        </tr>
                        {extraRows.map(row => (
                          <tr key={row.key} className="border-b border-border/50">
                            <td className="py-2 px-3 text-xs">{row.label}</td>
                            <td className="py-2 px-3 text-xs tabular-nums text-right text-muted-foreground">—</td>
                            <td className="py-2 px-3 text-xs tabular-nums text-right font-medium">{row.onHand}</td>
                            <td className="py-2 px-3 text-right text-muted-foreground text-xs">—</td>
                          </tr>
                        ))}
                      </>
                    )}
                    {/* Totals */}
                    <tr className="bg-muted/60 border-t-2 border-border font-semibold">
                      <td className="py-2 px-3 text-xs uppercase tracking-wide">Total</td>
                      <td className="py-2 px-3 text-xs tabular-nums text-right">{totalRequired.toLocaleString()}</td>
                      <td className="py-2 px-3 text-xs tabular-nums text-right">{latestCount ? totalOnHand.toLocaleString() : '—'}</td>
                      <td className="py-2 px-3 text-right">{totalVariance != null ? <VarianceBadge value={totalVariance} /> : <span className="text-xs text-muted-foreground">—</span>}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>

          {!latestCount && !isLoading && (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-2">No inventory count recorded yet.</p>
              {canEdit && <Button size="sm" onClick={() => setViewMode('record')} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Record First Count</Button>}
            </div>
          )}
        </>
      )}

      {/* ═══ RECORD COUNT VIEW ═══ */}
      {viewMode === 'record' && (
        <div className="flex-1 overflow-auto">
          <div className="max-w-2xl mx-auto space-y-5">
            {!canEdit ? (
              <div className="text-center py-8 text-muted-foreground">
                <Boxes className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-medium">View Only</p>
                <p className="text-xs">You don't have edit access to record counts.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Enter current quantities on hand</p>
                  {latestCount && (
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={prefillFromLatest}>
                      Prefill from last count
                    </Button>
                  )}
                </div>

                {/* Rolls */}
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Rolls</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {STANDARD_ITEMS.filter(i => i.key.endsWith('_rolls')).map(item => (
                      <div key={item.key}>
                        <label className="text-xs text-muted-foreground block mb-1">{item.label}</label>
                        <Input
                          type="number" inputMode="numeric"
                          value={countValues[item.key] || ''}
                          onChange={e => setCountValues(v => ({ ...v, [item.key]: e.target.value }))}
                          className="h-10 text-base font-medium"
                          placeholder="0"
                        />
                        {requirements && <p className="text-xs text-muted-foreground mt-0.5">Need: {requirements[item.reqKey] ?? 0}</p>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Top Sheets */}
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Top Sheets</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {STANDARD_ITEMS.filter(i => i.key.endsWith('_top_sheets')).map(item => (
                      <div key={item.key}>
                        <label className="text-xs text-muted-foreground block mb-1">{item.label}</label>
                        <Input
                          type="number" inputMode="numeric"
                          value={countValues[item.key] || ''}
                          onChange={e => setCountValues(v => ({ ...v, [item.key]: e.target.value }))}
                          className="h-10 text-base font-medium"
                          placeholder="0"
                        />
                        {requirements && <p className="text-xs text-muted-foreground mt-0.5">Need: {requirements[item.reqKey] ?? 0}</p>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Towels */}
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Towels</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {STANDARD_ITEMS.filter(i => !i.key.endsWith('_rolls') && !i.key.endsWith('_top_sheets')).map(item => (
                      <div key={item.key}>
                        <label className="text-xs text-muted-foreground block mb-1">{item.label}</label>
                        <Input
                          type="number" inputMode="numeric"
                          value={countValues[item.key] || ''}
                          onChange={e => setCountValues(v => ({ ...v, [item.key]: e.target.value }))}
                          className="h-10 text-base font-medium"
                          placeholder="0"
                        />
                        {requirements && <p className="text-xs text-muted-foreground mt-0.5">Need: {requirements[item.reqKey] ?? 0}</p>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Mattress Encasements — on-hand only, no requirement */}
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Mattress Encasements</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {ENCASEMENT_ITEMS.map(item => (
                      <div key={item.key}>
                        <label className="text-xs text-muted-foreground block mb-1">{item.label}</label>
                        <Input
                          type="number" inputMode="numeric"
                          value={countValues[item.key] || ''}
                          onChange={e => setCountValues(v => ({ ...v, [item.key]: e.target.value }))}
                          className="h-10 text-base font-medium"
                          placeholder="0"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pillows — the pillow itself (not pillowcases); on-hand only */}
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Pillows</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {PILLOW_ITEMS.map(item => (
                      <div key={item.key}>
                        <label className="text-xs text-muted-foreground block mb-1">{item.label}</label>
                        <Input
                          type="number" inputMode="numeric"
                          value={countValues[item.key] || ''}
                          onChange={e => setCountValues(v => ({ ...v, [item.key]: e.target.value }))}
                          className="h-10 text-base font-medium"
                          placeholder="0"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Extras toggle */}
                <button
                  onClick={() => setShowExtras(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showExtras ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {showExtras ? 'Hide' : 'Show'} individual extras (fitted, flat, pillowcases)
                </button>

                {showExtras && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Individual Extras</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {EXTRA_ITEMS.map(item => (
                        <div key={item.key}>
                          <label className="text-xs text-muted-foreground block mb-1">{item.label}</label>
                          <Input
                            type="number" inputMode="numeric"
                            value={countValues[item.key] || ''}
                            onChange={e => setCountValues(v => ({ ...v, [item.key]: e.target.value }))}
                            className="h-9"
                            placeholder="0"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Counted by + notes */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Counted By</label>
                    <Input value={countBy} onChange={e => setCountBy(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Notes</label>
                    <Input value={countNotes} onChange={e => setCountNotes(e.target.value)} placeholder="Optional…" className="h-9 text-sm" />
                  </div>
                </div>

                <Button
                  className="w-full h-11 text-sm gap-1.5"
                  disabled={saving}
                  onClick={() => saveCount()}
                >
                  <Check className="w-4 h-4" />
                  {saving ? 'Saving…' : 'Save Inventory Count'}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══ HISTORY VIEW ═══ */}
      {viewMode === 'history' && (
        <>
          <div className="flex items-center justify-end">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={exportHistory} disabled={!history?.length}>
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
          </div>

          <div className="overflow-auto flex-1 rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted border-b border-border z-20">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Date</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Counted By</th>
                  {STANDARD_ITEMS.slice(0, 4).map(i => (
                    <th key={i.key} className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">{i.label.replace(' Rolls', '').replace(' Top Sheets', ' TS')}</th>
                  ))}
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Bath</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Wash</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Hand</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {histLoading ? (
                  [...Array(5)].map((_, i) => <tr key={i} className="border-b border-border/50">{[...Array(9)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}</tr>)
                ) : !history?.length ? (
                  <tr><td colSpan={9}><EmptyState icon={Boxes} title="No count history" description="Record your first inventory count to start tracking." /></td></tr>
                ) : history.map((h: any) => (
                  <tr key={h.id} onClick={() => setDetailCount(h)} title="Click to see every field" className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer">
                    <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(h.counted_at), 'MMM d, yyyy h:mm a')}</td>
                    <td className="py-2 px-3 text-xs">{h.counted_by || '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums text-right">{h.king_rolls || 0}</td>
                    <td className="py-2 px-3 text-xs tabular-nums text-right">{h.queen_rolls || 0}</td>
                    <td className="py-2 px-3 text-xs tabular-nums text-right">{h.full_rolls || 0}</td>
                    <td className="py-2 px-3 text-xs tabular-nums text-right">{h.twin_rolls || 0}</td>
                    <td className="py-2 px-3 text-xs tabular-nums text-right">{h.bath_towels || 0}</td>
                    <td className="py-2 px-3 text-xs tabular-nums text-right">{h.washcloths || 0}</td>
                    <td className="py-2 px-3 text-xs tabular-nums text-right">{h.hand_towels || 0}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground max-w-[200px] truncate">{h.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {detailCount && (
        <Dialog open={!!detailCount} onOpenChange={(o) => { if (!o) setDetailCount(null) }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Count detail — {format(new Date(detailCount.counted_at), 'MMM d, yyyy h:mm a')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="text-xs text-muted-foreground">Counted by {detailCount.counted_by || '—'}</div>
              {[
                { title: 'Sheets, Towels & Kitchen', items: STANDARD_ITEMS },
                { title: 'On Hand — Encasements & Pillows', items: ON_HAND_ITEMS },
                { title: 'Extras', items: EXTRA_ITEMS },
              ].map(group => (
                <div key={group.title}>
                  <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{group.title}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                    {group.items.map((it: any) => (
                      <div key={it.key} className="flex items-center justify-between gap-2 border-b border-border/40 py-0.5">
                        <span className="text-xs text-muted-foreground">{it.label}</span>
                        <span className="text-sm font-medium tabular-nums">{detailCount[it.key] ?? 0}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {detailCount.notes && (
                <div>
                  <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm whitespace-pre-wrap bg-muted/30 rounded p-2">{detailCount.notes}</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </PageContainer>
  )
}
