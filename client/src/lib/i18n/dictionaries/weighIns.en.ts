/**
 * English strings for the laundry-weigh-in+laundry-weigh-ins surface. Stub pre-registered by the i18n
 * infrastructure PR so the translation PR for this area only touches this
 * file pair (plus its page files) — never the shared registry.
 * Source of truth for keys; weighIns.es.ts is typed `typeof weighInsEn`.
 *
 * `form.*` / `validation.*` / `success.*` back the PUBLIC, unauthenticated
 * submission form at `/weigh-in` (`pages/laundry-weigh-in.tsx`). `list.*`
 * backs the internal staff report page (`pages/laundry-weigh-ins.tsx`).
 *
 * `laundry_type` ('clean'/'dirty') stays canonical English in the database —
 * `list.filters.clean/dirty` and `form.type.clean/dirty` are display-only
 * labels, never written back to the row or passed to StatusBadge tones.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const weighInsEn = {
  form: {
    title: 'Daily Laundry Weigh-In',
    subtitle: 'Record laundry bags you are taking or dropping off.',
    name: {
      label: 'Your Name',
      placeholder: 'First and last name',
    },
    photo: {
      label: 'Photo',
      take: 'Take Photo',
      retake: 'Retake Photo',
      remove: 'Remove',
      hint: 'Tap to take a photo of the laundry bag(s).',
      previewAlt: 'Laundry preview',
    },
    pounds: {
      label: 'Pounds of Laundry',
      placeholder: 'e.g. 25',
      unit: 'lbs',
    },
    type: {
      label: 'Laundry Type',
      clean: 'Clean (drop-off)',
      dirty: 'Dirty (pick-up)',
    },
    specialLinens: {
      label: 'Special Linens?',
      hint: 'Items that require special handling or care.',
      yes: 'Yes',
      no: 'No',
      propertyLabel: 'Property',
      propertyPlaceholder: 'Search property…',
      noPropertiesFound: 'No properties found',
      descLabel: 'Description of Special Linens',
      descPlaceholder: 'e.g. King duvet, delicate curtains…',
      photoLabel: 'Photo of Special Linens',
      photoTake: 'Take Photo',
      photoRetake: 'Retake Photo',
      photoHint: 'Tap to take a photo of the special item(s).',
      photoPreviewAlt: 'Special linen preview',
      weightLabel: 'Weight of Special Linens',
      weightPlaceholder: 'e.g. 5',
    },
    submit: 'Submit Weigh-In',
    submitting: 'Submitting…',
    submitAnother: 'Submit Another',
    footer: 'Tendwell Cleaning Co.',
  },
  validation: {
    required: 'Please fill in your name, pounds, and laundry type.',
    pounds: 'Pounds must be a number greater than zero.',
    specialLinens: 'Please fill in the property, description, and weight for special linens.',
    specialWeight: 'Special linen weight must be a number greater than zero.',
    photo: 'Could not upload photo. Please try again.',
    generic: 'Something went wrong. Please try again.',
  },
  success: {
    title: 'Weigh-In Submitted',
    body: 'Thanks! Your laundry weigh-in has been recorded.',
  },
  list: {
    page: {
      title: 'Laundry Weigh-Ins',
      subtitle: 'Daily cleaner submissions from the public form',
    },
    actions: {
      openForm: 'Open form',
      copyLink: 'Copy link',
      copied: 'Copied',
    },
    toasts: {
      linkCopiedTitle: 'Link copied',
      copyFailedTitle: 'Copy failed',
      copyFailedDescription: 'Select and copy manually.',
      deletedTitle: 'Weigh-in deleted',
      deleteFailedTitle: 'Could not delete',
      exportedTitle: 'Exported',
      exportedDescription: '{{count}} rows downloaded.',
    },
    stats: {
      submissions: 'Submissions',
      cleanLbs: 'Clean lbs',
      dirtyLbs: 'Dirty lbs',
      uniqueCleaners: 'Unique cleaners',
    },
    filters: {
      searchPlaceholder: 'Search cleaner name…',
      allTypes: 'All types',
      clean: 'Clean',
      dirty: 'Dirty',
      last7Days: 'Last 7 days',
      last30Days: 'Last 30 days',
      last90Days: 'Last 90 days',
      allTime: 'All time',
    },
    table: {
      submitted: 'Submitted',
      cleaner: 'Cleaner',
      type: 'Type',
      pounds: 'Pounds',
      photo: 'Photo',
      none: 'None',
      viewPhotoAria: 'View photo',
      photoAlt: 'Weigh-in photo',
      deleteAria: 'Delete weigh-in',
      deleteConfirm: 'Delete weigh-in from {{name}}?',
      openOriginal: 'Open original',
      showing: 'Showing {{first}}-{{last}} of {{total}}',
      previous: 'Previous',
      next: 'Next',
      pageOf: 'Page {{page}} of {{total}}',
    },
    empty: {
      title: 'No weigh-ins yet',
      description: 'Submissions from the public form will show up here.',
    },
    errorTitle: 'Could not load weigh-ins',
  },
}
