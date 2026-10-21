import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { parseQboMonthly } from '@/lib/financials/qbo'
import { buildMonthlySeries, type MonthRow } from '@/lib/financials/perClean'

async function authFetch(path: string) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return null
  const r = await fetch(path, { headers: { Authorization: `Bearer ${session.access_token}` } })
  return r.ok ? r.json() : null
}

type QboSeries = { series: MonthRow[]; qboUpdatedAt: string | null; qboConnected: boolean }

async function fetchQboSeries(): Promise<QboSeries> {
  const [cleansRes, plRes, qboRes] = await Promise.all([
    supabase.from('financial_monthly_cleans').select('month, cleans'),
    (supabase as any).from('qbo_pl_months').select('month, total_income, total_cogs, total_expenses, net_income, synced_at').order('month'),
    supabase.from('app_settings').select('value').eq('key', 'qbo_pl_data').single(),
  ])
  const cleans = (cleansRes.data ?? []) as Array<{ month: string; cleans: number }>
  // Primary source: qbo_pl_months (nightly api/cron/qbo-pl-sync). The
  // legacy app_settings.qbo_pl_data blob is only a fallback for the
  // window before the first sync runs.
  const plRows = (plRes.data ?? []) as Array<{ month: string; total_income: number; total_cogs: number; total_expenses: number; net_income: number; synced_at: string }>
  let qbo: { months: ReturnType<typeof parseQboMonthly>['months']; updatedAt: string | null; connected: boolean }
  if (plRows.length > 0) {
    qbo = {
      months: plRows.map(r => {
        const income = Number(r.total_income) || 0
        const totalExpenses = (Number(r.total_cogs) || 0) + (Number(r.total_expenses) || 0)
        const netIncome = Number(r.net_income) || 0
        return { ym: String(r.month).slice(0, 7), income, cogs: Number(r.total_cogs) || 0, expenses: Number(r.total_expenses) || 0, totalExpenses, netIncome, marginPct: income > 0 ? (netIncome / income) * 100 : null }
      }),
      updatedAt: plRows[plRows.length - 1]?.synced_at ?? null,
      connected: true,
    }
  } else {
    const rawQbo = qboRes.data?.value ? (typeof qboRes.data.value === 'string' ? JSON.parse(qboRes.data.value) : qboRes.data.value) : null
    qbo = parseQboMonthly(rawQbo)
  }
  return { series: buildMonthlySeries(qbo.months, cleans, 12), qboUpdatedAt: qbo.updatedAt, qboConnected: qbo.connected }
}

const EMPTY_SERIES: QboSeries = { series: [], qboUpdatedAt: null, qboConnected: false }

// QuickBooks monthly actuals + clean counts only (no Ramp call), for
// surfaces like the Dashboard that just need the headline numbers.
export function useQboSeries(enabled = true) {
  const q = useQuery({
    queryKey: ['/financial-overview/qbo-series'],
    staleTime: 300_000,
    enabled,
    queryFn: fetchQboSeries,
  })
  return { ...(q.data ?? EMPTY_SERIES), isLoading: q.isLoading && enabled, isError: q.isError }
}

export function useFinancialOverview() {
  const q = useQuery({
    queryKey: ['/financial-overview'],
    staleTime: 300_000,
    queryFn: async () => {
      const [qbo, taskRes, ramp] = await Promise.all([
        fetchQboSeries(),
        supabase.from('financial_task_load').select('bucket, tasks'),
        authFetch('/api/ramp/spend?months=12'),
      ])
      const tl = (taskRes.data ?? []) as Array<{ bucket: string; tasks: number }>
      const taskLoad = tl.length ? { overdue: 0, today: 0, week: 0, ...Object.fromEntries(tl.map(r => [r.bucket, Number(r.tasks)])) } as any : null
      return { ...qbo, taskLoad, ramp }
    },
  })
  return { ...(q.data ?? { ...EMPTY_SERIES, taskLoad: null, ramp: null }), isLoading: q.isLoading, isError: q.isError, refetch: q.refetch }
}
