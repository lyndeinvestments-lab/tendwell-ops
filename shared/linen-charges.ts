// Linen onboarding charges (linen_charges + linen_charge_installments,
// migration 20261019a_linen_charges.sql). Pure, no I/O; shared by the
// serverless functions and the client.
//
// A linen charge is the one-time fee for stocking a property for the linen
// program, locked at the figure the client agreed to. It is billed by the SQL
// function invoice_apply_linen_charges when a run is approved:
// planLinenInstallment() below is its TypeScript mirror. KEEP THE TWO IN SYNC:
//   * a charge bills only on a run that bills its property (or, for a
//     client-wide charge, any property of its client);
//   * payments go out in order, one per approved run at most;
//   * a payment with a `billFrom` date waits until that date;
//   * a payment with no date waits for a service month in which no other
//     payment of the same charge was billed (a payment plan spreads one per
//     month).

/** Flag on an invoice_lines row created from a linen charge payment. */
export const LINEN_CHARGE_FLAG = 'linen_charge'
/** service_type of a linen charge line (line_kind 'extra', client-only). */
export const LINEN_SERVICE_TYPE = 'Linen Onboarding'

export type LinenChargeStatus = 'scheduled' | 'billed' | 'waived' | 'void'
export type LinenInstallmentStatus = 'pending' | 'billed' | 'billed_external'
/** What the onboarding checklist and alerts can see (no amounts). */
export type LinenDecision = 'scheduled' | 'billed' | 'waived' | 'portfolio'

export function isLinenChargeLine(l: { flags?: ReadonlyArray<string> | null }): boolean {
  return !!l.flags?.includes(LINEN_CHARGE_FLAG)
}

const cents = (n: number) => Math.round(n * 100)

/** Split an amount into n payments to the cent; the last carries the
 *  remainder ($21,741.28 / 3 → 7,247.09 + 7,247.09 + 7,247.10). Mirrors
 *  linen_split_amount() in the migration. */
export function splitInstallments(amount: number, n: number): number[] {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(n) || n < 1) return []
  const total = cents(amount)
  const each = Math.floor(total / n)
  return Array.from({ length: n }, (_, i) => (i < n - 1 ? each : total - each * (n - 1)) / 100)
}

/** "3 sets" / "3 sets + comforters": what was stocked, shown on the invoice. */
export function linenChargeLabel(sets: number | null | undefined, comforters: boolean | null | undefined): string {
  const s = sets && sets > 0 ? `${sets} set${sets === 1 ? '' : 's'}` : ''
  return [s, comforters ? 'comforters' : ''].filter(Boolean).join(' + ')
}

export interface PlanInstallment {
  seq: number
  status: LinenInstallmentStatus
  /** YYYY-MM-DD, or null to bill on the next eligible run. */
  billFrom: string | null
  /** YYYY-MM the payment was billed in (status 'billed'). */
  serviceMonth: string | null
}

export type PlanSkip = 'not_on_run' | 'nothing_pending' | 'held_until' | 'already_billed_this_month'

/** Which payment (if any) an approved run bills for one scheduled charge.
 *  `runMonth` is the latest service month in which the run bills the charge's
 *  property (or client), null when it does not bill it at all; `today` is
 *  YYYY-MM-DD. */
export function planLinenInstallment(input: {
  installments: ReadonlyArray<PlanInstallment>
  runMonth: string | null
  today: string
}): { bill: PlanInstallment } | { skip: PlanSkip } {
  if (!input.runMonth) return { skip: 'not_on_run' }
  const next = [...input.installments].filter(i => i.status === 'pending').sort((a, b) => a.seq - b.seq)[0]
  if (!next) return { skip: 'nothing_pending' }
  if (next.billFrom && next.billFrom > input.today) return { skip: 'held_until' }
  if (!next.billFrom && input.installments.some(i => i.status === 'billed' && i.serviceMonth === input.runMonth)) {
    return { skip: 'already_billed_this_month' }
  }
  return { bill: next }
}

/** Invoice line note for a payment: "3 sets, payment 2 of 3". Mirrors the
 *  raw_note_text the SQL function writes. */
export function linenLineNote(label: string | null | undefined, seq: number, payments: number): string {
  return [label?.trim() || '', payments > 1 ? `payment ${seq} of ${payments}` : ''].filter(Boolean).join(', ')
}

/** Alerts start from the day linen charges went live: properties first
 *  cleaned before then are listed in the panel's "no decision" list instead,
 *  so the ~45 already-running linen properties do not flood Alerts. */
export const LINEN_ALERT_SINCE = '2026-10-19'

/** Linen-program properties cleaned (first Tendwell clean on or after
 *  `since`) with no linen fee decision: each needs one before it is billed. */
export function linenPropertiesMissingDecision<P extends { id: number }>(
  properties: ReadonlyArray<P>,
  decided: ReadonlySet<number>,
  firstClean: ReadonlyMap<number, string>,
  since: string = LINEN_ALERT_SINCE,
): Array<{ property: P; firstClean: string }> {
  const out: Array<{ property: P; firstClean: string }> = []
  for (const p of properties) {
    const d = firstClean.get(p.id)
    if (!d || d < since || decided.has(p.id)) continue
    out.push({ property: p, firstClean: d })
  }
  return out
}

export interface ChargeTotals {
  billed: number
  owed: number
  /** Next pending payment, if any. */
  next: { seq: number; amount: number; billFrom: string | null } | null
}

/** Billed (in Ops or outside it) vs still owed, for the panel. */
export function chargeTotals(installments: ReadonlyArray<{ seq: number; amount: number | string; status: LinenInstallmentStatus; bill_from?: string | null }>): ChargeTotals {
  let billed = 0
  let owed = 0
  let next: ChargeTotals['next'] = null
  for (const i of [...installments].sort((a, b) => a.seq - b.seq)) {
    const amt = cents(Number(i.amount))
    if (i.status === 'pending') {
      owed += amt
      if (!next) next = { seq: i.seq, amount: amt / 100, billFrom: i.bill_from ?? null }
    } else {
      billed += amt
    }
  }
  return { billed: billed / 100, owed: owed / 100, next }
}
