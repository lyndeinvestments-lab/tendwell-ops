// Staleness checks for externally-pushed data feeds.
//
// Breezeway is the only feed with no in-app refresh path: there is no
// Breezeway API client and no Vercel cron. Task data arrives as a CSV POSTed
// to /api/tasks/breezeway-import by a GitHub Actions workflow
// (.github/workflows/breezeway-import.yml, daily 13:00 UTC), so if that
// workflow breaks — expired service-account key, revoked Drive share,
// rotated import key, or the Apps Script upstream failing — nothing in the
// app changes visibly. The clean archive just quietly stops moving while
// every downstream reader (financial_monthly_cleans / financial_task_load
// behind Financial Overview, Forecaster and Pro Forma; the API Sync ->
// Breezeway coverage panel; invoicing's engine context) keeps serving the
// last import as if it were current.
//
// That is exactly how the feed sat at 3 imports between 2026-05-01 and
// 2026-08-17 without anyone noticing. These thresholds turn that silence
// into an alert.

export type FreshnessSeverity = 'warning' | 'critical'

/** Stale enough to flag: one missed daily run is noise, two is a pattern. */
export const BREEZEWAY_STALE_WARNING_DAYS = 2
/** Stale enough that the financial views are meaningfully wrong. */
export const BREEZEWAY_STALE_CRITICAL_DAYS = 5

export interface FreshnessVerdict {
  severity: FreshnessSeverity
  /** Whole days since the last successful import; null when there is none. */
  daysStale: number | null
  /** ISO date of the last import, or 'never' — used in the alert's id. */
  lastImportKey: string
}

/**
 * Grade how stale the Breezeway feed is.
 *
 * Returns null while the feed is fresh (the common case), so callers can push
 * an alert only when there is something to say.
 *
 * `lastImportedAt` is the max `breezeway_import_log.imported_at`; null/absent
 * means the table is empty, which is always critical — a deployment where the
 * import has never once run.
 */
export function breezewayFreshness(
  lastImportedAt: string | null | undefined,
  now: Date = new Date(),
): FreshnessVerdict | null {
  if (!lastImportedAt) {
    return { severity: 'critical', daysStale: null, lastImportKey: 'never' }
  }

  const last = new Date(lastImportedAt)
  if (Number.isNaN(last.getTime())) {
    // An unparseable timestamp means we can't prove freshness, and silently
    // treating that as fresh is the failure mode this whole module exists to
    // prevent.
    return { severity: 'critical', daysStale: null, lastImportKey: 'never' }
  }

  const daysStale = Math.floor((now.getTime() - last.getTime()) / 86_400_000)
  if (daysStale < BREEZEWAY_STALE_WARNING_DAYS) return null

  return {
    severity: daysStale >= BREEZEWAY_STALE_CRITICAL_DAYS ? 'critical' : 'warning',
    daysStale,
    lastImportKey: last.toISOString().split('T')[0],
  }
}

/** Human-readable description for the alert body (intentionally English —
 *  alert titles/descriptions are not translated app-wide yet). */
export function breezewayFreshnessDescription(v: FreshnessVerdict): string {
  if (v.daysStale == null) {
    return 'No Breezeway import has ever completed. Clean counts, the Breezeway coverage panel and invoicing have no task data.'
  }
  return (
    `Last import was ${v.daysStale} days ago. Clean counts in Financial Overview, ` +
    'Forecaster and Pro Forma are stale, and invoicing may under-count cleans. ' +
    'Check the Breezeway Daily Import workflow in GitHub Actions.'
  )
}
