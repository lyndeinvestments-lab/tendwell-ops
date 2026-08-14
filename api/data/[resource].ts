// /api/data/:resource — generic, scope-gated data gateway.
//
// One endpoint for every area in the shared catalogue (shared/api-areas.ts):
//   GET   /api/data/:resource            → list (filters: ?col=value, ?order=, ?limit=)
//   GET   /api/data/:resource?id=<id>    → fetch one by primary key
//   POST  /api/data/:resource            → create              (rw areas only)
//   PATCH /api/data/:resource?id=<id>    → update by primary key (rw areas only)
//
// Auth: x-api-key header (or Authorization: Bearer <key>). Reads require the
// area's `<key>:view` scope; writes require `<key>:edit`. Sensitive areas
// (users, api keys, owners, agreements, settings) are absent from the catalogue
// and therefore return 404 here — they can never be reached with an API key.
//
// Supabase service-role access is server-side only; callers never see it.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authenticateApiKey, jsonError, sbFetch } from '../issues/_lib.js'
import { findArea, scopeEdit, scopeView } from '../../shared/api-areas.js'
import { buildListQuery, clampLimit, logApiWrite, sanitizeWrite } from './_lib.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const resource = Array.isArray(req.query.resource) ? req.query.resource[0] : req.query.resource
  const area = findArea(resource)
  if (!area) {
    jsonError(res, 404, `Unknown resource "${resource ?? ''}". See Settings → API Keys for the available areas.`)
    return
  }

  const method = req.method || 'GET'
  const isWrite = method === 'POST' || method === 'PATCH' || method === 'PUT'

  // Authorize before touching the database.
  const requiredScope = isWrite ? scopeEdit(area.key) : scopeView(area.key)
  const auth = await authenticateApiKey(req, requiredScope)
  if (!auth.ok) {
    jsonError(res, auth.status ?? 403, auth.error ?? 'Forbidden')
    return
  }

  // A scoped key could hold `<area>:edit` in theory, but read-only areas expose
  // no write path — reject with 405 rather than attempting a write on a view.
  if (isWrite && area.access !== 'rw') {
    res.setHeader('Allow', 'GET')
    jsonError(res, 405, `"${area.key}" is read-only`)
    return
  }

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id

  try {
    if (method === 'GET') {
      if (id) {
        const rows = await sbFetch<unknown[]>(`${area.table}?${area.pk}=eq.${encodeURIComponent(id)}&limit=1`)
        const row = Array.isArray(rows) ? rows[0] : null
        if (!row) {
          jsonError(res, 404, 'Not found')
          return
        }
        res.status(200).json({ data: row })
        return
      }
      const qs = buildListQuery(req.query as Record<string, string | string[] | undefined>)
      const limit = clampLimit(req.query.limit)
      const path = `${area.table}?${qs ? `${qs}&` : ''}limit=${limit}`
      const data = await sbFetch<unknown[]>(path)
      res.status(200).json({ data, count: Array.isArray(data) ? data.length : 0 })
      return
    }

    if (method === 'POST') {
      const payload = sanitizeWrite(req.body, area)
      if (Object.keys(payload).length === 0) {
        jsonError(res, 400, 'No writable fields in body')
        return
      }
      const inserted = await sbFetch<unknown[]>(area.table, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const row = Array.isArray(inserted) ? inserted[0] : inserted
      await logApiWrite(area, 'create', row, auth.key)
      res.status(201).json({ data: row })
      return
    }

    if (method === 'PATCH' || method === 'PUT') {
      if (!id) {
        jsonError(res, 400, 'id query param required for updates (e.g. ?id=<id>)')
        return
      }
      const payload = sanitizeWrite(req.body, area)
      if (Object.keys(payload).length === 0) {
        jsonError(res, 400, 'No writable fields in body')
        return
      }
      const updated = await sbFetch<unknown[]>(`${area.table}?${area.pk}=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      const row = Array.isArray(updated) ? updated[0] : null
      if (!row) {
        jsonError(res, 404, 'Not found')
        return
      }
      await logApiWrite(area, 'update', row, auth.key)
      res.status(200).json({ data: row })
      return
    }

    res.setHeader('Allow', area.access === 'rw' ? 'GET, POST, PATCH' : 'GET')
    jsonError(res, 405, `Method ${method} not allowed`)
  } catch (e) {
    const err = e as Error & { status?: number; body?: string }
    jsonError(res, err.status && err.status >= 400 && err.status < 600 ? err.status : 500, err.message || 'Request failed')
  }
}
