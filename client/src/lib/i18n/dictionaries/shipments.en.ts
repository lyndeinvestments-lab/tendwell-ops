/**
 * English strings for the incoming-shipments+shipment-report surface. Stub pre-registered by the i18n
 * infrastructure PR so the translation PR for this area only touches this
 * file pair (plus its page files) — never the shared registry.
 * Source of truth for keys; shipments.es.ts is typed `typeof shipmentsEn`.
 *
 * `page.*` / `table.*` / `status.*` / `form.*` / `toasts.*` back the internal
 * staff page (`pages/incoming-shipments.tsx`). `report.*` backs the PUBLIC,
 * unauthenticated submission form at `/shipment-report`
 * (`pages/shipment-report.tsx`).
 *
 * `delivery_responsible` ('Haven'/'Tendwell') is NOT translated anywhere —
 * those are company/brand names (proper nouns), not generic words, and the
 * value is written verbatim to the DB from both the staff filter and the
 * public form's picker buttons.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const shipmentsEn = {
  page: {
    title: 'Incoming Shipments',
    subtitle: 'Submissions from the public report form · auto-refreshes every 30s',
    searchPlaceholder: 'Search sender, property, description, tracking…',
    allParties: 'All parties',
    errorDescription: "Couldn't load Incoming Shipments: {{message}}",
  },
  table: {
    headers: {
      sender: 'Sender',
      description: 'Description',
      tracking: 'Tracking',
      estDelivery: 'Est. Delivery',
      responsible: 'Responsible',
      submitted: 'Submitted',
    },
    empty: 'No shipments match your filters.',
    markReceived: 'Mark received',
    undo: 'Undo',
  },
  status: {
    pending: 'Pending',
    received: 'Received',
  },
  form: {
    markReceivedTitle: 'Mark shipment received',
    markReceivedFallback: 'Confirm the package has physically arrived.',
    notesLabel: 'Notes (optional)',
    notesPlaceholder: 'Anything worth recording - damage, location, who handed it off…',
    detailsTitle: 'Shipment details',
    submittedAt: 'Submitted {{time}}',
    trackingNumber: 'Tracking #',
    estimatedDelivery: 'Estimated delivery',
    deliveryResponsible: 'Delivery responsible',
    receivedAt: 'Received {{time}}',
    receivedBy: '· by {{name}}',
  },
  toasts: {
    markedReceived: 'Marked received',
    markReceivedFailed: 'Failed to mark received',
    movedToPending: 'Moved back to pending',
    undoFailed: 'Failed to undo',
    unknownError: 'Unknown error',
  },
  report: {
    title: 'Report Incoming Shipment',
    subtitle: 'Let us know about a shipment on its way to our facility.',
    yourName: 'Your Name',
    yourNamePlaceholder: 'First and last name',
    propertyPlaceholder: 'Search property…',
    trackingNumber: 'Tracking Number',
    optional: '(optional)',
    trackingPlaceholder: 'e.g. 1Z999AA10123456784',
    estimatedDeliveryDate: 'Estimated Delivery Date',
    descriptionOfItem: 'Description of Item',
    descriptionPlaceholder: 'Describe the item(s) being shipped…',
    responsibleQuestion: 'Who is responsible for delivering to the property?',
    validationRequired: 'Please fill in all required fields.',
    validationGeneric: 'Something went wrong. Please try again.',
    submit: 'Submit Shipment Report',
    submitting: 'Submitting…',
    footer: 'Tendwell Operations',
    successTitle: 'Shipment Reported',
    successBody: "Thanks! Your shipment report has been received. We'll be on the lookout.",
    submitAnother: 'Submit Another',
  },
}
