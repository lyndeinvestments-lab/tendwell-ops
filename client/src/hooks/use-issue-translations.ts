import { useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { triggerIssueTranslate } from '@/lib/issue-translate'
import { buildTranslationMap, resolveTranslation, type CachedTranslationRow } from '@/lib/issue-translations-map'

export type { CachedTranslationRow }

/**
 * One field/comment on an issue that's eligible for the ES overlay.
 * `issueId` groups misses into a single batched backfill call per issue;
 * `sourceId` is the issue's own id (for issue fields, e.g. `field: 'details'`)
 * or a comment's id (`field: 'content'`).
 */
export interface TranslatableCandidate {
  issueId: string
  sourceId: string
  field: string
  text: string | null | undefined
}

const QUERY_PREFIX = 'issue-translations-es'
const BACKFILL_DEBOUNCE_MS = 600
const BACKFILL_CONCURRENCY = 3

/**
 * ES read overlay for the Issues surface — the mechanism behind "toggling ES
 * flips ALL content instantly". Queries the staff-only `issue_translations`
 * cache for every candidate's `sourceId` (issue ids + comment ids), builds a
 * lookup, and exposes `tr()` for instant reads with a graceful fallback to
 * the original text on a miss. When the current locale isn't Spanish this
 * is a no-op — no query runs, `tr()` returns the original unchanged.
 *
 * Misses among the given `candidates` are debounced and batch-backfilled
 * (one `/api/issues/translate` call per issue, capped concurrency) so a gap
 * — a just-created issue whose write-time translation hasn't landed yet, or
 * genuinely old content predating this feature — self-heals without a page
 * reload. Each `(sourceId, field)` pair is only ever attempted once per hook
 * instance (component lifetime) so a translation that keeps failing doesn't
 * get hammered every render.
 */
export function useIssueTranslations(candidates: TranslatableCandidate[]) {
  const { locale } = useLocale()
  const qc = useQueryClient()
  const isSpanish = locale === 'es'

  const sourceIds = useMemo(
    () => Array.from(new Set(candidates.map(c => c.sourceId).filter(Boolean))).sort(),
    [candidates],
  )

  const { data } = useQuery({
    queryKey: [QUERY_PREFIX, sourceIds.join(',')],
    enabled: isSpanish && sourceIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('issue_translations')
        .select('source_id,source_field,translated_text,created_at')
        .eq('target_lang', 'es')
        .in('source_id', sourceIds)
      if (error) throw error
      return (data || []) as CachedTranslationRow[]
    },
  })

  const map = useMemo(() => buildTranslationMap(data || []), [data])

  function tr(sourceId: string | null | undefined, field: string, original: string | null | undefined) {
    if (!isSpanish) return original
    return resolveTranslation(map, sourceId, field, original)
  }

  const attempted = useRef<Set<string>>(new Set())
  const pendingByIssue = useRef<Map<string, Set<string>>>(new Map())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightIssues = useRef<Set<string>>(new Set())

  async function runBackfill() {
    const entries = Array.from(pendingByIssue.current.entries()).filter(([issueId]) => !inFlightIssues.current.has(issueId))
    pendingByIssue.current = new Map()
    if (entries.length === 0) return
    let firedAny = false
    for (let i = 0; i < entries.length; i += BACKFILL_CONCURRENCY) {
      const batch = entries.slice(i, i + BACKFILL_CONCURRENCY)
      await Promise.all(batch.map(async ([issueId, itemIds]) => {
        inFlightIssues.current.add(issueId)
        try {
          await triggerIssueTranslate(issueId, Array.from(itemIds).map(id => ({ id })), 'es')
          firedAny = true
        } finally {
          inFlightIssues.current.delete(issueId)
        }
      }))
    }
    if (firedAny) qc.invalidateQueries({ queryKey: [QUERY_PREFIX] })
  }

  useEffect(() => {
    if (!isSpanish) return
    let scheduled = false
    for (const c of candidates) {
      if (!c.text || !c.text.trim() || !c.sourceId) continue
      const key = `${c.sourceId}:${c.field}`
      if (map.has(key) || attempted.current.has(key)) continue
      attempted.current.add(key)
      const itemId = c.field === 'content' ? `comment:${c.sourceId}` : c.field
      const set = pendingByIssue.current.get(c.issueId) ?? new Set<string>()
      set.add(itemId)
      pendingByIssue.current.set(c.issueId, set)
      scheduled = true
    }
    if (!scheduled) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void runBackfill() }, BACKFILL_DEBOUNCE_MS)
    return () => { if (timer.current) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, map, isSpanish])

  return { tr, isSpanish }
}
