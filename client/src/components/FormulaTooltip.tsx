import { Info } from 'lucide-react'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import type { AmenityCosts } from '@/lib/amenity-costs'

// Display-only breakdowns of the laundry and consumables formulas.
// Same formulas used by the server trigger
// (supabase/migrations/20260413_fix_laundry_constant.sql) and by
// calcLaundry / calcConsumables in the client. Nothing here changes behavior.

const LAUNDRY_POUNDS_PER_BED = 11.5
const LAUNDRY_RATE_PER_POUND = 0.69

function LineItem({ label, value, calc }: { label: string; value: number; calc?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums font-medium">
        {calc && <span className="text-muted-foreground mr-2">{calc}</span>}
        ${value.toFixed(2)}
      </span>
    </div>
  )
}

export function LaundryFormulaTooltip({
  numberOfBeds,
  override,
  children,
}: {
  numberOfBeds: number | null | undefined
  override?: number | null
  children: React.ReactNode
}) {
  const beds = Number(numberOfBeds) || 0
  const perBed = LAUNDRY_POUNDS_PER_BED * LAUNDRY_RATE_PER_POUND
  const total = beds * perBed
  const isOverride = override != null && Math.abs(Number(override) - total) > 0.01
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 cursor-help">
            {children}
            <Info className="w-3 h-3 text-muted-foreground/60" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs p-3 space-y-1.5">
          <p className="text-xs font-semibold">Est Laundry</p>
          <p className="text-[11px] text-muted-foreground">
            Formula: <span className="font-mono">beds × {LAUNDRY_POUNDS_PER_BED} lbs × ${LAUNDRY_RATE_PER_POUND.toFixed(2)}/lb</span>
          </p>
          <div className="border-t border-border pt-1.5 space-y-0.5">
            <LineItem label="Beds" value={beds} />
            <LineItem label="Per bed" value={perBed} calc={`${LAUNDRY_POUNDS_PER_BED} × ${LAUNDRY_RATE_PER_POUND.toFixed(2)}`} />
            <LineItem label="Computed total" value={total} calc={`${beds} × ${perBed.toFixed(3)}`} />
            {isOverride && (
              <div className="pt-1 mt-1 border-t border-border">
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  Stored value differs (${Number(override).toFixed(2)}) - likely a manual override.
                </p>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function ConsumablesFormulaTooltip({
  fullBaths,
  halfBaths,
  kitchens,
  numberOfBeds,
  hotTub,
  costs,
  override,
  children,
}: {
  fullBaths: number | null | undefined
  halfBaths: number | null | undefined
  kitchens: number | null | undefined
  numberOfBeds: number | null | undefined
  hotTub: boolean | null | undefined
  costs: AmenityCosts
  override?: number | null
  children: React.ReactNode
}) {
  const fb = Number(fullBaths) || 0
  const hb = Number(halfBaths) || 0
  const kt = Number(kitchens) || 1
  const bd = Number(numberOfBeds) || 0
  const ht = hotTub ? 1 : 0

  const bathroomsTotal = (fb + hb) * (costs.bathroom + costs.toiletPaper)
  const kitchenTotal = kt * costs.kitchen
  const trashTotal = bd * costs.trashBag
  const hotTubTotal = ht * costs.hotTub
  const total = bathroomsTotal + kitchenTotal + trashTotal + hotTubTotal
  const isOverride = override != null && Math.abs(Number(override) - total) > 0.01

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 cursor-help">
            {children}
            <Info className="w-3 h-3 text-muted-foreground/60" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm p-3 space-y-1.5">
          <p className="text-xs font-semibold">Est Consumables</p>
          <p className="text-[11px] text-muted-foreground font-mono">
            (baths × (bath + TP)) + (kitchens × kitchen) + (beds × trash bag) + (hot tub ? ht : 0)
          </p>
          <div className="border-t border-border pt-1.5 space-y-0.5">
            <LineItem label={`Baths (${fb + hb})`} value={bathroomsTotal} calc={`${fb + hb} × $${(costs.bathroom + costs.toiletPaper).toFixed(2)}`} />
            <LineItem label={`Kitchens (${kt})`} value={kitchenTotal} calc={`${kt} × $${costs.kitchen.toFixed(2)}`} />
            <LineItem label={`Trash bags (${bd} beds)`} value={trashTotal} calc={`${bd} × $${costs.trashBag.toFixed(2)}`} />
            {ht > 0 && <LineItem label="Hot tub chems" value={hotTubTotal} calc={`$${costs.hotTub.toFixed(2)}`} />}
            <div className="border-t border-border pt-1 mt-1">
              <LineItem label="Computed total" value={total} />
            </div>
            {isOverride && (
              <div className="pt-1 mt-1 border-t border-border">
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  Stored value differs (${Number(override).toFixed(2)}) - likely a manual override.
                </p>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
