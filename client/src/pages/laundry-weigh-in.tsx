import { useState, useRef, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Check, Camera, Shirt, Sparkles, X } from 'lucide-react'
import { resizeImageFile } from '@/lib/resize-image'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { LanguageToggle } from '@/components/LanguageToggle'

// Public page — uses anon key directly (no auth required)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const publicSupabase = createClient(supabaseUrl, supabaseAnonKey)

type LaundryType = 'clean' | 'dirty'

// Locale context comes from the app-wide <LocaleProvider autoDetect> in
// App.tsx — a first-time cleaner with a Spanish-language phone still lands
// in Spanish. Locale is also persisted onto the submitted row (`language`).
export default function LaundryWeighInPage() {
  const { t, locale } = useLocale('weighIns')

  const [name, setName] = useState('')
  const [pounds, setPounds] = useState('')
  const [laundryType, setLaundryType] = useState<LaundryType | ''>('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [knownNames, setKnownNames] = useState<string[]>([])
  const [nameFocused, setNameFocused] = useState(false)

  // Special linens state
  const [hasSpecialLinens, setHasSpecialLinens] = useState<boolean | null>(null)
  const [specialLinenProperty, setSpecialLinenProperty] = useState('')
  const [specialLinenPropertyFocused, setSpecialLinenPropertyFocused] = useState(false)
  const [propertyNames, setPropertyNames] = useState<string[]>([])
  const [specialLinenDesc, setSpecialLinenDesc] = useState('')
  const [specialLinenPhotoFile, setSpecialLinenPhotoFile] = useState<File | null>(null)
  const [specialLinenPhotoPreview, setSpecialLinenPhotoPreview] = useState<string | null>(null)
  const [specialLinenWeight, setSpecialLinenWeight] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const specialLinenFileInputRef = useRef<HTMLInputElement>(null)
  const nameWrapperRef = useRef<HTMLDivElement>(null)
  const propertyWrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    publicSupabase
      .rpc('get_laundry_weigh_in_names')
      .then(({ data, error }) => {
        if (cancelled || error || !Array.isArray(data)) return
        setKnownNames(data.filter((n): n is string => typeof n === 'string'))
      })
    publicSupabase
      .rpc('get_property_names_for_weigh_in')
      .then(({ data, error }) => {
        if (cancelled || error || !Array.isArray(data)) return
        setPropertyNames(data.filter((n): n is string => typeof n === 'string'))
      })
    return () => { cancelled = true }
  }, [])

  const trimmedNameLive = name.trim()
  const lowerName = trimmedNameLive.toLowerCase()
  const nameSuggestions = lowerName
    ? knownNames.filter(n => n.toLowerCase().startsWith(lowerName) && n.toLowerCase() !== lowerName)
    : knownNames
  const showNameDropdown = nameFocused && nameSuggestions.length > 0

  const lowerProp = specialLinenProperty.trim().toLowerCase()
  const propertySuggestions = (lowerProp
    ? propertyNames.filter(n => n.toLowerCase().includes(lowerProp))
    : propertyNames
  ).slice(0, 10)
  const showPropertyDropdown = specialLinenPropertyFocused && propertySuggestions.length > 0

  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.lang = locale
    }
  }, [locale])

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview)
    }
  }, [photoPreview])

  useEffect(() => {
    return () => {
      if (specialLinenPhotoPreview) URL.revokeObjectURL(specialLinenPhotoPreview)
    }
  }, [specialLinenPhotoPreview])

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.files?.[0]
    if (!raw) return
    const file = await resizeImageFile(raw)
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  function clearPhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoFile(null)
    setPhotoPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSpecialLinenPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.files?.[0]
    if (!raw) return
    const file = await resizeImageFile(raw)
    if (specialLinenPhotoPreview) URL.revokeObjectURL(specialLinenPhotoPreview)
    setSpecialLinenPhotoFile(file)
    setSpecialLinenPhotoPreview(URL.createObjectURL(file))
  }

  function clearSpecialLinenPhoto() {
    if (specialLinenPhotoPreview) URL.revokeObjectURL(specialLinenPhotoPreview)
    setSpecialLinenPhotoFile(null)
    setSpecialLinenPhotoPreview(null)
    if (specialLinenFileInputRef.current) specialLinenFileInputRef.current.value = ''
  }

  function resetForm() {
    setName('')
    setPounds('')
    setLaundryType('')
    clearPhoto()
    setHasSpecialLinens(null)
    setSpecialLinenProperty('')
    setSpecialLinenDesc('')
    clearSpecialLinenPhoto()
    setSpecialLinenWeight('')
    setError('')
    setSubmitted(false)
  }

  async function uploadPhoto(file: File, prefix: string): Promise<{ url: string; path: string } | null> {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'jpg'
    const today = new Date().toISOString().slice(0, 10)
    const rand = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const path = `${prefix}${today}/${rand}.${safeExt}`
    const { error: uploadErr } = await publicSupabase
      .storage
      .from('laundry-weigh-ins')
      .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
    if (uploadErr) return null
    const { data: urlData } = publicSupabase.storage.from('laundry-weigh-ins').getPublicUrl(path)
    return { url: urlData.publicUrl, path }
  }

  async function handleSubmit() {
    setError('')
    const trimmedName = name.trim()
    const poundsNum = parseFloat(pounds)
    if (!trimmedName || !pounds || !laundryType) {
      setError(t('validation.required'))
      return
    }
    if (!Number.isFinite(poundsNum) || poundsNum <= 0) {
      setError(t('validation.pounds'))
      return
    }
    if (hasSpecialLinens === true) {
      if (!specialLinenProperty.trim() || !specialLinenDesc.trim() || !specialLinenWeight) {
        setError(t('validation.specialLinens'))
        return
      }
      const slWeight = parseFloat(specialLinenWeight)
      if (!Number.isFinite(slWeight) || slWeight <= 0) {
        setError(t('validation.specialWeight'))
        return
      }
    }

    setSaving(true)
    let photoUrl: string | null = null
    let photoPath: string | null = null
    let specialLinenPhotoUrl: string | null = null
    let specialLinenPhotoPath: string | null = null

    try {
      if (photoFile) {
        const result = await uploadPhoto(photoFile, '')
        if (!result) { setSaving(false); setError(t('validation.photo')); return }
        photoUrl = result.url
        photoPath = result.path
      }

      if (hasSpecialLinens && specialLinenPhotoFile) {
        const result = await uploadPhoto(specialLinenPhotoFile, 'special-linens/')
        if (!result) { setSaving(false); setError(t('validation.photo')); return }
        specialLinenPhotoUrl = result.url
        specialLinenPhotoPath = result.path
      }

      const { error: insertErr } = await publicSupabase
        .from('laundry_weigh_ins')
        .insert({
          cleaner_name: trimmedName,
          pounds: poundsNum,
          laundry_type: laundryType,
          photo_url: photoUrl,
          photo_path: photoPath,
          language: locale,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : null,
          submitted_at: new Date().toISOString(),
          has_special_linens: hasSpecialLinens === true,
          special_linen_property: hasSpecialLinens ? specialLinenProperty.trim() || null : null,
          special_linen_description: hasSpecialLinens ? specialLinenDesc.trim() || null : null,
          special_linen_photo_url: specialLinenPhotoUrl,
          special_linen_photo_path: specialLinenPhotoPath,
          special_linen_weight: hasSpecialLinens && specialLinenWeight ? parseFloat(specialLinenWeight) : null,
        })

      setSaving(false)
      if (insertErr) { setError(t('validation.generic')); return }
      setKnownNames(prev =>
        prev.some(n => n.toLowerCase() === trimmedName.toLowerCase())
          ? prev
          : [...prev, trimmedName].sort((a, b) => a.localeCompare(b)),
      )
      setSubmitted(true)
    } catch {
      setSaving(false)
      setError(t('validation.generic'))
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
            <h2 className="text-lg font-semibold">{t('success.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('success.body')}</p>
            <Button className="w-full h-11" onClick={resetForm}>{t('form.submitAnother')}</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const inputCls = 'h-11 text-base'

  return (
    <div className="min-h-screen bg-background p-4 sm:p-8">
      <div className="max-w-md mx-auto space-y-5">
        <div className="flex items-center justify-end">
          <LanguageToggle size="lg" />
        </div>

        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto">
            <Shirt className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold">{t('form.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('form.subtitle')}</p>
        </div>

        {/* Name */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('form.name.label')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div ref={nameWrapperRef} className="relative">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                onFocus={() => setNameFocused(true)}
                onBlur={() => setTimeout(() => setNameFocused(false), 120)}
                className={inputCls}
                placeholder={t('form.name.placeholder')}
                autoComplete="off"
                data-testid="input-name"
              />
              {showNameDropdown && (
                <ul
                  className="absolute z-10 mt-1 w-full max-h-48 overflow-auto rounded-md border bg-popover shadow-md"
                  data-testid="name-suggestions"
                >
                  {nameSuggestions.map(n => (
                    <li key={n}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                        onMouseDown={e => {
                          e.preventDefault()
                          setName(n)
                          setNameFocused(false)
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

        {/* Main photo */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('form.photo.label')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoChange}
              className="hidden"
              data-testid="input-photo"
            />
            {photoPreview ? (
              <div className="space-y-3">
                <img
                  src={photoPreview}
                  alt={t('form.photo.previewAlt')}
                  className="w-full h-56 object-cover rounded-md border border-border"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 h-11"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    {t('form.photo.retake')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11"
                    onClick={clearPhoto}
                    aria-label={t('form.photo.remove')}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-32 rounded-md border-2 border-dashed border-border hover:border-primary/60 hover:bg-accent/50 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground transition-colors"
                data-testid="button-take-photo"
              >
                <Camera className="w-6 h-6" />
                <span className="font-medium text-foreground">{t('form.photo.take')}</span>
                <span className="text-xs">{t('form.photo.hint')}</span>
              </button>
            )}
          </CardContent>
        </Card>

        {/* Pounds */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('form.pounds.label')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                value={pounds}
                onChange={e => setPounds(e.target.value)}
                className={`${inputCls} pr-12`}
                placeholder={t('form.pounds.placeholder')}
                data-testid="input-pounds"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                {t('form.pounds.unit')}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Laundry Type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('form.type.label')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setLaundryType('clean')}
                className={`h-20 rounded-md border-2 flex flex-col items-center justify-center gap-1 text-sm font-medium transition-colors ${
                  laundryType === 'clean'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:border-primary/40'
                }`}
                data-testid="button-type-clean"
              >
                <Sparkles className="w-5 h-5" />
                <span>{t('form.type.clean')}</span>
              </button>
              <button
                type="button"
                onClick={() => setLaundryType('dirty')}
                className={`h-20 rounded-md border-2 flex flex-col items-center justify-center gap-1 text-sm font-medium transition-colors ${
                  laundryType === 'dirty'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:border-primary/40'
                }`}
                data-testid="button-type-dirty"
              >
                <Shirt className="w-5 h-5" />
                <span>{t('form.type.dirty')}</span>
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Special Linens */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('form.specialLinens.label')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground -mt-1">{t('form.specialLinens.hint')}</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setHasSpecialLinens(true)}
                className={`h-14 rounded-md border-2 flex items-center justify-center text-sm font-medium transition-colors ${
                  hasSpecialLinens === true
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:border-primary/40'
                }`}
                data-testid="button-special-yes"
              >
                {t('form.specialLinens.yes')}
              </button>
              <button
                type="button"
                onClick={() => setHasSpecialLinens(false)}
                className={`h-14 rounded-md border-2 flex items-center justify-center text-sm font-medium transition-colors ${
                  hasSpecialLinens === false
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:border-primary/40'
                }`}
                data-testid="button-special-no"
              >
                {t('form.specialLinens.no')}
              </button>
            </div>

            {hasSpecialLinens === true && (
              <div className="space-y-4 pt-1">
                {/* Property searchable dropdown */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                    {t('form.specialLinens.propertyLabel')}
                  </label>
                  <div ref={propertyWrapperRef} className="relative">
                    <Input
                      value={specialLinenProperty}
                      onChange={e => setSpecialLinenProperty(e.target.value)}
                      onFocus={() => setSpecialLinenPropertyFocused(true)}
                      onBlur={() => setTimeout(() => setSpecialLinenPropertyFocused(false), 200)}
                      className={inputCls}
                      placeholder={t('form.specialLinens.propertyPlaceholder')}
                      autoComplete="off"
                      data-testid="input-special-property"
                    />
                    {specialLinenPropertyFocused && (
                      <ul className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-md border bg-popover shadow-lg">
                        {propertySuggestions.length > 0 ? propertySuggestions.map(n => (
                          <li key={n}>
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent hover:text-accent-foreground"
                              onMouseDown={e => {
                                e.preventDefault()
                                setSpecialLinenProperty(n)
                                setSpecialLinenPropertyFocused(false)
                              }}
                            >
                              {n}
                            </button>
                          </li>
                        )) : lowerProp ? (
                          <li className="px-3 py-2.5 text-sm text-muted-foreground">{t('form.specialLinens.noPropertiesFound')}</li>
                        ) : null}
                      </ul>
                    )}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                    {t('form.specialLinens.descLabel')}
                  </label>
                  <textarea
                    value={specialLinenDesc}
                    onChange={e => setSpecialLinenDesc(e.target.value)}
                    className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-base resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder={t('form.specialLinens.descPlaceholder')}
                    data-testid="input-special-desc"
                  />
                </div>

                {/* Special linen photo */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                    {t('form.specialLinens.photoLabel')}
                  </label>
                  <input
                    ref={specialLinenFileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleSpecialLinenPhotoChange}
                    className="hidden"
                    data-testid="input-special-photo"
                  />
                  {specialLinenPhotoPreview ? (
                    <div className="space-y-2">
                      <img
                        src={specialLinenPhotoPreview}
                        alt={t('form.specialLinens.photoPreviewAlt')}
                        className="w-full h-44 object-cover rounded-md border border-border"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1 h-10 text-sm"
                          onClick={() => specialLinenFileInputRef.current?.click()}
                        >
                          <Camera className="w-4 h-4 mr-2" />
                          {t('form.specialLinens.photoRetake')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-10"
                          onClick={clearSpecialLinenPhoto}
                          aria-label={t('form.photo.remove')}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => specialLinenFileInputRef.current?.click()}
                      className="w-full h-28 rounded-md border-2 border-dashed border-border hover:border-primary/60 hover:bg-accent/50 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground transition-colors"
                      data-testid="button-special-take-photo"
                    >
                      <Camera className="w-5 h-5" />
                      <span className="font-medium text-foreground">{t('form.specialLinens.photoTake')}</span>
                      <span className="text-xs">{t('form.specialLinens.photoHint')}</span>
                    </button>
                  )}
                </div>

                {/* Weight */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                    {t('form.specialLinens.weightLabel')}
                  </label>
                  <div className="relative">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="0"
                      value={specialLinenWeight}
                      onChange={e => setSpecialLinenWeight(e.target.value)}
                      className={`${inputCls} pr-12`}
                      placeholder={t('form.specialLinens.weightPlaceholder')}
                      data-testid="input-special-weight"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                      {t('form.pounds.unit')}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive text-center" role="alert">{error}</p>}

        <Button
          className="w-full h-12 text-base"
          disabled={saving}
          onClick={handleSubmit}
          data-testid="button-submit"
        >
          {saving ? t('form.submitting') : t('form.submit')}
        </Button>

        <p className="text-xs text-muted-foreground text-center pb-4">{t('form.footer')}</p>
      </div>
    </div>
  )
}
