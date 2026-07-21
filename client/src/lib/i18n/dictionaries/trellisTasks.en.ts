/**
 * English strings for the Trellis Tasks surface (the /trellis-tasks page —
 * cleaning/ops tasks synced hourly from the Trellis snapshot tables, plus the
 * admin-only roster-gap panel). Source of truth for keys; `trellisTasks.es.ts`
 * is typed `typeof trellisTasksEn` so TypeScript enforces key parity.
 *
 * `trellis_task_snapshot.status` values (`SCHEDULED`/`OPEN`/`COMPLETED`) stay
 * canonical English wherever used for filtering/logic; `status.*` below is a
 * display-only slug lookup (see `slugify` in `client/src/lib/issues.ts`) that
 * falls back to the raw lowercased value for anything not listed. The
 * "Tendwell"/"Haven" workspace-source chips are brand names and are never
 * translated.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const trellisTasksEn = {
  page: {
    title: 'Trellis Tasks',
    subtitle: 'Cleaning and ops tasks from the Trellis snapshot - synced hourly.',
    syncedPrefix: 'Synced {{date}}',
    notSyncedYet: 'Not synced yet',
    refresh: 'Refresh',
    errorTitle: "Couldn't load Trellis tasks",
  },
  tiles: {
    overdue: 'Overdue',
    overdueSubtitleUnassigned: '+{{count}} unassigned past due',
    overdueSubtitleDefault: 'assigned, past due',
    dueToday: 'Due Today',
    turnCleansToday: 'Turn Cleans Today',
    turnCleansSubtitle: '{{done}} done · {{open}} open',
    completedToday: 'Completed Today',
    completedTodaySubtitle: "of today's scheduled",
  },
  roster: {
    heading: 'In Trellis, not in Ops',
    peopleCount: '{{count}} people',
    hideDismissed: 'Hide dismissed',
    showDismissed: 'Show dismissed ({{count}})',
    noName: '(no name)',
    noEmail: 'no email',
    addTitle: 'Add to the Ops cleaners list',
    add: 'Add',
    dismissTitle: 'Dismiss - hide this person from the list',
    dismiss: 'Dismiss',
    allDismissed: 'Everyone left is dismissed - nothing to review.',
    dismissedHeading: 'Dismissed',
    restore: 'Restore',
  },
  toasts: {
    addedTitle: '{{name}} added to Cleaners',
    addedDescription: 'Set pay rate and send an app invite from the Cleaners page.',
    addFailedTitle: 'Could not add cleaner',
    dismissedTitle: '{{name}} dismissed',
    dismissFailedTitle: 'Could not dismiss',
    restoredTitle: '{{name}} restored',
    restoreFailedTitle: 'Could not restore',
    syncStartedTitle: 'Sync started',
    syncStartedDescription: 'Tasks refresh in a minute or two - data updates automatically.',
    syncFailedTitle: 'Could not start sync',
  },
  filters: {
    tabs: {
      overdue: 'Overdue',
      today: 'Due Today',
      completed: 'Completed',
      all: 'All',
    },
    turnCleansOnly: 'Turn cleans only',
    includeUnassigned: 'Include unassigned ({{count}})',
    includeUnassignedTitle: 'Trellis buckets vendor-held and unassigned tasks separately from Overdue - toggle to see them here too.',
    searchPlaceholder: 'Search property, task, assignee…',
  },
  table: {
    property: 'Property',
    task: 'Task',
    status: 'Status',
    due: 'Due',
    assignee: 'Assignee',
    source: 'Source',
    openInTrellis: 'Open this task in Trellis',
    openInTrellisAria: 'Open in Trellis',
    daysLate: '{{count}}d late',
    dueDay: 'Due {{date}}',
    unassignedFallback: 'unassigned',
    emptyTitle: 'No tasks here',
    emptyOverdue: 'Nothing overdue - all caught up.',
    emptyFiltered: 'No tasks match the current filters.',
  },
  // `trellis_task_snapshot.status` — canonical English in the DB. Display-only
  // slug lookup; anything not listed falls back to the raw lowercased value.
  status: {
    scheduled: 'Scheduled',
    open: 'Open',
    completed: 'Completed',
    unknown: 'Unknown',
  },
}
