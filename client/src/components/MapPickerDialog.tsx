import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MapPin } from 'lucide-react'

interface MapPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  address: string
}

export function MapPickerDialog({ open, onOpenChange, address }: MapPickerDialogProps) {
  function openMap(provider: 'google' | 'apple') {
    const encoded = encodeURIComponent(address)
    const url =
      provider === 'google'
        ? `https://www.google.com/maps/search/?api=1&query=${encoded}`
        : `https://maps.apple.com/?q=${encoded}`
    window.open(url, '_blank', 'noopener,noreferrer')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <MapPin className="w-4 h-4 shrink-0" />
            Get Directions
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">{address}</p>
        <div className="flex flex-col gap-2">
          <Button className="w-full" onClick={() => openMap('google')}>
            Open in Google Maps
          </Button>
          <Button variant="outline" className="w-full" onClick={() => openMap('apple')}>
            Open in Apple Maps
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
