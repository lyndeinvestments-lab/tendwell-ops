import { describe, it, expect } from 'vitest'
import {
  hostawayNameKey,
  matchListingsToProperties,
  propertiesWithoutListing,
  type HostawayListingInput,
  type HostawayPropertyInput,
} from './hostaway-match'

// Real names/addresses from the 2026-10-20 "43 Haven properties expected in
// Hostaway but no listing" report. Every one of them has a listing; the old
// address-only matcher lost them to shared building addresses and to street
// spellings that differ between Hostaway and Ops.

const L = (id: number, name: string | null, addr: string | null, manual: number | null = null): HostawayListingInput => ({
  hostaway_id: id, internal_name: name, address_norm: addr, matched_property_id: manual,
})
const P = (id: number, name: string, addr: string | null, archived = false): HostawayPropertyInput => ({
  id, name, address_norm: addr, archived,
})

describe('hostawayNameKey', () => {
  it('drops the area tag, case, dash variants and spacing', () => {
    expect(hostawayNameKey('Greg Drury 1619-14 (SCounty)')).toBe('greg drury 1619-14')
    expect(hostawayNameKey('  Phillip Dueitt  3710–105 (GAT) ')).toBe('phillip dueitt 3710-105')
    expect(hostawayNameKey('Amanda Dolce-McCormack 191-32 (Cocke County)')).toBe('amanda dolce-mccormack 191-32')
  })
  it('only drops a TRAILING tag and tolerates null', () => {
    expect(hostawayNameKey('Cabin (A) North')).toBe('cabin (a) north')
    expect(hostawayNameKey(null)).toBe('')
  })
})

describe('matchListingsToProperties: shared building addresses (condos)', () => {
  // Three Ops units and three listings all at 338 Shooting Star Loop. The old
  // matcher gave every listing to the lowest id; now each unit gets its own.
  const props = [
    P(447, 'Brett Dickinson 338-203', '338 shooting star loop', true), // archived quote
    P(449, 'Julie Michala 338-101', '338 shooting star loop'),
    P(581, 'David Kiger 338-105', '338 shooting star loop'),
  ]
  const listings = [
    L(79561, 'Julie Michala 338-101 (BC)', '338 shooting star loop'),
    L(83048, 'Brett Dickinson 338-203 (BC)', '338 shooting star loop'),
    L(588814, 'David Kiger 338-105 (BC)', '338 shooting star loop'),
  ]
  it('gives each unit its own listing by name', () => {
    const m = matchListingsToProperties(listings, props)
    expect(m.get(79561)).toEqual({ property_id: 449, method: 'name' })
    expect(m.get(588814)).toEqual({ property_id: 581, method: 'name' })
    expect(m.get(83048)).toEqual({ property_id: 447, method: 'name' })
  })
  it('does not guess among several units when no name matches', () => {
    const m = matchListingsToProperties([L(1, 'Somebody Else 338-300 (BC)', '338 shooting star loop')], props)
    expect(m.has(1)).toBe(false)
  })
})

describe('matchListingsToProperties: addresses spelled differently', () => {
  it('matches by name when the street differs between Hostaway and Ops', () => {
    const props = [
      P(396, 'Kathleen Atkins 123', '123 valerie way'),
      P(484, 'Kelly Armsworth 511', '511 geneva ln'),
      P(552, 'Wah Shum 4160', '4160 high rdg way'),
      P(569, 'Chaitanya Chopra 1386', '1386 lk hvn way sevierville'),
    ]
    const listings = [
      L(147152, 'Kathleen Atkins 123 (SCounty)', '123 valerie st'),
      L(567670, 'Kelly Armsworth 511 (GAT)', '511 geneva dr'),
      L(90258, 'Wah Shum 4160 (SCounty)', '4160 high ridge way'),
      L(574523, 'Chaitanya Chopra 1386', '1386 lk hvn way'),
    ]
    const m = matchListingsToProperties(listings, props)
    expect([...m.values()].map((x) => x.property_id).sort()).toEqual([396, 484, 552, 569])
    expect([...m.values()].every((x) => x.method === 'name')).toBe(true)
  })

  it('matches an Ops address typo ("91 TN-32" for 191) by name', () => {
    const props = [P(719, 'Amanda Dolce-McCormack 191-32', '91 tn'), P(267, 'Robert Miller 191', '91 tn')]
    const listings = [
      L(592281, 'Amanda Dolce-McCormack 191-32 (Cocke County)', '191 tn'),
      L(500280, 'Robert Miller 191 (Cocke County)', '191 tn'),
    ]
    const m = matchListingsToProperties(listings, props)
    expect(m.get(592281)?.property_id).toBe(719)
    expect(m.get(500280)?.property_id).toBe(267)
  })
})

describe('matchListingsToProperties: units and ambiguity', () => {
  it('matches a listing that carries a unit the Ops name lacks', () => {
    const props = [P(31, 'Eric Fleming 1260', '1260 ski view dr')]
    const m = matchListingsToProperties([L(458087, 'Eric Fleming 1260-6203 (GAT)', '1260 ski view dr')], props)
    expect(m.get(458087)).toEqual({ property_id: 31, method: 'name' })
  })

  it('does not hand one property to two unit listings', () => {
    const props = [P(380, 'Lewis Anderson 2691', '2691 jessie rd')]
    const m = matchListingsToProperties([L(1, 'Lewis Anderson 2691-3'), L(2, 'Lewis Anderson 2691-4')], props)
    expect(m.size).toBe(0)
  })

  it('prefers the exact listing over the unit-stripped one', () => {
    const props = [P(380, 'Lewis Anderson 2691', '2691 jessie rd')]
    const m = matchListingsToProperties(
      [L(1, 'Lewis Anderson 2691 (SCounty)'), L(2, 'Lewis Anderson 2691-8 (SCounty)')],
      props,
    )
    expect(m.get(1)?.property_id).toBe(380)
    expect(m.has(2)).toBe(false)
  })

  it('matches an Ops name with a unit to a unique shorter listing', () => {
    const props = [P(719, 'Amanda Dolce-McCormack 191-32', '91 tn')]
    expect(matchListingsToProperties([L(1, 'Amanda Dolce-McCormack 191')], props).get(1)?.property_id).toBe(719)
    // two listings share the shorter name: ambiguous, so no match
    expect(
      matchListingsToProperties([L(1, 'Amanda Dolce-McCormack 191'), L(2, 'Amanda Dolce-McCormack 191 (BC)')], props).size,
    ).toBe(0)
  })

  it('prefers a live property over an archived duplicate of the same name', () => {
    const props = [P(507, 'Kelly Armsworth 3634', '3634 x', true), P(499, 'Kelly Armsworth 3634', '3634 x')]
    expect(matchListingsToProperties([L(1, 'Kelly Armsworth 3634 (GAT)')], props).get(1)?.property_id).toBe(499)
  })

  it('treats two live properties with one name as ambiguous', () => {
    const props = [P(1, 'Same Name 100', '100 a st'), P(2, 'Same Name 100', '100 a st')]
    expect(matchListingsToProperties([L(9, 'Same Name 100', '100 a st')], props).size).toBe(0)
  })
})

describe('matchListingsToProperties: aliases, manual, address fallback', () => {
  it('matches property aliases', () => {
    const props = [P(540, 'Farrah Dalal 1559', '1559 x')]
    const m = matchListingsToProperties([L(5, 'The Stillwood House', null)], props, [
      { property_id: 540, alias: 'The Stillwood House' },
    ])
    expect(m.get(5)).toEqual({ property_id: 540, method: 'name' })
  })

  it('lets two listings share one property through an alias (Antonio Michaelis / Cristina Turcan 8540)', () => {
    const props = [P(21, 'Antonio Michaelis 8540', '8540 towns end dr')]
    const m = matchListingsToProperties(
      [L(1, 'Antonio Michaelis 8540 (BC)', null), L(2, 'Cristina Turcan 8540 (BC)', null)],
      props,
      [{ property_id: 21, alias: 'Cristina Turcan 8540 (BC)' }],
    )
    expect(m.get(1)?.property_id).toBe(21)
    expect(m.get(2)?.property_id).toBe(21)
  })

  it('manual match always wins', () => {
    const props = [P(1, 'Real Name 5', '5 a st'), P(2, 'Other 7', '7 b st')]
    const m = matchListingsToProperties([L(9, 'Real Name 5', '5 a st', 2)], props)
    expect(m.get(9)).toEqual({ property_id: 2, method: 'manual' })
  })

  it('falls back to address only when exactly one live property has it', () => {
    const one = [P(10, 'Elevated Hosting 3008', '3008 cloudburst dr')]
    expect(matchListingsToProperties([L(1, 'Andrea Cobrin 3008 (SCounty)', '3008 cloudburst dr')], one).get(1)).toEqual({
      property_id: 10, method: 'address',
    })
    const two = [P(10, 'A 3008', '3008 cloudburst dr'), P(11, 'B 3008', '3008 cloudburst dr')]
    expect(matchListingsToProperties([L(1, 'C 3008', '3008 cloudburst dr')], two).size).toBe(0)
  })

  it('never address-matches a property another listing claimed by name', () => {
    const props = [P(31, 'Eric Fleming 1260', '1260 ski view dr')]
    const m = matchListingsToProperties(
      [L(1, 'Eric Fleming 1260-6203', '1260 ski view dr'), L(2, 'Tammy Navarre 1260-2106', '1260 ski view dr')],
      props,
    )
    expect(m.get(1)?.property_id).toBe(31)
    expect(m.has(2)).toBe(false)
  })

  it('ignores listings with no name and no address', () => {
    expect(matchListingsToProperties([L(1, null, null)], [P(1, 'X 1', '1 x st')]).size).toBe(0)
  })
})

describe('propertiesWithoutListing', () => {
  it('lists properties no listing matched', () => {
    const props = [P(1, 'A 1', null), P(2, 'B 2', null)]
    const m = matchListingsToProperties([L(1, 'A 1 (PF)', null)], props)
    expect(propertiesWithoutListing(props, m).map((p) => p.id)).toEqual([2])
  })
})
