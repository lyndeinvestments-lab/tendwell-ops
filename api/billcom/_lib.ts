// bill.com v3 API helpers — server-side only, credentials never leave the function.
//
// Login takes four values (BILLCOM_USERNAME, BILLCOM_PASSWORD, BILLCOM_ORG_ID,
// BILLCOM_DEV_KEY). They are Sensitive in Vercel, so they exist only inside
// deployed functions: `vercel env pull/run` hands back empty values locally.
// A session expires after 35 idle minutes; every caller logs in, does its
// work and logs out. bill.com allows 3 concurrent requests per org, so keep
// calls sequential.

export const BILLCOM_API_BASE = 'https://gateway.prod.bill.com/connect/v3'

const ENV_VARS = ['BILLCOM_USERNAME', 'BILLCOM_PASSWORD', 'BILLCOM_ORG_ID', 'BILLCOM_DEV_KEY'] as const

export class BillComError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message)
    this.name = 'BillComError'
  }
}

export interface BillComSession {
  sessionId: string
  devKey: string
}

/** Names of the BILLCOM_* variables that are missing or blank. */
export function missingBillComEnv(env: Record<string, string | undefined> = process.env): string[] {
  return ENV_VARS.filter((k) => !env[k]?.trim())
}

/** bill.com returns errors as an array of { code, message }. Never echoes request data. */
export function billComErrorFrom(status: number, body: unknown): BillComError {
  const first = Array.isArray(body) ? body[0] : null
  if (first && typeof first === 'object') {
    const { code, message } = first as { code?: string; message?: string }
    return new BillComError(message || `bill.com request failed (${status})`, status, code)
  }
  return new BillComError(`bill.com request failed (${status})`, status)
}

export async function billComLogin(): Promise<BillComSession> {
  const missing = missingBillComEnv()
  if (missing.length) throw new BillComError(`bill.com not configured: missing ${missing.join(', ')}`, 500)
  const devKey = process.env.BILLCOM_DEV_KEY!.trim()
  const res = await fetch(`${BILLCOM_API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      username: process.env.BILLCOM_USERNAME!.trim(),
      password: process.env.BILLCOM_PASSWORD!,
      organizationId: process.env.BILLCOM_ORG_ID!.trim(),
      devKey,
    }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.sessionId) throw billComErrorFrom(res.status, body)
  return { sessionId: body.sessionId, devKey }
}

export async function billComLogout(session: BillComSession): Promise<void> {
  await fetch(`${BILLCOM_API_BASE}/logout`, { method: 'POST', headers: sessionHeaders(session) }).catch(() => {})
}

function sessionHeaders(session: BillComSession): Record<string, string> {
  return { Accept: 'application/json', sessionId: session.sessionId, devKey: session.devKey }
}

export async function billComGet<T>(session: BillComSession, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BILLCOM_API_BASE}/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { headers: sessionHeaders(session) })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw billComErrorFrom(res.status, body)
  return body as T
}

/** Every row of a paged list endpoint (customers, invoices…), following nextPage. */
export async function billComListAll<T>(session: BillComSession, path: string, maxPages = 50): Promise<T[]> {
  const rows: T[] = []
  let page: string | undefined
  for (let i = 0; i < maxPages; i++) {
    const body = await billComGet<{ results?: T[]; nextPage?: string }>(session, path, {
      max: '100',
      ...(page ? { page } : {}),
    })
    rows.push(...(body.results ?? []))
    page = body.nextPage
    if (!page) return rows
  }
  throw new BillComError(`bill.com ${path} has more than ${maxPages * 100} rows`, 500)
}

// ─── Connection summary (Settings → Integrations "Test connection") ──────────

export interface BillComCustomerRow { name?: string; email?: string | null; archived?: boolean }
export interface BillComInvoiceRow { invoiceNumber?: string; invoiceDate?: string; status?: string; archived?: boolean }

export interface BillComSummary {
  customers: { active: number; archived: number; with_email: number }
  invoices: { total: number; by_status: Record<string, number>; latest: Array<{ number: string; date: string; status: string }> }
}

export function summarizeBillCom(customers: BillComCustomerRow[], invoices: BillComInvoiceRow[]): BillComSummary {
  const active = customers.filter((c) => !c.archived)
  const live = invoices
    .filter((i) => !i.archived)
    .sort((a, b) => String(b.invoiceDate ?? '').localeCompare(String(a.invoiceDate ?? '')))
  const byStatus: Record<string, number> = {}
  for (const i of live) {
    const s = i.status ?? 'UNKNOWN'
    byStatus[s] = (byStatus[s] ?? 0) + 1
  }
  return {
    customers: {
      active: active.length,
      archived: customers.length - active.length,
      with_email: active.filter((c) => c.email?.trim()).length,
    },
    invoices: {
      total: live.length,
      by_status: byStatus,
      latest: live.slice(0, 8).map((i) => ({
        number: i.invoiceNumber ?? '',
        date: i.invoiceDate ?? '',
        status: i.status ?? 'UNKNOWN',
      })),
    },
  }
}
