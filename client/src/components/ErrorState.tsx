import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/lib/i18n/LocaleProvider'

/**
 * Standard inline error state for failed queries. Pair with React Query:
 *
 *   if (error) return <ErrorState onRetry={() => refetch()} />
 *
 * Default copy is locale-aware (common.errorState.*); explicit props win.
 */
export function ErrorState({
  title,
  description,
  onRetry,
}: {
  title?: string
  description?: string
  onRetry?: () => void
}) {
  const { t } = useLocale()
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center" role="alert">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <AlertTriangle className="w-8 h-8 text-destructive" />
      </div>
      <h3 className="text-sm font-medium text-foreground mb-1">{title ?? t('common.errorState.title')}</h3>
      <p className="text-xs text-muted-foreground max-w-xs">{description ?? t('common.errorState.description')}</p>
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-4" onClick={onRetry}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          {t('common.errorState.retry')}
        </Button>
      )}
    </div>
  )
}
