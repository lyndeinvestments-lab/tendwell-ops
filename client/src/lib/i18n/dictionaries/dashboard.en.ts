/**
 * English strings for the dashboard surface. Stub pre-registered by the
 * account/locale infrastructure PR so the translation PR for this area only
 * touches this file pair (plus its page files) — never the shared registry.
 * Source of truth for keys; dashboard.es.ts is typed `typeof dashboardEn`.
 *
 * Pipeline stage display names (Active/Onboarding/Offboarding/etc.) are NOT
 * duplicated here — the page looks them up via the shared `common.stage.*`
 * slug map (see `lib/issues.ts`'s `slugify`), since `pipeline_stages.name`
 * stays canonical English in the DB. `PROFIT_TIER_LABELS` (from
 * `lib/profit-colors.ts`, a shared file outside this area) also stays
 * untranslated English here — it's rendered as-is across every page that
 * imports it, not owned by this dictionary.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const dashboardEn = {
  page: {
    title: 'Dashboard',
    subtitle: 'Operations overview',
    errorTitle: 'Failed to load dashboard data',
  },
  hero: {
    monthlyRevenue: 'Monthly Revenue (active)',
    portfolio: 'Portfolio',
    activeOfTotal: 'active of {{total}} properties',
    profitLabel: 'profit',
    marginLabel: 'margin',
    profitMix: 'Active profit mix',
    propsCount: '{{count}} props',
  },
  filterBar: {
    sevenDays: '7 Days',
    thirtyDays: '30 Days',
    ninetyDays: '90 Days',
    custom: 'Custom',
    fromDateAria: 'From date',
    toDateAria: 'To date',
    to: 'to',
    showingRange: 'Showing {{from}}-{{to}}',
  },
  // Lowercase period-length phrases used inline in "in {{period}}" / "({{period}})"
  // contexts, as opposed to the capitalized filterBar button labels above.
  period: {
    sevenDays: '7 days',
    thirtyDays: '30 days',
    ninetyDays: '90 days',
  },
  todayActions: {
    title: "Today's Actions",
    empty: 'All caught up - nothing needs action today.',
    followUpOverdue: 'Follow-up overdue',
    followUpDueToday: 'Follow-up due today',
    badgeOverdue: 'Overdue',
    badgeToday: 'Today',
    badgeStalled: 'Stalled',
    viewAllAlerts: 'View all alerts →',
  },
  attention: {
    title: 'Needs Attention',
    empty: 'No data issues - all active properties look healthy.',
    negativeProfitChip: '{{count}} negative profit',
    viewAllCount: 'View all {{count}} →',
    missingDataChip: '{{count}} missing data',
    fixButton: 'Fix',
    // Short field-abbreviation chips shown next to a property missing that field.
    missingFields: {
      ce: 'CE',
      pay: 'Pay',
      sqft: 'SqFt',
      beds: 'Beds',
      address: 'Address',
    },
  },
  tiles: {
    totalProperties: 'Total Properties',
    conversions: 'Conversions',
    conversionsSubtitle: 'in {{period}}',
    conversionsHint: 'Properties that moved to Active stage during this period',
    avgOnboarding: 'Avg Onboarding',
    noData: 'No data',
    avgOnboardingSubtitleConversion: 'days to active (this period)',
    avgOnboardingSubtitleCurrent: 'days in progress ({{count}} open)',
    avgOnboardingSubtitleNoData: 'no transitions yet',
    avgOnboardingHintConversion: 'Average days from Onboarding to Active stage for conversions in the selected period.',
    avgOnboardingHintCurrent: 'No conversions in the selected period - showing how long properties currently in Onboarding have been there.',
    avgOnboardingHintNoData: 'No onboarding activity recorded. A property needs at least one stage_transitions row to appear here.',
    trellisTasksToday: 'Trellis Tasks Today',
    trellisUnavailable: 'Unavailable',
    trellisAsOf: 'as of {{time}}',
    trellisDueToday: 'today',
    trellisDue: 'due {{date}}',
    trellisErrorHint: "Couldn't load Trellis snapshot: {{message}}",
    trellisHint: 'Open Trellis tasks due today (America/Chicago), counted from the synced snapshot. Click for the full task tracker.',
  },
  activityMetrics: {
    newProperties: 'New Properties ({{period}})',
    newPropertiesEmpty: 'No new properties in this period',
    offboarded: 'Offboarded ({{period}})',
    offboardedEmpty: 'No offboarded properties in this period',
    viewAll: 'View All →',
  },
  insights: {
    profitDistribution: 'Profit Distribution (Active)',
    currentSuffix: '(current)',
    profitDistributionEmpty: 'No active properties with financial data.',
    propertiesByStage: 'Properties by Stage',
    recentTransitions: 'Recent Transitions ({{period}})',
    recentTransitionsEmpty: 'No transitions in this period',
    viewAllTransitions: 'View All Transitions →',
    // Fallback label when a transition's `from_stage_id` is null (property
    // was created directly into a stage, with no prior stage to show).
    newStageFallback: 'New',
  },
  quality: {
    title: 'Quality Leaderboard',
    emptyTitle: 'No inspections logged yet',
    emptyDescription: 'Log at least 3 inspections to see your top and bottom performing properties ranked by score.',
    logFirstInspection: 'Log First Inspection',
    topPerformers: 'Top Performers',
    needsAttention: 'Needs Attention',
  },
  scheduled: {
    title: 'Scheduled This Week',
    subtitle: 'cleaning assignments',
    setupAssignments: 'Set up assignments →',
    qualityAlertsTitle: 'Quality Alerts',
  },
  crm: {
    title: 'CRM Overview',
    totalClients: 'Total Clients',
    new30Days: 'New (30 days)',
    unassignedProperties: 'Unassigned Properties',
    noClientsYet: 'No clients yet.',
    importFromProperties: 'Import from Properties →',
    paymentMethods: 'Payment Methods',
    unknownPaymentMethod: 'Unknown',
  },
}
