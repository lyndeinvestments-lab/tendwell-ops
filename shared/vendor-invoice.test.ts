import { describe, expect, it } from 'vitest'
import {
  isTestVendorName,
  validatePeriod,
  validateVendorItem,
  vendorNotices,
  vendorRunStatus,
  type ItemContext,
  type VendorItemInput,
} from './vendor-invoice'

const ctx: ItemContext = { periodStart: '2026-10-04', periodEnd: '2026-10-10', today: '2026-10-12', propertyCleanerPay: 120 }

const reimbursement: VendorItemInput = {
  category: 'reimbursement',
  property_id: 12,
  date: '2026-10-05',
  amount: 42.1,
  description: 'UPS return of guest phone charger',
  requested_by: 'Guest Jane Doe, reservation HM123',
  receipt_path: 'vendor-portal/v/r/receipt.jpg',
}

describe('validateVendorItem — dates', () => {
  it('every category but inspection requires a date', () => {
    for (const category of ['missing_clean', 'extra', 'reimbursement', 'labor'] as const) {
      const r = validateVendorItem({ category, date: null }, ctx)
      expect(r.ok).toBe(false)
      expect(r.errors.date).toBe('required')
    }
    const insp = validateVendorItem({ category: 'inspection', worker: 'Irma', hours: 12, rate: 18 }, ctx)
    expect(insp.ok).toBe(true)
    expect(insp.item?.date).toBeNull()
    expect(insp.item?.amount).toBe(216)
  })

  it('rejects future dates and dates after the period', () => {
    expect(validateVendorItem({ ...reimbursement, date: '2026-10-13' }, ctx).errors.date).toBe('date_in_future')
    expect(validateVendorItem({ ...reimbursement, date: '2026-10-11' }, ctx).errors.date).toBe('date_outside_period')
    expect(validateVendorItem({ ...reimbursement, date: '2026-02-30' }, ctx).errors.date).toBe('invalid_date')
  })

  it('a missing clean must fall inside the period (no late cleans)', () => {
    const r = validateVendorItem({ category: 'missing_clean', property_id: 3, date: '2026-10-02', service_type: 'Turn Clean', description: 'Not in Breezeway, Nina asked us to clean' }, ctx)
    expect(r.errors.date).toBe('date_outside_period')
  })

  it('a late reimbursement inside 30 days is allowed and marked late; older is refused', () => {
    const late = validateVendorItem({ ...reimbursement, date: '2026-09-20' }, ctx)
    expect(late.ok).toBe(true)
    expect(late.item?.late).toBe(true)
    expect(validateVendorItem({ ...reimbursement, date: '2026-08-01' }, ctx).errors.date).toBe('date_too_old')
  })
})

describe('validateVendorItem — reimbursements need who, what and a receipt', () => {
  it('accepts a complete reimbursement', () => {
    const r = validateVendorItem(reimbursement, ctx)
    expect(r.ok).toBe(true)
    expect(r.item).toMatchObject({ amount: 42.1, property_id: 12, late: false })
  })

  it('requires a property, a receipt, a description and who asked', () => {
    const r = validateVendorItem({ category: 'reimbursement', date: '2026-10-05', amount: 20, description: 'ups' }, ctx)
    expect(r.errors).toMatchObject({
      property_id: 'required',
      receipt_path: 'receipt_required',
      description: 'too_short',
      requested_by: 'required',
    })
  })

  it('caps the amount and refuses zero/negative', () => {
    expect(validateVendorItem({ ...reimbursement, amount: 0 }, ctx).errors.amount).toBe('amount_positive')
    expect(validateVendorItem({ ...reimbursement, amount: -5 }, ctx).errors.amount).toBe('amount_positive')
    expect(validateVendorItem({ ...reimbursement, amount: 2600 }, ctx).errors.amount).toBe('amount_too_high')
  })
})

describe('validateVendorItem — extras', () => {
  const extra: VendorItemInput = { category: 'extra', property_id: 9, date: '2026-10-06', service_type: 'Hot Tub Refresh Requested by Guest', amount: 30, description: 'Guest asked at check-in, tub was cloudy' }

  it('accepts a reasoned extra from the approved list', () => {
    expect(validateVendorItem(extra, ctx).ok).toBe(true)
  })

  it('refuses a type that is not on the list', () => {
    expect(validateVendorItem({ ...extra, service_type: 'Bonus' }, ctx).errors.service_type).toBe('unknown_type')
  })

  it('requires evidence (photo or link) for pet, trash, double and extra cleaning', () => {
    const pet = { ...extra, service_type: 'Pet Fee', description: 'Heavy dog hair on every couch and bed' }
    expect(validateVendorItem(pet, ctx).errors.evidence_url).toBe('evidence_required')
    expect(validateVendorItem({ ...pet, evidence_url: 'https://tendwell.slack.com/archives/C08/p1' }, ctx).ok).toBe(true)
    expect(validateVendorItem({ ...pet, receipt_path: 'vendor-portal/v/r/photo.jpg' }, ctx).ok).toBe(true)
  })

  it('only a Slack or photo link satisfies the evidence rule, matching the approve gate', () => {
    const pet = { ...extra, service_type: 'Pet Fee', description: 'Heavy dog hair on every couch and bed' }
    expect(validateVendorItem({ ...pet, evidence_url: 'https://example.com/page' }, ctx).errors.evidence_url).toBe('evidence_required')
    expect(validateVendorItem({ ...pet, evidence_url: 'https://drive.google.com/file/d/abc' }, ctx).ok).toBe(true)
  })

  it('offers a Last-Minute Surcharge, and it needs evidence too', () => {
    const lm = { ...extra, service_type: 'Last-Minute Surcharge', description: 'Booked at 9pm for a 10am turn' }
    expect(validateVendorItem(lm, ctx).errors.evidence_url).toBe('evidence_required')
    expect(validateVendorItem({ ...lm, evidence_url: 'https://tendwell.slack.com/archives/C08/p9' }, ctx).ok).toBe(true)
  })

  it('rejects a non-https evidence link', () => {
    expect(validateVendorItem({ ...extra, evidence_url: 'javascript:alert(1)' }, ctx).errors.evidence_url).toBe('invalid_url')
    expect(validateVendorItem({ ...extra, evidence_url: 'http://example.com' }, ctx).errors.evidence_url).toBe('invalid_url')
  })

  it('requires a real reason', () => {
    expect(validateVendorItem({ ...extra, description: 'hot tub' }, ctx).errors.description).toBe('too_short')
  })
})

describe('validateVendorItem — missing cleans bill the Cleaner Pay rate', () => {
  const missing: VendorItemInput = { category: 'missing_clean', property_id: 3, date: '2026-10-06', service_type: 'Turn Clean', amount: 999, description: 'Same-day turn Nina added by text, not in Breezeway' }

  it('ignores a typed amount and uses the property rate', () => {
    expect(validateVendorItem(missing, ctx).item?.amount).toBe(120)
  })

  it('deep cleans bill 3x the rate', () => {
    expect(validateVendorItem({ ...missing, service_type: 'Deep Clean' }, ctx).item?.amount).toBe(360)
  })

  it('refuses a property with no Cleaner Pay rate', () => {
    expect(validateVendorItem(missing, { ...ctx, propertyCleanerPay: null }).errors.amount).toBe('no_rate')
  })

  it('refuses onboarding (Ops decides first-clean onboarding)', () => {
    expect(validateVendorItem({ ...missing, service_type: 'Onboarding Clean' }, ctx).errors.service_type).toBe('unknown_type')
  })
})

describe('validateVendorItem — hours', () => {
  it('labor needs a worker, a description, hours and a rate', () => {
    const r = validateVendorItem({ category: 'labor', date: '2026-10-07' }, ctx)
    expect(r.errors).toMatchObject({ hours: 'hours_range', rate: 'rate_range', worker: 'required', description: 'required' })
  })

  it('computes hours x rate to the cent and bounds both', () => {
    const r = validateVendorItem({ category: 'labor', date: '2026-10-07', worker: 'Joshua', hours: 7.5, rate: 18.25, description: 'Linen washing at the facility' }, ctx)
    expect(r.item?.amount).toBe(136.88)
    expect(validateVendorItem({ category: 'inspection', worker: 'Irma', hours: 81, rate: 18 }, ctx).errors.hours).toBe('hours_range')
    expect(validateVendorItem({ category: 'inspection', worker: 'Irma', hours: 8, rate: 150 }, ctx).errors.rate).toBe('rate_range')
  })
})

describe('validatePeriod', () => {
  it('accepts a past week and refuses future, reversed and overlong periods', () => {
    expect(validatePeriod('2026-10-04', '2026-10-10', '2026-10-12')).toBeNull()
    expect(validatePeriod('2026-10-04', '2026-10-13', '2026-10-12')).toBe('date_in_future')
    expect(validatePeriod('2026-10-10', '2026-10-04', '2026-10-12')).toBe('period_order')
    expect(validatePeriod('2026-08-01', '2026-10-10', '2026-10-12')).toBe('period_too_long')
    expect(validatePeriod('nope', '2026-10-10', '2026-10-12')).toBe('invalid_date')
  })
})

describe('vendorNotices', () => {
  it('maps only vendor-safe flags and hides Tendwell-internal ones', () => {
    expect(vendorNotices(['owner_stay', 'no_billing_channel', 'standard_priced', 'client_priced', 'aux_task'])).toEqual([])
    expect(vendorNotices(['unmatched_task', 'already_billed', 'possible_duplicate', 'unmatched_task'])).toEqual(['no_task', 'already_billed', 'possible_duplicate'])
  })
})

describe('vendorRunStatus', () => {
  it('derives the vendor-facing lifecycle', () => {
    expect(vendorRunStatus({ status: 'draft' })).toBe('draft')
    expect(vendorRunStatus({ status: 'review_needed', submitted_at: '2026-10-11T10:00:00Z' })).toBe('submitted')
    expect(vendorRunStatus({ status: 'reconciled' })).toBe('submitted')
    expect(vendorRunStatus({ status: 'draft', submitted_at: '2026-10-11T10:00:00Z', returned_at: '2026-10-11T12:00:00Z' })).toBe('returned')
    expect(vendorRunStatus({ status: 'exported' })).toBe('approved')
    expect(vendorRunStatus({ status: 'void' })).toBe('void')
  })
})

describe('isTestVendorName', () => {
  it('matches the verify scripts\' throwaway vendors, any case', () => {
    expect(isTestVendorName('ZZ E2E Vendor 1759')).toBe(true)
    expect(isTestVendorName('ZZ Portal Test Vendor 1759')).toBe(true)
    expect(isTestVendorName('zz e2e vendor')).toBe(true)
  })
  it('never matches a real vendor or an empty name', () => {
    expect(isTestVendorName('Busy Bee Cleaning')).toBe(false)
    expect(isTestVendorName('ZZTop Cleaning')).toBe(false)
    expect(isTestVendorName('Fuzz Cleaning')).toBe(false)
    expect(isTestVendorName('')).toBe(false)
    expect(isTestVendorName(null)).toBe(false)
    expect(isTestVendorName(undefined)).toBe(false)
  })
})
