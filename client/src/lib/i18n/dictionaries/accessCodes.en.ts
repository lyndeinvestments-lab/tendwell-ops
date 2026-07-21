/**
 * English strings for the access-codes surface. Stub pre-registered by the i18n
 * infrastructure PR so the translation PR for this area only touches this
 * file pair (plus its page files) — never the shared registry.
 * Source of truth for keys; accessCodes.es.ts is typed `typeof accessCodesEn`.
 *
 * `stage_name` (pipeline stage) is a DB enum value — it stays canonical
 * English in the database and is displayed via the shared `common.stage.*`
 * slug lookup (see `lib/issues.ts`'s `slugify` for the pattern this page
 * copies), not translated here.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const accessCodesEn = {
  page: {
    title: 'Access Codes',
    subtitle: 'Click any field to edit - use copy icon for clipboard',
    searchPlaceholder: 'Search…',
    clearSearch: 'Clear search',
    emptyTitle: 'No properties found',
    emptyDescription: 'No properties match your current filters.',
  },
  stats: {
    totalProperties: 'Total Properties',
    hasCode: 'Has Code',
    missingCode: 'Missing Code',
    autoCode: 'Auto-Code',
  },
  table: {
    stage: 'Stage',
    autoCode: 'Auto Code',
    doorCode: 'Door Code',
    otherCodes: 'Other Codes',
    wifiInfo: 'WiFi Info',
    lastUpdated: 'Last Updated',
    staleTooltip: 'Last updated over 90 days ago - codes may have changed',
  },
  badges: {
    missing: 'Missing',
    missingTooltip: 'No access codes set. Missing: {{fields}}',
    incomplete: 'Incomplete',
    incompleteTooltip: 'Missing: {{fields}}',
  },
  aria: {
    copied: 'Copied!',
    copyField: 'Copy {{field}} to clipboard',
    hideField: 'Hide {{field}}',
    revealField: 'Reveal {{field}}',
    copyAllCodes: 'Copy all codes for {{name}}',
  },
  // Short labels used in the "copy all codes" clipboard text blob
  // (e.g. "Property: X | Door: 1234 | WiFi: ..."), distinct from the
  // fuller table column headers above.
  copyAll: {
    propertyLabel: 'Property',
    autoLabel: 'Auto',
    doorLabel: 'Door',
    wifiLabel: 'WiFi',
    otherLabel: 'Other',
  },
  toasts: {
    saved: 'Saved',
    updateFailed: 'Update failed',
    csvExported: 'CSV exported',
    csvExportedDescription: '{{count}} rows exported',
  },
}
