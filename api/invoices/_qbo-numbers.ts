// Keep our QBO invoice numbers clear of numbers QuickBooks already has.
//
// Why (2026-10-13): the Haven import numbers come from our own counter
// (app_settings.invoicing_qbo_next_number), but QuickBooks is where invoices
// actually live, and the two drifted. Run 1261003821 was given 1096 here and
// imported as TWO invoices (1096 September, 1097 October), so our next export
// handed out 1097 again and it had to be renumbered 1098 by hand. Before
// numbering an export we now ask QuickBooks (1) the highest Haven invoice
// number, and raise our counter past it, and (2) whether the number we are
// about to use is already taken by ANY invoice, skipping it if so. The nightly
// QBO classes cron runs (1) too, so the counter is right even between exports.
//
// QuickBooks unreachable (disconnected, token refresh failed) → numbering
// falls back to our counter alone, exactly as before, and the reason is logged.

import { getFreshQboTokens, qboApiBase } from '../qbo/_lib.js'

/** The QBO customer every Haven import invoice is written to (see the
 *  'Customer' column in _exporters.ts). */
export const HAVEN_QBO_CUSTOMER = 'Haven'

/** Highest whole-number DocNumber in a list; non-numeric ones are ignored. */
export function maxDocNumber(docs: ReadonlyArray<string | null | undefined>): number | null {
  let max: number | null = null
  for (const d of docs) {
    const t = (d ?? '').trim()
    if (!/^\d{1,9}$/.test(t)) continue
    const n = Number(t)
    if (max == null || n > max) max = n
  }
  return max
}

/**
 * Take numbers from `next` until one is free in QuickBooks. A taken number is
 * skipped for good (the counter has already moved past it). If the check
 * itself fails, the number is used as is: the counter alone is the old
 * behaviour, never worse than it.
 */
export async function allocateClearNumber(
  next: () => Promise<number>,
  taken: ((n: number) => Promise<boolean>) | null,
  maxTries = 25,
): Promise<{ number: number; skipped: number[] }> {
  const skipped: number[] = []
  for (let i = 0; i < maxTries; i++) {
    const n = await next()
    if (!taken) return { number: n, skipped }
    let isTaken = false
    try {
      isTaken = await taken(n)
    } catch (e) {
      console.warn(`QBO invoice number check failed for ${n}; using it unchecked:`, e instanceof Error ? e.message : e)
      return { number: n, skipped }
    }
    if (!isTaken) return { number: n, skipped }
    skipped.push(n)
  }
  throw new Error(`QuickBooks already has invoices ${skipped[0]} to ${skipped[skipped.length - 1]}; check the invoice numbering before exporting`)
}

export interface QboConnection {
  base: string
  realmId: string
  headers: Record<string, string>
}

/** A live QuickBooks connection, or null when QuickBooks is not connected. */
export async function qboConnection(supabase: unknown): Promise<QboConnection | null> {
  const tokens = await getFreshQboTokens(supabase)
  if (!tokens) return null
  const realmId = tokens.realm_id || process.env.QBO_REALM_ID
  if (!realmId) return null
  return {
    base: qboApiBase(process.env.QBO_ENVIRONMENT || 'sandbox'),
    realmId,
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
  }
}

async function qboQuery<T>(c: QboConnection, entity: string, query: string): Promise<T[]> {
  const r = await fetch(`${c.base}/v3/company/${c.realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`, { headers: c.headers })
  if (!r.ok) throw new Error(`QBO ${entity} query failed (${r.status}): ${(await r.text()).slice(0, 200)}`)
  const body = (await r.json()) as { QueryResponse?: Record<string, T[] | undefined> }
  return body.QueryResponse?.[entity] ?? []
}

/** DocNumbers of Haven's most recent invoices in QuickBooks. */
export async function havenDocNumbers(c: QboConnection): Promise<string[]> {
  const customers = await qboQuery<{ Id: string }>(c, 'Customer', `select Id from Customer where DisplayName = '${HAVEN_QBO_CUSTOMER}'`)
  if (customers.length === 0) return []
  const invoices = await qboQuery<{ DocNumber?: string }>(
    c,
    'Invoice',
    `select DocNumber from Invoice where CustomerRef = '${customers[0].Id}' orderby TxnDate desc maxresults 200`,
  )
  return invoices.map(i => i.DocNumber ?? '')
}

/** Does any invoice in QuickBooks already carry this number? */
export async function docNumberTaken(c: QboConnection, n: number): Promise<boolean> {
  if (!Number.isInteger(n) || n < 0) throw new Error('bad invoice number')
  const hits = await qboQuery<{ Id: string }>(c, 'Invoice', `select Id from Invoice where DocNumber = '${n}'`)
  return hits.length > 0
}

/** Raise our counter to one past Haven's highest QuickBooks invoice number
 *  (never lowers it). Returns QuickBooks' highest and our next number. */
export async function raiseCounterToQbo(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
  c: QboConnection,
): Promise<{ qboHighest: number | null; next: number | null }> {
  const highest = maxDocNumber(await havenDocNumbers(c))
  if (highest == null) return { qboHighest: null, next: null }
  const { data, error } = await supabase.rpc('raise_qbo_invoice_counter', { p_min: highest + 1 })
  if (error) throw new Error(`Failed to raise the QBO invoice counter: ${error.message}`)
  return { qboHighest: highest, next: data == null ? null : Number(data) }
}
