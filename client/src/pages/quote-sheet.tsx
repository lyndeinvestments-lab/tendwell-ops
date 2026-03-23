import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, STAGE_COLORS } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { StageTransitionModal } from '@/components/StageTransitionModal'
import { usePageTitle } from '@/hooks/use-page-title'
import { Plus, ArrowRight, Loader2, Copy } from 'lucide-react'

// ── Cost estimate formulas ────────────────────────────────────────────────────
const INSPECTION_COST = 15
const TRASH_COST = 5

// Laundry: number of beds × wash/dry cost per set
function calcLaundry(numberOfBeds: number): number {
  return numberOfBeds * 11.5 * 0.69
}

// Consumables itemized by unit costs
const BATHROOM_COST = 1.05   // shampoo $0.26 + conditioner $0.26 + body wash $0.26 + bar $0.23 + liners $0.04
const TOILET_PAPER_COST = 0.78 // 2 rolls × $0.39 — flat per property
const KITCHEN_COST = 2.05    // dish soap $0.51 + gel pod $0.23 + tab $0.17 + paper towel $0.94 + liners $0.20
const TRASH_BAG_56G_COST = 0.06 // $0.30 × 0.2 per bed
const HOT_TUB_COST = 0.88    // bromine $0.58 + floater $0.30 per hot tub

function calcConsumables(
  fullBaths: number,
  numberOfBeds: number,
  kitchens: number,
  hotTubCount: number,
): number {
  return (fullBaths * BATHROOM_COST + TOILET_PAPER_COST)
    + (kitchens * KITCHEN_COST)
    + (TRASH_BAG_56G_COST * numberOfBeds)
    + (HOT_TUB_COST * hotTubCount)
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
}

export default function QuoteSheetPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  usePageTitle('Quote Sheet')
  const [addOpen, setAddOpen] = useState(false)
  const [converting, setConverting] = useState<any>(null)
  const [newProp, setNewProp] = useState<NewProp>(EMPTY_PROP)

  const { data: stages } = useQuery({
    queryKey: ['/supabase/pipeline_stages'],
    queryFn: async () => {
      const { data } = await supabase.from('pipeline_stages').select('*').order('display_order')
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

  const { mutate: addProperty, isPending: addPending } = useMutation({
    mutationFn: async () => {
      if (!quoteStage) throw new Error('No Quote stage')
      const beds = newProp.number_of_beds ? parseInt(newProp.number_of_beds) : 0
      const fullBaths = newProp.full_baths ? parseFloat(newProp.full_baths) : 0
      const kitchens = newProp.number_of_kitchens ? parseInt(newProp.number_of_kitchens) : 1
      const hotTubCount = newProp.hot_tub ? 1 : 0
      const estLaundry = calcLaundry(beds)
      const estConsumables = calcConsumables(fullBaths, beds, kitchens, hotTubCount)
      const { error } = await supabase.from('properties').insert({
        name: newProp.name,
        client: newProp.client_name || null,
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

  const { mutate: convertToOnboarding, isPending: convertPending } = useMutation({
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
    const fullBaths = p.full_baths || 0
    const kitchens = p.number_of_kitchens ?? 1
    const hotTubCount = p.hot_tub ? 1 : 0
    const laundry = p.est_laundry ?? calcLaundry(beds)
    const consumables = p.est_consumables ?? calcConsumables(fullBaths, beds, kitchens, hotTubCount)
    return { laundry, consumables }
  }

  return (
    <div className="p-5 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Quote Sheet</h1>
          <p className="text-sm text-muted-foreground">Properties currently in Quote stage</p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} data-testid="button-add-quote" className="gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          New Quote
        </Button>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Name</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">CE Charged</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Cleaner Pay</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Bedrooms</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Beds</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Full Baths</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Half Baths</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Sq Ft</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Est Laundry</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Est Consumables</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Inspection</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Trash</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Profit %</th>
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
                <td colSpan={14} className="text-center py-12 text-muted-foreground text-sm">No properties in Quote stage</td>
              </tr>
            ) : (
              properties.map((p: any) => {
                const { laundry, consumables } = getEstimates(p)
                return (
                  <tr key={p.id} data-testid={`row-quote-${p.id}`} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-2 px-3 font-medium text-xs">{p.name}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.ce_charged)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.cleaner_pay)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.bedrooms ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.number_of_beds ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.full_baths ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.half_baths ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.square_footage?.toLocaleString() ?? '—'}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{fmt(laundry)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{fmt(consumables)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums text-muted-foreground">$15.00</td>
                    <td className="py-2 px-3 text-xs tabular-nums text-muted-foreground">$5.00</td>
                    <td className="py-2 px-3 text-xs tabular-nums">
                      {p.profit_percentage != null ? `${p.profit_percentage.toFixed(1)}%` : '—'}
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
            {/* Text/number fields */}
            {([
              { key: 'name', label: 'Property Name *', type: 'text' },
              { key: 'client_name', label: 'Client Name', type: 'text' },
              { key: 'ce_charged', label: 'CE Charged ($)', type: 'number' },
              { key: 'cleaner_pay', label: 'Cleaner Pay ($)', type: 'number' },
              { key: 'bedrooms', label: 'Number of Bedrooms', type: 'number' },
              { key: 'number_of_beds', label: 'Number of Beds', type: 'number' },
              { key: 'full_baths', label: 'Full Baths', type: 'number' },
              { key: 'half_baths', label: 'Half Baths', type: 'number' },
              { key: 'number_of_kitchens', label: 'Number of Kitchens', type: 'number' },
              { key: 'sq_ft', label: 'Square Footage', type: 'number' },
              { key: 'address', label: 'Address', type: 'text' },
            ] as { key: keyof NewProp; label: string; type: string }[]).map(f => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs text-muted-foreground">{f.label}</Label>
                <Input
                  type={f.type}
                  value={(newProp[f.key] as string)}
                  onChange={e => setNewProp(prev => ({ ...prev, [f.key]: e.target.value }))}
                  data-testid={`input-new-${f.key}`}
                  className="h-8 text-sm"
                />
              </div>
            ))}

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

            {/* Live estimate preview */}
            {(newProp.number_of_beds || newProp.full_baths) && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 space-y-1 text-xs">
                <p className="font-medium text-foreground mb-1">Estimated Costs</p>
                {(() => {
                  const beds = newProp.number_of_beds ? parseInt(newProp.number_of_beds) : 0
                  const fullBaths = newProp.full_baths ? parseFloat(newProp.full_baths) : 0
                  const kitchens = newProp.number_of_kitchens ? parseInt(newProp.number_of_kitchens) : 1
                  const laundry = calcLaundry(beds)
                  const consumables = calcConsumables(fullBaths, beds, kitchens, newProp.hot_tub ? 1 : 0)
                  return (
                    <>
                      <div className="flex justify-between"><span className="text-muted-foreground">Est Laundry</span><span className="tabular-nums">{fmt(laundry)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Est Consumables</span><span className="tabular-nums">{fmt(consumables)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Inspection</span><span className="tabular-nums">$15.00</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Trash</span><span className="tabular-nums">$5.00</span></div>
                      <div className="flex justify-between border-t border-border pt-1 font-medium"><span>Total Costs</span><span className="tabular-nums">{fmt(laundry + consumables + INSPECTION_COST + TRASH_COST)}</span></div>
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
