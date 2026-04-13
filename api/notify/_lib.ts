// Shared helpers for notification endpoints
// Server-side only — uses Supabase service role + Resend API key

const RESEND_API = 'https://api.resend.com/emails'

export const FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL || 'Tendwell Ops <noreply@tendwellcleaning.com>'

// Map each notification event to the view a user must have access to
export const EVENT_VIEW_REQUIREMENT: Record<string, string> = {
  task_assigned: 'tasks',
  task_overdue: 'tasks',
  task_mention: 'tasks',
  issue_logged: 'issues',
  verification_due: 'inspections',
  onboarding_submitted: 'master-list',
  follow_up_due: 'contacts',
}

export const EVENT_PREF_FIELD: Record<string, string> = {
  task_assigned: 'notify_task_assigned',
  task_overdue: 'notify_task_overdue',
  task_mention: 'notify_task_mention',
  issue_logged: 'notify_issue_logged',
  verification_due: 'notify_verification_due',
  onboarding_submitted: 'notify_onboarding_submitted',
  follow_up_due: 'notify_follow_up_due',
}

export interface SupabaseClient {
  url: string
  serviceKey: string
}

export function getSupabaseConfig(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase config missing')
  return { url, serviceKey }
}

async function sbFetch(sb: SupabaseClient, path: string, init?: RequestInit) {
  const res = await fetch(`${sb.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: sb.serviceKey,
      Authorization: `Bearer ${sb.serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Supabase ${path}: ${res.status} ${txt}`)
  }
  return res.json()
}

// Verify session token belongs to a real authenticated user
export async function verifyAuthHeader(sb: SupabaseClient, authHeader: string | undefined): Promise<{ email: string } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const res = await fetch(`${sb.url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: sb.serviceKey },
  })
  if (!res.ok) return null
  const data = await res.json()
  return data?.email ? { email: data.email } : null
}

// Resolve user's allowed views (matches auth.tsx logic)
const ROLE_VIEWS_FALLBACK: Record<string, string[]> = {
  admin: ['dashboard', 'pipeline', 'contacts', 'quote-sheet', 'cost-tracking', 'property-list', 'linen-tracker', 'linen-inventory', 'access-codes', 'ac-filters', 'master-list', 'pro-forma', 'previous-properties', 'settings', 'revenue-report', 'inspections', 'cleaners', 'issues', 'alerts', 'activity', 'financial-dashboard', 'tasks', 'report', 'cleaner-metrics'],
  operations: ['property-list', 'linen-tracker', 'linen-inventory', 'access-codes', 'ac-filters', 'inspections', 'cleaners', 'issues', 'alerts', 'tasks', 'cleaner-metrics'],
  cleaning: ['linen-tracker', 'linen-inventory'],
  viewer: ['dashboard', 'pipeline', 'contacts', 'cost-tracking', 'property-list', 'linen-tracker', 'ac-filters', 'master-list', 'pro-forma', 'previous-properties', 'revenue-report', 'inspections', 'alerts', 'activity', 'financial-dashboard'],
}

export interface AppUserMin {
  id: number
  google_email: string
  role: string
  label: string
  custom_views: string[] | null
}

export async function getAllUsersWithViews(sb: SupabaseClient): Promise<Array<AppUserMin & { allowedViews: string[] }>> {
  const users = await sbFetch(sb, 'app_users?select=id,google_email,role,label,custom_views') as AppUserMin[]
  // Load role_permissions JSON if present
  let rolePerms: Record<string, { views: string[] }> | null = null
  try {
    const rows = await sbFetch(sb, "app_settings?key=eq.role_permissions&select=value")
    if (rows[0]?.value) {
      const parsed = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value
      rolePerms = parsed
    }
  } catch { /* ignore */ }

  return users.map(u => {
    let views: string[]
    if (Array.isArray(u.custom_views)) {
      views = u.custom_views
    } else if (rolePerms?.[u.role]?.views) {
      views = rolePerms[u.role].views
    } else {
      views = ROLE_VIEWS_FALLBACK[u.role] || []
    }
    return { ...u, allowedViews: views }
  })
}

export interface NotifPrefs {
  user_id: number
  email_enabled: boolean
  notify_task_assigned: boolean
  notify_task_overdue: boolean
  notify_issue_logged: boolean
  notify_verification_due: boolean
  notify_onboarding_submitted: boolean
  notify_follow_up_due: boolean
  digest_frequency: 'instant' | 'daily' | 'off'
}

export async function getAllPreferences(sb: SupabaseClient): Promise<Map<number, NotifPrefs>> {
  const rows = await sbFetch(sb, 'notification_preferences?select=*') as NotifPrefs[]
  return new Map(rows.map(r => [r.user_id, r]))
}

export async function logNotification(sb: SupabaseClient, entry: {
  recipient_email: string
  recipient_user_id?: number | null
  event_type: string
  subject?: string
  status: 'sent' | 'failed' | 'skipped'
  error?: string
  meta?: Record<string, any>
}) {
  try {
    await sbFetch(sb, 'notification_log', {
      method: 'POST',
      body: JSON.stringify(entry),
    })
  } catch (e) {
    console.error('Failed to log notification:', e)
  }
}

export interface SendResult {
  recipient: string
  status: 'sent' | 'failed' | 'skipped'
  reason?: string
}

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not configured' }

  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    }),
  })
  if (!res.ok) {
    const txt = await res.text()
    return { ok: false, error: `Resend ${res.status}: ${txt}` }
  }
  return { ok: true }
}

// Determine which users should receive a given event
export function filterRecipients(
  users: Array<AppUserMin & { allowedViews: string[] }>,
  prefsByUser: Map<number, NotifPrefs>,
  eventType: string,
  opts: { includeDigestUsers?: boolean; onlyUserIds?: Set<number> } = {}
): Array<AppUserMin & { allowedViews: string[] }> {
  const requiredView = EVENT_VIEW_REQUIREMENT[eventType]
  const prefField = EVENT_PREF_FIELD[eventType] as keyof NotifPrefs
  if (!requiredView || !prefField) return []

  return users.filter(u => {
    if (!u.google_email) return false
    if (opts.onlyUserIds && !opts.onlyUserIds.has(u.id)) return false
    if (!u.allowedViews.includes(requiredView)) return false
    const prefs = prefsByUser.get(u.id)
    // Default behavior if no prefs row: send (matches table defaults)
    if (!prefs) return true
    if (!prefs.email_enabled) return false
    if (prefs.digest_frequency === 'off') return false
    if (!opts.includeDigestUsers && prefs.digest_frequency !== 'instant') return false
    if (!(prefs as any)[prefField]) return false
    return true
  })
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

export function renderEmailLayout(opts: { title: string; bodyHtml: string; ctaUrl?: string; ctaLabel?: string }): string {
  const cta = opts.ctaUrl
    ? `<p style="margin:24px 0;"><a href="${opts.ctaUrl}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;">${escapeHtml(opts.ctaLabel || 'View')}</a></p>`
    : ''
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f8fafc;margin:0;padding:24px;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:24px;">
      <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;">${escapeHtml(opts.title)}</h2>
      ${opts.bodyHtml}
      ${cta}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px;"/>
      <p style="font-size:11px;color:#64748b;margin:0;">Tendwell Cleaning Co. — <a href="https://tendwellcleaning.com/#/settings" style="color:#64748b;">manage notifications</a></p>
    </div></body></html>`
}
