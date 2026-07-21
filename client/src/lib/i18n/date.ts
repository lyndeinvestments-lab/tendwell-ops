import { useMemo } from 'react'
import { format as dfFormat, formatDistanceToNow as dfFormatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { useLocale } from './LocaleProvider'

/**
 * Locale-aware wrappers around date-fns. `format`/`formatDistanceToNow`
 * default to English month/day names regardless of the app locale, so pages
 * should format dates through this hook instead:
 *
 *   const { format } = useDateFormat()
 *   format(parseISO(row.due_date), 'MMM d, yyyy')   // "jul 20, 2026" in es
 */
export function useDateFormat() {
  const { locale } = useLocale()
  return useMemo(() => {
    const opts = locale === 'es' ? { locale: es } : undefined
    return {
      format: (date: Date | number, pattern: string) => dfFormat(date, pattern, opts),
      formatDistanceToNow: (date: Date | number, options?: { addSuffix?: boolean }) =>
        dfFormatDistanceToNow(date, opts ? { ...options, ...opts } : options),
    }
  }, [locale])
}
