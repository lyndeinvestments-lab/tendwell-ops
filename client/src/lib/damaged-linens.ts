// Damaged Linen Tracker — shared vocabulary + pure summary math.
//
// DB values (item_type / damage_type / status) are canonical English slugs
// stored in `damaged_linens`; display names come from the `linens.damaged.*`
// i18n keys with the English label here as the fallback.

export const DAMAGED_ITEM_GROUPS = [
  {
    key: 'bedding',
    label: 'Bedding',
    items: [
      { key: 'king_fitted', label: 'King Fitted Sheet' },
      { key: 'king_flat', label: 'King Flat Sheet' },
      { key: 'king_pillowcase', label: 'King Pillowcase' },
      { key: 'queen_fitted', label: 'Queen Fitted Sheet' },
      { key: 'queen_flat', label: 'Queen Flat Sheet' },
      { key: 'queen_pillowcase', label: 'Queen Pillowcase' },
      { key: 'full_fitted', label: 'Full Fitted Sheet' },
      { key: 'full_flat', label: 'Full Flat Sheet' },
      { key: 'full_pillowcase', label: 'Full Pillowcase' },
      { key: 'twin_fitted', label: 'Twin Fitted Sheet' },
      { key: 'twin_flat', label: 'Twin Flat Sheet' },
      { key: 'twin_pillowcase', label: 'Twin Pillowcase' },
      { key: 'duvet_cover', label: 'Duvet Cover' },
      { key: 'comforter', label: 'Comforter / Duvet Insert' },
      { key: 'mattress_encasement', label: 'Mattress Encasement' },
      { key: 'pillow', label: 'Pillow' },
    ],
  },
  {
    key: 'towels',
    label: 'Towels',
    items: [
      { key: 'bath_towel', label: 'Bath Towel' },
      { key: 'hand_towel', label: 'Hand Towel' },
      { key: 'washcloth', label: 'Washcloth' },
      { key: 'bathmat', label: 'Bathmat' },
      { key: 'pool_towel', label: 'Pool Towel' },
      { key: 'kitchen_towel', label: 'Kitchen Towel' },
    ],
  },
  {
    key: 'other',
    label: 'Other',
    items: [{ key: 'other', label: 'Other' }],
  },
] as const

export const DAMAGED_ITEMS: ReadonlyArray<{ key: string; label: string }> =
  DAMAGED_ITEM_GROUPS.flatMap(g => [...g.items] as Array<{ key: string; label: string }>)
const ITEM_LABELS = new Map<string, string>(DAMAGED_ITEMS.map(i => [i.key, i.label]))
export function itemFallbackLabel(key: string): string {
  return ITEM_LABELS.get(key) ?? key
}

export const DAMAGE_TYPES = ['stain', 'tear', 'burn', 'discoloration', 'worn', 'other'] as const
export type DamageType = typeof DAMAGE_TYPES[number]
export const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  stain: 'Stain',
  tear: 'Tear / Hole',
  burn: 'Burn',
  discoloration: 'Discoloration / Bleach',
  worn: 'Worn / Frayed',
  other: 'Other',
}

// reported → treating → restored (back in service) | discarded (written off)
export const DAMAGED_STATUSES = ['reported', 'treating', 'restored', 'discarded'] as const
export type DamagedStatus = typeof DAMAGED_STATUSES[number]
export const DAMAGED_STATUS_LABELS: Record<DamagedStatus, string> = {
  reported: 'Reported',
  treating: 'Treating',
  restored: 'Restored',
  discarded: 'Discarded',
}
export const DAMAGED_STATUS_TONES = {
  reported: 'warning',
  treating: 'info',
  restored: 'success',
  discarded: 'destructive',
} as const

export function isOpenStatus(s: string): boolean {
  return s === 'reported' || s === 'treating'
}

export interface DamagedLinen {
  id: string
  property_id: number | null
  item_type: string
  quantity: number
  damage_type: DamageType
  status: DamagedStatus
  found_date: string
  found_by: string | null
  cleaner_id: string | null
  estimated_cost: number | null
  charge_back: boolean
  notes: string | null
  photo_urls: string[]
  resolved_at: string | null
  resolved_by: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  property?: { id: number; name: string } | null
}

export interface DamagedSummary {
  openUnits: number
  openReports: number
  discardedUnits: number
  restoredUnits: number
  /** Share of resolved units that went back into service (0–1), null when nothing resolved. */
  restoreRate: number | null
  estimatedLoss: number
  chargeBackOpen: number
  topProperties: Array<{ propertyId: number | null; name: string; units: number; reports: number }>
  topItems: Array<{ itemType: string; units: number }>
}

/** Rolls a (pre-filtered) set of reports into the page's KPI + hot-spot numbers.
 *  Counts units (quantity), not rows — one report of 6 stained towels is 6. */
export function summarizeDamaged(rows: DamagedLinen[], topN = 5): DamagedSummary {
  let openUnits = 0
  let openReports = 0
  let discardedUnits = 0
  let restoredUnits = 0
  let estimatedLoss = 0
  let chargeBackOpen = 0
  const byProperty = new Map<string, { propertyId: number | null; name: string; units: number; reports: number }>()
  const byItem = new Map<string, number>()

  for (const r of rows) {
    const qty = Math.max(1, Number(r.quantity) || 1)
    if (isOpenStatus(r.status)) {
      openUnits += qty
      openReports += 1
      if (r.charge_back) chargeBackOpen += 1
    }
    if (r.status === 'discarded') {
      discardedUnits += qty
      estimatedLoss += Number(r.estimated_cost) || 0
    }
    if (r.status === 'restored') restoredUnits += qty

    const pKey = r.property_id == null ? 'none' : String(r.property_id)
    const p = byProperty.get(pKey) ?? {
      propertyId: r.property_id,
      name: r.property?.name ?? '',
      units: 0,
      reports: 0,
    }
    p.units += qty
    p.reports += 1
    byProperty.set(pKey, p)
    byItem.set(r.item_type, (byItem.get(r.item_type) ?? 0) + qty)
  }

  const resolved = discardedUnits + restoredUnits
  return {
    openUnits,
    openReports,
    discardedUnits,
    restoredUnits,
    restoreRate: resolved > 0 ? restoredUnits / resolved : null,
    estimatedLoss: Math.round(estimatedLoss * 100) / 100,
    chargeBackOpen,
    topProperties: Array.from(byProperty.values())
      .sort((a, b) => b.units - a.units || b.reports - a.reports || a.name.localeCompare(b.name))
      .slice(0, topN),
    topItems: Array.from(byItem.entries())
      .map(([itemType, units]) => ({ itemType, units }))
      .sort((a, b) => b.units - a.units || a.itemType.localeCompare(b.itemType))
      .slice(0, topN),
  }
}
