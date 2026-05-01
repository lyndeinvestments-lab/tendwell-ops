# Breezeway Daily CSV Import — Cloud Agent Runbook

This is the prompt/runbook to feed to your cloud agent (Replit Scheduler,
n8n, GitHub Actions cron, Cloudflare Worker, etc.) so it can pull the two
daily Breezeway exports out of Google Drive and POST them to Tendwell.

> **Why not Claude Code on web?**
> The Claude Code on-web agent runs inside a sandboxed environment whose
> outbound traffic is proxied through an allowlist that cannot be modified
> at runtime. Even with `dangerouslyDisableSandbox` set, the proxy rejects
> connections to hosts outside that allowlist (you'll see `Host not in
> allowlist` / HTTP 403). This job **must run from an environment with
> unrestricted outbound internet** — GitHub Actions, n8n, a Replit
> Scheduler, a Cloudflare Worker, or a self-hosted cron. Claude Code is
> fine for one-off tasks and code changes, but not for scheduled HTTP egress.

---

## What changed (vs. the old Gmail-based flow)

| | Old | New |
|---|---|---|
| **CSV source** | Gmail attachment (subject-line match) | Google Drive folder |
| **Folder** | — | `1XkEs242mTVZjulZiPW4zse9oa6y-sR0W` |
| **File naming** | Per email subject | `YYYY-MM-DD_<time>_<id>_breezeway-task-custom-export.csv` |
| **Label detection** | Email subject ("Current Month" / "Next Month") | First data row's `Due date` column — if the month matches the current calendar month → `current_month`, otherwise → `next_month` |

---

## What Tendwell expects

Tendwell exposes a single endpoint that swallows a Breezeway CSV and
upserts the rows into the `breezeway_tasks` table. It is idempotent — a
row's stable identity is `sha256(created_date | property | task_title | due_date)`,
so re-imports are safe and the two daily exports deduplicate naturally
where their date windows overlap.

```
POST https://www.tendwellcleaning.com/api/tasks/breezeway-import?source=<LABEL>
Headers:
  Content-Type: text/csv
  x-tendwell-import-key: <BREEZEWAY_IMPORT_KEY>
Body:
  <raw CSV bytes>
```

`<LABEL>` is one of `current_month` or `next_month`.

`<BREEZEWAY_IMPORT_KEY>` is a long random string. Generate one
(`openssl rand -hex 32`), set it on Vercel under
`Project → Settings → Environment Variables → BREEZEWAY_IMPORT_KEY`
(Production + Preview), and store the same value in your agent's secret
manager.

A successful response looks like:

```json
{
  "ok": true,
  "batch": "ad21…",
  "source": "current_month",
  "rows_seen": 312,
  "rows_upserted": 311,
  "rows_skipped": 1,
  "cleans_in_batch": 184,
  "unmatched_addresses_count": 2,
  "sample_unmatched_addresses": ["…", "…"]
}
```

`unmatched_addresses_count > 0` means the row landed in `breezeway_tasks`
but couldn't be linked to a `properties` row (the address fragment after
` - ` in Breezeway's `Property` column didn't match any stored
`properties.address`). Worth a quick look — usually a typo on either side.

---

## Agent prompt (copy/paste into your agent)

> You run once per day. Your job:
>
> 1. Search Google Drive folder `1XkEs242mTVZjulZiPW4zse9oa6y-sR0W` for
>    CSV files whose name starts with today's date in `YYYY-MM-DD` format
>    (e.g. `2026-05-01_…csv`). There should be exactly two.
>
> 2. For each matching CSV:
>    1. Download the raw CSV content.
>    2. Read the **first data row** (row 2, after the header) and look at
>       the `Due date` column.
>    3. Determine the source label:
>       - If the `Due date` month matches **the current calendar month** → `current_month`
>       - Otherwise → `next_month`
>    4. POST the raw CSV bytes to:
>       ```
>       https://www.tendwellcleaning.com/api/tasks/breezeway-import?source=<LABEL>
>       ```
>       with these headers:
>       ```
>       Content-Type: text/csv
>       x-tendwell-import-key: <secret from your secret store>
>       ```
>    5. Verify the response is HTTP 200 with `"ok": true`.
>
> 3. If fewer than two CSVs are found for today, OR a POST returns non-200,
>    OR `ok` is not `true`, send an alert (Slack / email) with the failure
>    reason. Do not retry more than 3 times per file.
>
> 4. Log a one-line summary, e.g.:
>    `[2026-05-01] current_month: 311 upserted, 184 cleans (2026-05-01_13-48-09_…csv); next_month: 220 upserted, 142 cleans (2026-05-01_14-15-41_…csv)`

---

## Label detection — detailed logic

```python
import csv, io, datetime

def detect_label(csv_bytes: bytes) -> str:
    reader = csv.DictReader(io.StringIO(csv_bytes.decode("utf-8-sig")))
    first_row = next(reader)
    due_date = datetime.date.fromisoformat(first_row["Due date"])
    today = datetime.date.today()
    if due_date.year == today.year and due_date.month == today.month:
        return "current_month"
    return "next_month"
```

The CSV header row is:
```
Task title,Property,Department,Assignees,Due date,Issues,Comments,Status,Priority,Total cost,Currency (Total cost),Estimated time,Created date,Created by,Completed date,Completed by,Last updated date,Property Time Zone
```

Note the UTF-8 BOM (`﻿`) — strip it with `utf-8-sig` encoding.

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

If Breezeway adds new clean variants in the future, append a regex to
`api/tasks/breezeway-import.ts:CLEAN_TITLE_PATTERNS` (regular) or
`DEEP_CLEAN_TITLE_PATTERNS` (deep) and re-deploy. Re-POSTing today's
CSVs is safe — the upsert overwrites `is_clean` / `is_deep_clean` from
the new pattern set without duplicating rows.

---

## Manual test (one-off)

```bash
curl -X POST 'https://www.tendwellcleaning.com/api/tasks/breezeway-import?source=current_month' \
  -H 'Content-Type: text/csv' \
  -H "x-tendwell-import-key: $BREEZEWAY_IMPORT_KEY" \
  --data-binary @breezeway_export.csv
```

Expected: HTTP 200 + JSON summary.

To inspect what landed:

```sql
-- Run from the Supabase SQL editor.
SELECT date_trunc('month', due_date) AS month,
       COUNT(*) FILTER (WHERE is_clean) AS cleans,
       COUNT(*) AS total_tasks
FROM breezeway_tasks
GROUP BY 1
ORDER BY 1 DESC
LIMIT 6;

SELECT imported_at, source_label, rows_inserted, cleans_in_batch, notes
FROM breezeway_import_log
ORDER BY imported_at DESC
LIMIT 10;
```

---

## Troubleshooting

| Response | Likely cause | Fix |
|---|---|---|
| `401 Invalid or missing x-tendwell-import-key` | Secret mismatch | Re-check the env var in Vercel + your agent's secret store |
| `503 BREEZEWAY_IMPORT_KEY not configured on server` | Env var not set on Vercel | Set it under Project → Settings → Environment Variables, redeploy |
| `400 CSV header parse error` | Breezeway changed column names | Check `BreezewayRow` interface in `api/tasks/breezeway-import.ts` |
| `400 No valid rows parsed from CSV` | Empty / malformed export | Investigate Breezeway-side; agent should alert |
| `500 Failed to upsert breezeway_tasks` | DB constraint violation or RLS | Check `breezeway_import_log.notes` and Vercel runtime logs |
| `200 ok` but `unmatched_addresses_count > 0` | Address typo or property not yet in Tendwell | Compare `sample_unmatched_addresses` against `properties.address` |
| No CSVs found for today in Drive | Breezeway didn't export / wrong folder | Verify folder ID and that the export ran in Breezeway |
| Both files detected as same label | First data row has unexpected date | Log both filenames + their first `Due date` values and alert |

---

## Recommended GitHub Actions setup

```yaml
# .github/workflows/breezeway-import.yml
name: Breezeway Daily Import
on:
  schedule:
    - cron: '30 12 * * *'   # 7:30 AM Eastern (UTC-5 standard / UTC-4 DST — adjust as needed)
  workflow_dispatch:          # allow manual trigger

jobs:
  import:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install google-api-python-client google-auth requests
      - name: Run import
        env:
          GOOGLE_SERVICE_ACCOUNT_JSON: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
          BREEZEWAY_IMPORT_KEY: ${{ secrets.BREEZEWAY_IMPORT_KEY }}
          DRIVE_FOLDER_ID: 1XkEs242mTVZjulZiPW4zse9oa6y-sR0W
        run: python scripts/breezeway_import.py
```

The Python script (`scripts/breezeway_import.py`) should implement the
agent prompt logic above using the Google Drive API v3 with a service
account. Grant the service account **Viewer** access to the Drive folder.

---

## What this enables (downstream, separate PR)

Once the import is running, the Live Pro Forma can be wired to read from
`breezeway_tasks` instead of the Tendwell-internal `tasks` table:

```sql
-- Cleans completed in a given month, per property
SELECT property_id, COUNT(*) AS cleans
FROM breezeway_tasks
WHERE is_clean = true
  AND status = 'Finished'
  AND completed_date >= '2026-04-01'
  AND completed_date <  '2026-05-01'
GROUP BY property_id;
```

That wiring is intentionally NOT in this PR — first confirm the import
pipeline runs cleanly end-to-end for a few days before swapping the
forecaster's data source.
