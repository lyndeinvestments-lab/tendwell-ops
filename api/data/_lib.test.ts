import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildListQuery, clampLimit, forbiddenColumns, sanitizeWrite, selectClause } from './_lib.js'
import { API_AREAS, PROPERTY_OPS_COLUMNS, allScopes, findArea } from '../../shared/api-areas.js'

const clients = findArea('clients')!
const props = findArea('properties')!

describe('sanitizeWrite', () => {
  it('strips the area primary key so a write cannot reassign identity', () => {
    expect(sanitizeWrite({ id: 'abc', full_name: 'Nina' }, clients))
      .toEqual({ full_name: 'Nina' })
  })

  it('strips audit columns a client must not forge', () => {
    const out = sanitizeWrite(
      { full_name: 'Nina', created_at: '2020-01-01', updated_at: '2020-01-01' },
      clients,
    )
    expect(out).toEqual({ full_name: 'Nina' })
  })

  // The stage move must go through crm_set_client_stage() so the
  // client_stage_transitions row is written in the same statement. A raw PATCH
  // here would change the stage and silently skip the audit trail.
  it('denies client_stage so the audit trail cannot be bypassed', () => {
    const out = sanitizeWrite(
      { full_name: 'Nina', client_stage: 'won', client_stage_since: '2026-08-31' },
      clients,
    )
    expect(out).toEqual({ full_name: 'Nina' })
    expect(out).not.toHaveProperty('client_stage')
    expect(out).not.toHaveProperty('client_stage_since')
  })

  it('still allows the other CRM fields an integration legitimately sets', () => {
    const out = sanitizeWrite(
      { next_action: 'send quote', next_action_date: '2026-09-04', tags: ['whale'] },
      clients,
    )
    expect(out).toEqual({
      next_action: 'send quote',
      next_action_date: '2026-09-04',
      tags: ['whale'],
    })
  })

  it("coerces '' to null so a blank input does not poison a row", () => {
    expect(sanitizeWrite({ next_action: '', full_name: 'Nina' }, clients))
      .toEqual({ next_action: null, full_name: 'Nina' })
  })

  it('passes unknown columns through for PostgREST to reject loudly', () => {
    // Silent dropping would look like a successful write that did nothing.
    expect(sanitizeWrite({ not_a_column: 1 }, clients))
      .toEqual({ not_a_column: 1 })
  })

  it('returns an empty object for non-object bodies', () => {
    expect(sanitizeWrite(null, clients)).toEqual({})
    expect(sanitizeWrite('nope', clients)).toEqual({})
    expect(sanitizeWrite(undefined, clients)).toEqual({})
  })

  it('honours a non-id primary key', () => {
    const lostItems = findArea('lost-items')!
    expect(lostItems.pk).toBe('haven_case_id')
    expect(sanitizeWrite({ haven_case_id: 'x', status: 'open' }, lostItems))
      .toEqual({ status: 'open' })
  })
})

describe('buildListQuery', () => {
  it('turns column=value pairs into eq. filters', () => {
    expect(buildListQuery({ client_stage: 'prospect' }))
      .toBe('client_stage=eq.prospect')
  })

  it('ignores reserved and malformed keys so no raw operator leaks through', () => {
    const q = buildListQuery({
      resource: 'clients', id: '1', limit: '10', select: '*',
      'bad-key': 'x', 'DROP TABLE': 'x', client_stage: 'won',
    })
    expect(q).toBe('client_stage=eq.won')
  })

  it('passes a well-formed order through and rejects anything else', () => {
    expect(buildListQuery({ order: 'days_in_stage.desc' })).toBe('order=days_in_stage.desc')
    expect(buildListQuery({ order: 'name' })).toBe('order=name')
    expect(buildListQuery({ order: 'name.sideways' })).toBe('')
    expect(buildListQuery({ order: 'name; drop table x' })).toBe('')
  })

  it('skips empty values', () => {
    expect(buildListQuery({ client_stage: '' })).toBe('')
  })
})

describe('clampLimit', () => {
  it('defaults to 100 and clamps to 1..500', () => {
    expect(clampLimit(undefined)).toBe(100)
    expect(clampLimit('not-a-number')).toBe(100)
    expect(clampLimit('0')).toBe(1)
    expect(clampLimit('-5')).toBe(1)
    expect(clampLimit('250')).toBe(250)
    expect(clampLimit('99999')).toBe(500)
  })

  it('takes the first value of a repeated param', () => {
    expect(clampLimit(['7', '9'])).toBe(7)
  })
})

describe('API area registry', () => {
  it('has unique keys', () => {
    const keys = API_AREAS.map(a => a.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('never exposes a table from the documented security boundary', () => {
    // Mirrors the SECURITY BOUNDARY comment in shared/api-areas.ts. These are
    // absent by design and must never be granted to an API key.
    const forbidden = [
      'app_users', 'api_keys', 'app_settings', 'property_owners',
      'agreement_config', 'owner_agreements',
    ]
    const tables = API_AREAS.map(a => a.table)
    for (const t of forbidden) expect(tables, t).not.toContain(t)
    for (const t of tables) {
      expect(t.startsWith('owner_'), t).toBe(false)
      expect(t.startsWith('portal_'), t).toBe(false)
      expect(t.startsWith('notification_'), t).toBe(false)
      expect(t.includes('_backup_'), t).toBe(false)
    }
  })

  it('grants edit scopes only to rw areas', () => {
    const scopes = new Set(allScopes())
    for (const a of API_AREAS) {
      expect(scopes.has(`${a.key}:view`), a.key).toBe(true)
      expect(scopes.has(`${a.key}:edit`), a.key).toBe(a.access === 'rw')
    }
  })

  it('keeps the CRM read models read-only', () => {
    for (const key of ['client-360', 'crm-attention', 'crm-stale-quotes', 'client-stage-log']) {
      const area = findArea(key)
      expect(area, key).toBeDefined()
      expect(area!.access, key).toBe('read')
    }
  })

  it('exposes the interaction log as writable — logging a call is the point', () => {
    const area = findArea('client-interactions')
    expect(area).toBeDefined()
    expect(area!.table).toBe('contact_interactions')
    expect(area!.access).toBe('rw')
  })

  it('returns undefined for an unknown area', () => {
    expect(findArea('nope')).toBeUndefined()
    expect(findArea('')).toBeUndefined()
    expect(findArea(null)).toBeUndefined()
  })

  it('still exposes properties as rw (unchanged by this work)', () => {
    expect(props.access).toBe('rw')
  })
})

// An external agent that may see operations data but never money. The area is a
// column ALLOWLIST over `properties`, so these tests pin both directions: every
// listed column is real, and nothing financial can be added without failing here.
describe('property-details (no financials)', () => {
  const area = findArea('property-details')!
  const FINANCIAL = [
    'ce_charged', 'ce_per_sq', 'cleaner_pay', 'suggested_pay', 'custom_deep_clean_income',
    'deep_clean_3x_ce', 'est_consumables', 'est_laundry', 'estimated_deep_clean_cost',
    'estimated_profit', 'inspection_cost', 'linen_onboarding_fee', 'linen_program_cost',
    'monthly_cost_estimate', 'monthly_profit_estimate', 'monthly_revenue_estimate',
    'price_per_sq_foot', 'profit_deep_clean', 'profit_percentage', 'total_estimated_cost',
    'trash_cost', 'exclude_from_financials', 'avg_cleans_per_month', 'contact_id',
    'quote_owner_response', 'quote_responded_at', 'quote_sent_at',
  ]

  it('is a read-only view of the properties table with an allowlist', () => {
    expect(area.table).toBe('properties')
    expect(area.access).toBe('read')
    expect(area.columns).toBe(PROPERTY_OPS_COLUMNS)
  })

  it('exposes access codes, Wi-Fi and linen pars', () => {
    for (const c of ['door_code', 'auto_code', 'other_codes', 'wifi_info', 'bath_towels', 'filter_size']) {
      expect(PROPERTY_OPS_COLUMNS, c).toContain(c)
    }
  })

  it('contains no financial column', () => {
    for (const c of FINANCIAL) expect(PROPERTY_OPS_COLUMNS, c).not.toContain(c)
    // Belt and braces for a column added later under a money-ish name.
    for (const c of PROPERTY_OPS_COLUMNS) {
      expect(c, c).not.toMatch(/charge|pay|cost|profit|revenue|margin|price|fee|income|quote/)
    }
  })

  it('only lists columns that really exist on properties', () => {
    const types = readFileSync(new URL('../../shared/database.types.ts', import.meta.url), 'utf8')
    const m = types.match(/\n      properties: \{\n        Row: \{([\s\S]*?)\n        \}/)
    expect(m).not.toBeNull()
    const real = new Set(m![1].trim().split('\n').map(l => l.trim().split(':')[0]))
    for (const c of PROPERTY_OPS_COLUMNS) expect(real.has(c), c).toBe(true)
  })

  it('selects exactly the allowlist, and * for every other area', () => {
    expect(selectClause(area)).toBe(PROPERTY_OPS_COLUMNS.join(','))
    expect(selectClause(findArea('properties')!)).toBe('*')
  })

  it('rejects filtering or ordering on a hidden column (no probing)', () => {
    expect(forbiddenColumns({ ce_charged: '150' }, area)).toEqual(['ce_charged'])
    expect(forbiddenColumns({ order: 'cleaner_pay.desc' }, area)).toEqual(['cleaner_pay'])
    expect(forbiddenColumns({ stage_id: '3', order: 'name.asc', limit: '10' }, area)).toEqual([])
  })

  it('does not restrict areas without an allowlist', () => {
    expect(forbiddenColumns({ ce_charged: '150' }, findArea('properties')!)).toEqual([])
  })
})
