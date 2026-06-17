// Canonical profit % color + tier used across all pages.
// Jordan's rules (2026-04-24):
//   Green  ≥ 18%
//   Yellow 14% – 18%   (rendered as amber in the Tailwind palette)
//   Red    < 14%       (includes zero/negative)
//
// If you're adding a new chart legend or badge, import from here — never
// hard-code a threshold or color class in the page.

// Mutable so admin-configured values from app_settings (profit_tier_high /
// profit_tier_mid) override the defaults at runtime via
// configureProfitThresholds(). Until the settings query hydrates, these
// defaults apply — i.e. no behavior change from before.
export const PROFIT_THRESHOLDS = { high: 18, mid: 14 }

export type ProfitTier = 'high' | 'mid' | 'low'

// Hydrate thresholds from app_settings (called by the useAppSettings hook).
// Ignores empty/invalid values so a blank setting keeps the default.
export function configureProfitThresholds(high?: number, mid?: number): void {
  if (typeof high === 'number' && !Number.isNaN(high) && high > 0) PROFIT_THRESHOLDS.high = high
  if (typeof mid === 'number' && !Number.isNaN(mid) && mid > 0) PROFIT_THRESHOLDS.mid = mid
  PROFIT_TIER_LABELS.high = `High (≥${PROFIT_THRESHOLDS.high}%)`
  PROFIT_TIER_LABELS.mid = `Mid (${PROFIT_THRESHOLDS.mid}–${PROFIT_THRESHOLDS.high}%)`
  PROFIT_TIER_LABELS.low = `Low (<${PROFIT_THRESHOLDS.mid}%)`
}

export function profitTier(pct: number | null | undefined): ProfitTier | null {
  if (pct == null) return null
  if (pct >= PROFIT_THRESHOLDS.high) return 'high'
  if (pct >= PROFIT_THRESHOLDS.mid) return 'mid'
  return 'low'
}

export function profitColorClass(pct: number | null | undefined): string {
  const t = profitTier(pct)
  if (t === 'high') return 'text-green-600 dark:text-green-400'
  if (t === 'mid') return 'text-amber-600 dark:text-amber-400'
  if (t === 'low') return 'text-destructive'
  return ''
}

// Hex codes for Recharts / SVG — matches the Tailwind classes above.
export const PROFIT_COLOR_HEX = {
  high: '#22c55e',   // green-500
  mid: '#eab308',    // yellow-500
  low: '#ef4444',    // red-500
} as const

// Labels for chart legends, rendered consistently everywhere.
// Mutable (updated by configureProfitThresholds when thresholds are hydrated).
export const PROFIT_TIER_LABELS = {
  high: `High (≥${PROFIT_THRESHOLDS.high}%)`,
  mid: `Mid (${PROFIT_THRESHOLDS.mid}–${PROFIT_THRESHOLDS.high}%)`,
  low: `Low (<${PROFIT_THRESHOLDS.mid}%)`,
}
