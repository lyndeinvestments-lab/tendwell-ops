import { useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Check, Building2, Upload, X } from 'lucide-react'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const publicSupabase = createClient(supabaseUrl, supabaseAnonKey)

type YesNo = '' | 'yes' | 'no'
type IntegrationKind = '' | 'ical' | 'api_key' | 'none'

interface UploadedPhoto { url: string; path: string; name: string }

export default function OnboardingIntakePage() {
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [clientName, setClientName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [invoiceSameAsPrimary, setInvoiceSameAsPrimary] = useState(true)
  const [invoiceEmail, setInvoiceEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [propertyName, setPropertyName] = useState('')
  const [address, setAddress] = useState('')

  const [bedrooms, setBedrooms] = useState('')
  const [numberOfBeds, setNumberOfBeds] = useState('')
  const [fullBaths, setFullBaths] = useState('')
  const [halfBaths, setHalfBaths] = useState('')
  const [squareFootage, setSquareFootage] = useState('')
  const [bedSizes, setBedSizes] = useState('')

  const [hotTub, setHotTub] = useState<YesNo>('')
  const [pool, setPool] = useState<YesNo>('')
  const [linenProgram, setLinenProgram] = useState<YesNo>('')
  const [deepClean, setDeepClean] = useState<YesNo>('')

  const [doorCode, setDoorCode] = useState('')
  const [poolCode, setPoolCode] = useState('')
  const [closetCode, setClosetCode] = useState('')
  const [lockboxCode, setLockboxCode] = useState('')
  const [otherCodes, setOtherCodes] = useState('')

  const [wifiNetwork, setWifiNetwork] = useState('')
  const [wifiPassword, setWifiPassword] = useState('')

  const [filterSize, setFilterSize] = useState('')
  const [checkInTime, setCheckInTime] = useState('')
  const [checkOutTime, setCheckOutTime] = useState('')

  const [integrationKind, setIntegrationKind] = useState<IntegrationKind>('')
  const [icalUrl, setIcalUrl] = useState('')
  const [apiClientId, setApiClientId] = useState('')
  const [apiKey, setApiKey] = useState('')

  const [notes, setNotes] = useState('')

  const [photos, setPhotos] = useState<UploadedPhoto[]>([])
  const [photoUploading, setPhotoUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function uploadFile(file: File): Promise<UploadedPhoto | null> {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'jpg'
    const today = new Date().toISOString().slice(0, 10)
    const rand = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const path = `${today}/${rand}.${safeExt}`
    const { error: uploadErr } = await publicSupabase
      .storage
      .from('onboarding-uploads')
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (uploadErr) return null
    const { data: urlData } = publicSupabase.storage.from('onboarding-uploads').getPublicUrl(path)
    return { url: urlData.publicUrl, path, name: file.name }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setPhotoUploading(true)
    setError('')
    const next: UploadedPhoto[] = []
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) {
        setError(`${file.name} is over 20 MB — please resize and try again.`)
        continue
      }
      const result = await uploadFile(file)
      if (result) next.push(result)
      else setError(`Failed to upload ${file.name}.`)
    }
    setPhotos(prev => [...prev, ...next])
    setPhotoUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function removePhoto(idx: number) {
    const photo = photos[idx]
    if (!photo) return
    setPhotos(prev => prev.filter((_, i) => i !== idx))
    await publicSupabase.storage.from('onboarding-uploads').remove([photo.path]).catch(() => {})
  }

  async function handleSubmit() {
    setError('')
    if (!clientName.trim()) { setError('Please enter your name.'); return }
    if (!address.trim()) { setError('Please enter the property address.'); return }
    if (!bedSizes.trim()) { setError('Bed sizes are required.'); return }

    setSaving(true)
    const wifiCombined = [wifiNetwork.trim() && `Network: ${wifiNetwork.trim()}`, wifiPassword.trim() && `Password: ${wifiPassword.trim()}`].filter(Boolean).join(' / ') || null
    const otherCodesCombined = [
      poolCode.trim() && `Pool: ${poolCode.trim()}`,
      closetCode.trim() && `Cleaner closet: ${closetCode.trim()}`,
      lockboxCode.trim() && `Lockbox: ${lockboxCode.trim()}`,
      otherCodes.trim(),
    ].filter(Boolean).join(' | ') || null

    const { error: insertErr } = await publicSupabase
      .from('onboarding_submissions')
      .insert({
        source: 'public',
        token: null,
        status: 'pending',
        client_name: clientName.trim(),
        contact_email: contactEmail.trim() || null,
        invoice_email: (invoiceSameAsPrimary ? contactEmail.trim() : invoiceEmail.trim()) || null,
        contact_phone: contactPhone.trim() || null,
        property_name: propertyName.trim() || null,
        address: address.trim(),
        bedrooms: bedrooms ? parseInt(bedrooms) : null,
        number_of_beds: numberOfBeds ? parseInt(numberOfBeds) : null,
        full_baths: fullBaths ? parseInt(fullBaths) : null,
        half_baths: halfBaths ? parseInt(halfBaths) : null,
        square_footage: squareFootage ? parseFloat(squareFootage) : null,
        bed_sizes: bedSizes.trim(),
        hot_tub: hotTub === 'yes' ? true : hotTub === 'no' ? false : null,
        pool: pool === 'yes' ? true : pool === 'no' ? false : null,
        linen_program: linenProgram === 'yes' ? true : linenProgram === 'no' ? false : null,
        onboarding_deep_clean: deepClean === 'yes' ? true : deepClean === 'no' ? false : null,
        door_code: doorCode.trim() || null,
        other_codes: otherCodesCombined,
        wifi_info: wifiCombined,
        filter_size: filterSize.trim() || null,
        check_in_time: checkInTime.trim() || null,
        check_out_time: checkOutTime.trim() || null,
        ical_url: integrationKind === 'ical' ? icalUrl.trim() || null : null,
        api_client_id: integrationKind === 'api_key' ? apiClientId.trim() || null : null,
        api_key: integrationKind === 'api_key' ? apiKey.trim() || null : null,
        notes: notes.trim() || null,
        photos: photos.map(p => p.path),
        submitted_at: new Date().toISOString(),
      })

    setSaving(false)
    if (insertErr) {
      setError('Something went wrong. Please try again or email us directly.')
      return
    }
    setSubmitted(true)
    try {
      await fetch('/api/notify/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'onboarding_intake_submitted', address: address.trim(), client_name: clientName.trim() }),
      })
    } catch { /* ignore */ }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center mx-auto">
              <Check className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-lg font-semibold">Submitted</h2>
            <p className="text-sm text-muted-foreground">
              Thank you! We've received your property information. Our team will review it and follow up shortly.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const inputCls = 'h-10 text-sm'
  const labelCls = 'text-xs font-medium text-muted-foreground block mb-1'

  function ToggleYesNo({ value, onChange, dataTestId }: { value: YesNo; onChange: (v: YesNo) => void; dataTestId: string }) {
    return (
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange('no')}
          data-testid={`${dataTestId}-no`}
          className={`flex-1 h-10 rounded-md border text-sm transition-colors ${value === 'no' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted/50'}`}
        >No</button>
        <button
          type="button"
          onClick={() => onChange('yes')}
          data-testid={`${dataTestId}-yes`}
          className={`flex-1 h-10 rounded-md border text-sm transition-colors ${value === 'yes' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted/50'}`}
        >Yes</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mx-auto">
            <Building2 className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-xl font-semibold">Property Onboarding</h1>
          <p className="text-sm text-muted-foreground">
            Fill in your property details so we can set up service. Required fields marked with *.
          </p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-sm">Contact & Property</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Your Name *</label>
                <Input value={clientName} onChange={e => setClientName(e.target.value)} className={inputCls} data-testid="input-client-name" />
              </div>
              <div>
                <label className={labelCls}>Property Name</label>
                <Input value={propertyName} onChange={e => setPropertyName(e.target.value)} className={inputCls} placeholder="Mountain View Cabin" data-testid="input-property-name" />
              </div>
              <div>
                <label className={labelCls}>Email</label>
                <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} className={inputCls} data-testid="input-contact-email" />
              </div>
              <div>
                <label className={labelCls}>Phone</label>
                <Input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} className={inputCls} data-testid="input-contact-phone" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={`${labelCls} !mb-0`}>Invoice Email</label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={invoiceSameAsPrimary}
                    onChange={e => setInvoiceSameAsPrimary(e.target.checked)}
                    className="h-3.5 w-3.5"
                    data-testid="checkbox-invoice-same-as-primary"
                  />
                  Same as primary email
                </label>
              </div>
              <Input
                type="email"
                value={invoiceSameAsPrimary ? contactEmail : invoiceEmail}
                onChange={e => setInvoiceEmail(e.target.value)}
                disabled={invoiceSameAsPrimary}
                placeholder={invoiceSameAsPrimary ? '' : 'invoices@example.com'}
                className={`${inputCls} ${invoiceSameAsPrimary ? 'opacity-60' : ''}`}
                data-testid="input-invoice-email"
              />
              <p className="text-xs text-muted-foreground mt-1">Where we should send invoices. Defaults to your primary email.</p>
            </div>
            <div>
              <label className={labelCls}>Property Address *</label>
              <AddressAutocomplete value={address} onChange={setAddress} className={inputCls} placeholder="123 Cabin Road, Gatlinburg, TN 37738" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Property Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div><label className={labelCls}>Bedrooms</label><Input type="number" min="0" value={bedrooms} onChange={e => setBedrooms(e.target.value)} className={inputCls} data-testid="input-bedrooms" /></div>
              <div><label className={labelCls}>Number of Beds</label><Input type="number" min="0" value={numberOfBeds} onChange={e => setNumberOfBeds(e.target.value)} className={inputCls} data-testid="input-number-of-beds" /></div>
              <div><label className={labelCls}>Square Footage</label><Input type="number" min="0" value={squareFootage} onChange={e => setSquareFootage(e.target.value)} className={inputCls} data-testid="input-square-footage" /></div>
              <div><label className={labelCls}>Full Baths</label><Input type="number" min="0" value={fullBaths} onChange={e => setFullBaths(e.target.value)} className={inputCls} data-testid="input-full-baths" /></div>
              <div><label className={labelCls}>Half Baths</label><Input type="number" min="0" value={halfBaths} onChange={e => setHalfBaths(e.target.value)} className={inputCls} data-testid="input-half-baths" /></div>
            </div>
            <div>
              <label className={labelCls}>Bed Sizes *</label>
              <textarea
                value={bedSizes}
                onChange={e => setBedSizes(e.target.value)}
                placeholder="e.g. Master: King · Bedroom 2: Queen · Bedroom 3: 2 Twins · Loft: Queen sleeper sofa"
                className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid="input-bed-sizes"
              />
              <p className="text-xs text-muted-foreground mt-1">List the bed size for each room so we can stock the right linens.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className={labelCls}>Hot Tub</label>
                <ToggleYesNo value={hotTub} onChange={setHotTub} dataTestId="toggle-hot-tub" />
              </div>
              <div>
                <label className={labelCls}>Pool</label>
                <ToggleYesNo value={pool} onChange={setPool} dataTestId="toggle-pool" />
              </div>
              <div>
                <label className={labelCls}>Linen Program</label>
                <ToggleYesNo value={linenProgram} onChange={setLinenProgram} dataTestId="toggle-linen-program" />
              </div>
              <div>
                <label className={labelCls}>Onboarding Deep Clean</label>
                <ToggleYesNo value={deepClean} onChange={setDeepClean} dataTestId="toggle-onboarding-deep-clean" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Access Codes</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Front Door Code</label>
                <Input value={doorCode} onChange={e => setDoorCode(e.target.value)} className={inputCls} data-testid="input-door-code" />
              </div>
              <div>
                <label className={labelCls}>Pool Code</label>
                <Input value={poolCode} onChange={e => setPoolCode(e.target.value)} className={inputCls} data-testid="input-pool-code" />
              </div>
              <div>
                <label className={labelCls}>Cleaner Closet Code</label>
                <Input value={closetCode} onChange={e => setClosetCode(e.target.value)} className={inputCls} data-testid="input-closet-code" />
              </div>
              <div>
                <label className={labelCls}>Lockbox Code</label>
                <Input value={lockboxCode} onChange={e => setLockboxCode(e.target.value)} className={inputCls} data-testid="input-lockbox-code" />
              </div>
              <div>
                <label className={labelCls}>Other Codes</label>
                <Input value={otherCodes} onChange={e => setOtherCodes(e.target.value)} className={inputCls} placeholder="Anything else" data-testid="input-other-codes" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Wi-Fi</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Network Name</label>
                <Input value={wifiNetwork} onChange={e => setWifiNetwork(e.target.value)} className={inputCls} data-testid="input-wifi-network" />
              </div>
              <div>
                <label className={labelCls}>Password</label>
                <Input value={wifiPassword} onChange={e => setWifiPassword(e.target.value)} className={inputCls} data-testid="input-wifi-password" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Check-in & Check-out Times</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Check-in Time</label>
                <Input value={checkInTime} onChange={e => setCheckInTime(e.target.value)} className={inputCls} placeholder="e.g. 4:00 PM" data-testid="input-check-in-time" />
              </div>
              <div>
                <label className={labelCls}>Check-out Time</label>
                <Input value={checkOutTime} onChange={e => setCheckOutTime(e.target.value)} className={inputCls} placeholder="e.g. 10:00 AM" data-testid="input-check-out-time" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">A/C Filter (optional)</CardTitle></CardHeader>
          <CardContent>
            <label className={labelCls}>Filter Size</label>
            <Input value={filterSize} onChange={e => setFilterSize(e.target.value)} className={inputCls} placeholder='e.g. 20x25x1 (or list multiple sizes if different per unit)' data-testid="input-filter-size" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Booking Calendar</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">Share your booking calendar so we can schedule cleans automatically. Pick one option.</p>
            <div className="flex gap-2 flex-wrap">
              {([
                { key: 'ical', label: 'iCal link' },
                { key: 'api_key', label: 'API key' },
                { key: 'none', label: 'None / send later' },
              ] as { key: IntegrationKind; label: string }[]).map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setIntegrationKind(opt.key)}
                  className={`flex-1 min-w-[100px] h-10 rounded-md border text-sm transition-colors ${integrationKind === opt.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted/50'}`}
                  data-testid={`toggle-integration-${opt.key}`}
                >{opt.label}</button>
              ))}
            </div>
            {integrationKind === 'ical' && (
              <div>
                <label className={labelCls}>iCal URL</label>
                <Input value={icalUrl} onChange={e => setIcalUrl(e.target.value)} className={inputCls} placeholder="https://..." data-testid="input-ical-url" />
              </div>
            )}
            {integrationKind === 'api_key' && (
              <div className="space-y-4">
                <div>
                  <label className={labelCls}>Client ID / public key (optional)</label>
                  <Input value={apiClientId} onChange={e => setApiClientId(e.target.value)} className={inputCls} data-testid="input-api-client-id" />
                  <p className="text-xs text-muted-foreground mt-1">For services that provide a client ID or public key, paste it here.</p>
                </div>
                <div>
                  <label className={labelCls}>API secret / client secret / token</label>
                  <Input value={apiKey} onChange={e => setApiKey(e.target.value)} className={inputCls} type="password" data-testid="input-api-key" />
                  <p className="text-xs text-muted-foreground mt-1">Paste your API secret, client secret, or access token from the provider. Only admins can view this.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Photos & Special Instructions</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className={labelCls}>Photos</label>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,application/pdf"
                onChange={e => handleFiles(e.target.files)}
                className="hidden"
                data-testid="input-photos"
              />
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={photoUploading} className="w-full">
                <Upload className="w-4 h-4 mr-2" />
                {photoUploading ? 'Uploading…' : 'Choose Files'}
              </Button>
              {photos.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {photos.map((p, i) => (
                    <li key={p.path} className="flex items-center gap-3 text-xs bg-muted/40 rounded-md px-2 py-1.5">
                      <span className="flex-1 truncate">{p.name}</span>
                      <button type="button" onClick={() => removePhoto(i)} className="text-muted-foreground hover:text-destructive" data-testid={`button-remove-photo-${i}`}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <label className={labelCls}>Special Instructions / Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Anything specific about how you want the property cleaned, set up, or anything we should know."
                className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid="input-notes"
              />
            </div>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive text-center">{error}</p>}

        <Button className="w-full h-12 text-base" disabled={saving || photoUploading} onClick={handleSubmit} data-testid="button-submit">
          {saving ? 'Submitting…' : 'Submit Property Information'}
        </Button>

        <p className="text-xs text-muted-foreground text-center">Tendwell Cleaning Co.</p>
      </div>
    </div>
  )
}
