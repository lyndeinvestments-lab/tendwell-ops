// Client side of the in-app billing alerts: the response of
// GET /api/invoices/billing-alerts (computed by api/invoices/_billing-alerts.ts)
// turned into rows for useAlerts(), so they reuse the Alerts page, the bell
// badge, the dashboard and alert_dismissals instead of a parallel system.
// In-app only: nothing here sends a message.

import { fmtCurrency } from '@/lib/financials/format'

export interface BillingAlertsResponse {
  today: string
  thresholds: { uninvoiced_after_days: number; uninvoiced_lookback_days: number; unpaid_after_days: number }
  uninvoiced_total: number
  uninvoiced_groups: Array<{
    contactId: string | null
    clientName: string | null
    count: number
    oldestDate: string
    properties: Array<{ propertyId: number; propertyName: string; count: number; oldestDate: string }>
  }>
  unpaid_invoices: Array<{
    runId: string
    sentDate: string
    daysOutstanding: number
    qboInvoiceNos: number[]
    vendorName: string | null
    periodStart: string | null
    periodEnd: string | null
    clientTotal: number | null
  }>
  /** false until invoice_runs.paid_at exists (20261009g_billing_alerts.sql). */
  payment_tracking: boolean
}

/** Same shape as the Alert rows built in useAlerts(). */
export interface BillingAlert {
  id: string
  severity: 'critical' | 'warning' | 'info'
  category: 'Billing'
  title: string
  description: string
  actionRoute: string
  propertyId?: string
  requiredView: string
}

/** PostgREST "column/table does not exist": invoice_runs.paid_at before
 *  20261009g_billing_alerts.sql is applied. Mirrors isMissingSchemaError in
 *  api/invoices/_billing-alerts.ts. */
export function isMissingColumnError(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(String(err.code ?? ''))
    || /column .* does not exist|could not find the .* column/i.test(err.message ?? '')
}

/** Unpaid this long turns the alert from warning to critical. */
export const UNPAID_CRITICAL_DAYS = 60
/** How many properties to name in an uninvoiced-cleans description. */
const MAX_NAMED_PROPERTIES = 3

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function billingAlerts(r: BillingAlertsResponse): BillingAlert[] {
  const out: BillingAlert[] = []
  const after = r.thresholds?.uninvoiced_after_days ?? 7

  for (const g of r.uninvoiced_groups ?? []) {
    const named = g.properties.slice(0, MAX_NAMED_PROPERTIES).map(p => `${p.propertyName} (${p.count})`)
    const more = g.properties.length - named.length
    out.push({
      // Keyed on the oldest clean: dismissing hides this backlog, and the
      // alert comes back once those cleans are billed and a newer one ages in.
      id: `uninvoiced_cleans_${g.contactId ?? 'none'}_${g.oldestDate}`,
      severity: 'warning',
      category: 'Billing',
      title: `Cleans not invoiced: ${g.clientName || 'No client set'}`,
      description:
        `${plural(g.count, 'completed clean', 'completed cleans')} over ${after} days old not on any invoice, oldest ${g.oldestDate}. `
        + named.join(', ')
        + (more > 0 ? `, +${more} more` : ''),
      actionRoute: '/invoicing',
      propertyId: g.properties.length === 1 ? String(g.properties[0].propertyId) : undefined,
      requiredView: 'invoicing',
    })
  }

  for (const u of r.unpaid_invoices ?? []) {
    const label = u.qboInvoiceNos.length > 0
      ? `QBO #${u.qboInvoiceNos.join(', #')}`
      : `${u.vendorName ?? 'Invoice'} ${u.periodStart ?? '?'} to ${u.periodEnd ?? '?'}`
    out.push({
      id: `invoice_unpaid_${u.runId}`,
      severity: u.daysOutstanding > UNPAID_CRITICAL_DAYS ? 'critical' : 'warning',
      category: 'Billing',
      title: `Invoice unpaid ${u.daysOutstanding} days: ${label}`,
      description:
        `Sent ${u.sentDate}`
        + (u.clientTotal != null ? `, ${fmtCurrency(u.clientTotal)} billed to clients` : '')
        + (r.payment_tracking
          ? '. No payment recorded; mark it paid on the run once it is.'
          : '. Payment tracking is not set up yet, so every exported invoice shows here; dismiss it once paid.'),
      actionRoute: '/invoicing',
      requiredView: 'invoicing',
    })
  }
  return out
}
