// Per-property economics for a date range — pure, no I/O.
//
// Tendwell's cleans are the Busy Bee invoice's cleaning lines (one per
// property per day) for days an approved/exported invoice covers, and the
// Breezeway/Trellis clean days after the last invoice. Breezeway logged other
// crews' cleans too, so a clean day inside invoiced weeks with no Busy Bee
// line within a day of it is reported (notOnInvoice), not counted.
//
// Revenue and cleaner pay are the invoice amounts where invoiced and the
// property's rates where not. Shared costs are real company spend allocated
// to properties:
//   * inspections — Busy Bee hourly inspection lines ("Irma Work", "Inspection
//     Work", …), each split evenly across the properties cleaned in the 7 days
//     ending on the line date, plus QuickBooks "Inspection Cost" split evenly
//     across the month's cleaned properties.
//   * laundry — QuickBooks Laundry (Blessed) + Busy Bee linen labor
//     ("Facility Work", "Wash linens", …), allocated by expected laundry.
//   * consumables — QuickBooks supplies (Hospitality Depot), smoothed to the
//     trailing 3-month average because bulk orders land in one month, and
//     allocated by expected consumables.
//   * overhead — Leadership Pay, other COGS, operating expenses and other
//     Busy Bee company lines, allocated by cleans.
// Monthly amounts enter the range by the share of the month's cleans inside it.

export type LineBucket = 'cleaning' | 'extra' | 'inspection' | 'linen' | 'other'

export interface EconProperty {
  id: number
  name: string
  stage: string | null
  ce_charged: number | null
  deep_clean_3x_ce: number | null
  cleaner_pay: number | null
  est_laundry: number | null
  est_consumables: number | null
}

export interface EconCleanDay {
  property_id: number
  d: string
  deep: boolean
  source?: string
}

export interface EconLine {
  property_id: number | null
  line_kind: string | null
  service_type: string | null
  description: string | null
  work_date: string
  cleaner_pay_amount: number
  client_charge_amount: number
}

export interface EconQboMonth {
  /** YYYY-MM-01 */
  month: string
  total_income: number
  total_expenses: number
  cogs_breakdown: Record<string, number> | null
  expense_breakdown: Record<string, number> | null
}

export interface EconWeighIn {
  d: string
  pounds: number
}

export interface EconInput {
  start: string
  end: string
  today: string
  properties: EconProperty[]
  /** Must cover every month the range touches, plus the 6 days before `start`. */
  cleanDays: EconCleanDay[]
  /** Same coverage as cleanDays, plus 6 days after `end`. */
  lines: EconLine[]
  /** First / last day covered by approved or exported Busy Bee invoices. */
  invoicedFrom: string | null
  invoicedThrough: string | null
  /** The range's months plus up to 3 complete months before (for supplies smoothing). */
  qbo: EconQboMonth[]
  /** Dirty-laundry weigh-ins sent to Blessed. */
  weighIns?: EconWeighIn[]
  laundryRatePerLb?: number
}

export type ReasonCode =
  | 'no_rate'
  | 'rate_below_pay'
  | 'pay_above_rate'
  | 'billed_below_expected'
  | 'unbilled_work'
  | 'allocated_costs'
  | 'not_on_invoice'

export interface Reason {
  code: ReasonCode
  /** Dollar impact in the range (always positive). */
  amount: number
  count?: number
}

export interface PropertyEconomics {
  property_id: number
  name: string
  stage: string | null
  rate: number | null
  payRate: number | null
  cleans: number
  deepCleans: number
  cleansInvoiced: number
  cleansNotInvoiced: number
  /** Breezeway/Trellis clean days in invoiced weeks with no Busy Bee line. */
  notOnInvoice: number
  notOnInvoiceBySource: Record<string, number>
  expectedRevenue: number
  expectedInvoiced: number
  billedCleaning: number
  billedExtras: number
  estimatedRevenue: number
  revenue: number
  billingGap: number
  cleaningPay: number
  extraPay: number
  estimatedPay: number
  labor: number
  unbilledPay: number
  inspections: number
  laundry: number
  laundryExpected: number
  consumables: number
  consumablesExpected: number
  overhead: number
  totalCost: number
  profit: number
  margin: number | null
  reasons: Reason[]
}

export type PoolSource = 'qbo' | 'weighins' | 'expected' | 'average'

export interface MonthShare {
  month: string
  share: number
  partial: boolean
  hasQbo: boolean
  laundrySource: PoolSource
  consumablesSource: PoolSource
}

export interface InspectionWeek {
  weekEnd: string
  amount: number
  inRange: number
  properties: number
}

export interface CompanyEconomics {
  cleans: number
  properties: number
  cleansInvoiced: number
  cleansNotInvoiced: number
  notOnInvoice: number
  notOnInvoiceBySource: Record<string, number>
  revenue: {
    expected: number
    expectedInvoiced: number
    billedCleaning: number
    billedExtras: number
    estimated: number
    total: number
    qboIncome: number | null
  }
  labor: { cleaning: number; extras: number; estimated: number; total: number; qboContractorPay: number | null }
  inspections: { busyBee: number; qbo: number; direct: number; total: number; propertiesCleaned: number; weeks: InspectionWeek[] }
  laundry: { qbo: number; weighIns: number | null; linenLabor: number; actual: number; expected: number; diff: number }
  consumables: { qbo: number; actual: number; expected: number; diff: number }
  overhead: { leadership: number; otherCogs: number; opex: number; busyBeeOther: number; total: number; opexAccounts: Record<string, number> }
  totalCost: number
  profit: number
  margin: number | null
  months: MonthShare[]
}

export interface EconResult {
  properties: PropertyEconomics[]
  company: CompanyEconomics
}

const DAY = 86_400_000
const toMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => toIso(toMs(d) + n * DAY)
export const monthOf = (d: string) => `${d.slice(0, 7)}-01`
export const monthEnd = (m: string) => addDays(addMonths(m, 1), -1)
const inRange = (d: string, a: string, b: string) => d >= a && d <= b
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)

export function addMonths(m: string, n: number): string {
  const total = +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

function monthsBetween(start: string, end: string): string[] {
  const out: string[] = []
  for (let m = monthOf(start); m <= monthOf(end); m = addMonths(m, 1)) out.push(m)
  return out
}

const CLEAN_KINDS = new Set(['clean', 'deep_clean', 'combined_split'])

/** Which cost bucket a Busy Bee invoice line belongs to. */
export function classifyLine(l: Pick<EconLine, 'property_id' | 'line_kind' | 'service_type' | 'description'>): LineBucket {
  if (l.property_id == null) {
    const text = (l.description ?? '').toLowerCase()
    if (/\bbulb\b|deliver|fedex|\bups\b|reimburs/.test(text)) return 'other'
    if (/facilit|faculit|wash\s*linen|laundry|linen/.test(text)) return 'linen'
    if (/inspect/.test(text) || /^\s*[a-z]+\s+work\b/.test(text)) return 'inspection'
    return 'other'
  }
  if (/inspect/i.test(l.service_type ?? '')) return 'inspection'
  if (CLEAN_KINDS.has(l.line_kind ?? '')) return 'cleaning'
  return 'extra'
}

type AccountGroup = 'contractor' | 'laundry' | 'consumables' | 'inspection' | 'leadership' | 'otherCogs'

export function cogsGroup(account: string): AccountGroup {
  const a = account.toLowerCase()
  if (/contractor/.test(a)) return 'contractor'
  if (/laundry|linen/.test(a)) return 'laundry'
  if (/suppl|consumab/.test(a)) return 'consumables'
  if (/inspect/.test(a)) return 'inspection'
  if (/leadership/.test(a)) return 'leadership'
  return 'otherCogs'
}

function qboGroups(m: EconQboMonth | undefined) {
  const g: Record<AccountGroup, number> = { contractor: 0, laundry: 0, consumables: 0, inspection: 0, leadership: 0, otherCogs: 0 }
  for (const [k, v] of Object.entries(m?.cogs_breakdown ?? {})) g[cogsGroup(k)] += num(v)
  return g
}

function allocate(total: number, weights: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>()
  let sum = 0
  weights.forEach(w => { sum += w })
  if (total === 0 || sum <= 0) return out
  weights.forEach((w, id) => out.set(id, (total * w) / sum))
  return out
}

function addTo(map: Map<number, number>, id: number, v: number) {
  map.set(id, (map.get(id) ?? 0) + v)
}

interface CleanEvent {
  property_id: number
  d: string
  deep: boolean
  invoiced: boolean
}

/** Tendwell cleans (invoice lines where invoiced, clean days elsewhere) + unmatched clean days. */
export function tendwellCleans(input: Pick<EconInput, 'cleanDays' | 'lines' | 'invoicedFrom' | 'invoicedThrough' | 'today'>) {
  const { invoicedFrom: from, invoicedThrough: through, today } = input
  const isInvoiced = (d: string) => from != null && through != null && inRange(d, from, through)
  const byKey = new Map<string, CleanEvent>()
  for (const l of input.lines) {
    if (l.property_id == null || !isInvoiced(l.work_date) || classifyLine(l) !== 'cleaning') continue
    const key = `${l.property_id}|${l.work_date}`
    const deep = l.line_kind === 'deep_clean' || /deep/i.test(l.service_type ?? '')
    const prev = byKey.get(key)
    if (prev) prev.deep ||= deep
    else byKey.set(key, { property_id: l.property_id, d: l.work_date, deep, invoiced: true })
  }
  const events: CleanEvent[] = Array.from(byKey.values())
  const notOnInvoice: EconCleanDay[] = []
  for (const c of input.cleanDays) {
    if (c.d > today) continue
    if (!isInvoiced(c.d)) {
      events.push({ property_id: c.property_id, d: c.d, deep: c.deep, invoiced: false })
      continue
    }
    const near = [-1, 0, 1].some(k => byKey.has(`${c.property_id}|${addDays(c.d, k)}`))
    if (!near) notOnInvoice.push(c)
  }
  return { events, notOnInvoice }
}

export function computePropertyEconomics(input: EconInput): EconResult {
  const { start, end, today } = input
  const lbRate = input.laundryRatePerLb ?? 0.69
  const props = new Map(input.properties.map(p => [p.id, p]))

  // ── Cleans ────────────────────────────────────────────────────────────────
  const { events, notOnInvoice } = tendwellCleans(input)
  const inPeriod = events.filter(c => inRange(c.d, start, end))
  const monthCleans = new Map<string, number>()
  for (const c of events) monthCleans.set(monthOf(c.d), (monthCleans.get(monthOf(c.d)) ?? 0) + 1)

  interface Acc {
    cleans: number; deep: number; invoiced: number; notInvoiced: number
    notOnInvoice: number; notOnInvoiceBySource: Record<string, number>
    expected: number; expectedInv: number; estRevenue: number; estPay: number
    laundryExp: number; consumablesExp: number
    billedCleaning: number; billedExtras: number; cleaningPay: number; extraPay: number
    unbilledPay: number; inspections: number
  }
  const acc = new Map<number, Acc>()
  const get = (id: number): Acc => {
    let a = acc.get(id)
    if (!a) {
      a = { cleans: 0, deep: 0, invoiced: 0, notInvoiced: 0, notOnInvoice: 0, notOnInvoiceBySource: {},
        expected: 0, expectedInv: 0, estRevenue: 0, estPay: 0, laundryExp: 0, consumablesExp: 0,
        billedCleaning: 0, billedExtras: 0, cleaningPay: 0, extraPay: 0, unbilledPay: 0, inspections: 0 }
      acc.set(id, a)
    }
    return a
  }

  const periodMonthCleans = new Map<string, number>()
  const monthProps = new Map<string, Set<number>>()
  for (const c of inPeriod) {
    const p = props.get(c.property_id)
    const a = get(c.property_id)
    const ce = num(p?.ce_charged)
    const price = c.deep ? num(p?.deep_clean_3x_ce) || 3 * ce : ce
    a.cleans += 1
    if (c.deep) a.deep += 1
    a.expected += price
    a.laundryExp += num(p?.est_laundry)
    a.consumablesExp += num(p?.est_consumables)
    if (c.invoiced) {
      a.invoiced += 1
      a.expectedInv += price
    } else {
      a.notInvoiced += 1
      a.estRevenue += price
      a.estPay += num(p?.cleaner_pay)
    }
    const m = monthOf(c.d)
    periodMonthCleans.set(m, (periodMonthCleans.get(m) ?? 0) + 1)
    if (!monthProps.has(m)) monthProps.set(m, new Set())
    monthProps.get(m)!.add(c.property_id)
  }
  const notOnInvoiceBySource: Record<string, number> = {}
  for (const c of notOnInvoice) {
    if (!inRange(c.d, start, end)) continue
    const a = get(c.property_id)
    const src = c.source ?? 'unknown'
    a.notOnInvoice += 1
    a.notOnInvoiceBySource[src] = (a.notOnInvoiceBySource[src] ?? 0) + 1
    notOnInvoiceBySource[src] = (notOnInvoiceBySource[src] ?? 0) + 1
  }

  // ── Invoice lines ─────────────────────────────────────────────────────────
  let inspectionDirect = 0
  const weekly = { inspection: 0, linen: 0, other: 0 }
  const inspectionWeeks = new Map<string, InspectionWeek>()
  const inspectionByProp = new Map<number, number>()
  for (const l of input.lines) {
    const bucket = classifyLine(l)
    const pay = num(l.cleaner_pay_amount)
    const charge = num(l.client_charge_amount)
    if (l.property_id != null) {
      if (!inRange(l.work_date, start, end)) continue
      const a = get(l.property_id)
      if (bucket === 'cleaning') {
        a.billedCleaning += charge
        a.cleaningPay += pay
      } else if (bucket === 'inspection') {
        a.billedExtras += charge
        a.inspections += pay
        inspectionDirect += pay
      } else {
        a.billedExtras += charge
        a.extraPay += pay
      }
      if (charge === 0 && pay > 0) a.unbilledPay += pay
      continue
    }
    // Company lines cover the 7 days ending on their date.
    const wStart = addDays(l.work_date, -6)
    const overlap = (Math.min(toMs(end), toMs(l.work_date)) - Math.max(toMs(start), toMs(wStart))) / DAY + 1
    if (overlap <= 0) continue
    const portion = (pay * overlap) / 7
    weekly[bucket as 'inspection' | 'linen' | 'other'] += portion
    if (bucket !== 'inspection') continue
    const cleaned = new Set(events.filter(c => inRange(c.d, wStart, l.work_date)).map(c => c.property_id))
    const targets = cleaned.size > 0 ? cleaned : new Set(inPeriod.map(c => c.property_id))
    const wk = inspectionWeeks.get(l.work_date) ?? { weekEnd: l.work_date, amount: 0, inRange: 0, properties: targets.size }
    wk.amount += pay
    wk.inRange += portion
    inspectionWeeks.set(l.work_date, wk)
    targets.forEach(id => addTo(inspectionByProp, id, portion / targets.size))
  }

  // ── Monthly QuickBooks pools ──────────────────────────────────────────────
  const qboByMonth = new Map(input.qbo.map(q => [q.month.slice(0, 10), q]))
  const weighByMonth = new Map<string, number>()
  for (const w of input.weighIns ?? []) weighByMonth.set(monthOf(w.d), (weighByMonth.get(monthOf(w.d)) ?? 0) + num(w.pounds) * lbRate)
  const currentMonth = monthOf(today)

  // Average of the last 3 complete months with QuickBooks data, ending at the
  // month itself when it is complete. Supplies are bought in bulk, and a month
  // in progress has not had its fixed bills (Leadership Pay, software …) booked.
  const trailingAverage = (m: string, pick: (q: EconQboMonth) => number): number | null => {
    const last = m < currentMonth ? m : addMonths(currentMonth, -1)
    const vals: number[] = []
    for (let k = 0; k < 3; k++) {
      const q = qboByMonth.get(addMonths(last, -k))
      if (q) vals.push(pick(q))
    }
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  }

  let laundryQbo = 0, laundryPool = 0, weighInsTotal = 0, consumablesQbo = 0, consumablesPool = 0
  let inspectionQbo = 0, leadership = 0, otherCogs = 0, opex = 0, contractorQbo = 0, incomeQbo = 0
  let anyQbo = false
  const opexAccounts: Record<string, number> = {}
  const monthShares: MonthShare[] = []
  const inspectionQboByProp = new Map<number, number>()

  for (const m of monthsBetween(start, end)) {
    const total = monthCleans.get(m) ?? 0
    const share = total > 0 ? (periodMonthCleans.get(m) ?? 0) / total : 0
    const q = qboByMonth.get(m)
    const g = qboGroups(q)
    const partial = m >= currentMonth
    let laundryExpMonth = 0, consumablesExpMonth = 0
    for (const c of events) {
      if (monthOf(c.d) !== m) continue
      const p = props.get(c.property_id)
      laundryExpMonth += num(p?.est_laundry)
      consumablesExpMonth += num(p?.est_consumables)
    }

    // Laundry: Blessed bills lag, so a month in progress uses the weigh-ins.
    const weigh = weighByMonth.get(m)
    let laundrySource: PoolSource = 'qbo'
    let laundryMonth = g.laundry
    if (partial || !q) {
      const fallback = weigh != null && weigh > 0 ? weigh : laundryExpMonth
      if (fallback > laundryMonth) {
        laundryMonth = fallback
        laundrySource = weigh != null && weigh > 0 ? 'weighins' : 'expected'
      }
    }

    const elapsedFraction = partial
      ? Math.min(1, ((toMs(today) - toMs(m)) / DAY + 1) / ((toMs(monthEnd(m)) - toMs(m)) / DAY + 1))
      : 1
    let consumablesSource: PoolSource = 'average'
    let consumablesMonth: number
    const avg = trailingAverage(m, q => qboGroups(q).consumables)
    if (avg == null) {
      consumablesMonth = Math.max(g.consumables, partial || !q ? consumablesExpMonth : 0)
      consumablesSource = g.consumables >= consumablesMonth && q ? 'qbo' : 'expected'
    } else {
      consumablesMonth = avg * elapsedFraction
    }

    let leadershipMonth = g.leadership
    let otherCogsMonth = g.otherCogs
    let opexMonth = num(q?.total_expenses)
    if (partial) {
      leadershipMonth = Math.max(leadershipMonth, (trailingAverage(m, x => qboGroups(x).leadership) ?? 0) * elapsedFraction)
      otherCogsMonth = Math.max(otherCogsMonth, (trailingAverage(m, x => qboGroups(x).otherCogs) ?? 0) * elapsedFraction)
      const opexAvg = (trailingAverage(m, x => num(x.total_expenses)) ?? 0) * elapsedFraction
      if (opexAvg > opexMonth) {
        opexAccounts['(average, month in progress)'] = (opexAccounts['(average, month in progress)'] ?? 0) + (opexAvg - opexMonth) * share
        opexMonth = opexAvg
      }
    }

    monthShares.push({ month: m, share, partial, hasQbo: !!q, laundrySource, consumablesSource })
    if (q) anyQbo = true
    laundryQbo += g.laundry * share
    laundryPool += laundryMonth * share
    if (weigh != null) weighInsTotal += weigh * share
    consumablesQbo += g.consumables * share
    consumablesPool += consumablesMonth * share
    inspectionQbo += g.inspection * share
    leadership += leadershipMonth * share
    otherCogs += otherCogsMonth * share
    contractorQbo += g.contractor * share
    incomeQbo += num(q?.total_income) * share
    for (const [k, v] of Object.entries(q?.expense_breakdown ?? {})) {
      opexAccounts[k] = (opexAccounts[k] ?? 0) + num(v) * share
    }
    opex += opexMonth * share
    const cleaned = monthProps.get(m)
    if (g.inspection && cleaned?.size) {
      cleaned.forEach(id => addTo(inspectionQboByProp, id, (g.inspection * share) / cleaned.size))
    }
  }

  // ── Allocation ────────────────────────────────────────────────────────────
  const laundryActual = laundryPool + weekly.linen
  const overheadTotal = leadership + otherCogs + opex + weekly.other
  const weightOr = (w: number, cleans: number) => w || (cleans ? 1e-9 : 0)
  const laundryAlloc = allocate(laundryActual, new Map(Array.from(acc).map(([id, a]) => [id, weightOr(a.laundryExp, a.cleans)])))
  const consumablesAlloc = allocate(consumablesPool, new Map(Array.from(acc).map(([id, a]) => [id, weightOr(a.consumablesExp, a.cleans)])))
  const overheadAlloc = allocate(overheadTotal, new Map(Array.from(acc).map(([id, a]) => [id, a.cleans])))

  const rows: PropertyEconomics[] = []
  for (const [id, a] of Array.from(acc)) {
    const p = props.get(id)
    if (!p) continue
    const revenue = a.billedCleaning + a.billedExtras + a.estRevenue
    const labor = a.cleaningPay + a.extraPay + a.estPay
    const inspections = a.inspections + (inspectionByProp.get(id) ?? 0) + (inspectionQboByProp.get(id) ?? 0)
    const laundry = laundryAlloc.get(id) ?? 0
    const consumables = consumablesAlloc.get(id) ?? 0
    const overhead = overheadAlloc.get(id) ?? 0
    const totalCost = labor + inspections + laundry + consumables + overhead
    if (a.cleans === 0 && revenue === 0 && totalCost === 0 && a.notOnInvoice === 0) continue
    const profit = revenue - totalCost
    const row: PropertyEconomics = {
      property_id: id,
      name: p.name,
      stage: p.stage,
      rate: p.ce_charged,
      payRate: p.cleaner_pay,
      cleans: a.cleans,
      deepCleans: a.deep,
      cleansInvoiced: a.invoiced,
      cleansNotInvoiced: a.notInvoiced,
      notOnInvoice: a.notOnInvoice,
      notOnInvoiceBySource: a.notOnInvoiceBySource,
      expectedRevenue: a.expected,
      expectedInvoiced: a.expectedInv,
      billedCleaning: a.billedCleaning,
      billedExtras: a.billedExtras,
      estimatedRevenue: a.estRevenue,
      revenue,
      billingGap: a.billedCleaning - a.expectedInv,
      cleaningPay: a.cleaningPay,
      extraPay: a.extraPay,
      estimatedPay: a.estPay,
      labor,
      unbilledPay: a.unbilledPay,
      inspections,
      laundry,
      laundryExpected: a.laundryExp,
      consumables,
      consumablesExpected: a.consumablesExp,
      overhead,
      totalCost,
      profit,
      margin: revenue > 0 ? (profit / revenue) * 100 : null,
      reasons: [],
    }
    row.reasons = diagnose(row)
    rows.push(row)
  }

  const sum = (f: (r: PropertyEconomics) => number) => rows.reduce((s, r) => s + f(r), 0)
  const revenueTotal = sum(r => r.revenue)
  const totalCost = sum(r => r.totalCost)
  const company: CompanyEconomics = {
    cleans: inPeriod.length,
    properties: rows.filter(r => r.cleans > 0).length,
    cleansInvoiced: sum(r => r.cleansInvoiced),
    cleansNotInvoiced: sum(r => r.cleansNotInvoiced),
    notOnInvoice: sum(r => r.notOnInvoice),
    notOnInvoiceBySource,
    revenue: {
      expected: sum(r => r.expectedRevenue),
      expectedInvoiced: sum(r => r.expectedInvoiced),
      billedCleaning: sum(r => r.billedCleaning),
      billedExtras: sum(r => r.billedExtras),
      estimated: sum(r => r.estimatedRevenue),
      total: revenueTotal,
      qboIncome: anyQbo ? incomeQbo : null,
    },
    labor: {
      cleaning: sum(r => r.cleaningPay),
      extras: sum(r => r.extraPay),
      estimated: sum(r => r.estimatedPay),
      total: sum(r => r.labor),
      qboContractorPay: anyQbo ? contractorQbo : null,
    },
    inspections: {
      busyBee: weekly.inspection,
      qbo: inspectionQbo,
      direct: inspectionDirect,
      total: weekly.inspection + inspectionQbo + inspectionDirect,
      propertiesCleaned: new Set(inPeriod.map(c => c.property_id)).size,
      weeks: Array.from(inspectionWeeks.values()).sort((x, y) => x.weekEnd.localeCompare(y.weekEnd)),
    },
    laundry: {
      qbo: laundryQbo,
      weighIns: weighByMonth.size ? weighInsTotal : null,
      linenLabor: weekly.linen,
      actual: laundryActual,
      expected: sum(r => r.laundryExpected),
      diff: laundryActual - sum(r => r.laundryExpected),
    },
    consumables: {
      qbo: consumablesQbo,
      actual: consumablesPool,
      expected: sum(r => r.consumablesExpected),
      diff: consumablesPool - sum(r => r.consumablesExpected),
    },
    overhead: { leadership, otherCogs, opex, busyBeeOther: weekly.other, total: overheadTotal, opexAccounts },
    totalCost,
    profit: revenueTotal - totalCost,
    margin: revenueTotal > 0 ? ((revenueTotal - totalCost) / revenueTotal) * 100 : null,
    months: monthShares,
  }
  return { properties: rows, company }
}

const GAP_DOLLARS = 50
const GAP_PCT = 0.05

/** Why a property earns less than it should, largest dollar impact first. */
export function diagnose(r: PropertyEconomics): Reason[] {
  const out: Reason[] = []
  const rate = num(r.rate)
  const payRate = num(r.payRate)
  if (r.cleans > 0 && rate <= 0) out.push({ code: 'no_rate', amount: r.labor, count: r.cleans })
  if (rate > 0 && payRate >= rate && r.cleans > 0) {
    out.push({ code: 'rate_below_pay', amount: (payRate - rate) * r.cleans, count: r.cleans })
  }
  if (rate > 0 && payRate < rate && r.cleansInvoiced > 0 && r.cleaningPay > r.billedCleaning) {
    out.push({ code: 'pay_above_rate', amount: r.cleaningPay - r.billedCleaning, count: r.cleansInvoiced })
  }
  const gap = -r.billingGap
  if (r.expectedInvoiced > 0 && gap > Math.max(GAP_DOLLARS, GAP_PCT * r.expectedInvoiced)) {
    out.push({ code: 'billed_below_expected', amount: gap })
  }
  if (r.unbilledPay > 0) out.push({ code: 'unbilled_work', amount: r.unbilledPay })
  const shared = r.inspections + r.laundry + r.consumables + r.overhead
  if (r.revenue > 0 && shared > 0.35 * r.revenue) out.push({ code: 'allocated_costs', amount: shared })
  if (r.notOnInvoice > 0) out.push({ code: 'not_on_invoice', amount: r.notOnInvoice * rate, count: r.notOnInvoice })
  return out.sort((a, b) => b.amount - a.amount)
}
