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
}

export const EVENT_VIEW_REQUIREMENT: Record<NotificationEventType, string> = {
  task_assigned: 'tasks',
  task_overdue: 'tasks',
  task_mention: 'tasks',
  watcher_update: 'tasks',
  list_added: 'tasks',
  issue_logged: 'issues',
  verification_due: 'inspections',
  onboarding_submitted: 'master-list',
  follow_up_due: 'contacts',
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
}

interface NotifyOpts {
  eventType: NotificationEventType
  subject: string
  bodyHtml: string
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
