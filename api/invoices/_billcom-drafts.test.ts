import { describe, expect, it } from 'vitest'
import type { BillComRow, ExportLine } from './_exporters'
import {
  buildBillComDrafts,
  clientInitials,
  draftLineDescription,
  initialsByClient,
  isPerPropertyClient,
  registerInvoiceNumber,
} from './_billcom-drafts'

const row = (o: Partial<BillComRow>): BillComRow => ({
  line: {} as ExportLine,
  contactId: 'c-ann',
  clientName: 'Ann Weber',
  serviceMonth: '2026-10',
  invoiceDate: '2026-10-18',
  service: 'Departure Clean',
  serviceDate: '2026-10-12',
  propertyName: 'Ann Weber 2130',
  amount: 255,
  held: false,
  ...o,
})

describe('clientInitials', () => {
  it('matches the numbers people typed by hand', () => {
    expect(clientInitials('Ann Weber')).toBe('AW')
    expect(clientInitials('HomeTeam')).toBe('HT')
    expect(clientInitials('Hostimo')).toBe('HO')
    expect(clientInitials('Lou and Elva Romano')).toBe('LR')
  })
})

describe('initialsByClient', () => {
  it('gives a second client with the same initials a number', () => {
    const map = initialsByClient([
      row({ contactId: 'c1', clientName: 'Ann Weber' }),
      row({ contactId: 'c2', clientName: 'Amy White' }),
      row({ contactId: 'c1', clientName: 'Ann Weber' }),
    ])
    expect(map.get('c2')).toBe('AW')
    expect(map.get('c1')).toBe('AW2')
  })
})

describe('draftLineDescription', () => {
  it('reads like a hand-entered line', () => {
    expect(draftLineDescription(row({}))).toBe('Departure Clean, Ann Weber 2130, 10/12/2026')
  })

  it('drops missing parts', () => {
    expect(draftLineDescription(row({ service: 'Credit (late arrival)', propertyName: null, serviceDate: null }))).toBe('Credit (late arrival)')
  })
})

describe('isPerPropertyClient', () => {
  it('is HomeTeam only', () => {
    expect(isPerPropertyClient('HomeTeam')).toBe(true)
    expect(isPerPropertyClient('Kristin Lee', 'Home Team')).toBe(true)
    expect(isPerPropertyClient('Hostimo', 'Hostimo Property Management')).toBe(false)
  })
})

describe('buildBillComDrafts', () => {
  const base = { vendorInvoiceNumber: 'I261012825', contactId: 'c-ann', serviceMonth: '2026-10', clientName: 'Ann Weber' }

  it('builds one invoice per client per month, held lines left off', () => {
    const out = buildBillComDrafts({
      ...base,
      rows: [
        row({}),
        row({ service: 'Pet Fee (excess dog hair)', amount: 50, serviceDate: '2026-10-13' }),
        row({ amount: 99, held: true }),
        row({ contactId: 'c-other', clientName: 'Bob Tate' }),
      ],
    })
    expect(out).toEqual({
      ok: true,
      drafts: [{
        invoiceNumber: 'I261012825-AW',
        invoiceDate: '2026-10-18',
        propertyName: null,
        lines: [
          { description: 'Departure Clean, Ann Weber 2130, 10/12/2026', amount: 255 },
          { description: 'Pet Fee (excess dog hair), Ann Weber 2130, 10/13/2026', amount: 50 },
        ],
        total: 305,
      }],
    })
  })

  it('adds the month when the client has two months on the run', () => {
    const out = buildBillComDrafts({
      ...base,
      serviceMonth: '2026-09',
      rows: [row({ serviceMonth: '2026-09', invoiceDate: '2026-09-30', serviceDate: '2026-09-29' }), row({})],
    })
    expect(out.ok && out.drafts.map((d) => [d.invoiceNumber, d.invoiceDate])).toEqual([['I261012825-AW-09', '2026-09-30']])
  })

  it('splits HomeTeam into one invoice per property, numbered in property order', () => {
    const ht = { contactId: 'c-ht', clientName: 'HomeTeam' }
    const out = buildBillComDrafts({
      ...base,
      ...ht,
      rows: [
        row({ ...ht, propertyName: 'Ridge 12', amount: 200 }),
        row({ ...ht, propertyName: 'Alpine 4', amount: 150 }),
        row({ ...ht, propertyName: 'Ridge 12', amount: 50, service: 'Trash Service' }),
      ],
    })
    expect(out.ok && out.drafts.map((d) => [d.invoiceNumber, d.propertyName, d.total, d.lines.length])).toEqual([
      ['I261012825-HT01', 'Alpine 4', 150, 1],
      ['I261012825-HT02', 'Ridge 12', 250, 2],
    ])
  })

  it('refuses a run with no vendor invoice number or nothing to bill', () => {
    expect(buildBillComDrafts({ ...base, vendorInvoiceNumber: ' ', rows: [row({})] }).ok).toBe(false)
    expect(buildBillComDrafts({ ...base, rows: [row({ held: true })] }).ok).toBe(false)
  })
})

describe('registerInvoiceNumber', () => {
  it('names the range for a split invoice', () => {
    expect(registerInvoiceNumber([{ invoiceNumber: 'I1-AW' }])).toBe('I1-AW')
    expect(registerInvoiceNumber([{ invoiceNumber: 'I1-HT01' }, { invoiceNumber: 'I1-HT02' }])).toBe('I1-HT01 to I1-HT02')
  })
})
