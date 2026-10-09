// Client credits (invoice_adjustments). Pure, no I/O.
//
// A credit is money Tendwell owes a client back: a refund for a bad clean, a
// goodwill discount, an overcharge on an earlier invoice. It is recorded once
// (Invoice Reconciliation → Open credits owed) and applied automatically when
// the client's next run is approved, by the SQL function
// invoice_apply_open_credits (migration 20261009a_invoice_adjustments.sql).
//
// planCreditApplication() is the TypeScript mirror of that function's rule.
// KEEP THE TWO IN SYNC:
//   * open credits apply oldest first;
//   * a client's invoice never goes below zero: each credit is capped at what
//     is still billed, the applied part goes on the invoice and the rest stays
//     open for the client's next invoice;
//   * once nothing is left to credit against, later credits stay open whole.

/** Flag on an invoice_lines row created from an invoice_adjustments row. */
export const CREDIT_FLAG = 'credit'
/** service_type of a credit line (line_kind 'extra'). */
export const CREDIT_SERVICE_TYPE = 'Credit'

const round2 = (n: number) => Math.round(n * 100) / 100

export interface OpenCredit {
  id: string
  /** Negative, as stored (credits are negative). */
  amount: number
  createdAt: string
}

export interface CreditApplication {
  id: string
  /** What goes on the invoice: negative, never larger in size than the credit. */
  applied: number
  /** What stays owed for the next invoice: negative, or 0 when fully used. */
  remainder: number
}

export interface CreditPlan {
  applications: CreditApplication[]
  /** Credits untouched because the invoice was already down to zero. */
  untouched: string[]
  billed: number
  /** billed + sum(applied): what the client is invoiced. Never below zero. */
  total: number
}

/** How the open credits of one client apply to an invoice that bills them
 *  `billed` (net of anything already credited). */
export function planCreditApplication(billed: number, credits: ReadonlyArray<OpenCredit>): CreditPlan {
  const ordered = [...credits].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  let remaining = round2(billed)
  const applications: CreditApplication[] = []
  const untouched: string[] = []
  for (const c of ordered) {
    const owed = round2(-c.amount)
    if (!(owed > 0)) continue // not a credit; the DB CHECK refuses these anyway
    if (remaining <= 0) { untouched.push(c.id); continue }
    const apply = round2(Math.min(owed, remaining))
    const left = round2(owed - apply)
    applications.push({ id: c.id, applied: -apply, remainder: left > 0 ? -left : 0 })
    remaining = round2(remaining - apply)
  }
  const total = round2(round2(billed) + applications.reduce((a, x) => a + x.applied, 0))
  return { applications, untouched, billed: round2(billed), total }
}

export interface ChargeLine {
  clientChargeAmount: number | null
  lineKind?: string
  reviewStatus?: string
}

/** A client's invoice total: what is billed minus the credits on it. Credit
 *  lines are ordinary lines with a negative charge, so this is the plain net
 *  of every billable line; excluded lines and Tendwell expenses never count. */
export function clientInvoiceTotal(lines: ReadonlyArray<ChargeLine>): number {
  let total = 0
  for (const l of lines) {
    if (l.lineKind === 'excluded' || l.lineKind === 'operating_expense' || l.reviewStatus === 'excluded') continue
    total += l.clientChargeAmount ?? 0
  }
  return round2(total)
}

export function isCreditLine(l: { flags?: ReadonlyArray<string> | null }): boolean {
  return !!l.flags?.includes(CREDIT_FLAG)
}

/** PostgREST / Postgres errors that mean "this table, column or function is
 *  not there yet" (the migration has not been applied). Code that depends on
 *  20261009a treats these as "no credits" so deploying first is safe. */
export function isMissingSchemaError(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false
  const code = err.code ?? ''
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code)) return true
  return /does not exist|could not find the (table|function)|schema cache/i.test(err.message ?? '')
}
