// Client-side notification helper. Calls /api/notify/send with a Bearer session token.
// Fire-and-forget: failures are logged but don't block the user action.
import { supabase } from '@/lib/supabase'

export type NotificationEventType =
  | 'task_assigned'
  | 'task_overdue'
  | 'issue_logged'
  | 'verification_due'
  | 'onboarding_submitted'
  | 'follow_up_due'

export const EVENT_LABELS: Record<NotificationEventType, string> = {
  task_assigned: 'Task assigned to me',
  task_overdue: 'Task overdue',
  issue_logged: 'New issue logged',
  verification_due: 'Verification due',
  onboarding_submitted: 'Onboarding form submitted',
  follow_up_due: 'Follow-up due',
}

// Map each event to the view a user must have access to (mirrors server-side _lib.ts)
export const EVENT_VIEW_REQUIREMENT: Record<NotificationEventType, string> = {
  task_assigned: 'tasks',
  task_overdue: 'tasks',
  issue_logged: 'issues',
  verification_due: 'inspections',
  onboarding_submitted: 'master-list',
  follow_up_due: 'contacts',
}

export const EVENT_PREF_FIELD: Record<NotificationEventType, string> = {
  task_assigned: 'notify_task_assigned',
  task_overdue: 'notify_task_overdue',
  issue_logged: 'notify_issue_logged',
  verification_due: 'notify_verification_due',
  onboarding_submitted: 'notify_onboarding_submitted',
  follow_up_due: 'notify_follow_up_due',
}

interface NotifyOpts {
  eventType: NotificationEventType
  subject: string
  bodyHtml: string
  ctaUrl?: string
  ctaLabel?: string
  meta?: Record<string, any>
}

async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || null
}

export async function notify(opts: NotifyOpts): Promise<void> {
  try {
    const token = await getToken()
    if (!token) return
    const res = await fetch('/api/notify/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(opts),
    })
    if (!res.ok) console.warn('notify failed:', await res.text())
  } catch (e) {
    console.warn('notify error:', e)
  }
}

export async function sendTestEmail(): Promise<{ ok: boolean; error?: string; sentTo?: string }> {
  const token = await getToken()
  if (!token) return { ok: false, error: 'Not signed in' }
  const res = await fetch('/api/notify/test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok) return { ok: false, error: data.error || 'Failed' }
  return { ok: true, sentTo: data.sentTo }
}
