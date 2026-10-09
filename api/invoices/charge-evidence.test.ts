import { describe, expect, it } from 'vitest'
import { EVIDENCE_REQUIRED_SERVICES, evidenceLinkOk, linesMissingEvidence, type EvidenceCandidate } from './approve.js'
import { APPROVED_EXTRA_SERVICES } from './_engine.js'
import { chargeHasEvidence, isEvidenceLink, VENDOR_EXTRA_TYPES } from '../../shared/vendor-invoice.js'

describe('evidenceLinkOk', () => {
  it('accepts a Slack thread link', () => {
    expect(evidenceLinkOk('Dog hair everywhere, see https://tendwell.slack.com/archives/C08/p1728000000')).toBe(true)
    expect(evidenceLinkOk('https://slack.com/app_redirect?channel=C08')).toBe(true)
  })

  it('accepts photo hosts: Google Drive / Photos, Breezeway, image CDNs, Supabase storage', () => {
    expect(evidenceLinkOk('https://drive.google.com/file/d/abc/view')).toBe(true)
    expect(evidenceLinkOk('https://photos.app.goo.gl/xyz')).toBe(true)
    expect(evidenceLinkOk('https://lh3.googleusercontent.com/pw/abc=w2400')).toBe(true)
    expect(evidenceLinkOk('https://app.breezeway.io/task/123')).toBe(true)
    expect(evidenceLinkOk('https://i.imgur.com/abc')).toBe(true)
    expect(evidenceLinkOk('https://api.tendwellcleaningco.com/storage/v1/object/public/property-photos/1/a.jpg')).toBe(true)
    expect(evidenceLinkOk('https://xyz.supabase.co/storage/v1/object/sign/issue-photos/a?token=t')).toBe(true)
  })

  it('accepts any https URL whose path ends in an image extension', () => {
    expect(evidenceLinkOk('photo: https://example.com/uploads/IMG_2041.JPG.')).toBe(true)
    expect(evidenceLinkOk('https://cdn.example.com/a/b.heic?v=2')).toBe(true)
  })

  it('refuses http, other sites, look-alike hosts and plain text', () => {
    expect(evidenceLinkOk('http://tendwell.slack.com/archives/C08/p1')).toBe(false)
    expect(evidenceLinkOk('https://example.com/some/page')).toBe(false)
    expect(evidenceLinkOk('https://evilslack.com/archives/C08')).toBe(false)
    expect(evidenceLinkOk('https://slack.com.evil.io/x')).toBe(false)
    expect(evidenceLinkOk('Pet hair, Jordan approved in Slack')).toBe(false)
    expect(evidenceLinkOk('')).toBe(false)
    expect(evidenceLinkOk(null)).toBe(false)
    expect(isEvidenceLink('javascript:alert(1)')).toBe(false)
  })

  it('finds the link anywhere in a longer note, ignoring trailing punctuation', () => {
    expect(evidenceLinkOk('Guest left 2 dogs (https://tendwell.slack.com/archives/C1/p2), photos in thread.')).toBe(true)
  })
})

describe('chargeHasEvidence', () => {
  const bare = { source: 'vendor', receipt_path: null, vendor_detail: null, review_note: null, raw_note_text: 'Pet Fee - dog hair' }

  it('a line with no photo and no link has no evidence', () => {
    expect(chargeHasEvidence(bare)).toBe(false)
  })

  it('a vendor-portal photo upload is evidence', () => {
    expect(chargeHasEvidence({ ...bare, receipt_path: 'vendor-portal/v/r/photo.jpg' })).toBe(true)
  })

  it('a vendor-portal evidence link counts only when it is a Slack or photo link', () => {
    expect(chargeHasEvidence({ ...bare, vendor_detail: { evidence_url: 'https://tendwell.slack.com/archives/C1/p2' } })).toBe(true)
    expect(chargeHasEvidence({ ...bare, vendor_detail: { evidence_url: 'https://example.com/x' } })).toBe(false)
  })

  it('a link in the review note or the vendor note is evidence', () => {
    expect(chargeHasEvidence({ ...bare, review_note: 'see https://drive.google.com/file/d/abc' })).toBe(true)
    expect(chargeHasEvidence({ ...bare, raw_note_text: 'Pet Fee https://i.imgur.com/abc.png' })).toBe(true)
  })

  it('a line generated from a Breezeway/Trellis task carries its own record', () => {
    expect(chargeHasEvidence({ ...bare, source: 'task' })).toBe(true)
  })
})

describe('approve gate: charge evidence', () => {
  it('covers Pet Fee, Extra Cleaning, Double Clean and Last-Minute Surcharge', () => {
    expect([...EVIDENCE_REQUIRED_SERVICES].sort()).toEqual(['Double Clean', 'Extra Cleaning', 'Last-Minute Surcharge', 'Pet Fee'])
  })

  it('uses service names the engine and the vendor portal actually produce', () => {
    for (const s of EVIDENCE_REQUIRED_SERVICES) {
      expect(APPROVED_EXTRA_SERVICES as readonly string[]).toContain(s)
      expect(VENDOR_EXTRA_TYPES as readonly string[]).toContain(s)
    }
  })

  it('blocks exactly the unevidenced lines, named for the error message', () => {
    const row = (line_no: number, extra: Partial<EvidenceCandidate>): EvidenceCandidate => ({
      line_no, raw_property_text: `Cabin ${line_no}`, raw_amount: 25,
      source: 'vendor', receipt_path: null, vendor_detail: null, review_note: null, raw_note_text: null,
      ...extra,
    })
    const blocked = linesMissingEvidence([
      row(1, {}),
      row(2, { review_note: 'https://tendwell.slack.com/archives/C1/p2' }),
      row(3, { receipt_path: 'vendor-portal/v/r/p.jpg' }),
      row(4, { review_note: 'Jordan ok, https://example.com/page' }),
      row(5, { source: 'task' }),
    ])
    expect(blocked).toEqual([
      { line_no: 1, raw_property_text: 'Cabin 1', raw_amount: 25 },
      { line_no: 4, raw_property_text: 'Cabin 4', raw_amount: 25 },
    ])
  })
})
