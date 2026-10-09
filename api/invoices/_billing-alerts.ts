// Pure rules behind the two in-app billing alerts (Alerts page + dashboard):
//
//   1. "Completed cleans not invoiced": a completed clean (the same Breezeway +
//      Trellis evidence pool the invoicing engine matches against, built by
//      buildEngineTasks) more than 7 days old that no line on a live invoice
//      run covers.
//   2. "Invoices unpaid": an exported run more than 30 days past approval with
//      no payment recorded (invoice_runs.paid_at).
//
// No I/O here; api/invoices/billing-alerts.ts loads the rows. These alerts are
// in-app only: nothing in this path sends email, Slack or SMS.

import type { TaskRow } from './_engine.js'

/** A clean is "not invoiced" once it is MORE than this many days old. */
export const UNINVOICED_AFTER_DAYS = 7
/** An exported invoice is "unpaid" once it is MORE than this many days old. */
export const UNPAID_AFTER_DAYS = 30
/** How far back to look for uninvoiced cleans. Invoicing in Ops started in
 *  August 2026 and older cleans were billed by hand, so an unbounded scan
 *  would flag history that was in fact invoiced outside the app. */
export const UNINVOICED_LOOKBACK_DAYS = 45
/** Line kinds that bill a clean, the same set as the engine's billedCleans. */
export const CLEAN_LINE_KINDS: ReadonlySet<string> = new Set(['clean', 'combined_split', 'deep_clean'])

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && ISO_DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
}

/** Whole calendar days from `from` to `to` (both read as dates; time is
 *  dropped). Negative when `from` is after `to`. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

export function shiftIsoDate(d: string, days: number): string {
  const t = Date.parse(`${d.slice(0, 10)}T00:00:00Z`) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

// ─── 1. Completed cleans not invoiced ────────────────────────────────────────

/** One invoice line as it bears on whether a clean was invoiced. */
export interface CoverageLine {
  propertyId: number | null
  /** service_date ?? raw_date_mentioned */
  date: string | null
  matchedTaskId: string | null
  lineKind: string | null
  reviewStatus: string | null
  runStatus: string | null
  runArchived: boolean
}

/** Does this line count as the clean being on an invoice? Only live runs
 *  (not void, not archived), only clean-billing line kinds, and never a line
 *  a human excluded. Drafts and runs still in review DO count: the clean is
 *  on an invoice, it just has not gone out yet. */
export function lineCoversClean(l: CoverageLine): boolean {
  if (l.runArchived) return false
  if (l.runStatus === 'void') return false
  if (l.reviewStatus === 'excluded') return false
  return l.lineKind != null && CLEAN_LINE_KINDS.has(l.lineKind)
}

export interface UninvoicedClean {
  propertyId: number
  date: string
  taskId: string
  source: 'breezeway' | 'trellis'
  title: string
}

/**
 * Completed cleans more than UNINVOICED_AFTER_DAYS old (and within the
 * lookback) that no covering line matches, one per property-day. A line
 * covers a clean when it matched that exact task, or bills the same
 * property on the same day.
 */
export function findUninvoicedCleans(
  tasks: ReadonlyArray<TaskRow>,
  lines: ReadonlyArray<CoverageLine>,
  today: string,
  opts: { afterDays?: number; lookbackDays?: number } = {},
): UninvoicedClean[] {
  const afterDays = opts.afterDays ?? UNINVOICED_AFTER_DAYS
  const lookbackDays = opts.lookbackDays ?? UNINVOICED_LOOKBACK_DAYS

  const coveredTaskIds = new Set<string>()
  const coveredDays = new Set<string>()
  for (const l of lines) {
    if (!lineCoversClean(l)) continue
    if (l.matchedTaskId) coveredTaskIds.add(l.matchedTaskId)
    if (l.propertyId != null && l.date) coveredDays.add(`${l.propertyId}|${l.date.slice(0, 10)}`)
  }

  // Group the day's tasks first: a property-day is covered when ANY of its
  // tasks was matched (a Departure + Deep on one day bill as one line).
  const byDay = new Map<string, TaskRow[]>()
  for (const t of tasks) {
    if (!(t.isClean || t.isDeepClean)) continue
    // Same default as the engine: an absent flag means completed.
    if (t.completed === false) continue
    if (t.propertyId == null || !t.dueDate) continue
    const age = daysBetween(t.dueDate, today)
    if (age <= afterDays || age > lookbackDays) continue
    const key = `${t.propertyId}|${t.dueDate.slice(0, 10)}`
    const arr = byDay.get(key)
    if (arr) arr.push(t)
    else byDay.set(key, [t])
  }

  const out: UninvoicedClean[] = []
  for (const [key, dayTasks] of byDay) {
    if (coveredDays.has(key)) continue
    if (dayTasks.some(t => coveredTaskIds.has(t.externalId))) continue
    // Prefer the Breezeway task as the reference (it wins the day in the engine).
    const ref = [...dayTasks].sort((a, b) =>
      (a.source === 'trellis' ? 1 : 0) - (b.source === 'trellis' ? 1 : 0) || a.externalId.localeCompare(b.externalId),
    )[0]
    out.push({
      propertyId: ref.propertyId!,
      date: ref.dueDate!.slice(0, 10),
      taskId: ref.externalId,
      source: ref.source === 'trellis' ? 'trellis' : 'breezeway',
      title: ref.title,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.propertyId - b.propertyId)
}

export interface PropertyInfo {
  name: string
  contactId: string | null
  clientName: string | null
}

export interface UninvoicedPropertySummary {
  propertyId: number
  propertyName: string
  count: number
  oldestDate: string
}

export interface UninvoicedClientGroup {
  /** null = the properties have no client set */
  contactId: string | null
  clientName: string | null
  count: number
  oldestDate: string
  /** Most uninvoiced cleans first, then oldest first. */
  properties: UninvoicedPropertySummary[]
}

/** Roll uninvoiced cleans up by client, then property. Oldest backlog first. */
export function groupUninvoicedByClient(
  cleans: ReadonlyArray<UninvoicedClean>,
  propertyInfo: ReadonlyMap<number, PropertyInfo>,
): UninvoicedClientGroup[] {
  const groups = new Map<string, { contactId: string | null; clientName: string | null; props: Map<number, UninvoicedPropertySummary> }>()
  for (const c of cleans) {
    const info = propertyInfo.get(c.propertyId)
    const contactId = info?.contactId ?? null
    const key = contactId ?? '__none__'
    let g = groups.get(key)
    if (!g) {
      g = { contactId, clientName: info?.clientName ?? null, props: new Map() }
      groups.set(key, g)
    }
    const p = g.props.get(c.propertyId)
    if (p) {
      p.count++
      if (c.date < p.oldestDate) p.oldestDate = c.date
    } else {
      g.props.set(c.propertyId, {
        propertyId: c.propertyId,
        propertyName: info?.name ?? `Property #${c.propertyId}`,
        count: 1,
        oldestDate: c.date,
      })
    }
  }
  const out: UninvoicedClientGroup[] = []
  for (const g of groups.values()) {
    const properties = [...g.props.values()].sort((a, b) =>
      b.count - a.count || a.oldestDate.localeCompare(b.oldestDate) || a.propertyName.localeCompare(b.propertyName),
    )
    out.push({
      contactId: g.contactId,
      clientName: g.clientName,
      count: properties.reduce((s, p) => s + p.count, 0),
      oldestDate: properties.reduce((m, p) => (p.oldestDate < m ? p.oldestDate : m), properties[0].oldestDate),
      properties,
    })
  }
  return out.sort((a, b) => a.oldestDate.localeCompare(b.oldestDate) || b.count - a.count)
}

// ─── 2. Invoices unpaid ──────────────────────────────────────────────────────

export interface UnpaidRunInput {
  id: string
  status: string
  archivedAt: string | null
  /** invoice_runs.paid_at; undefined when the column does not exist yet. */
  paidAt?: string | null
  approvedAt: string | null
  createdAt: string | null
  qboInvoiceNos: number[]
  vendorName: string | null
  periodStart: string | null
  periodEnd: string | null
  /** Sum of client charges on the run's non-excluded lines; null = unknown. */
  clientTotal: number | null
}

export interface UnpaidInvoice {
  runId: string
  sentDate: string
  daysOutstanding: number
  qboInvoiceNos: number[]
  vendorName: string | null
  periodStart: string | null
  periodEnd: string | null
  clientTotal: number | null
}

/** When the client got the invoice. There is no exported_at column, so the
 *  approval time stands in (export follows approval, usually the same day);
 *  created_at only for a legacy row with no approval stamp. */
export function invoiceSentDate(r: Pick<UnpaidRunInput, 'approvedAt' | 'createdAt'>): string | null {
  const d = r.approvedAt ?? r.createdAt
  return d ? d.slice(0, 10) : null
}

/**
 * Exported, live (not archived) runs with no payment recorded, sent MORE than
 * UNPAID_AFTER_DAYS ago. A run whose client total is known to be zero has
 * nothing to collect and is skipped. Longest outstanding first.
 */
export function findUnpaidInvoices(
  runs: ReadonlyArray<UnpaidRunInput>,
  today: string,
  afterDays: number = UNPAID_AFTER_DAYS,
): UnpaidInvoice[] {
  const out: UnpaidInvoice[] = []
  for (const r of runs) {
    if (r.status !== 'exported') continue
    if (r.archivedAt) continue
    if (r.paidAt) continue
    if (r.clientTotal != null && Math.abs(r.clientTotal) < 0.005) continue
    const sent = invoiceSentDate(r)
    if (!sent) continue
    const age = daysBetween(sent, today)
    if (age <= afterDays) continue
    out.push({
      runId: r.id,
      sentDate: sent,
      daysOutstanding: age,
      qboInvoiceNos: [...r.qboInvoiceNos].sort((a, b) => a - b),
      vendorName: r.vendorName,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      clientTotal: r.clientTotal,
    })
  }
  return out.sort((a, b) => b.daysOutstanding - a.daysOutstanding || a.runId.localeCompare(b.runId))
}

/** QBO invoice numbers a run carries: the per-month map plus the legacy
 *  single number, deduped. */
export function qboNumbersOf(qboInvoiceNo: number | null, qboInvoiceNos: unknown): number[] {
  const set = new Set<number>()
  if (qboInvoiceNo != null && Number.isFinite(Number(qboInvoiceNo))) set.add(Number(qboInvoiceNo))
  if (qboInvoiceNos && typeof qboInvoiceNos === 'object' && !Array.isArray(qboInvoiceNos)) {
    for (const v of Object.values(qboInvoiceNos as Record<string, unknown>)) {
      const n = Number(v)
      if (v != null && Number.isFinite(n)) set.add(n)
    }
  }
  return [...set]
}

/** PostgREST / Postgres "that table or column does not exist" (the migration
 *  adding it has not been applied yet). */
export function isMissingSchemaError(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(String(err.code ?? ''))
    || /column .* does not exist|relation .* does not exist|could not find the .* (column|table)/i.test(err.message ?? '')
}
