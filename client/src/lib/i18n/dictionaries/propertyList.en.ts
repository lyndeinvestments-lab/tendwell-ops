/**
 * English strings for the property-list surface. Stub pre-registered by the i18n
 * infrastructure PR so the translation PR for this area only touches this
 * file pair (plus its page files) — never the shared registry.
 * Source of truth for keys; propertyList.es.ts is typed `typeof propertyListEn`.
 *
 * `stage_name` (pipeline stage) is a DB enum value — it stays canonical
 * English in filter logic/comparisons and is displayed via the shared
 * `common.stage.*` slug lookup (see `lib/issues.ts`'s `slugify` for the
 * pattern this page copies), not translated here.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const propertyListEn = {
  page: {
    title: 'Property List',
    subtitle: 'Operational properties - onboarding, active & offboarding',
    searchPlaceholder: 'Search properties…',
    emptyTitle: 'No properties found',
    emptyDescription: 'Try adjusting your search or filter criteria.',
  },
  tiles: {
    total: 'Total Properties',
    onboarding: 'Onboarding',
    active: 'Active',
    offboarding: 'Offboarding',
  },
  filters: {
    // "All Operational (46)"
    allOperational: 'All Operational ({{count}})',
    // "{{name}} (12)" — {{name}} is already the translated stage display name.
    stageOption: '{{name}} ({{count}})',
  },
  table: {
    beds: 'Beds',
    baths: 'Baths',
    guests: 'Guests',
    sqFt: 'Sq Ft',
    cleanerPay: 'Cleaner Pay',
    changeStageTooltip: 'Click to change stage',
    // CSV export column headers — deliberately fuller/spelled-out than the
    // compact table headers above (matches the pre-i18n export copy).
    csv: {
      property: 'Property',
      address: 'Address',
      bedrooms: 'Bedrooms',
      fullBaths: 'Full Baths',
      maxGuests: 'Max Guests',
      sqFt: 'Sq Ft',
      cleanerPay: 'Cleaner Pay',
      status: 'Status',
    },
  },
  toasts: {
    stageUpdated: 'Stage updated',
    updateFailed: 'Update failed',
  },
}
