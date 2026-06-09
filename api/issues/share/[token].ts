import type { VercelRequest, VercelResponse } from '@vercel/node'

// Public, token-gated access to a single cleaning issue for the cleaner share
// link (/issue/:token). No login or API key — the unguessable share_token in
// the URL is the only credential. All DB access runs server-side with the
// service role; only a safe subset of fields is exposed. Self-contained (no
// _lib import) since it lives in a subdirectory outside the api/issues/*.ts
// includeFiles glob.

function cfg() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase config missing')
  return { url, key }
}

async function sb(path: string, init?: RequestInit) {
  const { url, key } = cfg()
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init?.headers || {}),
    },
  })
  if (!r.ok) throw new Error(`Supabase ${path}: ${r.status} ${await r.text()}`)
  const txt = await r.text()
  return txt ? JSON.parse(txt) : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token
  if (!token || token.length < 10) return res.status(400).json({ error: 'Invalid link' })

  try {
    // Resolve the issue by its share token. Service role bypasses RLS.
    const rows = await sb(`cleaning_issues?share_token=eq.${encodeURIComponent(token)}&select=id,property_name,category,issue_type,priority,details,status,report_date,completed_at&limit=1`)
    const issue = Array.isArray(rows) ? rows[0] : null
    if (!issue) return res.status(404).json({ error: 'Issue not found' })

    if (req.method === 'GET') {
      const comments = await sb(`issue_comments?issue_id=eq.${issue.id}&select=id,content,author_name,author_type,created_at&order=created_at.asc`)
      const photos = await sb(`issue_photos?issue_id=eq.${issue.id}&select=id,photo_url,created_at&order=created_at.asc`)
      return res.json({ issue, comments: comments || [], photos: photos || [] })
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const author = String(body.author_name || '').trim() || null

      if (body.action === 'comment') {
        const content = String(body.content || '').trim()
        if (!content) return res.status(400).json({ error: 'Comment is empty' })
        await sb('issue_comments', { method: 'POST', body: JSON.stringify({ issue_id: issue.id, content, author_name: author, author_type: 'cleaner' }) })
        return res.json({ ok: true })
      }

      if (body.action === 'photo') {
        const photo_url = String(body.photo_url || '')
        if (!photo_url) return res.status(400).json({ error: 'No photo' })
        await sb('issue_photos', { method: 'POST', body: JSON.stringify({ issue_id: issue.id, photo_url, photo_path: body.photo_path || null, uploaded_by: author, author_type: 'cleaner' }) })
        return res.json({ ok: true })
      }

      if (body.action === 'complete') {
        await sb(`cleaning_issues?id=eq.${issue.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }) })
        await sb('issue_comments', { method: 'POST', body: JSON.stringify({ issue_id: issue.id, content: `Marked complete${author ? ' by ' + author : ''}.`, author_name: author, author_type: 'cleaner' }) })
        return res.json({ ok: true })
      }

      return res.status(400).json({ error: 'Unknown action' })
    }

    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: `Method ${req.method} not allowed` })
  } catch (err: any) {
    console.error('issue share error:', err)
    return res.status(500).json({ error: err?.message || 'Server error' })
  }
}

export const config = { runtime: 'nodejs' }
