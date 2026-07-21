/**
 * English strings for the pipeline surface (the /pipeline Kanban board:
 * page header, stage columns, draggable cards, and the Add Lead dialog).
 * Source of truth for keys; pipeline.es.ts is typed `typeof pipelineEn`.
 *
 * DB/enum values (pipeline_stages.name, payment_method) stay canonical
 * English in logic/writes/comparisons — stage names are display-only slug
 * lookups against `common.stage.*` (falls back to the raw value). The
 * property detail slide-over (financials, onboarding checklist, Move Stage)
 * lives in the shared `PropertyDetailModal` / `StageTransitionModal`
 * components, which belong to the `propertyModal` namespace (a later wave)
 * — not translated here.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const pipelineEn = {
  page: {
    title: 'Pipeline',
    subtitle: 'Drag properties between stages',
    profitLegend: 'profit legend',
    searchPlaceholder: 'Search properties...',
    clearSearch: 'Clear search',
    addLead: 'Add Lead',
    compact: 'Compact',
    compactTooltip: 'Show cards with less detail',
    hideEmpty: 'Hide empty',
    scrollToTop: 'Scroll to top',
  },
  board: {
    expandColumn: 'Expand {{stage}} column',
    collapseColumn: 'Collapse {{stage}} column',
    propertiesCount: '{{count}} properties',
    mobileStageOption: '{{stage}} ({{count}})',
  },
  card: {
    stale: 'Stale',
    inStageSince: 'In {{stage}} since {{date}}',
    followUp: 'Follow-up:',
    followUpAria: 'Follow-up date for {{name}}',
    addFollowUp: 'Add follow-up',
    payment: 'Payment: {{method}}',
    clientSince: 'Client since {{date}}',
    cleanerPay: '{{amount}} pay',
    onboardingTasks: '{{completed}} of {{total}} tasks',
    setupChecklist: 'Setup checklist →',
    stageHistory: 'Stage History',
    noData: 'No data',
    profitTier: {
      high: 'High profit',
      mid: 'Mid profit',
      low: 'Low profit',
    },
  },
  addLead: {
    dialogTitle: 'Add New Lead',
    nameLabel: 'Property Name *',
    namePlaceholder: 'Enter property name',
    duplicateWarning: 'A property named "{{name}}" already exists. Create anyway?',
    addressLabel: 'Property Address',
    addressPlaceholder: 'Enter property address',
    emailLabel: 'Email',
    emailPlaceholder: 'owner@example.com',
    phoneLabel: 'Phone',
    phonePlaceholder: '(555) 000-0000',
    bedroomsLabel: 'Estimated Bedrooms',
    bedroomsPlaceholder: 'e.g. 3',
    sourceLabel: 'Source',
    sourcePlaceholder: 'Select source',
    sourceReferral: 'Referral',
    sourceWebsite: 'Website',
    sourceColdOutreach: 'Cold Outreach',
    sourceWordOfMouth: 'Word of Mouth',
    sourceOther: 'Other',
    notesLabel: 'Notes',
    notesPlaceholder: 'Any additional notes...',
    cancel: 'Cancel',
    save: 'Add Lead',
    saving: 'Saving...',
  },
  toasts: {
    moveFailed: 'Failed to move property',
    followUpFailed: 'Failed to save follow-up date',
    leadAdded: 'Lead added to pipeline',
    addLeadErrorPrefix: 'Error: ',
    addLeadErrorFallback: 'Failed to add lead',
  },
}
