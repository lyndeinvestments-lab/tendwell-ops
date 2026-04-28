import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireLostItemsAccess, havenFetch, HavenError } from './_lib'

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
    const data = await havenFetch<unknown>(ctx.haven, path, { method: 'GET' })
    res.status(200).json(data)
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
