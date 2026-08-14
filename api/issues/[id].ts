// /api/issues/:id
// GET   → fetch a single issue by uuid
// PATCH → partial-update writable fields on a single issue
//
// Auth: x-api-key header (or Authorization: Bearer <key>) matching
// ISSUES_API_KEY env var.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  API_SCOPES,
  ISSUES_TABLE,
  jsonError,
  requireApiKey,
  sanitizeIssueBody,
  sbFetch,
  validateIssuePayload,
} from './_lib.js'
import { getSupabaseConfig } from '../notify/_lib.js'
import { ensureIssueSpanish, ISSUE_TRANSLATABLE_FIELDS, withSoftBudget } from './_translate-core.js'

// Loose UUID v4-ish check — same length/dash positions as Postgres uuid.
// Strict-enough to reject obviously bad inputs without coupling to a regex
// library; the DB still rejects malformed values authoritatively.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Scope required per operation: fetching reads, PATCH/PUT updates.
  // Accept the uniform view/edit scopes plus the legacy granular aliases.
  const scope =
    req.method === 'GET' ? [API_SCOPES.ISSUES_VIEW, API_SCOPES.ISSUES_READ]
    : req.method === 'PATCH' || req.method === 'PUT' ? [API_SCOPES.ISSUES_EDIT, API_SCOPES.ISSUES_UPDATE]
    : null
  if (scope) {
    if (!(await requireApiKey(req, res, scope))) return
  }

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    jsonError(res, 400, 'id must be a uuid')
    return
  }

  if (req.method === 'GET') {
    try {
      const rows = await sbFetch<unknown[]>(`${ISSUES_TABLE}?id=eq.${id}&limit=1`)
      const row = Array.isArray(rows) ? rows[0] : null
      if (!row) {
        jsonError(res, 404, 'Issue not found')
        return
      }
      res.status(200).json({ data: row })
    } catch (e) {
      const err = e as Error & { status?: number; body?: string }
      jsonError(res, err.status && err.status >= 400 && err.status < 600 ? err.status : 500, err.message || 'Fetch failed')
    }
    return
  }

  if (req.method === 'PATCH' || req.method === 'PUT') {
    const payload = sanitizeIssueBody(req.body)
    if (Object.keys(payload).length === 0) {
      jsonError(res, 400, 'No writable fields in body')
      return
    }
    const invalid = validateIssuePayload(payload)
    if (invalid) {
      jsonError(res, 400, invalid)
      return
    }
    // Bump updated_at server-side so the in-app UI's "last modified" sort
    // reflects this edit, regardless of whether the bot supplied it.
    ;(payload as Record<string, unknown>).updated_at = new Date().toISOString()

    try {
      const updated = await sbFetch<unknown[]>(`${ISSUES_TABLE}?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      const row = Array.isArray(updated) ? updated[0] : null
      if (!row) {
        jsonError(res, 404, 'Issue not found')
        return
      }
      // Re-warm the ES cache when a translatable field changed — the new
      // content hash is automatically a cache miss, so this is a fresh
      // translation, not a no-op. Soft-budgeted; never fails the update.
      const touchedTranslatable = Object.keys(payload).some(k => ISSUE_TRANSLATABLE_FIELDS.has(k))
      if (touchedTranslatable) {
        await withSoftBudget(() => ensureIssueSpanish(getSupabaseConfig(), id), 10_000)
      }
      res.status(200).json({ data: row })
    } catch (e) {
      const err = e as Error & { status?: number; body?: string }
      jsonError(res, err.status && err.status >= 400 && err.status < 600 ? err.status : 500, err.message || 'Update failed')
    }
    return
  }

  res.setHeader('Allow', 'GET, PATCH, PUT')
  jsonError(res, 405, `Method ${req.method} not allowed`)
}
