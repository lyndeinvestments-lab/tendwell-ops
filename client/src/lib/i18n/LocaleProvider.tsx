import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createTranslator, scopeT, type TFunc } from './t'
import { dictionaryEn, dictionaryEs } from './dictionaries'

export type Locale = 'en' | 'es'

const STORAGE_KEY = 'tendwell-locale'

const DICTIONARIES: Record<Locale, typeof dictionaryEn> = { en: dictionaryEn, es: dictionaryEs }

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: TFunc
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'en' || stored === 'es' ? stored : null
}

function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en'
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

/**
 * App-wide locale context, mounted once in `App.tsx` around the router so
 * every surface — staff pages, the owner portal, and the public share/weigh-in
 * pages — resolves against the same dictionary registry.
 *
 * Persists the chosen locale to `localStorage` (`tendwell-locale`) so it
 * survives reloads. When `autoDetect` is true (the global mount uses it) and
 * there's no stored value, the initial locale is guessed from
 * `navigator.language` — a Spanish-language phone opening any page for the
 * first time starts in Spanish.
 */
export function LocaleProvider({ children, autoDetect = false }: { children: ReactNode; autoDetect?: boolean }) {
  const [locale, setLocale] = useState<Locale>(() => readStoredLocale() ?? (autoDetect ? detectBrowserLocale() : 'en'))

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, locale) } catch { /* storage unavailable — locale still works for this session */ }
  }, [locale])

  const t = useMemo(() => createTranslator(DICTIONARIES[locale], dictionaryEn), [locale])

  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale, t }), [locale, t])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/**
 * Reads the current locale + translator. Must be used under a `<LocaleProvider>`.
 *
 * Pass a dictionary namespace (`useLocale('linens')`) to get a scoped `t`:
 * `t('page.title')` resolves `linens.page.title` first, then falls back to the
 * unscoped key so shared lookups like `t('common.save')` still work.
 */
export function useLocale(scope?: string): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within a LocaleProvider')
  return useMemo(() => (scope ? { ...ctx, t: scopeT(ctx.t, scope) } : ctx), [ctx, scope])
}
