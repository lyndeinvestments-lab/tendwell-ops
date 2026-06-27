import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireReviewsAccess, havenFetch, HavenError } from './_lib.js'

// GET /api/reviews/list?type=&departureDateStart=&departureDateEnd=&limit=&offset=
// Proxies to Haven's GET /api/reviews, forwarding allowed params.
// Haven returns { reviews: HostawayReview[], count, ratingScale: 10 } — passed
// through unchanged so the client can convert the 0–10 ratings to 5-star and
// filter client-side (Hostaway ignores the departure-date window server-side).

const ALLOWED_PARAMS = new Set([
  'type',
  'departureDateStart',
  'departureDateEnd',
  'limit',
  'offset',
])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireReviewsAccess(req, res, ['GET'])
  if (!ctx) return

  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(req.query)) {
    if (!ALLOWED_PARAMS.has(k)) continue
    if (typeof v === 'string' && v.trim() !== '') params.set(k, v)
  }
  // Default to the full guest-to-host feed; the client filters/searches.
  if (!params.has('type')) params.set('type', 'guest-to-host')
  if (!params.has('limit')) params.set('limit', '500')

  const path = `/api/reviews?${params.toString()}`

  try {
    const data = await havenFetch<{
      reviews?: unknown[]
      count?: number
      ratingScale?: number
    }>(ctx.haven, path, { method: 'GET' })
    res.status(200).json({
      reviews: Array.isArray(data?.reviews) ? data.reviews : [],
      count: typeof data?.count === 'number' ? data.count : 0,
      ratingScale: typeof data?.ratingScale === 'number' ? data.ratingScale : 10,
    })
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
