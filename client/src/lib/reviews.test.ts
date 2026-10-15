import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REVIEW_FILTERS,
  attributionLabel,
  category5,
  filterReviews,
  isoDaysBefore,
  matchesAttribution,
  rating5,
  sortReviews,
  summarizeReviews,
  toReviewRow,
  type ReviewRow,
} from './reviews'

function row(p: Partial<ReviewRow>): ReviewRow {
  return {
    trellis_review_id: Math.random().toString(36).slice(2),
    review_date: '2026-10-01T12:00:00Z',
    source: 'AIRBNB',
    reviewer_name: 'Guest',
    guest_name: 'Guest',
    reservation_id: null,
    checkin_date: '2026-09-25',
    checkout_date: '2026-09-28',
    overall_rating: 5,
    max_rating: 5,
    normalized_rating: 1,
    cleanliness_5: 5,
    category_ratings: { cleanliness: 5 },
    content: 'Lovely stay',
    title: null,
    host_response_status: 'none',
    trellis_property_name: 'Cabin A',
    property_id: 1,
    property_name: 'Cabin A 101',
    clean_date: '2026-09-24',
    clean_kind: 'turn',
    clean_title: 'Turn Clean',
    cleaner_id: 'c1',
    cleaner_name: 'Ana',
    attribution: 'cleaner',
    ...p,
  }
}

describe('toReviewRow', () => {
  it('coerces numeric strings, normalizes category keys and unknown attribution', () => {
    const r = toReviewRow({
      trellis_review_id: 'r1',
      overall_rating: '4',
      max_rating: '5',
      normalized_rating: '0.8',
      cleanliness_5: '3.00',
      property_id: '12',
      category_ratings: { Cleanliness: '3', 'Check-in': 5, junk: 'x' },
      attribution: 'something_new',
      reservation_id: 98765,
    })
    expect(r.overall_rating).toBe(4)
    expect(r.cleanliness_5).toBe(3)
    expect(r.property_id).toBe(12)
    expect(r.category_ratings).toEqual({ cleanliness: 3, checkin: 5 })
    expect(r.attribution).toBe('no_ops_property')
    expect(r.reservation_id).toBe('98765')
  })
})

describe('rating scale', () => {
  it('uses normalized_rating, else overall/max', () => {
    expect(rating5(row({ normalized_rating: 0.8 }))).toBeCloseTo(4)
    expect(rating5(row({ normalized_rating: null, overall_rating: 8, max_rating: 10 }))).toBeCloseTo(4)
    expect(rating5(row({ normalized_rating: null, overall_rating: null }))).toBeNull()
  })
  it('scales categories by max_rating', () => {
    expect(category5(row({ max_rating: 10, category_ratings: { value: 8 } }), 'value')).toBeCloseTo(4)
    expect(category5(row({ category_ratings: null }), 'value')).toBeNull()
  })
})

describe('attributionLabel', () => {
  it('names the cleaner and the clean date', () => {
    expect(attributionLabel(row({}))).toEqual({ key: 'cleaner', tone: 'success', cleanerName: 'Ana', cleanDate: '2026-09-24' })
  })
  it('falls back to crew when a cleaner row has no name', () => {
    expect(attributionLabel(row({ cleaner_name: null })).key).toBe('tendwell_crew')
  })
  it('keeps the clean date for crew and not-Tendwell cleans', () => {
    expect(attributionLabel(row({ attribution: 'tendwell_crew', cleaner_name: null }))).toMatchObject({ key: 'tendwell_crew', tone: 'info', cleanDate: '2026-09-24' })
    expect(attributionLabel(row({ attribution: 'not_tendwell', cleaner_name: null }))).toMatchObject({ key: 'not_tendwell', cleanerName: null, cleanDate: '2026-09-24' })
  })
  it('has no clean date when no clean was found', () => {
    expect(attributionLabel(row({ attribution: 'no_clean_found', clean_date: null }))).toMatchObject({ tone: 'warning', cleanDate: null })
    expect(attributionLabel(row({ attribution: 'no_checkin' })).cleanDate).toBeNull()
    expect(attributionLabel(row({ attribution: 'no_ops_property' })).cleanDate).toBeNull()
  })
})

describe('filters', () => {
  const rows = [
    row({ trellis_review_id: 'a', attribution: 'cleaner', cleanliness_5: 5 }),
    row({ trellis_review_id: 'b', attribution: 'tendwell_crew', cleaner_name: null, cleanliness_5: 3, normalized_rating: 0.6, source: 'BOOKING' }),
    row({ trellis_review_id: 'c', attribution: 'not_tendwell', property_id: 2, property_name: 'Lodge 7' }),
    row({ trellis_review_id: 'd', attribution: 'no_clean_found' }),
    row({ trellis_review_id: 'e', attribution: 'no_checkin', cleanliness_5: null, source: 'VRBO' }),
    row({ trellis_review_id: 'f', attribution: 'no_ops_property', property_id: null, property_name: null }),
  ]
  const ids = (rs: ReviewRow[]) => rs.map((r) => r.trellis_review_id)

  it('defaults to Ops properties only', () => {
    expect(ids(filterReviews(rows, DEFAULT_REVIEW_FILTERS))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
  it('Tendwell-cleaned only = named cleaner + crew', () => {
    expect(ids(filterReviews(rows, { ...DEFAULT_REVIEW_FILTERS, attribution: 'tendwell' }))).toEqual(['a', 'b'])
  })
  it('groups no-clean and no-check-in, and isolates non-Ops', () => {
    expect(ids(filterReviews(rows, { ...DEFAULT_REVIEW_FILTERS, attribution: 'no_clean' }))).toEqual(['d', 'e'])
    expect(ids(filterReviews(rows, { ...DEFAULT_REVIEW_FILTERS, attribution: 'not_in_ops' }))).toEqual(['f'])
    expect(filterReviews(rows, { ...DEFAULT_REVIEW_FILTERS, attribution: 'all' })).toHaveLength(6)
    expect(matchesAttribution('not_tendwell', 'tendwell')).toBe(false)
  })
  it('filters by property, source, rating band and low cleanliness', () => {
    expect(ids(filterReviews(rows, { ...DEFAULT_REVIEW_FILTERS, propertyId: 2 }))).toEqual(['c'])
    expect(ids(filterReviews(rows, { ...DEFAULT_REVIEW_FILTERS, source: 'BOOKING' }))).toEqual(['b'])
    expect(ids(filterReviews(rows, { ...DEFAULT_REVIEW_FILTERS, rating: 'below4' }))).toEqual(['b'])
    expect(ids(filterReviews(rows, { ...DEFAULT_REVIEW_FILTERS, rating: 'r5' }))).toEqual(['a', 'c', 'd', 'e'])
    expect(ids(filterReviews(rows, { ...DEFAULT_REVIEW_FILTERS, lowCleanlinessOnly: true }))).toEqual(['b'])
  })
  it('searches property, text and cleaner name', () => {
    expect(ids(filterReviews(rows, { ...DEFAULT_REVIEW_FILTERS, search: 'lodge' }))).toEqual(['c'])
    expect(ids(filterReviews(rows, { ...DEFAULT_REVIEW_FILTERS, search: 'ANA', attribution: 'cleaner' }))).toEqual(['a'])
  })
})

describe('summarizeReviews', () => {
  it('computes averages, low-cleanliness share and Tendwell split', () => {
    const s = summarizeReviews([
      row({ cleanliness_5: 5, normalized_rating: 1 }),
      row({ attribution: 'tendwell_crew', cleaner_name: null, cleanliness_5: 3, normalized_rating: 0.6 }),
      row({ attribution: 'not_tendwell', cleanliness_5: 4, normalized_rating: 0.8, property_id: 2 }),
      row({ attribution: 'no_checkin', cleanliness_5: null, normalized_rating: null, overall_rating: null }),
    ])
    expect(s.count).toBe(4)
    expect(s.ratedCount).toBe(3)
    expect(s.avgRating).toBeCloseTo(4)
    expect(s.cleanlinessCount).toBe(3)
    expect(s.avgCleanliness).toBeCloseTo(4)
    expect(s.lowCleanlinessCount).toBe(1)
    expect(s.lowCleanlinessShare).toBeCloseTo(1 / 3)
    expect(s.tendwellCount).toBe(2)
    expect(s.namedCleanerCount).toBe(1)
    expect(s.tendwell).toEqual({ count: 2, avgCleanliness: 4 })
    expect(s.notTendwell).toEqual({ count: 1, avgCleanliness: 4 })
    expect(s.properties).toBe(2)
  })
  it('is empty-safe', () => {
    const s = summarizeReviews([])
    expect(s.avgRating).toBeNull()
    expect(s.lowCleanlinessShare).toBeNull()
  })
})

describe('sortReviews', () => {
  it('sorts lowest cleanliness first with unrated last', () => {
    const rs = sortReviews(
      [row({ trellis_review_id: 'x', cleanliness_5: null }), row({ trellis_review_id: 'y', cleanliness_5: 2 }), row({ trellis_review_id: 'z', cleanliness_5: 4 })],
      'lowest_cleanliness',
    )
    expect(rs.map((r) => r.trellis_review_id)).toEqual(['y', 'z', 'x'])
  })
  it('sorts newest first by default', () => {
    const rs = sortReviews([row({ trellis_review_id: 'old', review_date: '2026-01-01T00:00:00Z' }), row({ trellis_review_id: 'new', review_date: '2026-10-01T00:00:00Z' })], 'newest')
    expect(rs[0].trellis_review_id).toBe('new')
  })
})

describe('isoDaysBefore', () => {
  it('returns a local calendar date', () => {
    expect(isoDaysBefore(new Date(2026, 9, 14), 90)).toBe('2026-07-16')
    expect(isoDaysBefore(new Date(2026, 0, 5), 10)).toBe('2025-12-26')
  })
})
