/**
 * English strings for the linen-tracker+linen-inventory surface. Stub pre-registered by the i18n
 * infrastructure PR so the translation PR for this area only touches this
 * file pair (plus its page files) — never the shared registry.
 * Source of truth for keys; linens.es.ts is typed `typeof linensEn`.
 *
 * `items` / `itemDescriptions` are keyed by the raw DB/column key (snake_case,
 * matching `LINEN_COLS`/`STANDARD_ITEMS`/etc. in the page files) rather than
 * camelCase — same convention as `common.stage` (slug-keyed display names) —
 * so page code can do `t(\`items.${item.key}\`, undefined, item.label)`.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const linensEn = {
  // Shared item/column display names, reused by both linen-tracker (bed
  // counts + towel pars) and linen-inventory (on-hand counts). Fallback at
  // every call site is the original English label, so a missing key here
  // never blanks the UI.
  items: {
    guest_count: 'Guests',
    king_beds: 'King',
    queen_beds: 'Queen',
    full_beds: 'Full',
    twin_beds: 'Twin',
    bath_towels: 'Bath Towels',
    washcloths: 'Washcloths',
    hand_towels: 'Hand Towels',
    bathmats: 'Bathmats',
    pool_towels: 'Pool Towels',
    linen_notes: 'Notes',
    king_rolls: 'King Rolls',
    queen_rolls: 'Queen Rolls',
    full_rolls: 'Full Rolls',
    twin_rolls: 'Twin Rolls',
    king_top_sheets: 'King Top Sheets',
    queen_top_sheets: 'Queen Top Sheets',
    full_top_sheets: 'Full Top Sheets',
    twin_top_sheets: 'Twin Top Sheets',
    kitchen_towels: 'Kitchen Towels',
    king_encasements: 'King Encasements',
    queen_encasements: 'Queen Encasements',
    full_encasements: 'Full Encasements',
    twin_encasements: 'Twin Encasements',
    king_pillows: 'King Pillows',
    standard_pillows: 'Standard Pillows',
    king_fitted_extras: 'King Fitted (extras)',
    king_flat_extras: 'King Flat (extras)',
    king_pillowcase_extras: 'King Pillowcases (extras)',
    queen_fitted_extras: 'Queen Fitted (extras)',
    queen_flat_extras: 'Queen Flat (extras)',
    queen_pillowcase_extras: 'Queen Pillowcases (extras)',
    full_fitted_extras: 'Full Fitted (extras)',
    full_flat_extras: 'Full Flat (extras)',
    full_pillowcase_extras: 'Full Pillowcases (extras)',
    twin_fitted_extras: 'Twin Fitted (extras)',
    twin_flat_extras: 'Twin Flat (extras)',
    twin_pillowcase_extras: 'Twin Pillowcases (extras)',
  },
  itemDescriptions: {
    king_rolls: '1 fitted + 1 flat + 4 pillowcases',
    queen_rolls: '1 fitted + 1 flat + 4 pillowcases',
    full_rolls: '1 fitted + 1 flat + 4 pillowcases',
    twin_rolls: '1 fitted + 1 flat + 2 pillowcases',
    kitchen_towels: '3 per kitchen',
  },
  // Short bed-size abbreviations used in the count-history table (narrow
  // columns) — same words as `items.king_beds` etc., kept separate since the
  // history table strips the "Rolls"/"Top Sheets" suffix off item labels.
  historyAbbrev: {
    king: 'King',
    queen: 'Queen',
    full: 'Full',
    twin: 'Twin',
    bath: 'Bath',
    wash: 'Wash',
    hand: 'Hand',
  },
  tracker: {
    page: {
      title: 'Linen Requirements',
      subtitle: 'Active & onboarding properties - required quantities for one full set',
    },
    filters: {
      searchPlaceholder: 'Search…',
    },
    legend: {
      emptyFieldsHint: 'Empty fields (red = needs data)',
    },
    summary: {
      totalProperties: 'Total Properties',
      setupComplete: 'Setup Complete',
      needsSetup: 'Needs Setup',
    },
    badges: {
      incompleteCount: '{{count}} incomplete',
    },
    actions: {
      autoFillEmptyRows: 'Auto-fill empty rows',
      // REVIEW: "par levels" per house style = "Niveles Par"
      autoFillTooltip: 'Compute towel/mat par levels from bed counts for every row with beds entered but no towel data. Never touches rows that already have any towel values.',
      importCsv: 'Import CSV',
    },
    table: {
      property: 'Property',
      companyTotals: 'Company Totals ({{count}})',
    },
    empty: {
      allCompleteTitle: 'All data complete',
      allCompleteDescription: 'All properties have linen data filled in.',
      noPropertiesTitle: 'No properties',
      noPropertiesDescription: 'No properties found matching your search.',
    },
    row: {
      noDataHint: 'No linen data - all fields are zero',
      autoFillAriaLabel: 'Auto-fill empty towel fields from beds',
      // REVIEW: "sleep count" = guest-capacity derived from bed counts
      autoFillTooltip: 'Auto-fill empty towel fields from guest count ({{count}}). Falls back to bed math if guest count is blank. Manual values are kept.',
      copyAriaLabel: 'Copy linen data from another property',
    },
    copyDialog: {
      title: 'Copy linen data to {{name}}',
      prompt: 'Select a property to copy linen counts from:',
      // REVIEW: "BR" (bedrooms) abbreviation kept as-is
      propertyMeta: '{{bedrooms}}BR - {{matched}}/{{total}} fields',
    },
    importDialog: {
      title: 'Import Linen Data - Preview',
      matchSummary: '{{matched}} of {{total}} rows matched to existing properties. Unmatched rows will be skipped.',
      csvName: 'CSV Name',
      matchedTo: 'Matched To',
      fields: 'Fields',
      status: 'Status',
      ready: 'Ready',
      noMatch: 'No match',
      valuesCount: '{{count}} values',
      importButton: 'Import {{count}} Properties',
      importing: 'Importing…',
    },
    toasts: {
      saved: 'Saved',
      updateFailed: 'Update failed',
      nothingToFill: 'Nothing to fill - all towel fields already set',
      // REVIEW: "sleep count" = guest-capacity derived from bed counts
      autoFilledFields: 'Auto-filled {{count}} field(s) (sleep count {{sleep}})',
      autoFillFailed: 'Auto-fill failed',
      editAccessRequired: 'Edit access required',
      editAccessRequiredDescription: "You don't have edit access to this page.",
      noRowsToFill: 'No rows to fill',
      noRowsToFillDescription: 'Every row either has no guest count / beds yet or already has towel data.',
      bulkAutoFilled: 'Auto-filled {{ok}} of {{total}} rows',
      csvExported: 'CSV exported',
      csvExportedDescription: '{{count}} rows exported',
      csvNoData: 'No data found in CSV',
      csvMissingPropertyColumn: 'CSV must have a "Property" or "Name" column',
      csvNoImportable: 'No importable data found',
      csvParseFailed: 'Failed to parse CSV',
      importComplete: 'Import complete',
      importCompleteDescription: '{{updated}} updated, {{skipped}} skipped',
      copyFailed: 'Copy failed',
      copyDataSuccess: 'Linen data copied',
      copyDataSuccessDescription: 'Copied from {{from}} to {{to}}',
    },
  },
  inventory: {
    page: {
      title: 'Linen Inventory',
      subtitle: 'Company-wide linen counts vs. total requirements',
      lastCounted: '· Last counted {{date}}',
    },
    tabs: {
      snapshot: 'Current Status',
      record: 'Record Count',
      history: 'Count History',
    },
    empty: {
      noCountsTitle: 'No on-hand counts yet',
      noCountsDescription: 'Record your first inventory count to see variance vs the company-wide requirement on this page. Until then, the "On Hand" and "Variance" columns will show',
    },
    stats: {
      totalRequired: 'Total Required',
      totalOnHand: 'Total On Hand',
      overallVariance: 'Overall Variance',
      shortages: 'Shortages',
    },
    table: {
      item: 'Item',
      required: 'Required',
      onHand: 'On Hand',
      variance: 'Variance',
      encasementsPillows: 'Encasements & Pillows',
      individualExtras: 'Individual Extras',
    },
    noCount: {
      message: 'No inventory count recorded yet.',
      recordFirstCount: 'Record First Count',
    },
    labels: {
      countedBy: 'Counted By',
    },
    record: {
      viewOnlyTitle: 'View Only',
      viewOnlyDescription: "You don't have edit access to record counts.",
      enterQuantities: 'Enter current quantities on hand',
      prefill: 'Prefill from last count',
      sectionRolls: 'Rolls',
      sectionTopSheets: 'Top Sheets',
      sectionTowels: 'Towels',
      sectionEncasements: 'Mattress Encasements',
      sectionPillows: 'Pillows',
      needLabel: 'Need: {{count}}',
      hideExtras: 'Hide',
      showExtras: 'Show',
      extrasToggleSuffix: 'individual extras (fitted, flat, pillowcases)',
      notesPlaceholder: 'Optional…',
      save: 'Save Inventory Count',
    },
    history: {
      date: 'Date',
      clickHint: 'Click to see every field',
      emptyTitle: 'No count history',
      emptyDescription: 'Record your first inventory count to start tracking.',
    },
    detail: {
      title: 'Count detail - {{date}}',
      countedByPrefix: 'Counted by {{name}}',
      groupSheetsTowelsKitchen: 'Sheets, Towels & Kitchen',
      groupOnHand: 'On Hand - Encasements & Pillows',
      groupExtras: 'Extras',
    },
    csv: {
      countedAt: 'Counted At',
    },
    toasts: {
      countSaved: 'Inventory count saved',
      saveFailed: 'Save failed',
      prefilled: 'Prefilled from last count',
    },
  },
}
