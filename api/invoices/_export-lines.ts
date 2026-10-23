// Load a run's lines as ExportLine rows: what every export (and invoices Ops
// creates in bill.com) is built from. One loader so the files and the bill.com
// invoices can never be built from different data.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './_lib.js'
import type { ExportLine } from './_exporters.js'
import type { BillingChannel, LineKind } from './_engine.js'
import { isCreditLine } from './_credits.js'
import { isLinenChargeLine } from '../../shared/linen-charges.js'
import { creditClientsByLine, isMissingSchemaError, lineClient, linenClientsByLine, type CreditClient } from '../../shared/billcom-send.js'

const LINE_COLUMNS = 'id, line_no, line_kind, service_type, raw_date_mentioned, service_date, flags, raw_property_text, raw_note_text, review_note, review_status, cleaner_pay_amount, client_charge_amount, billing_channel, property_id, split_group, properties(name, contact_id, contacts:contact_id(full_name, company))'

/** `sendControl` is false while invoice_lines.bill_hold_reason does not exist
 *  yet (migration 20261009c pending); callers then behave as before it. */
export async function loadExportLines(supabase: SupabaseClient, runId: string): Promise<{ lines: ExportLine[]; sendControl: boolean }> {
  // Paged: PostgREST caps a response at 1000 rows, and a silently truncated
  // export is the worst failure here — a CSV that looks complete while
  // under-billing the client and under-paying the cleaner.
  const loadLines = (columns: string) => fetchAllRows<Record<string, any>>(
    'invoice_lines',
    () => supabase
      .from('invoice_lines')
      .select(columns)
      .eq('run_id', runId)
      .order('line_no'),
    'line_no',
  )
  let lineRows: Array<Record<string, any>>
  let sendControl = true
  try {
    lineRows = await loadLines(`${LINE_COLUMNS}, bill_hold_reason`)
  } catch (e) {
    if (!isMissingSchemaError(e)) throw e
    sendControl = false
    lineRows = await loadLines(LINE_COLUMNS)
  }

  // A client credit (invoice_adjustments) names its client on the adjustment,
  // not through a property: most credits carry none. Without this the
  // bill.com worksheet would list the credit under a blank customer, and send
  // control (which needs the client's contact id) would drop it entirely.
  let creditClients: Map<string, CreditClient> = new Map()
  const creditLineIds = lineRows.filter(r => isCreditLine(r)).map(r => String(r.id))
  if (creditLineIds.length > 0) {
    const { data: adjRows, error: adjErr } = await supabase
      .from('invoice_adjustments')
      .select('applied_line_id, contact_id, contacts:contact_id(full_name, company)')
      .in('applied_line_id', creditLineIds)
    if (adjErr && !isMissingSchemaError(adjErr)) throw new Error(`Failed to load client credits: ${adjErr.message}`)
    creditClients = creditClientsByLine(adjRows)
  }
  // A client-wide linen charge (no property) names its client on the charge.
  const linenLineIds = lineRows.filter(r => isLinenChargeLine(r)).map(r => String(r.id))
  if (linenLineIds.length > 0) {
    const { data: instRows, error: instErr } = await supabase
      .from('linen_charge_installments')
      .select('line_id, linen_charges:charge_id(contact_id, contacts:contact_id(full_name, company))')
      .in('line_id', linenLineIds)
    if (instErr && !isMissingSchemaError(instErr)) throw new Error(`Failed to load linen charges: ${instErr.message}`)
    creditClients = new Map([...Array.from(creditClients), ...Array.from(linenClientsByLine(instRows))])
  }

  const lines: ExportLine[] = lineRows.map(r => {
    const prop = Array.isArray(r.properties) ? r.properties[0] : r.properties
    const contact = prop ? (Array.isArray(prop.contacts) ? prop.contacts[0] : prop.contacts) : null
    const client = lineClient({
      id: r.id != null ? String(r.id) : null,
      propertyContactId: prop?.contact_id ?? null,
      propertyClientName: contact?.full_name ?? contact?.company ?? null,
    }, creditClients)
    return {
      lineKind: r.line_kind as LineKind,
      serviceType: r.service_type,
      serviceDate: r.service_date ?? r.raw_date_mentioned,
      propertyName: prop?.name ?? null,
      rawPropertyText: r.raw_property_text ?? null,
      propertyId: r.property_id != null ? Number(r.property_id) : null,
      clientName: client.clientName,
      billingChannel: r.billing_channel as BillingChannel | null,
      cleanerPayAmount: r.cleaner_pay_amount != null ? Number(r.cleaner_pay_amount) : null,
      clientChargeAmount: r.client_charge_amount != null ? Number(r.client_charge_amount) : null,
      note: r.raw_note_text,
      reviewNote: r.review_note,
      reviewStatus: r.review_status,
      splitGroup: r.split_group != null ? Number(r.split_group) : null,
      flags: Array.isArray(r.flags) ? r.flags : [],
      lineNo: r.line_no != null ? Number(r.line_no) : null,
      contactId: client.contactId,
      billHoldReason: r.bill_hold_reason ?? null,
    }
  })
  return { lines, sendControl }
}
