import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'

declare global {
  interface Window {
    google?: any
    __tendwellGoogleMapsLoading?: Promise<void>
  }
}

const PLACES_API_KEY: string | undefined =
  // Either env var name is supported so projects don't have to rename what
  // they already have. Both are public Maps JS API keys (HTTP referrer-locked
  // in the GCP console — never a secret).
  (import.meta.env as any).VITE_GOOGLE_MAPS_API_KEY ||
  (import.meta.env as any).VITE_GOOGLE_PLACES_API_KEY

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.google?.maps?.places) return Promise.resolve()
  if (window.__tendwellGoogleMapsLoading) return window.__tendwellGoogleMapsLoading
  window.__tendwellGoogleMapsLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-tendwell-google-maps]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Google Maps script failed to load')))
      return
    }
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=weekly`
    script.async = true
    script.defer = true
    script.dataset.tendwellGoogleMaps = '1'
    script.addEventListener('load', () => resolve())
    script.addEventListener('error', () => reject(new Error('Google Maps script failed to load')))
    document.head.appendChild(script)
  })
  return window.__tendwellGoogleMapsLoading
}

export interface AddressAutocompleteResult {
  formattedAddress: string
  name?: string
  lat?: number
  lng?: number
  placeId?: string
}

export interface AddressAutocompleteProps {
  id?: string
  value: string
  onChange: (next: string) => void
  /**
   * Called when the user selects a Google Places suggestion. Receives the
   * formatted address plus the resolved place metadata. Always also fires
   * onChange with the formatted address so callers don't need both handlers.
   */
  onSelectPlace?: (place: AddressAutocompleteResult) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  testId?: string
  /** Restrict suggestions to a country (ISO 3166-1 alpha-2). Defaults to US. */
  country?: string
}

/**
 * Address input with Google Places Autocomplete when the public Maps JS key
 * is configured. Falls back to a normal text input otherwise — never blocks
 * data entry. Public env vars supported: VITE_GOOGLE_MAPS_API_KEY,
 * VITE_GOOGLE_PLACES_API_KEY.
 */
export function AddressAutocomplete({
  id,
  value,
  onChange,
  onSelectPlace,
  placeholder = 'Start typing an address…',
  className,
  disabled,
  testId,
  country = 'us',
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!PLACES_API_KEY) {
      setEnabled(false)
      return
    }
    let cancelled = false
    loadGoogleMapsScript(PLACES_API_KEY)
      .then(() => {
        if (cancelled || !inputRef.current || !window.google?.maps?.places) return
        const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
          fields: ['geometry', 'name', 'formatted_address', 'place_id'],
          types: ['address'],
          componentRestrictions: country ? { country } : undefined,
        })
        autocompleteRef.current = ac
        ac.addListener('place_changed', () => {
          const place = ac.getPlace()
          if (!place) return
          const formatted: string = place.formatted_address || place.name || ''
          if (formatted) onChange(formatted)
          if (onSelectPlace) {
            onSelectPlace({
              formattedAddress: formatted,
              name: place.name,
              lat: place.geometry?.location?.lat?.(),
              lng: place.geometry?.location?.lng?.(),
              placeId: place.place_id,
            })
          }
        })
        setEnabled(true)
      })
      .catch((e) => {
        setError(e?.message || 'Failed to load Google Places')
        setEnabled(false)
      })
    return () => {
      cancelled = true
      // No public unbind on the Autocomplete widget — leaving the listener
      // attached is fine; the input is cleaned up when the component unmounts.
    }
  }, [country, onChange, onSelectPlace])

  return (
    <div className="space-y-1">
      <Input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        data-testid={testId}
        autoComplete="off"
      />
      {!PLACES_API_KEY && (
        <p className="text-[10px] text-muted-foreground">
          Set <code className="px-1 rounded bg-muted">VITE_GOOGLE_MAPS_API_KEY</code> to enable address autocomplete.
        </p>
      )}
      {PLACES_API_KEY && error && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400">{error} — using plain text.</p>
      )}
      {PLACES_API_KEY && !error && !enabled && (
        <p className="text-[10px] text-muted-foreground">Loading address suggestions…</p>
      )}
    </div>
  )
}
