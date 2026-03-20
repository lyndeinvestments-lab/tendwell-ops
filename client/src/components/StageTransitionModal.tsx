import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

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
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Missing Fields
          </DialogTitle>
          <DialogDescription className="text-sm">
            Moving <strong>{propertyName}</strong> to <strong>{targetStage}</strong>
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <p className="text-sm text-muted-foreground mb-3">
            The following fields are recommended for this stage but are not yet filled in:
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
            You can still move this property — fill in the missing fields later.
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={isPending} data-testid="button-confirm-transition">
            {isPending ? 'Moving…' : 'Move Anyway'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
