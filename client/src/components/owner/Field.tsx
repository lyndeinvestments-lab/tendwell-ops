import { Label } from '@/components/ui/label'
import { useLocale } from '@/lib/i18n/LocaleProvider'

/** Label + control wrapper used by every owner-portal form. */
export function Field({ label, children, className, locked }: { label: string; children: React.ReactNode; className?: string; locked?: boolean }) {
  const { t } = useLocale('ownerPortal')
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label className="text-xs text-muted-foreground flex items-center gap-1">
        {label}
        {locked && <span className="text-2xs text-muted-foreground/70">{t('properties.viewOnly')}</span>}
      </Label>
      {children}
    </div>
  )
}
