import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireLostItemsAccess, getSupabaseAdminForLostItems } from './_lib.js'

// GET /api/lost-items/assignments[?case_ids=<csv-of-uuids>]
// Returns local Tendwell-side assignments for Haven cases. Joined to
// app_users so the client can render assignee labels without a second
// round-trip.
//
// Optional case_ids filter: ?case_ids=uuid1,uuid2 returns only those rows.
// Useful when the board view has already loaded a page of cases and only
// needs assignment overlays for that page.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireLostItemsAccess(req, res, ['GET'])
  if (!ctx) return

  const supabase = getSupabaseAdminForLostItems()
  if (!supabase) {
    res.status(503).json({ error: 'Supabase service role not configured' })
    return
  }

  const caseIdsParam = typeof req.query.case_ids === 'string' ? req.query.case_ids : ''
  const caseIds = caseIdsParam
    .split(',')
    .map(s => s.trim())
    .filter(s => /^[0-9a-f-]{36}$/i.test(s))

  let query = supabase
    .from('lost_item_assignments')
    .select(`
      haven_case_id,
      assigned_user_id,
      assigned_by_user_id,
      assigned_at,
      updated_at,
      notes,
      assignee:app_users!lost_item_assignments_assigned_user_id_fkey(id, label, role)
    `)
    .order('updated_at', { ascending: false })

  if (caseIds.length > 0) {
    query = query.in('haven_case_id', caseIds)
  }

  const { data, error } = await query
  if (error) {
    res.status(500).json({ error: 'Failed to load assignments', detail: error.message })
    return
  }

  res.status(200).json({ assignments: data ?? [] })
}
