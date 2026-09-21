/**
 * Calendar date as YYYY-MM-DD in the user's local timezone.
 * Avoids the UTC day-shift from `toISOString().split('T')[0]` after ~20:00 ET.
 */
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
