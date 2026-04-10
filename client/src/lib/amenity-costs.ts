// Amenity cost calculation — matches the Google Sheet formula
// All unit costs are read from app_settings via useAppSettings()
//
// Formula:
//   (fullBaths + halfBaths) × (bathroom_amenities + toilet_paper)
//   + kitchens × kitchen_supplies
//   + number_of_beds × trash_bag
//   + (hasHotTub ? 1 : 0) × hot_tub_chemicals

export interface AmenityCosts {
  bathroom: number    // per bathroom: amenities (shampoo, conditioner, body wash, bar, liners)
  toiletPaper: number // per bathroom: 2 rolls
  kitchen: number     // per kitchen: dish soap, gel pod, tab, paper towel, liners
  trashBag: number    // per bed: one 56-gallon bag
  hotTub: number      // per property with hot tub: bromine + floater
}

export const DEFAULT_AMENITY_COSTS: AmenityCosts = {
  bathroom: 1.05,
  toiletPaper: 0.78,
  kitchen: 2.05,
  trashBag: 0.06,
  hotTub: 0.88,
}

// Setting keys in app_settings
export const AMENITY_SETTINGS_KEYS = {
  bathroom: 'amenity_bathroom',
  toiletPaper: 'amenity_toilet_paper',
  kitchen: 'amenity_kitchen',
  trashBag: 'amenity_trash_bag',
  hotTub: 'amenity_hot_tub',
} as const

export function calcConsumables(
  costs: AmenityCosts,
  property: {
    full_baths?: number | null
    half_baths?: number | null
    kitchens?: number | null
    number_of_beds?: number | null
    hot_tub?: boolean | null
  }
): number {
  const fullBaths = property.full_baths ?? 0
  const halfBaths = property.half_baths ?? 0
  const kitchens = property.kitchens ?? 1
  const beds = property.number_of_beds ?? 0
  const hasHotTub = property.hot_tub ? 1 : 0

  return (
    (fullBaths + halfBaths) * (costs.bathroom + costs.toiletPaper)
    + kitchens * costs.kitchen
    + beds * costs.trashBag
    + hasHotTub * costs.hotTub
  )
}
