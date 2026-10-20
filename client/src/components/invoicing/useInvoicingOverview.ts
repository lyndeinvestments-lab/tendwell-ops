// One load behind the Vendor invoices table and the Client invoices tab:
// per-run line totals, and every client invoice (client + service month +
// channel) on approved or exported runs with its send status.
//
// It reads a single paged `invoice_lines` select of only the columns needed,
// over the most recent runs (OVERVIEW_RUN_WINDOW), instead of one query per
// run. Everything is read-only. Pieces that depend on a migration that may not
// be applied (client_invoices, invoice_adjustments, linen charges) degrade to
// "unknown" instead of failing: the page then falls back to the plain columns.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { InvoiceRun } from '@/lib/invoices'
import {
  buildRunClientInvoices,
  sendProgressOf,
  sortToSend,
  storedClientInvoiceRows,
  summarizeRunLines,
  type ClientInvoiceRow,
  type RunLineStats,
  type SendLineRow,
  type SendProgress,
} from '@/lib/invoicing-overview'
import {
  CLIENT_INVOICE_CHANNELS,
  creditClientsByLine,
  isClientInvoiceChannel,
  isMissingSchemaError,
  linenClientsByLine,
  runAllowsSendControl,
  type ClientInvoiceChannel,
  type ClientInvoiceState,
  type ClientInvoiceStatus,
  type CreditClient,
} from '@shared/billcom-send'

/** Most recent non-void runs whose lines are loaded for the list numbers. */
export const OVERVIEW_RUN_WINDOW = 40

const db = supabase as any
const PAGE = 1000
const CHUNK = 150

type LineRow = SendLineRow & {
  run_id: string
  review_status: string
  cleaner_pay_amount: number | string | null
}

async function pagedLines(runIds: string[], withHold: boolean): Promise<LineRow[]> {
  const cols = 'id, run_id, line_no, line_kind, review_status, billing_channel, cleaner_pay_amount, client_charge_amount, service_date, raw_date_mentioned, property_id, flags'
  const out: LineRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('invoice_lines')
      .select(withHold ? `${cols}, bill_hold_reason` : cols)
      .in('run_id', runIds)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw Object.assign(new Error(error.message), { code: error.code })
    const page = (data ?? []) as LineRow[]
    out.push(...page)
    if (page.length < PAGE) return out
    if (out.length >= 100 * PAGE) throw new Error('Too many invoice lines to summarise')
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface InvoicingOverview {
  /** Line totals per run (only runs inside the window). */
  statsByRun: Map<string, RunLineStats>
  /** Every client invoice on approved / exported runs inside the window. */
  clientInvoicesByRun: Map<string, ClientInvoiceRow[]>
  /** Client invoices not yet sent (held or approved), across all runs. */
  toSend: ClientInvoiceRow[]
  /** False when client_invoices does not exist yet (migration pending). */
  sendAvailable: boolean
}

export function useInvoicingOverview(runs: InvoiceRun[]) {
  const windowRuns = useMemo(
    () => runs.filter(r => r.status !== 'void').slice(0, OVERVIEW_RUN_WINDOW),
    [runs],
  )
  // The key carries each run's status so approving a run reloads the numbers;
  // it starts with 'invoicing-runs' so invalidating the runs list reloads it too.
  const key = windowRuns.map(r => `${r.id}:${r.status}`).join(',')

  const query = useQuery<InvoicingOverview>({
    queryKey: ['invoicing-runs', 'overview', key],
    enabled: windowRuns.length > 0,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const runIds = windowRuns.map(r => r.id)
      let lines: LineRow[]
      try {
        lines = await pagedLines(runIds, true)
      } catch (e) {
        if (!isMissingSchemaError(e)) throw e
        lines = await pagedLines(runIds, false)
      }
      const statsByRun = summarizeRunLines(lines)

      const sendRuns = windowRuns.filter(r => runAllowsSendControl(r.status))
      const sendRunIds = new Set(sendRuns.map(r => r.id))
      const clientInvoicesByRun = new Map<string, ClientInvoiceRow[]>()

      // Stored client_invoices: every row of the window's send runs (for sent
      // counts) plus every unsent row on any run (to catch older runs).
      let sendAvailable = true
      const stored: Array<Parameters<typeof storedClientInvoiceRows>[0][number]> = []
      const selectCols = 'run_id, contact_id, billing_channel, service_month, status, hold_reason, billcom_invoice_number, sent_at, sent_by, total, contacts:contact_id(full_name, company)'
      const sendIds = Array.from(sendRunIds)
      const queries = [
        ...chunks(sendIds, CHUNK).map(ids => db.from('client_invoices').select(selectCols).in('run_id', ids).in('billing_channel', CLIENT_INVOICE_CHANNELS as unknown as string[])),
        db.from('client_invoices').select(selectCols).neq('status', 'sent').in('billing_channel', CLIENT_INVOICE_CHANNELS as unknown as string[]).limit(2000),
      ]
      for (const res of await Promise.all(queries)) {
        if (res.error) {
          if (isMissingSchemaError(res.error)) { sendAvailable = false; break }
          throw res.error
        }
        stored.push(...(res.data ?? []))
      }

      if (sendAvailable && sendRuns.length > 0) {
        const lineRunsById = new Map<string, LineRow[]>()
        for (const l of lines) {
          if (!sendRunIds.has(l.run_id)) continue
          const arr = lineRunsById.get(l.run_id)
          if (arr) arr.push(l)
          else lineRunsById.set(l.run_id, [l])
        }
        const allSendLines = Array.from(lineRunsById.values()).flat()

        // Property → client, for the lines that bill a client.
        const propertyIds = Array.from(new Set(allSendLines
          .filter(l => isClientInvoiceChannel(l.billing_channel) && l.property_id != null)
          .map(l => l.property_id as number))).sort((a, b) => a - b)
        const clientByProperty = new Map<number, { contactId: string | null; name: string | null }>()
        for (const ids of chunks(propertyIds, CHUNK)) {
          const { data, error } = await db.from('properties').select('id, contact_id, contacts:contact_id(full_name, company)').in('id', ids)
          if (error) throw error
          for (const p of (data ?? []) as Array<{ id: number; contact_id: string | null; contacts: any }>) {
            const c = Array.isArray(p.contacts) ? p.contacts[0] : p.contacts
            clientByProperty.set(p.id, { contactId: p.contact_id, name: c?.full_name ?? c?.company ?? null })
          }
        }

        // Credits and linen charges bill the client named on their own row.
        const creditLineIds = allSendLines
          .filter(l => isClientInvoiceChannel(l.billing_channel) && ((l.flags ?? []).includes('credit') || (l.flags ?? []).includes('linen_charge')))
          .map(l => l.id)
        const creditClients = new Map<string, CreditClient>()
        for (const ids of chunks(creditLineIds, CHUNK)) {
          const [adj, linen] = await Promise.all([
            db.from('invoice_adjustments').select('applied_line_id, contact_id, contacts:contact_id(full_name, company)').in('applied_line_id', ids),
            db.from('linen_charge_installments').select('line_id, linen_charges:charge_id(contact_id, contacts:contact_id(full_name, company))').in('line_id', ids),
          ])
          for (const r of [adj, linen]) if (r.error && !isMissingSchemaError(r.error)) throw r.error
          creditClientsByLine(adj.error ? null : adj.data).forEach((v, k) => creditClients.set(k, v))
          linenClientsByLine(linen.error ? null : linen.data).forEach((v, k) => creditClients.set(k, v))
        }

        const statesByRun = new Map<string, ClientInvoiceState[]>()
        for (const r of stored) {
          const arr = statesByRun.get(r.run_id) ?? []
          arr.push({
            contactId: r.contact_id,
            channel: r.billing_channel as ClientInvoiceChannel,
            serviceMonth: r.service_month,
            status: r.status as ClientInvoiceStatus,
            holdReason: r.hold_reason,
            billcomInvoiceNumber: r.billcom_invoice_number,
            sentAt: r.sent_at,
            total: r.total == null ? null : Number(r.total),
          })
          statesByRun.set(r.run_id, arr)
        }

        const runById = new Map(sendRuns.map(r => [r.id, r]))
        lineRunsById.forEach((runLines, runId) => {
          clientInvoicesByRun.set(runId, buildRunClientInvoices({
            runId,
            invoiceDate: runById.get(runId)?.invoice_date ?? null,
            lines: runLines,
            clientByProperty,
            creditClients,
            states: statesByRun.get(runId) ?? [],
          }))
        })
        // Send runs with no billable client lines at all still get an entry.
        sendRuns.forEach(r => { if (!clientInvoicesByRun.has(r.id)) clientInvoicesByRun.set(r.id, []) })
      }

      // To send: computed groups for window runs, stored unsent rows for any
      // run whose lines were not loaded (older than the window).
      const toSend: ClientInvoiceRow[] = []
      clientInvoicesByRun.forEach(rows => toSend.push(...rows.filter(r => r.status !== 'sent')))
      if (sendAvailable) {
        const sendRunIdsAll = new Set(runs.filter(r => runAllowsSendControl(r.status)).map(r => r.id))
        const outside = stored.filter(r => r.status !== 'sent' && !clientInvoicesByRun.has(r.run_id) && sendRunIdsAll.has(r.run_id))
        toSend.push(...storedClientInvoiceRows(outside))
      }

      return { statsByRun, clientInvoicesByRun, toSend: sortToSend(toSend), sendAvailable }
    },
  })

  const unsentByRun = useMemo(() => {
    const m = new Map<string, number>()
    query.data?.clientInvoicesByRun.forEach((rows, runId) => {
      const unsent = rows.filter(r => r.status !== 'sent').length
      if (unsent > 0) m.set(runId, unsent)
    })
    return m
  }, [query.data])

  const progressByRun = useMemo(() => {
    const m = new Map<string, SendProgress>()
    query.data?.clientInvoicesByRun.forEach((rows, runId) => m.set(runId, sendProgressOf(rows)))
    return m
  }, [query.data])

  return { ...query, unsentByRun, progressByRun }
}
