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
  'issue_type',
  'priority',
  'due_date',
])

// Enum vocabularies enforced by DB CHECK constraints (20260717 migration).
// Validated here too so bots get a specific 400 instead of an opaque 500.
export const VALID_ISSUE_TYPES = new Set(['needs_attention', 'guest_feedback'])
export const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent'])
export const VALID_STATUSES = new Set(['Needs Attention', 'In Progress', 'Completed'])

// Returns an error message, or null when the payload is valid.
export function validateIssuePayload(payload: Record<string, unknown>): string | null {
  if (payload.issue_type !== undefined && !VALID_ISSUE_TYPES.has(String(payload.issue_type)))
    return `issue_type must be one of: ${[...VALID_ISSUE_TYPES].join(', ')}`
  if (payload.priority !== undefined && payload.priority !== null && !VALID_PRIORITIES.has(String(payload.priority)))
    return `priority must be one of: ${[...VALID_PRIORITIES].join(', ')}`
  if (payload.status !== undefined && payload.status !== null && !VALID_STATUSES.has(String(payload.status)))
    return `status must be one of: ${[...VALID_STATUSES].join(', ')}`
  if (payload.due_date !== undefined && payload.due_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.due_date)))
    return 'due_date must be YYYY-MM-DD'
  return null
}

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
  'issue_type',    // needs_attention | guest_feedback
  'priority',      // low | normal | high | urgent
  'due_before',    // due_date <= (YYYY-MM-DD) — overdue queries
  'due_after',     // due_date >= (YYYY-MM-DD)
  'acknowledged',  // true | false — guest-feedback ack state
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

// Canonical scope vocabulary for the Issues endpoints. Scopes are
// `<area>:<operation>`. The uniform model (shared/api-areas.ts) uses
// view/edit; the older create/read/update names are kept as accepted aliases
// so any early-adopter key keeps working.
export const API_SCOPES = {
  ISSUES_VIEW: 'issues:view',
  ISSUES_EDIT: 'issues:edit',
  ISSUES_CREATE: 'issues:create', // legacy alias
  ISSUES_READ: 'issues:read',     // legacy alias
  ISSUES_UPDATE: 'issues:update', // legacy alias
} as const
export type ApiScope = (typeof API_SCOPES)[keyof typeof API_SCOPES]

interface ApiKeyRow {
  id: string
  name: string
  scopes: string[] | null
  revoked_at: string | null
  expires_at: string | null
}

// Context about the authenticated key, returned to callers so writes can be
// attributed in the audit log. `id` is null and `scopes` is null for the
// legacy full-access env key.
export interface ApiKeyContext {
  id: string | null
  name: string
  scopes: string[] | null
}

export interface AuthResult {
  ok: boolean
  status?: number
  error?: string
  key?: ApiKeyContext
}

function extractKey(req: VercelRequest): string | undefined {
  return (
    (req.headers['x-api-key'] as string | undefined) ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined)
  )
}

// Constant-time compare of two secrets by SHA-256 digest (handles length
// differences safely and avoids leaking the key byte-by-byte via timing).
function keysMatch(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest()
  const db = createHash('sha256').update(b).digest()
  return timingSafeEqual(da, db)
}

// Authenticate the request and authorize it against `requiredScopes` (any-of).
//
// Two credential paths, checked in order:
//   1. Legacy env key (`ISSUES_API_KEY`) — full access. Kept so pre-existing
//      bots don't break. Optional: if unset we rely solely on DB-backed keys.
//   2. DB-backed keys (`api_keys` table) — minted in Settings → API Keys with
//      an explicit scope allow-list. The presented key is hashed and looked up;
//      the request is allowed only if the key is active, unexpired, and holds
//      at least one of `requiredScopes`.
//
// Returns a structured result (never writes to the response) so both the
// issues endpoints (via requireApiKey) and the generic data gateway (which
// needs the key context for audit logging) can share it.
export async function authenticateApiKey(
  req: VercelRequest,
  requiredScopes: string | string[],
): Promise<AuthResult> {
  const needed = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes]
  const provided = extractKey(req)
  if (!provided) {
    return { ok: false, status: 401, error: 'Missing API key. Send header x-api-key: <key> or Authorization: Bearer <key>' }
  }

  // Path 1: legacy full-access env key.
  const legacy = process.env.ISSUES_API_KEY
  if (legacy && keysMatch(provided, legacy)) {
    return { ok: true, key: { id: null, name: 'legacy-env', scopes: null } }
  }

  // Path 2: DB-backed scoped key.
  const hash = createHash('sha256').update(provided).digest('hex')
  let row: ApiKeyRow | undefined
  try {
    const rows = await sbFetch<ApiKeyRow[]>(
      `api_keys?key_hash=eq.${hash}&select=id,name,scopes,revoked_at,expires_at&limit=1`,
    )
    row = Array.isArray(rows) ? rows[0] : undefined
  } catch (e) {
    console.error('api_keys lookup failed:', e)
    return { ok: false, status: 500, error: 'Key verification failed' }
  }

  if (!row || row.revoked_at) return { ok: false, status: 403, error: 'Invalid API key' }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 403, error: 'API key expired' }
  }
  const scopes = Array.isArray(row.scopes) ? row.scopes : []
  if (!needed.some(s => scopes.includes(s))) {
    return { ok: false, status: 403, error: `API key is not authorized for this operation (requires one of: ${needed.join(', ')})` }
  }

  // Best-effort "last used" bump — never fail the request over it.
  try {
    await sbFetch(`api_keys?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ last_used_at: new Date().toISOString() }),
    })
  } catch (e) {
    console.error('api_keys last_used_at bump failed (non-fatal):', e)
  }
  return { ok: true, key: { id: row.id, name: row.name, scopes } }
}

// Response-writing wrapper: authenticate, and on failure write the error
// response. Callers keep the `if (!(await requireApiKey(...))) return` shape.
export async function requireApiKey(
  req: VercelRequest,
  res: VercelResponse,
  requiredScope: string | string[],
): Promise<boolean> {
  const result = await authenticateApiKey(req, requiredScope)
  if (!result.ok) {
    res.status(result.status ?? 403).json({ error: result.error ?? 'Forbidden' })
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
  // A successful write can legitimately have no body. `Prefer: return=minimal`
  // makes PostgREST answer 204 No Content, and DELETE does the same — calling
  // r.json() on that throws SyntaxError even though the write succeeded, and
  // r.ok is true for 204 so the check above does not catch it. Callers that
  // asked for no representation get undefined, which is what they expect.
  if (r.status === 204) return undefined as T
  const body = await r.text()
  if (!body) return undefined as T
  return JSON.parse(body) as T
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
    } else if (k === 'due_before') {
      params.append('due_date', `lte.${v}`)
    } else if (k === 'due_after') {
      params.append('due_date', `gte.${v}`)
    } else if (k === 'acknowledged') {
      params.append('acknowledged_at', v === 'true' ? 'not.is.null' : 'is.null')
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
