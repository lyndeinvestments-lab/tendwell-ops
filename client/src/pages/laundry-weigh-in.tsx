import { useState, useRef, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Check, Camera, Shirt, Sparkles, X } from 'lucide-react'

// Public page — uses anon key directly (no auth required)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const publicSupabase = createClient(supabaseUrl, supabaseAnonKey)

type Lang = 'en' | 'es'
type LaundryType = 'clean' | 'dirty'

const T = {
  en: {
    title: 'Daily Laundry Weigh-In',
    subtitle: 'Record laundry bags you are taking or dropping off.',
    nameLabel: 'Your Name',
    namePlaceholder: 'First and last name',
    photoLabel: 'Photo',
    photoTake: 'Take Photo',
    photoRetake: 'Retake Photo',
    photoRemove: 'Remove',
    photoHint: 'Tap to take a photo of the laundry bag(s).',
    poundsLabel: 'Pounds of Laundry',
    poundsPlaceholder: 'e.g. 25',
    poundsUnit: 'lbs',
    typeLabel: 'Laundry Type',
    typeClean: 'Clean (drop-off)',
    typeDirty: 'Dirty (pick-up)',
    submit: 'Submit Weigh-In',
    submitting: 'Submitting…',
    successTitle: 'Weigh-In Submitted',
    successBody: 'Thanks! Your laundry weigh-in has been recorded.',
    submitAnother: 'Submit Another',
    errRequired: 'Please fill in your name, pounds, and laundry type.',
    errPounds: 'Pounds must be a number greater than zero.',
    errPhoto: 'Could not upload photo. Please try again.',
    errGeneric: 'Something went wrong. Please try again.',
    footer: 'Tendwell Cleaning Co.',
    langToggle: 'Español',
  },
  es: {
    title: 'Pesaje Diario de Lavandería',
    subtitle: 'Registra las bolsas de ropa que estás llevando o dejando.',
    nameLabel: 'Tu Nombre',
    namePlaceholder: 'Nombre y apellido',
    photoLabel: 'Foto',
    photoTake: 'Tomar Foto',
    photoRetake: 'Tomar de Nuevo',
    photoRemove: 'Quitar',
    photoHint: 'Toca para tomar una foto de la(s) bolsa(s) de ropa.',
    poundsLabel: 'Libras de Ropa',
    poundsPlaceholder: 'ej. 25',
    poundsUnit: 'lbs',
    typeLabel: 'Tipo de Ropa',
    typeClean: 'Limpia (entrega)',
    typeDirty: 'Sucia (recogida)',
    submit: 'Enviar Pesaje',
    submitting: 'Enviando…',
    successTitle: 'Pesaje Enviado',
    successBody: 'Gracias. Tu pesaje de ropa ha sido registrado.',
    submitAnother: 'Enviar Otro',
    errRequired: 'Por favor completa tu nombre, libras y tipo de ropa.',
    errPounds: 'Las libras deben ser un número mayor que cero.',
    errPhoto: 'No se pudo subir la foto. Inténtalo de nuevo.',
    errGeneric: 'Algo salió mal. Inténtalo de nuevo.',
    footer: 'Tendwell Cleaning Co.',
    langToggle: 'English',
  },
} as const

const LANG_KEY = 'laundry-weigh-in-lang'

export default function LaundryWeighInPage() {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'en'
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'en' || saved === 'es') return saved
    const navLang = (navigator.language || 'en').toLowerCase()
    return navLang.startsWith('es') ? 'es' : 'en'
  })
  const t = T[lang]

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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nameWrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    publicSupabase
      .rpc('get_laundry_weigh_in_names')
      .then(({ data, error }) => {
        if (cancelled || error || !Array.isArray(data)) return
        setKnownNames(data.filter((n): n is string => typeof n === 'string'))
      })
    return () => { cancelled = true }
  }, [])

  const trimmedNameLive = name.trim()
  const lowerName = trimmedNameLive.toLowerCase()
  const nameSuggestions = lowerName
    ? knownNames.filter(n => n.toLowerCase().startsWith(lowerName) && n.toLowerCase() !== lowerName)
    : knownNames
  const showNameDropdown = nameFocused && nameSuggestions.length > 0

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(LANG_KEY, lang)
      document.documentElement.lang = lang
    }
  }, [lang])

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview)
    }
  }, [photoPreview])

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
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

  function resetForm() {
    setName('')
    setPounds('')
    setLaundryType('')
    clearPhoto()
    setError('')
    setSubmitted(false)
  }

  async function handleSubmit() {
    setError('')
    const trimmedName = name.trim()
    const poundsNum = parseFloat(pounds)
    if (!trimmedName || !pounds || !laundryType) {
      setError(t.errRequired)
      return
    }
    if (!Number.isFinite(poundsNum) || poundsNum <= 0) {
      setError(t.errPounds)
      return
    }

    setSaving(true)
    let photoUrl: string | null = null
    let photoPath: string | null = null

    try {
      if (photoFile) {
        const ext = photoFile.name.split('.').pop()?.toLowerCase() || 'jpg'
        const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'jpg'
        const today = new Date().toISOString().slice(0, 10)
        const rand = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
        photoPath = `${today}/${rand}.${safeExt}`
        const { error: uploadErr } = await publicSupabase
          .storage
          .from('laundry-weigh-ins')
          .upload(photoPath, photoFile, {
            contentType: photoFile.type || 'image/jpeg',
            upsert: false,
          })
        if (uploadErr) {
          setSaving(false)
          setError(t.errPhoto)
          return
        }
        const { data: urlData } = publicSupabase
          .storage
          .from('laundry-weigh-ins')
          .getPublicUrl(photoPath)
        photoUrl = urlData.publicUrl
      }

      const { error: insertErr } = await publicSupabase
        .from('laundry_weigh_ins')
        .insert({
          cleaner_name: trimmedName,
          pounds: poundsNum,
          laundry_type: laundryType,
          photo_url: photoUrl,
          photo_path: photoPath,
          language: lang,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : null,
          submitted_at: new Date().toISOString(),
        })

      setSaving(false)
      if (insertErr) {
        setError(t.errGeneric)
        return
      }
      setKnownNames(prev =>
        prev.some(n => n.toLowerCase() === trimmedName.toLowerCase())
          ? prev
          : [...prev, trimmedName].sort((a, b) => a.localeCompare(b)),
      )
      setSubmitted(true)
    } catch {
      setSaving(false)
      setError(t.errGeneric)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center mx-auto">
              <Check className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-lg font-semibold">{t.successTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.successBody}</p>
            <Button className="w-full h-11" onClick={resetForm}>{t.submitAnother}</Button>
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
          <button
            type="button"
            onClick={() => setLang(l => (l === 'en' ? 'es' : 'en'))}
            className="text-sm font-medium px-3 py-1.5 rounded-md border border-border bg-background hover:bg-accent"
            aria-label="Toggle language"
            data-testid="button-lang-toggle"
          >
            {t.langToggle}
          </button>
        </div>

        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto">
            <Shirt className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.nameLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <div ref={nameWrapperRef} className="relative">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                onFocus={() => setNameFocused(true)}
                onBlur={() => setTimeout(() => setNameFocused(false), 120)}
                className={inputCls}
                placeholder={t.namePlaceholder}
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

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.photoLabel}</CardTitle>
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
                  alt="Laundry preview"
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
                    {t.photoRetake}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11"
                    onClick={clearPhoto}
                    aria-label={t.photoRemove}
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
                <span className="font-medium text-foreground">{t.photoTake}</span>
                <span className="text-xs">{t.photoHint}</span>
              </button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.poundsLabel}</CardTitle>
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
                placeholder={t.poundsPlaceholder}
                data-testid="input-pounds"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                {t.poundsUnit}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.typeLabel}</CardTitle>
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
                <span>{t.typeClean}</span>
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
                <span>{t.typeDirty}</span>
              </button>
            </div>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive text-center" role="alert">{error}</p>}

        <Button
          className="w-full h-12 text-base"
          disabled={saving}
          onClick={handleSubmit}
          data-testid="button-submit"
        >
          {saving ? t.submitting : t.submit}
        </Button>

        <p className="text-xs text-muted-foreground text-center pb-4">{t.footer}</p>
      </div>
    </div>
  )
}
