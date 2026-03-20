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
import { Plus, ArrowRight, Loader2 } from 'lucide-react'

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function QuoteSheetPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [converting, setConverting] = useState<any>(null)
  const [newProp, setNewProp] = useState({ name: '', client_name: '', ce_charged: '', cleaner_pay: '', bedrooms: '', bathrooms: '', sq_ft: '' })

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
      const { error } = await supabase.from('properties').insert({
        name: newProp.name,
        client: newProp.client_name || null,
        ce_charged: newProp.ce_charged ? parseFloat(newProp.ce_charged) : null,
        cleaner_pay: newProp.cleaner_pay ? parseFloat(newProp.cleaner_pay) : null,
        bedrooms: newProp.bedrooms ? parseInt(newProp.bedrooms) : null,
        full_baths: newProp.bathrooms ? parseFloat(newProp.bathrooms) : null,
        square_footage: newProp.sq_ft ? parseFloat(newProp.sq_ft) : null,
        stage_id: quoteStage.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/quote-sheet'] })
      toast({ title: 'Property added to Quote stage' })
      setAddOpen(false)
      setNewProp({ name: '', client_name: '', ce_charged: '', cleaner_pay: '', bedrooms: '', bathrooms: '', sq_ft: '' })
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

  function handleConvert(prop: any) {
    const reqFields = onboardingStage?.requires_fields || []
    const missing = reqFields.filter((f: string) => !prop[f])
    if (missing.length > 0) setConverting({ prop, missing })
    else convertToOnboarding(prop)
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
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Beds</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Baths</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Sq Ft</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Suggested Pay</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Deep Clean</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Profit %</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(10)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}
                </tr>
              ))
            ) : !properties || properties.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-12 text-muted-foreground text-sm">No properties in Quote stage</td>
              </tr>
            ) : (
              properties.map((p: any) => (
                <tr key={p.id} data-testid={`row-quote-${p.id}`} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="py-2 px-3 font-medium text-xs">{p.name}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.ce_charged)}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.cleaner_pay)}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">{p.number_of_beds ?? '—'}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">{p.full_baths ?? '—'}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">{p.square_footage?.toLocaleString() ?? '—'}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.suggested_pay)}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.estimated_deep_clean_cost)}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">
                    {p.profit_percentage != null ? `${p.profit_percentage.toFixed(1)}%` : '—'}
                  </td>
                  <td className="py-2 px-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs gap-1 hover:text-primary"
                      onClick={() => handleConvert(p)}
                      data-testid={`button-convert-${p.id}`}
                    >
                      <ArrowRight className="w-3 h-3" /> Onboard
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Quote Dialog */}
      <Dialog open={addOpen} onOpenChange={v => !v && setAddOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Add New Quote</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {[
              { key: 'name', label: 'Property Name *', type: 'text' },
              { key: 'client_name', label: 'Client Name', type: 'text' },
              { key: 'ce_charged', label: 'CE Charged', type: 'number' },
              { key: 'cleaner_pay', label: 'Cleaner Pay', type: 'number' },
              { key: 'bedrooms', label: 'Bedrooms', type: 'number' },
              { key: 'bathrooms', label: 'Bathrooms', type: 'number' },
              { key: 'sq_ft', label: 'Sq Ft', type: 'number' },
            ].map(f => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs text-muted-foreground">{f.label}</Label>
                <Input
                  type={f.type}
                  value={(newProp as any)[f.key]}
                  onChange={e => setNewProp(prev => ({ ...prev, [f.key]: e.target.value }))}
                  data-testid={`input-new-${f.key}`}
                  className="h-8 text-sm"
                />
              </div>
            ))}
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
