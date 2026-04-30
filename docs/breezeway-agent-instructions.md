# Breezeway Daily CSV Import — Cloud Agent Runbook

This is the prompt/runbook to feed to your cloud agent (Replit Scheduler,
n8n, GitHub Actions cron, Cloudflare Worker, etc.) so it can pull the two
daily Breezeway exports from Google Drive and POST them to Tendwell.

---

## What Tendwell expects

Tendwell exposes a single endpoint that swallows a Breezeway CSV and
upserts the rows into the `breezeway_tasks` table. It is idempotent — a
row's stable identity is `sha256(created_date | property | task_title | due_date)`,
so re-imports are safe and the two daily exports (current month + next
month) deduplicate naturally where their date windows overlap.

```
POST https://www.tendwellcleaning.com/api/tasks/breezeway-import?source=<LABEL>
Headers:
  Content-Type: text/csv
  x-tendwell-import-key: <BREEZEWAY_IMPORT_KEY>
Body:
  <raw CSV bytes from the Breezeway email attachment>
```

`<LABEL>` is one of `current_month` or `next_month` so the import log can
attribute the batch.

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
`properties.address`). Worth a quick look — usually a typo on either
side.

---

## How the pipeline works

A Google Apps Script runs at **7:30 AM Eastern** every day. It watches for
emails from `notifications@breezeway.io` with subject `Breezeway export is
ready.` received that same day, downloads each CSV attachment, and saves it
to the Google Drive folder:

**Drive folder ID:** `1XkEs242mTVZjulZiPW4zse9oa6y-sR0W`

Files are named: `YYYY-MM-DD_HH-mm-ss_<msgIdShort>_breezeway-task-custom-export.csv`

Per-message deduplication via Google Apps Script `PropertiesService` ensures
both emails (when two arrive the same day) are always saved as separate files
even though they have the same name and sender.

The Claude Code `/loop` agent runs at **8 AM Eastern** (after the Drive files
are guaranteed to exist) and does the actual import.

---

## Agent prompt (copy/paste into your agent / `/loop` command)

> You run once per day at 8:00 AM Eastern. Your job:
>
> 1. Search the Google Drive folder `1XkEs242mTVZjulZiPW4zse9oa6y-sR0W`
>    for CSV files whose filename starts with today's date (`YYYY-MM-DD`).
>    There should be exactly two. If there are zero or one, log a warning
>    and stop — the Google Apps Script may not have run yet.
>
> 2. For each file, determine the source label by peeking at the first data
>    row's `Due date` column:
>    - Due date falls in the current calendar month → `current_month`
>    - Due date falls in the next calendar month → `next_month`
>    (When Breezeway sends two exports the same day, the larger file
>    (more rows) is typically current month and the smaller is next month,
>    but always verify from content.)
>
> 3. For each file:
>    1. Download the raw CSV bytes from Drive.
>    2. POST to:
>       ```
>       https://www.tendwellcleaning.com/api/tasks/breezeway-import?source=<LABEL>
>       ```
>       with these headers:
>       ```
>       Content-Type: text/csv
>       x-tendwell-import-key: <secret from your secret store>
>       ```
>    3. Verify the response is HTTP 200 with `"ok": true`.
>
> 4. If either file is missing, OR the POST returns non-200, OR `ok` is
>    not `true`, log the failure reason. Do not retry more than 3 times.
>
> 5. Log a one-line summary per import run, e.g.:
>    `[2026-04-30 08:01] current_month: 311 upserted, 184 cleans; next_month: 220 upserted, 142 cleans`

---

## What "actual cleans" means

Only rows whose `Task title` contains `Departure Clean` or `Turn Clean`
(case-insensitive) are flagged with `is_clean = true` in the database.
Everything else (Air Filter Change, Pre-Owner Stay Walkthrough,
Maintenance, etc.) is still imported for completeness, but downstream
revenue/cleans rollups filter to `is_clean = true` only — that's the
business rule.

If Breezeway adds new clean variants in the future (e.g. `Initial Clean`),
update the regex in `api/tasks/breezeway-import.ts:CLEAN_TITLE_PATTERNS`.

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
| `401 Invalid or missing x-tendwell-import-key` | Secret mismatch | Re-check the env var in Vercel + your agent's secret store match |
| `503 BREEZEWAY_IMPORT_KEY not configured on server` | Env var not set on Vercel | Set it under Project → Settings → Environment Variables, redeploy |
| `400 CSV header parse error` | Breezeway changed column names | Check `BreezewayRow` interface in `api/tasks/breezeway-import.ts` and update |
| `400 No valid rows parsed from CSV` | Empty / malformed export | Investigate Breezeway-side; agent should alert |
| `500 Failed to upsert breezeway_tasks` | DB constraint violation or RLS | Check `breezeway_import_log.notes` and Vercel runtime logs |
| `200 ok` but `unmatched_addresses_count > 0` | Address typo or property not in tendwell yet | Compare returned `sample_unmatched_addresses` against `properties.address` |

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

…and Per-Property `avg_cleans_per_month` can be derived from a rolling
60-day window of completed cleans / 2.

That wiring is intentionally NOT in this PR — first job is to confirm
the import pipeline runs cleanly end-to-end for a few days before we
swap forecaster's data source.
