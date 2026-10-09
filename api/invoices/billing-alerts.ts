import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requirePermissionBearer } from '../qbo/_lib.js'
import { buildEngineTasks, fetchAllRows, getServiceClient, trellisIdIndex } from './_lib.js'
import {
  findUnpaidInvoices,
  findUninvoicedCleans,
  groupUninvoicedByClient,
  isIsoDate,
  isMissingSchemaError,
  qboNumbersOf,
  shiftIsoDate,
  UNINVOICED_AFTER_DAYS,
  UNINVOICED_LOOKBACK_DAYS,
  UNPAID_AFTER_DAYS,
  type CoverageLine,
  type PropertyInfo,
  type UnpaidRunInput,
} from './_billing-alerts.js'

// GET /api/invoices/billing-alerts[?today=yyyy-mm-dd]
//
// Read-only feed for the two in-app billing alerts (Alerts page + dashboard):
// completed cleans not invoiced after 7 days, and exported invoices unpaid
// after 30 days. Needs the `invoicing` VIEW grant (a finance view, see
// FINANCIAL_VIEWS / staff_has_financial_view), never edit: nothing here
// writes, and nothing here sends a message of any kind.
//
// `today` comes from the browser so the cut-offs follow the user's calendar
// day rather than the server's UTC one.

/** Matched tasks can sit a few days off the line's own date; reading lines a
 *  bit past the task window keeps a matched line from being missed. */
const LINE_WINDOW_PAD_DAYS = 14

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const actor = await requirePermissionBearer(req, res, 'invoicing', 'view')
  if (!actor) return

  const supabase = getServiceClient()
  if (!supabase) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return
  }

  const todayParam = typeof req.query.today === 'string' ? req.query.today : null
  const today = isIsoDate(todayParam) ? todayParam : new Date().toISOString().slice(0, 10)
  const taskStart = shiftIsoDate(today, -UNINVOICED_LOOKBACK_DAYS)
  const taskEnd = shiftIsoDate(today, -(UNINVOICED_AFTER_DAYS + 1))
  const lineStart = shiftIsoDate(taskStart, -LINE_WINDOW_PAD_DAYS)

  try {
    const [propRows, contactRows, bwRows, trellisRows, lineRows] = await Promise.all([
      fetchAllRows<{ id: number; name: string; contact_id: string | null; trellis_id: string | null; archived_at: string | null }>(
        'properties',
        () => supabase
          .from('properties')
          .select('id, name, contact_id, trellis_id, archived_at')
          .is('deleted_at', null)
          .order('id'),
        'id',
      ),
      fetchAllRows<{ id: string; full_name: string | null; company: string | null }>(
        'contacts',
        () => supabase.from('contacts').select('id, full_name, company').order('id'),
        'id',
      ),
      // Same columns and filters as loadEngineContext, so the evidence pool
      // is the one the engine matches invoice lines against.
      fetchAllRows<{
        external_id: string
        property_id: number | null
        due_date: string | null
        task_title: string
        is_clean: boolean
        is_deep_clean: boolean
        raw: Record<string, unknown> | null
        status: string | null
        completed_date: string | null
      }>(
        'breezeway_tasks',
        () => supabase
          .from('breezeway_tasks')
          .select('external_id, property_id, due_date, task_title, is_clean, is_deep_clean, raw, status, completed_date')
          .gte('due_date', taskStart)
          .lte('due_date', taskEnd)
          .order('external_id'),
        'external_id',
      ),
      fetchAllRows<{
        trellis_task_id: string
        trellis_property_id: string | null
        title: string | null
        status: string | null
        scheduled_date: string | null
        completed_at: string | null
      }>(
        'trellis_task_snapshot',
        () => supabase
          .from('trellis_task_snapshot')
          .select('trellis_task_id, trellis_property_id, title, status, scheduled_date, completed_at')
          .or('department_name.ilike.%clean%,department_name.is.null')
          .gte('scheduled_date', taskStart)
          .lte('scheduled_date', taskEnd)
          .order('trellis_task_id'),
        'trellis_task_id',
      ),
      // Every clean line on a live run, whatever its status: a clean sitting
      // on a draft or an in-review run is already on an invoice.
      fetchAllRows<{
        id: string
        property_id: number | null
        service_date: string | null
        raw_date_mentioned: string | null
        matched_task_id: string | null
        line_kind: string | null
        review_status: string | null
        invoice_runs: { status: string; archived_at: string | null } | null
      }>(
        'invoice_lines (coverage)',
        () => supabase
          .from('invoice_lines')
          .select('id, property_id, service_date, raw_date_mentioned, matched_task_id, line_kind, review_status, invoice_runs!inner(status, archived_at)')
          .neq('invoice_runs.status', 'void')
          .is('invoice_runs.archived_at', null)
          .in('line_kind', ['clean', 'combined_split', 'deep_clean'])
          .neq('review_status', 'excluded')
          .or(`raw_date_mentioned.gte.${lineStart},service_date.gte.${lineStart}`)
          .order('id'),
        'id',
      ),
    ])

    const { tasks, trellisTasks } = buildEngineTasks(bwRows, trellisRows, trellisIdIndex(propRows))
    const coverage: CoverageLine[] = lineRows.map(l => ({
      propertyId: l.property_id,
      date: l.service_date ?? l.raw_date_mentioned,
      matchedTaskId: l.matched_task_id,
      lineKind: l.line_kind,
      reviewStatus: l.review_status,
      runStatus: l.invoice_runs?.status ?? null,
      runArchived: l.invoice_runs?.archived_at != null,
    }))
    const uninvoiced = findUninvoicedCleans([...tasks, ...trellisTasks], coverage, today)

    const clientName = new Map(contactRows.map(c => [c.id, c.company || c.full_name || null]))
    const propertyInfo = new Map<number, PropertyInfo>(propRows.map(p => [p.id, {
      name: p.name,
      contactId: p.contact_id,
      clientName: p.contact_id ? clientName.get(p.contact_id) ?? null : null,
    }]))
    const uninvoicedGroups = groupUninvoicedByClient(uninvoiced, propertyInfo)

    const unpaid = await loadUnpaidInvoices(supabase, today)

    res.status(200).json({
      today,
      thresholds: { uninvoiced_after_days: UNINVOICED_AFTER_DAYS, uninvoiced_lookback_days: UNINVOICED_LOOKBACK_DAYS, unpaid_after_days: UNPAID_AFTER_DAYS },
      uninvoiced_total: uninvoiced.length,
      uninvoiced_groups: uninvoicedGroups,
      unpaid_invoices: unpaid.invoices,
      // false until 20261009g_billing_alerts.sql adds invoice_runs.paid_at:
      // until then every exported run reads as unpaid.
      payment_tracking: unpaid.paymentTracking,
    })
  } catch (e) {
    console.error('[billing-alerts]', e)
    res.status(500).json({ error: 'Failed to load billing alerts' })
  }
}

type Supabase = NonNullable<ReturnType<typeof getServiceClient>>

interface RunRow {
  id: string
  status: string
  archived_at: string | null
  paid_at?: string | null
  approved_at: string | null
  created_at: string | null
  period_start: string | null
  period_end: string | null
  qbo_invoice_no: number | null
  qbo_invoice_nos: unknown
  vendors: { name: string } | { name: string }[] | null
}

async function loadUnpaidInvoices(supabase: Supabase, today: string) {
  const baseCols = 'id, status, archived_at, approved_at, created_at, period_start, period_end, qbo_invoice_no, qbo_invoice_nos, vendors(name)'
  const query = (cols: string) => supabase
    .from('invoice_runs')
    .select(cols)
    .eq('status', 'exported')
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(1000)

  // paid_at arrives with 20261009g_billing_alerts.sql. Deployed before that
  // migration, fall back to the columns that exist and treat every exported
  // run as unpaid (the alert can still be dismissed per run).
  let paymentTracking = true
  let { data, error } = await query(`${baseCols}, paid_at`)
  if (error && isMissingSchemaError(error)) {
    paymentTracking = false
    ;({ data, error } = await query(baseCols))
  }
  if (error) throw error
  const runs = (data ?? []) as unknown as RunRow[]

  const inputs: UnpaidRunInput[] = runs.map(r => {
    const v = Array.isArray(r.vendors) ? r.vendors[0] : r.vendors
    return {
      id: r.id,
      status: r.status,
      archivedAt: r.archived_at,
      paidAt: paymentTracking ? r.paid_at ?? null : undefined,
      approvedAt: r.approved_at,
      createdAt: r.created_at,
      qboInvoiceNos: qboNumbersOf(r.qbo_invoice_no, r.qbo_invoice_nos),
      vendorName: v?.name ?? null,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      clientTotal: null,
    }
  })

  // Totals only for runs already past the cut-off (a handful), so a run with
  // nothing to collect drops out and the alert can show what is owed.
  const overdueIds = new Set(findUnpaidInvoices(inputs, today).map(u => u.runId))
  if (overdueIds.size > 0) {
    const lines = await fetchAllRows<{ id: string; run_id: string; client_charge_amount: number | string | null; review_status: string | null }>(
      'invoice_lines (client totals)',
      () => supabase
        .from('invoice_lines')
        .select('id, run_id, client_charge_amount, review_status')
        .in('run_id', [...overdueIds])
        .order('id'),
      'id',
    )
    const totals = new Map<string, number>()
    for (const l of lines) {
      if (l.review_status === 'excluded') continue
      const n = Number(l.client_charge_amount ?? 0)
      if (!Number.isFinite(n)) continue
      totals.set(l.run_id, (totals.get(l.run_id) ?? 0) + n)
    }
    for (const r of inputs) {
      if (overdueIds.has(r.id)) r.clientTotal = Math.round((totals.get(r.id) ?? 0) * 100) / 100
    }
  }

  return { invoices: findUnpaidInvoices(inputs, today), paymentTracking }
}
