import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Standard page wrapper — consistent padding, max-width and vertical rhythm
 * for every full-page view. Replaces ad-hoc `p-4 sm:p-6` / `max-w-*` per page.
 *
 *   <PageContainer>            // default: full-width tables/dashboards
 *   <PageContainer width="md"> // narrow forms/settings
 */
const WIDTHS = {
  full: 'max-w-none',
  xl: 'max-w-7xl mx-auto',
  lg: 'max-w-5xl mx-auto',
  md: 'max-w-3xl mx-auto',
  sm: 'max-w-2xl mx-auto',
} as const

export function PageContainer({
  children,
  width = 'full',
  className,
}: {
  children: ReactNode
  width?: keyof typeof WIDTHS
  className?: string
}) {
  return (
    <div className={cn('p-5 sm:p-7 space-y-5 w-full', WIDTHS[width], className)}>
      {children}
    </div>
  )
}
