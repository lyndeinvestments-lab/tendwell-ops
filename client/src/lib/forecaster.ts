// Forecaster + actual proforma engine.
//
// Adapted from tendwellforecaster/app.js + db.js. Same formulas, but typed
// and decoupled from the standalone tool so tendwell-ops can render them with
// the existing shadcn/ui components and pull live actuals from Supabase + QBO.
//
// Categories tracked: Cleaning Fee, Services, Onboarding, Other Income,
// Contractor Pay, Laundry, Leadership, Supplies, Other COGS, OpEx, Inspections,
// Trash. Keep field names stable — they are persisted in proforma_months.

export interface MonthRecord {
  month: string                 // 'YYYY-MM'
  cleaningFee?: number
  services?: number
  onboardingRevenue?: number
  otherIncome?: number
  contractorPay?: number
  laundry?: number
  leadership?: number
  supplies?: number
  inspections?: number
  trash?: number
  otherCOGS?: number
  opex?: number
  tasks?: number
  properties?: number
}

export interface DerivedMonth extends MonthRecord {
  label: string
  revenue: number
  cogs: number
  totalCOGS: number
  grossProfit: number
  grossMargin: number
  netIncome: number
  netMargin: number
}

const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const

export function monthLabel(yyyymm: string): string {
  const [year, month] = yyyymm.split('-').map(Number)
  return MONTH_NAMES_SHORT[month - 1] + ' ' + String(year).slice(2)
}

// COGS = Contractor + Laundry + Leadership + Supplies + Inspections + Trash + Other.
// Inspections + Trash are new in tendwell-ops; the original forecaster lumped
// them into otherCOGS. Existing rows that only have otherCOGS still total
// correctly because we add all categories.
export function computeDerived(m: MonthRecord): DerivedMonth {
  const revenue = (m.cleaningFee || 0) + (m.services || 0) + (m.onboardingRevenue || 0) + (m.otherIncome || 0)
  const totalCOGS = (m.contractorPay || 0) + (m.laundry || 0) + (m.leadership || 0)
    + (m.supplies || 0) + (m.inspections || 0) + (m.trash || 0) + (m.otherCOGS || 0)
  const grossProfit = revenue - totalCOGS
  const netIncome = grossProfit - (m.opex || 0)
  return {
    ...m,
    label: monthLabel(m.month),
    revenue,
    cogs: totalCOGS,
    totalCOGS,
    grossProfit,
    grossMargin: revenue > 0 ? (grossProfit / revenue * 100) : 0,
    netIncome,
    netMargin: revenue > 0 ? (netIncome / revenue * 100) : 0,
  }
}

// Seasonal multipliers for STR / vacation rental cleaning. Carried over verbatim
// from the original forecaster — empirical fit on 2024–2025 Tendwell data.
export const SEASONAL: Record<number, number> = {
  3: 0.70, 4: 0.85, 5: 0.95, 6: 1.05,
  7: 1.15, 8: 1.10, 9: 0.95, 10: 1.20,
 11: 1.15, 12: 1.10, 1: 0.65, 2: 0.65,
}

// Forecast slider presets (current/conservative/aggressive). 'current' is
// replaced at runtime by deriveCurrentPreset() when QBO + clean data load.
export interface ForecastSliders {
  propGrowth: number    // properties added/month
  tasksPerProp: number  // avg cleans per property per month
  revPerTask: number    // $ per cleaning task
  contractorPct: number // contractor pay as % of revenue
  laundryPct: number    // laundry as % of revenue
  leadership: number    // fixed monthly $ leadership cost
  suppliesPct: number   // supplies as % of revenue
  opex: number          // fixed monthly $ operating expense
}

// Fallbacks reflect Jul–Sep 2026 QBO actuals (tasksPerProp deseasonalized).
export const FORECAST_PRESETS: Record<'current' | 'conservative' | 'aggressive', ForecastSliders> = {
  current: { propGrowth: 30, tasksPerProp: 4.2, revPerTask: 230, contractorPct: 62.2, laundryPct: 16.1, leadership: 3282, suppliesPct: 9.7, opex: 3990 },
  conservative: { propGrowth: 15, tasksPerProp: 3.8, revPerTask: 215, contractorPct: 64, laundryPct: 17, leadership: 3282, suppliesPct: 10.5, opex: 4500 },
  aggressive: { propGrowth: 40, tasksPerProp: 4.6, revPerTask: 245, contractorPct: 60, laundryPct: 15, leadership: 4500, suppliesPct: 9, opex: 4500 },
}

export const FALLBACK_START_PROPERTIES = 276

function shiftMonth(yyyymm: string, n: number): string {
  const [y, m] = yyyymm.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

const round1 = (n: number) => Math.round(n * 10) / 10

export interface DerivedPreset {
  sliders: ForecastSliders
  /** Full months the financial ratios came from ('YYYY-MM'). */
  sourceMonths: string[]
  /** Properties with cleans in the latest full month, or the fallback. */
  startProperties: number
  /** Latest full month with properties, or null when using the fallback. */
  startMonth: string | null
}

/**
 * The 'current' preset from the last `window` FULL months (month < asOfMonth)
 * of P&L actuals. Ratios are summed over the window (not averaged per month).
 * Per-clean stats use only months that have clean / property counts. With
 * `seasonal`, tasksPerProp is divided by the source months' average SEASONAL
 * multiplier because generateForecast applies the multipliers again.
 * Anything without data keeps the FORECAST_PRESETS.current fallback.
 */
export function deriveCurrentPreset(
  months: MonthRecord[],
  opts: { asOfMonth: string; window?: number; seasonal?: boolean },
): DerivedPreset {
  const window = opts.window ?? 3
  const seasonal = opts.seasonal ?? true
  const fb = FORECAST_PRESETS.current
  const full = months
    .filter(m => m.month < opts.asOfMonth)
    .sort((a, b) => a.month.localeCompare(b.month))
  const withIncome = full.filter(m => computeDerived(m).revenue > 0)
  const src = withIncome.slice(-window)

  const sliders: ForecastSliders = { ...fb }
  if (src.length > 0) {
    const sum = (f: (m: MonthRecord) => number) => src.reduce((s, m) => s + f(m), 0)
    const revenue = sum(m => computeDerived(m).revenue)
    sliders.contractorPct = round1(sum(m => m.contractorPay || 0) / revenue * 100)
    sliders.laundryPct = round1(sum(m => m.laundry || 0) / revenue * 100)
    sliders.suppliesPct = round1(sum(m => m.supplies || 0) / revenue * 100)
    sliders.leadership = Math.round(sum(m => m.leadership || 0) / src.length)
    sliders.opex = Math.round(sum(m => m.opex || 0) / src.length)

    const counted = src.filter(m => (m.tasks ?? 0) > 0)
    if (counted.length > 0) {
      const rev = counted.reduce((s, m) => s + computeDerived(m).revenue, 0)
      const tasks = counted.reduce((s, m) => s + (m.tasks || 0), 0)
      sliders.revPerTask = Math.round(rev / tasks)
    }
    const perProp = src.filter(m => (m.tasks ?? 0) > 0 && (m.properties ?? 0) > 0)
    if (perProp.length > 0) {
      const tasks = perProp.reduce((s, m) => s + (m.tasks || 0), 0)
      const props = perProp.reduce((s, m) => s + (m.properties || 0), 0)
      const mult = seasonal
        ? perProp.reduce((s, m) => s + (SEASONAL[Number(m.month.slice(5, 7))] ?? 1), 0) / perProp.length
        : 1
      sliders.tasksPerProp = round1(tasks / props / mult)
    }
  }

  // Growth over the window plus one prior month (window intervals).
  const withProps = full.filter(m => (m.properties ?? 0) > 0).slice(-(window + 1))
  const last = withProps[withProps.length - 1]
  if (withProps.length >= 2) {
    const first = withProps[0]
    const span = monthsBetween(first.month, last.month)
    if (span > 0) sliders.propGrowth = Math.round(((last.properties || 0) - (first.properties || 0)) / span)
  }

  return {
    sliders,
    sourceMonths: src.map(m => m.month),
    startProperties: last?.properties ?? FALLBACK_START_PROPERTIES,
    startMonth: last?.month ?? null,
  }
}

/**
 * The earliest month of a clean-count view built on a rolling
 * `current_date - interval '1 year'` window starts mid-month. Returns that
 * month when `months` begins exactly there (and today is not the 1st), else
 * null; a month-aligned view never matches.
 */
export function partialWindowMonth(months: string[], today: Date): string | null {
  if (months.length === 0 || today.getDate() === 1) return null
  const earliest = [...months].sort()[0]
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  return earliest === shiftMonth(thisMonth, -12) ? earliest : null
}

export interface ForecastMonth {
  month: string
  label: string
  year: number
  monthNum: number
  properties: number
  tasks: number
  revenue: number
  contractorPay: number
  laundry: number
  supplies: number
  leadership: number
  cogs: number
  grossProfit: number
  grossMargin: number
  opex: number
  netIncome: number
  netMargin: number
}

export function generateForecast(
  v: ForecastSliders,
  options: { startProperties: number; startMonth: string; horizon?: number; seasonal?: boolean } = {
    startProperties: FALLBACK_START_PROPERTIES,
    startMonth: new Date().toISOString().slice(0, 7),
  }
): ForecastMonth[] {
  const horizon = options.horizon ?? 12
  const seasonal = options.seasonal ?? true
  const [sy, sm] = options.startMonth.split('-').map(Number)

  const months: ForecastMonth[] = []
  let currentProps = options.startProperties

  for (let i = 0; i < horizon; i++) {
    const monthNum = ((sm - 1 + i) % 12) + 1
    const year = sy + Math.floor((sm - 1 + i) / 12)
    const label = MONTH_NAMES_SHORT[monthNum - 1] + ' ' + String(year).slice(2)

    currentProps += v.propGrowth
    const props = Math.round(currentProps)

    let baseTasks = props * v.tasksPerProp
    if (seasonal) baseTasks *= SEASONAL[monthNum] ?? 1
    const tasks = Math.round(baseTasks)

    const revenue = tasks * v.revPerTask
    const contractorPay = revenue * (v.contractorPct / 100)
    const laundry = revenue * (v.laundryPct / 100)
    const supplies = revenue * (v.suppliesPct / 100)
    const leadership = v.leadership
    const cogs = contractorPay + laundry + supplies + leadership

    const grossProfit = revenue - cogs
    const grossMargin = revenue > 0 ? (grossProfit / revenue * 100) : 0
    const opex = v.opex
    const netIncome = grossProfit - opex
    const netMargin = revenue > 0 ? (netIncome / revenue * 100) : 0

    months.push({
      month: `${year}-${String(monthNum).padStart(2,'0')}`,
      label, year, monthNum,
      properties: props, tasks, revenue,
      contractorPay, laundry, supplies, leadership,
      cogs, grossProfit, grossMargin, opex, netIncome, netMargin,
    })
  }
  return months
}

// ── Variance helpers ─────────────────────────
//
// Per-category variance vs the estimated cost (rolled up from per-property
// estimates in cost-tracking — laundry, supplies, inspection, trash). Returns
// percent variance + favorable/unfavorable so the UI can label rows in green
// or red.

export interface CategoryEstimate {
  category: string
  estimated: number | null  // null = no estimate formula (actual-only row)
  actual: number
}

export interface CategoryVariance extends CategoryEstimate {
  variance: number | null    // actual - estimated (positive = over-spent)
  variancePct: number | null // variance / estimated × 100; null-safe
  favorable: boolean | null  // true when actual ≤ estimated
}

export function computeVariance(rows: CategoryEstimate[]): CategoryVariance[] {
  return rows.map(r => {
    if (r.estimated == null) return { ...r, variance: null, variancePct: null, favorable: null }
    const variance = r.actual - r.estimated
    const variancePct = r.estimated > 0 ? (variance / r.estimated) * 100 : 0
    return { ...r, variance, variancePct, favorable: variance <= 0 }
  })
}

export type EstimateRollup = ReturnType<typeof rollupEstimates>

/** Scale every estimate category by `factor` (clamped to 0–1). */
export function prorateEstimates(e: EstimateRollup, factor: number): EstimateRollup {
  const f = Number.isFinite(factor) ? Math.min(Math.max(factor, 0), 1) : 1
  return {
    laundry: e.laundry * f,
    supplies: e.supplies * f,
    inspections: e.inspections * f,
    trash: e.trash * f,
    contractorPay: e.contractorPay * f,
    revenue: e.revenue * f,
  }
}

// Roll up per-property cost-tracking estimates into expected category totals
// for a given month. A property's per-clean estimate × number of cleans (tasks)
// in the period gives the expected cost.
//
// `tasksByProperty` is a map of property_id → number of tasks (regular + deep)
// in the period; `deepByProperty` is the deep-clean subset, priced like
// compute_monthly_estimate: deep_clean_3x_ce, else 3 × ce_charged.
// Properties without tasks contribute 0.
export interface PropertyCostRow {
  id: string | number
  est_laundry?: number | null
  est_consumables?: number | null
  inspection_cost?: number | null
  trash_cost?: number | null
  cleaner_pay?: number | null
  ce_charged?: number | null
  deep_clean_3x_ce?: number | null
}

export function rollupEstimates(
  properties: PropertyCostRow[],
  tasksByProperty: Record<string, number>,
  deepByProperty: Record<string, number> = {},
): { laundry: number; supplies: number; inspections: number; trash: number; contractorPay: number; revenue: number } {
  let laundry = 0, supplies = 0, inspections = 0, trash = 0, contractorPay = 0, revenue = 0
  for (const p of properties) {
    const n = tasksByProperty[String(p.id)] ?? 0
    if (n === 0) continue
    const deep = Math.min(deepByProperty[String(p.id)] ?? 0, n)
    const ce = p.ce_charged || 0
    laundry += (p.est_laundry || 0) * n
    supplies += (p.est_consumables || 0) * n
    inspections += (p.inspection_cost || 0) * n
    trash += (p.trash_cost || 0) * n
    contractorPay += (p.cleaner_pay || 0) * n
    revenue += ce * (n - deep) + (p.deep_clean_3x_ce ?? ce * 3) * deep
  }
  return { laundry, supplies, inspections, trash, contractorPay, revenue }
}

export function safeDivide(num: number, den: number, fallback = 0): number {
  return den !== 0 && Number.isFinite(num) && Number.isFinite(den) ? num / den : fallback
}
