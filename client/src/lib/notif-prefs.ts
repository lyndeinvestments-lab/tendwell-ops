// Shared notification-preference constants for the client.
//
// Single source of truth for the per-user email notification UI, used by both
// the admin matrix (Settings → Notifications) and the self-service page
// (/notifications → "My Notifications"). Keep in sync with the server-side
// DEFAULT_NOTIF_PREFS / EVENT_PREF_FIELD / EVENT_VIEW_REQUIREMENT in
// api/notify/_lib.ts — the server is the authority on what actually sends.

// Effective defaults for a user with no notification_preferences row. Mirrors
// the notification_preferences column defaults (and DEFAULT_NOTIF_PREFS in
// api/notify/_lib.ts) so the UI shows exactly the state the server will apply
// when no explicit row exists. verification_due / follow_up_due are opt-in.
export const DEFAULT_NOTIF_PREFS = {
  email_enabled: true,
  digest_frequency: 'instant',
  notify_task_assigned: true,
  notify_task_overdue: true,
  notify_task_mention: true,
  notify_watcher_update: true,
  notify_list_added: true,
  notify_issue_logged: true,
  notify_verification_due: false,
  notify_onboarding_submitted: true,
  notify_follow_up_due: false,
  notify_property_note_mention: true,
  notify_contact_note_mention: true,
  notify_agreement_signed: true,
} as const

// Each notification event maps to the view a user must have access to for the
// event to be relevant. A user without that view sees the toggle locked (and
// filterRecipients on the server drops them regardless), so preferences stay
// scoped to the permissions each user has actually been granted.
export interface NotifEventDef {
  field: string
  label: string
  view: string
}

export const NOTIF_EVENT_DEFS: NotifEventDef[] = [
  { field: 'notify_task_assigned',         label: 'Task assigned',                view: 'tasks' },
  { field: 'notify_task_mention',          label: 'Mentioned in comment',         view: 'tasks' },
  { field: 'notify_task_overdue',          label: 'Task overdue (digest)',        view: 'tasks' },
  { field: 'notify_watcher_update',        label: 'Watcher updates',              view: 'tasks' },
  { field: 'notify_list_added',            label: 'Added to a task list',         view: 'tasks' },
  { field: 'notify_issue_logged',          label: 'New issue logged',             view: 'issues' },
  { field: 'notify_verification_due',      label: 'Verification due',             view: 'property-verifications' },
  { field: 'notify_onboarding_submitted',  label: 'Onboarding submitted',         view: 'master-list' },
  { field: 'notify_follow_up_due',         label: 'Follow-up due',                view: 'contacts' },
  { field: 'notify_property_note_mention', label: 'Mentioned in a property note', view: 'property-list' },
  { field: 'notify_contact_note_mention',  label: 'Mentioned in a contact note',  view: 'contacts' },
  { field: 'notify_agreement_signed',      label: 'Agreement signed by owner',    view: 'settings' },
]
