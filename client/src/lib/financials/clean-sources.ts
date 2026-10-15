// Pure helpers for the Trellis-first financial pages (WS5, 2026-10-14).
//
// Clean counts come from the database views (financial_monthly_cleans,
// property_monthly_cleans, property_clean_stats, compute_monthly_estimate),
// which switch from the Breezeway archive to Trellis at
// app_settings.clean_source_cutover. Monthly P&L actuals come from
// qbo_pl_months (nightly QBO sync). Nothing here reads a manual upload.

import type { MonthRecord } from '@/lib/forecaster'

/** % of cleans inspected, two decimals; 0 when there were no cleans. */
export function inspectionRatePct(inspections: number, cleans: number): number {
  if (!Number.isFinite(inspections) || !Number.isFinite(cleans) || cleans <= 0) return 0
  return Math.round((inspections / cleans) * 10000) / 100
}

/** 'YYYY-MM-DD' (or longer ISO) -> 'YYYY-MM'. */
export function monthKey(date: string): string {
  return date.slice(0, 7)
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function sumMatching(breakdown: Record<string, unknown> | null | undefined, re: RegExp): number {
  if (!breakdown) return 0
  let total = 0
  for (const [k, v] of Object.entries(breakdown)) if (re.test(k)) total += num(v)
  return total
}

export interface QboPlMonthRow {
  month: string
  total_income: number | string | null
  total_cogs: number | string | null
  total_expenses: number | string | null
  income_breakdown?: Record<string, unknown> | null
  cogs_breakdown?: Record<string, unknown> | null
}

/**
 * Map a qbo_pl_months row onto the Forecaster's category model. Totals are
 * preserved exactly: revenue = total_income, COGS = total_cogs,
 * opex = total_expenses (so net income matches QuickBooks). Accounts that do
 * not match a named category land in cleaningFee (income) / otherCOGS (COGS).
 */
export function qboRowToMonthRecord(
  row: QboPlMonthRow,
  tasks?: number,
  properties?: number,
): MonthRecord {
  const income = num(row.total_income)
  const cogs = num(row.total_cogs)
  const inc = row.income_breakdown ?? null
  const cb = row.cogs_breakdown ?? null

  const services = sumMatching(inc, /service/i)
  const onboardingRevenue = sumMatching(inc, /onboard/i)
  const otherIncome = sumMatching(inc, /^(?!.*(service|onboard)).*(other|interest|refund|reimburs|misc)/i)
  const cleaningFee = income - services - onboardingRevenue - otherIncome

  const contractorPay = sumMatching(cb, /contractor/i)
  const laundry = sumMatching(cb, /laundry|linen/i)
  const leadership = sumMatching(cb, /leadership/i)
  const supplies = sumMatching(cb, /suppl/i)
  const inspections = sumMatching(cb, /inspect/i)
  const trash = sumMatching(cb, /trash/i)
  const otherCOGS = cogs - contractorPay - laundry - leadership - supplies - inspections - trash

  return {
    month: monthKey(row.month),
    cleaningFee, services, onboardingRevenue, otherIncome,
    contractorPay, laundry, leadership, supplies, inspections, trash, otherCOGS,
    opex: num(row.total_expenses),
    tasks,
    properties,
  }
}

/** Distinct properties with at least one clean, per 'YYYY-MM'. */
export function propertiesPerMonth(
  rows: Array<{ property_id: number | string; month: string; cleans: number | string | null }>,
): Map<string, number> {
  const sets = new Map<string, Set<string>>()
  for (const r of rows) {
    if (num(r.cleans) <= 0) continue
    const k = monthKey(r.month)
    if (!sets.has(k)) sets.set(k, new Set())
    sets.get(k)!.add(String(r.property_id))
  }
  const out = new Map<string, number>()
  for (const [k, s] of Array.from(sets.entries())) out.set(k, s.size)
  return out
}

/** Total property-day cleans per 'YYYY-MM' (property_monthly_cleans rows). */
export function cleansPerMonth(
  rows: Array<{ month: string; cleans: number | string | null }>,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    const n = num(r.cleans)
    if (n <= 0) continue
    const k = monthKey(r.month)
    out.set(k, (out.get(k) ?? 0) + n)
  }
  return out
}

export interface EstimatePerProperty {
  property_id: number | string | null
  cleans?: number | string | null
  deep_cleans?: number | string | null
}

/**
 * compute_monthly_estimate(...).per_property -> cleans per property id (regular
 * + deep), the shape rollupEstimates() expects.
 */
export function cleansByPropertyFromEstimate(
  perProperty: EstimatePerProperty[] | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of perProperty ?? []) {
    if (p.property_id == null) continue
    const n = num(p.cleans) + num(p.deep_cleans)
    if (n <= 0) continue
    const id = String(p.property_id)
    out[id] = (out[id] ?? 0) + n
  }
  return out
}

/** 'YYYY-MM-01' cutover -> 'YYYY-MM', or null for the never-switch sentinel. */
export function cutoverMonth(cutover: string | null | undefined): string | null {
  if (!cutover || !/^\d{4}-\d{2}-\d{2}$/.test(cutover)) return null
  if (cutover.startsWith('9999')) return null
  return cutover.slice(0, 7)
}
