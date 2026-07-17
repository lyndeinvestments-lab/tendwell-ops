import { useMemo } from 'react'
import { Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { catchUpQueue, isOverdue, type Issue } from '@/lib/issues'
import { cn } from '@/lib/utils'

/**
 * PageHeader action that opens the Slack-style Catch-up flow. Count badge
 * reflects the same queue `CatchUpFlow` freezes on open (`catchUpQueue()`),
 * computed from the already-fetched issues array — no extra query.
 */
export function CatchUpButton({ issues, onClick }: { issues: Issue[]; onClick: () => void }) {
  const queue = useMemo(() => catchUpQueue(issues), [issues])
  const count = queue.length
  const hasOverdue = useMemo(() => queue.some(isOverdue), [queue])

  if (count === 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Span wrapper: a `disabled` button doesn't reliably fire hover
              events for the tooltip trigger to attach to. */}
          <span className="inline-flex">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" disabled>
              <Inbox className="w-3.5 h-3.5" /> Catch up
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>You're all caught up</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Button
      variant={hasOverdue ? 'destructive' : 'default'}
      size="sm"
      className="h-8 text-xs gap-1.5"
      onClick={onClick}
    >
      <Inbox className="w-3.5 h-3.5" /> Catch up
      <span
        className={cn(
          'text-2xs font-semibold px-1.5 py-0.5 rounded-full tabular-nums',
          hasOverdue ? 'bg-destructive-foreground/20' : 'bg-primary-foreground/20',
        )}
      >
        {count}
      </span>
    </Button>
  )
}
