import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { STAGE_COLORS } from '@/lib/supabase'
import { Loader2 } from 'lucide-react'

interface PropertyEditDialogProps {
  property: any
  stageName: string
  open: boolean
  onClose: () => void
}

export function PropertyEditDialog({ property, stageName, open, onClose }: PropertyEditDialogProps) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [ceCharged, setCeCharged] = useState(String(property?.ce_charged ?? ''))
  const [cleanerPay, setCleanerPay] = useState(String(property?.cleaner_pay ?? ''))

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('properties')
        .update({
          ce_charged: parseFloat(ceCharged) || null,
          cleaner_pay: parseFloat(cleanerPay) || null,
        })
        .eq('id', property.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/properties'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      toast({ title: 'Property updated' })
      onClose()
    },
    onError: () => toast({ title: 'Error saving', variant: 'destructive' }),
  })

  if (!property) return null

  const stageColor = STAGE_COLORS[stageName] || '#6b7280'

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            {property.name}
            <Badge style={{ backgroundColor: stageColor + '20', color: stageColor, border: `1px solid ${stageColor}40` }} className="text-xs">
              {stageName}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Info row */}
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block">Client</span>
              <span className="font-medium">{property.client_name || '—'}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Address</span>
              <span className="font-medium text-xs">{property.address || '—'}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Beds / Baths</span>
              <span className="font-medium">{property.bedrooms ?? '—'} / {property.full_baths ?? '—'}{property.half_baths ? ` + ${property.half_baths}h` : ''}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">CE Charged</Label>
              <Input
                type="number"
                value={ceCharged}
                onChange={e => setCeCharged(e.target.value)}
                data-testid="input-ce-charged"
                className="h-8"
                step="0.01"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cleaner Pay</Label>
              <Input
                type="number"
                value={cleanerPay}
                onChange={e => setCleanerPay(e.target.value)}
                data-testid="input-cleaner-pay"
                className="h-8"
                step="0.01"
              />
            </div>
          </div>

          {/* Computed fields */}
          <div className="grid grid-cols-3 gap-3 bg-muted/50 rounded-md p-3">
            <div>
              <span className="text-xs text-muted-foreground block">Total Cost</span>
              <span className="text-sm font-medium">${(property.total_estimated_cost || 0).toFixed(2)}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Profit</span>
              <span className="text-sm font-medium">${(property.estimated_profit || 0).toFixed(2)}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Profit %</span>
              <span className="text-sm font-medium">{(property.profit_percentage || 0).toFixed(1)}%</span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button size="sm" onClick={() => mutate()} disabled={isPending} data-testid="button-save-property">
            {isPending ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Saving…</> : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
