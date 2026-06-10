import { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { StatusTone, TONE_SOFT, TONE_SOLID, toneForStatus } from '@/lib/status-colors'

/**
 * Unified status badge. Replaces per-page hardcoded
 * `text-red-700 bg-red-50 border-red-200 dark:...` chips.
 *
 *   <StatusBadge tone="warning">Pending</StatusBadge>
 *   <StatusBadge status={issue.status} />   // auto-derives tone from the label
 */
export function StatusBadge({
  tone,
  status,
  variant = 'soft',
  className,
  children,
}: {
  tone?: StatusTone
  /** Status label — used for auto-tone and as fallback content. */
  status?: string | null
  variant?: 'soft' | 'solid'
  className?: string
  children?: ReactNode
}) {
  const resolved: StatusTone = tone ?? toneForStatus(status)
  const styles = variant === 'solid' ? TONE_SOLID[resolved] : TONE_SOFT[resolved]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium whitespace-nowrap',
        styles,
        className,
      )}
    >
      {children ?? status}
    </span>
  )
}
