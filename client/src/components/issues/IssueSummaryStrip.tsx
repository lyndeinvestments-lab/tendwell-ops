import { Card, CardContent } from '@/components/ui/card'

/**
 * Top-4 category tiles, extracted verbatim from `issues.tsx`.
 */
export function IssueSummaryStrip({
  byCategory,
  onSelectCategory,
}: {
  byCategory: Record<string, number>
  onSelectCategory: (category: string) => void
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([cat, count]) => (
        <Card key={cat} className="cursor-pointer shadow-xs hover:bg-muted/30 hover:shadow-sm transition-all" onClick={() => onSelectCategory(cat)}>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground truncate">{cat}</p>
            <p className="text-lg font-semibold">{count}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
