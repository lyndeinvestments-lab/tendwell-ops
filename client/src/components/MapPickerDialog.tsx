import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Check, Copy, MapPin } from 'lucide-react'

interface MapPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  address: string
}

export function MapPickerDialog({ open, onOpenChange, address }: MapPickerDialogProps) {
  const [copied, setCopied] = useState(false)

  function handleOpenChange(next: boolean) {
    if (!next) setCopied(false)
    onOpenChange(next)
  }

  function openMap(provider: 'google' | 'apple') {
    const encoded = encodeURIComponent(address)
    const url =
      provider === 'google'
        ? `https://www.google.com/maps/search/?api=1&query=${encoded}`
        : `https://maps.apple.com/?q=${encoded}`
    window.open(url, '_blank', 'noopener,noreferrer')
    onOpenChange(false)
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API unavailable (non-secure context) — leave the dialog open
      // so the user can select the address text above manually.
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <MapPin className="w-4 h-4 shrink-0" />
            Get Directions
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1 select-all">{address}</p>
        <div className="flex flex-col gap-2">
          <Button className="w-full" onClick={() => openMap('google')}>
            Open in Google Maps
          </Button>
          <Button variant="outline" className="w-full" onClick={() => openMap('apple')}>
            Open in Apple Maps
          </Button>
          <Button variant="outline" className="w-full" onClick={copyAddress}>
            {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
            {copied ? 'Copied' : 'Copy address'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
