// Cleaner minimum pay by bedroom count. Reference figures only — surfaced
// next to Cleaner Pay in the property modal and the quote sheet so editors can
// sanity-check pay against the floor for that property size. Intentionally NOT
// wired into any cost/profit formula (display-only).
export const CLEANER_MIN_BY_BEDROOMS: Record<number, number> = {
  1: 80,
  2: 100,
  3: 130,
  4: 160,
  5: 200,
  6: 240,
}

export function cleanerMinForBedrooms(bedrooms: number | null | undefined): number | null {
  if (bedrooms == null || Number.isNaN(bedrooms)) return null
  return CLEANER_MIN_BY_BEDROOMS[bedrooms] ?? null
}
