import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// GET /api/cron/reconcile-snapshots
//
// Vercel cron entrypoint for the monthly_financial_snapshot variance ledger.
// Runs daily and re-reconciles the trailing 13 months + current + next month
// against the live data sources (breezeway_tasks, proforma_months,
// app_settings.qbo_pl_data). Idempotent — safe to retry.
//
// Estimate side updates as breezeway tasks get scheduled / completed.
// Actuals side updates when proforma_months gets edited or when a new QBO
// nightly import lands. Variance is recomputed on every reconcile.
//
// Auth: Vercel cron sets `Authorization: Bearer ${CRON_SECRET}`. We accept
// either that or an `x-cron-secret` header (manual triggers from CI/local).

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    res.status(500).json({ error: 'CRON_SECRET not configured' })
    return
  }
  const authHeader = req.headers.authorization
  const headerSecret = (req.headers['x-cron-secret'] as string | undefined) ?? ''
  const ok = authHeader === `Bearer ${cronSecret}` || headerSecret === cronSecret
  if (!ok) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return
  }

  const supabase = createClient(url, key)
  const monthsBack = (() => {
    const raw = typeof req.query.months_back === 'string' ? req.query.months_back : ''
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n >= 1 && n <= 60 ? n : 13
  })()

  const startedAt = new Date().toISOString()
  const { data, error } = await supabase.rpc('reconcile_recent_snapshots', { months_back: monthsBack })

  if (error) {
    res.status(500).json({
      error: 'reconcile_recent_snapshots failed',
      detail: error.message,
      started_at: startedAt,
    })
    return
  }

  const rows = (data ?? []) as Array<{
    month: string
    has_estimate: boolean
    has_actual: boolean
    actual_source: string | null
  }>
  const summary = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    months_back: monthsBack,
    months_reconciled: rows.length,
    months_with_estimate: rows.filter(r => r.has_estimate).length,
    months_with_actual:   rows.filter(r => r.has_actual).length,
    months_proforma_actuals: rows.filter(r => r.actual_source === 'proforma').length,
    months_qbo_actuals:      rows.filter(r => r.actual_source === 'qbo').length,
    months_no_actuals:       rows.filter(r => !r.has_actual).length,
    rows,
  }
  res.status(200).json({ ok: true, ...summary })
}
