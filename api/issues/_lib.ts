// Shared helpers for the public Issues API (api/issues/*.ts).
// API-key authenticated endpoints that proxy to the `cleaning_issues`
// Supabase table on behalf of external bots / integrations.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHash, timingSafeEqual } from 'node:crypto'

export const ISSUES_TABLE = 'cleaning_issues'

// Fields a client may set on insert/update. Anything outside this list is
// dropped silently (no surprise writes to created_at, id, etc.).
export const WRITABLE_FIELDS = new Set([
  'report_date',
  'property_id',
  'property_name',
  'category',
  'last_touch',
  'details',
  'assessment',
  'resolution',
  'coverage',
  'status',
  'reference',
  'remarks',
  'created_by',
  'slack_link',
])

// Filters allowed on the list endpoint. Mirrors how the in-app /issues page
// queries — keeps the surface small and predictable.
export const LIST_FILTERS = new Set([
  'status',
  'category',
  'property_id',
  'property_name',
  'since',         // report_date >= since (YYYY-MM-DD)
  'until',         // report_date <= until (YYYY-MM-DD)
  'search',        // ilike on details + property_name
])

interface SupabaseConfig {
  url: string
  serviceKey: string
}

function getSupabase(): SupabaseConfig {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase config missing')
  return { url, serviceKey }
}

// Constant-time API-key comparison so timing attacks can't leak the key
// byte-by-byte. Hash both sides first to handle length differences safely.
export function requireApiKey(req: VercelRequest, res: VercelResponse): boolean {
  const expected = process.env.ISSUES_API_KEY
  if (!expected) {
    res.status(503).json({ error: 'ISSUES_API_KEY not configured on server' })
    return false
  }
  const provided =
    (req.headers['x-api-key'] as string | undefined) ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined)
  if (!provided) {
    res.status(401).json({ error: 'Missing API key. Send header x-api-key: <key> or Authorization: Bearer <key>' })
    return false
  }
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  if (!timingSafeEqual(a, b)) {
    res.status(403).json({ error: 'Invalid API key' })
    return false
  }
  return true
}

// Thin wrapper around Supabase REST. Returns parsed JSON or throws.
export async function sbFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const sb = getSupabase()
  const r = await fetch(`${sb.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: sb.serviceKey,
      Authorization: `Bearer ${sb.serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init?.headers || {}),
    },
  })
  if (!r.ok) {
    const txt = await r.text()
    const err = new Error(`Supabase ${path}: ${r.status} ${txt}`) as Error & { status: number; body: string }
    err.status = r.status
    err.body = txt
    throw err
  }
  return r.json() as Promise<T>
}

// Filter the request body down to writable fields and coerce types where
// the column expects something specific (property_id is bigint, empty
// strings become null so blank inputs don't poison the row).
export function sanitizeIssueBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!WRITABLE_FIELDS.has(k)) continue
    if (k === 'property_id') {
      if (v == null || v === '') { out[k] = null; continue }
      const n = typeof v === 'number' ? v : parseInt(String(v), 10)
      out[k] = Number.isFinite(n) ? n : null
      continue
    }
    out[k] = v === '' ? null : v
  }
  return out
}

// Build a PostgREST querystring from the safe-listed `LIST_FILTERS`.
// `search` becomes an OR across details + property_name. Date filters map
// to gte/lte on report_date. Anything else is an `eq.` exact match.
export function buildListQuery(query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams()
  for (const [k, raw] of Object.entries(query)) {
    if (!LIST_FILTERS.has(k)) continue
    const v = Array.isArray(raw) ? raw[0] : raw
    if (typeof v !== 'string' || v.trim() === '') continue
    if (k === 'since') {
      params.append('report_date', `gte.${v}`)
    } else if (k === 'until') {
      params.append('report_date', `lte.${v}`)
    } else if (k === 'search') {
      // Escape PostgREST `,` and `*` characters in the user input
      const safe = v.replace(/[,*]/g, ' ')
      params.append('or', `(details.ilike.*${safe}*,property_name.ilike.*${safe}*)`)
    } else {
      params.append(k, `eq.${v}`)
    }
  }
  // Sort by report_date desc, then created_at desc — same order as the UI.
  params.append('order', 'report_date.desc,created_at.desc')
  return params.toString()
}

// Standard JSON error response with a stable shape so bots can branch on it.
export function jsonError(res: VercelResponse, status: number, message: string, extra?: Record<string, unknown>): void {
  res.status(status).json({ error: message, ...(extra || {}) })
}
