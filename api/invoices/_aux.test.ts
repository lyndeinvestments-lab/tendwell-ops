import { describe, expect, it } from 'vitest'
import { buildTaskLines, isHumanTouchedTaskLine, type AuxTaskRow, type ExistingLineRef } from './_aux'
import { resolveAuxSettings } from '../../shared/aux-tasks'
import type { PropertyRates } from './_engine'

const props = new Map<number, PropertyRates>([
  [1, { id: 1, name: 'Tara Rao 116', ceCharged: 200, cleanerPay: 120, deepClean3xCe: null, billingChannel: 'qbo_haven' }],
  [2, { id: 2, name: 'Geri Giddens 437', ceCharged: 180, cleanerPay: 100, deepClean3xCe: null, billingChannel: 'bill_com' }],
  [3, { id: 3, name: 'No Channel 1', ceCharged: 180, cleanerPay: 100, deepClean3xCe: null, billingChannel: null }],
])

const task = (over: Partial<AuxTaskRow> & Pick<AuxTaskRow, 'externalId' | 'title'>): AuxTaskRow => ({
  source: 'breezeway',
  propertyId: 1,
  date: '2026-09-10',
  department: 'Cleaning',
  completed: true,
  cancelled: false,
  ...over,
})

const base = {
  existing: [] as ExistingLineRef[],
  properties: props,
  settings: resolveAuxSettings(),
  periodStart: '2026-09-07',
  periodEnd: '2026-09-13',
  nextLineNo: 300,
}

describe('buildTaskLines — the money rules', () => {
  it('a completed hot tub refresh bills the client the standard $50, pays the vendor nothing, and is auto-approved', () => {
    const r = buildTaskLines({ ...base, tasks: [task({ externalId: 'bw1', title: 'Cleaning: Hot Tub Refresh' })] })
    expect(r.inserts).toHaveLength(1)
    const l = r.inserts[0]
    expect(l).toMatchObject({
      line_no: 300,
      source: 'task',
      line_kind: 'extra',
      service_type: 'Hot Tub Refresh Requested by Guest',
      raw_amount: 0,
      cleaner_pay_amount: null,
      client_charge_amount: 50,
      billing_channel: 'qbo_haven',
      review_status: 'ok',
      matched_task_id: 'bw1',
      property_id: 1,
      raw_property_text: 'Tara Rao 116',
      raw_date_mentioned: '2026-09-10',
    })
    expect(l.flags).toEqual(expect.arrayContaining(['aux_task', 'standard_priced']))
    expect(l.engine_note).toMatch(/not paid to the vendor/)
    expect(r.totalClientCharge).toBe(50)
    expect(r.needsReviewCount).toBe(0)
  })

  it('an unpriced type (Trip Fee) is still added, but queued with missing_rate', () => {
    const r = buildTaskLines({ ...base, tasks: [task({ externalId: 'bw2', title: 'Lockbox Key Check' })] })
    expect(r.inserts[0]).toMatchObject({ service_type: 'Trip Fee', client_charge_amount: null, review_status: 'needs_review' })
    expect(r.inserts[0].flags).toContain('missing_rate')
    expect(r.needsReviewCount).toBe(1)
  })

  it('a settings price for Trip Fee turns it into an auto-approved line', () => {
    const settings = resolveAuxSettings({ pricing: JSON.stringify({ 'Trip Fee': 35 }) })
    const r = buildTaskLines({ ...base, settings, tasks: [task({ externalId: 'bw2', title: 'Lockbox Key Check' })] })
    expect(r.inserts[0]).toMatchObject({ client_charge_amount: 35, review_status: 'ok' })
  })

  it('a delivery is a Reimbursement whose reason is the task title (no review)', () => {
    const r = buildTaskLines({ ...base, tasks: [task({ externalId: 'bw3', title: 'Urgent: deliver extra blankets for pull-out couch' })] })
    expect(r.inserts[0]).toMatchObject({ service_type: 'Reimbursement', client_charge_amount: 50, review_status: 'ok' })
    expect(r.inserts[0].raw_note_text).toBe('Urgent: deliver extra blankets for pull-out couch')
  })

  it('a property with no billing channel is flagged so Approve blocks until the client is routed', () => {
    const r = buildTaskLines({ ...base, tasks: [task({ externalId: 'bw4', title: 'Trash pickup', propertyId: 3 })] })
    expect(r.inserts[0].billing_channel).toBeNull()
    expect(r.inserts[0].flags).toContain('no_billing_channel')
  })
})

describe('buildTaskLines — what is skipped', () => {
  it('open, cancelled, non-billable, property-less and out-of-period tasks never bill', () => {
    const r = buildTaskLines({
      ...base,
      tasks: [
        task({ externalId: 'open', title: 'Hot Tub Refresh', completed: false }),
        task({ externalId: 'canc', title: 'Hot Tub Refresh', cancelled: true }),
        task({ externalId: 'insp', title: 'Cleaner Self-Inspection' }),
        task({ externalId: 'walk', title: 'Pre-Owner Stay Walkthrough' }),
        task({ externalId: 'filt', title: 'Air Filter Change' }),
        task({ externalId: 'vac', title: 'Vacancy Clean' }),
        task({ externalId: 'clean', title: 'Departure Clean' }),
        task({ externalId: 'unk', title: 'Bathroom' }),
        task({ externalId: 'noprop', title: 'Hot Tub Refresh', propertyId: null }),
        task({ externalId: 'late', title: 'Hot Tub Refresh', date: '2026-09-20' }),
      ],
    })
    expect(r.inserts).toHaveLength(0)
    expect(Object.fromEntries(r.skipped.map(s => [s.externalId, s.reason]))).toEqual({
      open: 'not_completed',
      canc: 'cancelled',
      insp: 'not_billable',
      walk: 'not_billable',
      filt: 'not_billable',
      vac: 'not_billable',
      clean: 'not_billable',
      unk: 'not_billable',
      noprop: 'no_property',
      late: 'outside_period',
    })
  })

  it('a category with no service type can never bill even when flipped on', () => {
    const settings = resolveAuxSettings({ billable: JSON.stringify({ vacancy_clean: true }) })
    const r = buildTaskLines({ ...base, settings, tasks: [task({ externalId: 'vac', title: 'Vacancy Clean' })] })
    expect(r.inserts).toHaveLength(0)
  })

  it('a billability override can switch a category off', () => {
    const settings = resolveAuxSettings({ billable: JSON.stringify({ hot_tub: false }) })
    const r = buildTaskLines({ ...base, settings, tasks: [task({ externalId: 'ht', title: 'Hot Tub Refresh' })] })
    expect(r.skipped[0].reason).toBe('not_billable')
  })

  it('the same task in Breezeway and Trellis bills once — Breezeway wins', () => {
    const r = buildTaskLines({
      ...base,
      tasks: [
        task({ externalId: 'trellis:abc', source: 'trellis', title: 'Hot Tub Refresh' }),
        task({ externalId: 'bw9', source: 'breezeway', title: 'Cleaning: Hot Tub Refresh' }),
      ],
    })
    expect(r.inserts).toHaveLength(1)
    expect(r.inserts[0].matched_task_id).toBe('bw9')
    expect(r.skipped).toEqual([{ externalId: 'trellis:abc', reason: 'duplicate_source' }])
  })

  it('two different billable tasks on the same property-day both bill', () => {
    const r = buildTaskLines({
      ...base,
      tasks: [
        task({ externalId: 'a', title: 'Hot Tub Refresh' }),
        task({ externalId: 'b', title: 'Mid-stay trash pickup' }),
      ],
    })
    expect(r.inserts.map(l => l.service_type)).toEqual(['Hot Tub Refresh Requested by Guest', 'Excessive Trash Pickup'])
    expect(r.inserts.map(l => l.line_no)).toEqual([300, 301])
  })

  it('a task already on the run (including a dismissed one) is not re-added — a dismissal sticks', () => {
    const existing: ExistingLineRef[] = [
      { source: 'task', propertyId: 1, serviceType: 'Hot Tub Refresh Requested by Guest', date: '2026-09-10', matchedTaskId: 'bw1', lineKind: 'excluded', reviewStatus: 'excluded' },
    ]
    const r = buildTaskLines({ ...base, existing, tasks: [task({ externalId: 'bw1', title: 'Hot Tub Refresh' })] })
    expect(r.inserts).toHaveLength(0)
    expect(r.skipped[0].reason).toBe('already_on_run')
  })

  it('a vendor line for the same property + service within a day means the vendor billed it — no double charge', () => {
    const existing: ExistingLineRef[] = [
      { source: 'vendor', propertyId: 1, serviceType: 'Hot Tub Refresh Requested by Guest', date: '2026-09-11', matchedTaskId: null, lineKind: 'extra', reviewStatus: 'ok' },
    ]
    const r = buildTaskLines({ ...base, existing, tasks: [task({ externalId: 'bw1', title: 'Hot Tub Refresh' })] })
    expect(r.inserts).toHaveLength(0)
    expect(r.skipped[0].reason).toBe('covered_by_vendor_line')
  })

  it('an EXCLUDED vendor line does not count as the vendor having billed it', () => {
    const existing: ExistingLineRef[] = [
      { source: 'vendor', propertyId: 1, serviceType: 'Hot Tub Refresh Requested by Guest', date: '2026-09-10', matchedTaskId: null, lineKind: 'excluded', reviewStatus: 'excluded' },
    ]
    const r = buildTaskLines({ ...base, existing, tasks: [task({ externalId: 'bw1', title: 'Hot Tub Refresh' })] })
    expect(r.inserts).toHaveLength(1)
  })

  it('a vendor line for a different property on the same day does not suppress', () => {
    const existing: ExistingLineRef[] = [
      { source: 'vendor', propertyId: 2, serviceType: 'Hot Tub Refresh Requested by Guest', date: '2026-09-10', matchedTaskId: null, lineKind: 'extra', reviewStatus: 'ok' },
    ]
    const r = buildTaskLines({ ...base, existing, tasks: [task({ externalId: 'bw1', title: 'Hot Tub Refresh' })] })
    expect(r.inserts).toHaveLength(1)
  })
})

describe('isHumanTouchedTaskLine', () => {
  it('keeps resolved / excluded / edited task rows and rebuilds untouched ones', () => {
    expect(isHumanTouchedTaskLine({ source: 'task', review_status: 'ok', resolved_by: null })).toBe(false)
    expect(isHumanTouchedTaskLine({ source: 'task', review_status: 'needs_review', resolved_by: null })).toBe(false)
    expect(isHumanTouchedTaskLine({ source: 'task', review_status: 'resolved', resolved_by: 'Nina' })).toBe(true)
    expect(isHumanTouchedTaskLine({ source: 'task', review_status: 'excluded', resolved_by: 'Nina' })).toBe(true)
    expect(isHumanTouchedTaskLine({ source: 'task', review_status: 'ok', line_kind: 'excluded' })).toBe(true)
    expect(isHumanTouchedTaskLine({ source: 'task', review_status: 'ok', resolved_by: 'Nina' })).toBe(true)
    expect(isHumanTouchedTaskLine({ source: 'vendor', review_status: 'resolved', resolved_by: 'Nina' })).toBe(false)
  })
})
