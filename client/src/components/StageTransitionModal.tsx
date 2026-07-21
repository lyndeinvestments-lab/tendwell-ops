import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { slugify } from '@/lib/issues'

interface StageTransitionModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  propertyName: string
  targetStage: string
  missingFields: string[]
  isPending: boolean
}

export function StageTransitionModal({
  open, onClose, onConfirm, propertyName, targetStage, missingFields, isPending
}: StageTransitionModalProps) {
  const { t } = useLocale('propertyModal')
  // `targetStage` is the canonical English pipeline_stages.name — display-only
  // slug lookup against common.stage, falls back to the raw value.
  const targetStageLabel = t(`common.stage.${slugify(targetStage)}`, undefined, targetStage)
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            {t('stageTransition.title')}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {t('stageTransition.movingPrefix')} <strong>{propertyName}</strong> {t('stageTransition.movingTo')} <strong>{targetStageLabel}</strong>
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <p className="text-sm text-muted-foreground mb-3">
            {t('stageTransition.intro')}
          </p>
          <ul className="space-y-1">
            {missingFields.map(f => (
              <li key={f} className="flex items-center gap-2 text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                <span className="text-foreground">{f.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground mt-3">
            {t('stageTransition.footerNote')}
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>
            {t('common.actions.cancel')}
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={isPending} data-testid="button-confirm-transition">
            {isPending ? t('stageTransition.moving') : t('stageTransition.moveAnyway')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
