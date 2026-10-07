export type DateFormatFn = (date: Date | number, pattern: string) => string

export function formatDate(iso: string | null, format: DateFormatFn): string {
  if (!iso) return '—'
  // Date-only strings (YYYY-MM-DD) must be constructed in local time to avoid
  // UTC-midnight anchoring rolling them back a day in Eastern/other western TZs.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    if (isNaN(dt.getTime())) return '—'
    return format(dt, 'MMM d, yyyy')
  }
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return format(d, 'MMM d, yyyy')
}
