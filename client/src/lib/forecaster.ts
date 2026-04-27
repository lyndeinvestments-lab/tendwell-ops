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

// Forecast slider presets (current/conservative/aggressive), matches the
// original forecaster.
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

export const FORECAST_PRESETS: Record<'current' | 'conservative' | 'aggressive', ForecastSliders> = {
  current: { propGrowth: 5, tasksPerProp: 3, revPerTask: 380, contractorPct: 52, laundryPct: 10, leadership: 3300, suppliesPct: 5, opex: 1200 },
  conservative: { propGrowth: 2, tasksPerProp: 2.5, revPerTask: 350, contractorPct: 55, laundryPct: 12, leadership: 3300, suppliesPct: 6, opex: 1500 },
  aggressive: { propGrowth: 10, tasksPerProp: 4, revPerTask: 400, contractorPct: 48, laundryPct: 8, leadership: 4500, suppliesPct: 4, opex: 1800 },
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
    startProperties: 70,
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
  estimated: number
  actual: number
}

export interface CategoryVariance extends CategoryEstimate {
  variance: number       // actual - estimated (positive = over-spent)
  variancePct: number    // variance / estimated × 100; null-safe
  favorable: boolean     // true when actual ≤ estimated
}

export function computeVariance(rows: CategoryEstimate[]): CategoryVariance[] {
  return rows.map(r => {
    const variance = r.actual - r.estimated
    const variancePct = r.estimated > 0 ? (variance / r.estimated) * 100 : 0
    return { ...r, variance, variancePct, favorable: variance <= 0 }
  })
}

// Roll up per-property cost-tracking estimates into expected category totals
// for a given month. A property's per-clean estimate × number of cleans (tasks)
// in the period gives the expected cost.
//
// `tasksByProperty` is a map of property_id → number of tasks completed in the
// period. Properties without tasks contribute 0.
export interface PropertyCostRow {
  id: string
  est_laundry?: number | null
  est_consumables?: number | null
  inspection_cost?: number | null
  trash_cost?: number | null
  cleaner_pay?: number | null
  ce_charged?: number | null
}

export function rollupEstimates(
  properties: PropertyCostRow[],
  tasksByProperty: Record<string, number>,
): { laundry: number; supplies: number; inspections: number; trash: number; contractorPay: number; revenue: number } {
  let laundry = 0, supplies = 0, inspections = 0, trash = 0, contractorPay = 0, revenue = 0
  for (const p of properties) {
    const n = tasksByProperty[p.id] ?? 0
    if (n === 0) continue
    laundry += (p.est_laundry || 0) * n
    supplies += (p.est_consumables || 0) * n
    inspections += (p.inspection_cost || 0) * n
    trash += (p.trash_cost || 0) * n
    contractorPay += (p.cleaner_pay || 0) * n
    revenue += (p.ce_charged || 0) * n
  }
  return { laundry, supplies, inspections, trash, contractorPay, revenue }
}

export function safeDivide(num: number, den: number, fallback = 0): number {
  return den !== 0 && Number.isFinite(num) && Number.isFinite(den) ? num / den : fallback
}
