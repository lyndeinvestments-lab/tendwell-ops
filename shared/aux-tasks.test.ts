import { describe, expect, it } from 'vitest'
import {
  AUX_CATEGORIES,
  BILLABLE_AUX_CATEGORIES,
  DEFAULT_EXTRA_PRICING,
  auxCharge,
  classifyAuxTask,
  daysBetween,
  isBillableCategory,
  isTaskCompleted,
  matchObservationToTask,
  resolveAuxSettings,
  type AuxCategory,
} from './aux-tasks'

// The live vocabulary: every distinct title seen in breezeway_tasks and
// trellis_task_snapshot over the 90 days to 2026-09-22, with the category
// each must land in. A new title showing up in production that lands
// somewhere surprising is a test to add here, not a regex to tweak blind.
const VOCABULARY: Array<[string, AuxCategory]> = [
  // ── cleans (vendor invoice path) ──────────────────────────────────────
  ['Departure Clean', 'clean'],
  ['Turn Clean', 'clean'],
  ['Departure Clean - HT', 'clean'],
  ['Onboarding Clean', 'clean'],
  ['Same Day Turn / Arrival Clean', 'clean'],
  ['Last Clean & Linen Pull', 'clean'],
  ['Last Clean/Linen Pull', 'clean'],
  ['Deep Clean', 'clean'],
  ['Post-Owner Stay Clean - HT', 'clean'],
  ['HTLR Onboarding Clean', 'clean'],
  ['Double Clean', 'clean'],
  ['Turn Clean — Priya Dhawan 2534 - 2 (SCounty)', 'clean'],
  ['EARLY CHECK IN - Turn Clean', 'clean'],
  ['Onboarding', 'clean'],
  ['Onboarding Deep Clean', 'clean'],
  ['Departure clean - Rick Aquino Lodge D', 'clean'],
  ['Owner Stay - Turn Clean', 'clean'],
  ['URGENT Turn Clean', 'clean'],
  ['Pre-check-in cleaning', 'clean'],
  ['Onboarding Clean - Touch Up + Add our linens', 'clean'],
  // ── markers ───────────────────────────────────────────────────────────
  ['NO CLEAN NEEDED - Departure Clean', 'no_clean'],
  ["DO NOT CLEAN - Owner's Doing it.", 'no_clean'],
  ['DO NOT CLEAN - Maintenance', 'no_clean'],
  ['[TEST TECNICO - IGNORARE] PROD-8207 checklist sync 2026-07-23', 'no_clean'],
  // ── non-billable ──────────────────────────────────────────────────────
  ['Air Filter Change', 'air_filter'],
  ['Monthly Air Filter Change', 'air_filter'],
  ['Filter A/C', 'air_filter'],
  ['Ac filters  two 20x25', 'air_filter'],
  ['The A/C air filter needs to be changed.', 'air_filter'],
  ['Needs filter in downstairs stairwell', 'air_filter'],
  ['Needs a filter 20x20x1 upstairs', 'air_filter'],
  ['Remove dirty towels and clean upstairs window AC filter/vent', 'air_filter'],
  ['Vacancy Clean', 'vacancy_clean'],
  ['Urgent vacancy cleaning', 'vacancy_clean'],
  ['Cleaner Self-Inspection', 'self_inspection'],
  ['Pre-Owner Stay Walkthrough', 'owner_walkthrough'],
  ['Property Walkthrough', 'owner_walkthrough'],
  ['Cleaner Callback', 'callback'],
  ['Cleaner: Callback', 'callback'],
  ['Cleaner callback needed today - bathrooms, stained bedding...', 'callback'],
  ['Cleaning Inspection', 'inspection'],
  ['Touch Up Inspection', 'touch_up'], // a touch-up that was inspected is still touch-up work
  ['Urgent cleaner inspection', 'inspection'],
  // ── billable ──────────────────────────────────────────────────────────
  ['Cleaning: Hot Tub Refresh', 'hot_tub'],
  ['Hot Tub Refresh Needed - Guest Request', 'hot_tub'],
  ['Hot tub refresh needed - Tara Rao 116 (BC)', 'hot_tub'],
  ['Hot tub refresh — guest impact', 'hot_tub'],
  ['Hot Tub Refresh', 'hot_tub'],
  ['Urgent: Refill hot tub water', 'hot_tub'],
  ['Hot Tub Refresh — John Bryan 4144 (SCounty)', 'hot_tub'],
  ['Urgent: hot tub sediment removal', 'hot_tub'],
  ['Hot Tub Refresh — Guest Report', 'hot_tub'],
  ['Hot tub refresh requested by current guest', 'hot_tub'],
  ['Urgent: Fill hot tub and confirm 4 PM arrival readiness', 'hot_tub'],
  ['Cleaning: Hot Tub Refill', 'hot_tub'],
  ['Hot tub refresh — active guest issue', 'hot_tub'],
  ['Hot tub refresh — feathers reported', 'hot_tub'],
  ['Hot tub refresh needed', 'hot_tub'],
  ['Hot Tub Refresh — Rick Norris 1712 (SCounty)', 'hot_tub'],
  ['Mid-Stay Trash Pickup Request', 'trash'],
  ['Cleaning: Mid-Stay Trash Pick-Up', 'trash'],
  ['Cleaning: Trash Pickup', 'trash'],
  ['Mid-stay trash pickup', 'trash'],
  ['Subbed Out: Trash Pickup', 'trash'],
  ['Cleaner: Trash Pick-Up', 'trash'],
  ['Urgent: Clean scattered trash and assess damaged outdoor bin', 'trash'],
  ['Mid-stay trash pickup — Geri Giddens 437 (PF)', 'trash'],
  ['Remove trash for owner', 'trash'],
  ['Trash pickup', 'trash'],
  ['Linen Pull', 'linen_pull'],
  ['Grab Dirty Linens, No Cleaning', 'linen_pull'],
  ['Linen back request', 'linen_pull'],
  ['Needs 6 king pillows and two king Dubai', 'delivery'],
  ['Needs 3 king bed bug covers', 'delivery'],
  ['missing bed bug cover for queen bed', 'unclassified'], // a report, not a delivery task
  ['Need 4 pillow replacements for a king bed', 'delivery'],
  ['Urgent: deliver extra blankets for pull-out couch', 'delivery'],
  ['Drop off bromine tabs for hot tub', 'delivery'],
  ['Place delivered loveseat for guest seating', 'delivery'],
  ['Baterias pequeñas para control de arriba', 'delivery'],
  ['Guest touch-up clean and vacuum drop-off', 'delivery'], // drop-off verb wins; still billable
  ['Lockbox Key Check', 'lockbox'],
  ['Lock Batteries Critically Low', 'lockbox'],
  ['Touch Up Clean', 'touch_up'],
  ['Touch-Up Clean', 'touch_up'],
  ['Touch-up Clean & Vacuum property after flea treatment', 'touch_up'],
  ['Touch-up clean for guest-reported cleaning concerns', 'touch_up'],
  ['Touch-up clean before arrival — Taylor Mast 793 (GAT)', 'touch_up'],
  ['Add Linens and Touch Up', 'touch_up'],
  ['Subbed Out: Smoke Odor', 'extra_cleaning'],
  ['Inspect cigarette-smoke odor and deodorize main level', 'extra_cleaning'],
  ['Urgent guest cleaning: lower floor mold, spiders & cobwebs', 'extra_cleaning'],
  ['Clean Balconies', 'extra_cleaning'],
  ['Subbed Out: Washer Cleaning', 'extra_cleaning'],
  ['Cleaning: Lower-Level Floors', 'extra_cleaning'],
  ['Cleaner: Black Growth', 'unclassified'],
  // ── unclassified (never auto-billed) ──────────────────────────────────
  ['Bathroom', 'unclassified'],
  ['Kitchen', 'unclassified'],
  ['Room', 'unclassified'],
  ['Beds', 'unclassified'],
  ['TV', 'unclassified'],
  ['Pillow Stain', 'unclassified'],
  ['The shower curtain is missing', 'unclassified'],
  ['Need 3 plastic shower curtain', 'delivery'],
  ['Broken a small trash can', 'unclassified'],
  ['Upstairs bathroom is leaking', 'unclassified'],
  ['Install toilet paper holder — upstairs bathroom', 'unclassified'],
  ["The bathroom light bulb isn't working.", 'unclassified'],
  ['Reminder: confirm early check-in readiness for Sam Assini', 'unclassified'],
]

describe('classifyAuxTask — the live vocabulary', () => {
  it.each(VOCABULARY)('%s → %s', (title, expected) => {
    expect(classifyAuxTask(title)).toBe(expected)
  })

  it('treats blank as unclassified', () => {
    expect(classifyAuxTask(null)).toBe('unclassified')
    expect(classifyAuxTask('   ')).toBe('unclassified')
  })

  it('never classifies a clean as billable auxiliary work', () => {
    for (const [title, cat] of VOCABULARY) {
      if (cat === 'clean') expect(BILLABLE_AUX_CATEGORIES).not.toContain(classifyAuxTask(title))
    }
  })
})

describe('billability & pricing settings', () => {
  it('defaults: the eight billable categories bill, the rest do not', () => {
    const s = resolveAuxSettings()
    const billable = (Object.keys(AUX_CATEGORIES) as AuxCategory[]).filter(c => isBillableCategory(c, s))
    expect(billable.sort()).toEqual(
      ['delivery', 'extra_cleaning', 'hot_tub', 'linen_pull', 'lockbox', 'pet', 'touch_up', 'trash'],
    )
  })

  it('default prices mirror the engine standard pricing and leave Trip Fee / Extra Cleaning unpriced', () => {
    const s = resolveAuxSettings()
    expect(auxCharge('Hot Tub Refresh Requested by Guest', s)).toBe(50)
    expect(auxCharge('Excessive Trash Pickup', s)).toBe(50)
    expect(auxCharge('Vacancy Clean / Touch Up Clean', s)).toBe(55)
    expect(auxCharge('Trip Fee', s)).toBeNull()
    expect(auxCharge('Extra Cleaning', s)).toBeNull()
    expect(Object.keys(DEFAULT_EXTRA_PRICING)).toHaveLength(6)
  })

  it('stored JSON overrides win, malformed values are ignored, null clears a default', () => {
    const s = resolveAuxSettings({
      pricing: JSON.stringify({ 'Trip Fee': 35, 'Hot Tub Refresh Requested by Guest': '60', 'Pet Fee': null, 'Linen Pull': 'lots' }),
      billable: JSON.stringify({ vacancy_clean: true, hot_tub: false, bogus: true, trash: 'yes' }),
    })
    expect(auxCharge('Trip Fee', s)).toBe(35)
    expect(auxCharge('Hot Tub Refresh Requested by Guest', s)).toBe(60)
    expect(auxCharge('Pet Fee', s)).toBeNull()
    expect(auxCharge('Linen Pull', s)).toBe(50)
    expect(isBillableCategory('vacancy_clean', s)).toBe(false) // no service type → can never bill
    expect(isBillableCategory('hot_tub', s)).toBe(false)
    expect(isBillableCategory('trash', s)).toBe(true)
  })

  it('survives garbage settings', () => {
    const s = resolveAuxSettings({ pricing: '{not json', billable: 42 })
    expect(auxCharge('Linen Pull', s)).toBe(50)
    expect(isBillableCategory('hot_tub', s)).toBe(true)
  })
})

describe('isTaskCompleted', () => {
  it('Breezeway: Closed/Finished or a completed date; Created/Overdue are open', () => {
    expect(isTaskCompleted('breezeway', 'Closed', null)).toBe(true)
    expect(isTaskCompleted('breezeway', 'Finished', null)).toBe(true)
    expect(isTaskCompleted('breezeway', 'Created', '2026-09-01')).toBe(true)
    expect(isTaskCompleted('breezeway', 'Created', null)).toBe(false)
    expect(isTaskCompleted('breezeway', 'Overdue', null)).toBe(false)
    expect(isTaskCompleted('breezeway', 'In Progress', null)).toBe(false)
  })
  it('Trellis: COMPLETED only', () => {
    expect(isTaskCompleted('trellis', 'COMPLETED', null)).toBe(true)
    expect(isTaskCompleted('trellis', 'SCHEDULED', null)).toBe(false)
    expect(isTaskCompleted('trellis', 'PAUSED', null)).toBe(false)
    expect(isTaskCompleted('trellis', 'CANCELLED', null)).toBe(false)
    expect(isTaskCompleted('trellis', 'IN_PROGRESS', '2026-09-01T10:00:00Z')).toBe(true)
  })
})

describe('matchObservationToTask', () => {
  const tasks = [
    { externalId: 'bw1', propertyId: 7, date: '2026-09-19', category: 'hot_tub' as const },
    { externalId: 'bw2', propertyId: 7, date: '2026-09-20', category: 'hot_tub' as const },
    { externalId: 'bw3', propertyId: 7, date: '2026-09-20', category: 'trash' as const },
    { externalId: 'bw4', propertyId: 9, date: '2026-09-20', category: 'hot_tub' as const },
    { externalId: 'bw5', propertyId: 7, date: '2026-09-20', category: 'self_inspection' as const },
  ]
  it('prefers the same-day task of the same category on the same property', () => {
    expect(matchObservationToTask({ propertyId: 7, date: '2026-09-20', category: 'hot_tub' }, tasks)?.externalId).toBe('bw2')
  })
  it('accepts an adjacent day', () => {
    expect(matchObservationToTask({ propertyId: 7, date: '2026-09-18', category: 'hot_tub' }, tasks)?.externalId).toBe('bw1')
    expect(matchObservationToTask({ propertyId: 7, date: '2026-09-17', category: 'hot_tub' }, tasks)).toBeNull()
  })
  it('an unknown category matches any billable auxiliary task, never a self-inspection', () => {
    const m = matchObservationToTask({ propertyId: 7, date: '2026-09-20', category: 'unclassified' }, tasks)
    expect(['bw2', 'bw3']).toContain(m?.externalId)
    expect(matchObservationToTask({ propertyId: 11, date: '2026-09-20', category: 'unclassified' }, tasks)).toBeNull()
  })
  it('no property → no match', () => {
    expect(matchObservationToTask({ propertyId: null, date: '2026-09-20', category: 'hot_tub' }, tasks)).toBeNull()
  })
  it('daysBetween is symmetric and whole-day', () => {
    expect(daysBetween('2026-09-20', '2026-09-18')).toBe(2)
    expect(daysBetween('2026-09-18', '2026-09-20')).toBe(2)
    expect(daysBetween('2026-10-01', '2026-09-30')).toBe(1)
  })
})
