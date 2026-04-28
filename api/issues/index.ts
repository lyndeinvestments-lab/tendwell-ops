// /api/issues
// GET  → list issues (filterable via query params)
// POST → create a new issue
//
// Auth: x-api-key header (or Authorization: Bearer <key>) matching
// ISSUES_API_KEY env var. Service-role Supabase access is server-side only;
// callers never see the Supabase key.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  ISSUES_TABLE,
  buildListQuery,
  jsonError,
  requireApiKey,
  sanitizeIssueBody,
  sbFetch,
} from './_lib'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireApiKey(req, res)) return

  if (req.method === 'GET') {
    try {
      const qs = buildListQuery(req.query as Record<string, string | string[] | undefined>)
      const limitRaw = req.query.limit
      const limitNum = Math.min(
        Math.max(parseInt(typeof limitRaw === 'string' ? limitRaw : '', 10) || DEFAULT_LIMIT, 1),
        MAX_LIMIT,
      )
      const path = `${ISSUES_TABLE}?${qs}&limit=${limitNum}`
      const data = await sbFetch<unknown[]>(path)
      res.status(200).json({ data, count: Array.isArray(data) ? data.length : 0 })
    } catch (e) {
      const err = e as Error & { status?: number; body?: string }
      jsonError(res, err.status && err.status >= 400 && err.status < 600 ? err.status : 500, err.message || 'List failed')
    }
    return
  }

  if (req.method === 'POST') {
    const payload = sanitizeIssueBody(req.body)
    // Required columns from the table definition. Default report_date to
    // today (UTC) so bots don't have to compute it themselves; status
    // defaults to "Open" because that's the only sensible state for a new
    // issue. Category has no sensible default — bots must pass one.
    if (!payload.category || typeof payload.category !== 'string') {
      jsonError(res, 400, 'category is required (e.g. "Damage", "Missing Item", "Maintenance")')
      return
    }
    if (!payload.report_date) payload.report_date = new Date().toISOString().slice(0, 10)
    if (!payload.status) payload.status = 'Open'
    if (!payload.created_by) payload.created_by = 'api'
    try {
      const inserted = await sbFetch<unknown[]>(ISSUES_TABLE, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const row = Array.isArray(inserted) ? inserted[0] : inserted
      res.status(201).json({ data: row })
    } catch (e) {
      const err = e as Error & { status?: number; body?: string }
      jsonError(res, err.status && err.status >= 400 && err.status < 600 ? err.status : 500, err.message || 'Create failed')
    }
    return
  }

  res.setHeader('Allow', 'GET, POST')
  jsonError(res, 405, `Method ${req.method} not allowed`)
}
