export function fmtCurrency(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}
export function fmtPct(n: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `${n.toFixed(digits)}%`
}
export function fmtDelta(curr: number | null, prev: number | null): { text: string; dir: 'up' | 'down' | 'flat' } {
  if (curr == null || prev == null || prev === 0 || Number.isNaN(curr) || Number.isNaN(prev)) return { text: '—', dir: 'flat' }
  const pct = ((curr - prev) / Math.abs(prev)) * 100
  const dir = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat'
  return { text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, dir }
}
