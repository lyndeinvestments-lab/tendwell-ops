import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createTranslator, type TFunc } from './t'
import { issuesEn } from './dictionaries/issues.en'
import { issuesEs } from './dictionaries/issues.es'

export type Locale = 'en' | 'es'

const STORAGE_KEY = 'tendwell-locale'

const DICTIONARIES: Record<Locale, typeof issuesEn> = { en: issuesEn, es: issuesEs }

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
 * Locale context for the Issues surface. Mounted locally on `/issues`
 * (`client/src/pages/issues.tsx`) and the public `/issue/:token` share page
 * (`client/src/pages/issue-share.tsx`) rather than hoisted to `App.tsx` — a
 * future PR can lift it app-wide with zero call-site changes since every
 * consumer goes through `useLocale()`.
 *
 * Persists the chosen locale to `localStorage` (`tendwell-locale`) so it
 * survives reloads and is shared between the two mount points. When
 * `autoDetect` is true (the share page, since a cleaner has never touched
 * this app and has no stored preference yet) and there's no stored value,
 * the initial locale is guessed from `navigator.language`.
 */
export function LocaleProvider({ children, autoDetect = false }: { children: ReactNode; autoDetect?: boolean }) {
  const [locale, setLocale] = useState<Locale>(() => readStoredLocale() ?? (autoDetect ? detectBrowserLocale() : 'en'))

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, locale) } catch { /* storage unavailable — locale still works for this session */ }
  }, [locale])

  const t = useMemo(() => createTranslator(DICTIONARIES[locale], issuesEn), [locale])

  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale, t }), [locale, t])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/** Reads the current locale + translator. Must be used under a `<LocaleProvider>`. */
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within a LocaleProvider')
  return ctx
}
