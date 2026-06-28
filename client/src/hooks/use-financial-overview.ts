import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { parseQboMonthly } from '@/lib/financials/qbo'
import { buildMonthlySeries } from '@/lib/financials/perClean'

async function authFetch(path: string) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return null
  const r = await fetch(path, { headers: { Authorization: `Bearer ${session.access_token}` } })
  return r.ok ? r.json() : null
}

export function useFinancialOverview() {
  const q = useQuery({
    queryKey: ['/financial-overview'],
    staleTime: 300_000,
    queryFn: async () => {
      const [cleansRes, qboRes, taskRes, ramp] = await Promise.all([
        supabase.from('financial_monthly_cleans').select('month, cleans'),
        supabase.from('app_settings').select('value').eq('key', 'qbo_pl_data').single(),
        supabase.from('financial_task_load').select('bucket, tasks'),
        authFetch('/api/ramp/spend?months=12'),
      ])
      const cleans = (cleansRes.data ?? []) as Array<{ month: string; cleans: number }>
      const rawQbo = qboRes.data?.value ? (typeof qboRes.data.value === 'string' ? JSON.parse(qboRes.data.value) : qboRes.data.value) : null
      const qbo = parseQboMonthly(rawQbo)
      const series = buildMonthlySeries(qbo.months, cleans, 12)
      const tl = (taskRes.data ?? []) as Array<{ bucket: string; tasks: number }>
      const taskLoad = tl.length ? { overdue: 0, today: 0, week: 0, ...Object.fromEntries(tl.map(r => [r.bucket, Number(r.tasks)])) } as any : null
      return { series, taskLoad, ramp, qboUpdatedAt: qbo.updatedAt, qboConnected: qbo.connected }
    },
  })
  return { ...(q.data ?? { series: [], taskLoad: null, ramp: null, qboUpdatedAt: null, qboConnected: false }), isLoading: q.isLoading, isError: q.isError, refetch: q.refetch }
}
