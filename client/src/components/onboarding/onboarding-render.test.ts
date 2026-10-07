import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Router } from 'wouter'

// The app's .tsx files use the automatic JSX transform under Vite, but vitest
// is configured without the React plugin, so give the classic transform a
// global `React` before any component module loads.
await vi.hoisted(async () => {
  ;(globalThis as any).React = await import('react')
})

// Server-render smoke tests: seed the React Query cache so no request is made,
// then render the real components and assert on the markup. They catch the
// runtime mistakes tsc cannot (a missing translation key, an undefined access).

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()
  const effectiveUser = {
    id: '1', label: 'Test Admin', role: 'admin',
    resolvedViews: ['settings', 'trellis-sync', 'access-codes', 'property-list', 'onboarding-queue'],
    resolvedPermissions: { 'property-list': { view: true, edit: true }, 'onboarding-queue': { view: true, edit: true } },
  }
  return { ...actual, useAuth: () => ({ effectiveUser, user: effectiveUser, isEmulating: false }) }
})
vi.mock('@/hooks/use-property-modal', () => ({
  usePropertyModal: () => ({ openPropertyModal: () => {}, closePropertyModal: () => {}, modalState: null }),
}))

import { LocaleProvider } from '@/lib/i18n/LocaleProvider'
import { PropertiesSection } from './PropertiesSection'
import { SubmissionRow } from './SubmissionsSection'
import { ExtrasList, IcalLinks, SecretText } from './shared'
import { onboardingReadiness, type OnboardingSubmission } from '@/lib/onboarding'

function render(node: ReturnType<typeof createElement>, qc = new QueryClient()) {
  return renderToString(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(LocaleProvider, null, createElement(Router, { ssrPath: '/' }, node)),
    ),
  )
}

describe('shared pieces', () => {
  it('masks API credentials until revealed and never prints the secret', () => {
    const html = render(createElement(ExtrasList, {
      submission: { invoice_email: 'bill@example.com', onboarding_deep_clean: true, api_key: 'TOP-SECRET-KEY', api_client_id: 'CLIENT-ID-1', photos: [] },
    }))
    expect(html).toContain('Invoice email')
    expect(html).toContain('Requested')
    expect(html).toContain('Reveal')
    expect(html).not.toContain('TOP-SECRET-KEY')
    expect(html).not.toContain('CLIENT-ID-1')
  })

  it('shows the secret text only after the toggle (hidden by default)', () => {
    const html = render(createElement(SecretText, { value: 'abcdef123456' }))
    expect(html).not.toContain('abcdef123456')
    expect(html).toContain('••••')
  })

  it('lists calendar links found in notes with a use button', () => {
    const html = render(createElement(IcalLinks, { urls: ['https://www.vrbo.com/icalendar/x.ics'], inUse: null, onUse: () => {} }))
    expect(html).toContain('https://www.vrbo.com/icalendar/x.ics')
    expect(html).toContain('Use as iCal URL')
  })
})

describe('PropertiesSection', () => {
  const property = { id: 7, name: 'Cabin Seven', address: '7 Ridge Rd', door_code: null, has_auto_code: false, ical_url: null, trellis_id: null, contact_id: 'c1' }
  const owner = { id: 'o1', name: 'Jane Owner', email: 'j@example.com', active: true, trellis_portal_url: null }

  function seeded(rows: unknown[]) {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    qc.setQueryData(['/supabase/onboarding-readiness'], rows)
    return qc
  }

  it('renders the checklist with a fix action per open item and a not-ready activate button', () => {
    const result = onboardingReadiness({ property, owners: [], agreements: [], submissions: [], hasApiKey: false })
    const html = render(
      createElement(PropertiesSection, { onReviewSubmissions: () => {} }),
      seeded([{ property, owners: [], submissions: [], result, days: 4 }]),
    )
    expect(html).toContain('Cabin Seven')
    expect(html).toContain('Days in onboarding: 4')
    expect(html).toContain('5 to do')
    for (const label of ['Owner portal', 'Service agreement', 'Intake form', 'Access code', 'Calendar', 'Trellis']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('Set up portal')
    expect(html).toContain('Add door code')
    expect(html).toContain('Add iCal link')
    expect(html).toContain('Link in API Sync')
    expect(html).toContain('Activate anyway')
    expect(html).not.toContain('onboardingAdmin.') // no raw translation keys leaking through
  })

  it('shows Ready to activate when everything is done', () => {
    const done = { ...property, door_code: '1234', ical_url: 'https://example.com/a.ics', trellis_id: 'tr-1' }
    const o = { ...owner, trellis_portal_url: 'https://app.trellistech.com/x' }
    const result = onboardingReadiness({
      property: done,
      owners: [o],
      agreements: [{ owner_id: 'o1', status: 'signed', owner_signed_at: '2026-09-20T12:00:00Z', created_at: null }],
      submissions: [],
      hasApiKey: false,
    })
    expect(result.ready).toBe(true)
    const html = render(
      createElement(PropertiesSection, { onReviewSubmissions: () => {} }),
      seeded([{ property: done, owners: [o], submissions: [], result, days: 1 }]),
    )
    expect(html).toContain('Ready to activate')
    expect(html).toContain('Move to Active')
    expect(html).toContain('Signed Sep 20, 2026.')
    expect(html).not.toContain('onboardingAdmin.')
  })

  it('shows an empty state when nothing is in Onboarding', () => {
    const html = render(createElement(PropertiesSection, { onReviewSubmissions: () => {} }), seeded([]))
    expect(html).toContain('No properties are in the Onboarding stage right now.')
  })
})

describe('SubmissionRow', () => {
  const base: OnboardingSubmission = {
    id: 's1', source: 'public', status: 'pending', token: null,
    client_name: 'Michael Baradell', contact_email: 'mike@example.com', contact_phone: null, invoice_email: 'billing@example.com',
    property_name: 'Baradell Cabin', address: '1624 Example Rd', bedrooms: 3, number_of_beds: 4, full_baths: 2, half_baths: 0,
    square_footage: 1800, bed_sizes: '1 King, 2 Twins', guest_count: null, kitchens: 1, pet_friendly: null,
    hot_tub: true, pool: false, linen_program: null, onboarding_deep_clean: true,
    door_code: '1234', auto_code: null, other_codes: null, wifi_info: null, filter_size: null,
    ical_url: 'https://www.airbnb.com/calendar/ical/1.ics?s=abc', api_client_id: null, api_key: 'TOP-SECRET-KEY',
    check_in_time: null, check_out_time: null,
    notes: 'VRBO calendar: http://www.vrbo.com/icalendar/zzz.ics',
    photos: ['2026-09-17/a.jpeg'], submitted_at: '2026-09-17T12:00:00Z', approved_at: null, approved_by: null,
    property_id: null, owner_id: null,
  }

  const noop = () => {}
  const row = (r: OnboardingSubmission, extra: Record<string, unknown> = {}) =>
    render(createElement(SubmissionRow, {
      r, expanded: true, onToggle: noop, property: undefined, ownerName: null, locale: 'en',
      onReview: noop, onMerge: noop, onReject: noop, onOpenProperty: noop, ...extra,
    }))

  it('shows every submitted field, flags the source and status, and hides the API secret', () => {
    const html = row(base)
    expect(html).toContain('Website')
    expect(html).toContain('New')
    expect(html).toContain('Pool')
    expect(html).toContain('billing@example.com')
    expect(html).toContain('Requested')
    expect(html).toContain('http://www.vrbo.com/icalendar/zzz.ics')
    expect(html).toContain('Reveal')
    expect(html).not.toContain('TOP-SECRET-KEY')
    expect(html).toContain('Review &amp; Create Property')
    expect(html).toContain('Apply to an existing property')
    expect(html).not.toContain('onboarding.') // no raw keys
    expect(html).not.toContain('onboardingAdmin.')
  })

  it('never turns a submitted javascript: / data: value into a link (stored-XSS guard)', () => {
    for (const evil of ['javascript:alert(document.cookie)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=']) {
      const html = row({ ...base, ical_url: evil, notes: null })
      expect(html).not.toMatch(/href="\s*(javascript|data):/i)
      expect(html).toContain('data-testid="ical-not-a-link"')
    }
    // ...while a real link in the same slot still renders as one.
    expect(row(base)).toContain('href="https://www.airbnb.com/calendar/ical/1.ics?s=abc"')
  })

  it('makes "Apply to <property>" the primary action for an owner submission that names its property', () => {
    const html = row(
      { ...base, source: 'owner', owner_id: 'o1', property_id: 652 },
      { property: { id: 652, name: 'Michael Baradell 1624', address: null, stage: 'Onboarding' }, ownerName: 'Michael Baradell' },
    )
    expect(html).toContain('Owner portal')
    expect(html).toContain('Apply to Michael Baradell 1624')
    expect(html).toContain('Create a new property instead')
    expect(html).not.toContain('Review &amp; Create Property')
  })

  it('links an applied row to its property and offers Re-apply', () => {
    const html = row(
      { ...base, status: 'converted', property_id: 652, approved_at: '2026-09-18T12:00:00Z', approved_by: 'Nina' },
      { property: { id: 652, name: 'Michael Baradell 1624', address: null, stage: 'Active' } },
    )
    expect(html).toContain('Applied to')
    expect(html).toContain('Michael Baradell 1624')
    expect(html).toContain('Re-apply')
    expect(html).not.toContain('Reject</button>')
  })
})
