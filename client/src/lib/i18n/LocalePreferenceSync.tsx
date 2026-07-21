import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth, OWNER_ROLE } from '@/lib/auth'
import { useLocale, type Locale } from './LocaleProvider'

function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'es'
}

/**
 * Bridges the locale context to the signed-in user's saved preference.
 * Mounted once in App.tsx (inside both AuthProvider and LocaleProvider).
 *
 * - On login: reads preferred_locale from app_users (staff) or
 *   property_owners (owners) and applies it, so the last saved choice wins
 *   on any device. localStorage/autoDetect only matter when no preference
 *   has ever been saved (or pre-login, e.g. the public share pages).
 * - On any locale change (header toggle, /account, owner portal): persists
 *   via the set_my_locale RPC, fire-and-forget.
 *
 * Every DB call is deliberately error-tolerant: if the preferred_locale
 * migration hasn't been applied yet, reads/writes fail silently and the
 * pre-existing localStorage behavior is unchanged.
 */
export function LocalePreferenceSync() {
  const { user } = useAuth()
  const { locale, setLocale } = useLocale()

  // Which user id we've loaded a preference for; null = signed out.
  const loadedFor = useRef<string | null>(null)
  // The last value known to be saved server-side (null = none / unknown).
  const lastSaved = useRef<Locale | null>(null)
  // Live view of the current locale for async callbacks.
  const localeRef = useRef(locale)
  localeRef.current = locale

  // Load the saved preference once per sign-in.
  useEffect(() => {
    if (!user) {
      loadedFor.current = null
      lastSaved.current = null
      return
    }
    if (loadedFor.current === user.id) return
    const localeAtRequest = localeRef.current
    let cancelled = false
    ;(async () => {
      let pref: Locale | null = null
      // `as any` casts: the generated Supabase types predate the
      // 20260720_user_locale migration (preferred_locale + set_my_locale).
      // Safe either way — every path tolerates errors and missing data.
      try {
        if (user.role === OWNER_ROLE) {
          const { data } = await (supabase as any)
            .from('property_owners')
            .select('preferred_locale')
            .eq('id', user.id)
            .maybeSingle()
          if (isLocale(data?.preferred_locale)) pref = data.preferred_locale
        } else {
          const numericId = Number(user.id)
          if (Number.isInteger(numericId)) {
            const { data } = await (supabase as any)
              .from('app_users')
              .select('preferred_locale')
              .eq('id', numericId)
              .maybeSingle()
            if (isLocale(data?.preferred_locale)) pref = data.preferred_locale
          }
        }
      } catch {
        // Column not migrated yet or transient error — keep local behavior.
      }
      if (cancelled) return
      loadedFor.current = user.id
      lastSaved.current = pref
      // Apply the saved preference — unless the user flipped the toggle while
      // this request was in flight, in which case their fresh choice wins
      // (the persist effect below will save it).
      if (pref && localeRef.current === localeAtRequest && pref !== localeRef.current) {
        setLocale(pref)
      }
    })()
    return () => { cancelled = true }
  }, [user, setLocale])

  // Persist changes after the initial load. Also snapshots the current locale
  // as the preference on first login (pref === null), so "last used" becomes
  // "saved" without requiring a visit to /account.
  useEffect(() => {
    if (!user || loadedFor.current !== user.id) return
    if (lastSaved.current === locale) return
    lastSaved.current = locale
    ;(supabase as any).rpc('set_my_locale', { p_locale: locale }).then(
      ({ error }: { error: unknown }) => { if (error) lastSaved.current = null /* retry on next change */ },
      () => { lastSaved.current = null },
    )
  }, [locale, user])

  return null
}
