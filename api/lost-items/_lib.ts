// Haven-OS Lost Items proxy helpers — server-side only.
// HAVEN_LOST_ITEMS_API_KEY never reaches the browser.
//
// Haven-OS REST API:
//   GET    /api/lost-items                  (list + filters)
//   POST   /api/lost-items                  (create / upsert by external_id)
//   GET    /api/lost-items/:id              (UUID or case_number)
//   PATCH  /api/lost-items/:id              (update)
//   POST   /api/lost-items/:id?action=comment
// Auth header: x-haven-api-key
//
// v1 (read-only): only GET endpoints proxied. Writes will land in Phase 2
// when we add the DB mirror + outbound publisher + inbound webhook.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export class HavenError extends Error {
  status: number
  body: string
  constructor(status: number, body: string) {
    super(`Haven API ${status}: ${body.slice(0, 200)}`)
    this.status = status
    this.body = body
  }
}

function getHavenConfig(): { baseUrl: string; key: string } | null {
  const baseUrl = process.env.HAVEN_API_BASE_URL
  const key = process.env.HAVEN_LOST_ITEMS_API_KEY
  if (!baseUrl || !key) return null
  return { baseUrl: baseUrl.replace(/\/+$/, ''), key }
}

let _supabaseAdmin: SupabaseClient | null = null
function getSupabaseAdmin(): SupabaseClient | null {
  if (_supabaseAdmin) return _supabaseAdmin
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  _supabaseAdmin = createClient(url, key)
  return _supabaseAdmin
}

// Public alias — assignment endpoints (assign / assignments) need direct
// Supabase access since they read/write Tendwell-local rows, not Haven.
export function getSupabaseAdminForLostItems(): SupabaseClient | null {
  return getSupabaseAdmin()
}

const LOST_ITEMS_VIEW = 'lost-items'

interface ResolvedUser {
  id: string
  role: string
  label: string
  resolvedViews: string[]
  isAdmin: boolean
}

// View-default fallback when an app_users row has no `custom_views` set.
// Mirrors the role gating used elsewhere — admin + operations are the
// operational personas; viewer gets read-only access; cleaning is excluded.
const ROLE_DEFAULT_VIEWS: Record<string, string[]> = {
  admin: [LOST_ITEMS_VIEW],
  operations: [LOST_ITEMS_VIEW],
  viewer: [LOST_ITEMS_VIEW],
  cleaning: [],
}

async function resolveUser(supabase: SupabaseClient, token: string): Promise<ResolvedUser | null> {
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user?.email) return null
  const { data, error: dbError } = await supabase
    .from('app_users')
    .select('id, role, label, custom_views')
    .eq('google_email', user.email.toLowerCase())
    .single()
  if (dbError || !data) return null
  const role = (data.role as string) ?? 'viewer'
  const customViews = Array.isArray(data.custom_views) ? data.custom_views as string[] : []
  // custom_views, when present, replace the role default entirely (matches
  // the chatbot's auth shape so admins can scope individual users).
  const resolvedViews = customViews.length > 0 ? customViews : (ROLE_DEFAULT_VIEWS[role] ?? [])
  return {
    id: data.id,
    role,
    label: data.label ?? 'User',
    resolvedViews,
    isAdmin: role === 'admin',
  }
}

// Pulls the bearer token from the Authorization header only. The token used
// to also be accepted via ?token=, but query params leak into server/CDN
// access logs and browser history; the only caller (authFetch) sends the
// Authorization header.
function readToken(req: VercelRequest): string | null {
  const auth = req.headers.authorization
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7)
  return null
}

// Common request gate for Lost Items endpoints. Handles:
//   1. Method check
//   2. Tendwell session auth (token → app_users)
//   3. View permission (lost-items)
//   4. Haven config presence (env vars set)
// On failure, writes a JSON error response and returns null.
export async function requireLostItemsAccess(
  req: VercelRequest,
  res: VercelResponse,
  allowedMethods: string[] = ['GET'],
): Promise<{ user: ResolvedUser; haven: { baseUrl: string; key: string } } | null> {
  if (!allowedMethods.includes(req.method || '')) {
    res.status(405).json({ error: 'Method not allowed' })
    return null
  }
  const supabase = getSupabaseAdmin()
  if (!supabase) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return null
  }
  const haven = getHavenConfig()
  if (!haven) {
    res.status(503).json({
      error: 'Haven API not configured',
      hint: 'Set HAVEN_API_BASE_URL (e.g. https://haven-os.vercel.app) and HAVEN_LOST_ITEMS_API_KEY in Vercel env, then redeploy.',
    })
    return null
  }
  const token = readToken(req)
  if (!token) {
    res.status(401).json({ error: 'Missing token' })
    return null
  }
  let user: ResolvedUser | null
  try {
    user = await resolveUser(supabase, token)
  } catch {
    res.status(500).json({ error: 'Auth service unavailable' })
    return null
  }
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  if (!user.resolvedViews.includes(LOST_ITEMS_VIEW)) {
    res.status(403).json({ error: 'Your role does not have access to Lost Items' })
    return null
  }
  return { user, haven }
}

// Generic Haven fetch with shared auth + JSON parse. Throws HavenError on
// non-2xx so callers can surface a clean upstream status.
export async function havenFetch<T>(
  haven: { baseUrl: string; key: string },
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('http') ? path : `${haven.baseUrl}${path}`
  const r = await fetch(url, {
    ...init,
    headers: {
      'x-haven-api-key': haven.key,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await r.text()
  if (!r.ok) throw new HavenError(r.status, text)
  try {
    return text ? JSON.parse(text) as T : ({} as T)
  } catch {
    throw new HavenError(r.status, `Non-JSON response: ${text.slice(0, 200)}`)
  }
}

// Stamp proxied requests with an attribution label so when the Phase 2
// outbound publisher kicks in, audit timelines on Haven side can distinguish
// tendwell-ops users (Haven's `lost_item_events.actor_label` column).
export function tendwellActorHeader(user: ResolvedUser): Record<string, string> {
  return { 'x-haven-actor-label': `tendwell:${user.label}` }
}
