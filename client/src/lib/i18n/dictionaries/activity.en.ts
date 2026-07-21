/**
 * English strings for the activity surface. Stub pre-registered by the
 * account/locale infrastructure PR so the translation PR for this area only
 * touches this file pair (plus its page files) — never the shared registry.
 * Source of truth for keys; activity.es.ts is typed `typeof activityEn`.
 *
 * DB entity types / field names / action verbs stay canonical English in
 * `entityTypeToFilter`/`fieldToFilter`/comparisons — the `field.*`/`action.*`
 * namespaces below are display-only slug lookups with a raw/humanized
 * fallback (mirrors `statusLabel`/`categoryLabel` in `lib/issues.ts`). Actual
 * stored `old_value`/`new_value`/`changed_by`/entity-name data is never
 * translated — it's the literal DB value, not UI copy.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const activityEn = {
  page: {
    title: 'Activity Feed',
    subtitle: 'Audit log of all changes across the app',
    today: 'Today',
    yesterday: 'Yesterday',
    entriesCount: '{{count}} entries',
    emptyTitle: 'No activity',
    emptyDescription: 'No changes match your current filters. Try widening the date range or clearing the search.',
    unknownEntity: 'Unknown',
  },
  filters: {
    searchPlaceholder: 'Search…',
    from: 'From',
    to: 'To',
    all: 'All',
    owners: 'Owner Portal',
    properties: 'Properties',
    pipeline: 'Pipeline',
    inspections: 'Inspections',
    cleaners: 'Cleaners',
    contacts: 'Clients',
  },
  table: {
    revert: 'Revert',
    revertTooltip: 'Revert to "{{value}}"',
  },
  // Display-only slug lookup for `activity_log.field_name` /
  // `property_edit_log.field_name` — falls back to a humanized version of the
  // raw field name if a key is missing (new columns don't need a PR here).
  field: {
    ce_charged: 'Client Charged',
    cleaner_pay: 'Cleaner Pay',
    sq_ft: 'Square Footage',
    square_footage: 'Square Footage',
    stage_id: 'Stage',
    stage: 'Stage',
    follow_up_date: 'Follow-up Date',
    contact_id: 'Client',
    bedrooms: 'Bedrooms',
    full_baths: 'Full Baths',
    half_baths: 'Half Baths',
    address: 'Address',
    notes: 'Notes',
    custom_cleans_per_month: 'Cleans/Month',
    total_estimated_cost: 'Total Estimated Cost',
    estimated_profit: 'Estimated Profit',
    profit_percentage: 'Profit %',
    exclude_from_financials: 'Exclude from Financials',
    offboarded_at: 'Offboarded Date',
    name: 'Property Name',
    auto_code: 'Auto Code',
    door_code: 'Door Code',
    wifi_info: 'WiFi Info',
  },
  // Display-only slug lookup for `activity_log.action` — falls back to a
  // humanized version of the raw action verb.
  action: {
    create: 'Create',
    update: 'Update',
    delete: 'Delete',
    stage_change: 'Stage change',
  },
  toasts: {
    reverted: 'Reverted {{field}} to "{{value}}"',
    revertFailed: 'Revert failed',
  },
}
