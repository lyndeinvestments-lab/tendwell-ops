import { supabase } from '@/lib/supabase'
import type { Locale } from '@/lib/i18n/LocaleProvider'

export interface TranslateItemRef { id: string }

/**
 * Fire-and-forget client-side warmer for `/api/issues/translate`.
 *
 * Bot/API writes to `cleaning_issues` get their translation cache warmed
 * server-side (`ensureIssueSpanish`, called from `api/issues/index.ts` and
 * `api/issues/[id].ts`). In-app writes go straight from the browser to
 * Supabase and never touch that server code, so callers here (issue
 * create/CSV import/comment post) fire this afterward to close the gap —
 * same effect, just triggered client-side. Also used by
 * `use-issue-translations.ts`'s lazy backfill for cache misses.
 *
 * Never throws and never blocks — callers must NOT await this before
 * completing their own mutation/UI flow. Failures are logged and silent;
 * a missed warm just means the ES overlay falls back to the original text
 * until the next backfill pass.
 */
export async function triggerIssueTranslate(
  issueId: string,
  items: TranslateItemRef[],
  targetLang: Locale = 'es',
): Promise<void> {
  if (!issueId || items.length === 0) return
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    const res = await fetch('/api/issues/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ issueId, targetLang, items }),
    })
    if (!res.ok) console.warn('issue translate warm failed:', await res.text().catch(() => ''))
  } catch (e) {
    console.warn('issue translate warm error:', e)
  }
}
