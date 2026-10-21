import { describe, it, expect } from 'vitest'
import { moneyColumns, sectionTotals, accountRows, columnMonth, parseMoney, vendorExpenseRows, type QboReport } from './_pl-parse'

// Shaped like a real QBO ProfitAndLoss report: label column + money columns,
// Section rows with nested Data rows (one nested sub-section) and Summary
// rows, plus GrossProfit / NetIncome summary-only sections.
const REPORT: QboReport = {
  Header: { StartPeriod: '2026-07-01', EndPeriod: '2026-08-31' },
  Columns: {
    Column: [
      { ColTitle: '', ColType: 'Account' },
      { ColTitle: 'Jul 2026', ColType: 'Money', MetaData: [{ Name: 'StartDate', Value: '2026-07-01' }, { Name: 'EndDate', Value: '2026-07-31' }] },
      { ColTitle: 'Aug 2026', ColType: 'Money', MetaData: [{ Name: 'StartDate', Value: '2026-08-01' }, { Name: 'EndDate', Value: '2026-08-28' }] },
      { ColTitle: 'Total', ColType: 'Money' },
    ],
  },
  Rows: {
    Row: [
      {
        type: 'Section',
        group: 'Income',
        Header: { ColData: [{ value: 'Income' }, { value: '' }, { value: '' }, { value: '' }] },
        Rows: {
          Row: [
            { type: 'Data', ColData: [{ value: 'Turn Clean', id: '81' }, { value: '40000.00' }, { value: '30000.00' }, { value: '70000.00' }] },
            {
              type: 'Section',
              Header: { ColData: [{ value: 'Cleaning fee' }, { value: '' }, { value: '' }, { value: '' }] },
              Rows: {
                Row: [
                  { type: 'Data', ColData: [{ value: 'Deep clean fee', id: '82' }, { value: '5,000.00' }, { value: '2500.00' }, { value: '7500.00' }] },
                ],
              },
              Summary: { ColData: [{ value: 'Total Cleaning fee' }, { value: '5000.00' }, { value: '2500.00' }, { value: '7500.00' }] },
            },
          ],
        },
        Summary: { ColData: [{ value: 'Total Income' }, { value: '45000.00' }, { value: '32500.00' }, { value: '77500.00' }] },
      },
      {
        type: 'Section',
        group: 'COGS',
        Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Cleaning Contractor Pay' }, { value: '20000.00' }, { value: '15000.00' }, { value: '35000.00' }] }] },
        Summary: { ColData: [{ value: 'Total COGS' }, { value: '20000.00' }, { value: '15000.00' }, { value: '35000.00' }] },
      },
      { type: 'Section', group: 'GrossProfit', Summary: { ColData: [{ value: 'Gross Profit' }, { value: '25000.00' }, { value: '17500.00' }, { value: '42500.00' }] } },
      {
        type: 'Section',
        group: 'Expenses',
        Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Office expenses' }, { value: '1000.00' }, { value: '' }, { value: '1000.00' }] }] },
        Summary: { ColData: [{ value: 'Total Expenses' }, { value: '1000.00' }, { value: '0.00' }, { value: '1000.00' }] },
      },
      { type: 'Section', group: 'NetIncome', Summary: { ColData: [{ value: 'Net Income' }, { value: '24000.00' }, { value: '17500.00' }, { value: '41500.00' }] } },
    ],
  },
}

describe('moneyColumns', () => {
  it('returns money columns with month metadata, skipping the label column', () => {
    const cols = moneyColumns(REPORT)
    expect(cols.map(c => c.title)).toEqual(['Jul 2026', 'Aug 2026', 'Total'])
    expect(cols[0].index).toBe(1)
    expect(columnMonth(cols[0])).toBe('2026-07-01')
    expect(columnMonth(cols[1])).toBe('2026-08-01')
    expect(columnMonth(cols[2])).toBeNull()
  })
})

describe('sectionTotals', () => {
  it('reads section summary rows per money column', () => {
    expect(sectionTotals(REPORT, 'Income')).toEqual([45000, 32500, 77500])
    expect(sectionTotals(REPORT, 'NetIncome')).toEqual([24000, 17500, 41500])
    expect(sectionTotals(REPORT, 'GrossProfit')).toEqual([25000, 17500, 42500])
  })
  it('returns null for a section the report does not have', () => {
    expect(sectionTotals(REPORT, 'OtherIncome')).toBeNull()
  })
})

describe('accountRows', () => {
  it('collects leaf account rows, including inside nested sub-sections, without subtotal rows', () => {
    const rows = accountRows(REPORT, 'Income')
    expect(rows.map(r => r.name)).toEqual(['Turn Clean', 'Deep clean fee'])
    // Comma-formatted values parse
    expect(rows[1].values).toEqual([5000, 2500, 7500])
    // Leaf sum equals the section total (nothing double-counted)
    const jul = rows.reduce((s, r) => s + r.values[0], 0)
    expect(jul).toBe(45000)
  })
  it('empty ColData cells parse as 0', () => {
    const rows = accountRows(REPORT, 'Expenses')
    expect(rows[0].values).toEqual([1000, 0, 1000])
  })
})

describe('parseMoney', () => {
  it('handles commas, blanks, and garbage', () => {
    expect(parseMoney('1,234.56')).toBe(1234.56)
    expect(parseMoney('')).toBe(0)
    expect(parseMoney(undefined)).toBe(0)
    expect(parseMoney('N/A')).toBe(0)
  })
})

// ── ProfitAndLossDetail ─────────────────────────────────────────────────────

const DETAIL_COLUMNS = [
  ['Date', 'Date', 'tx_date'],
  ['Transaction Type', 'String', 'txn_type'],
  ['Num', 'String', 'doc_num'],
  ['Name', 'String', 'name'],
  ['Memo/Description', 'String', 'memo'],
  ['Split', 'String', 'split_acc'],
  ['Amount', 'Money', 'subt_nat_amount'],
  ['Balance', 'Money', 'rbal_nat_amount'],
] as const

const txn = (date: string, type: string, name: string, amount: string) => ({
  type: 'Data',
  ColData: [
    { value: date }, { value: type }, { value: '' }, { value: name, id: name ? '1' : '' },
    { value: '' }, { value: 'Checking' }, { value: amount }, { value: '0.00' },
  ],
})

const hdr = (label: string) => ({ ColData: [{ value: label }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }] })
const sum = (label: string, amount: string) => ({ ColData: [{ value: label }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: amount }, { value: '' }] })

// Shaped like a real QBO ProfitAndLossDetail report: Income with a nested
// sub-account, COGS with transactions both directly under the section label
// and under accounts, a summary-only GrossProfit section, Expenses with a
// blank-name transaction, and transactions across two months.
const DETAIL: QboReport = {
  Header: { StartPeriod: '2026-07-01', EndPeriod: '2026-08-31' },
  Columns: { Column: DETAIL_COLUMNS.map(([title, type, key]) => ({ ColTitle: title, ColType: type, MetaData: [{ Name: 'ColKey', Value: key }] })) },
  Rows: {
    Row: [
      {
        type: 'Section',
        group: 'Income',
        Header: hdr('Income'),
        Rows: {
          Row: [
            {
              type: 'Section',
              Header: hdr('Cleaning Services'),
              Rows: {
                Row: [
                  txn('2026-07-15', 'Invoice', 'Haven Vacation Rentals', '1,200.00'),
                  {
                    type: 'Section',
                    Header: hdr('Deep Clean'),
                    Rows: { Row: [txn('2026-07-20', 'Invoice', 'Haven Vacation Rentals', '300.00')] },
                    Summary: sum('Total Deep Clean', '300.00'),
                  },
                ],
              },
              Summary: sum('Total Cleaning Services', '1500.00'),
            },
          ],
        },
        Summary: sum('Total Income', '1500.00'),
      },
      {
        type: 'Section',
        group: 'COGS',
        Header: hdr('Cost of Goods Sold'),
        Rows: {
          Row: [
            txn('2026-08-02', 'Bill', 'Misc Vendor', '10.00'),
            {
              type: 'Section',
              Header: hdr('Laundry'),
              Rows: {
                Row: [
                  txn('2026-07-05', 'Bill', 'Blessed', '100.10'),
                  txn('2026-07-12', 'Bill', 'Blessed', '200.20'),
                  txn('2026-07-19', 'Bill', 'Blessed', '0.03'),
                  txn('2026-08-03', 'Bill', 'Blessed', '150.00'),
                ],
              },
              Summary: sum('Total Laundry', '450.33'),
            },
            {
              type: 'Section',
              Header: hdr('Cleaning Supplies'),
              Rows: {
                Row: [
                  txn('2026-08-09', 'Expense', 'Hospitality Depot', '75.50'),
                  txn('2026-08-10', 'Vendor Credit', 'Hospitality Depot', '-5.50'),
                ],
              },
              Summary: sum('Total Cleaning Supplies', '70.00'),
            },
          ],
        },
        Summary: sum('Total Cost of Goods Sold', '530.33'),
      },
      { type: 'Section', group: 'GrossProfit', Summary: sum('Gross Profit', '969.67') },
      {
        type: 'Section',
        group: 'Expenses',
        Header: hdr('Expenses'),
        Rows: {
          Row: [
            {
              type: 'Section',
              Header: hdr('Bank Charges'),
              Rows: {
                Row: [
                  txn('2026-08-31', 'Expense', '', '12.00'),
                  txn('2026-08-15', 'Expense', '   ', '3.00'),
                  // Non-date rows (e.g. balance lines) are skipped
                  txn('', 'Beginning Balance', '', '999.00'),
                ],
              },
              Summary: sum('Total Bank Charges', '15.00'),
            },
          ],
        },
        Summary: sum('Total Expenses', '15.00'),
      },
      { type: 'Section', group: 'NetIncome', Summary: sum('Net Income', '954.67') },
    ],
  },
}

describe('vendorExpenseRows', () => {
  const rows = vendorExpenseRows(DETAIL)
  const find = (month: string, account: string, vendor: string) =>
    rows.find(r => r.month === month && r.account === account && r.vendor === vendor)

  it('aggregates transactions by month, section, innermost account, and vendor', () => {
    expect(rows).toEqual([
      { month: '2026-07-01', section: 'COGS', account: 'Laundry', vendor: 'Blessed', amount: 300.33, txn_count: 3 },
      { month: '2026-07-01', section: 'Income', account: 'Cleaning Services', vendor: 'Haven Vacation Rentals', amount: 1200, txn_count: 1 },
      { month: '2026-07-01', section: 'Income', account: 'Deep Clean', vendor: 'Haven Vacation Rentals', amount: 300, txn_count: 1 },
      { month: '2026-08-01', section: 'COGS', account: 'Cleaning Supplies', vendor: 'Hospitality Depot', amount: 70, txn_count: 2 },
      { month: '2026-08-01', section: 'COGS', account: 'Cost of Goods Sold', vendor: 'Misc Vendor', amount: 10, txn_count: 1 },
      { month: '2026-08-01', section: 'COGS', account: 'Laundry', vendor: 'Blessed', amount: 150, txn_count: 1 },
      { month: '2026-08-01', section: 'Expenses', account: 'Bank Charges', vendor: '(no vendor)', amount: 15, txn_count: 2 },
    ])
  })

  it('rounds summed amounts to cents', () => {
    // 100.10 + 200.20 + 0.03 is 300.33000000000004 in floating point
    expect(find('2026-07-01', 'Laundry', 'Blessed')?.amount).toBe(300.33)
  })

  it('uses the innermost header for nested sub-accounts and the section label for direct rows', () => {
    expect(find('2026-07-01', 'Deep Clean', 'Haven Vacation Rentals')).toBeTruthy()
    expect(find('2026-07-01', 'Cleaning Services', 'Haven Vacation Rentals')?.amount).toBe(1200)
    expect(find('2026-08-01', 'Cost of Goods Sold', 'Misc Vendor')?.section).toBe('COGS')
  })

  it('nets credits, maps blank vendors, skips undated rows and computed sections', () => {
    expect(find('2026-08-01', 'Cleaning Supplies', 'Hospitality Depot')?.amount).toBe(70)
    expect(find('2026-08-01', 'Bank Charges', '(no vendor)')).toMatchObject({ amount: 15, txn_count: 2 })
    expect(rows.some(r => r.amount === 999)).toBe(false)
    expect(rows.map(r => r.section).every(s => ['Income', 'COGS', 'Expenses'].includes(s))).toBe(true)
  })

  it('locates columns by ColKey, not position', () => {
    // Same report with Name/Amount swapped and titles blanked
    const order = [0, 6, 2, 5, 4, 3, 1, 7]
    const remap = (cd: Array<{ value?: string }>) => order.map(i => cd[i])
    const reshape = (rs: any[] | undefined): any[] | undefined => rs?.map(r => ({
      ...r,
      ...(r.ColData ? { ColData: remap(r.ColData) } : {}),
      ...(r.Header ? { Header: { ColData: remap(r.Header.ColData) } } : {}),
      ...(r.Rows ? { Rows: { Row: reshape(r.Rows.Row) } } : {}),
    }))
    const shuffled: QboReport = {
      Columns: { Column: order.map(i => ({ ColTitle: '', ColType: DETAIL_COLUMNS[i][1], MetaData: [{ Name: 'ColKey', Value: DETAIL_COLUMNS[i][2] }] })) },
      Rows: { Row: reshape(DETAIL.Rows?.Row) },
    }
    expect(vendorExpenseRows(shuffled)).toEqual(rows)
  })

  it('falls back to column titles when ColKey metadata is missing', () => {
    const noMeta: QboReport = { ...DETAIL, Columns: { Column: DETAIL_COLUMNS.map(([title, type]) => ({ ColTitle: title, ColType: type })) } }
    expect(vendorExpenseRows(noMeta)).toEqual(rows)
  })

  it('infers the section from the header label when group is missing', () => {
    const noGroup: QboReport = {
      ...DETAIL,
      Rows: {
        Row: [
          {
            type: 'Section',
            Header: hdr('Other Expenses'),
            Rows: { Row: [{ type: 'Section', Header: hdr('Penalties'), Rows: { Row: [txn('2026-08-01', 'Expense', 'IRS', '50.00')] } }] },
          },
          {
            type: 'Section',
            Header: hdr('Cost of Goods Sold'),
            Rows: { Row: [txn('08/14/2026', 'Bill', 'Blessed', '20.00')] },
          },
        ],
      },
    }
    expect(vendorExpenseRows(noGroup)).toEqual([
      { month: '2026-08-01', section: 'COGS', account: 'Cost of Goods Sold', vendor: 'Blessed', amount: 20, txn_count: 1 },
      { month: '2026-08-01', section: 'OtherExpenses', account: 'Penalties', vendor: 'IRS', amount: 50, txn_count: 1 },
    ])
  })

  it('returns nothing when the report has no date or amount column', () => {
    expect(vendorExpenseRows({ Columns: { Column: [] }, Rows: DETAIL.Rows })).toEqual([])
  })
})
