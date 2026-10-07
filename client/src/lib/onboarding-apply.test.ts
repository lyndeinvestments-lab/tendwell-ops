import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { table: string; op: 'select' | 'insert' | 'update' | 'delete'; payload?: any; filters: [string, string, unknown][]; single: boolean }
type Reply = { data?: any; error?: { message: string; code?: string } | null }

// A tiny recording stand-in for the Supabase query builder: every call is
// captured so the tests can assert WHAT was written and in WHAT ORDER, and a
// per-test handler supplies canned replies (or errors).
const h = vi.hoisted(() => ({
  calls: [] as Call[],
  rpcCalls: [] as { fn: string; args: any }[],
  handler: (_c: Call): Reply | undefined => undefined,
  rpcReply: { data: true, error: null } as Reply,
}))

vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const call: Call = { table, op: 'select', filters: [], single: false }
    const b: any = {
      select: () => b,
      insert: (p: any) => { call.op = 'insert'; call.payload = p; return b },
      update: (p: any) => { call.op = 'update'; call.payload = p; return b },
      delete: () => { call.op = 'delete'; return b },
      eq: (c: string, v: unknown) => { call.filters.push(['eq', c, v]); return b },
      like: (c: string, v: unknown) => { call.filters.push(['like', c, v]); return b },
      single: () => { call.single = true; return b },
      then: (resolve: any, reject: any) => {
        h.calls.push(call)
        const reply = h.handler(call) ?? { data: call.single ? {} : [], error: null }
        return Promise.resolve({ error: null, ...reply }).then(resolve, reject)
      },
    }
    return b
  }
  return {
    supabase: {
      from: builder,
      rpc: (fn: string, args: any) => { h.rpcCalls.push({ fn, args }); return Promise.resolve(h.rpcReply) },
      storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.test/onboarding-uploads/${p}` } }) }) },
    },
    logActivity: vi.fn(async () => {}),
    logPropertyEdit: vi.fn(async () => {}),
  }
})

import { ApplyError, applySubmission, type ApplyArgs } from './onboarding-apply'
import type { OnboardingSubmission } from './onboarding'

const submission: OnboardingSubmission = {
  id: 'sub-1', source: 'owner', status: 'pending', token: null,
  client_name: 'Michael Baradell', contact_email: 'mike@example.com', contact_phone: null, invoice_email: 'billing@example.com',
  property_name: 'Baradell Cabin', address: '1624 Example Rd', bedrooms: 3, number_of_beds: 3, full_baths: 2, half_baths: 0,
  square_footage: null, bed_sizes: '1 King, 2 Twins', guest_count: null, kitchens: 1, pet_friendly: null,
  hot_tub: false, pool: false, linen_program: null, onboarding_deep_clean: true,
  door_code: null, auto_code: null, other_codes: null, wifi_info: null, filter_size: null,
  ical_url: 'https://www.airbnb.com/calendar/ical/1.ics?s=abc', api_client_id: null, api_key: 'TOP-SECRET-KEY',
  check_in_time: null, check_out_time: null,
  notes: 'VRBO calendar: http://www.vrbo.com/icalendar/zzz.ics',
  photos: ['d/a.jpeg', 'd/b.jpeg', 'd/contract.pdf'],
  submitted_at: '2026-09-17T12:00:00Z', approved_at: null, approved_by: null, property_id: null, owner_id: 'owner-1',
}

const createArgs = (over: Partial<ApplyArgs> = {}): ApplyArgs => ({
  submission,
  propertyId: null,
  existing: null,
  values: {
    name: 'Baradell Cabin', address: '1624 Example Rd', ical_url: submission.ical_url, pool: false, hot_tub: false, bedrooms: 3,
  },
  choices: {},
  overrides: {},
  beds: { king: 1, queen: 0, full: 0, twin: 2 },
  hasAutoCode: false,
  contact: { kind: 'use', contactId: 'contact-9' },
  copyPhotos: true,
  changedBy: 'Nina',
  staff: { id: 5, label: 'Nina' },
  ...over,
})

const ops = () => h.calls.map(c => `${c.table}:${c.op}`)
const find = (table: string, op: Call['op']) => h.calls.filter(c => c.table === table && c.op === op)

// Canned replies for a healthy database. Tests layer an override on top with `with_()`.
const healthy = (c: Call): Reply | undefined => {
  if (c.table === 'properties' && c.op === 'insert') return { data: { id: 99, name: 'Baradell Cabin' } }
  if (c.table === 'onboarding_submissions' && c.op === 'select') return { data: { status: 'pending' } }
  if (c.table === 'onboarding_submissions' && c.op === 'update') return { data: [{ id: 'sub-1' }] }
  if (c.table === 'property_notes' && c.op === 'select') return { data: [] }
  if (c.table === 'property_photos' && c.op === 'select') return { data: [{ photo_url: 'https://cdn.test/onboarding-uploads/d/a.jpeg', sort_order: 2 }] }
  return undefined
}
const with_ = (override: (c: Call) => Reply | undefined) => { h.handler = (c) => override(c) ?? healthy(c) }

beforeEach(() => {
  h.calls.length = 0
  h.rpcCalls.length = 0
  h.rpcReply = { data: true, error: null }
  h.handler = healthy
})

describe('applySubmission: create', () => {
  it('writes the property first, marks the submission applied, then everything else', async () => {
    const res = await applySubmission(createArgs())

    // A fresh status read, then the critical pair in this order; follow-ups after.
    expect(ops().slice(0, 4)).toEqual(['onboarding_submissions:select', 'properties:insert', 'onboarding_submissions:update', 'stage_transitions:insert'])

    const prop = find('properties', 'insert')[0].payload
    expect(prop).toMatchObject({ stage_id: 3, ical_url: 'https://www.airbnb.com/calendar/ical/1.ics?s=abc', pool: false, contact_id: 'contact-9', king_beds: 1, twin_beds: 2 })

    expect(find('onboarding_submissions', 'update')[0].payload).toMatchObject({ status: 'converted', property_id: 99, approved_by: 'Nina' })
    expect(find('stage_transitions', 'insert')[0].payload).toMatchObject({ property_id: 99, from_stage_id: null, to_stage_id: 3 })

    expect(res).toMatchObject({ propertyId: 99, mode: 'create', noteAdded: true, photosAdded: 1, ownerLinked: true, warnings: [] })
  })

  it('saves the notes with the invoice email and deep clean, but never the API secret', async () => {
    await applySubmission(createArgs())
    const note = find('property_notes', 'insert')[0].payload
    expect(note.property_id).toBe(99)
    expect(note.created_by).toBe('Nina')
    expect(note.content).toContain('Onboarding form notes from Michael Baradell: VRBO calendar: http://www.vrbo.com/icalendar/zzz.ics')
    expect(note.content).toContain('Invoice email: billing@example.com')
    expect(note.content).toContain('onboarding deep clean')
    expect(note.content).not.toContain('TOP-SECRET-KEY')
  })

  it('copies only new image uploads (not PDFs, not ones the property already has) after the existing gallery', async () => {
    await applySubmission(createArgs())
    const rows = find('property_photos', 'insert')[0].payload
    expect(rows).toEqual([{ property_id: 99, photo_url: 'https://cdn.test/onboarding-uploads/d/b.jpeg', sort_order: 3 }])
  })

  it('skips photos when the admin unticks the box', async () => {
    const res = await applySubmission(createArgs({ copyPhotos: false }))
    expect(find('property_photos', 'insert')).toHaveLength(0)
    expect(res.photosAdded).toBe(0)
  })

  it('links the owner through the narrow RPC', async () => {
    await applySubmission(createArgs())
    expect(h.rpcCalls).toEqual([{ fn: 'onboarding_link_owner_property', args: { p_submission_id: 'sub-1' } }])
  })

  it('falls back to a direct owner_properties insert when the RPC is not deployed', async () => {
    h.rpcReply = { data: null, error: { message: 'function not found', code: 'PGRST202' } }
    const res = await applySubmission(createArgs())
    expect(find('owner_properties', 'insert')[0].payload).toEqual({ owner_id: 'owner-1', property_id: 99 })
    expect(res.ownerLinked).toBe(true)
  })

  it('creates a new contact only when asked to', async () => {
    with_((c) => (c.table === 'contacts' && c.op === 'insert' ? { data: { id: 'new-contact' } } : undefined))
    await applySubmission(createArgs({ contact: { kind: 'create', name: 'Mike', email: 'mike@example.com', phone: '' } }))
    expect(find('contacts', 'insert')).toHaveLength(1)
    expect(find('properties', 'insert')[0].payload.contact_id).toBe('new-contact')

    h.calls.length = 0
    await applySubmission(createArgs({ contact: { kind: 'use', contactId: 'contact-9' } }))
    expect(find('contacts', 'insert')).toHaveLength(0) // reused, no duplicate client
  })

  it('reports a failed follow-up as a warning and keeps going, instead of failing the whole apply', async () => {
    with_((c) => (c.table === 'property_notes' && c.op === 'insert' ? { error: { message: 'boom' } } : undefined))
    const res = await applySubmission(createArgs())
    expect(res.propertyId).toBe(99)
    expect(res.noteAdded).toBe(false)
    expect(res.warnings.map(w => w.code)).toEqual(['note'])
    expect(res.photosAdded).toBe(1) // later steps still ran
  })

  it('throws a typed error carrying the new property id when the "mark applied" write fails, so staff never create a duplicate', async () => {
    with_((c) => (c.table === 'onboarding_submissions' && c.op === 'update' ? { error: { message: 'rls says no' } } : undefined))
    await expect(applySubmission(createArgs())).rejects.toMatchObject({ name: 'ApplyError', code: 'mark_failed', propertyId: 99, mode: 'create' })
    await expect(applySubmission(createArgs())).rejects.toBeInstanceOf(ApplyError)
  })
})

describe('applySubmission: re-apply to an already applied submission', () => {
  const existing = {
    id: 99, name: 'Baradell Cabin', address: '1624 Example Rd', ical_url: 'https://www.airbnb.com/calendar/ical/1.ics?s=abc', pool: false,
    hot_tub: false, bedrooms: 3, king_beds: 1, queen_beds: 0, full_beds: 0, twin_beds: 2, bed_sizes_text: '1 King, 2 Twins', has_auto_code: false, notes: null, contact_id: 'contact-9',
  }
  const applied = { ...submission, status: 'converted' as const, property_id: 99 }
  const noteContent =
    'Onboarding form notes from Michael Baradell: VRBO calendar: http://www.vrbo.com/icalendar/zzz.ics\nInvoice email: billing@example.com\nClient requested an onboarding deep clean.\nBooking API credentials provided (kept on the onboarding submission, not copied here).'

  it('adds nothing and rewrites nothing when everything is already there', async () => {
    with_((c) => {
      if (c.table === 'property_notes' && c.op === 'select') return { data: [{ content: noteContent }] }
      if (c.table === 'property_photos' && c.op === 'select') {
        return { data: ['d/a.jpeg', 'd/b.jpeg'].map((p, i) => ({ photo_url: `https://cdn.test/onboarding-uploads/${p}`, sort_order: i })) }
      }
      return undefined
    })
    const res = await applySubmission(createArgs({
      submission: applied, propertyId: 99, existing,
      choices: { ical_url: 'current', pool: 'current' },
      contact: { kind: 'none' },
    }))
    expect(find('properties', 'update')).toHaveLength(0)
    expect(find('onboarding_submissions', 'update')).toHaveLength(0) // approved_by / approved_at stay as they were
    expect(find('property_notes', 'insert')).toHaveLength(0)
    expect(find('property_photos', 'insert')).toHaveLength(0)
    expect(res).toMatchObject({ mode: 'merge', filled: 0, noteAdded: false, photosAdded: 0, warnings: [] })
  })

  it('repairs only what is missing: the photo that failed last time is added now', async () => {
    with_((c) => {
      if (c.table === 'property_notes' && c.op === 'select') return { data: [{ content: noteContent }] }
      if (c.table === 'property_photos' && c.op === 'select') return { data: [{ photo_url: 'https://cdn.test/onboarding-uploads/d/a.jpeg', sort_order: 0 }] }
      return undefined
    })
    const res = await applySubmission(createArgs({
      submission: applied, propertyId: 99, existing,
      choices: { ical_url: 'current' },
      contact: { kind: 'none' },
    }))
    expect(find('property_notes', 'insert')).toHaveLength(0)
    expect(find('property_photos', 'insert')[0].payload).toEqual([{ property_id: 99, photo_url: 'https://cdn.test/onboarding-uploads/d/b.jpeg', sort_order: 1 }])
    expect(res.photosAdded).toBe(1)
  })
})

describe('applySubmission: apply to an existing property from a pending submission', () => {
  it('fills the blank iCal and pool, logs each change, then marks the submission applied', async () => {
    const existing = {
      id: 99, name: 'Baradell Cabin', address: '1624 Example Rd', ical_url: null, pool: null, hot_tub: false, bedrooms: 3,
      king_beds: 1, queen_beds: 0, full_beds: 0, twin_beds: 2, bed_sizes_text: '1 King, 2 Twins', has_auto_code: false, notes: 'Existing note', contact_id: null,
    }
    const { logPropertyEdit } = await import('@/lib/supabase')
    const res = await applySubmission(createArgs({
      propertyId: 99, existing,
      choices: { ical_url: 'submitted', pool: 'submitted' },
      contact: { kind: 'use', contactId: 'contact-9' },
    }))
    const patch = find('properties', 'update')[0].payload
    expect(patch).toMatchObject({ ical_url: 'https://www.airbnb.com/calendar/ical/1.ics?s=abc', pool: false, contact_id: 'contact-9' })
    expect(ops().indexOf('properties:update')).toBeLessThan(ops().indexOf('onboarding_submissions:update'))
    expect(find('onboarding_submissions', 'update')[0].payload).toMatchObject({ status: 'converted', property_id: 99 })
    expect((logPropertyEdit as any).mock.calls.map((c: any[]) => c[1])).toEqual(expect.arrayContaining(['ical_url', 'pool', 'contact_id']))
    expect(res.mode).toBe('merge')
    // Merge / Re-apply also runs the idempotent link RPC (it returns true when already linked),
    // but never inserts owner_properties directly while the RPC is deployed.
    expect(h.rpcCalls).toEqual([{ fn: 'onboarding_link_owner_property', args: { p_submission_id: 'sub-1' } }])
    expect(find('owner_properties', 'insert')).toHaveLength(0)
    // The staff note was written but the existing legacy `notes` text was not overwritten.
    expect(find('properties', 'update').filter(c => 'notes' in c.payload)).toHaveLength(0)
  })
})

describe('applySubmission: concurrency and cleanup', () => {
  it('stops before writing anything when somebody else already applied the submission', async () => {
    with_((c) => (c.table === 'onboarding_submissions' && c.op === 'select' ? { data: { status: 'converted' } } : undefined))
    await expect(applySubmission(createArgs())).rejects.toMatchObject({ name: 'ApplyError', code: 'already_applied', propertyId: null })
    expect(find('properties', 'insert')).toHaveLength(0)
    expect(find('contacts', 'insert')).toHaveLength(0)
  })

  it('claims the submission with a status = pending guard and reports it when another save won the race', async () => {
    with_((c) => (c.table === 'onboarding_submissions' && c.op === 'update' ? { data: [] } : undefined))
    await expect(applySubmission(createArgs())).rejects.toMatchObject({ code: 'already_applied', propertyId: 99, mode: 'create' })
    const claim = find('onboarding_submissions', 'update')[0]
    expect(claim.filters).toEqual(expect.arrayContaining([['eq', 'id', 'sub-1'], ['eq', 'status', 'pending']]))
    // The property was already written, so no follow-up work (notes, photos, owner link) piles on top of it.
    expect(find('property_notes', 'insert')).toHaveLength(0)
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('removes the client row it just inserted when the property insert fails, so nothing is orphaned', async () => {
    with_((c) => {
      if (c.table === 'contacts' && c.op === 'insert') return { data: { id: 'new-contact' } }
      if (c.table === 'properties' && c.op === 'insert') return { error: { message: 'constraint failed' } }
      return undefined
    })
    await expect(applySubmission(createArgs({ contact: { kind: 'create', name: 'Mike', email: '', phone: '' } }))).rejects.toMatchObject({ message: 'constraint failed' })
    const del = find('contacts', 'delete')[0]
    expect(del.filters).toEqual([['eq', 'id', 'new-contact']])
  })

  it('never deletes a client it did not create', async () => {
    with_((c) => (c.table === 'properties' && c.op === 'insert' ? { error: { message: 'constraint failed' } } : undefined))
    await expect(applySubmission(createArgs({ contact: { kind: 'use', contactId: 'contact-9' } }))).rejects.toBeTruthy()
    expect(find('contacts', 'delete')).toHaveLength(0)
  })
})

describe('applySubmission: owner link repair', () => {
  const existing = {
    id: 99, name: 'Baradell Cabin', address: '1624 Example Rd', ical_url: 'https://www.airbnb.com/calendar/ical/1.ics?s=abc', pool: false,
    hot_tub: false, bedrooms: 3, king_beds: 1, queen_beds: 0, full_beds: 0, twin_beds: 2, bed_sizes_text: '1 King, 2 Twins', has_auto_code: false, notes: null, contact_id: 'contact-9',
  }
  const applied = { ...submission, status: 'converted' as const, property_id: 99 }
  const reapply = () => createArgs({ submission: applied, propertyId: 99, existing, choices: {}, contact: { kind: 'none' } })

  it('Re-apply runs the guarded RPC so a link that failed the first time is repaired', async () => {
    const res = await applySubmission(reapply())
    expect(h.rpcCalls).toHaveLength(1)
    expect(res.ownerLinked).toBe(true)
    expect(res.warnings).toEqual([])
  })

  it('warns when the RPC declines (not a fresh ownerless onboarding property) instead of forcing a link', async () => {
    h.rpcReply = { data: false, error: null }
    const res = await applySubmission(reapply())
    expect(res.ownerLinked).toBe(false)
    expect(res.warnings.map(w => w.code)).toEqual(['owner_link'])
    expect(find('owner_properties', 'insert')).toHaveLength(0)
  })

  it('only falls back to a direct insert when the RPC does not exist, not on any error (e.g. not authorized)', async () => {
    h.rpcReply = { data: null, error: { message: 'not authorized', code: 'P0001' } }
    const res = await applySubmission(reapply())
    expect(find('owner_properties', 'insert')).toHaveLength(0)
    expect(res.warnings.map(w => w.code)).toEqual(['owner_link'])
  })

  it('does nothing about owners for a submission that did not come from an owner', async () => {
    await applySubmission(createArgs({ submission: { ...applied, owner_id: null, source: 'public' }, propertyId: 99, existing, contact: { kind: 'none' } }))
    expect(h.rpcCalls).toHaveLength(0)
  })
})

describe('applySubmission: legacy preview text', () => {
  it('surfaces a failed update of the legacy notes preview as a warning, while the note itself is kept', async () => {
    with_((c) => (c.table === 'properties' && c.op === 'update' ? { error: { message: 'trigger failed' } } : undefined))
    const res = await applySubmission(createArgs())
    expect(res.noteAdded).toBe(true)
    expect(res.warnings.map(w => w.code)).toContain('legacy_note')
  })
})
