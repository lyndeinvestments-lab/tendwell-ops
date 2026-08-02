/**
 * English strings for the ac-filters surface. Stub pre-registered by the i18n
 * infrastructure PR so the translation PR for this area only touches this
 * file pair (plus its page files) — never the shared registry.
 * Source of truth for keys; acFilters.es.ts is typed `typeof acFiltersEn`.
 *
 * `STATUS_OPTIONS` (stage_name filter values) and `getDueStatus()` labels
 * stay canonical English in `ac-filters.tsx` — the `status.*` namespace here
 * is a display-only lookup keyed by slug (`slugify('Due soon') → 'due_soon'`),
 * with the raw value as fallback. Stage names reuse the shared
 * `common.stage.*` keys instead of duplicating them here.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const acFiltersEn = {
  page: {
    title: 'AC Filters',
    subtitle: 'Track filter sizes and change schedules - click cells to edit',
    allStatuses: 'All Statuses',
    searchPlaceholder: 'Search…',
    bulkEdit: 'Bulk Edit',
    exitBulk: 'Exit Bulk',
    importCsv: 'Import CSV',
  },
  tiles: {
    totalTracked: 'Total Tracked',
    overdue: 'Overdue',
    dueSoon: 'Due Soon (14d)',
    missingFilterSize: 'Missing Filter Size',
  },
  bulk: {
    selected: '{{count}} selected',
    filterSizePlaceholder: 'Filter size…',
    setSize: 'Set Size',
    markChangedToday: 'Mark Changed Today',
  },
  table: {
    filterSize: 'Filter Size',
    lastChanged: 'Last Changed',
    nextDue: 'Next Due',
    due: 'Due',
    addSizePlaceholder: 'Add size…',
    addNotesPlaceholder: 'Add notes…',
    todayButton: 'Today',
    savingButton: 'Saving…',
    markChangedTooltip: 'Mark filter changed today and set next due date',
    emptyTitle: 'No properties found',
    emptyDescription: 'No properties match your current filters.',
    overdueBadge: 'OVERDUE',
  },
  // Display names for `getDueStatus()` labels, keyed by slug. DB/logic stays
  // canonical English ('Overdue' / 'Due soon' / 'OK'); unknown values fall
  // back to the raw label at the call site.
  status: {
    overdue: 'Overdue',
    due_soon: 'Due soon',
    ok: 'OK',
  },
  toasts: {
    editAccessRequired: 'Edit access required',
    saved: 'Saved',
    updateFailed: 'Update failed',
    filterMarkedChanged: 'Filter marked as changed today',
    nextDueDescription: 'Next due: {{date}}',
    bulkUpdateFailed: 'Bulk update failed',
    filterSizeUpdated: 'Updated filter size for {{count}} properties',
    bulkMarkedChanged: 'Marked {{count}} filters as changed today',
    csvParseFailed: 'Failed to parse CSV',
    csvImported: 'Imported {{updated}} of {{total}} rows',
  },
  csvDialog: {
    title: 'Import AC Filter Data',
    foundRows: 'Found {{count}} rows. Columns: Property, Filter Size, Last Changed',
    matchingNote: 'Matching is by exact property name. Unmatched rows will be skipped.',
    moreRows: '…and {{count}} more',
    importRows: 'Import {{count}} Rows',
  },
}
