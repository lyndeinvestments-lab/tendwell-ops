export type QboMonth = {
  ym: string; income: number; cogs: number; expenses: number
  totalExpenses: number; netIncome: number; marginPct: number | null
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function toYm(key: string): string | null {
  const m = key.match(/^([A-Za-z]{3})\s+(\d{4})$/)
  if (!m) return /^\d{4}-\d{2}$/.test(key) ? key : null
  const idx = MONTHS.indexOf(m[1])
  if (idx < 0) return null
  return `${m[2]}-${String(idx + 1).padStart(2, '0')}`
}
export function parseQboMonthly(raw: any): { months: QboMonth[]; updatedAt: string | null; connected: boolean } {
  if (!raw || typeof raw !== 'object' || !raw.monthly) return { months: [], updatedAt: null, connected: false }
  const months: QboMonth[] = []
  for (const [key, v] of Object.entries(raw.monthly as Record<string, any>)) {
    const ym = toYm(key); if (!ym) continue
    const income = Number(v.income ?? v.totalIncome ?? 0)
    const cogs = Number(v.cogs ?? v.totalCOGS ?? 0)
    // Only `expenses` (operating expenses). NOT `totalExpenses` — in QBO that
    // is COGS+opex already summed, which would double-count COGS below.
    const expenses = Number(v.expenses ?? 0)
    const netIncome = Number(v.netIncome ?? income - cogs - expenses)
    months.push({ ym, income, cogs, expenses, totalExpenses: cogs + expenses, netIncome,
      marginPct: income ? (netIncome / income) * 100 : null })
  }
  months.sort((a, b) => a.ym.localeCompare(b.ym))
  return { months, updatedAt: raw.updated_at ?? null, connected: months.length > 0 }
}
