import type { QboMonth } from './qbo'
export type MonthRow = {
  ym: string; income: number; totalExpenses: number; netIncome: number; marginPct: number | null
  cleans: number; revPerClean: number | null; costPerClean: number | null
}
export function buildMonthlySeries(qbo: QboMonth[], cleans: Array<{ month: string; cleans: number }>, monthsBack = 12): MonthRow[] {
  if (qbo.length === 0) return []
  const cleanMap = new Map(cleans.map(c => [c.month, c.cleans]))
  const qboMap = new Map(qbo.map(q => [q.ym, q]))
  const end = qbo[qbo.length - 1].ym
  const [ey, em] = end.split('-').map(Number)
  const rows: MonthRow[] = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(ey, em - 1 - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const q = qboMap.get(ym)
    const cl = cleanMap.get(ym) ?? 0
    rows.push({
      ym, income: q?.income ?? 0, totalExpenses: q?.totalExpenses ?? 0, netIncome: q?.netIncome ?? 0,
      marginPct: q?.marginPct ?? null, cleans: cl,
      revPerClean: cl > 0 && q ? q.income / cl : null,
      costPerClean: cl > 0 && q ? q.totalExpenses / cl : null,
    })
  }
  return rows
}
export function lastTwo(series: MonthRow[]) {
  return { curr: series[series.length - 1] ?? null, prev: series[series.length - 2] ?? null }
}

// The QBO sync writes the current calendar month as it accrues, so the last
// row is usually a partial month. Month-over-month KPIs must compare the two
// latest COMPLETE months; the partial month is reported on its own.
export function splitLatestMonths(series: MonthRow[], currentYm: string) {
  const partial = series.length > 0 && series[series.length - 1].ym === currentYm ? series[series.length - 1] : null
  const complete = partial ? series.slice(0, -1) : series
  return { ...lastTwo(complete), partial }
}

export type PeriodTotals = {
  months: number; income: number; totalExpenses: number; netIncome: number
  marginPct: number | null; cleans: number; revPerClean: number | null
}
export function sumMonths(rows: MonthRow[]): PeriodTotals {
  const t = rows.reduce(
    (a, r) => ({ income: a.income + r.income, totalExpenses: a.totalExpenses + r.totalExpenses, netIncome: a.netIncome + r.netIncome, cleans: a.cleans + r.cleans }),
    { income: 0, totalExpenses: 0, netIncome: 0, cleans: 0 },
  )
  return {
    months: rows.length,
    ...t,
    marginPct: t.income > 0 ? (t.netIncome / t.income) * 100 : null,
    revPerClean: t.cleans > 0 ? t.income / t.cleans : null,
  }
}
