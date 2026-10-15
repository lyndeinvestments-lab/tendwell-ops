// Staleness checks for the data feeds behind clean counts.
//
// Trellis (WS5, 2026-10-14) is the primary source: from the
// app_settings.clean_source_cutover month on, every financial clean count
// (financial_monthly_cleans, property_monthly_cleans, property_clean_stats,
// Pro Forma, Forecaster, Master List, North Star) comes from the Trellis
// snapshot, refreshed by the nightly + hourly sync in trellis_sync_log.
// `trellisFreshness` grades that sync; the Breezeway check below stays for the
// pre-cutover archive and invoicing, which still reads breezeway_tasks.
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

// ── Trellis sync ─────────────────────────────────────────────────────────────

/** The hourly task refresh + nightly full sync should never leave a day gap. */
export const TRELLIS_STALE_WARNING_HOURS = 26
/** Three days without a successful sync: clean counts are meaningfully wrong. */
export const TRELLIS_STALE_CRITICAL_HOURS = 72

export interface TrellisFreshnessVerdict {
  severity: FreshnessSeverity
  /** Whole hours since the last successful sync; null when there is none. */
  hoursStale: number | null
  /** ISO date of the last successful sync, or 'never' (used in the alert id). */
  lastSyncKey: string
}

/**
 * Grade how stale the Trellis sync is. `lastSuccessAt` is the newest
 * `trellis_sync_log.finished_at` whose status is 'done' or 'partial' (a partial
 * run stopped cleanly at its time budget and still refreshed data), read
 * through the staff-only `trellis_sync_freshness()` function.
 *
 * Returns null while fresh. Missing or unparseable timestamps grade critical:
 * we cannot prove freshness, and silence is the failure this module prevents.
 */
export function trellisFreshness(
  lastSuccessAt: string | null | undefined,
  now: Date = new Date(),
): TrellisFreshnessVerdict | null {
  if (!lastSuccessAt) return { severity: 'critical', hoursStale: null, lastSyncKey: 'never' }
  const last = new Date(lastSuccessAt)
  if (Number.isNaN(last.getTime())) return { severity: 'critical', hoursStale: null, lastSyncKey: 'never' }

  const hoursStale = Math.floor((now.getTime() - last.getTime()) / 3_600_000)
  if (hoursStale < TRELLIS_STALE_WARNING_HOURS) return null

  return {
    severity: hoursStale >= TRELLIS_STALE_CRITICAL_HOURS ? 'critical' : 'warning',
    hoursStale,
    lastSyncKey: last.toISOString().split('T')[0],
  }
}

/** Alert body for a stale Trellis sync (English, like the other alert copy). */
export function trellisFreshnessDescription(v: TrellisFreshnessVerdict): string {
  if (v.hoursStale == null) {
    return 'No Trellis sync has ever finished. Clean counts in Pro Forma, Forecaster, Master List and North Star have no Trellis data.'
  }
  const age = v.hoursStale >= 48 ? `${Math.floor(v.hoursStale / 24)} days` : `${v.hoursStale} hours`
  return (
    `Last successful Trellis sync was ${age} ago. Clean counts in Pro Forma, Forecaster, ` +
    'Master List, North Star and the cleaner pages are stale. Check API Sync > History for the failing runs.'
  )
}

/**
 * Once financial clean counts come from Trellis (on/after the cutover), a
 * stale Breezeway feed only affects the pre-cutover archive and invoicing, so
 * its alert drops to info. Before the cutover it keeps its graded severity.
 */
export function breezewayAlertSeverity(
  v: FreshnessVerdict,
  trellisIsPrimary: boolean,
): FreshnessSeverity | 'info' {
  return trellisIsPrimary ? 'info' : v.severity
}

/**
 * True when `today` (YYYY-MM-DD) is on/after the cutover month start
 * (YYYY-MM-DD, as returned by clean_source_cutover()). Malformed or missing
 * cutover means Breezeway is still primary.
 */
export function isTrellisPrimary(cutover: string | null | undefined, today: string): boolean {
  if (!cutover || !/^\d{4}-\d{2}-\d{2}$/.test(cutover)) return false
  return today >= cutover
}
