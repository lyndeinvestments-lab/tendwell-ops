import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  addDays, addMonths, computePropertyEconomics, monthEnd, monthOf,
  type EconCleanDay, type EconLine, type EconProperty, type EconQboMonth, type EconResult, type EconWeighIn,
} from '@/lib/financials/property-economics'

// Inputs for the Per-Property tab. Every source is finance-gated; PostgREST
// caps a response at 1,000 rows, so lists page until a short page arrives.

const PAGE = 1000
const MAX_ROWS = 60_000
const db = supabase as any

async function fetchAllPages<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export const todayEt = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

export interface InvoiceCoverage {
  from: string | null
  through: string | null
}

/** First and last day covered by approved/exported Busy Bee invoices. */
export function useInvoiceCoverage() {
  return useQuery<InvoiceCoverage>({
    queryKey: ['/property-economics/coverage'],
    queryFn: async () => {
      const [first, last] = await Promise.all([
        db.from('financial_invoice_lines').select('period_start').not('period_start', 'is', null).order('period_start', { ascending: true }).limit(1),
        db.from('financial_invoice_lines').select('period_end').not('period_end', 'is', null).order('period_end', { ascending: false }).limit(1),
      ])
      if (first.error) throw new Error(first.error.message)
      if (last.error) throw new Error(last.error.message)
      return { from: first.data?.[0]?.period_start ?? null, through: last.data?.[0]?.period_end ?? null }
    },
    staleTime: 5 * 60 * 1000,
  })
}

export interface EconomicsData extends EconResult {
  start: string
  end: string
  today: string
  coverage: InvoiceCoverage
}

export function usePropertyEconomics(start: string | null, end: string | null, coverage: InvoiceCoverage | undefined) {
  return useQuery<EconomicsData>({
    queryKey: ['/property-economics', start, end, coverage?.from, coverage?.through],
    enabled: !!start && !!end && !!coverage,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const today = todayEt()
      const s = start!
      const e = end! > today ? today : end!
      const from = [monthOf(s), addDays(s, -6)].sort()[0]
      const through = monthEnd(monthOf(e)) < today ? monthEnd(monthOf(e)) : today
      const linesThrough = addDays(monthEnd(monthOf(e)), 6)

      const [props, days, lines, qbo, weigh] = await Promise.all([
        fetchAllPages<any>((a, b) => db.from('properties')
          .select('id, name, ce_charged, deep_clean_3x_ce, cleaner_pay, est_laundry, est_consumables, pipeline_stages!properties_stage_id_fkey(name)')
          .is('deleted_at', null)
          .order('id')
          .range(a, b)),
        fetchAllPages<EconCleanDay>((a, b) => db.from('financial_clean_days')
          .select('property_id, d, deep, source')
          .gte('d', from)
          .lte('d', through)
          .order('d')
          .order('property_id')
          .range(a, b)),
        fetchAllPages<EconLine & { id: string }>((a, b) => db.from('financial_invoice_lines')
          .select('id, property_id, line_kind, service_type, description, work_date, cleaner_pay_amount, client_charge_amount')
          .gte('work_date', from)
          .lte('work_date', linesThrough)
          .order('work_date')
          .order('id')
          .range(a, b)),
        db.from('qbo_pl_months')
          .select('month, total_income, total_expenses, cogs_breakdown, expense_breakdown')
          .gte('month', addMonths(monthOf(s), -3))
          .lte('month', monthOf(e)),
        fetchAllPages<{ submitted_at: string; pounds: number }>((a, b) => db.from('laundry_weigh_ins')
          .select('submitted_at, pounds')
          .eq('laundry_type', 'dirty')
          .gte('submitted_at', addDays(monthOf(s), -1))
          .lt('submitted_at', addDays(through, 2))
          .order('submitted_at')
          .range(a, b)),
      ])
      if (qbo.error) throw new Error(qbo.error.message)

      const properties: EconProperty[] = props.map(p => ({
        id: p.id,
        name: p.name,
        stage: p.pipeline_stages?.name ?? null,
        ce_charged: p.ce_charged == null ? null : Number(p.ce_charged),
        deep_clean_3x_ce: p.deep_clean_3x_ce == null ? null : Number(p.deep_clean_3x_ce),
        cleaner_pay: p.cleaner_pay == null ? null : Number(p.cleaner_pay),
        est_laundry: p.est_laundry == null ? null : Number(p.est_laundry),
        est_consumables: p.est_consumables == null ? null : Number(p.est_consumables),
      }))
      const weighIns: EconWeighIn[] = weigh.map(w => ({
        d: new Date(w.submitted_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
        pounds: Number(w.pounds) || 0,
      }))
      const result = computePropertyEconomics({
        start: s,
        end: e,
        today,
        properties,
        cleanDays: days.map(d => ({ ...d, d: String(d.d).slice(0, 10) })),
        lines: lines.map(l => ({
          ...l,
          work_date: String(l.work_date).slice(0, 10),
          cleaner_pay_amount: Number(l.cleaner_pay_amount) || 0,
          client_charge_amount: Number(l.client_charge_amount) || 0,
        })),
        invoicedFrom: coverage!.from,
        invoicedThrough: coverage!.through,
        qbo: ((qbo.data ?? []) as EconQboMonth[]).map(q => ({
          ...q,
          month: String(q.month).slice(0, 10),
          total_income: Number(q.total_income) || 0,
          total_expenses: Number(q.total_expenses) || 0,
        })),
        weighIns,
      })
      return { ...result, start: s, end: e, today, coverage: coverage! }
    },
  })
}
