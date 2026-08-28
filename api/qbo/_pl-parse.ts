// Pure parsing helpers for QuickBooks Online ProfitAndLoss report JSON.
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
