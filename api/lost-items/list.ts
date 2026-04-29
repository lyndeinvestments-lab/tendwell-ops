import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireLostItemsAccess, havenFetch, HavenError } from './_lib.js'

// GET /api/lost-items/list?status=&search=&assigned_to=&overdue=
// Proxies to Haven's GET /api/lost-items, forwarding allowed filters.
// Filters mirror Haven's LostItemFilter shape (lib/lost-items/types.ts).

const ALLOWED_FILTERS = new Set(['status', 'search', 'property_id', 'assigned_to', 'overdue'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireLostItemsAccess(req, res, ['GET'])
  if (!ctx) return

  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(req.query)) {
    if (!ALLOWED_FILTERS.has(k)) continue
    if (typeof v === 'string' && v.trim() !== '') params.set(k, v)
  }
  const qs = params.toString()
  const path = `/api/lost-items${qs ? `?${qs}` : ''}`

  try {
    // Haven returns { cases: LostItemCase[] }. Unwrap so the client gets a
    // bare array — that matches the frontend's React Query type and avoids
    // 'filter is not a function' errors in the page.
    const data = await havenFetch<{ cases?: unknown[] } | unknown[]>(ctx.haven, path, { method: 'GET' })
    const cases = Array.isArray(data) ? data : ((data && (data as any).cases) ?? [])
    res.status(200).json(cases)
  } catch (e) {
    if (e instanceof HavenError) {
      res.status(e.status >= 400 && e.status < 600 ? e.status : 502).json({
        error: 'Haven upstream error',
        status: e.status,
        body: e.body.slice(0, 500),
      })
      return
    }
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' })
  }
}
