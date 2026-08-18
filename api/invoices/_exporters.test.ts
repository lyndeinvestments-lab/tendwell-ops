import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { fmtUsd, fmtUsDate, qboClassFor, sanitizeCell, serviceTitle, toBillComCsv, toQboFlatCsv, toQboMultilineCsv, toRampCsv, type ExportLine, type ExportRun } from './_exporters.js'

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

describe('serviceTitle — reason-required extras carry their reason', () => {
  const petFee: ExportLine = {
    ...LINES[0],
    lineKind: 'extra',
    serviceType: 'Pet Fee',
    clientChargeAmount: 50,
    note: 'Pet fee — excess dog hair',
  }

  it('appends the vendor-stated reason in parentheses', () => {
    expect(serviceTitle(petFee)).toBe('Pet Fee (excess dog hair)')
  })
  it('prefers the human review note over the derived reason', () => {
    expect(serviceTitle({ ...petFee, reviewNote: 'dog hair on all furniture' })).toBe('Pet Fee (dog hair on all furniture)')
  })
  it('leaves non-reason-required titles untouched', () => {
    expect(serviceTitle({ ...petFee, serviceType: 'Excessive Trash Pickup', note: 'so much trash' })).toBe('Excessive Trash Pickup')
  })
  it('falls back to the bare title when no reason exists (already human-approved upstream)', () => {
    expect(serviceTitle({ ...petFee, note: null })).toBe('Pet Fee')
  })
  it('lands in the QBO flat Service column like Nina’s real sheet', () => {
    const csv = toQboFlatCsv(RUN, [petFee])
    expect(csv.split('\r\n')[1].startsWith('Pet Fee (excess dog hair),')).toBe(true)
  })
  it('lands in the bill.com worksheet Service column', () => {
    const csv = toBillComCsv(RUN, [{ ...petFee, billingChannel: 'bill_com' }])
    expect(csv).toContain('Pet Fee (excess dog hair)')
  })
  it('keeps the QBO multiline Item column canonical (reason goes to ItemDescription)', () => {
    const csv = toQboMultilineCsv(RUN, [petFee])
    const row = csv.split('\r\n')[1]
    expect(row).toContain(',Pet Fee,')
    expect(row).toContain('excess dog hair')
  })
})

describe('splits are QBO-only; descriptions never repeat other columns', () => {
  const base: ExportLine = {
    ...LINES[0], lineKind: 'combined_split', serviceType: 'Onboarding Clean',
    cleanerPayAmount: 155, clientChargeAmount: 260, note: 'Regular clean plus 205', splitGroup: 7,
  }
  const surcharge: ExportLine = {
    ...LINES[0], lineKind: 'extra', serviceType: 'Onboarding Clean',
    cleanerPayAmount: 50, clientChargeAmount: 50, note: 'Onboarding surcharge', splitGroup: 7,
  }

  it('Ramp collapses a split group to ONE line paying the combined amount', () => {
    const rows = Papa.parse<string[]>(toRampCsv(RUN, [base, surcharge]).trim()).data
    expect(rows).toHaveLength(2) // header + 1 merged line
    expect(rows[1][7]).toBe('205.00') // 155 + 50
  })
  it('bill.com collapses a split group to ONE line billing the combined amount', () => {
    const bc = [{ ...base, billingChannel: 'bill_com' as const }, { ...surcharge, billingChannel: 'bill_com' as const }]
    const rows = Papa.parse<string[]>(toBillComCsv(RUN, bc).trim()).data
    expect(rows).toHaveLength(2)
    expect(rows[1][7]).toBe('310.00') // 260 + 50
  })
  it('QBO multiline keeps BOTH split rows and hides vendor pricing notes from descriptions', () => {
    const rows = Papa.parse<string[]>(toQboMultilineCsv(RUN, [base, surcharge]).trim()).data
    expect(rows).toHaveLength(3) // header + base + surcharge
    const descs = [rows[1][8], rows[2][8]]
    expect(descs.every(d => d === 'Michael Rohwer 2455')).toBe(true) // property only
    expect(rows.flat().join(',')).not.toContain('Regular clean plus 205')
  })
  it('QBO multiline still shows the reason for reason-required extras', () => {
    const pet: ExportLine = { ...LINES[0], lineKind: 'extra', serviceType: 'Pet Fee', note: 'Pet fee — excess dog hair' }
    const row = Papa.parse<string[]>(toQboMultilineCsv(RUN, [pet]).trim()).data[1]
    expect(row[8]).toBe('Michael Rohwer 2455 (excess dog hair)')
  })
})

describe('qboClassFor — Class column only names classes that exist in QBO', () => {
  const cls = (name: string, matchedPropertyId: number | null = null) => ({ name, matchedPropertyId })
  const CLASSES = [cls('Michael Rohwer 2455'), cls('Brian Albaum'), cls('Adam Pike 1071'), cls('Stephanie Keegan 1260-5307')]

  it('exact match (case-insensitive), returning the class’s own spelling', () => {
    expect(qboClassFor('Michael Rohwer 2455', 1, CLASSES)).toBe('Michael Rohwer 2455')
    expect(qboClassFor('michael rohwer 2455', 1, CLASSES)).toBe('Michael Rohwer 2455')
  })
  it('unique word-boundary prefix match (Nina’s "Brian Albaum" for property "Brian Albaum 442")', () => {
    expect(qboClassFor('Brian Albaum 442', 2, CLASSES)).toBe('Brian Albaum')
  })
  it('unknown property → blank, exactly like Nina’s sheet', () => {
    expect(qboClassFor('Kevin Parrish 3836', 3, CLASSES)).toBe('')
  })
  it('MANUAL link wins over everything, even a would-be exact match elsewhere', () => {
    const withLink = [cls('Totally Different Class', 3), ...CLASSES]
    expect(qboClassFor('Kevin Parrish 3836', 3, withLink)).toBe('Totally Different Class')
    // manual link beats name matching for the linked property…
    expect(qboClassFor('Michael Rohwer 2455', 1, [cls('Override Class', 1), ...CLASSES])).toBe('Override Class')
    // …but other properties are unaffected
    expect(qboClassFor('Michael Rohwer 2455', 1, withLink)).toBe('Michael Rohwer 2455')
  })
  it('manual link needs a property id — id-less lines fall through to name matching', () => {
    expect(qboClassFor('Kevin Parrish 3836', null, [cls('Linked Class', 3), ...CLASSES])).toBe('')
  })
  it('ambiguous prefix → blank, never a guess', () => {
    const ambiguous = [cls('Brian Albaum'), cls('Brian Albaum 442')]
    expect(qboClassFor('Brian Albaum 442 Unit B', 2, ambiguous)).toBe('')
  })
  it('prefix must end at a word boundary ("Brian Albaum 4" is not a prefix of "...442")', () => {
    expect(qboClassFor('Brian Albaum 442', 2, [cls('Brian Albaum 4')])).toBe('')
  })
  it('no class list (sync never ran) → legacy behavior, property name passthrough', () => {
    expect(qboClassFor('Kevin Parrish 3836', 3)).toBe('Kevin Parrish 3836')
  })
  it('drives the QBO flat Class column and the Ramp QuickBooks Class column', () => {
    const line: ExportLine = { ...LINES[0], propertyName: 'Kevin Parrish 3836', propertyId: 3 }
    const flatRow = Papa.parse<string[]>(toQboFlatCsv(RUN, [line], CLASSES).trim()).data[1]
    // Description (col 3) keeps the property name; Class (col 5) goes blank.
    expect(flatRow[2]).toBe('Kevin Parrish 3836')
    expect(flatRow[4]).toBe('')
    const rampRow = Papa.parse<string[]>(toRampCsv(RUN, [line], CLASSES).trim()).data[1]
    expect(rampRow[10]).toBe('') // QuickBooks Class column
    const legacyRow = Papa.parse<string[]>(toRampCsv(RUN, [line]).trim()).data[1]
    expect(legacyRow[10]).toBe('Kevin Parrish 3836') // no class list → passthrough
    // a manual link fills the Class cell that name matching couldn't
    const linked = [cls('Parrish Cabin Class', 3), ...CLASSES]
    const linkedRow = Papa.parse<string[]>(toQboFlatCsv(RUN, [line], linked).trim()).data[1]
    expect(linkedRow[4]).toBe('Parrish Cabin Class')
  })
})

// Nina's real QBO import sheet for invoice #1085 (2026-08-10) — the golden
// format reference. Guards that our flat exporter's conventions (headers,
// currency/date formats, Customer name, reason-in-title, onboarding split)
// match what QBO actually accepted in production.
describe('golden format fixture — Nina’s QBO sheet #1085', () => {
  const raw = readFileSync(join(__dirname, '__fixtures__', 'qbo-flat-1085-nina.csv'), 'utf8')
  const parsed = Papa.parse<string[]>(raw.trim(), { skipEmptyLines: true })
  const [header, ...rows] = parsed.data

  it('our flat exporter emits exactly Nina’s header', () => {
    const ours = toQboFlatCsv(RUN, LINES).split('\r\n')[0]
    expect(header.join(',')).toBe(ours)
  })
  it('every row bills Customer=Haven with $-formatted amounts and MM/DD/YYYY dates', () => {
    for (const r of rows) {
      expect(r[6]).toBe('Haven')
      expect(r[3]).toMatch(/^\$\d{1,3}(,\d{3})*\.\d{2}$/)
      expect(r[1]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
    }
  })
  it('reasons ride inside the Service column (Pet Fee)', () => {
    expect(rows.some(r => r[0] === 'Pet Fee (excess dog hair)')).toBe(true)
  })
  it('onboarding cleans appear as base + $50 surcharge rows, same title', () => {
    const onboarding = rows.filter(r => r[0] === 'Onboarding Clean')
    expect(onboarding.length).toBeGreaterThanOrEqual(2)
    // every onboarding property has exactly one $50 companion row
    const byProp = new Map<string, string[]>()
    for (const r of onboarding) {
      byProp.set(r[2], [...(byProp.get(r[2]) ?? []), r[3]])
    }
    for (const amounts of byProp.values()) {
      expect(amounts.filter(a => a === '$50.00').length).toBeGreaterThanOrEqual(1)
    }
  })
  it('extras are separate rows, never merged into the clean fee (spot check: Adam Pike 08/03)', () => {
    const pike = rows.filter(r => r[2] === 'Adam Pike 1071' && r[1] === '08/03/2026')
    expect(pike.map(r => [r[0], r[3]])).toEqual([
      ['Turn Clean', '$390.00'],
      ['Excessive Trash Pickup', '$50.00'],
    ])
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
