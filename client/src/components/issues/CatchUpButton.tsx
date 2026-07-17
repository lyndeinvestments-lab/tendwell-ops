import { useMemo } from 'react'
import { Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { catchUpQueue, isOverdue, type Issue } from '@/lib/issues'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { cn } from '@/lib/utils'

/**
 * PageHeader action that opens the Slack-style Catch-up flow. Count badge
 * reflects the same queue `CatchUpFlow` freezes on open (`catchUpQueue()`),
 * computed from the already-fetched issues array — no extra query.
 */
export function CatchUpButton({ issues, onClick }: { issues: Issue[]; onClick: () => void }) {
  const { t } = useLocale()
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
              <Inbox className="w-3.5 h-3.5" /> {t('catchUp.button')}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t('catchUp.allCaughtUp')}</TooltipContent>
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
      <Inbox className="w-3.5 h-3.5" /> {t('catchUp.button')}
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
