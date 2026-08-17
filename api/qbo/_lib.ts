// Shared helpers for the QBO OAuth endpoints (api/qbo/authorize.ts +
// api/qbo/callback.ts). Implements:
//   - Bearer-token admin auth check (matches the api/notify pattern)
//   - State-cookie generation/validation that ties /authorize ↔ /callback
//     so an attacker cannot complete the OAuth flow on Tendwell's behalf.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomBytes, timingSafeEqual } from 'node:crypto'

export const STATE_COOKIE = 'qbo_oauth_state'
export const STATE_TTL_SECONDS = 600 // 10 min — well within Intuit's auth window

interface SupabaseConfig {
  url: string
  serviceKey: string
}

export function getSupabaseConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase config missing')
  return { url, serviceKey }
}

// Resolve the Authorization: Bearer <jwt> to the staff row behind it, writing
// the 401 response itself on a missing/invalid session. Shared by the admin and
// permission-scoped gates below so both validate the token identically.
async function resolveStaffFromBearer(
  req: VercelRequest,
  res: VercelResponse,
): Promise<{ email: string; label: string; role: string } | null> {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization: Bearer <session token>' })
    return null
  }
  const token = auth.slice(7)
  const sb = getSupabaseConfig()
  const userRes = await fetch(`${sb.url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: sb.serviceKey },
  })
  if (!userRes.ok) {
    res.status(401).json({ error: 'Invalid session' })
    return null
  }
  const user = await userRes.json() as { email?: string }
  if (!user.email) {
    res.status(401).json({ error: 'Invalid session' })
    return null
  }
  const lookup = await fetch(
    `${sb.url}/rest/v1/app_users?select=role,label&google_email=eq.${encodeURIComponent(user.email.toLowerCase())}&limit=1`,
    { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
  )
  if (!lookup.ok) {
    res.status(403).json({ error: 'Authorization lookup failed' })
    return null
  }
  const rows = await lookup.json() as Array<{ role?: string; label?: string }>
  const row = rows[0]
  if (!row?.role) {
    res.status(403).json({ error: 'Not a staff account' })
    return null
  }
  return { email: user.email, label: row.label ?? row.role, role: row.role }
}

/** Verify the caller may act on `view` per the RBAC store in
 *  app_settings.role_permissions, rather than by a hardcoded role check.
 *  Admins always pass. `mode` picks the view or edit grant.
 *
 *  This is what makes a grant in Settings → Roles & Permissions real for an
 *  API-backed page: /invoicing used to be admin-only at the route, the tables
 *  AND here, so granting the `invoicing` view only produced a sidebar link
 *  that every layer below refused.
 *
 *  Delegates to the same SQL helpers the table policies use
 *  (current_user_can_view / current_user_can_edit, 20260817c), so the endpoint
 *  and RLS can never disagree about what a role is allowed to do. */
export async function requirePermissionBearer(
  req: VercelRequest,
  res: VercelResponse,
  view: string,
  mode: 'view' | 'edit' = 'edit',
): Promise<{ email: string; label: string; role: string } | null> {
  const staff = await resolveStaffFromBearer(req, res)
  if (!staff) return null
  if (staff.role === 'admin') return staff

  const sb = getSupabaseConfig()
  const fn = mode === 'edit' ? 'current_user_can_edit' : 'current_user_can_view'
  // Called with the caller's own token (not the service key) so the SECURITY
  // DEFINER helper resolves auth.uid() to this user.
  const rpc = await fetch(`${sb.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: sb.serviceKey,
      Authorization: req.headers.authorization as string,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_view: view }),
  })
  if (!rpc.ok) {
    res.status(403).json({ error: 'Permission lookup failed' })
    return null
  }
  if (await rpc.json() !== true) {
    res.status(403).json({ error: `Permission required: ${view}:${mode}` })
    return null
  }
  return staff
}

// Verify the Authorization: Bearer <jwt> belongs to a user whose
// app_users.role is 'admin'. Returns the resolved user info or null.
export async function requireAdminBearer(
  req: VercelRequest,
  res: VercelResponse,
): Promise<{ email: string; label: string } | null> {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization: Bearer <session token>' })
    return null
  }
  const token = auth.slice(7)
  const sb = getSupabaseConfig()
  // Validate the token via Supabase Auth REST.
  const userRes = await fetch(`${sb.url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: sb.serviceKey },
  })
  if (!userRes.ok) {
    res.status(401).json({ error: 'Invalid session' })
    return null
  }
  const user = await userRes.json() as { email?: string }
  if (!user.email) {
    res.status(401).json({ error: 'Invalid session' })
    return null
  }
  // Must be an admin per app_users.
  const lookup = await fetch(
    `${sb.url}/rest/v1/app_users?select=role,label&google_email=eq.${encodeURIComponent(user.email.toLowerCase())}&limit=1`,
    { headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` } },
  )
  if (!lookup.ok) {
    res.status(403).json({ error: 'Authorization lookup failed' })
    return null
  }
  const rows = await lookup.json() as Array<{ role?: string; label?: string }>
  const row = rows[0]
  if (!row || row.role !== 'admin') {
    res.status(403).json({ error: 'Admin role required' })
    return null
  }
  return { email: user.email, label: row.label ?? 'admin' }
}

// 32-byte random nonce, hex-encoded → 64 chars. Used as both the OAuth
// `state` query param and the cookie value. Cookie is HttpOnly+Secure+
// SameSite=Lax so it survives the cross-site Intuit→Tendwell redirect but
// can't be set by an attacker on a different origin.
export function generateState(): string {
  return randomBytes(32).toString('hex')
}

export function buildStateCookie(state: string): string {
  const parts = [
    `${STATE_COOKIE}=${state}`,
    'Path=/api/qbo',
    `Max-Age=${STATE_TTL_SECONDS}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ]
  return parts.join('; ')
}

export function buildClearCookie(): string {
  return `${STATE_COOKIE}=; Path=/api/qbo; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
}

// Pull the cookie out of req.headers.cookie. Vercel doesn't auto-parse.
export function readStateCookie(req: VercelRequest): string | null {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const pair of raw.split(/;\s*/)) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    if (pair.slice(0, eq) === STATE_COOKIE) return pair.slice(eq + 1)
  }
  return null
}

// ─── QBO API token helpers (shared by financials.ts + the classes cron) ─────
// Tokens live in app_settings.qbo_tokens (written by callback.ts) and are
// refreshed against Intuit's OAuth endpoint when within 5 min of expiry.

export const qboApiBase = (env: string): string =>
  env === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com'

export interface QboTokens {
  access_token: string
  refresh_token: string
  realm_id: string
  expires_at: number
}

export async function getQboTokens(supabase: any): Promise<QboTokens | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'qbo_tokens').single()
  if (!data?.value) return null
  return typeof data.value === 'string' ? JSON.parse(data.value) : data.value
}

export async function refreshQboTokens(supabase: any, tokens: QboTokens): Promise<QboTokens> {
  const clientId = process.env.QBO_CLIENT_ID
  const clientSecret = process.env.QBO_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('QBO credentials missing')

  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
  })
  if (!res.ok) throw new Error('Token refresh failed — reconnect QuickBooks')
  const newTokens = await res.json() as { access_token: string; refresh_token: string; expires_in?: number }

  const updated: QboTokens = {
    access_token: newTokens.access_token,
    refresh_token: newTokens.refresh_token,
    expires_at: Date.now() + (newTokens.expires_in || 3600) * 1000,
    realm_id: tokens.realm_id,
  }
  await supabase.from('app_settings').upsert({ key: 'qbo_tokens', value: JSON.stringify(updated) }, { onConflict: 'key' })
  return updated
}

// Get tokens, refreshing if they expire within 5 minutes. Null = not connected.
export async function getFreshQboTokens(supabase: any): Promise<QboTokens | null> {
  let tokens = await getQboTokens(supabase)
  if (!tokens) return null
  if (Date.now() > tokens.expires_at - 300_000) tokens = await refreshQboTokens(supabase, tokens)
  return tokens
}

// Constant-time compare so a millisecond-timing attacker can't peel back
// the cookie value byte-by-byte. We hash both sides to handle length mismatch.
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}
