/**
 * Centralized status color system — the single source of truth for
 * status / severity / priority colors across the app.
 *
 * Built on the semantic tokens defined in index.css + tailwind.config.ts:
 *   success (green) · warning (amber) · destructive (red) · info (blue) · neutral (gray)
 *
 * Use `statusTone()` helpers or the `<StatusBadge>` component instead of
 * hardcoding `text-red-700 bg-red-50 dark:...` per page.
 */

export type StatusTone = 'success' | 'warning' | 'destructive' | 'info' | 'neutral' | 'primary'

/** Soft badge/chip style: tinted background + colored text + subtle border. */
export const TONE_SOFT: Record<StatusTone, string> = {
  success: 'bg-success/10 text-success border-success/25',
  warning: 'bg-warning/10 text-warning border-warning/25',
  destructive: 'bg-destructive/10 text-destructive border-destructive/25',
  info: 'bg-info/10 text-info border-info/25',
  neutral: 'bg-muted text-muted-foreground border-border',
  primary: 'bg-primary/10 text-primary border-primary/25',
}

/** Solid style: filled background + contrasting text. */
export const TONE_SOLID: Record<StatusTone, string> = {
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  info: 'bg-info text-info-foreground',
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary text-primary-foreground',
}

/** Text-only style for inline status text / icons. */
export const TONE_TEXT: Record<StatusTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  info: 'text-info',
  neutral: 'text-muted-foreground',
  primary: 'text-primary',
}

/** Left-border accent for list rows / alert cards. */
export const TONE_ACCENT_BORDER: Record<StatusTone, string> = {
  success: 'border-l-success',
  warning: 'border-l-warning',
  destructive: 'border-l-destructive',
  info: 'border-l-info',
  neutral: 'border-l-border',
  primary: 'border-l-primary',
}

/** Map a common status / severity / priority string to a tone. */
export function toneForStatus(status: string | null | undefined): StatusTone {
  const s = (status || '').toLowerCase().trim()
  if (!s) return 'neutral'
  if (/(critical|urgent|overdue|error|failed|denied|blocked|needs attention|escalat|high)/.test(s)) return 'destructive'
  if (/(warn|medium|pending|review|waiting|more info|stale|at risk|low stock|due soon)/.test(s)) return 'warning'
  if (/(success|active|approved|done|complete|resolved|passed|paid|good|healthy|in stock)/.test(s)) return 'success'
  if (/(info|new|open|in progress|scheduled|assigned)/.test(s)) return 'info'
  return 'neutral'
}
