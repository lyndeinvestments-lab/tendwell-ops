// What one approved run turns into, month by month: Haven's QuickBooks
// invoice(s), the bill.com / QuickBooks client invoices, and the vendor's
// Ramp bill(s). Dependency-free so the export code (api/invoices/_exporters.ts)
// and the run page share ONE definition of which lines go where and which
// month a line belongs to: a run that crosses a month becomes one Haven
// invoice and one Ramp bill per service month, so revenue and cleaner pay land
// in the month the work was done.

export type OutputChannel = 'qbo_haven' | 'qbo_client' | 'bill_com' | 'none'

export interface OutputLine {
  lineKind: string
  reviewStatus: string
  billingChannel: OutputChannel | null
  cleanerPayAmount: number | null
  clientChargeAmount: number | null
  serviceDate: string | null // yyyy-mm-dd
}

export function serviceMonth(l: Pick<OutputLine, 'serviceDate'>, fallback: string | null): string {
  return (l.serviceDate ?? fallback ?? '').slice(0, 7)
}

/** Last calendar day of a yyyy-mm month. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0))
  return d.toISOString().slice(0, 10)
}

/** Invoice date for one month's slice of a run: the run's invoice date, but
 *  never later than the end of the service month — September's cleans are
 *  dated in September so they land in September's books (cf. Inv 1090, which
 *  Haven had to move into August by hand). */
export function invoiceDateForMonth(runInvoiceDate: string | null, month: string): string | null {
  if (!month) return runInvoiceDate
  const end = monthEnd(month)
  if (!runInvoiceDate) return end
  return runInvoiceDate < end ? runInvoiceDate : end
}

/** The distinct service months among a set of lines, ascending. */
export function monthsOf(lines: ReadonlyArray<Pick<OutputLine, 'serviceDate'>>, fallback: string | null): string[] {
  return Array.from(new Set(lines.map(l => serviceMonth(l, fallback)).filter(Boolean))).sort()
}

/** Everything we actually owe the vendor: cleans, extras, operating expenses.
 *  Checks BOTH exclusion signals — line_kind='excluded' is the engine's own
 *  (self-inspection/air-filter) exclusion, review_status='excluded' is a
 *  human excluding a line in review without the engine ever reclassifying
 *  line_kind (real case, 2026-09: four Aug 18 duplicates Nina excluded in
 *  review still went out on Ramp/QBO while only line_kind was checked). */
export function isApLine(l: Pick<OutputLine, 'lineKind' | 'reviewStatus' | 'cleanerPayAmount'>): boolean {
  return (
    l.lineKind !== 'excluded' &&
    l.reviewStatus !== 'excluded' &&
    l.cleanerPayAmount != null &&
    l.cleanerPayAmount !== 0
  )
}

export function isArLine(
  l: Pick<OutputLine, 'lineKind' | 'reviewStatus' | 'billingChannel' | 'clientChargeAmount'>,
  channel: OutputChannel,
): boolean {
  return (
    l.billingChannel === channel &&
    l.lineKind !== 'excluded' &&
    l.reviewStatus !== 'excluded' &&
    l.lineKind !== 'operating_expense' &&
    l.clientChargeAmount != null &&
    l.clientChargeAmount !== 0
  )
}

export interface OutputBucket {
  lines: number
  total: number
}

export interface MonthOutputs {
  month: string // yyyy-mm
  /** The date the month's Haven invoice and Ramp bill carry. */
  documentDate: string | null
  haven: OutputBucket & { invoiceNo: number | null }
  billCom: OutputBucket
  qboClient: OutputBucket
  /** Billable lines no channel will pick up (no client / unrouted). */
  unrouted: OutputBucket
  ramp: OutputBucket & { billNumber: string | null }
}

export interface RunOutputs {
  months: MonthOutputs[]
  /** More than one Ramp bill (vendor pay crosses a month). */
  splitsRamp: boolean
  /** More than one Haven QuickBooks invoice. */
  splitsHaven: boolean
}

export interface OutputRun {
  invoiceDate: string | null
  vendorInvoiceNumber: string | null
  qboInvoiceNo: number | null
  qboInvoiceNos?: Readonly<Record<string, number>> | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Mirrors the export files: Ramp = isApLine summed by month (one bill per
 *  month, numbered `<vendor #>-<yyyy-mm>` once the run crosses a month); Haven
 *  QuickBooks = qbo_haven AR lines by month, numbered from qbo_invoice_nos
 *  (a run numbered before the split keeps its single number for its first
 *  month, as export.ts does); bill.com / QuickBooks clients by month. */
export function summarizeRunOutputs(lines: ReadonlyArray<OutputLine>, run: OutputRun): RunOutputs {
  const fallback = run.invoiceDate
  const ap = lines.filter(isApLine)
  const haven = lines.filter(l => isArLine(l, 'qbo_haven'))
  const rampMonths = monthsOf(ap, fallback)
  const havenMonths = monthsOf(haven, fallback)
  const splitsRamp = rampMonths.length > 1

  const nos: Record<string, number> = { ...(run.qboInvoiceNos ?? {}) }
  if (run.qboInvoiceNo != null && havenMonths.length > 0 && !Object.values(nos).includes(run.qboInvoiceNo) && nos[havenMonths[0]] == null) {
    nos[havenMonths[0]] = run.qboInvoiceNo
  }

  const byMonth = new Map<string, MonthOutputs>()
  const bucket = (): OutputBucket => ({ lines: 0, total: 0 })
  const get = (month: string): MonthOutputs => {
    let m = byMonth.get(month)
    if (!m) {
      m = {
        month,
        documentDate: invoiceDateForMonth(fallback, month),
        haven: { ...bucket(), invoiceNo: nos[month] ?? null },
        billCom: bucket(),
        qboClient: bucket(),
        unrouted: bucket(),
        ramp: { ...bucket(), billNumber: run.vendorInvoiceNumber ? (splitsRamp ? `${run.vendorInvoiceNumber}-${month}` : run.vendorInvoiceNumber) : null },
      }
      byMonth.set(month, m)
    }
    return m
  }
  const add = (b: OutputBucket, amount: number) => { b.lines += 1; b.total += amount }

  for (const l of lines) {
    const month = serviceMonth(l, fallback)
    if (!month) continue
    if (isApLine(l)) add(get(month).ramp, l.cleanerPayAmount ?? 0)
    if (isArLine(l, 'qbo_haven')) add(get(month).haven, l.clientChargeAmount ?? 0)
    else if (isArLine(l, 'bill_com')) add(get(month).billCom, l.clientChargeAmount ?? 0)
    else if (isArLine(l, 'qbo_client')) add(get(month).qboClient, l.clientChargeAmount ?? 0)
    else if ((l.billingChannel == null || l.billingChannel === 'none') && isArLine({ ...l, billingChannel: 'none' }, 'none')) {
      add(get(month).unrouted, l.clientChargeAmount ?? 0)
    }
  }

  const months = Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month))
  for (const m of months) {
    for (const b of [m.haven, m.billCom, m.qboClient, m.unrouted, m.ramp]) b.total = round2(b.total)
  }
  return { months, splitsRamp, splitsHaven: havenMonths.length > 1 }
}
