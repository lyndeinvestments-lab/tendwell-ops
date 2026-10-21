// Monthly pace = per-clean economics × cleans per month. Cleans/month come
// from property_clean_stats (last 90 days of real cleans) when the property
// has clean history, else the stored properties.avg_cleans_per_month.
// Shared by Pro Forma > Pricing and Pro Forma > By Client so both tabs
// price the same property the same way.

export interface CleanStatsLike {
  months_with_data: number | string | null
  avg_cleans_per_month: number | string | null
}

export interface ResolvedCleans {
  cleansPerMonth: number | null
  auto: boolean
}

export function resolveCleansPerMonth(
  stats: CleanStatsLike | null | undefined,
  manualCleansPerMonth: number | string | null | undefined,
): ResolvedCleans {
  if (stats && Number(stats.months_with_data) > 0) {
    return { cleansPerMonth: Number(stats.avg_cleans_per_month) || 0, auto: true }
  }
  const manual = manualCleansPerMonth == null ? null : Number(manualCleansPerMonth)
  return { cleansPerMonth: manual != null && Number.isFinite(manual) ? manual : null, auto: false }
}

export interface PerCleanRates {
  ce_charged: number | string | null
  total_estimated_cost: number | string | null
}

export interface MonthlyFigures {
  revenue: number
  cost: number
  profit: number
}

// null when the property has no cleans/month, so callers can show its
// per-clean figures without inventing a monthly number.
export function monthlyFigures(rates: PerCleanRates, cleansPerMonth: number | null): MonthlyFigures | null {
  if (cleansPerMonth == null || cleansPerMonth <= 0) return null
  const revenue = (Number(rates.ce_charged) || 0) * cleansPerMonth
  const cost = (Number(rates.total_estimated_cost) || 0) * cleansPerMonth
  return { revenue, cost, profit: revenue - cost }
}

export interface MonthlyRollup extends MonthlyFigures {
  marginPct: number | null
  included: number
  withoutCleans: number
}

// Margin is revenue-weighted (Σprofit / Σrevenue), not an average of
// per-property percentages.
export function rollupMonthly(rows: Array<MonthlyFigures | null>): MonthlyRollup {
  let revenue = 0
  let cost = 0
  let included = 0
  let withoutCleans = 0
  for (const r of rows) {
    if (!r) { withoutCleans++; continue }
    revenue += r.revenue
    cost += r.cost
    included++
  }
  const profit = revenue - cost
  return { revenue, cost, profit, marginPct: revenue > 0 ? (profit / revenue) * 100 : null, included, withoutCleans }
}
