import { describe, expect, it } from 'vitest'
import {
  buildCreatePayload,
  buildMergePatch,
  buildOnboardingNote,
  daysSince,
  defaultChoices,
  defaultHasAutoCode,
  extractIcalUrls,
  initialCreateValues,
  isHttpUrl,
  isSimpleEmail,
  noteAlreadyExists,
  normalizeUrlInput,
  onboardingReadiness,
  parseBeds,
  planPhotoInserts,
  safeHref,
  sortReadiness,
  sourceLabel,
  statusLabel,
  submissionExtras,
  urlProblem,
  visibleFields,
  type OnboardingSubmission,
  type ReadinessProperty,
} from './onboarding'

const sub = (over: Partial<OnboardingSubmission> = {}): Partial<OnboardingSubmission> => ({
  client_name: 'Michael Baradell',
  contact_email: 'mike@example.com',
  property_name: 'Baradell Cabin',
  address: '1624 Example Rd, Gatlinburg, TN',
  bed_sizes: '1 King, 2 Twins',
  submitted_at: '2026-09-17T12:00:00Z',
  photos: [],
  ...over,
})

describe('extractIcalUrls', () => {
  it('finds the Airbnb and VRBO links hidden in a notes box (the Baradell case)', () => {
    const notes =
      'Airbnb is in the iCal field. Our VRBO calendar: http://www.vrbo.com/icalendar/abc123.ics?nonTentative, thanks!'
    expect(extractIcalUrls(notes)).toEqual(['http://www.vrbo.com/icalendar/abc123.ics?nonTentative'])
  })

  it('matches both "ical" paths and bare .ics files, and ignores other links', () => {
    const notes = [
      'https://www.airbnb.com/calendar/ical/548063046580139833.ics?s=6c74',
      'https://example.com/feed.ics',
      'https://www.airbnb.com/rooms/12345',
      'see (https://app.guesty.com/api/public/icalendar-dashboard-api/export/97e3).',
    ].join('\n')
    expect(extractIcalUrls(notes)).toEqual([
      'https://www.airbnb.com/calendar/ical/548063046580139833.ics?s=6c74',
      'https://example.com/feed.ics',
      'https://app.guesty.com/api/public/icalendar-dashboard-api/export/97e3',
    ])
  })

  it('dedupes, normalises webcal and handles empty input', () => {
    expect(extractIcalUrls('webcal://example.com/a.ics and https://example.com/a.ics')).toEqual(['https://example.com/a.ics'])
    expect(extractIcalUrls(null)).toEqual([])
    expect(extractIcalUrls('no links here')).toEqual([])
  })
})

describe('URL validation', () => {
  it('accepts http(s) URLs with a dotted host only', () => {
    expect(isHttpUrl('https://example.com/cal.ics')).toBe(true)
    expect(isHttpUrl('http://example.com')).toBe(true)
    expect(isHttpUrl('example.com/cal.ics')).toBe(false)
    expect(isHttpUrl('ftp://example.com/cal.ics')).toBe(false)
    expect(isHttpUrl('https://localhost')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
  })

  it('treats a webcal link as https, and blank as not a problem', () => {
    expect(normalizeUrlInput('  webcal://example.com/a.ics ')).toBe('https://example.com/a.ics')
    expect(urlProblem('webcal://example.com/a.ics')).toBeNull()
    expect(urlProblem('')).toBeNull()
    expect(urlProblem('not a url')).toBe('invalid_url')
  })
})

describe('safeHref (the only value allowed in an href)', () => {
  it('turns a real http(s) or webcal URL into a canonical link target', () => {
    expect(safeHref('https://www.airbnb.com/calendar/ical/1.ics?s=abc')).toBe('https://www.airbnb.com/calendar/ical/1.ics?s=abc')
    expect(safeHref('  http://example.com/feed.ics ')).toBe('http://example.com/feed.ics')
    expect(safeHref('webcal://example.com/a.ics')).toBe('https://example.com/a.ics')
    expect(safeHref('HTTPS://Example.com/A')).toBe('https://example.com/A')
  })

  it('refuses script-bearing and non-web schemes, however they are dressed up', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(document.cookie)',
      '  javascript:alert(1)',
      '\tjavascript:alert(1)',
      'java\nscript:alert(1)',
      'javascript://example.com/%0Aalert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com/a.ics',
      '//evil.example.com/a.ics',
      '/relative/path.ics',
      'example.com/a.ics',
      'https://',
      'https://localhost',
      '',
      '   ',
    ]) {
      expect(safeHref(bad), JSON.stringify(bad)).toBeNull()
    }
    expect(safeHref(null)).toBeNull()
    expect(safeHref(undefined)).toBeNull()
  })
})

describe('isSimpleEmail (gate before an email goes into a pattern match)', () => {
  it('accepts an ordinary address', () => {
    expect(isSimpleEmail('mike@example.com')).toBe(true)
    expect(isSimpleEmail('  Mike.O_Brien+tag@mail.example.co  ')).toBe(true)
  })

  it('rejects wildcards, filter syntax, whitespace and malformed shapes', () => {
    for (const bad of ['*@example.com', '%@example.com', 'a%b@example.com', 'a,b@example.com', 'a(b)@example.com', 'a b@example.com', 'a\\b@example.com', 'mike@example', 'mike@', '@example.com', 'mike', '', 'a@b@c.com']) {
      expect(isSimpleEmail(bad), JSON.stringify(bad)).toBe(false)
    }
    expect(isSimpleEmail(null)).toBe(false)
  })
})

describe('parseBeds', () => {
  it('reads quantities next to bed keywords', () => {
    expect(parseBeds('2 King, 1 Queen, 3 Twins')).toEqual({ king: 2, queen: 1, full: 0, twin: 3 })
    expect(parseBeds('King in master, Bedroom 3 has two Fulls')).toEqual({ king: 1, queen: 0, full: 1, twin: 0 })
    expect(parseBeds(null)).toEqual({ king: 0, queen: 0, full: 0, twin: 0 })
  })
})

describe('visibleFields', () => {
  it('always lists ical and pool, and hides legacy columns that carry no news', () => {
    const props = visibleFields(sub({ kitchens: 1, guest_count: null, pet_friendly: 'No' }), null).map(f => f.prop)
    expect(props).toContain('ical_url')
    expect(props).toContain('pool')
    expect(props).not.toContain('kitchens')
    expect(props).not.toContain('guest_count')
    expect(props).not.toContain('pet_friendly')
  })

  it('shows a legacy column when the answer differs from the default or from the listing', () => {
    expect(visibleFields(sub({ kitchens: 2, guest_count: 8, pet_friendly: 'Yes, 2 dogs' }), null).map(f => f.prop)).toEqual(
      expect.arrayContaining(['kitchens', 'guest_count', 'pet_friendly']),
    )
    const existing = { kitchens: 2, guest_count: 8, pet_friendly: 'Yes, 2 dogs' }
    expect(visibleFields(sub({ kitchens: 2, guest_count: 8, pet_friendly: 'Yes, 2 dogs' }), existing).map(f => f.prop)).not.toContain('guest_count')
  })
})

describe('merge into an existing property', () => {
  const existing = {
    name: 'Baradell Cabin', address: '1624 Example Rd', door_code: '1111', ical_url: null, pool: null,
    hot_tub: false, king_beds: 0, queen_beds: 0, full_beds: 0, twin_beds: 0, bed_sizes_text: null, has_auto_code: false,
  }
  const submission = sub({ door_code: '2222', ical_url: 'webcal://example.com/a.ics', pool: false, auto_code: '9999' })

  it('defaults to the submitted value only where the listing is blank (pool=false counts as an answer)', () => {
    const choices = defaultChoices(existing, submission)
    expect(choices.ical_url).toBe('submitted')
    expect(choices.pool).toBe('submitted')
    expect(choices.door_code).toBe('current') // never overwrite a code staff already have
  })

  it('writes ical_url (normalised) and pool, but not a conflicting value left on "current"', () => {
    const choices = defaultChoices(existing, submission)
    const patch = buildMergePatch({ submission, existing, choices, beds: parseBeds(submission.bed_sizes), hasAutoCode: defaultHasAutoCode(submission, existing) })
    expect(patch.ical_url).toBe('https://example.com/a.ics')
    expect(patch.pool).toBe(false)
    expect(patch.door_code).toBeUndefined()
    expect(patch.king_beds).toBe(1)
    expect(patch.twin_beds).toBe(2)
    expect(patch.bed_sizes_text).toBe('1 King, 2 Twins')
    expect(patch.has_auto_code).toBe(true) // prefilled from the submitted auto_code
  })

  it('takes an iCal link the admin swapped in from the notes', () => {
    const noIcal = sub({ ical_url: null })
    const overrides = { ical_url: 'https://www.vrbo.com/icalendar/x.ics' }
    const choices = defaultChoices(existing, noIcal, overrides)
    const patch = buildMergePatch({ submission: noIcal, existing, choices, beds: parseBeds(null), hasAutoCode: false, overrides })
    expect(patch.ical_url).toBe('https://www.vrbo.com/icalendar/x.ics')
  })

  it('is a no-op when nothing differs, so re-applying a submission writes nothing', () => {
    const settled = { ...existing, ical_url: 'https://example.com/a.ics', pool: false, king_beds: 1, twin_beds: 2, bed_sizes_text: '1 King, 2 Twins', has_auto_code: true }
    const choices = defaultChoices(settled, submission)
    const patch = buildMergePatch({ submission, existing: settled, choices, beds: { king: 1, queen: 0, full: 0, twin: 2 }, hasAutoCode: true })
    expect(patch).toEqual({})
  })
})

describe('buildCreatePayload', () => {
  it('copies ical_url and pool, keeps an explicit pool=false, and strips unanswered columns', () => {
    const submission = sub({ ical_url: 'webcal://example.com/a.ics', pool: false, hot_tub: true, check_in_time: null })
    const payload = buildCreatePayload({
      submission,
      values: initialCreateValues(submission),
      beds: parseBeds(submission.bed_sizes),
      hasAutoCode: false,
      contactId: 'contact-1',
    })
    expect(payload.stage_id).toBe(3)
    expect(payload.ical_url).toBe('https://example.com/a.ics')
    expect(payload.pool).toBe(false)
    expect(payload.hot_tub).toBe(true)
    expect(payload.contact_id).toBe('contact-1')
    expect('check_in_time' in payload).toBe(false) // NOT NULL column keeps its default
    expect(payload.king_beds).toBe(1)
  })

  it('falls back through property name, address, client name', () => {
    const payload = buildCreatePayload({
      submission: sub({ property_name: null }),
      values: { name: '' },
      beds: parseBeds(null),
      hasAutoCode: false,
    })
    expect(payload.name).toBe('1624 Example Rd, Gatlinburg, TN')
  })
})

describe('submissionExtras', () => {
  it('lists every answer that has no property column, flagging secrets', () => {
    const extras = submissionExtras(sub({
      invoice_email: 'billing@example.com',
      onboarding_deep_clean: true,
      auto_code: '4821',
      api_client_id: 'client-1',
      api_key: 'sekret',
      photos: ['2026-09-17/a.jpeg', '2026-09-17/contract.pdf'],
    }))
    expect(extras.map(e => e.id)).toEqual(['invoice_email', 'onboarding_deep_clean', 'auto_code', 'api_client_id', 'api_key', 'pdfs'])
    expect(extras.find(e => e.id === 'api_key')?.secret).toBe(true)
    expect(extras.find(e => e.id === 'invoice_email')?.sameAsContact).toBe(false)
    expect(extras.find(e => e.id === 'pdfs')?.value).toBe('1')
  })

  it('marks an invoice email that matches the contact email, and shows an explicit "no" deep clean', () => {
    const extras = submissionExtras(sub({ invoice_email: 'MIKE@example.com', onboarding_deep_clean: false }))
    expect(extras.find(e => e.id === 'invoice_email')?.sameAsContact).toBe(true)
    expect(extras.find(e => e.id === 'onboarding_deep_clean')?.value).toBe('no')
  })

  it('is empty when the client gave none of them', () => {
    expect(submissionExtras(sub())).toEqual([])
  })
})

describe('buildOnboardingNote', () => {
  it('leads with the notes, in the same shape the migration backfill writes', () => {
    const note = buildOnboardingNote(sub({ notes: '  Use the side gate.\nVRBO: http://www.vrbo.com/icalendar/x.ics  ' }))!
    expect(note.key).toBe('Onboarding form notes from Michael Baradell: Use the side gate.\nVRBO: http://www.vrbo.com/icalendar/x.ics')
    expect(note.content).toBe(note.key)
  })

  it('records invoice email, deep clean and API credentials, but never the API secret', () => {
    const note = buildOnboardingNote(sub({
      notes: 'Call before arriving',
      invoice_email: 'billing@example.com',
      onboarding_deep_clean: true,
      api_key: 'super-secret-key',
      api_client_id: 'client-9',
    }))!
    expect(note.content).toContain('Invoice email: billing@example.com')
    expect(note.content).toContain('onboarding deep clean')
    expect(note.content).toContain('Booking API credentials provided')
    expect(note.content).not.toContain('super-secret-key')
    expect(note.content).not.toContain('client-9')
  })

  it('still writes a note when there are no free-text notes but there are details to keep', () => {
    const note = buildOnboardingNote(sub({ onboarding_deep_clean: true }))!
    expect(note.key).toBe('Onboarding form details from Michael Baradell (submitted 2026-09-17):')
    expect(note.content).toContain('onboarding deep clean')
  })

  it('returns null when nothing needs preserving (invoice email equal to contact email is not news)', () => {
    expect(buildOnboardingNote(sub())).toBeNull()
    expect(buildOnboardingNote(sub({ invoice_email: 'mike@example.com' }))).toBeNull()
  })

  it('links attached PDFs and dedupes against an existing note', () => {
    const note = buildOnboardingNote(sub({ notes: 'hi', photos: ['x/contract.pdf'] }), p => `https://cdn.test/${p}`)!
    expect(note.content).toContain('https://cdn.test/x/contract.pdf')
    expect(noteAlreadyExists([note.content], note.key)).toBe(true)
    expect(noteAlreadyExists(['something else'], note.key)).toBe(false)
  })
})

describe('planPhotoInserts', () => {
  const urlFor = (p: string) => `https://cdn.test/onboarding-uploads/${p}`

  it('adds image uploads in order, skipping PDFs', () => {
    expect(planPhotoInserts(['d/a.jpeg', 'd/doc.pdf', 'd/b.PNG'], [], urlFor, 3)).toEqual([
      { photo_url: 'https://cdn.test/onboarding-uploads/d/a.jpeg', sort_order: 3 },
      { photo_url: 'https://cdn.test/onboarding-uploads/d/b.PNG', sort_order: 4 },
    ])
  })

  it('adds nothing on a re-run (dedupe by URL), and dedupes within the list', () => {
    const first = planPhotoInserts(['d/a.jpeg', 'd/a.jpeg'], [], urlFor)
    expect(first).toHaveLength(1)
    expect(planPhotoInserts(['d/a.jpeg'], first.map(r => r.photo_url), urlFor)).toEqual([])
  })
})

describe('labels', () => {
  it('names the source and status in plain words', () => {
    expect(sourceLabel('owner')).toBe('owner')
    expect(sourceLabel('public')).toBe('website')
    expect(sourceLabel('token')).toBe('link')
    expect(statusLabel('pending')).toBe('new')
    expect(statusLabel('converted')).toBe('applied')
    expect(statusLabel('approved')).toBe('applied')
    expect(statusLabel('rejected')).toBe('rejected')
  })
})

describe('onboardingReadiness', () => {
  const property: ReadinessProperty = {
    id: 1, name: 'Cabin', door_code: '1234', has_auto_code: false, ical_url: 'https://example.com/a.ics', trellis_id: 'tr-1', contact_id: 'c1',
  }
  const owner = { id: 'o1', name: 'Jane Owner', email: 'jane@example.com', active: true, trellis_portal_url: 'https://app.trellistech.com/x' }
  const signed = { owner_id: 'o1', status: 'signed', owner_signed_at: '2026-09-20T00:00:00Z', created_at: '2026-09-18T00:00:00Z' }
  const applied = { id: 's1', property_id: 1, status: 'converted', source: 'owner', submitted_at: '2026-09-17T00:00:00Z' }
  const state = (r: ReturnType<typeof onboardingReadiness>, id: string) => r.items.find(i => i.id === id)!

  it('is ready when every required item is done', () => {
    const r = onboardingReadiness({ property, owners: [owner], agreements: [signed], submissions: [applied], hasApiKey: false })
    expect(r.ready).toBe(true)
    expect(r.remaining).toBe(0)
    expect(state(r, 'agreement')).toMatchObject({ state: 'done', code: 'signed', date: '2026-09-20T00:00:00Z' })
    expect(state(r, 'intake')).toMatchObject({ state: 'done', code: 'applied' })
  })

  it('flags a bare property: no portal, agreement, access, calendar or Trellis', () => {
    const r = onboardingReadiness({
      property: { ...property, door_code: null, ical_url: null, trellis_id: null },
      owners: [], agreements: [], submissions: [], hasApiKey: false,
    })
    expect(r.ready).toBe(false)
    expect(state(r, 'portal')).toMatchObject({ state: 'todo', code: 'none' })
    expect(state(r, 'agreement')).toMatchObject({ state: 'todo', code: 'needs_portal' })
    expect(state(r, 'intake')).toMatchObject({ state: 'optional', code: 'none' })
    expect(state(r, 'access')).toMatchObject({ state: 'todo', code: 'missing' })
    expect(state(r, 'calendar')).toMatchObject({ state: 'todo', code: 'missing' })
    expect(state(r, 'trellis')).toMatchObject({ state: 'todo', code: 'missing_both' })
    expect(r.remaining).toBe(5) // intake is optional, so it does not count
  })

  it('treats an unsent, sent and void agreement differently', () => {
    const base = { property, owners: [owner], submissions: [applied], hasApiKey: false }
    expect(state(onboardingReadiness({ ...base, agreements: [] }), 'agreement')).toMatchObject({ state: 'todo', code: 'not_sent' })
    expect(state(onboardingReadiness({ ...base, agreements: [{ ...signed, status: 'sent' }] }), 'agreement')).toMatchObject({ state: 'todo', code: 'sent' })
    expect(state(onboardingReadiness({ ...base, agreements: [{ ...signed, status: 'void' }] }), 'agreement')).toMatchObject({ state: 'todo', code: 'not_sent' })
  })

  it('counts an inactive owner as no portal, and a pending submission as blocking', () => {
    const r = onboardingReadiness({
      property, owners: [{ ...owner, active: false }], agreements: [signed],
      submissions: [{ ...applied, id: 's2', status: 'pending' }], hasApiKey: false,
    })
    expect(state(r, 'portal')).toMatchObject({ state: 'todo', code: 'inactive' })
    expect(state(r, 'intake')).toMatchObject({ state: 'todo', code: 'pending', count: 1 })
    expect(r.ready).toBe(false)
  })

  it('accepts the smart-lock auto code for access and a submitted API key for the calendar', () => {
    const r = onboardingReadiness({
      property: { ...property, door_code: '  ', has_auto_code: true, ical_url: null },
      owners: [owner], agreements: [signed], submissions: [applied], hasApiKey: true,
    })
    expect(state(r, 'access')).toMatchObject({ state: 'done', code: 'auto_code' })
    expect(state(r, 'calendar')).toMatchObject({ state: 'done', code: 'api_key' })
    expect(r.ready).toBe(true)
  })

  it('needs BOTH the property Trellis id and the owner portal link', () => {
    const base = { owners: [owner], agreements: [signed], submissions: [applied], hasApiKey: false }
    expect(state(onboardingReadiness({ ...base, property: { ...property, trellis_id: null } }), 'trellis').code).toBe('missing_property')
    expect(state(onboardingReadiness({ ...base, property, owners: [{ ...owner, trellis_portal_url: null }] }), 'trellis').code).toBe('missing_owner')
  })
})

describe('daysSince / sortReadiness', () => {
  it('counts whole days and tolerates bad input', () => {
    const now = new Date('2026-10-06T12:00:00Z')
    expect(daysSince('2026-10-01T12:00:00Z', now)).toBe(5)
    expect(daysSince('2026-10-07T12:00:00Z', now)).toBe(0)
    expect(daysSince(null, now)).toBeNull()
    expect(daysSince('garbage', now)).toBeNull()
  })

  it('puts ready properties first, then the longest-waiting', () => {
    const r = (ready: boolean) => ({ items: [], ready, remaining: ready ? 0 : 2 })
    const rows = [
      { id: 'a', result: r(false), days: 2 },
      { id: 'b', result: r(false), days: 9 },
      { id: 'c', result: r(true), days: 1 },
    ]
    expect(sortReadiness(rows).map(x => x.id)).toEqual(['c', 'b', 'a'])
  })
})
