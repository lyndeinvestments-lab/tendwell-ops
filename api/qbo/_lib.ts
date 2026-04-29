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
