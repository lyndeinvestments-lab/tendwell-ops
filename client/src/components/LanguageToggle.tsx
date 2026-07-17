import { useLocale, type Locale } from '@/lib/i18n/LocaleProvider'
import { cn } from '@/lib/utils'

const OPTIONS: Array<{ value: Locale; label: string; aria: string }> = [
  { value: 'en', label: 'EN', aria: 'English' },
  { value: 'es', label: 'ES', aria: 'Español' },
]

/**
 * Small EN|ES segmented pill for switching the Issues surface's locale.
 * Mounted in the issues page header actions (compact) and prominently under
 * the public share page's masthead (`size="lg"`, thumb-sized for a cleaner
 * on a phone).
 */
export function LanguageToggle({ className, size = 'sm' }: { className?: string; size?: 'sm' | 'lg' }) {
  const { locale, setLocale } = useLocale()
  const lg = size === 'lg'

  return (
    <div
      role="group"
      aria-label="Language"
      className={cn('inline-flex items-center rounded-full border border-border bg-muted/40 p-0.5', className)}
    >
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={locale === opt.value}
          aria-label={opt.aria}
          onClick={() => setLocale(opt.value)}
          className={cn(
            'rounded-full font-semibold transition-colors',
            lg ? 'px-4 h-10 text-sm' : 'px-2.5 h-6 text-xs',
            locale === opt.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
