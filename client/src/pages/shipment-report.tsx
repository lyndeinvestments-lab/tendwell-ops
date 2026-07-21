import { useState, useRef, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Check, Package } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { LanguageToggle } from '@/components/LanguageToggle'

// Public page — uses anon key directly (no auth required)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const publicSupabase = createClient(supabaseUrl, supabaseAnonKey)

type DeliveryResponsible = 'Haven' | 'Tendwell'

export default function ShipmentReportPage() {
  const { t } = useLocale('shipments')
  const [senderName, setSenderName] = useState('')
  const [propertyName, setPropertyName] = useState('')
  const [propertyFocused, setPropertyFocused] = useState(false)
  const [propertyNames, setPropertyNames] = useState<string[]>([])
  const [trackingNumber, setTrackingNumber] = useState('')
  const [estimatedDelivery, setEstimatedDelivery] = useState('')
  const [description, setDescription] = useState('')
  const [deliveryResponsible, setDeliveryResponsible] = useState<DeliveryResponsible | ''>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const propertyWrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    publicSupabase
      .rpc('get_property_names_for_weigh_in')
      .then(({ data, error }) => {
        if (cancelled || error || !Array.isArray(data)) return
        setPropertyNames(data.filter((n): n is string => typeof n === 'string'))
      })
    return () => { cancelled = true }
  }, [])

  const lowerProp = propertyName.trim().toLowerCase()
  const propertySuggestions = (lowerProp
    ? propertyNames.filter(n => n.toLowerCase().includes(lowerProp))
    : propertyNames
  ).slice(0, 10)
  const showPropertyDropdown = propertyFocused && propertySuggestions.length > 0

  function resetForm() {
    setSenderName('')
    setPropertyName('')
    setTrackingNumber('')
    setEstimatedDelivery('')
    setDescription('')
    setDeliveryResponsible('')
    setError('')
    setSubmitted(false)
  }

  async function handleSubmit() {
    setError('')
    const trimmedName = senderName.trim()
    const trimmedProperty = propertyName.trim()
    const trimmedDescription = description.trim()

    if (!trimmedName || !trimmedProperty || !estimatedDelivery || !trimmedDescription || !deliveryResponsible) {
      setError(t('report.validationRequired'))
      return
    }

    setSaving(true)
    try {
      const { error: insertErr } = await publicSupabase
        .from('incoming_shipments')
        .insert({
          sender_name: trimmedName,
          property_name: trimmedProperty,
          tracking_number: trackingNumber.trim() || null,
          estimated_delivery: estimatedDelivery,
          description: trimmedDescription,
          delivery_responsible: deliveryResponsible,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : null,
          submitted_at: new Date().toISOString(),
        })

      setSaving(false)
      if (insertErr) { setError(t('report.validationGeneric')); return }
      setSubmitted(true)
    } catch {
      setSaving(false)
      setError(t('report.validationGeneric'))
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <Check className="w-6 h-6 text-success" />
            </div>
            <h2 className="text-lg font-semibold">{t('report.successTitle')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('report.successBody')}
            </p>
            <Button className="w-full h-11" onClick={resetForm}>{t('report.submitAnother')}</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const inputCls = 'h-11 text-base'
  const required = <span className="text-destructive ml-0.5">*</span>

  return (
    <div className="min-h-screen bg-background p-4 sm:p-8">
      <div className="max-w-md mx-auto space-y-5">

        <div className="flex items-center justify-end">
          <LanguageToggle size="lg" />
        </div>

        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto">
            <Package className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold">{t('report.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('report.subtitle')}
          </p>
        </div>

        {/* Sender name */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('report.yourName')}{required}</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              value={senderName}
              onChange={e => setSenderName(e.target.value)}
              className={inputCls}
              placeholder={t('report.yourNamePlaceholder')}
              autoComplete="name"
            />
          </CardContent>
        </Card>

        {/* Property */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('common.labels.property')}{required}</CardTitle>
          </CardHeader>
          <CardContent>
            <div ref={propertyWrapperRef} className="relative">
              <Input
                value={propertyName}
                onChange={e => setPropertyName(e.target.value)}
                onFocus={() => setPropertyFocused(true)}
                onBlur={() => setTimeout(() => setPropertyFocused(false), 200)}
                className={inputCls}
                placeholder={t('report.propertyPlaceholder')}
                autoComplete="off"
              />
              {showPropertyDropdown && (
                <ul className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-md border bg-popover shadow-lg">
                  {propertySuggestions.map(n => (
                    <li key={n}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent hover:text-accent-foreground"
                        onMouseDown={e => {
                          e.preventDefault()
                          setPropertyName(n)
                          setPropertyFocused(false)
                        }}
                      >
                        {n}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tracking number (optional) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {t('report.trackingNumber')}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">{t('report.optional')}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              value={trackingNumber}
              onChange={e => setTrackingNumber(e.target.value)}
              className={inputCls}
              placeholder={t('report.trackingPlaceholder')}
              autoComplete="off"
            />
          </CardContent>
        </Card>

        {/* Estimated delivery date */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('report.estimatedDeliveryDate')}{required}</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              type="date"
              value={estimatedDelivery}
              onChange={e => setEstimatedDelivery(e.target.value)}
              className={inputCls}
            />
          </CardContent>
        </Card>

        {/* Description */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('report.descriptionOfItem')}{required}</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full min-h-[96px] rounded-md border border-input bg-background px-3 py-2 text-base resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={t('report.descriptionPlaceholder')}
            />
          </CardContent>
        </Card>

        {/* Delivery responsible */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('report.responsibleQuestion')}{required}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {/* 'Haven'/'Tendwell' are company names (delivery_responsible enum value) — not translated */}
              {(['Haven', 'Tendwell'] as DeliveryResponsible[]).map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDeliveryResponsible(option)}
                  className={`h-14 rounded-md border-2 flex items-center justify-center text-sm font-medium transition-colors ${
                    deliveryResponsible === option
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:border-primary/40'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {error && (
          <p className="text-sm text-destructive text-center" role="alert">{error}</p>
        )}

        <Button
          className="w-full h-12 text-base"
          disabled={saving}
          onClick={handleSubmit}
        >
          {saving ? t('report.submitting') : t('report.submit')}
        </Button>

        <p className="text-xs text-muted-foreground text-center pb-4">{t('report.footer')}</p>
      </div>
    </div>
  )
}
