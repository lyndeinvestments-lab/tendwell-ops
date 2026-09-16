import { describe, it, expect } from 'vitest'
import {
  groupOwnerActivity,
  groupSubjectTarget,
  ownerName,
  BURST_WINDOW_MS,
  type OwnerActivityRow,
} from './_owner-activity.js'

function row(over: Partial<OwnerActivityRow> = {}): OwnerActivityRow {
  return {
    entity_type: 'property',
    entity_id: '550',
    entity_name: 'Morgan Hogg 3627',
    action: 'update',
    field_name: 'wifi_info',
    old_value: 'old',
    new_value: 'new',
    changed_by: 'Morgan Hogg (owner)',
    created_at: '2026-08-28T16:00:46.601Z',
    ...over,
  }
}

const min = (n: number) => n * 60_000

describe('ownerName', () => {
  it('strips the (owner) suffix the audit trail uses', () => {
    expect(ownerName('Morgan Hogg (owner)')).toBe('Morgan Hogg')
    expect(ownerName('Robin A Bulba (owner)')).toBe('Robin A Bulba')
  })

  it('refuses anything that is not an owner row', () => {
    // Real changed_by values from activity_log. The sweep's SQL filter is
    // deliberately loose ('%owner%', because PostgREST parses parentheses in a
    // filter value), so this is the check that actually keeps staff writes out.
    expect(ownerName('Jordan')).toBeNull()
    expect(ownerName('API: tendwell-cleaning-co lead capture')).toBeNull()
    expect(ownerName('Auto (task detected)')).toBeNull()
    expect(ownerName('Owner')).toBeNull()
    expect(ownerName(null)).toBeNull()
    expect(ownerName('(owner)')).toBeNull()
  })
})

describe('groupOwnerActivity', () => {
  it('collapses one multi-field save into one email', () => {
    // Morgan Hogg's real 2026-08-28 save: fourteen fields, one timestamp.
    const fields = [
      'king_beds', 'queen_beds', 'full_beds', 'twin_beds', 'door_code', 'wifi_info',
      'pool', 'ical_url', 'guest_count', 'hand_towels', 'washcloths', 'bath_towels',
      'bathmats', 'pool_towels',
    ]
    const groups = groupOwnerActivity(fields.map(f => row({ field_name: f })))

    expect(groups).toHaveLength(1)
    expect(groups[0].owner).toBe('Morgan Hogg')
    expect(groups[0].changeCount).toBe(14)
    expect(groups[0].records).toHaveLength(1)
    expect(groupSubjectTarget(groups[0])).toBe('Morgan Hogg 3627')
  })

  it('keeps one onboarding sitting across several properties as one email', () => {
    // Robin Bulba's real 2026-07-27 session: eight cabins over twenty-five
    // minutes. Grouping per property made that eight emails.
    const t0 = Date.parse('2026-07-27T20:49:07.157Z')
    const session: Array<[number, string, string]> = [
      [0, '364', 'BeautifulView333'],
      [7, '362', 'EasyStreet2882'],
      [9, '361', 'H2Oasis2257'],
      [11, '360', 'HeavenlyBliss'],
      [13, '359', 'MaddiesManor657'],
      [28, '358', 'RelaxationStat1940'],
      [31, '365', 'Rustic Chandelier 1214'],
    ]
    const groups = groupOwnerActivity(session.map(([m, id, name]) => row({
      changed_by: 'Robin Bulba (owner)',
      entity_id: id,
      entity_name: name,
      created_at: new Date(t0 + min(m)).toISOString(),
    })))

    expect(groups).toHaveLength(1)
    expect(groups[0].records).toHaveLength(7)
    expect(groupSubjectTarget(groups[0])).toBe('7 properties')
  })

  it('starts a new email after a real gap', () => {
    const t0 = Date.parse('2026-07-29T12:16:24.576Z')
    const groups = groupOwnerActivity([
      row({ changed_by: 'Robin A Bulba (owner)', created_at: new Date(t0).toISOString() }),
      // Robin's real second visit that day, an hour later: a separate sitting.
      row({ changed_by: 'Robin A Bulba (owner)', created_at: new Date(t0 + min(71)).toISOString() }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('measures the gap from the previous change, not the first', () => {
    // A long steady session must stay one email, however far past the window
    // its total span runs.
    const t0 = Date.parse('2026-07-27T20:49:07.157Z')
    const groups = groupOwnerActivity(
      [0, 10, 20, 30, 40, 50].map(m => row({ created_at: new Date(t0 + min(m)).toISOString() })),
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].changeCount).toBe(6)
  })

  it('never merges two owners, even editing at the same moment', () => {
    const t0 = Date.parse('2026-09-11T12:07:20.740Z')
    const groups = groupOwnerActivity([
      row({ changed_by: 'Robin Bulba (owner)', entity_id: '2257', field_name: 'other_codes', created_at: new Date(t0).toISOString() }),
      row({ changed_by: 'Farrah Dalal (owner)', entity_id: '540', field_name: 'door_code', created_at: new Date(t0 + 1000).toISOString() }),
      row({ changed_by: 'Robin Bulba (owner)', entity_id: '2257', field_name: 'wifi_info', created_at: new Date(t0 + 2000).toISOString() }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].owner).toBe('Robin Bulba')
    expect(groups[0].records[0].changes.map(c => c.field)).toEqual(['other_codes', 'wifi_info'])
    expect(groups[1].owner).toBe('Farrah Dalal')
  })

  it('splits a sitting into records so a property edit and a contact edit stay apart', () => {
    // Brandi Tropf's real pair: a bed count, then her payment method a minute
    // later. One sitting, two different records.
    const t0 = Date.parse('2026-08-08T02:15:14.184Z')
    const [g] = groupOwnerActivity([
      row({ changed_by: 'Brandi Tropf (owner)', entity_id: '505', entity_name: 'Brandi Tropf 2505', field_name: 'full_beds', created_at: new Date(t0).toISOString() }),
      row({ changed_by: 'Brandi Tropf (owner)', entity_type: 'contact', entity_id: 'f1c7a99f', entity_name: 'Brandi Tropf', field_name: 'payment_method', created_at: new Date(t0 + min(1)).toISOString() }),
    ])
    expect(g.records).toHaveLength(2)
    expect(g.changeCount).toBe(2)
    expect(g.records[0].entityType).toBe('property')
    expect(g.records[1].entityType).toBe('contact')
    // Not "2 properties": one of them is her contact record.
    expect(groupSubjectTarget(g)).toBe('2 records')
  })

  it('carries both sides of a field edit so the email can show from → to', () => {
    const [g] = groupOwnerActivity([
      row({ field_name: 'door_code', old_value: '1234', new_value: '5678' }),
    ])
    expect(g.records[0].changes[0]).toMatchObject({ field: 'door_code', from: '1234', to: '5678' })
  })

  it('falls back to the action when there is no field name', () => {
    const [g] = groupOwnerActivity([
      row({ action: 'photo_uploaded', field_name: null, old_value: null, new_value: 'Photo uploaded' }),
    ])
    expect(g.records[0].changes[0].field).toBe('photo_uploaded')
  })

  it('recovers a record name from a later row when the first lacks one', () => {
    const [g] = groupOwnerActivity([
      row({ entity_name: null }),
      row({ entity_name: 'Morgan Hogg 3627', field_name: 'pool' }),
    ])
    expect(g.records[0].entityName).toBe('Morgan Hogg 3627')
  })

  it('drops non-owner rows rather than attributing them to an owner', () => {
    expect(groupOwnerActivity([row({ changed_by: 'Jordan' })])).toHaveLength(0)
  })

  it('treats the window as inclusive at its edge', () => {
    const t0 = Date.parse('2026-08-28T16:00:46.601Z')
    const groups = groupOwnerActivity([
      row({ created_at: new Date(t0).toISOString() }),
      row({ created_at: new Date(t0 + BURST_WINDOW_MS).toISOString(), field_name: 'pool' }),
    ])
    expect(groups).toHaveLength(1)
  })

  it('falls back to a generic target when nothing is named', () => {
    const [g] = groupOwnerActivity([row({ entity_name: null })])
    expect(groupSubjectTarget(g)).toBe('their portal')
  })
})
