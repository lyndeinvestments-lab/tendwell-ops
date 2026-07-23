/**
 * English strings for the /account page (language, security, notification
 * preferences) and the NotificationPrefs component. Source of truth for
 * keys; account.es.ts is typed `typeof accountEn`.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const accountEn = {
  page: {
    title: 'My Account',
    subtitle: 'Your language, security, and notification preferences.',
  },
  language: {
    title: 'Language',
    description: 'Choose the language for the whole app.',
    savedNote: 'Saved to your profile - your choice follows you on any device.',
  },
  security: {
    title: 'Security',
    description: 'Change the password you use to sign in.',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    updateButton: 'Update password',
    updating: 'Updating…',
    updated: 'Password updated',
    updateFailed: "Couldn't update password",
    tooShort: 'Password must be at least 8 characters',
    mismatch: "Passwords don't match",
    googleManaged: 'You sign in with Google, so your password is managed by your Google account.',
    setDescription: 'You sign in with Google. Set a password here and you can use either sign-in method on the login page.',
    setButton: 'Set password',
    setSuccess: 'Password set - you can now sign in with Google or email + password',
  },
  notifications: {
    title: 'Notifications',
    subtitle: 'Choose which email notifications you receive. You only see the events tied to areas you have access to.',
    testEmail: 'Send test email to me',
    testEmailSending: 'Sending…',
    testEmailSent: 'Test email sent',
    testEmailSentTo: 'Sent to {{email}}',
    testEmailFailed: 'Test failed',
    saveFailed: 'Save failed',
    emailNotifications: 'Email notifications',
    frequency: 'Frequency:',
    freqInstant: 'Instant',
    freqDaily: 'Daily digest (8am ET)',
    freqOff: 'Off',
    notifyMeAbout: 'Notify me about',
    frequencyOffNote: "Frequency is set to Off - these events won't send. Your selections are kept for when you re-enable.",
    emailDisabledNote: "Email is disabled - these events won't send. Your selections are kept for when you re-enable.",
    requiresAccess: 'Requires {{view}} access',
    enableEmailToUse: 'Enable email to use',
    lockedNote: "Locked events require access to a view you haven't been granted. Ask an admin if you need one.",
  },
  // Display names for NOTIF_EVENT_DEFS entries, keyed by their `field`.
  // Unknown/new events fall back to the def's English label at the call site.
  notifEvents: {
    notify_task_assigned: 'Task assigned',
    notify_task_mention: 'Mentioned in comment',
    notify_task_overdue: 'Task overdue (digest)',
    notify_watcher_update: 'Watcher updates',
    notify_list_added: 'Added to a task list',
    notify_issue_logged: 'New issue logged',
    notify_verification_due: 'Verification due',
    notify_onboarding_submitted: 'Onboarding submitted',
    notify_follow_up_due: 'Follow-up due',
    notify_property_note_mention: 'Mentioned in a property note',
    notify_contact_note_mention: 'Mentioned in a contact note',
    notify_agreement_signed: 'Agreement signed by owner',
    notify_issue_overdue: 'Overdue issues (daily digest)',
    notify_feedback_unacknowledged: 'Unacknowledged guest feedback (daily digest)',
  },
}
