import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { getSupabaseConfig, verifyAuthHeader, getStaffRole, type SupabaseClient } from '../notify/_lib.js'

// POST /api/issues/translate — staff session-gated (same pattern as
// api/notify/send.ts). Batches on-demand machine translation of one issue's
// content: details/assessment/resolution/remarks + comments.
//
// Body: { issueId: string, targetLang: 'es'|'en', items: [{ id }] }
//   id ∈ 'details' | 'assessment' | 'resolution' | 'remarks' | 'comment:<uuid>'
// Response: { translations: { [id]: string } }
//
// The server resolves each item's source text itself (never trusts
// client-supplied text) via service role, hashes it, checks the
// `issue_translations` cache, and translates only the misses in a single
// Anthropic call. Mirrors the near-identical `translate` action inlined in
// api/issues/share/[token].ts (kept self-contained there — no shared import
// — so this file's helpers are duplicated, not extracted).

const MAX_ITEMS = 30
const MAX_CHARS = 4000
const FIELD_IDS = new Set(['details', 'assessment', 'resolution', 'remarks'])

async function sbFetch<T = unknown>(sb: SupabaseClient, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${sb.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: sb.serviceKey,
      Authorization: `Bearer ${sb.serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init?.headers || {}),
    },
  })
  if (!r.ok) throw new Error(`Supabase ${path}: ${r.status} ${await r.text()}`)
  const txt = await r.text()
  return (txt ? JSON.parse(txt) : null) as T
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

interface ResolvedItem { id: string; sourceTable: string; sourceId: string; sourceField: string; text: string }

/** Numbers each text segment, sends one Anthropic call, and defensively parses the JSON mapping back. Falls back to the original text per-item on any parse failure. */
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

/** Cache-checks, translates misses, and best-effort persists new rows. Never throws on a cache-write failure. */
async function translateItems(sb: SupabaseClient, resolved: ResolvedItem[], targetLang: 'es' | 'en'): Promise<Record<string, string>> {
  const withHash = resolved.map(r => ({ ...r, hash: sha256(r.text) }))
  const hashes = [...new Set(withHash.map(r => r.hash))]
  const hashList = hashes.map(h => `"${h}"`).join(',')
  const cacheRows = hashes.length > 0
    ? await sbFetch<Array<{ source_table: string; source_id: string; source_field: string; source_hash: string; translated_text: string }>>(
        sb, `issue_translations?target_lang=eq.${targetLang}&source_hash=in.(${hashList})&select=source_table,source_id,source_field,source_hash,translated_text`,
      )
    : []

  const cacheKey = (table: string, id: string, field: string, hash: string) => `${table}:${id}:${field}:${hash}`
  const cacheMap = new Map<string, string>()
  for (const row of cacheRows || []) cacheMap.set(cacheKey(row.source_table, row.source_id, row.source_field, row.source_hash), row.translated_text)

  const translations: Record<string, string> = {}
  const misses = withHash.filter(item => {
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
      await sbFetch(sb, 'issue_translations', { method: 'POST', headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: JSON.stringify(inserts) })
    } catch (e) {
      console.error('issue_translations cache insert failed:', e)
    }
  }

  return translations
}

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
    const rows = await sbFetch<Array<{ id: string; details: string | null; assessment: string | null; resolution: string | null; remarks: string | null }>>(
      sb, `cleaning_issues?id=eq.${issueId}&select=id,details,assessment,resolution,remarks&limit=1`,
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

    const resolved: ResolvedItem[] = []
    for (const id of itemIds) {
      if (id.startsWith('comment:')) {
        const commentId = id.slice('comment:'.length)
        const text = commentsById.get(commentId)
        if (text && text.trim()) resolved.push({ id, sourceTable: 'issue_comments', sourceId: commentId, sourceField: 'content', text: text.slice(0, MAX_CHARS) })
      } else if (FIELD_IDS.has(id)) {
        const text = (issue as any)[id] as string | null
        if (text && text.trim()) resolved.push({ id, sourceTable: 'cleaning_issues', sourceId: issue.id, sourceField: id, text: text.slice(0, MAX_CHARS) })
      }
    }

    if (resolved.length === 0) return res.json({ translations: {} })

    const translations = await translateItems(sb, resolved, targetLang)
    return res.json({ translations })
  } catch (err: any) {
    console.error('issues translate error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}

export const config = { runtime: 'nodejs' }
