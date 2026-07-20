import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'

export type GoogleMapsRuntimeStatus =
  | 'no_key'
  | 'loading'
  | 'ready'
  | 'script_error'
  | 'places_missing'
  | 'timeout'
  | 'gm_authFailure'

declare global {
  interface Window {
    google?: any
    __tendwellGoogleMapsLoading?: Promise<void>
    __tendwellGoogleMapsStatus?: GoogleMapsRuntimeStatus
    gm_authFailure?: () => void
  }
}

const PLACES_API_KEY: string | undefined =
  // Either env var name is supported so projects don't have to rename what
  // they already have. Both are public Maps JS API keys (HTTP referrer-locked
  // in the GCP console — never a secret).
  (import.meta.env as any).VITE_GOOGLE_MAPS_API_KEY ||
  (import.meta.env as any).VITE_GOOGLE_PLACES_API_KEY

const SCRIPT_LOAD_TIMEOUT_MS = 10_000

function setStatus(s: GoogleMapsRuntimeStatus) {
  if (typeof window !== 'undefined') window.__tendwellGoogleMapsStatus = s
}

/** Read the current Google Maps load status from the shared global. */
export function getGoogleMapsRuntimeStatus(): GoogleMapsRuntimeStatus {
  if (typeof window === 'undefined') return 'no_key'
  if (!PLACES_API_KEY) return 'no_key'
  return window.__tendwellGoogleMapsStatus || 'loading'
}

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.google?.maps?.places) {
    setStatus('ready')
    return Promise.resolve()
  }
  if (window.__tendwellGoogleMapsLoading) return window.__tendwellGoogleMapsLoading
  setStatus('loading')
  // Google calls this if the API key is rejected (referrer/billing/Maps JS API
  // disabled). Surface a distinct status so we can show better diagnostics.
  window.gm_authFailure = () => setStatus('gm_authFailure')
  window.__tendwellGoogleMapsLoading = new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (fn: () => void, status: GoogleMapsRuntimeStatus) => {
      if (settled) return
      settled = true
      setStatus(status)
      fn()
    }
    const timeoutId = window.setTimeout(() => {
      settle(() => reject(new Error('Google Maps script load timed out - check Maps JavaScript API enablement, HTTP referrer restrictions, or billing.')), 'timeout')
    }, SCRIPT_LOAD_TIMEOUT_MS)
    const onLoad = () => {
      window.clearTimeout(timeoutId)
      if (!window.google?.maps?.places) {
        settle(() => reject(new Error('Google Maps loaded but Places library is missing - verify the script URL includes libraries=places.')), 'places_missing')
        return
      }
      settle(() => resolve(), 'ready')
    }
    const onError = () => {
      window.clearTimeout(timeoutId)
      settle(() => reject(new Error('Google Maps script failed to load - verify Maps JavaScript API is enabled, HTTP referrer allowlist includes this domain, billing is active, and CSP allows maps.googleapis.com.')), 'script_error')
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-tendwell-google-maps]')
    if (existing) {
      existing.addEventListener('load', onLoad)
      existing.addEventListener('error', onError)
      return
    }
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=weekly`
    script.async = true
    script.defer = true
    script.dataset.tendwellGoogleMaps = '1'
    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
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
  autoFocus?: boolean
  /**
   * Forwarded to the input for inline-edit commit flows. Caution: blur fires
   * before place_changed when a suggestion is clicked, so callers committing
   * on blur should delay ~250ms and let onSelectPlace cancel the commit.
   */
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
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
  autoFocus,
  onBlur,
  onKeyDown,
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Callers commonly pass inline arrow functions as onChange/onSelectPlace
  // (e.g. `onChange={next => setNewProp(prev => ({...prev, address: next}))}`).
  // Including those in the effect's deps caused the effect to re-run every
  // parent render — which spawned duplicate Google Autocomplete widgets on
  // the same input and left the listener firing on a stale closure, so
  // clicking a suggestion appeared to do nothing on the Quote Sheet's Add
  // Quote form. We stash the latest callbacks in refs and depend only on
  // `country`, so the widget is created exactly once per mount.
  const onChangeRef = useRef(onChange)
  const onSelectPlaceRef = useRef(onSelectPlace)
  useEffect(() => { onChangeRef.current = onChange })
  useEffect(() => { onSelectPlaceRef.current = onSelectPlace })

  useEffect(() => {
    if (!PLACES_API_KEY) {
      setEnabled(false)
      return
    }
    let cancelled = false
    let authPoll: number | undefined
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
          if (formatted) onChangeRef.current(formatted)
          if (onSelectPlaceRef.current) {
            onSelectPlaceRef.current({
              formattedAddress: formatted,
              name: place.name,
              lat: place.geometry?.location?.lat?.(),
              lng: place.geometry?.location?.lng?.(),
              placeId: place.place_id,
            })
          }
        })
        setEnabled(true)
        // gm_authFailure may fire after load if the key is rejected at runtime
        // (e.g. referrer mismatch). Watch the shared status and reflect it.
        authPoll = window.setInterval(() => {
          if (window.__tendwellGoogleMapsStatus === 'gm_authFailure') {
            // Almost always RefererNotAllowedMapError: the key's HTTP referrer
            // allowlist is missing the domain the app is being served from.
            setError(`Google rejected the Maps API key for ${window.location.origin} - add ${window.location.origin}/* to the key's HTTP referrer allowlist in the GCP console (then verify Maps JavaScript API enablement and billing)`)
            setEnabled(false)
            if (authPoll) window.clearInterval(authPoll)
          }
        }, 1000)
      })
      .catch((e) => {
        setError(e?.message || 'Failed to load Google Places')
        setEnabled(false)
      })
    return () => {
      cancelled = true
      if (authPoll) window.clearInterval(authPoll)
      // No public unbind on the Autocomplete widget — leaving the listener
      // attached is fine; the input is cleaned up when the component unmounts.
    }
  }, [country])

  return (
    <div className="space-y-1">
      <Input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        data-testid={testId}
        autoFocus={autoFocus}
        autoComplete="off"
      />
      {!PLACES_API_KEY && (
        <p className="text-[10px] text-muted-foreground">
          Set <code className="px-1 rounded bg-muted">VITE_GOOGLE_MAPS_API_KEY</code> to enable address autocomplete.
        </p>
      )}
      {PLACES_API_KEY && error && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400">{error} - using plain text.</p>
      )}
      {PLACES_API_KEY && !error && !enabled && (
        <p className="text-[10px] text-muted-foreground">Loading address suggestions…</p>
      )}
    </div>
  )
}
