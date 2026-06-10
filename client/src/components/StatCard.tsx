import { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { StatusTone, TONE_TEXT } from '@/lib/status-colors'

/**
 * Unified KPI / stat card. Replaces the three divergent KpiCard/StatCard
 * implementations (dashboard, financial-dashboard, laundry-weigh-ins).
 */
export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  loading,
  tone = 'primary',
  onClick,
  className,
  testId,
}: {
  title: string
  value: ReactNode
  subtitle?: ReactNode
  icon?: React.ComponentType<{ className?: string }>
  loading?: boolean
  /** Accent tone for the icon chip — use 'destructive' for alert states. */
  tone?: StatusTone
  onClick?: () => void
  className?: string
  testId?: string
}) {
  return (
    <Card
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'border-card-border shadow-xs',
        tone === 'destructive' && 'border-destructive/40',
        onClick && 'cursor-pointer hover-elevate transition-shadow hover:shadow-sm',
        className,
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs text-muted-foreground font-medium uppercase tracking-wide truncate">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-16 mt-1.5" />
            ) : (
              <p className="text-2xl font-semibold tabular-nums mt-0.5 tracking-tight">{value}</p>
            )}
            {subtitle && !loading && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
            )}
          </div>
          {Icon && (
            <div
              className={cn(
                'w-9 h-9 shrink-0 rounded-lg flex items-center justify-center',
                tone === 'destructive' ? 'bg-destructive/10' : tone === 'warning' ? 'bg-warning/10' : tone === 'success' ? 'bg-success/10' : tone === 'info' ? 'bg-info/10' : 'bg-primary/10',
              )}
            >
              <Icon className={cn('w-4 h-4', TONE_TEXT[tone])} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
