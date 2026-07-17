/**
 * Pure helpers behind the ES read overlay (`client/src/hooks/use-issue-translations.ts`).
 * Kept in a React-free module so they're trivially unit-testable and so the
 * hook's `import`s (react-query, supabase, useLocale) never need to load
 * just to exercise this logic.
 */

export interface CachedTranslationRow {
  source_id: string
  source_field: string
  translated_text: string
  created_at: string
}

/**
 * Builds a `${source_id}:${source_field}` → translated-text map from raw
 * `issue_translations` rows, keeping the newest row (by `created_at`) when
 * more than one exists for the same key (e.g. a field was edited and
 * re-translated).
 */
export function buildTranslationMap(rows: CachedTranslationRow[]): Map<string, string> {
  const map = new Map<string, string>()
  const newestAt = new Map<string, string>()
  for (const row of rows) {
    const key = `${row.source_id}:${row.source_field}`
    const prevAt = newestAt.get(key)
    if (!prevAt || row.created_at > prevAt) {
      map.set(key, row.translated_text)
      newestAt.set(key, row.created_at)
    }
  }
  return map
}

/** `map.get(sourceId:field) ?? original` — the read-side fallback every consumer needs. */
export function resolveTranslation(
  map: Map<string, string>,
  sourceId: string | null | undefined,
  field: string,
  original: string | null | undefined,
): string | null | undefined {
  if (!sourceId) return original
  return map.get(`${sourceId}:${field}`) ?? original
}
