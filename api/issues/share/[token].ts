import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'

// Public, token-gated access to a single cleaning issue for the cleaner share
// link (/issue/:token). No login or API key — the unguessable share_token in
// the URL is the only credential. All DB access runs server-side with the
// service role; only a safe subset of fields is exposed. Self-contained (no
// _lib import) since it lives in a subdirectory outside the api/issues/*.ts
// includeFiles glob.

const MAX_TRANSLATE_ITEMS = 30
const MAX_TRANSLATE_CHARS = 4000
const TRANSLATABLE_FIELDS = new Set(['details', 'assessment', 'resolution', 'remarks'])

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

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Numbers each text segment, sends one Anthropic call, and defensively parses the JSON mapping back. Falls back to the original text per-item on any parse failure. Duplicated from api/issues/translate.ts — this file must stay self-contained (no _lib import; the cleaner share link has no session). */
async function translateBatch(texts: string[], targetLang: 'es' | 'en'): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  const anthropic = new Anthropic({ apiKey })
  const targetName = targetLang === 'es' ? 'Spanish' : 'English'
  const numbered = texts.map((text, i) => `[${i + 1}] ${text}`).join('\n\n')
  const system = `You translate short operational notes for a vacation-rental cleaning company. Translate each numbered segment faithfully into ${targetName}. Preserve names, addresses, and numbers exactly as written. Do not add a preamble, commentary, or explanations. Respond with ONLY a JSON object mapping each segment number (as a string) to its translation, e.g. {"1": "...", "2": "..."}.`

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: numbered }],
  })

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  const raw = textBlock?.text || '{}'
  let parsed: Record<string, string> = {}
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
  } catch {
    parsed = {}
  }
  return texts.map((original, i) => {
    const value = parsed[String(i + 1)]
    return typeof value === 'string' && value.trim() ? value : original
  })
}

/** Resolves each item's source text server-side (issue fields + comments verified to belong to `issueId`), checks the `issue_translations` cache, translates only the misses, and best-effort persists new rows. */
async function translateIssueItems(issueId: string, itemIds: string[], targetLang: 'es' | 'en'): Promise<Record<string, string>> {
  const issueRows = await sb(`cleaning_issues?id=eq.${issueId}&select=id,details,assessment,resolution,remarks&limit=1`)
  const issue = Array.isArray(issueRows) ? issueRows[0] : null
  if (!issue) return {}

  const commentIds = itemIds.filter(id => id.startsWith('comment:')).map(id => id.slice('comment:'.length))
  const commentsById = new Map<string, string>()
  if (commentIds.length > 0) {
    const inList = commentIds.map(id => `"${id}"`).join(',')
    const comments = await sb(`issue_comments?issue_id=eq.${issueId}&id=in.(${inList})&select=id,content`)
    for (const c of comments || []) commentsById.set(c.id, c.content)
  }

  const resolved: Array<{ id: string; sourceTable: string; sourceId: string; sourceField: string; text: string; hash: string }> = []
  for (const id of itemIds) {
    let text: string | null | undefined
    let sourceTable = 'cleaning_issues'
    let sourceId = issue.id
    let sourceField = id
    if (id.startsWith('comment:')) {
      const commentId = id.slice('comment:'.length)
      text = commentsById.get(commentId)
      sourceTable = 'issue_comments'
      sourceId = commentId
      sourceField = 'content'
    } else if (TRANSLATABLE_FIELDS.has(id)) {
      text = issue[id]
    }
    if (text && text.trim()) {
      resolved.push({ id, sourceTable, sourceId, sourceField, text: text.slice(0, MAX_TRANSLATE_CHARS), hash: sha256(text.slice(0, MAX_TRANSLATE_CHARS)) })
    }
  }
  if (resolved.length === 0) return {}

  const hashes = [...new Set(resolved.map(r => r.hash))]
  const hashList = hashes.map(h => `"${h}"`).join(',')
  const cacheRows = await sb(`issue_translations?target_lang=eq.${targetLang}&source_hash=in.(${hashList})&select=source_table,source_id,source_field,source_hash,translated_text`)
  const cacheKey = (table: string, id: string, field: string, hash: string) => `${table}:${id}:${field}:${hash}`
  const cacheMap = new Map<string, string>()
  for (const row of cacheRows || []) cacheMap.set(cacheKey(row.source_table, row.source_id, row.source_field, row.source_hash), row.translated_text)

  const translations: Record<string, string> = {}
  const misses = resolved.filter(item => {
    const cached = cacheMap.get(cacheKey(item.sourceTable, item.sourceId, item.sourceField, item.hash))
    if (cached) { translations[item.id] = cached; return false }
    return true
  })

  if (misses.length > 0) {
    const translated = await translateBatch(misses.map(m => m.text), targetLang)
    const inserts = misses.map((m, i) => {
      const translatedText = translated[i] ?? m.text
      translations[m.id] = translatedText
      return { source_table: m.sourceTable, source_id: m.sourceId, source_field: m.sourceField, target_lang: targetLang, source_hash: m.hash, translated_text: translatedText }
    })
    try {
      await sb('issue_translations', { method: 'POST', headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: JSON.stringify(inserts) })
    } catch (e) {
      console.error('issue_translations cache insert failed:', e)
    }
  }

  return translations
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token
  if (!token || token.length < 10) return res.status(400).json({ error: 'Invalid link' })

  try {
    // Resolve the issue by its share token. Service role bypasses RLS.
    const rows = await sb(`cleaning_issues?share_token=eq.${encodeURIComponent(token)}&select=id,property_name,category,issue_type,priority,details,status,report_date,completed_at,due_date,acknowledged_at,share_link_disabled&limit=1`)
    const issue = Array.isArray(rows) ? rows[0] : null
    if (!issue) return res.status(404).json({ error: 'Issue not found' })
    // Staff kill switch: a disabled link stops working without rotating the
    // token. Default false — every pre-existing link is unaffected.
    if (issue.share_link_disabled) return res.status(410).json({ error: 'This link has been disabled' })
    delete issue.share_link_disabled

    if (req.method === 'GET') {
      const comments = await sb(`issue_comments?issue_id=eq.${issue.id}&select=id,content,author_name,author_type,created_at&order=created_at.asc`)
      const photos = await sb(`issue_photos?issue_id=eq.${issue.id}&select=id,photo_url,phase,created_at&order=created_at.asc`)
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
        // This endpoint is unauthenticated (cleaner share link). The stored
        // photo_url is later rendered as <img src> and <a href> in the Ops
        // dashboard, so reject anything that isn't an https Supabase Storage
        // URL to prevent stored javascript:/data: injection.
        let parsed: URL
        try { parsed = new URL(photo_url) } catch { return res.status(400).json({ error: 'Invalid photo URL' }) }
        if (parsed.protocol !== 'https:' || !parsed.host.toLowerCase().endsWith('.supabase.co')) {
          return res.status(400).json({ error: 'Invalid photo URL' })
        }
        await sb('issue_photos', { method: 'POST', body: JSON.stringify({ issue_id: issue.id, photo_url, photo_path: body.photo_path || null, phase: body.phase === 'completion' ? 'completion' : 'initial', uploaded_by: author, author_type: 'cleaner' }) })
        return res.json({ ok: true })
      }

      if (body.action === 'translate') {
        const targetLang = body.targetLang === 'en' ? 'en' : body.targetLang === 'es' ? 'es' : null
        if (!targetLang) return res.status(400).json({ error: "targetLang must be 'es' or 'en'" })
        const rawItems = Array.isArray(body.items) ? body.items : []
        const itemIds = rawItems.slice(0, MAX_TRANSLATE_ITEMS).map((it: any) => String(it?.id || '')).filter(Boolean)
        if (itemIds.length === 0) return res.status(400).json({ error: 'items must be a non-empty array' })
        const translations = await translateIssueItems(issue.id, itemIds, targetLang)
        return res.json({ translations })
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
    // Log the detail server-side only — err.message can carry Supabase REST
    // internals that don't belong in an unauthenticated response.
    console.error('issue share error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}

export const config = { runtime: 'nodejs' }
