// Helpers for the generic scoped data gateway (api/data/[resource].ts).
// Reuses the API-key verification + Supabase REST wrapper from the issues lib.

import { sbFetch } from '../issues/_lib.js'
import type { ApiKeyContext } from '../issues/_lib.js'
import type { ApiArea } from '../../shared/api-areas.js'

// Columns a client may never set on a write (in addition to the area's PK,
// which is stripped separately). Keeps immutable/audit and trigger-owned
// columns server-owned — an API-key write must not be able to forge
// timestamps/attribution that staff and other tables treat as trustworthy
// audit trail (e.g. backdating `updated_at` to suppress the issues
// catch-up feed's is_unread computation, or forging `acknowledged_by`).
const WRITE_DENYLIST = new Set([
  'created_at',
  'updated_at',
  'acknowledged_at',
  'acknowledged_by',
  'completed_at',
  'share_token',
  'resolved_at',
  'resolved_by',
  'approved_at',
  'approved_by',
  'last_used_at',
  'revoked_at',
  'source_file_sha256',
])

// Filter a write body: drop the PK and denylisted columns, coerce '' → null so
// blank inputs don't poison a row. Unknown columns are left in and rejected by
// PostgREST with a clear 400 (no silent success).
export function sanitizeWrite(body: unknown, area: ApiArea): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (k === area.pk) continue
    if (WRITE_DENYLIST.has(k)) continue
    out[k] = v === '' ? null : v
  }
  return out
}

const RESERVED_QUERY = new Set(['resource', 'id', 'limit', 'order', 'select', 'apikey', 'api_key'])
const COLUMN_RE = /^[a-z_][a-z0-9_]*$/
const ORDER_RE = /^[a-z_][a-z0-9_]*(\.(asc|desc))?$/

// Build a PostgREST querystring for a list request. Any `column=value` pair
// (column name sanitized to a plain identifier) becomes an exact `eq.` match;
// `order` is passed through when it looks like `col` or `col.asc|desc`.
// Everything else is ignored, so no raw PostgREST operators leak through.
export function buildListQuery(query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams()
  for (const [k, raw] of Object.entries(query)) {
    if (RESERVED_QUERY.has(k) || !COLUMN_RE.test(k)) continue
    const v = Array.isArray(raw) ? raw[0] : raw
    if (typeof v !== 'string' || v === '') continue
    params.append(k, `eq.${v}`)
  }
  const orderRaw = query.order
  const order = Array.isArray(orderRaw) ? orderRaw[0] : orderRaw
  if (typeof order === 'string' && ORDER_RE.test(order)) params.append('order', order)
  return params.toString()
}

export function clampLimit(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw
  const n = parseInt(typeof v === 'string' ? v : '', 10)
  if (!Number.isFinite(n)) return 100
  return Math.min(Math.max(n, 1), 500)
}

// Best-effort audit-log row for an API-key write. Never throws — a logging
// failure must not fail the write. Attributes to the key's name so staff can
// see which integration made the change on the Activity page.
export async function logApiWrite(
  area: ApiArea,
  action: 'create' | 'update',
  row: unknown,
  key: ApiKeyContext | undefined,
): Promise<void> {
  try {
    const id = row && typeof row === 'object' ? (row as Record<string, unknown>)[area.pk] ?? null : null
    await sbFetch('activity_log', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        entity_type: 'other',
        entity_id: id != null ? String(id) : null,
        entity_name: area.key,
        action,
        changed_by: `API: ${key?.name ?? 'unknown'}`,
        metadata: { resource: area.key, table: area.table, via: 'api_key' },
      }),
    })
  } catch (e) {
    console.error('logApiWrite failed (non-fatal):', e)
  }
}
