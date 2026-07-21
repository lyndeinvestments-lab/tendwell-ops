/**
 * English strings for the alerts surface. Stub pre-registered by the
 * account/locale infrastructure PR so the translation PR for this area only
 * touches this file pair (plus its page files) — never the shared registry.
 * Source of truth for keys; alerts.es.ts is typed `typeof alertsEn`.
 *
 * `useAlerts()` (exported from `pages/alerts.tsx` and consumed by the
 * `App.tsx` bell button) generates each alert's `title`/`description` as
 * plain interpolated English strings — that's DATA, not page chrome: nothing
 * here re-translates it (dismissals key off `alert.id`, never off the text,
 * but the copy itself embeds live property names/dates/percentages and isn't
 * worth templating for a first pass). Only static page chrome — headers,
 * filter labels, severity/category display names, buttons, aria-labels,
 * empty states — is translated.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const alertsEn = {
  page: {
    title: 'Alerts',
    subtitleCritical: '{{count}} critical',
    subtitleWarning: '{{count}} warning',
    subtitleInfo: '{{count}} info',
    subtitleDismissed: '{{count}} dismissed',
    dismissAllWarnings: 'Dismiss All Warnings ({{count}})',
    showDismissed: 'Show dismissed ({{count}})',
    allClearTitle: 'All clear! No active alerts.',
    allClearFilteredHint: 'Try clearing filters above to see alerts in other categories or severities.',
    allClearDefaultHint: 'New alerts surface automatically when issues are detected.',
    go: 'Go',
    restore: 'Restore',
  },
  filters: {
    severityLabel: 'Severity',
    categoryLabel: 'Category',
    selectAllAria: 'Select all visible alerts',
    selectedCount: '{{count}} selected',
    selectAllCount: 'Select all ({{count}})',
    snooze: 'Snooze',
    dismiss: 'Dismiss',
    snooze1Day: '1 day',
    snooze3Days: '3 days',
    snooze1Week: '1 week',
    snoozeOption: 'Snooze {{label}}',
    selectAlertAria: 'Select alert: {{title}}',
    dismissAlertAria: 'Dismiss alert: {{title}}',
    snoozeAlertAria: 'Snooze alert: {{title}}',
    viewPropertyAria: 'View property: {{title}}',
  },
  // Display-only; the underlying `severity` value used for logic/tone
  // lookups (`SEVERITY_CONFIG`, `severityFilter` state) stays canonical.
  severity: {
    all: 'All',
    critical: 'Critical',
    warning: 'Warning',
    info: 'Info',
  },
  // Display-only slug lookup for `alert.category` (canonical English in
  // `useAlerts()` and in the `categoryFilter`/`categoryCounts` equality
  // checks) — see `slugify()` in `lib/issues.ts`.
  category: {
    all: 'All',
    financial: 'Financial',
    data_quality: 'Data Quality',
    maintenance: 'Maintenance',
    inventory: 'Inventory',
    onboarding: 'Onboarding',
    crm: 'CRM',
    issues: 'Issues',
  },
}
