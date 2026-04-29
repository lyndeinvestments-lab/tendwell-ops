import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireLostItemsAccess, havenFetch, HavenError, tendwellActorHeader } from './_lib.js'

// POST /api/lost-items/create
// Proxies to Haven POST /api/lost-items.
// Body: CreateLostItemInput JSON (item_description required).
// Auth: Tendwell session token + lost-items view + admin/operations role.
//
// Stamps source='api', external_source='tendwell' so Haven knows the
// origin and can dedupe on (external_source, external_id) for retries.

const WRITABLE_ROLES = new Set(['admin', 'operations'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireLostItemsAccess(req, res, ['POST'])
  if (!ctx) return
  if (!WRITABLE_ROLES.has(ctx.user.role)) {
    res.status(403).json({ error: 'Read-only role cannot create cases' })
    return
  }

  let body: Record<string, unknown>
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  if (!body.item_description || typeof body.item_description !== 'string' || !body.item_description.trim()) {
    res.status(400).json({ error: 'item_description is required' })
    return
  }

  const payload = {
    ...body,
    source: 'api',
    external_source: 'tendwell',
    external_id: typeof body.external_id === 'string' ? body.external_id : `tendwell:${Date.now()}:${ctx.user.id}`,
  }

  try {
    const data = await havenFetch<unknown>(ctx.haven, '/api/lost-items', {
      method: 'POST',
      headers: tendwellActorHeader(ctx.user),
      body: JSON.stringify(payload),
    })
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
