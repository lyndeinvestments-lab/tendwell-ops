# Breezeway Daily CSV Import — Runbook

Breezeway has no API we consume. Its task data reaches Tendwell as a CSV
export that gets pushed into `POST /api/tasks/breezeway-import`. The whole
chain is now automated:

```
Breezeway scheduled email export (2 exports/day)
  └─> Apps Script "Breezeway Export to Drive"  (daily ~7:33 AM ET)
        writes 2 CSVs to Drive folder 1XkEs242mTVZjulZiPW4zse9oa6y-sR0W (~11:33 UTC)
        └─> .github/workflows/breezeway-import.yml  (daily 13:00 UTC)
              runs scripts/breezeway_import.py
              └─> POST /api/tasks/breezeway-import?source=current_month|next_month
                    └─> breezeway_tasks (upsert) + breezeway_import_log
```

Everything downstream reads `breezeway_tasks`: the `financial_monthly_cleans`
/ `financial_task_load` views (Financial Overview, Forecaster, Pro Forma), the
Breezeway coverage + orphans panel on **API Sync → Breezeway**, and
invoicing's `loadEngineContext`. They are only as fresh as the last import,
which is why this runs unattended.

> **History:** the GitHub Actions half of this chain did not exist until
> 2026-08-19. Between 2026-05-01 and 2026-08-17 `breezeway_import_log` recorded
> exactly **three** imports (build-day tests, the June history backfill, and one
> manual bulk POST), so the clean archive went weeks at a time without a
> refresh. Anything that looked like undercounted cleans before that date was
> probably stale data, not a query bug.

---

## The endpoint

```
POST https://app.tendwellcleaningco.com/api/tasks/breezeway-import?source=<LABEL>
Headers:
  Content-Type: text/csv
  x-tendwell-import-key: <BREEZEWAY_IMPORT_KEY>
Body:
  <raw CSV bytes>
```

`<LABEL>` is `current_month` or `next_month` (optional; it only sets
`source_label` for reporting).

**Idempotent.** A row's identity is
`sha256(created_date | property | task_title | due_date)`, so re-posting the
same file overwrites the same rows and the two daily exports deduplicate
naturally where their windows overlap. Re-running the workflow is always safe.

Successful response:

```json
{
  "ok": true, "batch": "ad21…", "source": "current_month",
  "rows_seen": 312, "rows_upserted": 311, "rows_skipped": 1,
  "cleans_in_batch": 184, "deep_cleans_in_batch": 3,
  "unmatched_addresses_count": 2, "sample_unmatched_addresses": ["…", "…"]
}
```

`unmatched_addresses_count > 0` means those rows landed in `breezeway_tasks`
but couldn't be linked to a `properties` row. Resolve them on **API Sync →
Breezeway** (writes `breezeway_property_resolutions`, which the importer
honors on every subsequent run — a match made once is never asked again).

---

## The importer

`scripts/breezeway_import.py`, driven by
`.github/workflows/breezeway-import.yml` (daily `0 13 * * *` +
`workflow_dispatch`).

**File selection is by Drive `createdTime`, not the date in the filename.**
The two usually agree, but a manual Apps Script run produces a file whose name
carries the Breezeway export date while landing in Drive later — observed
live: `2026-08-18_16-35-24_…csv` created `2026-08-19T01:29Z`. A name-prefix
filter drops those silently; a createdTime window picks them up.

Default window is **30 hours** (`LOOKBACK_HOURS`). The drop is at ~11:33 UTC
and the run is at 13:00 UTC, so 24h would leave only ~90 minutes of margin and
nothing to fall back on if a scheduled run is skipped — GitHub does drop
scheduled runs under load. 30h reaches back past the previous day's drop too,
so **a missed day self-heals on the next run**. Files are posted oldest-first,
so when windows overlap the freshest export always writes last.

**Label detection** uses the modal `Due date` month across every row, compared
against the file's own export month (from the filename date, falling back to
today in `BUSINESS_TZ`). The original runbook read only row 2's `Due date`;
that lets a single rescheduled task flip a whole file's label, and it labels
backfills against the wrong month. Both cases are covered in the self-test.

**Pre-flight checks that abort before POSTing:** a missing/renamed required
column (`Task title`, `Property`, `Due date`, `Created date`, `Status`) and a
header-only file. Both would otherwise return HTTP 200 while writing rows with
null titles and dates.

**Retries:** 3 attempts with 2s/4s/8s backoff on network errors, 429, and 5xx.
Other 4xx fails immediately — a retry would send identical bytes with an
identical key and fail identically.

**Failure reporting:** non-zero exit (red run in Actions), a run summary table
on the workflow page, and a Slack message if `SLACK_WEBHOOK_URL` is set.
Zero files found is a failure, since the Apps Script runs every day.

### Manual runs

From **Actions → Breezeway Daily Import → Run workflow**:

| Input | Effect |
|---|---|
| *(none)* | Import everything created in the last 30h |
| `date=2026-08-14` | Backfill that export day by filename prefix |
| `lookback_hours=168` | Widen the window to a week |
| `dry_run=true` | Download + classify + report, never POST |

Locally (same behavior, needs both secrets in your shell):

```bash
pip install -r scripts/requirements-breezeway.txt
export GOOGLE_SERVICE_ACCOUNT_JSON="$(cat sa.json)"
export BREEZEWAY_IMPORT_KEY=…
export DRIVE_FOLDER_ID=1XkEs242mTVZjulZiPW4zse9oa6y-sR0W
python scripts/breezeway_import.py --dry-run
```

Single file, bypassing the window: `--file-id <drive-file-id>` (repeatable).

Raw curl, if you have the CSV on disk:

```bash
curl -X POST 'https://app.tendwellcleaningco.com/api/tasks/breezeway-import?source=current_month' \
  -H 'Content-Type: text/csv' \
  -H "x-tendwell-import-key: $BREEZEWAY_IMPORT_KEY" \
  --data-binary @breezeway_export.csv
```

### Self-test

`scripts/breezeway_import_test.py` covers date parsing, label detection
(including the stray-row and backfill cases), column validation, BOM handling,
and file selection. No network or credentials. It runs as a step in the
workflow ahead of the import, and standalone:

```bash
cd scripts && python breezeway_import_test.py
```

---

## One-time setup

1. **`BREEZEWAY_IMPORT_KEY`** — `openssl rand -hex 32`. Set it in Vercel
   (Project → Settings → Environment Variables, Production + Preview) **and**
   as a GitHub Actions repo secret with the same value.
2. **`GOOGLE_SERVICE_ACCOUNT_JSON`** — create a service account in GCP with a
   JSON key, enable the **Google Drive API** on its project, then share Drive
   folder `1XkEs242mTVZjulZiPW4zse9oa6y-sR0W` with the service account's
   email as **Viewer**. Store the JSON (raw or base64) as a GitHub Actions
   repo secret. The script only requests `drive.readonly`.
3. **`SLACK_WEBHOOK_URL`** *(optional)* — repo secret; failure alerts.
4. Verify with a `dry_run=true` dispatch, then a real one.

The Apps Script side ("Breezeway Export to Drive", daily trigger ~7:33 AM ET,
dedupes threads via its `bz_processed_` properties) is already running and is
maintained outside this repo.

---

## Verifying a run

```sql
-- Recent imports (workflow runs land here, one row per file).
SELECT imported_at, source_label, rows_inserted, rows_failed,
       cleans_in_batch, deep_cleans_in_batch, notes
FROM breezeway_import_log
ORDER BY imported_at DESC
LIMIT 10;

-- Cleans by month, and how fresh each month is.
SELECT to_char(due_date, 'YYYY-MM') AS month,
       COUNT(*) AS total_tasks,
       COUNT(*) FILTER (WHERE is_clean) AS cleans,
       MAX(imported_at) AS last_import
FROM breezeway_tasks
GROUP BY 1 ORDER BY 1 DESC LIMIT 6;
```

A healthy day shows two `breezeway_import_log` rows with a `current_month` and
a `next_month` label. Two rows sharing a label is a warning in the run log —
rows still land correctly, only the reporting split is off.

---

## What "actual cleans" means

Each imported task is bucketed into one of three categories via two
boolean flags on `breezeway_tasks`:

| Bucket | `is_clean` | `is_deep_clean` |
|---|---|---|
| Regular cleans (revenue) | `true` | `false` |
| Deep cleans (separate pricing) | `false` | `true` |
| Inspections / maintenance / non-revenue | `false` | `false` |

The two flags are **mutually exclusive** so totals don't double-count.

### Counted as regular cleans (`is_clean = true`)

- `Departure Clean` (incl. variants like `Departure Clean - HT`)
- `Turn Clean`
- `Same Day Turn`
- `Arrival Clean`
- `Last Clean` (e.g. `Last Clean & Linen Pull`)
- `Onboarding Clean`

### Counted as deep cleans (`is_deep_clean = true`)

- `Deep Clean`

Deep cleans have their own cost AND income line item, so revenue rollups
should filter `WHERE is_deep_clean = true` separately from regular
`WHERE is_clean = true` rollups.

### Explicitly NOT counted (operator decision)

- `Vacancy Clean` — unbooked tidy, not a revenue event
- `Pre-Owner Stay Walkthrough`, `Cleaner Self-Inspection`, `Air Filter Change`,
  `Monthly Air Filter Change`, and other inspection / maintenance titles

Non-counted rows are still imported for completeness so the audit trail
stays full; downstream revenue rollups just filter them out.

---

## Troubleshooting

Start at the failed workflow run: the step summary table names the file, its
label, and the failure. Then:

| Symptom | Likely cause | Fix |
|---|---|---|
| `No Breezeway CSVs matched …` | Apps Script didn't write today, or the folder id changed | Check the Apps Script trigger's execution history; the log line prints the newest file in the folder for comparison |
| `Drive list failed … 404` | Folder not shared with the service account, or Drive API not enabled on its GCP project | Share the folder as Viewer; enable the Drive API |
| `GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON` | Secret truncated or newline-mangled | Re-paste, or store it base64-encoded (the script accepts either) |
| `missing expected column(s): …` | Breezeway renamed an export column | Update `REQUIRED_COLUMNS` here and `BreezewayRow` in `api/tasks/breezeway-import.ts` together |
| `HTTP 401 Invalid or missing x-tendwell-import-key` | Secret mismatch | The GitHub secret and the Vercel env var must hold the same value |
| `HTTP 503 BREEZEWAY_IMPORT_KEY not configured` | Env var missing on Vercel | Set it (Production + Preview) and redeploy |
| `HTTP 400 No valid rows parsed from CSV` | Empty/malformed export | Breezeway-side problem; re-run the Apps Script |
| `HTTP 500 Failed to upsert breezeway_tasks` | DB constraint or RLS | Check `breezeway_import_log.notes` and the Vercel runtime logs |
| Run is green, `unmatched_addresses_count` high | New property, or a name/address mismatch | Resolve on **API Sync → Breezeway**; the resolution persists for all future imports |
| `duplicate source label(s)` warning | Both exports covered the same month | Cosmetic — rows are correct, only the `source_label` split in `breezeway_import_log` is off |
| Missed a day entirely | Skipped scheduled run | The next run's 30h window usually covers it; otherwise dispatch with `date=YYYY-MM-DD` |

If Breezeway adds new clean variants, append a regex to
`CLEAN_TITLE_PATTERNS` (regular) or `DEEP_CLEAN_TITLE_PATTERNS` (deep) in
`api/tasks/breezeway-import.ts` and redeploy, then re-run this workflow with a
wide `lookback_hours` — the upsert rewrites `is_clean` / `is_deep_clean` on the
existing rows without duplicating them.
