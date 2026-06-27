// Client-side notification helper. Calls /api/notify/send with a Bearer session token.
// Fire-and-forget: failures are logged but don't block the user action.
import { supabase } from '@/lib/supabase'

export type NotificationEventType =
  | 'task_assigned'
  | 'task_overdue'
  | 'task_mention'
  | 'watcher_update'
  | 'list_added'
  | 'issue_logged'
  | 'verification_due'
  | 'onboarding_submitted'
  | 'follow_up_due'
  | 'property_note_mention'
  | 'contact_note_mention'
  | 'onboarding_intake_submitted'

export const EVENT_LABELS: Record<NotificationEventType, string> = {
  task_assigned: 'Task assigned to me',
  task_overdue: 'Task overdue',
  task_mention: 'Mentioned in a task comment',
  watcher_update: 'Watcher update',
  list_added: 'Added to a task list',
  issue_logged: 'New issue logged',
  verification_due: 'Verification due',
  onboarding_submitted: 'Onboarding form submitted',
  follow_up_due: 'Follow-up due',
  property_note_mention: 'Mentioned in a property note',
  contact_note_mention: 'Mentioned in a contact note',
  onboarding_intake_submitted: 'Onboarding intake submitted',
}

export const EVENT_VIEW_REQUIREMENT: Record<NotificationEventType, string> = {
  task_assigned: 'tasks',
  task_overdue: 'tasks',
  task_mention: 'tasks',
  watcher_update: 'tasks',
  list_added: 'tasks',
  issue_logged: 'issues',
  verification_due: 'property-verifications',
  onboarding_submitted: 'master-list',
  follow_up_due: 'contacts',
  property_note_mention: 'property-list',
  contact_note_mention: 'contacts',
  onboarding_intake_submitted: 'master-list',
}

export const EVENT_PREF_FIELD: Record<NotificationEventType, string> = {
  task_assigned: 'notify_task_assigned',
  task_overdue: 'notify_task_overdue',
  task_mention: 'notify_task_mention',
  watcher_update: 'notify_watcher_update',
  list_added: 'notify_list_added',
  issue_logged: 'notify_issue_logged',
  verification_due: 'notify_verification_due',
  onboarding_submitted: 'notify_onboarding_submitted',
  follow_up_due: 'notify_follow_up_due',
  property_note_mention: 'notify_property_note_mention',
  contact_note_mention: 'notify_contact_note_mention',
  onboarding_intake_submitted: 'notify_onboarding_submitted',
}

interface NotifyOpts {
  eventType: NotificationEventType
  subject: string
  // Structured body. Server escapes + renders safely. Replaces the old raw
  // bodyHtml contract which allowed HTML injection from any authenticated
  // caller (bounty finding #2).
  bodyLines: string[]
  // Optional blockquote for user-provided content (e.g. the note text the
  // mention was in). Server escapes on render.
  quoteText?: string
  ctaUrl?: string
  ctaLabel?: string
  meta?: Record<string, any>
  targetUserIds?: number[]
}

export function escapeHtml(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

// Parse @mentions from text given list of user labels.
// Matches @<label> case-insensitive, longest match first to handle multi-word labels.
export function parseMentions(text: string, users: Array<{ id: number; label: string }>): number[] {
  if (!text) return []
  const sorted = [...users].sort((a, b) => b.label.length - a.label.length)
  const matched = new Set<number>()
  for (const u of sorted) {
    if (!u.label) continue
    const escaped = u.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`@${escaped}(?![a-zA-Z0-9])`, 'i')
    if (re.test(text)) matched.add(u.id)
  }
  return Array.from(matched)
}

// Render comment text with @mentions highlighted
export function renderMentions(text: string, userLabels: string[]): Array<{ type: 'text' | 'mention'; value: string }> {
  if (!text) return []
  const sorted = [...userLabels].sort((a, b) => b.length - a.length)
  const escaped = sorted.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (escaped.length === 0) return [{ type: 'text', value: text }]
  const re = new RegExp(`@(${escaped.join('|')})(?![a-zA-Z0-9])`, 'gi')
  const parts: Array<{ type: 'text' | 'mention'; value: string }> = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) })
    parts.push({ type: 'mention', value: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
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

export async function sendInviteEmail(email: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const token = await getToken()
  if (!token) return { ok: false, error: 'Not signed in' }
  try {
    const res = await fetch('/api/notify/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email, name }),
    })
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data.error || 'Failed' }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' }
  }
}

// Fire-and-forget owner notification (staff-triggered). Never throws — a failed
// email must not break the staff action that triggered it. The recipient is
// resolved server-side from ownerId; we only pass display context here.
export async function notifyOwner(
  ownerId: string,
  event: 'quote_sent' | 'referral_update' | 'testimonial_update' | 'feedback_update',
  ctx?: { propertyName?: string; status?: string; referredName?: string },
): Promise<void> {
  try {
    const token = await getToken()
    if (!token) return
    await fetch('/api/notify/owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ownerId, event, ...(ctx || {}) }),
    })
  } catch (e) {
    console.warn('notifyOwner error:', e)
  }
}
