import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Check, Building2 } from 'lucide-react'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { LanguageToggle } from '@/components/LanguageToggle'

// Public page — uses anon key directly (no auth required)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const publicSupabase = createClient(supabaseUrl, supabaseAnonKey)

export default function OnboardingFormPage() {
  const { t } = useLocale('onboarding')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    client_name: '', property_name: '', address: '',
    bedrooms: '', full_baths: '', half_baths: '', square_footage: '',
    number_of_beds: '', guest_count: '', kitchens: '1',
    hot_tub: false, pet_friendly: '',
    wifi_info: '', door_code: '', other_codes: '', notes: '',
  })

  // Token comes from ?token= (new clean URLs) with a fallback to the legacy
  // hash-based form (#/onboard?token=…) for any in-flight emailed links.
  const searchParams = new URLSearchParams(window.location.search)
  const hashTokenMatch = window.location.hash.match(/token=([a-zA-Z0-9-]+)/)
  const token = searchParams.get('token') || hashTokenMatch?.[1] || ''

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground">{t('legacyForm.invalidLink')}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <Check className="w-6 h-6 text-success" />
            </div>
            <h2 className="text-lg font-semibold">{t('legacyForm.success.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('legacyForm.success.body')}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  async function handleSubmit() {
    if (!form.property_name || !form.address) {
      setError(t('legacyForm.errors.fieldsRequired'))
      return
    }
    setSaving(true)
    setError('')
    const { error: err } = await publicSupabase.from('onboarding_submissions').insert({
      token,
      client_name: form.client_name || null,
      property_name: form.property_name,
      address: form.address,
      bedrooms: form.bedrooms ? parseInt(form.bedrooms) : null,
      full_baths: form.full_baths ? parseInt(form.full_baths) : null,
      half_baths: form.half_baths ? parseInt(form.half_baths) : null,
      square_footage: form.square_footage ? parseFloat(form.square_footage) : null,
      number_of_beds: form.number_of_beds ? parseInt(form.number_of_beds) : null,
      guest_count: form.guest_count ? parseInt(form.guest_count) : null,
      kitchens: form.kitchens ? parseInt(form.kitchens) : null,
      hot_tub: form.hot_tub,
      pet_friendly: form.pet_friendly || null,
      wifi_info: form.wifi_info || null,
      door_code: form.door_code || null,
      other_codes: form.other_codes || null,
      notes: form.notes || null,
      status: 'pending',
      submitted_at: new Date().toISOString(),
    })
    setSaving(false)
    if (err) {
      if (err.code === '23505') setError(t('legacyForm.errors.linkUsed'))
      else setError(t('legacyForm.errors.generic'))
    } else {
      setSubmitted(true)
      // Fire-and-forget notification to admins
      try {
        await fetch('/api/notify/public', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventType: 'onboarding_submitted', token }),
        })
      } catch { /* ignore */ }
    }
  }

  const inputCls = "h-10 text-sm"
  const labelCls = "text-xs font-medium text-muted-foreground block mb-1"

  return (
    <div className="min-h-screen bg-background p-4 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-end">
          <LanguageToggle size="lg" />
        </div>

        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mx-auto">
            <Building2 className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-xl font-semibold">{t('legacyForm.page.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('legacyForm.page.subtitle')}</p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-sm">{t('legacyForm.sections.propertyInfo')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>{t('legacyForm.fields.yourName')}</label>
                <Input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} className={inputCls} placeholder={t('legacyForm.fields.yourNamePlaceholder')} />
              </div>
              <div>
                <label className={labelCls}>{t('legacyForm.fields.propertyName')}</label>
                <Input value={form.property_name} onChange={e => setForm(f => ({ ...f, property_name: e.target.value }))} className={inputCls} placeholder={t('legacyForm.fields.propertyNamePlaceholder')} />
              </div>
            </div>
            <div>
              <label className={labelCls}>{t('legacyForm.fields.address')}</label>
              <AddressAutocomplete
                value={form.address}
                onChange={(v) => setForm(f => ({ ...f, address: v }))}
                className={inputCls}
                placeholder={t('legacyForm.fields.addressPlaceholder')}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">{t('legacyForm.sections.propertyDetails')}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div><label className={labelCls}>{t('legacyForm.fields.bedrooms')}</label><Input type="number" value={form.bedrooms} onChange={e => setForm(f => ({ ...f, bedrooms: e.target.value }))} className={inputCls} /></div>
              <div><label className={labelCls}>{t('legacyForm.fields.fullBaths')}</label><Input type="number" value={form.full_baths} onChange={e => setForm(f => ({ ...f, full_baths: e.target.value }))} className={inputCls} /></div>
              <div><label className={labelCls}>{t('legacyForm.fields.halfBaths')}</label><Input type="number" value={form.half_baths} onChange={e => setForm(f => ({ ...f, half_baths: e.target.value }))} className={inputCls} /></div>
              <div><label className={labelCls}>{t('legacyForm.fields.squareFootage')}</label><Input type="number" value={form.square_footage} onChange={e => setForm(f => ({ ...f, square_footage: e.target.value }))} className={inputCls} /></div>
              <div><label className={labelCls}>{t('legacyForm.fields.numberOfBeds')}</label><Input type="number" value={form.number_of_beds} onChange={e => setForm(f => ({ ...f, number_of_beds: e.target.value }))} className={inputCls} /></div>
              <div><label className={labelCls}>{t('legacyForm.fields.maxGuests')}</label><Input type="number" value={form.guest_count} onChange={e => setForm(f => ({ ...f, guest_count: e.target.value }))} className={inputCls} /></div>
              <div><label className={labelCls}>{t('legacyForm.fields.kitchens')}</label><Input type="number" value={form.kitchens} onChange={e => setForm(f => ({ ...f, kitchens: e.target.value }))} className={inputCls} /></div>
              <div>
                <label className={labelCls}>{t('legacyForm.fields.hotTub')}</label>
                <div className="flex gap-2">
                  <button onClick={() => setForm(f => ({ ...f, hot_tub: false }))} className={`flex-1 h-10 rounded-md border text-sm ${!form.hot_tub ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border'}`}>{t('common.actions.no')}</button>
                  <button onClick={() => setForm(f => ({ ...f, hot_tub: true }))} className={`flex-1 h-10 rounded-md border text-sm ${form.hot_tub ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border'}`}>{t('common.actions.yes')}</button>
                </div>
              </div>
              <div><label className={labelCls}>{t('legacyForm.fields.petFriendly')}</label><Input value={form.pet_friendly} onChange={e => setForm(f => ({ ...f, pet_friendly: e.target.value }))} className={inputCls} placeholder={t('legacyForm.fields.petFriendlyPlaceholder')} /></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">{t('legacyForm.sections.accessWifi')}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className={labelCls}>{t('legacyForm.fields.doorCode')}</label><Input value={form.door_code} onChange={e => setForm(f => ({ ...f, door_code: e.target.value }))} className={inputCls} /></div>
              <div><label className={labelCls}>{t('legacyForm.fields.otherCodes')}</label><Input value={form.other_codes} onChange={e => setForm(f => ({ ...f, other_codes: e.target.value }))} className={inputCls} /></div>
              <div><label className={labelCls}>{t('legacyForm.fields.wifiInfo')}</label><Input value={form.wifi_info} onChange={e => setForm(f => ({ ...f, wifi_info: e.target.value }))} className={inputCls} placeholder={t('legacyForm.fields.wifiInfoPlaceholder')} /></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">{t('legacyForm.sections.notes')}</CardTitle></CardHeader>
          <CardContent>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={t('legacyForm.fields.notesPlaceholder')} />
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive text-center">{error}</p>}

        <Button className="w-full h-12 text-base" disabled={saving} onClick={handleSubmit}>
          {saving ? t('legacyForm.submit.submitting') : t('legacyForm.submit.submit')}
        </Button>

        <p className="text-xs text-muted-foreground text-center">Tendwell Cleaning Co.</p>
      </div>
    </div>
  )
}
