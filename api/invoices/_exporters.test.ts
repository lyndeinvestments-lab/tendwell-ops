import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { creditClientsByLine, lineClient } from '../../shared/billcom-send.js'
import { cleanReason, clientDescription, fmtUsd, fmtUsDate, qboClassFor, sanitizeCell, serviceTitle, toBillComCsv, toQboFlatCsv, toQboMultilineCsv, toRampCsv, type ExportLine, type ExportRun } from './_exporters.js'

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

  it('the line description carries the property name, so a class-less line is never anonymous', () => {
    // Real case (invoice I260819800): 19 lines had no matching QBO class —
    // Class is deliberately blank there, and the description was the ONLY
    // remaining place identity could live. It read just "Departure Clean".
    const parsed = Papa.parse<string[]>(csv.trim()).data
    const header = parsed[0]
    const descIdx = header.indexOf('Line item description')
    const dataRows = parsed.slice(1)
    const cleanRow = dataRows.find(r => r[descIdx].includes('Departure Clean'))!
    expect(cleanRow[descIdx]).toContain(LINES[0].propertyName!)
  })

  it('labor/unresolved lines fall back to the vendor raw text for identity', () => {
    const labor: ExportLine = {
      ...LINES[0],
      lineKind: 'operating_expense',
      serviceType: null,
      propertyName: null,
      rawPropertyText: 'Irma Ispection 62.18x20',
      note: '62.18',
      cleanerPayAmount: 1243,
      clientChargeAmount: null,
    }
    const row = Papa.parse<string[]>(toRampCsv(RUN, [labor]).trim()).data[1]
    const descIdx = 12 // Line item description column
    expect(row[descIdx]).toContain('Irma Ispection 62.18x20')
    expect(row[descIdx]).toContain('62.18')
  })
})

describe('review_status=excluded is honored the same as line_kind=excluded', () => {
  // Real case (2026-09): Nina caught 4 duplicate lines from a mis-dated
  // invoice header and marked them excluded in review — but the engine never
  // reclassifies line_kind on a human exclude, so line_kind stayed 'clean'.
  // isApLine/isArLine used to check ONLY line_kind, so these still went out
  // on Ramp (paying the vendor again) and on QBO/bill.com (overbilling the
  // client) at full amount despite being marked excluded.
  const humanExcluded: ExportLine = {
    ...LINES[0], // lineKind: 'clean', still has cleanerPayAmount/clientChargeAmount
    reviewStatus: 'excluded',
  }

  it('drops a review-excluded line from the Ramp (AP) export even though line_kind is still "clean"', () => {
    const csv = toRampCsv(RUN, [LINES[1], humanExcluded])
    const rows = csv.split('\r\n')
    expect(rows).toHaveLength(1 + 1) // header + the one real line only
    expect(csv).not.toContain(humanExcluded.cleanerPayAmount!.toFixed(2))
  })

  it('drops a review-excluded line from the QBO flat (AR) export even though line_kind is still "clean"', () => {
    const csv = toQboFlatCsv(RUN, [LINES[0], humanExcluded])
    const rows = csv.split('\r\n')
    expect(rows).toHaveLength(1 + 1) // header + the one real line only
  })
})

describe('billable task lines (source=task, vendor billed nothing)', () => {
  // A completed Breezeway hot tub refresh Busy Bee did not invoice: client
  // charge only. It must reach the client (QBO or bill.com) and never Ramp.
  const taskLine: ExportLine = {
    lineKind: 'extra',
    serviceType: 'Hot Tub Refresh Requested by Guest',
    serviceDate: '2026-08-07',
    propertyName: 'Michael Rohwer 2455',
    clientName: 'Haven Vacation Rentals',
    billingChannel: 'qbo_haven',
    cleanerPayAmount: null,
    clientChargeAmount: 50,
    note: 'Cleaning: Hot Tub Refresh',
    reviewStatus: 'ok',
  }

  it('is absent from the Ramp (AP) file', () => {
    const rows = Papa.parse<string[]>(toRampCsv(RUN, [LINES[0], taskLine]).trim()).data
    expect(rows).toHaveLength(2) // header + the one paid clean
    expect(toRampCsv(RUN, [LINES[0], taskLine])).not.toMatch(/Hot Tub/)
  })

  it('is billed to Haven in both QBO formats at the client charge', () => {
    const flat = Papa.parse<string[]>(toQboFlatCsv(RUN, [taskLine]).trim()).data
    expect(flat).toHaveLength(2)
    expect(flat[1].join('|')).toMatch(/Hot Tub Refresh Requested by Guest/)
    expect(flat[1].join('|')).toMatch(/\$50\.00/)
    const ml = toQboMultilineCsv(RUN, [taskLine])
    expect(ml).toMatch(/Hot Tub Refresh Requested by Guest/)
    expect(ml).toMatch(/50\.00/)
  })

  it('reaches the bill.com worksheet for a bill.com client', () => {
    const bc = Papa.parse<string[]>(toBillComCsv(RUN, [{ ...taskLine, billingChannel: 'bill_com', clientName: 'Jane Owner' }]).trim()).data
    expect(bc).toHaveLength(2)
    expect(bc[1].join('|')).toMatch(/Hot Tub Refresh Requested by Guest/)
    expect(bc[1].join('|')).toMatch(/50\.00/)
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
  it('onboarding: Ramp pays the rate only, bill.com bills CE + 50, QBO shows both rows', () => {
    // The $50 onboarding surcharge is client-only (Jordan 2026-08-22): its row
    // carries pay NULL, so collapsing must not add anything to the Ramp amount.
    const obBase: ExportLine = {
      ...LINES[0], lineKind: 'combined_split', serviceType: 'Onboarding Clean',
      cleanerPayAmount: 145, clientChargeAmount: 330, note: null, splitGroup: 9,
    }
    const obSurcharge: ExportLine = {
      ...LINES[0], lineKind: 'extra', serviceType: 'Onboarding Clean',
      cleanerPayAmount: null, clientChargeAmount: 50, note: 'Onboarding surcharge', splitGroup: 9,
    }
    const ramp = Papa.parse<string[]>(toRampCsv(RUN, [obBase, obSurcharge]).trim()).data
    expect(ramp).toHaveLength(2) // header + 1 line
    expect(ramp[1][7]).toBe('145.00') // the rate — no +50 on the AP side
    const bc = [{ ...obBase, billingChannel: 'bill_com' as const }, { ...obSurcharge, billingChannel: 'bill_com' as const }]
    const bcRows = Papa.parse<string[]>(toBillComCsv(RUN, bc).trim()).data
    expect(bcRows).toHaveLength(2) // header + 1 line
    expect(bcRows[1][7]).toBe('380.00') // 330 + 50, together
    const qbo = Papa.parse<string[]>(toQboMultilineCsv(RUN, [obBase, obSurcharge]).trim()).data
    expect(qbo).toHaveLength(3) // header + base + surcharge — QBO alone keeps the split
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

  it('without send-control state (migration pending) a hold reason changes nothing', () => {
    const held = LINES.map(l => (l.billingChannel === 'bill_com' ? { ...l, lineNo: 2, billHoldReason: 'Client disputes it' } : l))
    expect(toBillComCsv(RUN, held)).toBe(csv)
    expect(toBillComCsv({ ...RUN, billComInvoices: null }, held)).toBe(csv)
  })
})

describe('toBillComCsv with bill.com send control', () => {
  const JANE = '11111111-1111-4111-8111-111111111111'
  const BOB = '22222222-2222-4222-8222-222222222222'
  const mk = (lineNo: number, contactId: string, client: string, prop: string, date: string, amt: number, extra: Partial<ExportLine> = {}): ExportLine => ({
    lineKind: 'clean', serviceType: 'Turn Clean', serviceDate: date, propertyName: prop, clientName: client,
    billingChannel: 'bill_com', cleanerPayAmount: amt / 2, clientChargeAmount: amt, note: null, reviewStatus: 'ok',
    lineNo, contactId, ...extra,
  })
  const lines = [
    mk(1, JANE, 'Jane Owner', 'Jane 101', '2026-08-05', 120),
    mk(2, JANE, 'Jane Owner', 'Jane 101', '2026-08-06', 150),
    mk(3, BOB, 'Bob Owner', 'Bob 202', '2026-08-06', 200),
  ]
  const parse = (csv: string) => Papa.parse<string[]>(csv, { skipEmptyLines: true }).data
  const runWith = (states: ExportRun['billComInvoices']): ExportRun => ({ ...RUN, billComInvoices: states })

  it('an approved client invoice is included', () => {
    const rows = parse(toBillComCsv(runWith([{ contactId: JANE, serviceMonth: '2026-08', status: 'approved' }]), lines))
    expect(rows.slice(1).map(r => r[7])).toEqual(['120.00', '150.00'])
    expect(rows.slice(1).every(r => r[0] === 'Jane Owner')).toBe(true)
  })

  it('a held client invoice, and one with no row yet, is excluded', () => {
    const rows = parse(toBillComCsv(runWith([
      { contactId: JANE, serviceMonth: '2026-08', status: 'held' },
    ]), lines))
    expect(rows).toHaveLength(1) // header only: Jane is held, Bob has no row
  })

  it('an already-sent client invoice is excluded', () => {
    const rows = parse(toBillComCsv(runWith([
      { contactId: JANE, serviceMonth: '2026-08', status: 'sent', billcomInvoiceNumber: '10452' },
      { contactId: BOB, serviceMonth: '2026-08', status: 'approved' },
    ]), lines))
    expect(rows.slice(1).map(r => r[0])).toEqual(['Bob Owner'])
  })

  it('a held line is excluded while the rest of its approved invoice goes out', () => {
    const withHold = lines.map(l => (l.lineNo === 2 ? { ...l, billHoldReason: 'Client disputes the second clean' } : l))
    const rows = parse(toBillComCsv(runWith([{ contactId: JANE, serviceMonth: '2026-08', status: 'approved' }]), withHold))
    expect(rows.slice(1).map(r => r[7])).toEqual(['120.00'])
  })

  it('a blank hold reason does not hold the line', () => {
    const withBlank = lines.map(l => (l.lineNo === 2 ? { ...l, billHoldReason: '   ' } : l))
    const rows = parse(toBillComCsv(runWith([{ contactId: JANE, serviceMonth: '2026-08', status: 'approved' }]), withBlank))
    expect(rows).toHaveLength(3)
  })

  it('a hold on the surcharge row of a split line holds the collapsed line', () => {
    const split = [
      mk(5, JANE, 'Jane Owner', 'Jane 101', '2026-08-07', 300, { splitGroup: 9, serviceType: 'Onboarding Clean' }),
      mk(5, JANE, 'Jane Owner', 'Jane 101', '2026-08-07', 50, { splitGroup: 9, lineKind: 'extra', serviceType: 'Onboarding Clean', billHoldReason: 'Not their first clean' }),
    ]
    const rows = parse(toBillComCsv(runWith([{ contactId: JANE, serviceMonth: '2026-08', status: 'approved' }]), [...lines.slice(0, 1), ...split]))
    expect(rows.slice(1).map(r => r[7])).toEqual(['120.00'])
  })

  it('each service month is its own client invoice', () => {
    const twoMonths = [mk(1, JANE, 'Jane Owner', 'Jane 101', '2026-08-31', 120), mk(2, JANE, 'Jane Owner', 'Jane 101', '2026-09-01', 150)]
    const rows = parse(toBillComCsv(runWith([
      { contactId: JANE, serviceMonth: '2026-08', status: 'sent', billcomInvoiceNumber: 'A-1' },
      { contactId: JANE, serviceMonth: '2026-09', status: 'approved' },
    ]), twoMonths))
    expect(rows.slice(1).map(r => r[4])).toEqual(['09/01/2026'])
  })

  it('a line whose property has no client never goes out', () => {
    const orphan = mk(7, '', 'Nobody', 'Orphan 303', '2026-08-06', 99, { contactId: null })
    const rows = parse(toBillComCsv(runWith([{ contactId: JANE, serviceMonth: '2026-08', status: 'approved' }]), [...lines, orphan]))
    expect(rows.slice(1).map(r => r[5])).toEqual(['Jane 101', 'Jane 101'])
  })
})

describe('toBillComCsv: client credits under bill.com send control', () => {
  const JANE = '11111111-1111-4111-8111-111111111111'
  const CREDIT_LINE_ID = '44444444-4444-4444-8444-444444444444'
  const clean: ExportLine = {
    lineKind: 'clean', serviceType: 'Turn Clean', serviceDate: '2026-08-05', propertyName: 'Jane 101', clientName: 'Jane Owner',
    billingChannel: 'bill_com', cleanerPayAmount: 60, clientChargeAmount: 120, note: null, reviewStatus: 'ok', lineNo: 1, contactId: JANE,
  }
  // A credit line as invoice_apply_open_credits writes it: no property, its
  // client only on the adjustment row (applied_line_id = the line id).
  const creditLine = (credits: ReturnType<typeof creditClientsByLine>): ExportLine => {
    const client = lineClient({ id: CREDIT_LINE_ID, propertyContactId: null, propertyClientName: null }, credits)
    return {
      lineKind: 'extra', serviceType: 'Credit', serviceDate: '2026-08-05', propertyName: null, clientName: client.clientName,
      billingChannel: 'bill_com', cleanerPayAmount: 0, clientChargeAmount: -40, note: null, reviewNote: 'Bad clean refund',
      reviewStatus: 'resolved', flags: ['credit'], lineNo: 2, contactId: client.contactId,
    }
  }
  const adjustments = creditClientsByLine([
    { applied_line_id: CREDIT_LINE_ID, contact_id: JANE, contacts: { full_name: 'Jane Owner', company: null } },
  ])
  const parse = (csv: string) => Papa.parse<string[]>(csv, { skipEmptyLines: true }).data
  const runWith = (states: ExportRun['billComInvoices']): ExportRun => ({ ...RUN, billComInvoices: states })

  it('an approved client invoice keeps its credit line, negative, under the client', () => {
    const rows = parse(toBillComCsv(runWith([{ contactId: JANE, serviceMonth: '2026-08', status: 'approved' }]), [clean, creditLine(adjustments)]))
    expect(rows.slice(1).map(r => [r[0], r[3], r[7]])).toEqual([
      ['Jane Owner', 'Turn Clean', '120.00'],
      ['Jane Owner', 'Credit (Bad clean refund)', '-40.00'],
    ])
  })

  it('a held client invoice drops the credit with the rest of it', () => {
    const rows = parse(toBillComCsv(runWith([{ contactId: JANE, serviceMonth: '2026-08', status: 'held' }]), [clean, creditLine(adjustments)]))
    expect(rows).toHaveLength(1) // header only
  })

  it('adjustment lookup missing (migration pending): behaves as before', () => {
    const orphan = creditLine(creditClientsByLine(null))
    expect(orphan.contactId).toBeNull()
    // No send-control state: listed (blank customer sorts first), as before send control existed.
    expect(parse(toBillComCsv(RUN, [clean, orphan])).slice(1).map(r => [r[0], r[7]])).toEqual([['', '-40.00'], ['Jane Owner', '120.00']])
    // Send control on: a line with no client can't go out, as before this fix.
    const rows = parse(toBillComCsv(runWith([{ contactId: JANE, serviceMonth: '2026-08', status: 'approved' }]), [clean, orphan]))
    expect(rows.slice(1).map(r => r[7])).toEqual(['120.00'])
  })
})

describe('month split (Haven, invoice 1096: never mix two months on one invoice)', () => {
  const run: ExportRun = { ...RUN, vendorInvoiceNumber: '1261003821', invoiceDate: '2026-10-03', dueDate: '2026-10-03', qboInvoiceNo: 1096, qboInvoiceNos: { '2026-09': 1096, '2026-10': 1097 }, periodEnd: '2026-10-03' }
  const mk = (d: string, prop: string, amt: number, extra: Partial<ExportLine> = {}): ExportLine => ({
    lineKind: 'clean', serviceType: 'Turn Clean', serviceDate: d, propertyName: prop, clientName: 'Haven Vacation Rentals',
    billingChannel: 'qbo_haven', cleanerPayAmount: amt / 2, clientChargeAmount: amt, note: null, reviewStatus: 'ok', ...extra,
  })
  const lines = [
    mk('2026-09-30', 'Kim Mills 2222', 175),
    mk('2026-10-01', 'Hali Hoag 2140', 200, { flags: ['owner_stay'], serviceType: 'Departure Clean' }),
    mk('2026-10-02', 'Nicole Allison 3690', 50, { lineKind: 'extra', serviceType: 'Onboarding Clean', note: 'Onboarding fee — first Tendwell clean' }),
  ]
  const parse = (csv: string) => Papa.parse<string[]>(csv, { skipEmptyLines: true }).data

  it('QBO flat: September rows get 1096 dated 9/30, October rows get 1097', () => {
    const rows = parse(toQboFlatCsv(run, lines))
    expect(rows[1][5]).toBe('1096')
    expect(rows[1][7]).toBe('09/30/2026')
    expect(rows[2][5]).toBe('1097')
    expect(rows[2][7]).toBe('10/03/2026')
  })
  it('QBO flat: owner stay leads title AND description; onboarding reason rides in the description', () => {
    // Christine, 2026-10-08: "Owner Stay - Departure Clean" so QBO Class
    // rules book it to the owner instead of as a Haven expense.
    const rows = parse(toQboFlatCsv(run, lines))
    expect(rows[2][0]).toBe('Owner Stay - Departure Clean')
    expect(rows[2][2]).toBe('Owner Stay - Departure Clean – Hali Hoag 2140')
    expect(rows[3][2]).toBe('Nicole Allison 3690 – onboarding fee, first Tendwell clean')
  })
  it('QBO multiline: the Item stays canonical, the description carries "Owner Stay - Turn Clean"', () => {
    const ml = parse(toQboMultilineCsv(run, [mk('2026-10-01', 'Hali Hoag 2140', 200, { flags: ['owner_stay'] })]))
    expect(ml[1][7]).toBe('Turn Clean')
    expect(ml[1][8]).toBe('Owner Stay - Turn Clean – Hali Hoag 2140')
  })
  it('QBO multiline: one header block per month', () => {
    const rows = parse(toQboMultilineCsv(run, lines))
    expect(rows.slice(1).map(r => r[0])).toEqual(['1096', '1097', '1097'])
    expect(rows[1][1]).toBe('Haven')
    expect(rows[2][1]).toBe('Haven')
    expect(rows[3][1]).toBe('')
  })
  it('Ramp: one bill per month, suffixed invoice number and month accounting date', () => {
    const rows = parse(toRampCsv(run, lines))
    expect(rows[1][2]).toBe('1261003821-2026-09')
    expect(rows[1][4]).toBe('2026-09-30')
    expect(rows[2][2]).toBe('1261003821-2026-10')
  })
  it('a single-month run keeps the plain vendor invoice number', () => {
    const rows = parse(toRampCsv(run, [lines[1]]))
    expect(rows[1][2]).toBe('1261003821')
  })
})

describe('Haven 1097 feedback (Christine, 2026-10-08)', () => {
  const base = {
    lineKind: 'extra' as const, serviceDate: '2026-10-02', clientName: 'Haven Vacation Rentals',
    billingChannel: 'qbo_haven' as const, cleanerPayAmount: 20, clientChargeAmount: 50, reviewStatus: 'ok',
  }
  it('a towel delivery is "Trip Fee (reason) – property", never "Delivery"', () => {
    const l: ExportLine = { ...base, serviceType: 'Trip Fee', propertyName: 'John Bryan 4144', note: 'Towel delivery (orig: Deliver towel)', reviewNote: null }
    expect(serviceTitle(l)).toBe('Trip Fee (Towel delivery) – John Bryan 4144')
  })
  it('an owner-stay trip leads with "Owner Stay - "', () => {
    const l: ExportLine = { ...base, serviceType: 'Trip Fee', propertyName: 'John Bryan 4144', note: 'Deliver towel', flags: ['owner_stay'],
      reviewNote: 'Extra towels + 4 bath rugs delivered for the owner stay. https://havenvacationrentals.slack.com/archives/C08V5RCALJF/p1790949842297229' }
    expect(serviceTitle(l)).toBe('Owner Stay - Trip Fee (Extra towels + 4 bath rugs delivered for the owner stay) – John Bryan 4144')
    // The evidence link goes in the description, not the title.
    expect(clientDescription(l)).toBe('Owner Stay - Trip Fee – John Bryan 4144 – https://havenvacationrentals.slack.com/archives/C08V5RCALJF/p1790949842297229')
  })
  it('a reimbursement names its reason and property; our bookkeeping never reaches the client', () => {
    const l: ExportLine = { ...base, serviceType: 'Reimbursement', propertyName: 'Kim Mills 2222', note: 'UPS delivery 9/28/26',
      reviewNote: 'UPS shipping of guest Jane Doe\'s left charger (Jordan, 2026-10-05) https://x.slack.com/archives/C1/p2' }
    expect(serviceTitle(l)).toBe("Reimbursement (UPS shipping of guest Jane Doe's left charger) – Kim Mills 2222")
    expect(cleanReason('Towel delivery (orig: Deliver towel)')).toBe('Towel delivery')
  })
  it('a reason that already names the property does not repeat it', () => {
    const l: ExportLine = { ...base, serviceType: 'Reimbursement', propertyName: 'Kim Mills 2222', note: null, reviewNote: 'Propane for Kim Mills 2222' }
    expect(serviceTitle(l)).toBe('Reimbursement (Propane for Kim Mills 2222)')
  })
})
