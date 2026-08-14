import { describe, expect, it } from 'vitest'
import { fmtUsd, fmtUsDate, sanitizeCell, toBillComCsv, toQboFlatCsv, toQboMultilineCsv, toRampCsv, type ExportLine, type ExportRun } from './_exporters.js'

const RUN: ExportRun = {
  vendorName: 'Busy Bee Cleaning',
  vendorInvoiceNumber: 'I260810795',
  invoiceDate: '2026-08-09',
  dueDate: '2026-08-09',
  qboInvoiceNo: 1001,
  periodEnd: '2026-08-09',
}

const LINES: ExportLine[] = [
  {
    lineKind: 'clean',
    serviceType: 'Departure Clean',
    serviceDate: '2026-08-05',
    propertyName: 'Michael Rohwer 2455',
    clientName: 'Haven Vacation Rentals',
    billingChannel: 'qbo_haven',
    cleanerPayAmount: 100,
    clientChargeAmount: 1150.5,
    note: null,
    reviewStatus: 'ok',
  },
  {
    lineKind: 'clean',
    serviceType: 'Turn Clean',
    serviceDate: '2026-08-06',
    propertyName: 'Ctn Black Bear Cub',
    clientName: 'Jane Owner',
    billingChannel: 'bill_com',
    cleanerPayAmount: 80,
    clientChargeAmount: 120,
    note: null,
    reviewStatus: 'ok',
  },
  {
    lineKind: 'operating_expense',
    serviceType: null,
    serviceDate: null,
    propertyName: null,
    clientName: null,
    billingChannel: 'none',
    cleanerPayAmount: 250,
    clientChargeAmount: null,
    note: 'Toilet paper restock',
    reviewStatus: 'ok',
  },
  {
    lineKind: 'excluded',
    serviceType: null,
    serviceDate: null,
    propertyName: 'Michael Rohwer 2455',
    clientName: 'Haven Vacation Rentals',
    billingChannel: 'qbo_haven',
    cleanerPayAmount: null,
    clientChargeAmount: null,
    note: 'Air Filter Change',
    reviewStatus: 'excluded',
  },
]

describe('sanitizeCell — CSV formula-injection guard', () => {
  it('neutralizes formula-leading characters with a leading space (import-safe, unlike apostrophe)', () => {
    expect(sanitizeCell('=HYPERLINK("http://evil","x")')).toBe(` =HYPERLINK("http://evil","x")`)
    expect(sanitizeCell('+1+1')).toBe(` +1+1`)
    expect(sanitizeCell('@SUM(A1)')).toBe(` @SUM(A1)`)
    expect(sanitizeCell('\tcmd')).toBe(` \tcmd`)
    expect(sanitizeCell('-2+3+cmd|/c calc!A0')).toBe(` -2+3+cmd|/c calc!A0`)
  })
  it('leaves plain text and negative numbers alone', () => {
    expect(sanitizeCell('Michael Rohwer 2455')).toBe('Michael Rohwer 2455')
    expect(sanitizeCell('-42.10')).toBe('-42.10')
    expect(sanitizeCell('')).toBe('')
  })
  it('never bakes a literal apostrophe into import-bound files', () => {
    expect(sanitizeCell('=1+1')[0]).toBe(' ')
    expect(sanitizeCell('-CR-1042')).toBe(' -CR-1042')
  })
  it('guards description cells that BEGIN with vendor note text (the executable case)', () => {
    // Formula execution only happens when the cell's first character is a
    // formula char — a note-only line (no service/property prefix) is the
    // dangerous shape.
    const evil: ExportLine = {
      ...LINES[0],
      serviceType: null,
      propertyName: null,
      note: '=cmd|/c calc!A0',
    }
    for (const csv of [
      toRampCsv(RUN, [evil]),
      toQboMultilineCsv(RUN, [evil]),
      toBillComCsv(RUN, [{ ...evil, billingChannel: 'bill_com' }]),
    ]) {
      expect(csv).toContain(` =cmd`)
      expect(csv).not.toMatch(/(^|,|")=cmd/m)
    }
  })

  it('guards vendor-supplied invoice numbers and property/class names', () => {
    const evilRun: ExportRun = { ...RUN, vendorInvoiceNumber: '=1+1' }
    const evilLine: ExportLine = { ...LINES[0], propertyName: '@SUM(A1)' }
    const ramp = toRampCsv(evilRun, [evilLine])
    expect(ramp).toContain(` =1+1`)
    expect(ramp).toContain(` @SUM(A1)`)
    expect(ramp).not.toMatch(/(^|,|")[=@]/m)
    const flat = toQboFlatCsv(RUN, [evilLine])
    expect(flat).toContain(` @SUM(A1)`)
  })
})

describe('fmtUsd / fmtUsDate', () => {
  it('formats $#,##0.00', () => {
    expect(fmtUsd(1150.5)).toBe('$1,150.50')
    expect(fmtUsd(0)).toBe('$0.00')
    expect(fmtUsd(-42.1)).toBe('-$42.10')
    expect(fmtUsd(1234567.891)).toBe('$1,234,567.89')
  })
  it('formats MM/DD/YYYY', () => {
    expect(fmtUsDate('2026-08-09')).toBe('08/09/2026')
    expect(fmtUsDate(null)).toBe('')
  })
})

describe('toRampCsv', () => {
  const csv = toRampCsv(RUN, LINES)
  const rows = csv.split('\r\n')

  it('uses \\r\\n and the exact Ramp header', () => {
    expect(rows[0]).toBe(
      'Vendor name,Description (optional),Invoice number,Invoice date,Accounting date (optional),Due date,Currency,Line item amount,QuickBooks Category (optional),QuickBooks Billable (optional),QuickBooks Class (optional),QuickBooks Customer/Job (optional),Line item description,Inventory line item quantity,Inventory line item rate,QuickBooks Inventory Item (optional),Vendor memo (optional),Payment method (optional)',
    )
  })
  it('includes AP lines (cleans + operating expenses), excludes excluded lines', () => {
    expect(rows).toHaveLength(1 + 3) // header + 2 cleans + 1 op-exp
    expect(csv).toContain('250.00')
    expect(csv).not.toContain('Air Filter Change')
  })
  it('repeats vendor/invoice header fields on every row', () => {
    for (const row of rows.slice(1)) {
      expect(row.startsWith('Busy Bee Cleaning,')).toBe(true)
      expect(row).toContain('I260810795')
      expect(row).toContain('USD')
    }
  })
})

describe('toQboFlatCsv', () => {
  const csv = toQboFlatCsv(RUN, LINES)
  const rows = csv.split('\r\n')

  it('emits only qbo_haven AR lines with Customer=Haven', () => {
    expect(rows[0]).toBe('Service,Service Date,Description,Amount,Class,Invoice No.,Customer,Invoice Date,Due Date')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toContain('Haven')
    expect(rows[1]).not.toContain('Jane Owner')
  })
  it('formats amounts as quoted $#,##0.00 at Client Charged', () => {
    expect(rows[1]).toContain('"$1,150.50"')
  })
  it('uses the sequential QBO invoice number, not the vendor invoice number', () => {
    expect(rows[1]).toContain('1001')
    expect(rows[1]).not.toContain('I260810795')
  })
})

describe('toQboMultilineCsv', () => {
  const csv = toQboMultilineCsv(RUN, LINES)
  const rows = csv.split('\r\n')

  it('puts customer/dates only on the first row of the invoice group', () => {
    expect(rows[0]).toBe('*InvoiceNo,*Customer,*InvoiceDate,*DueDate,Terms,Location,Memo,Item(Product/Service),ItemDescription,ItemQuantity,ItemRate,*ItemAmount,Service Date')
    expect(rows[1].startsWith('1001,Haven,08/09/2026,08/09/2026,Due on receipt')).toBe(true)
  })
  it('excludes non-Haven and non-AR lines', () => {
    expect(csv).not.toContain('Ctn Black Bear Cub')
    expect(csv).not.toContain('Toilet paper')
  })
})

describe('toBillComCsv', () => {
  const csv = toBillComCsv(RUN, LINES)
  const rows = csv.split('\r\n')

  it('emits only bill_com AR lines, keyed by client', () => {
    expect(rows).toHaveLength(2)
    expect(rows[1]).toContain('Jane Owner')
    expect(rows[1]).toContain('Ctn Black Bear Cub')
    expect(rows[1]).toContain('120.00')
    expect(csv).not.toContain('Haven Vacation Rentals')
  })
})
