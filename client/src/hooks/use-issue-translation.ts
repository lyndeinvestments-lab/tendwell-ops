import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Locale } from '@/lib/i18n/LocaleProvider'

export interface TranslatableItem { id: string; text: string }

export type TranslateFetcher = (
  targetLang: Locale,
  items: Array<{ id: string }>,
) => Promise<{ translations: Record<string, string> }>

/**
 * Shared "Translate to X" / "Show original" behavior for `IssueDetailSheet`
 * (staff, calls `/api/issues/translate`) and the public share page (calls
 * the token endpoint's `translate` action) — same batching + cache + toggle
 * logic, just a different `fetcher`.
 *
 * Batches every translatable field on the issue plus its comments into one
 * request. Result is cached in React Query with `staleTime: Infinity`,
 * keyed `[issueId, targetLang]` so re-opening the same issue in the same
 * target language never re-calls the translate endpoint.
 */
export function useIssueTranslation({
  issueId,
  targetLang,
  items,
  fetcher,
}: {
  issueId: string | undefined
  /** Direction of translation — the caller decides (see components for the "current locale" convention). */
  targetLang: Locale
  items: TranslatableItem[]
  fetcher: TranslateFetcher
}) {
  const qc = useQueryClient()
  const [showTranslated, setShowTranslated] = useState(false)

  // A different issue (or a locale switch mid-view) always starts back at
  // the original text — never carry a stale "translated" view over.
  useEffect(() => { setShowTranslated(false) }, [issueId, targetLang])

  const hasContent = items.length > 0
  const queryKey = ['issue-translation', issueId, targetLang] as const

  const { data, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await fetcher(targetLang, items.map(i => ({ id: i.id })))
      return result.translations || {}
    },
    enabled: false,
    staleTime: Infinity,
  })

  /** Toggles between the translated and original view, fetching (and caching) on first use. Throws on failure so the caller can toast. */
  async function toggle() {
    if (!hasContent) return
    if (showTranslated) { setShowTranslated(false); return }
    if (!qc.getQueryData(queryKey)) {
      await refetch({ throwOnError: true })
    }
    setShowTranslated(true)
  }

  /** Translated text for `id`, or `fallback` (the original) when not currently showing translations. */
  function text(id: string, fallback: string | null | undefined): string | null | undefined {
    if (!showTranslated) return fallback
    return (data as Record<string, string> | undefined)?.[id] ?? fallback
  }

  return { showTranslated, toggle, text, isTranslating: isFetching, hasContent }
}
