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
