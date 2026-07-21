/**
 * English strings for the CommandPalette+CsvImportModal surface. Stub pre-registered by the
 * account/locale infrastructure PR so the translation PR for this area only
 * touches this file pair (plus its page files) — never the shared registry.
 * Source of truth for keys; palette.es.ts is typed `typeof paletteEn`.
 *
 * Three sub-areas share this one namespace: `palette` (CommandPalette.tsx),
 * `csv` (CsvImportModal.tsx), and `shortcuts` (KeyboardShortcuts.tsx — its
 * `SHORTCUT_SECTIONS` data array lives in `hooks/useKeyboardShortcuts.ts`,
 * outside this translation PR's file set, so the component looks up each
 * section/shortcut by a stable positional key defined locally in
 * `KeyboardShortcuts.tsx` rather than by editing the hook).
 *
 * CommandPalette page-entry names are NOT duplicated here — they reuse
 * `common.nav.<view-key>` (see `t('common.nav....', undefined, page.name)` in
 * the component) with the current English name as fallback. The one
 * exception is `palette.pages.liveProForma`, a command-palette-only deep
 * link into the Pro Forma page's Live tab that has no corresponding sidebar
 * nav entry of its own.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const paletteEn = {
  palette: {
    srSearchDescription: 'Search properties or navigate to a page',
    placeholder: 'Search properties or navigate to a page…',
    groups: {
      pages: 'Pages',
      recentlyViewed: 'Recently Viewed',
      properties: 'Properties',
      clients: 'Clients',
    },
    hints: {
      navigate: 'to navigate',
      select: 'to select',
      close: 'to close',
    },
    pages: {
      // Deep link straight into the Live tab — distinct from the "Pro Forma"
      // entry (common.nav['pro-forma']) even though both share a viewId.
      liveProForma: 'Live Pro Forma',
    },
  },
  csv: {
    title: 'Import Cleaning History',
    steps: {
      upload: 'Upload',
      mapColumns: 'Map Columns',
      matchProperties: 'Match Properties',
      summary: 'Summary',
    },
    upload: {
      dropHint: 'Drop a CSV file here or click to browse',
      requirements: 'Must include at least: property name, clean date',
    },
    mapping: {
      loadedRows: 'Loaded {{count}} rows from {{fileName}}. Map the columns below.',
      propertyName: 'Property Name *',
      cleanDate: 'Clean Date *',
      cleanerName: 'Cleaner Name',
      notMapped: '— not mapped —',
      previewTitle: 'Preview (first {{count}} rows)',
    },
    match: {
      matchedCount: '{{count}} matched',
      newCount: '{{count}} new propert(y/ies)',
      unmatchedCount: '{{count}} unmatched — assign, create new, or skip',
      errorsHeader: '{{count}} rows skipped due to unparseable dates:',
      moreErrors: '…and {{count}} more',
      recordsCount: '{{count}} records',
      newPropertyPlaceholder: 'Enter property name…',
      cancelNewTooltip: 'Cancel new property',
      skipOption: '— skip —',
      newPropertyOption: 'New Property',
    },
    summary: {
      willUpdatePrefix: 'This will update',
      existingNoun: 'existing propert(y/ies)',
      andCreatePrefix: 'and create',
      newNoun: 'new propert(y/ies)',
      skippedFragment: '({{count}} skipped)',
      dateRangeLabel: 'Clean date range:',
      dateRangeTo: 'to',
      cleansCount: '{{count}} cleans',
      perMonthSuffix: '/mo',
      firstLabel: 'first:',
      explanation: {
        prefix: 'For each property:',
        firstCleanDate: 'first clean date',
        cleansPerMonth: 'cleans/month',
        middle: '(exact from CSV), and',
        frequency: 'frequency',
        suffix: 'will be updated.',
        newPropertiesNote: 'New properties will be added as Active.',
      },
    },
    frequency: {
      weekly: 'weekly',
      biweekly: 'biweekly',
      monthly: 'monthly',
      custom: 'custom',
      as_needed: 'as needed',
    },
    done: {
      title: 'Import complete',
      createdOneMessage: '{{count}} new property was created:',
      createdManyMessage: '{{count}} new properties were created:',
      footnote: 'These properties have been added with the cleaning frequency inferred from your CSV. Open them from the Pipeline or Property List to fill in Client Charged, costs, client info, and other details.',
    },
    toast: {
      importedOf: 'Imported {{success}} of {{total}} properties',
      updatedNoun: '{{count}} propert(y/ies) updated',
      duplicatesSkipped: '{{count}} duplicate(s) skipped',
      newCleanRecords: '{{count}} new clean records',
    },
    errors: {
      notCsv: 'Please upload a .csv file.',
      parseFailedPrefix: 'Could not parse CSV: {{message}}',
      parseErrorPrefix: 'Parse error: {{message}}',
      missingMapping: 'Please map both Property Name and Clean Date columns.',
      unparsableDate: 'Row {{row}}: could not parse date "{{date}}"',
      noValidRecords: 'No valid records found. Check your column mapping.',
      missingNewNames: 'Please enter a name for {{count}} new propert(y/ies).',
      noMatchedOrNew: 'No matched or new properties to import. Please match at least one property.',
      createFailed: 'Failed to create "{{name}}": {{message}}',
      updateFailed: 'Update failed for {{name}}: {{message}}',
      unexpectedError: 'Unexpected error for {{name}}: {{message}}',
    },
    buttons: {
      nextMatch: 'Next: Match Properties',
      nextSummary: 'Next: Review Summary',
      importing: 'Importing…',
      importCount: 'Import {{count}} Propert(y/ies)',
      done: 'Done',
    },
  },
  shortcuts: {
    title: 'Keyboard Shortcuts',
    then: 'then',
    sections: {
      navigation: {
        title: 'Navigation (G + key)',
        items: {
          dashboard: 'Dashboard',
          pipeline: 'Pipeline',
          clients: 'Clients',
          quoteSheet: 'Quote Sheet',
          costTracking: 'Cost Tracking',
          propertyList: 'Property List',
          linenRequirements: 'Linen Requirements',
          acFilters: 'AC Filters',
          masterList: 'Master List',
          revenueReport: 'Revenue Report',
          inspections: 'Inspections',
          settings: 'Settings',
        },
      },
      actions: {
        title: 'Actions',
        items: {
          newItem: 'New item (context-dependent)',
          openShortcuts: 'Open keyboard shortcuts',
          closeModal: 'Close modal/dialog',
        },
      },
      global: {
        title: 'Global',
        items: {
          searchPalette: 'Search / Command Palette',
        },
      },
    },
  },
}
