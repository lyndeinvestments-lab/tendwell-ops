import { Card, CardContent } from '@/components/ui/card'
import { categoryLabel } from '@/lib/issues'
import { useLocale } from '@/lib/i18n/LocaleProvider'

/**
 * Top-4 category tiles, extracted verbatim from `issues.tsx`. `cat` is the
 * canonical English DB value (used as the filter value on click); the
 * displayed label is translated via `categoryLabel`.
 */
export function IssueSummaryStrip({
  byCategory,
  onSelectCategory,
}: {
  byCategory: Record<string, number>
  onSelectCategory: (category: string) => void
}) {
  const { t } = useLocale('issues')
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([cat, count]) => (
        <Card key={cat} className="cursor-pointer shadow-xs hover:bg-muted/30 hover:shadow-sm transition-all" onClick={() => onSelectCategory(cat)}>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground truncate">{categoryLabel(cat, t)}</p>
            <p className="text-lg font-semibold">{count}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
