import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireLostItemsAccess, getSupabaseAdminForLostItems } from './_lib.js'

// POST /api/lost-items/assign
// Body: { case_id: uuid, user_id: number | null, notes?: string }
// Sets (or clears, when user_id is null) the local Tendwell assignment for
// a Haven case. Upserts on haven_case_id so reassigning is idempotent.
// Auth: lost-items view + admin/operations role.

const WRITABLE_ROLES = new Set(['admin', 'operations'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireLostItemsAccess(req, res, ['POST'])
  if (!ctx) return
  if (!WRITABLE_ROLES.has(ctx.user.role)) {
    res.status(403).json({ error: 'Read-only role cannot assign cases' })
    return
  }

  const supabase = getSupabaseAdminForLostItems()
  if (!supabase) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return
  }

  let body: Record<string, unknown>
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  const caseId = typeof body.case_id === 'string' ? body.case_id.trim() : ''
  if (!UUID_RE.test(caseId)) {
    res.status(400).json({ error: 'case_id must be a UUID' })
    return
  }

  const rawUserId = body.user_id
  let userId: number | null
  if (rawUserId === null || rawUserId === undefined || rawUserId === '') {
    userId = null
  } else if (typeof rawUserId === 'number' && Number.isInteger(rawUserId)) {
    userId = rawUserId
  } else if (typeof rawUserId === 'string' && /^\d+$/.test(rawUserId)) {
    userId = parseInt(rawUserId, 10)
  } else {
    res.status(400).json({ error: 'user_id must be an integer or null' })
    return
  }

  const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null
  const assignerId = typeof ctx.user.id === 'number' ? ctx.user.id : parseInt(String(ctx.user.id), 10)

  const { data, error } = await supabase
    .from('lost_item_assignments')
    .upsert(
      {
        haven_case_id: caseId,
        assigned_user_id: userId,
        assigned_by_user_id: Number.isFinite(assignerId) ? assignerId : null,
        notes,
      },
      { onConflict: 'haven_case_id' },
    )
    .select(`
      haven_case_id,
      assigned_user_id,
      assigned_by_user_id,
      assigned_at,
      updated_at,
      notes,
      assignee:app_users!lost_item_assignments_assigned_user_id_fkey(id, label, role)
    `)
    .single()

  if (error) {
    res.status(500).json({ error: 'Failed to upsert assignment', detail: error.message })
    return
  }

  res.status(200).json({ assignment: data })
}
