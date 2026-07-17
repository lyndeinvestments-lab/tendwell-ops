// Shared server-side translation core for the Issues tracker (PR 6: auto
// Spanish translation). Extracted from the near-duplicate logic PR 5 shipped
// in api/issues/translate.ts and api/issues/share/[token].ts's inline
// `translate` action so write-time cache-warming and the on-demand endpoint
// share one implementation. `api/issues/*.ts` all import this (see
// vercel.json's includeFiles for that glob) — but api/issues/share/[token].ts
// stays self-contained (that glob doesn't cover its subdirectory) and keeps
// its own inline copy of the pieces it needs.

import { createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'

export interface SupabaseConfig {
  url: string
  serviceKey: string
}

// Fields on `cleaning_issues` that get machine-translated. `coverage` is new
// in PR 6 — PR 5's on-demand endpoint only covered details/assessment/
// resolution/remarks.
export const ISSUE_TRANSLATABLE_FIELDS = new Set(['details', 'assessment', 'resolution', 'remarks', 'coverage'])

const MAX_CHARS = 4000
const MAX_COMMENTS = 30

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export async function sbFetch<T = unknown>(sb: SupabaseConfig, path: string, init?: RequestInit): Promise<T> {
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

export interface ResolvedTranslationItem {
  /** Caller-chosen key the result comes back under — e.g. 'details' or 'comment:<uuid>'. */
  id: string
  sourceTable: string
  sourceId: string
  sourceField: string
  text: string
}

/** Numbers each text segment, sends one Anthropic call, and defensively parses the JSON mapping back. Falls back to the original text per-item on any parse failure. */
export async function translateBatch(texts: string[], targetLang: 'es' | 'en'): Promise<string[]> {
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

/** Cache-checks `items`, translates only the misses in one batched Anthropic call, and best-effort persists new rows (never throws on a cache-write failure). Returns a map keyed by each item's caller-supplied `id`. */
export async function translateAndCache({
  sb,
  items,
  targetLang,
}: {
  sb: SupabaseConfig
  items: ResolvedTranslationItem[]
  targetLang: 'es' | 'en'
}): Promise<Record<string, string>> {
  const withHash = items.map(r => ({ ...r, hash: sha256(r.text) }))
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

/**
 * Loads a `cleaning_issues` row + its (most recent) comments and warms the
 * Spanish translation cache for every translatable field (details/
 * assessment/resolution/remarks/coverage) + each comment's content —
 * cache-hit items are skipped automatically (content-hash keyed), so calling
 * this repeatedly on an unchanged issue does no extra work. This is what
 * makes toggling to ES instant: called fire-and-forget from every write path
 * (bot create/update, in-app create/edit/comment) so the cache is warm by
 * the time anyone reads it. Never throws — logs and returns on any failure,
 * since this is a best-effort cache warm, not something that should fail
 * the write that triggered it.
 */
export async function ensureIssueSpanish(sb: SupabaseConfig, issueId: string): Promise<void> {
  try {
    const rows = await sbFetch<Array<Record<string, unknown>>>(
      sb, `cleaning_issues?id=eq.${issueId}&select=id,details,assessment,resolution,remarks,coverage&limit=1`,
    )
    const issue = rows?.[0]
    if (!issue) return

    const comments = await sbFetch<Array<{ id: string; content: string }>>(
      sb, `issue_comments?issue_id=eq.${issueId}&select=id,content&order=created_at.desc&limit=${MAX_COMMENTS}`,
    )

    const resolved: ResolvedTranslationItem[] = []
    for (const field of ISSUE_TRANSLATABLE_FIELDS) {
      const text = issue[field] as string | null
      if (text && text.trim()) resolved.push({ id: field, sourceTable: 'cleaning_issues', sourceId: issue.id as string, sourceField: field, text: text.slice(0, MAX_CHARS) })
    }
    for (const c of comments || []) {
      if (c.content && c.content.trim()) resolved.push({ id: `comment:${c.id}`, sourceTable: 'issue_comments', sourceId: c.id, sourceField: 'content', text: c.content.slice(0, MAX_CHARS) })
    }

    if (resolved.length === 0) return
    await translateAndCache({ sb, items: resolved, targetLang: 'es' })
  } catch (e) {
    console.error('ensureIssueSpanish failed (non-fatal):', e)
  }
}

/**
 * Races `fn` against a `ms` timeout so a slow/hung translation call never
 * adds more than that to a caller's response latency. Vercel functions can
 * be torn down shortly after the response is sent, so this bounds — it
 * doesn't guarantee — how long the write-time cache warm gets to run.
 * Swallows both timeouts and thrown errors: this is always a best-effort
 * side effect, never something that should fail the caller's request.
 */
export async function withSoftBudget(fn: () => Promise<void>, ms: number): Promise<void> {
  try {
    await Promise.race([
      fn(),
      new Promise<void>(resolve => setTimeout(resolve, ms)),
    ])
  } catch (e) {
    console.error('withSoftBudget task failed (non-fatal):', e)
  }
}
