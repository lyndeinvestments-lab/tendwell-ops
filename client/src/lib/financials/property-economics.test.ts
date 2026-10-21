import { describe, it, expect } from 'vitest'
import { classifyLine, cogsGroup, computePropertyEconomics, diagnose, addDays, type EconInput, type EconProperty, type PropertyEconomics } from './property-economics'

const prop = (id: number, over: Partial<EconProperty> = {}): EconProperty => ({
  id, name: `P${id}`, stage: 'Active', ce_charged: 200, deep_clean_3x_ce: 600, cleaner_pay: 100,
  est_laundry: 30, est_consumables: 10, ...over,
})

const line = (over: Partial<EconInput['lines'][number]>) => ({
  property_id: null, line_kind: 'clean', service_type: 'Turn Clean', description: null,
  work_date: '2026-09-10', cleaner_pay_amount: 0, client_charge_amount: 0, ...over,
})

describe('classifyLine', () => {
  it('treats named hourly lines and inspection work as inspections', () => {
    for (const d of ['Irma Work', 'Joshua Work', 'Inspection Work', 'Norma Work Inspection', 'Yovi Work']) {
      expect(classifyLine({ property_id: null, line_kind: 'operating_expense', service_type: null, description: d })).toBe('inspection')
    }
  })
  it('treats facility work, wash linens and laundry service as linen cost', () => {
    for (const d of ['Facility Work', 'Faculity Work', 'Facility', 'Wash linens On 9/27/26', 'Laundry Service']) {
      expect(classifyLine({ property_id: null, line_kind: 'operating_expense', service_type: null, description: d })).toBe('linen')
    }
  })
  it('keeps deliveries, bulbs and reimbursements as other company cost', () => {
    for (const d of ['UPS delivery 9/28/26', 'Fedex Deliver', 'Facility Light Bulb', 'Reimbursement']) {
      expect(classifyLine({ property_id: null, line_kind: 'extra', service_type: null, description: d })).toBe('other')
    }
  })
  it('splits property lines into cleaning, extras and billed inspections', () => {
    expect(classifyLine({ property_id: 1, line_kind: 'clean', service_type: 'Turn Clean', description: null })).toBe('cleaning')
    expect(classifyLine({ property_id: 1, line_kind: 'combined_split', service_type: 'Onboarding Clean', description: null })).toBe('cleaning')
    expect(classifyLine({ property_id: 1, line_kind: 'extra', service_type: 'Pet Fee', description: null })).toBe('extra')
    expect(classifyLine({ property_id: 1, line_kind: 'extra', service_type: 'Cleaning Inspection', description: null })).toBe('inspection')
  })
})

describe('cogsGroup', () => {
  it('maps the live QuickBooks COGS accounts', () => {
    expect(cogsGroup('Cleaning Contractor Pay')).toBe('contractor')
    expect(cogsGroup('Laundry')).toBe('laundry')
    expect(cogsGroup('Cleaning Supplies')).toBe('consumables')
    expect(cogsGroup('Supplies Expense')).toBe('consumables')
    expect(cogsGroup('Inspection Cost')).toBe('inspection')
    expect(cogsGroup('Leadership Pay')).toBe('leadership')
    expect(cogsGroup('Fuel')).toBe('otherCogs')
  })
})

describe('computePropertyEconomics', () => {
  // September 2026, fully invoiced. Property 1 cleans 3x, property 2 once.
  const base: EconInput = {
    start: '2026-09-01',
    end: '2026-09-30',
    today: '2026-10-21',
    properties: [prop(1), prop(2, { ce_charged: 150, cleaner_pay: 160, est_laundry: 10, est_consumables: 10 })],
    cleanDays: [
      { property_id: 1, d: '2026-09-07', deep: false },
      { property_id: 1, d: '2026-09-10', deep: false },
      { property_id: 1, d: '2026-09-20', deep: false },
      { property_id: 2, d: '2026-09-10', deep: false },
    ],
    lines: [
      line({ property_id: 1, work_date: '2026-09-07', cleaner_pay_amount: 100, client_charge_amount: 200 }),
      line({ property_id: 1, work_date: '2026-09-10', cleaner_pay_amount: 100, client_charge_amount: 200 }),
      line({ property_id: 1, work_date: '2026-09-20', cleaner_pay_amount: 100, client_charge_amount: 200 }),
      line({ property_id: 1, line_kind: 'extra', service_type: 'Pet Fee', work_date: '2026-09-20', cleaner_pay_amount: 20, client_charge_amount: 35 }),
      line({ property_id: 2, work_date: '2026-09-10', cleaner_pay_amount: 160, client_charge_amount: 150 }),
      // Inspection week ending 9/12: properties 1 and 2 cleaned 9/6–9/12 → $100 each.
      line({ line_kind: 'operating_expense', service_type: null, description: 'Irma Work', work_date: '2026-09-12', cleaner_pay_amount: 200 }),
      // Inspection week ending 9/26: only property 1 cleaned 9/20–9/26 → all $70 to it.
      line({ line_kind: 'operating_expense', service_type: null, description: 'Inspection Work', work_date: '2026-09-26', cleaner_pay_amount: 70 }),
      line({ line_kind: 'operating_expense', service_type: null, description: 'Facility Work', work_date: '2026-09-26', cleaner_pay_amount: 140 }),
      line({ line_kind: 'extra', service_type: null, description: 'UPS delivery', work_date: '2026-09-26', cleaner_pay_amount: 14 }),
    ],
    invoicedFrom: '2026-08-10',
    invoicedThrough: '2026-10-17',
    qbo: [{
      month: '2026-09-01', total_income: 900, total_expenses: 40,
      cogs_breakdown: { 'Cleaning Contractor Pay': 600, Laundry: 100, 'Cleaning Supplies': 60, 'Leadership Pay': 20, 'Inspection Cost': 40 },
      expense_breakdown: { 'Software': 40 },
    }],
  }

  it('uses invoiced revenue and pay, keeping inspections out of cleaner pay', () => {
    const { properties, company } = computePropertyEconomics(base)
    const p1 = properties.find(r => r.property_id === 1)!
    expect(p1.cleans).toBe(3)
    expect(p1.billedCleaning).toBe(600)
    expect(p1.billedExtras).toBe(35)
    expect(p1.cleaningPay).toBe(300)
    expect(p1.extraPay).toBe(20)
    expect(p1.labor).toBe(320)
    expect(p1.billingGap).toBe(0)
    expect(company.labor.cleaning).toBe(460)
  })

  it('splits each inspection week evenly across the properties cleaned that week', () => {
    const { properties, company } = computePropertyEconomics(base)
    const p1 = properties.find(r => r.property_id === 1)!
    const p2 = properties.find(r => r.property_id === 2)!
    // Busy Bee: p1 = 100 + 70, p2 = 100. QBO $40 split across the 2 properties cleaned in September.
    expect(p1.inspections).toBeCloseTo(170 + 20)
    expect(p2.inspections).toBeCloseTo(100 + 20)
    expect(company.inspections.busyBee).toBeCloseTo(270)
    expect(company.inspections.qbo).toBeCloseTo(40)
    expect(company.inspections.weeks.map(w => w.properties)).toEqual([2, 1])
  })

  it('allocates laundry (QuickBooks + linen labor) by expected laundry and reports the gap', () => {
    const { properties, company } = computePropertyEconomics(base)
    // Expected: p1 3×30 = 90, p2 10 → 100. Actual: QBO 100 + Facility Work 140 = 240.
    expect(company.laundry.expected).toBe(100)
    expect(company.laundry.actual).toBeCloseTo(240)
    expect(company.laundry.diff).toBeCloseTo(140)
    expect(properties.find(r => r.property_id === 1)!.laundry).toBeCloseTo(216)
    expect(company.consumables.actual).toBeCloseTo(60)
    expect(company.consumables.expected).toBe(40)
  })

  it('allocates overhead by cleans and balances to the company total', () => {
    const { properties, company } = computePropertyEconomics(base)
    // Leadership 20 + opex 40 + delivery 14 = 74, split 3:1.
    expect(company.overhead.total).toBeCloseTo(74)
    expect(properties.find(r => r.property_id === 2)!.overhead).toBeCloseTo(18.5)
    const allocated = properties.reduce((s, r) => s + r.totalCost, 0)
    expect(allocated).toBeCloseTo(company.totalCost)
    // Labor 480 + inspections 310 + laundry 240 + consumables 60 + overhead 74.
    expect(company.totalCost).toBeCloseTo(480 + 310 + 240 + 60 + 74)
  })

  it('flags a property priced below its cleaner pay', () => {
    const { properties } = computePropertyEconomics(base)
    const p2 = properties.find(r => r.property_id === 2)!
    expect(p2.profit).toBeLessThan(0)
    expect(p2.reasons.map(r => r.code)).toContain('rate_below_pay')
  })

  it('estimates revenue and pay for cleans after the last invoice', () => {
    const r = computePropertyEconomics({
      ...base,
      start: '2026-10-01', end: '2026-10-21',
      cleanDays: [{ property_id: 1, d: '2026-10-15', deep: false }, { property_id: 1, d: '2026-10-19', deep: true }],
      lines: [line({ property_id: 1, work_date: '2026-10-15', cleaner_pay_amount: 100, client_charge_amount: 200 })],
      qbo: [{ month: '2026-10-01', total_income: 100, total_expenses: 0, cogs_breakdown: { Laundry: 5, 'Cleaning Supplies': 1 }, expense_breakdown: {} }],
      weighIns: [{ d: '2026-10-05', pounds: 100 }],
    })
    const p1 = r.properties[0]
    expect(p1.cleansInvoiced).toBe(1)
    expect(p1.cleansNotInvoiced).toBe(1)
    expect(p1.estimatedRevenue).toBe(600)
    expect(p1.revenue).toBe(800)
    expect(p1.estimatedPay).toBe(100)
    // Current month: QuickBooks bills lag, so laundry uses weigh-ins (100 lb × $0.69) and
    // consumables the expected amount.
    expect(r.company.months[0]).toMatchObject({ partial: true, laundrySource: 'weighins', consumablesSource: 'expected' })
    expect(r.company.laundry.actual).toBeCloseTo(69)
    expect(r.company.consumables.actual).toBeCloseTo(20)
  })

  it('counts invoice lines as the cleans in invoiced weeks and reports clean days with no line', () => {
    const r = computePropertyEconomics({
      ...base,
      cleanDays: [
        ...base.cleanDays,
        // Another crew's clean logged in Breezeway: no Busy Bee line within a day.
        { property_id: 2, d: '2026-09-25', deep: false, source: 'breezeway' },
        // Logged a day off from the invoice date: still matched, not double counted.
        { property_id: 2, d: '2026-09-11', deep: false, source: 'breezeway' },
      ],
    })
    const p2 = r.properties.find(p => p.property_id === 2)!
    expect(p2.cleans).toBe(1)
    expect(p2.notOnInvoice).toBe(1)
    expect(p2.reasons.map(x => x.code)).toContain('not_on_invoice')
    expect(r.company.notOnInvoiceBySource).toEqual({ breezeway: 1 })
  })

  it('smooths supplies to the trailing 3-month average', () => {
    const month = (m: string, supplies: number) => ({
      month: m, total_income: 0, total_expenses: 0, cogs_breakdown: { 'Cleaning Supplies': supplies }, expense_breakdown: {},
    })
    const r = computePropertyEconomics({ ...base, qbo: [month('2026-07-01', 30), month('2026-08-01', 0), month('2026-09-01', 90)] })
    expect(r.company.consumables.qbo).toBeCloseTo(90)
    expect(r.company.consumables.actual).toBeCloseTo(40)
    expect(r.company.months[0].consumablesSource).toBe('average')
  })

  it('fills fixed overhead not yet booked in the month in progress from the trailing average', () => {
    const r = computePropertyEconomics({
      ...base,
      start: '2026-10-01', end: '2026-10-21',
      cleanDays: [{ property_id: 1, d: '2026-10-19', deep: false }],
      lines: [],
      qbo: [
        { month: '2026-09-01', total_income: 0, total_expenses: 62, cogs_breakdown: { 'Leadership Pay': 31 }, expense_breakdown: {} },
        { month: '2026-10-01', total_income: 0, total_expenses: 10, cogs_breakdown: {}, expense_breakdown: { Software: 10 } },
      ],
    })
    // 21 of October's 31 days have passed.
    expect(r.company.overhead.leadership).toBeCloseTo(21)
    expect(r.company.overhead.opex).toBeCloseTo(42)
    expect(r.company.overhead.opexAccounts['(average, month in progress)']).toBeCloseTo(32)
  })

  it('takes only the share of a monthly QuickBooks pool that falls in a weekly range', () => {
    const r = computePropertyEconomics({ ...base, start: '2026-09-06', end: '2026-09-12' })
    // 3 of September's 4 cleans fall in the week → three quarters of each monthly pool.
    expect(r.company.months[0].share).toBeCloseTo(0.75)
    expect(r.company.laundry.qbo).toBeCloseTo(75)
    expect(r.company.inspections.busyBee).toBeCloseTo(200)
  })
})

describe('diagnose', () => {
  const row = (over: Partial<PropertyEconomics>): PropertyEconomics => ({
    property_id: 1, name: 'x', stage: null, rate: 200, payRate: 100, cleans: 4, deepCleans: 0,
    cleansInvoiced: 4, cleansNotInvoiced: 0, notOnInvoice: 0, notOnInvoiceBySource: {}, expectedRevenue: 800, expectedInvoiced: 800,
    billedCleaning: 800, billedExtras: 0, estimatedRevenue: 0, revenue: 800, billingGap: 0, cleaningPay: 400,
    extraPay: 0, estimatedPay: 0, labor: 400, unbilledPay: 0, inspections: 0, laundry: 0, laundryExpected: 0,
    consumables: 0, consumablesExpected: 0, overhead: 0, totalCost: 400, profit: 400, margin: 50, reasons: [], ...over,
  })
  it('reports billing below the rate and clean days missing from the invoice', () => {
    const r = diagnose(row({ billedCleaning: 400, billingGap: -400, notOnInvoice: 1 }))
    expect(r.map(x => x.code)).toEqual(['billed_below_expected', 'not_on_invoice'])
    expect(r[1]).toMatchObject({ amount: 200, count: 1 })
  })
  it('reports Busy Bee pay above what was billed for the cleans', () => {
    expect(diagnose(row({ cleaningPay: 1000 }))[0]).toMatchObject({ code: 'pay_above_rate', amount: 200 })
  })
  it('reports unbilled work and missing rates', () => {
    expect(diagnose(row({ unbilledPay: 600 })).map(x => x.code)).toContain('unbilled_work')
    expect(diagnose(row({ rate: 0 })).map(x => x.code)).toContain('no_rate')
  })
})

describe('addDays', () => {
  it('crosses month boundaries', () => {
    expect(addDays('2026-10-03', -6)).toBe('2026-09-27')
  })
})
