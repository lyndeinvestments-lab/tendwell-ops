// Pure parsing helpers for QuickBooks Online ProfitAndLoss (and
// ProfitAndLossDetail) report JSON.
// No I/O — unit-tested against representative report shapes.
//
// A QBO report is a header + a Columns list + a recursive Rows tree:
// Section rows (with `group`: Income / COGS / Expenses / GrossProfit /
// NetIncome / NetOperatingIncome …) contain nested account Data rows and a
// Summary row whose ColData carries one money value per report column.
// With `summarize_column_by=Month` the money columns are months; with
// `summarize_column_by=Classes` they are class names (plus "Not Specified"
// and a trailing "Total" column).

export interface QboColData {
  value?: string
  id?: string
}

export interface QboRow {
  type?: string
  group?: string
  ColData?: QboColData[]
  Header?: { ColData?: QboColData[] }
  Summary?: { ColData?: QboColData[] }
  Rows?: { Row?: QboRow[] }
}

export interface QboReport {
  Header?: { StartPeriod?: string; EndPeriod?: string }
  Columns?: { Column?: Array<{ ColTitle?: string; ColType?: string; MetaData?: Array<{ Name?: string; Value?: string }> }> }
  Rows?: { Row?: QboRow[] }
}

export interface PlColumn {
  /** 0-based index into each row's ColData */
  index: number
  title: string
  startDate?: string
  endDate?: string
  /** Class id when the column represents a class (summarize_column_by=Classes) */
  colKey?: string
}

/** Money columns of the report, in order (skips the leading label column). */
export function moneyColumns(report: QboReport): PlColumn[] {
  const cols = report.Columns?.Column ?? []
  const out: PlColumn[] = []
  cols.forEach((c, i) => {
    if ((c.ColType ?? '') !== 'Money') return
    const meta = new Map((c.MetaData ?? []).map(m => [m.Name ?? '', m.Value ?? '']))
    out.push({
      index: i,
      title: c.ColTitle ?? '',
      startDate: meta.get('StartDate'),
      endDate: meta.get('EndDate'),
      colKey: meta.get('ColKey'),
    })
  })
  return out
}

export function parseMoney(v: string | undefined): number {
  if (v == null || v === '') return 0
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function walk(rows: QboRow[] | undefined, visit: (row: QboRow) => void) {
  for (const r of rows ?? []) {
    visit(r)
    walk(r.Rows?.Row, visit)
  }
}

/**
 * Per-money-column totals of a section, identified by its `group`
 * (e.g. 'Income', 'COGS', 'Expenses', 'NetIncome', 'GrossProfit').
 * Returns null when the section is absent from the report.
 */
export function sectionTotals(report: QboReport, group: string): number[] | null {
  let found: number[] | null = null
  walk(report.Rows?.Row, row => {
    if (found || row.group !== group) return
    const colData = row.Summary?.ColData ?? row.ColData
    if (!colData) return
    found = moneyColumns(report).map(c => parseMoney(colData[c.index]?.value))
  })
  return found
}

/**
 * Leaf account rows of a section: [{ name, values[] }] with one value per
 * money column. Nested sub-account sections contribute their own leaf rows
 * (their section subtotals are skipped so nothing double-counts).
 */
export function accountRows(report: QboReport, group: string): Array<{ name: string; values: number[] }> {
  const cols = moneyColumns(report)
  const out: Array<{ name: string; values: number[] }> = []
  let sectionRow: QboRow | null = null
  walk(report.Rows?.Row, row => {
    if (!sectionRow && row.group === group) sectionRow = row
  })
  if (!sectionRow) return out
  walk((sectionRow as QboRow).Rows?.Row, row => {
    if (row.type !== 'Data' || !row.ColData?.length) return
    const name = row.ColData[0]?.value ?? ''
    if (!name) return
    out.push({ name, values: cols.map(c => parseMoney(row.ColData?.[c.index]?.value)) })
  })
  return out
}

/** 'YYYY-MM-01' for a money column, from its StartDate metadata. */
export function columnMonth(col: PlColumn): string | null {
  if (!col.startDate) return null
  const m = /^(\d{4})-(\d{2})/.exec(col.startDate)
  return m ? `${m[1]}-${m[2]}-01` : null
}

// ── ProfitAndLossDetail ─────────────────────────────────────────────────────
// The detail report has one column per transaction field (tx_date, name,
// subt_nat_amount …, identified by ColKey metadata) and the same Section tree
// as the summary report, but its Data rows are individual transactions
// nested under the account (and sub-account) they posted to.

export type VendorSection = 'Income' | 'COGS' | 'Expenses' | 'OtherIncome' | 'OtherExpenses'

export interface VendorExpenseRow {
  /** 'YYYY-MM-01' of the transaction date */
  month: string
  section: VendorSection
  account: string
  vendor: string
  amount: number
  txn_count: number
}

export const NO_VENDOR = '(no vendor)'

const VENDOR_SECTIONS = new Set<string>(['Income', 'COGS', 'Expenses', 'OtherIncome', 'OtherExpenses'])

/** Index of a detail-report column by ColKey, falling back to its title. */
function detailColumn(report: QboReport, colKey: string, title: string): number {
  const cols = report.Columns?.Column ?? []
  const byKey = cols.findIndex(c => (c.MetaData ?? []).some(m => m.Name === 'ColKey' && m.Value === colKey))
  if (byKey >= 0) return byKey
  return cols.findIndex(c => (c.ColTitle ?? '').trim().toLowerCase() === title.toLowerCase())
}

function headerText(row: QboRow): string {
  return (row.Header?.ColData?.[0]?.value ?? '').trim()
}

/** Top-level section of a row: its `group`, else inferred from the header label. */
function sectionOf(row: QboRow): VendorSection | null {
  if (row.group) return VENDOR_SECTIONS.has(row.group) ? (row.group as VendorSection) : null
  const label = headerText(row)
  if (/cost of goods/i.test(label)) return 'COGS'
  if (/other income/i.test(label)) return 'OtherIncome'
  if (/other expense/i.test(label)) return 'OtherExpenses'
  if (/^income/i.test(label)) return 'Income'
  if (/^expense/i.test(label)) return 'Expenses'
  return null
}

/** 'YYYY-MM-01' from 'YYYY-MM-DD' (QBO JSON) or 'MM/DD/YYYY'. */
function txnMonth(v: string | undefined): string | null {
  const s = (v ?? '').trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}-01` : null
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${m[3]}-${m[1].padStart(2, '0')}-01` : null
  return null
}

/**
 * Aggregate a ProfitAndLossDetail report into one row per
 * (transaction month, top-level section, innermost account, vendor).
 * Computed sections (GrossProfit, NetIncome …) are skipped; rows whose date
 * does not parse (e.g. balance lines) are skipped; amounts are rounded to
 * cents after summing.
 */
export function vendorExpenseRows(report: QboReport): VendorExpenseRow[] {
  const dateIdx = detailColumn(report, 'tx_date', 'Date')
  const nameIdx = detailColumn(report, 'name', 'Name')
  const amtIdx = detailColumn(report, 'subt_nat_amount', 'Amount')
  if (dateIdx < 0 || amtIdx < 0) return []

  const agg = new Map<string, VendorExpenseRow>()

  const collect = (rows: QboRow[] | undefined, section: VendorSection, account: string) => {
    for (const row of rows ?? []) {
      if (row.Rows?.Row || row.Header) {
        collect(row.Rows?.Row, section, headerText(row) || account)
        continue
      }
      if (row.type !== 'Data' || !row.ColData) continue
      const month = txnMonth(row.ColData[dateIdx]?.value)
      if (!month) continue
      const vendor = (nameIdx >= 0 ? row.ColData[nameIdx]?.value ?? '' : '').trim() || NO_VENDOR
      const amount = parseMoney(row.ColData[amtIdx]?.value)
      const key = [month, section, account, vendor].join('\u0000')
      const cur = agg.get(key)
      if (cur) {
        cur.amount += amount
        cur.txn_count++
      } else {
        agg.set(key, { month, section, account, vendor, amount, txn_count: 1 })
      }
    }
  }

  const findSections = (rows: QboRow[] | undefined) => {
    for (const row of rows ?? []) {
      const section = sectionOf(row)
      if (section) collect(row.Rows?.Row, section, headerText(row) || section)
      else if (!row.group) findSections(row.Rows?.Row)
    }
  }
  findSections(report.Rows?.Row)

  return [...agg.values()]
    .map(r => ({ ...r, amount: Math.round(r.amount * 100) / 100 }))
    .sort((a, b) =>
      a.month.localeCompare(b.month) || a.section.localeCompare(b.section) ||
      a.account.localeCompare(b.account) || a.vendor.localeCompare(b.vendor))
}
