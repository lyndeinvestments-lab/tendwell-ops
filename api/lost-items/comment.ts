import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireLostItemsAccess, havenFetch, HavenError, tendwellActorHeader } from './_lib.js'

// POST /api/lost-items/comment?id=<uuid|case_number>
// Proxies to Haven POST /api/lost-items/:id?action=comment.
// Body: { body: string }
// Auth: Tendwell session token + lost-items view + admin/operations role.

const WRITABLE_ROLES = new Set(['admin', 'operations'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireLostItemsAccess(req, res, ['POST'])
  if (!ctx) return
  if (!WRITABLE_ROLES.has(ctx.user.role)) {
    res.status(403).json({ error: 'Read-only role cannot comment' })
    return
  }

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : ''
  if (!id) {
    res.status(400).json({ error: 'Missing id query param (UUID or case number)' })
    return
  }

  let body: Record<string, unknown>
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) {
    res.status(400).json({ error: 'body is required' })
    return
  }

  try {
    const data = await havenFetch<unknown>(
      ctx.haven,
      `/api/lost-items/${encodeURIComponent(id)}?action=comment`,
      {
        method: 'POST',
        headers: tendwellActorHeader(ctx.user),
        body: JSON.stringify({ body: text }),
      },
    )
    res.status(201).json(data)
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
