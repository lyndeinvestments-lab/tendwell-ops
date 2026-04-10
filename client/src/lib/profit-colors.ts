// Canonical profit % color thresholds used across all pages
// Green >= 30%, Amber >= 15%, Orange >= 0%, Red < 0%

export function profitColorClass(pct: number | null | undefined): string {
  if (pct == null) return ''
  if (pct >= 30) return 'text-green-600 dark:text-green-400'
  if (pct >= 15) return 'text-amber-600 dark:text-amber-400'
  if (pct >= 0) return 'text-orange-600 dark:text-orange-400'
  return 'text-destructive'
}
