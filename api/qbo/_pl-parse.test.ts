import { describe, it, expect } from 'vitest'
import { moneyColumns, sectionTotals, accountRows, columnMonth, parseMoney, type QboReport } from './_pl-parse'

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
