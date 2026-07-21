/**
 * English strings for the property-verifications surface. Stub pre-registered by the i18n
 * infrastructure PR so the translation PR for this area only touches this
 * file pair (plus its page files) — never the shared registry.
 * Source of truth for keys; verifications.es.ts is typed `typeof verificationsEn`.
 *
 * The computed walkthrough status (`'due' | 'verified' | 'never'`, from
 * `getStatus()` in the page) is a code-only union, not a DB enum — the
 * `status.*` namespace below is still a display-only lookup (never passed to
 * StatusBadge/toneForStatus or written back), keyed directly by the union
 * value. `form.sections.*` / `form.fields.*` are display-only lookups for the
 * `VERIFY_SECTIONS` walkthrough config in `property-verifications.tsx`,
 * keyed by a small section-title→key map and by the (already snake_case)
 * property column name respectively — the underlying `properties` columns
 * stay canonical English.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const verificationsEn = {
  page: {
    title: 'Property Verification',
    subtitle: 'Verify property details every 6 months - click a property to start walkthrough',
    needsVerification: '{{count}} need(s) verification',
    searchPlaceholder: 'Search…',
  },
  tiles: {
    totalProperties: 'Total Properties',
    verified: 'Verified',
    needsVerification: 'Needs Verification',
    overdue: 'Overdue',
  },
  bulk: {
    selected: '{{count}} selected',
    assign: 'Assign',
    clearAssignment: 'Clear assignment',
    setDueDate: 'Set due date',
    apply: 'Apply',
    plusOneMonth: '+1mo',
    markVerified: 'Mark verified',
    clear: 'Clear',
  },
  table: {
    selectAllAria: 'Select all',
    selectRowAria: 'Select {{name}}',
    property: 'Property',
    status: 'Status',
    assignee: 'Assignee',
    due: 'Due',
    lastVerified: 'Last Verified',
    verifiedBy: 'Verified By',
    action: 'Action',
    daysAgo: '({{count}}d ago)',
    emptyAllVerifiedTitle: 'All verified',
    emptyAllVerifiedDescription: 'All properties have been verified within the last 6 months.',
    emptyNoPropertiesTitle: 'No properties',
    emptyNoPropertiesDescription: 'No properties found matching your search.',
    verify: 'Verify',
    reVerify: 'Re-verify',
  },
  // Display names for the code-only walkthrough status union, keyed directly
  // by the union value ('due' | 'verified' | 'never').
  status: {
    verified: 'Verified',
    due: 'Due',
    never: 'Never',
  },
  toasts: {
    editAccessRequired: 'Edit access required',
    editAccessDescription: "You don't have edit access to this page.",
    updatePropertyFailed: 'Failed to update property',
    saveVerificationFailed: 'Failed to save verification',
    verificationComplete: 'Verification complete',
    fieldsUpdated: '{{count}} field(s) updated',
    allInfoConfirmed: 'All info confirmed',
    unexpectedError: 'Unexpected error saving verification',
    tryAgain: 'Please try again.',
    bulkAssignFailed: 'Bulk assign failed',
    assignedTo: 'Assigned {{count}} to {{name}}',
    clearedAssignment: 'Cleared assignment on {{count}}',
    bulkScheduleFailed: 'Bulk schedule failed',
    setDueDateOn: 'Set due date on {{count}}',
    bulkVerifyFailed: 'Bulk verify failed',
    markedVerified: 'Marked {{count}} verified',
    clearFailed: 'Clear failed',
  },
  confirm: {
    bulkMarkVerified: "Mark {{count}} as verified now? This won't update property fields, only the verification record.",
    unsavedChanges: 'You have unsaved changes. Close without saving?',
  },
  csv: {
    headerDaysSince: 'Days Since',
  },
  form: {
    sections: {
      propertyDetails: 'Property Details',
      bedCounts: 'Bed Counts',
      accessWifi: 'Access & Wi-Fi',
      operations: 'Operations',
    },
    fields: {
      address: 'Address',
      bedrooms: 'Bedrooms',
      full_baths: 'Full Baths',
      half_baths: 'Half Baths',
      square_footage: 'Square Footage',
      guest_count: 'Max Guests',
      hot_tub: 'Hot Tub',
      pet_friendly: 'Pet Friendly',
      king_beds: 'King Beds',
      queen_beds: 'Queen Beds',
      full_beds: 'Full Beds',
      twin_beds: 'Twin Beds',
      number_of_beds: 'Total Beds',
      auto_code: 'Auto Code',
      door_code: 'Door Code',
      other_codes: 'Other Codes',
      wifi_info: 'Wi-Fi Info',
      filter_size: 'AC Filter Size',
      cleaning_frequency: 'Cleaning Frequency',
      notes: 'Special Notes',
    },
    noAddress: 'No address',
    confirmVerification: 'Confirm Verification',
    viewOnly: 'View Only',
  },
}
