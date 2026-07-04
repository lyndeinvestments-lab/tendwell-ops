// Shared helpers for notification endpoints
// Server-side only — uses Supabase service role + Resend API key

const RESEND_API = 'https://api.resend.com/emails'

export const FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL || 'Tendwell Ops <noreply@tendwellcleaningco.com>'

// Map each notification event to the view a user must have access to
export const EVENT_VIEW_REQUIREMENT: Record<string, string> = {
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
  // Public onboarding-intake form. Shares the master-list audience + the
  // "Onboarding submitted" preference toggle (notify_onboarding_submitted).
  onboarding_intake_submitted: 'master-list',
  // Owner signed their service agreement (sent server-side from
  // api/agreements/sign.ts). Settings view = admin audience.
  agreement_signed: 'settings',
}

export const EVENT_PREF_FIELD: Record<string, string> = {
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
  agreement_signed: 'notify_agreement_signed',
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

// Resolve the staff role for an authenticated email. Owners (property_owners)
// and any other authenticated identity are NOT in app_users, so this returns
// null for them — letting callers reject non-staff. Returns the role string
// ('admin' | 'operations' | 'cleaning' | 'viewer') for staff.
export async function getStaffRole(sb: SupabaseClient, email: string): Promise<string | null> {
  try {
    const rows = await sbFetch(
      sb,
      `app_users?google_email=eq.${encodeURIComponent(email.toLowerCase())}&select=role`,
    ) as Array<{ role?: string }>
    return rows[0]?.role ?? null
  } catch {
    return null
  }
}

// Resolve user's allowed views (matches auth.tsx logic)
const ROLE_VIEWS_FALLBACK: Record<string, string[]> = {
  admin: ['dashboard', 'pipeline', 'contacts', 'quote-sheet', 'cost-tracking', 'property-list', 'linen-tracker', 'linen-inventory', 'access-codes', 'ac-filters', 'master-list', 'pro-forma', 'previous-properties', 'settings', 'revenue-report', 'property-verifications', 'inspections', 'cleaners', 'issues', 'alerts', 'activity', 'financial-dashboard', 'tasks', 'report', 'cleaner-metrics'],
  operations: ['property-list', 'linen-tracker', 'linen-inventory', 'access-codes', 'ac-filters', 'property-verifications', 'inspections', 'cleaners', 'issues', 'alerts', 'tasks', 'cleaner-metrics'],
  cleaning: ['linen-tracker', 'linen-inventory'],
  viewer: ['dashboard', 'pipeline', 'contacts', 'cost-tracking', 'property-list', 'linen-tracker', 'ac-filters', 'master-list', 'pro-forma', 'previous-properties', 'revenue-report', 'property-verifications', 'inspections', 'alerts', 'activity', 'financial-dashboard'],
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
  notify_task_mention: boolean
  notify_watcher_update: boolean
  notify_list_added: boolean
  notify_issue_logged: boolean
  notify_verification_due: boolean
  notify_onboarding_submitted: boolean
  notify_follow_up_due: boolean
  notify_property_note_mention: boolean
  notify_contact_note_mention: boolean
  notify_agreement_signed: boolean
  digest_frequency: 'instant' | 'daily' | 'off'
}

// Effective preferences for a user with no notification_preferences row.
// MUST mirror the column defaults on the notification_preferences table so a
// user is treated identically whether or not their row has been created yet.
// verification_due / follow_up_due are opt-in events → default false.
export const DEFAULT_NOTIF_PREFS: Omit<NotifPrefs, 'user_id'> = {
  email_enabled: true,
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
  digest_frequency: 'instant',
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
    // Cleaning / cleaner roles default to NO email notifications. They only
    // opt IN if they have an explicit preferences row with email_enabled=true.
    const explicit = prefsByUser.get(u.id)
    if (!explicit && (u.role === 'cleaning' || u.role === 'cleaner')) return false
    // Any other user with no row is treated as the table defaults (NOT a
    // blanket "send all") so opt-in events like follow_up_due / verification_due
    // stay off until enabled. Matches the Settings UI's effective-defaults.
    const prefs = explicit ?? { user_id: u.id, ...DEFAULT_NOTIF_PREFS }
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

// Allowlist for CTA URLs so an attacker with a session token can't smuggle
// phishing links or `javascript:` URIs into outbound emails (bounty finding
// #1). Accepts same-origin Tendwell + Vercel preview deploys only.
const CTA_HOST_ALLOWLIST = [
  'app.tendwellcleaningco.com',
  // Legacy host kept during the app.tendwellcleaningco.com transition so
  // in-flight links in already-sent emails still validate. Safe to remove
  // once the old domain redirect has been live for a full notification cycle.
  'www.tendwellcleaning.com',
  'tendwellcleaning.com',
  'tendwell-ops.vercel.app',
]

// Vercel preview/branch deploys for this project live under the team-scoped
// suffix below, which an attacker cannot register a deployment under. Match
// that exact suffix instead of a substring like `includes('tendwell')` — the
// old check passed any host merely CONTAINING "tendwell" (e.g.
// `evil-tendwell-phish.vercel.app`), enabling phishing CTAs in outbound email.
const VERCEL_TEAM_SUFFIX = '.lyndeinvestments-labs-projects.vercel.app'

export function validateCtaUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = u.host.toLowerCase()
  const allowed = CTA_HOST_ALLOWLIST.includes(host) || host.endsWith(VERCEL_TEAM_SUFFIX)
  return allowed ? u.toString() : null
}

// Safely compose the email body from structured inputs. Prevents the arbitrary
// HTML / form injection vector that was possible when bodyHtml was passed raw
// from the client (bounty finding #2).
export function composeBodyHtml(opts: { lines?: string[]; quote?: string | null }): string {
  const escapedLines = (opts.lines || [])
    .filter(l => typeof l === 'string' && l.trim().length > 0)
    .map(l => `<p style="font-size:14px;line-height:1.6;color:#0f172a;">${escapeHtml(l)}</p>`)
    .join('')
  const quote = opts.quote
    ? `<blockquote style="border-left:3px solid #e2e8f0;margin:8px 0;padding:4px 12px;color:#334155;">${escapeHtml(opts.quote)}</blockquote>`
    : ''
  return escapedLines + quote
}

export function renderEmailLayout(opts: { title: string; bodyHtml: string; ctaUrl?: string; ctaLabel?: string }): string {
  // ctaUrl is expected to already have passed validateCtaUrl(). Defensive
  // attribute encoding below in case a future caller forgets.
  const safeCta = opts.ctaUrl ? escapeHtml(opts.ctaUrl) : ''
  const cta = safeCta
    ? `<p style="margin:24px 0;"><a href="${safeCta}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;">${escapeHtml(opts.ctaLabel || 'View')}</a></p>`
    : ''
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f8fafc;margin:0;padding:24px;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:24px;">
      <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;">${escapeHtml(opts.title)}</h2>
      ${opts.bodyHtml}
      ${cta}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px;"/>
      <p style="font-size:11px;color:#64748b;margin:0;">Tendwell Cleaning Co. — <a href="https://app.tendwellcleaningco.com/#/settings" style="color:#64748b;">manage notifications</a></p>
    </div></body></html>`
}
