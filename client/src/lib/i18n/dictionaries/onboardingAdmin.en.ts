/**
 * English strings for the admin onboarding hub (`/onboarding-queue`): the
 * submissions review list, the review/apply dialog and the "Properties in
 * onboarding" readiness checklist. Kept apart from `onboarding.*` (which also
 * holds the public intake forms) so the two surfaces never touch the same file.
 * Source of truth for keys; onboardingAdmin.es.ts is typed `typeof onboardingAdminEn`.
 */
// Deliberately NOT `as const`: see issues.en.ts for the parity rationale.
export const onboardingAdminEn = {
  hub: {
    title: 'Onboarding',
    subtitleBefore: 'Review what clients send in from',
    subtitleAfter: ', then get each new property ready to go live.',
    tabs: {
      submissions: 'Submissions to review',
      properties: 'Properties in onboarding',
    },
  },
  // Property fields the review dialog adds on top of the original list
  fields: {
    pool: 'Pool',
    icalUrl: 'iCal URL (booking calendar)',
    guestCount: 'Guest count',
    kitchens: 'Kitchens',
    petFriendly: 'Pet friendly',
  },
  submissions: {
    kpi: {
      new: 'New',
      applied: 'Applied',
      rejected: 'Rejected',
      all: 'All submissions',
    },
    filters: {
      label: 'Filter submissions',
      new: 'New ({{count}})',
      applied: 'Applied ({{count}})',
      rejected: 'Rejected ({{count}})',
      all: 'All ({{count}})',
    },
    empty: {
      pending: 'Nothing is waiting for review.',
      converted: 'No applied submissions yet.',
      rejected: 'No rejected submissions.',
      all: 'No submissions yet.',
    },
    source: {
      owner: 'Owner portal',
      website: 'Website',
      link: 'Website link',
    },
    status: {
      new: 'New',
      applied: 'Applied',
      rejected: 'Rejected',
    },
    sections: {
      calendar: 'Booking calendar',
    },
    row: {
      forProperty: 'For {{name}}',
      ownerLogin: 'Owner portal login',
      rejectedOn: 'Rejected {{date}} by {{name}}',
      appliedTo: 'Applied to',
      appliedOn: '{{date}} by {{name}}',
    },
    actions: {
      applyTo: 'Apply to {{name}}',
      createInstead: 'Create a new property instead',
      applyOther: 'Apply to a different property',
      applyExisting: 'Apply to an existing property',
      reapply: 'Re-apply',
    },
    reject: {
      title: 'Reject this submission?',
      description: 'The submission from {{name}} moves to Rejected. It is kept, so you can still read what they sent, but it will not create or change a property.',
      confirm: 'Reject submission',
    },
  },
  // "Also submitted": answers the property has no field for
  extras: {
    title: 'Also submitted (not stored on the property)',
    intro: 'The property has no field for these, so they are listed here. The invoice email, the deep clean request and "API credentials provided" are written into the property note. The API key and secret stay on this submission only and are never copied.',
    none: 'Nothing else was submitted.',
    invoiceEmail: 'Invoice email',
    invoiceSame: '{{email}} (same as the contact email)',
    deepClean: 'Onboarding deep clean',
    deepCleanYes: 'Requested',
    deepCleanNo: 'Not requested',
    autoCode: 'Auto code entered',
    apiClientId: 'API client ID',
    apiKey: 'API key / secret',
    pdfs: 'PDF attachments',
    pdfsValue: '{{count}} attached (linked in the property note)',
  },
  secret: {
    reveal: 'Reveal',
    hide: 'Hide',
  },
  ical: {
    foundTitle: 'Calendar links found in the notes',
    use: 'Use as iCal URL',
    inUse: 'In use',
    savedNote: 'Every link in the notes is also saved in the property note.',
    invalid: 'Enter a full link that starts with http:// or https://',
  },
  dialog: {
    title: {
      create: 'Review and create new property',
      apply: 'Review and apply to {{name}}',
      reapply: 'Re-apply to {{name}}',
    },
    description: {
      create: 'Check the details from the form. Everything the client submitted is on this screen, and nothing is saved until you press Create property.',
      apply: 'For each field, pick the current listing value or the submitted one. Nothing changes until you press Apply to property.',
      reapply: 'This submission was already applied. Re-applying only adds what is still missing (blank fields, the notes, the photos) and never duplicates anything.',
    },
    actions: {
      create: 'Create property',
      apply: 'Apply to property',
      reapply: 'Re-apply',
    },
    submittedOn: 'submitted {{date}}',
    ownerLogin: 'Filed from the owner portal by {{name}}',
    applyingTo: 'Applying to {{name}} (property #{{id}})',
    autoCodeSubmitted: 'The client entered an auto code: {{code}}',
    notesTitle: 'Notes from the client',
    notesHint: 'Saved as a note on the property, so nothing is lost.',
    copyPhotos: 'Add the submitted photos to the property Photos tab ({{count}})',
    pdfsHint: 'PDF attachments ({{count}}) cannot go in the photo gallery. They are linked in the property note instead.',
  },
  contact: {
    title: 'Client',
    useExisting: 'Use the existing client: {{name}}',
    matchOwner: "This owner's client record",
    matchEmail: 'Matched by email',
    createNew: 'Create a new client from the details below',
    none: 'Do not link a client',
    leaveLinked: 'Leave the linked client as it is',
  },
  toasts: {
    nothingNew: 'Nothing new to add. Property #{{id}} already has everything from this submission.',
    noteAdded: 'Notes saved on the property.',
    photosAdded: 'Photos added: {{count}}.',
    ownerLinked: 'The owner now has portal access to it.',
    warningsTitle: 'Saved, but some steps need attention',
    markFailedCreate: 'Property #{{id}} was created, but this submission could not be marked as applied ({{error}}). Do not create it again. Open the submission, choose "Apply to an existing property" and pick #{{id}}.',
    markFailedMerge: 'Property #{{id}} was updated, but this submission could not be marked as applied ({{error}}). Open it and apply it again to #{{id}}. Nothing will be duplicated.',
  },
  warnings: {
    stage_history: 'The stage history entry could not be written.',
    note: 'The notes could not be saved on the property. Use Re-apply to try again.',
    photos: 'The photos could not be added. Use Re-apply to try again.',
    owner_link: 'The owner could not be given portal access automatically. Link them in Settings, Owners.',
  },
  properties: {
    kpi: {
      inOnboarding: 'In onboarding',
      ready: 'Ready to activate',
      needsWork: 'Still need work',
      longest: 'Longest wait (days)',
    },
    empty: 'No properties are in the Onboarding stage right now.',
    legend: 'Each property needs these six things before it goes live. Grey optional items never block activation.',
    daysIn: 'Days in onboarding: {{count}}',
    ready: 'Ready to activate',
    toDo: '{{count}} to do',
    moveToActive: 'Move to Active',
    activateAnyway: 'Activate anyway',
    stateDone: 'Done',
    stateTodo: 'To do',
    stateOptional: 'Optional',
    movedTitle: 'Moved to Active',
    moveFailed: 'Could not move the property',
    confirm: {
      title: 'Move {{name}} to Active?',
      ready: 'Everything on the checklist is done. The property will start showing as an active client.',
      notReady: 'Still open: {{items}}. You can move it now and finish these later.',
      action: 'Move to Active',
    },
  },
  readiness: {
    items: {
      portal: 'Owner portal',
      agreement: 'Service agreement',
      intake: 'Intake form',
      access: 'Access code',
      calendar: 'Calendar',
      trellis: 'Trellis',
    },
    detail: {
      portal: {
        linked: 'Linked to {{name}}.',
        inactive: '{{name}} has a portal login, but it is turned off.',
        none: 'No owner is linked to this property yet.',
      },
      agreement: {
        signed: 'Signed {{date}}.',
        sent: 'Sent {{date}}. Waiting for the owner to sign.',
        not_sent: 'Not sent yet.',
        needs_portal: 'Link the owner first, then send the agreement.',
      },
      intake: {
        applied: 'Form applied {{date}}.',
        pending: '{{count}} waiting for review.',
        none: 'No form submitted. Optional: you can enter the details yourself.',
      },
      access: {
        door_code: 'Door code is on file.',
        auto_code: 'Uses the shared smart-lock auto code.',
        missing: 'No door code yet.',
      },
      calendar: {
        ical: 'iCal link is on file.',
        api_key: 'The client sent an API key. Connect it in their booking tool.',
        missing: 'No iCal link or API key yet.',
      },
      trellis: {
        ok: 'The property is linked in Trellis and the owner has a Trellis portal link.',
        missing_property: 'The property is not linked in Trellis yet.',
        missing_owner: "The owner's Trellis portal link is not set.",
        missing_both: 'The property is not linked in Trellis, and the owner has no Trellis portal link.',
      },
    },
  },
  actions: {
    setUpPortal: 'Set up portal',
    openOwners: 'Open Owners',
    sendAgreement: 'Send agreement',
    viewAgreements: 'View agreements',
    reviewSubmission: 'Review submission',
    addDoorCode: 'Add door code',
    addIcal: 'Add iCal link',
    linkTrellis: 'Link in API Sync',
    addTrellisLink: 'Add Trellis link',
    adminOnly: 'Ask an admin',
  },
}
