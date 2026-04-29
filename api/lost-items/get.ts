import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireLostItemsAccess, havenFetch, HavenError } from './_lib.js'

// GET /api/lost-items/get?id=<uuid-or-case_number>
// Proxies to Haven's GET /api/lost-items/:id. Haven accepts either the case
// UUID or the human-readable case_number (format `LI-001023`).

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireLostItemsAccess(req, res, ['GET'])
  if (!ctx) return

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : ''
  if (!id) {
    res.status(400).json({ error: 'id is required (UUID or case_number like LI-001023)' })
    return
  }

  const path = `/api/lost-items/${encodeURIComponent(id)}`
  try {
    // Haven returns { case: LostItemCase }. Unwrap so the client gets the
    // case object directly (matches the page's React Query expectation).
    const data = await havenFetch<{ case?: unknown } | unknown>(ctx.haven, path, { method: 'GET' })
    const out = (data && typeof data === 'object' && 'case' in (data as any)) ? (data as any).case : data
    res.status(200).json(out)
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
