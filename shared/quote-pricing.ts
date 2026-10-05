// Quote pricing suggestions shared by the Quote Sheet's Add Quote dialog and
// the MCP connector's crm_create_quote_property tool, so a quote created from
// Slack is priced the same way as one typed into the app. Dependency-free:
// imported by the client bundle and the serverless functions.

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

/** Client charge suggested per square foot (Add Quote dialog). */
export const CE_PER_SQFT = 0.14
/** Cleaner pay suggested as a share of the client charge. */
export const PAY_SHARE_OF_CE = 0.5
/** Cleaner pay above this share of the client charge trips the margin guard. */
export const MAX_PAY_SHARE = 0.55

const round2 = (n: number) => Math.round(n * 100) / 100

export interface QuotePricingInput {
  squareFootage?: number | null
  ceCharged?: number | null
  cleanerPay?: number | null
  bedrooms?: number | null
}

export interface QuotePricing {
  ceCharged: number | null
  cleanerPay: number | null
  ceSource: 'given' | 'sqft' | 'none'
  paySource: 'given' | 'ce_share' | 'none'
  /** Bedroom-based floor; null when the bedroom count has no reference figure. */
  cleanerMin: number | null
  belowCleanerMin: boolean
  /** Set when pay exceeds 55% of the charge: the charge that brings it back to 55%. */
  marginGuardCharge: number | null
}

/**
 * The Add Quote dialog's suggestions: client charge = sq ft × $0.14 when not
 * given, cleaner pay = 50% of the charge when not given. An explicit value
 * always wins. The two checks (bedroom minimum, 55% margin guard) are reported,
 * never applied — the dialog only warns, and so does this.
 */
export function suggestQuotePricing(input: QuotePricingInput): QuotePricing {
  const pos = (n: number | null | undefined) => (n != null && Number.isFinite(n) && n > 0 ? n : null)
  const givenCe = pos(input.ceCharged)
  const givenPay = pos(input.cleanerPay)
  const sqft = pos(input.squareFootage)

  const ceCharged = givenCe ?? (sqft != null ? round2(sqft * CE_PER_SQFT) : null)
  const ceSource: QuotePricing['ceSource'] = givenCe != null ? 'given' : ceCharged != null ? 'sqft' : 'none'

  const cleanerPay = givenPay ?? (ceCharged != null ? round2(ceCharged * PAY_SHARE_OF_CE) : null)
  const paySource: QuotePricing['paySource'] = givenPay != null ? 'given' : cleanerPay != null ? 'ce_share' : 'none'

  const cleanerMin = cleanerMinForBedrooms(input.bedrooms ?? null)
  const belowCleanerMin = cleanerMin != null && cleanerPay != null && cleanerPay < cleanerMin
  const marginGuardCharge =
    ceCharged != null && cleanerPay != null && cleanerPay / ceCharged > MAX_PAY_SHARE
      ? round2(cleanerPay / MAX_PAY_SHARE)
      : null

  return { ceCharged, cleanerPay, ceSource, paySource, cleanerMin, belowCleanerMin, marginGuardCharge }
}
