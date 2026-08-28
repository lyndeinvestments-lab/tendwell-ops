import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { getFreshQboTokens, getSupabaseConfig, qboApiBase, requireAdminBearer } from '../qbo/_lib.js'
import { moneyColumns, sectionTotals, accountRows, columnMonth, type QboReport } from '../qbo/_pl-parse.js'

// GET /api/cron/qbo-pl-sync
//
// Nightly QBO Profit & Loss snapshot (04:45 UTC, after the 04:15 classes
// sync so class names are current), also runnable on demand with an admin
// bearer (the Pro Forma page's Refresh button).
//
// Writes two tables:
//  - qbo_pl_months:       company P&L per month, trailing 15 months — ONE
//    ProfitAndLoss report call summarized by Month, including per-month
//    account breakdowns for income/COGS/expenses.
//  - qbo_class_pl_months: P&L per QBO Class per month — one report call per
//    month summarized by Classes. Classes ≈ properties (invoices imported
//    from Tendwell carry a per-property Class), so this is the per-property
//    revenue actual straight from QuickBooks.
//
// Replaces the app_settings.qbo_pl_data blob as the source of truth: that
// blob had no writer in this repo (a cloud routine refreshed it) and its
// free-form month keys ("Aug 1-28 2026") broke the client parser.

const MONTHS_BACK = 15

function monthStart(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function addMonths(iso: string, n: number): Date {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1))
}

function lastDayOfMonth(iso: string): string {
  const d = addMonths(iso, 1)
  d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.authorization
  const headerSecret = (req.headers['x-cron-secret'] as string | undefined) ?? ''
  const cronOk = !!cronSecret && (authHeader === `Bearer ${cronSecret}` || headerSecret === cronSecret)
  if (!cronOk) {
    const admin = await requireAdminBearer(req, res)
    if (!admin) return
  }

  let sb
  try {
    const cfg = getSupabaseConfig()
    sb = createClient(cfg.url, cfg.serviceKey)
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  try {
    const tokens = await getFreshQboTokens(sb)
    if (!tokens) return res.status(400).json({ error: 'QuickBooks not connected', needsAuth: true })

    const env = process.env.QBO_ENVIRONMENT || 'sandbox'
    const base = qboApiBase(env)
    const realmId = tokens.realm_id || process.env.QBO_REALM_ID
    const headers = { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' }

    const today = new Date()
    const startIso = monthStart(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (MONTHS_BACK - 1), 1)))
    const endIso = today.toISOString().slice(0, 10)

    const report = async (params: Record<string, string>): Promise<QboReport> => {
      const qs = new URLSearchParams({ accounting_method: 'Accrual', minorversion: '65', ...params }).toString()
      const r = await fetch(`${base}/v3/company/${realmId}/reports/ProfitAndLoss?${qs}`, { headers })
      if (!r.ok) throw new Error(`QBO P&L report failed (${r.status}): ${(await r.text()).slice(0, 300)}`)
      return (await r.json()) as QboReport
    }

    // ── Company P&L by month (one call) ─────────────────────────────────
    const byMonth = await report({ start_date: startIso, end_date: endIso, summarize_column_by: 'Month' })
    const cols = moneyColumns(byMonth)
    const income = sectionTotals(byMonth, 'Income') ?? []
    const cogs = sectionTotals(byMonth, 'COGS') ?? []
    const gross = sectionTotals(byMonth, 'GrossProfit') ?? []
    const expenses = sectionTotals(byMonth, 'Expenses') ?? []
    const net = sectionTotals(byMonth, 'NetIncome') ?? []
    const incomeAccounts = accountRows(byMonth, 'Income')
    const cogsAccounts = accountRows(byMonth, 'COGS')
    const expenseAccounts = accountRows(byMonth, 'Expenses')

    const nowIso = new Date().toISOString()
    const breakdownAt = (accounts: Array<{ name: string; values: number[] }>, i: number) =>
      Object.fromEntries(accounts.filter(a => (a.values[i] ?? 0) !== 0).map(a => [a.name, a.values[i]]))

    const monthRows = cols
      .map((c, i) => ({ month: columnMonth(c), i }))
      .filter((x): x is { month: string; i: number } => x.month != null)
      .map(({ month, i }) => ({
        month,
        total_income: income[i] ?? 0,
        total_cogs: cogs[i] ?? 0,
        gross_profit: gross[i] ?? ((income[i] ?? 0) - (cogs[i] ?? 0)),
        total_expenses: expenses[i] ?? 0,
        net_income: net[i] ?? 0,
        income_breakdown: breakdownAt(incomeAccounts, i),
        cogs_breakdown: breakdownAt(cogsAccounts, i),
        expense_breakdown: breakdownAt(expenseAccounts, i),
        synced_at: nowIso,
      }))

    if (monthRows.length === 0) {
      return res.status(502).json({ error: 'QBO P&L returned no month columns — nothing written' })
    }
    const { error: plErr } = await sb.from('qbo_pl_months').upsert(monthRows, { onConflict: 'month' })
    if (plErr) return res.status(500).json({ error: `qbo_pl_months upsert failed: ${plErr.message}` })

    // ── P&L by class, one call per month ────────────────────────────────
    // Class column ids come back in ColKey metadata; fall back to name
    // lookup against qbo_classes when absent. QBO's "Not Specified" column
    // is kept under a sentinel id so unclassified income stays visible.
    const { data: classList } = await sb.from('qbo_classes').select('qbo_id, name')
    const idByName = new Map<string, string>((classList ?? []).map((c: { qbo_id: string; name: string }) => [c.name.toLowerCase(), c.qbo_id]))

    let classMonths = 0
    let classRows = 0
    const classErrors: string[] = []
    for (const { month } of monthRows) {
      try {
        const rep = await report({ start_date: month, end_date: lastDayOfMonth(month), summarize_column_by: 'Classes' })
        const ccols = moneyColumns(rep)
        const cIncome = sectionTotals(rep, 'Income') ?? []
        const cCogs = sectionTotals(rep, 'COGS') ?? []
        const cExp = sectionTotals(rep, 'Expenses') ?? []
        const cNet = sectionTotals(rep, 'NetIncome') ?? []
        const rows = ccols
          // Skip the report's trailing "Total" rollup column
          .filter(c => c.title.toLowerCase() !== 'total')
          .map((c, _idx) => {
            const i = ccols.indexOf(c)
            const isUnspecified = /not specified/i.test(c.title)
            const qboClassId = isUnspecified
              ? '__unspecified'
              : (c.colKey || idByName.get(c.title.toLowerCase()) || `name:${c.title}`)
            return {
              month,
              qbo_class_id: qboClassId,
              class_name: c.title,
              income: cIncome[i] ?? 0,
              cogs: cCogs[i] ?? 0,
              expenses: cExp[i] ?? 0,
              net_income: cNet[i] ?? 0,
              synced_at: nowIso,
            }
          })
          .filter(r => r.income !== 0 || r.cogs !== 0 || r.expenses !== 0 || r.net_income !== 0)

        // Replace the month wholesale so classes that dropped to zero disappear.
        const { error: delErr } = await sb.from('qbo_class_pl_months').delete().eq('month', month)
        if (delErr) throw new Error(delErr.message)
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await sb.from('qbo_class_pl_months').insert(rows.slice(i, i + 500))
          if (error) throw new Error(error.message)
        }
        classMonths++
        classRows += rows.length
      } catch (e: any) {
        classErrors.push(`${month}: ${String(e?.message ?? e).slice(0, 120)}`)
      }
    }

    return res.json({
      ok: true,
      months: monthRows.length,
      range: [startIso, endIso],
      class_months: classMonths,
      class_rows: classRows,
      ...(classErrors.length ? { class_errors: classErrors } : {}),
    })
  } catch (err: any) {
    console.error('QBO P&L SYNC FAILED:', err?.message || err)
    const needsAuth = String(err?.message ?? '').includes('reconnect')
    return res.status(needsAuth ? 400 : 500).json({ ok: false, error: err?.message || String(err), ...(needsAuth ? { needsAuth: true } : {}) })
  }
}

export const config = { runtime: 'nodejs' }
