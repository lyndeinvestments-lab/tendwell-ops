import type { VercelRequest, VercelResponse } from '@vercel/node'

// Public, token-gated access to a single inspection for the shareable link
// (/inspection/:token). No login or API key — the unguessable share_token in
// the URL is the only credential. All DB access runs server-side with the
// service role; only a safe, whitelisted subset of report fields is exposed
// (no financials, no access codes). Read-only (GET). Self-contained (no _lib
// import) since it lives in a subdirectory with no api/inspections/*.ts glob.
//
// Mirrors api/issues/share/[token].ts. Works for both states: a scheduled
// inspection (report not yet filled in) and a completed one (full report) —
// the same link the admin shares at scheduling time becomes the report.

function cfg() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase config missing')
  return { url, key }
}

async function sb(path: string) {
  const { url, key } = cfg()
  const r = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  })
  if (!r.ok) throw new Error(`Supabase ${path}: ${r.status} ${await r.text()}`)
  const txt = await r.text()
  return txt ? JSON.parse(txt) : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: `Method ${req.method} not allowed` })
  }

  const token = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token
  if (!token || token.length < 10) return res.status(400).json({ error: 'Invalid link' })

  try {
    // Whitelisted report fields only. Service role bypasses RLS; the embeds
    // resolve property name/address and the cleaner + inspector display names
    // (both FKs point at the cleaners table).
    const select =
      'id,status,scheduled_for,inspected_at,last_cleaned_on,reinspect_urgency,reinspect_by,' +
      'overall_score,cleanliness_score,linens_score,supplies_score,exterior_score,notes,photos_url,' +
      'cleaner_name,inspected_by,' +
      'properties(name,address),' +
      'cleaner:cleaners!inspections_cleaner_id_fkey(full_name),' +
      'inspector:cleaners!inspections_inspector_id_fkey(full_name)'
    const rows = await sb(
      `inspections?share_token=eq.${encodeURIComponent(token)}&select=${select}&limit=1`,
    )
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row) return res.status(404).json({ error: 'Inspection not found' })

    // Flatten the embeds into a stable, presentation-ready shape so the public
    // page never has to know about PostgREST embed naming.
    const report = {
      id: row.id,
      status: row.status,
      scheduled_for: row.scheduled_for,
      inspected_at: row.inspected_at,
      last_cleaned_on: row.last_cleaned_on,
      reinspect_urgency: row.reinspect_urgency,
      reinspect_by: row.reinspect_by,
      overall_score: row.overall_score,
      cleanliness_score: row.cleanliness_score,
      linens_score: row.linens_score,
      supplies_score: row.supplies_score,
      exterior_score: row.exterior_score,
      notes: row.notes,
      photos_url: Array.isArray(row.photos_url) ? row.photos_url : [],
      property_name: row.properties?.name ?? null,
      property_address: row.properties?.address ?? null,
      cleaner_name: row.cleaner?.full_name ?? row.cleaner_name ?? null,
      inspector_name: row.inspector?.full_name ?? row.inspected_by ?? null,
    }
    return res.json({ report })
  } catch (err: any) {
    console.error('inspection share error:', err)
    return res.status(500).json({ error: err?.message || 'Server error' })
  }
}

export const config = { runtime: 'nodejs' }
