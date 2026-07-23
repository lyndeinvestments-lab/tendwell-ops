/**
 * English strings for the contacts+ContactModal surface. Stub pre-registered by the
 * account/locale infrastructure PR so the translation PR for this area only
 * touches this file pair (plus its page files) — never the shared registry.
 * Source of truth for keys; contacts.es.ts is typed `typeof contactsEn`.
 *
 * `source`, `payment_method`, and `contact_interactions.interaction_type` are
 * DB enum-ish values — they stay canonical English in filter state, writes,
 * and CSV export, and are translated for display only via a slug lookup
 * (`slugify()` from `lib/issues.ts`) with the raw value as fallback. Payment
 * methods that are product names (Ramp, Bill.com, QuickBooks) keep their
 * English/brand spelling in the Spanish dictionary too — same pattern the
 * shared `common.stage.*` slug lookup uses for `pipeline_stages.name`.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const contactsEn = {
  // Owner-portal status shown on the Clients table (linked via property_owners.contact_id).
  portal: {
    active: 'Portal active',
    inactive: 'Portal inactive',
    create: 'Create portal',
  },
  page: {
    title: 'Clients',
    subtitle: 'Manage clients and relationships',
    searchPlaceholder: 'Search name, company, email…',
    allSources: 'All Sources',
    allPayments: 'All Payments',
    sourceReportButton: 'Source Report',
    sourceReportTooltip: 'View breakdown of how clients were sourced',
    findDuplicatesButton: 'Find Duplicates',
    addClientButton: 'Add Client',
    summaryTotalClients: 'Total Clients',
    summaryNew30: 'New (30d)',
    summaryUnassigned: 'Unassigned',
    summaryAvgProperties: 'Avg Properties',
    emptyTitle: 'No clients yet',
    emptyDescription: 'Add your first client to start tracking properties against contacts.',
    emptyFiltered: 'No clients match your filters',
    toastExported: 'Exported {{count}} contacts',
  },
  table: {
    company: 'Company',
    source: 'Source',
    payment: 'Payment',
    clientSince: 'Client Since',
    tags: 'Tags',
    portal: 'Portal',
    noneBadge: 'none',
    csv: {
      name: 'Name',
      company: 'Company',
      email: 'Email',
      phone: 'Phone',
      source: 'Source',
      paymentMethod: 'Payment Method',
      clientSince: 'Client Since',
      properties: 'Properties',
      tags: 'Tags',
    },
  },
  sourceReport: {
    dialogTitle: 'Contact Source Report',
    empty: 'No contacts to report on',
    chartLabel: 'Clients',
    colSource: 'Source',
    colTotal: 'Total',
    colWithProperties: 'With Properties',
    colConversion: 'Conversion',
  },
  duplicates: {
    dialogTitle: 'Duplicate Review',
    empty: 'No duplicates detected.',
    pairsFound: '{{count}} potential duplicate pair(s) found',
    reasonSimilarName: 'Similar name',
    reasonSameEmail: 'Same email',
    propertiesCount: '{{count}} properties',
    mergeButton: 'Merge → Keep {{name}}',
    toastEditAccessRequired: 'Edit access required',
    toastEditAccessDescription: "You don't have edit access to this page.",
    toastMerged: 'Clients merged successfully.',
    toastMergeFailed: 'Merge failed',
  },
  // Display labels for the `contacts.source` column, keyed by slug
  // (slugify('Cold Outreach') -> 'cold_outreach'). DB rows stay canonical
  // English; unknown values fall back to the raw value at the call site.
  source: {
    unknown: 'Unknown',
    referral: 'Referral',
    google: 'Google',
    cold_outreach: 'Cold Outreach',
    trade_show: 'Trade Show',
    social_media: 'Social Media',
    word_of_mouth: 'Word of Mouth',
    other: 'Other',
  },
  // Display labels for `contacts.payment_method`, keyed by slug. Product
  // names (Ramp, Bill.com, QuickBooks) are kept as-is.
  paymentMethod: {
    ramp: 'Ramp',
    bill_com: 'Bill.com',
    quickbooks: 'QuickBooks',
    check: 'Check',
    ach: 'ACH',
    other: 'Other',
  },
  // Display labels for `contact_interactions.interaction_type`, keyed by slug.
  interactionType: {
    call: 'Call',
    email: 'Email',
    meeting: 'Meeting',
    note: 'Note',
    text: 'Text',
  },
  modal: {
    newClientTitle: 'New Client',
    clientFallbackTitle: 'Client',
    updatedAgo: 'Updated {{time}}',
    tabDetails: 'Details',
    tabProperties: 'Properties',
    tabNotes: 'Notes',
    tabActivity: 'Activity',
    fieldFullName: 'Full Name *',
    fieldCompany: 'Company',
    fieldSecondaryPhone: 'Secondary Phone',
    fieldMailingAddress: 'Mailing Address',
    fieldSource: 'Source',
    fieldSourceNotes: 'Source Notes',
    fieldPaymentMethod: 'Payment Method',
    fieldPaymentNotes: 'Payment Notes',
    fieldClientSince: 'Client Since',
    fieldTags: 'Tags',
    placeholderClientName: 'Client name',
    placeholderCompanyName: 'Company name',
    placeholderEmail: 'email@example.com',
    placeholderPhone: '(555) 123-4567',
    placeholderSourceNotes: 'How they found us...',
    placeholderAddTag: 'Add tag...',
    placeholderInitialNotes: 'Initial notes (taggable once saved)...',
    selectPlaceholder: 'Select...',
    sendEmailTitle: 'Send email',
    saveClientButton: 'Save Client',
    deactivateButton: 'Deactivate',
    deactivateConfirm: 'Deactivate this client? They will be hidden from the active list.',
    assignPropertyPlaceholder: 'Assign an unassigned property…',
    noUnassignedProperties: 'No unassigned properties',
    assignButton: 'Assign',
    noLinkedProperties: 'No properties linked to this contact',
    interactionPlaceholder: 'What happened?',
    logButton: 'Log',
    noActivity: 'No activity logged yet',
    toastPropertyAssigned: 'Property assigned',
    toastAssignFailed: 'Assign failed',
    toastSaved: 'Saved',
    toastSaveFailed: 'Save failed',
    toastClientCreated: 'Client created',
    toastErrorPrefix: 'Error',
    toastCreateFailed: 'Failed to create client',
    toastInteractionLogged: 'Interaction logged',
    toastLogInteractionFailed: 'Failed to log interaction',
  },
  notes: {
    composerPlaceholder: 'Write a note… use @ to tag someone',
    postButton: 'Post',
    posting: 'Posting…',
    empty: 'No notes yet.',
    unknownAuthor: 'Unknown',
    toastPostFailed: 'Failed to post note',
  },
}
