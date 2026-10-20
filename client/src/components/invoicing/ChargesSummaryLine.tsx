// One compact row on the Invoice runs view that stands in for the full
// Open credits and Linen charges panels (those live on the "Credits & linen"
// view). It reuses the panels' React Query keys, so no extra fetches. Each
// segment hides at zero; the whole line hides when nothing is pending or the
// tables are not set up yet (the hooks then report zeros).

import { StatusBadge } from '@/components/StatusBadge'
import { ArrowRight } from 'lucide-react'
import { useOpenCreditsSummary } from './OpenCreditsPanel'
import { useLinenChargesSummary } from './LinenChargesPanel'

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

export function ChargesSummaryLine({ onOpen }: { onOpen: () => void }) {
  const credits = useOpenCreditsSummary()
  const linen = useLinenChargesSummary()

  if (credits.count === 0 && linen.waitingCount === 0 && linen.undecidedCount === 0) return null

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-card-border bg-card px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/40 transition-colors"
      data-testid="charges-summary-line"
    >
      {credits.count > 0 && (
        <span data-testid="summary-credits">
          <span className="font-medium text-foreground tabular-nums">{credits.count}</span>{' '}
          open {plural(credits.count, 'credit', 'credits')}{' '}
          <span className="tabular-nums">({fmtMoney(Math.abs(credits.total))})</span>
        </span>
      )}
      {credits.count > 0 && (linen.waitingCount > 0 || linen.undecidedCount > 0) && <span aria-hidden>·</span>}
      {linen.waitingCount > 0 && (
        <span data-testid="summary-linen-waiting">
          <span className="font-medium text-foreground tabular-nums">{linen.waitingCount}</span>{' '}
          linen {plural(linen.waitingCount, 'fee', 'fees')} waiting to bill{' '}
          <span className="tabular-nums">({fmtMoney(linen.waitingTotal)})</span>
        </span>
      )}
      {linen.waitingCount > 0 && linen.undecidedCount > 0 && <span aria-hidden>·</span>}
      {linen.undecidedCount > 0 && (
        <StatusBadge tone="warning" className="py-0">
          <span data-testid="summary-linen-undecided">
            {linen.undecidedCount} linen {plural(linen.undecidedCount, 'property', 'properties')} with no fee decision
          </span>
        </StatusBadge>
      )}
      <span className="ml-auto inline-flex items-center gap-1 text-primary">
        Credits &amp; linen <ArrowRight className="w-3 h-3" />
      </span>
    </button>
  )
}
