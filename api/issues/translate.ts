import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseConfig, verifyAuthHeader, getStaffRole, type SupabaseClient } from '../notify/_lib.js'
import { ISSUE_TRANSLATABLE_FIELDS, sbFetch, translateAndCache, type ResolvedTranslationItem } from './_translate-core.js'

// POST /api/issues/translate — staff session-gated (same pattern as
// api/notify/send.ts). Batches on-demand machine translation of one issue's
// content: details/assessment/resolution/remarks/coverage + comments.
//
// Body: { issueId: string, targetLang: 'es'|'en', items: [{ id }] }
//   id ∈ 'details' | 'assessment' | 'resolution' | 'remarks' | 'coverage' | 'comment:<uuid>'
// Response: { translations: { [id]: string } }
//
// PR 6 (auto-translate): this is no longer just the manual "Traducir"
// button's endpoint — it's also the client-side backfill call the
// `use-issue-translations` hook fires (fire-and-forget) to heal cache misses
// the write-time hooks (`ensureIssueSpanish`, called from every write path)
// didn't warm. The server resolves each item's source text itself (never
// trusts client-supplied text) via service role, hashes it, checks the
// `issue_translations` cache, and translates only the misses in a single
// Anthropic call — shared logic now lives in `_translate-core.ts`. Mirrors
// the near-identical `translate` action inlined in
// api/issues/share/[token].ts (kept self-contained there — no shared import
// — so this file's helpers are duplicated, not extracted).

const MAX_ITEMS = 30
const MAX_CHARS = 4000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let sb: SupabaseClient
  try { sb = getSupabaseConfig() } catch (e: any) { return res.status(500).json({ error: e.message }) }

  const session = await verifyAuthHeader(sb, req.headers.authorization)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  // Staff only (mirrors api/notify/send.ts) — owners authenticate via
  // property_owners, not app_users, so getStaffRole naturally returns null
  // for them and they're rejected here without a separate owner check.
  const role = await getStaffRole(sb, session.email)
  if (!role) return res.status(403).json({ error: 'Forbidden: staff access required' })

  const { issueId, targetLang, items } = (req.body || {}) as any
  if (!issueId || typeof issueId !== 'string') return res.status(400).json({ error: 'issueId required' })
  if (targetLang !== 'es' && targetLang !== 'en') return res.status(400).json({ error: "targetLang must be 'es' or 'en'" })
  const itemIds = Array.isArray(items) ? items.slice(0, MAX_ITEMS).map((it: any) => String(it?.id || '')).filter(Boolean) : []
  if (itemIds.length === 0) return res.status(400).json({ error: 'items must be a non-empty array' })

  try {
    const rows = await sbFetch<Array<{ id: string; details: string | null; assessment: string | null; resolution: string | null; remarks: string | null; coverage: string | null }>>(
      sb, `cleaning_issues?id=eq.${issueId}&select=id,details,assessment,resolution,remarks,coverage&limit=1`,
    )
    const issue = rows?.[0]
    if (!issue) return res.status(404).json({ error: 'Issue not found' })

    const commentIds = itemIds.filter(id => id.startsWith('comment:')).map(id => id.slice('comment:'.length))
    const commentsById = new Map<string, string>()
    if (commentIds.length > 0) {
      const inList = commentIds.map(id => `"${id}"`).join(',')
      const comments = await sbFetch<Array<{ id: string; content: string }>>(
        sb, `issue_comments?issue_id=eq.${issueId}&id=in.(${inList})&select=id,content`,
      )
      for (const c of comments || []) commentsById.set(c.id, c.content)
    }

    const resolved: ResolvedTranslationItem[] = []
    for (const id of itemIds) {
      if (id.startsWith('comment:')) {
        const commentId = id.slice('comment:'.length)
        const text = commentsById.get(commentId)
        if (text && text.trim()) resolved.push({ id, sourceTable: 'issue_comments', sourceId: commentId, sourceField: 'content', text: text.slice(0, MAX_CHARS) })
      } else if (ISSUE_TRANSLATABLE_FIELDS.has(id)) {
        const text = (issue as any)[id] as string | null
        if (text && text.trim()) resolved.push({ id, sourceTable: 'cleaning_issues', sourceId: issue.id, sourceField: id, text: text.slice(0, MAX_CHARS) })
      }
    }

    if (resolved.length === 0) return res.json({ translations: {} })

    const translations = await translateAndCache({ sb, items: resolved, targetLang })
    return res.json({ translations })
  } catch (err: any) {
    console.error('issues translate error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}

export const config = { runtime: 'nodejs' }
