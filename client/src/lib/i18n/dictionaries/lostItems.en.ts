/**
 * English strings for the lost-items surface. Stub pre-registered by the i18n
 * infrastructure PR so the translation PR for this area only touches this
 * file pair (plus its page files) — never the shared registry.
 * Source of truth for keys; lostItems.es.ts is typed `typeof lostItemsEn`.
 *
 * DB enum values (`lost_item_cases.status`, `return_method`) stay canonical
 * English everywhere — board grouping, filters, `STATUS_COLORS`/writes. The
 * `status.*`/`returnMethod.*` namespaces below are display-only slug lookups
 * (see `statusLabel`/`returnMethodLabel` in `components/lost-items/shared.ts`)
 * that fall back to the raw value if a key is ever missing.
 *
 * Shared app-wide strings (Cancel/Save/Edit/Refresh/Loading…, Property/Status/
 * Notes labels, the ErrorState defaults) are reused via unscoped
 * `common.actions.*` / `common.labels.*` keys rather than duplicated here.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const lostItemsEn = {
  page: {
    title: 'Lost Items',
    subtitle: 'Live data from Haven-OS · auto-refreshes every 30s',
    searchPlaceholder: 'Search description, guest, location…',
    filterOpen: 'Open',
    filterAllStatuses: 'All statuses',
    newCase: 'New Case',
    viewBoard: 'Board',
    viewList: 'List',
    noAccessTitle: 'Lost Items',
    noAccessDescription: "Your role doesn't have access to Lost Items. Contact an admin if you need this view.",
    errorLoad: "Couldn't load Lost Items: {{error}}",
    list: {
      case: 'Case',
      assignee: 'Assignee',
      updated: 'Updated',
      empty: 'No lost items match your filters.',
    },
  },
  board: {
    dropHere: 'Drop here',
    noCases: 'No cases',
    unassigned: 'Unassigned',
    followUpAbbrev: 'FU {{date}}',
  },
  status: {
    pending_pickup: 'Pending Pickup',
    picked_up: 'Picked Up',
    delivered: 'Delivered',
    failed: 'Failed',
    completed: 'Completed',
  },
  returnMethod: {
    shipped: 'Shipped',
    guest_pickup: 'Guest Pickup',
    in_person: 'In Person',
    other: 'Other',
  },
  detail: {
    backToAll: 'Back to all cases',
    openedAgo: 'opened {{time}}',
    noAccessTitle: 'Lost Items',
    noAccessDescription: "Your role doesn't have access to Lost Items.",
    errorLoad: "Couldn't load case: {{error}}",
    changeStatus: 'Change status',
    fields: {
      item: 'Item',
      itemDescription: 'Item description',
      description: 'Description',
      foundAt: 'Found at',
      guest: 'Guest',
      guestName: 'Guest name',
      guestEmail: 'Guest email',
      guestPhone: 'Guest phone',
      cleaningVendor: 'Cleaning vendor',
      returnMethod: 'Return method',
      returnMethodUnset: '- unset -',
      carrier: 'Carrier',
      shippingCarrier: 'Shipping carrier',
      trackingNumber: 'Tracking #',
      ownerTendwell: 'Owner (Tendwell)',
      tendwellAssignee: 'Tendwell assignee',
      unassignedOption: '- Unassigned',
      followUpDate: 'Follow-up date',
      followUp: 'Follow-up',
    },
    assignment: {
      assignedAgo: 'Assigned {{time}}',
      pickSomeone: 'Pick someone',
    },
    card: {
      title: 'Case details',
      editTitle: 'Edit case',
      saveChanges: 'Save changes',
    },
    comments: {
      title: 'Comments & activity',
      placeholder: 'Add a comment for the team - context, next steps, what the guest said…',
      placeholderShort: 'Add a comment…',
      count: '{{count}} comment(s)',
      post: 'Post comment',
      submit: 'Comment',
      empty: 'No comments yet.',
      emptyCta: 'Be the first to add context for the team.',
    },
    activityLog: {
      title: 'Activity log ({{count}})',
      statusChangeLabel: 'Status:',
      assignmentChangeLabel: 'Assigned:',
      systemActor: 'system',
    },
    eventType: {
      status_change: 'status change',
      comment: 'comment',
      assignment: 'assignment',
      created: 'created',
      updated: 'updated',
    },
    panels: {
      assignment: 'Assignment',
      links: 'Links',
      source: 'Source',
      timeline: 'Timeline',
      photos: 'Photos',
    },
    links: {
      slackThread: 'Slack thread',
      conversation: 'Conversation',
      sourceSystemFallback: 'Source system',
      openHaven: 'Open in Haven-OS',
    },
    source: {
      origin: 'Origin',
      externalSystem: 'External system',
      externalId: 'External ID',
    },
    timeline: {
      opened: 'Opened',
      pickupScheduled: 'Pickup scheduled',
      lastUpdate: 'Last update',
    },
    photos: {
      uploadNote: 'Upload happens in Haven-OS.',
    },
    notesEmpty: 'No notes yet.',
    footer: {
      source: 'Source: {{source}}',
    },
  },
  newCase: {
    title: 'New lost item case',
    description: 'Logs a case in Haven-OS and shows up immediately on this board.',
    whatWasFound: 'What was found *',
    whatWasFoundPlaceholder: 'Pair of black-rim Ray-Bans in a soft case…',
    foundAtPlaceholder: 'Master bedroom nightstand',
    propertyPlaceholder: 'Property name',
    initialStatus: 'Initial status',
    create: 'Create case',
  },
  toasts: {
    saved: 'Saved',
    saveFailed: 'Save failed',
    assignmentUpdated: 'Assignment updated',
    assignFailed: 'Failed to assign',
    movedTo: 'Moved to {{status}}',
    moveFailed: 'Failed to move case',
    commentAdded: 'Comment added',
    commentFailed: 'Failed to comment',
    postCommentFailed: 'Failed to post comment',
    caseCreated: 'Case created',
    createFailed: 'Failed to create case',
    unknownError: 'Unknown error',
  },
}
