#!/usr/bin/env python3
"""Breezeway daily CSV import: Google Drive -> Tendwell.

Companion to `docs/breezeway-agent-instructions.md`. Run by
`.github/workflows/breezeway-import.yml` once a day, and manually via
`workflow_dispatch` for backfills.

Pipeline:

    Breezeway scheduled email export
      -> Apps Script "Breezeway Export to Drive" (daily ~7:33 AM ET)
      -> Drive folder DRIVE_FOLDER_ID (two CSVs/day, ~11:33 UTC)
      -> [this script]
      -> POST /api/tasks/breezeway-import?source=current_month|next_month
      -> breezeway_tasks (upsert on external_id) + breezeway_import_log

FILE SELECTION is by Drive `createdTime` window, NOT by the date prefix in
the filename. The two are usually the same day, but a manual Apps Script run
writes a file whose name carries the Breezeway export date while landing in
Drive later (observed: `2026-08-18_16-35-24_...csv` created 2026-08-19T01:29Z).
A createdTime window catches those; a name-prefix filter silently drops them.
`--date` switches to name-prefix matching for backfilling a specific export day.

Re-posting a file is harmless: the endpoint's identity is
sha256(created_date|property|task_title|due_date), so upserts overwrite in
place and never duplicate.

Env:
  GOOGLE_SERVICE_ACCOUNT_JSON  (required) service account JSON, raw or base64
  BREEZEWAY_IMPORT_KEY         (required) shared secret for the endpoint
  DRIVE_FOLDER_ID              (required) folder the Apps Script writes to
  TENDWELL_BASE_URL            default https://app.tendwellcleaningco.com
  SLACK_WEBHOOK_URL            optional; posts a message on failure
  LOOKBACK_HOURS               default 30 (covers today's drop and yesterday's,
                               so a skipped run self-heals on the next one)
  BUSINESS_TZ                  default America/New_York
  UNMATCHED_WARN_THRESHOLD     default 10

Exit codes: 0 all posted, 1 something failed (or nothing found).
"""

from __future__ import annotations

import argparse
import base64
import binascii
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Iterable
from zoneinfo import ZoneInfo

import requests
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseDownload

DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

# `2026-08-18_03-15-53_1a013ba0_breezeway-task-custom-export.csv`
FILENAME_DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})_")

# Columns the endpoint's BreezewayRow interface reads. A Breezeway-side export
# change that drops one of these is worth failing loudly on here rather than
# discovering as silently-null columns in breezeway_tasks.
REQUIRED_COLUMNS = ("Task title", "Property", "Due date", "Created date", "Status")

# The Apps Script drops files at ~11:33 UTC and the workflow runs at 13:00 UTC.
# A 24h window would start at 13:00 the previous day — only ~1h30m of margin
# ahead of the drop, and nothing to fall back on if a run is skipped (GitHub
# does drop scheduled runs under load). 30h reaches back past yesterday's drop
# too, so a missed day self-heals on the next run. Re-posting is free: the
# endpoint upserts on a content-derived external_id, and files are posted
# oldest-first so the freshest export always writes last.
DEFAULT_LOOKBACK_HOURS = 30

POST_ATTEMPTS = 3
POST_TIMEOUT_S = 120
MAX_FILES = 40


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def log(msg: str) -> None:
    print(msg, flush=True)


def env(name: str, default: str | None = None, *, required: bool = False) -> str:
    val = (os.environ.get(name) or "").strip()
    if not val:
        if required:
            die(f"Missing required env var {name}")
        return default or ""
    return val


def die(msg: str) -> None:
    log(f"::error::{msg}")
    raise SystemExit(1)


def env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        log(f"::warning::{name}={raw!r} is not an integer; using {default}")
        return default


def load_credentials() -> service_account.Credentials:
    raw = env("GOOGLE_SERVICE_ACCOUNT_JSON", required=True)
    # Accept base64 too — pasting raw JSON into a secret survives fine, but
    # base64 avoids newline mangling in some secret stores.
    if not raw.lstrip().startswith("{"):
        try:
            raw = base64.b64decode(raw, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError) as e:
            die(f"GOOGLE_SERVICE_ACCOUNT_JSON is neither JSON nor valid base64: {e}")
    try:
        info = json.loads(raw)
    except json.JSONDecodeError as e:
        die(f"GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: {e}")
    try:
        return service_account.Credentials.from_service_account_info(info, scopes=DRIVE_SCOPES)
    except ValueError as e:
        die(f"GOOGLE_SERVICE_ACCOUNT_JSON is not a usable service account key: {e}")


# --------------------------------------------------------------------------
# Drive
# --------------------------------------------------------------------------


@dataclass
class DriveFile:
    id: str
    name: str
    created_time: str
    size: int

    @property
    def export_date(self) -> dt.date | None:
        """The Breezeway export date encoded in the filename, if present."""
        m = FILENAME_DATE_RE.match(self.name)
        if not m:
            return None
        try:
            return dt.date.fromisoformat(m.group(1))
        except ValueError:
            return None


def list_candidates(drive: Any, folder_id: str) -> list[DriveFile]:
    """Newest-first CSVs in the folder. One page is plenty (2 files/day)."""
    q = f"'{folder_id}' in parents and trashed = false"
    try:
        resp = (
            drive.files()
            .list(
                q=q,
                orderBy="createdTime desc",
                pageSize=MAX_FILES,
                fields="files(id, name, createdTime, size, mimeType)",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            )
            .execute()
        )
    except HttpError as e:
        die(
            f"Drive list failed for folder {folder_id}: {e}. "
            "Confirm the folder id and that it is shared with the service account."
        )
    out: list[DriveFile] = []
    for f in resp.get("files", []):
        name = f.get("name", "")
        if not name.lower().endswith(".csv") and f.get("mimeType") != "text/csv":
            continue
        out.append(
            DriveFile(
                id=f["id"],
                name=name,
                created_time=f.get("createdTime", ""),
                size=int(f.get("size") or 0),
            )
        )
    return out


def select_files(
    candidates: list[DriveFile],
    *,
    since: dt.datetime | None,
    export_date: dt.date | None,
    file_ids: list[str],
) -> list[DriveFile]:
    if file_ids:
        by_id = {f.id: f for f in candidates}
        picked = []
        for fid in file_ids:
            if fid in by_id:
                picked.append(by_id[fid])
            else:
                log(f"::warning::--file-id {fid} not found in folder listing")
        return picked

    if export_date is not None:
        return [f for f in candidates if f.export_date == export_date]

    assert since is not None
    picked = []
    for f in candidates:
        try:
            created = dt.datetime.fromisoformat(f.created_time.replace("Z", "+00:00"))
        except ValueError:
            log(f"::warning::unparseable createdTime {f.created_time!r} on {f.name}; skipping")
            continue
        if created >= since:
            picked.append(f)
    return picked


def download(drive: Any, file: DriveFile) -> bytes:
    buf = io.BytesIO()
    req = drive.files().get_media(fileId=file.id, supportsAllDrives=True)
    downloader = MediaIoBaseDownload(buf, req, chunksize=1024 * 1024)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue()


# --------------------------------------------------------------------------
# label detection
# --------------------------------------------------------------------------


def parse_due_date(raw: str | None) -> dt.date | None:
    if not raw:
        return None
    s = raw.strip()
    if not s:
        return None
    # Breezeway emits ISO, but exports have historically also carried
    # `MM/DD/YYYY` and `YYYY-MM-DD HH:MM` shapes depending on the account's
    # locale settings. Try the plausible set rather than trusting one.
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return dt.datetime.strptime(s[:10], fmt).date()
        except ValueError:
            pass
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except ValueError:
        return None


@dataclass
class CsvSummary:
    rows: int
    label: str | None
    first_due: dt.date | None
    dominant_month: tuple[int, int] | None
    month_counts: Counter = field(default_factory=Counter)
    missing_columns: list[str] = field(default_factory=list)


def summarize_csv(data: bytes, reference_month: tuple[int, int]) -> CsvSummary:
    """Classify a CSV as the current-month or next-month export.

    The runbook's original rule read only row 2's `Due date`. This uses the
    modal Due-date month across every row instead: one stray row (a task
    rescheduled out of the window, a blank due date) can't flip the label,
    and `reference_month` is the file's own export month rather than "today",
    so backfilling an old export still labels correctly.
    """
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    fieldnames = [(h or "").strip() for h in (reader.fieldnames or [])]
    missing = [c for c in REQUIRED_COLUMNS if c not in fieldnames]

    months: Counter = Counter()
    first_due: dt.date | None = None
    rows = 0
    for row in reader:
        rows += 1
        due = parse_due_date(row.get("Due date"))
        if due is None:
            continue
        if first_due is None:
            first_due = due
        months[(due.year, due.month)] += 1

    dominant = months.most_common(1)[0][0] if months else None
    label: str | None
    if dominant is None:
        label = None
    elif dominant == reference_month:
        label = "current_month"
    else:
        label = "next_month"

    return CsvSummary(
        rows=rows,
        label=label,
        first_due=first_due,
        dominant_month=dominant,
        month_counts=months,
        missing_columns=missing,
    )


def month_str(m: tuple[int, int] | None) -> str:
    return f"{m[0]:04d}-{m[1]:02d}" if m else "?"


# --------------------------------------------------------------------------
# POST
# --------------------------------------------------------------------------


def post_csv(base_url: str, key: str, label: str | None, data: bytes) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}/api/tasks/breezeway-import"
    if label:
        url += f"?source={label}"
    headers = {"Content-Type": "text/csv", "x-tendwell-import-key": key}

    last_err = "unknown error"
    for attempt in range(1, POST_ATTEMPTS + 1):
        try:
            resp = requests.post(url, headers=headers, data=data, timeout=POST_TIMEOUT_S)
        except requests.RequestException as e:
            last_err = f"network error: {e}"
        else:
            if resp.status_code == 200:
                try:
                    body = resp.json()
                except ValueError:
                    last_err = f"HTTP 200 with non-JSON body: {resp.text[:300]}"
                else:
                    if body.get("ok") is True:
                        return body
                    last_err = f"HTTP 200 but ok!=true: {json.dumps(body)[:300]}"
            elif resp.status_code in (429,) or resp.status_code >= 500:
                last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"
            else:
                # 4xx other than 429 is a config/content problem — a retry
                # sends the identical bytes with the identical key and fails
                # identically, so stop and surface it.
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")

        if attempt < POST_ATTEMPTS:
            backoff = 2**attempt
            log(f"    attempt {attempt}/{POST_ATTEMPTS} failed ({last_err}); retrying in {backoff}s")
            time.sleep(backoff)

    raise RuntimeError(last_err)


# --------------------------------------------------------------------------
# reporting
# --------------------------------------------------------------------------


@dataclass
class Result:
    file: DriveFile
    label: str | None
    summary: CsvSummary | None = None
    response: dict[str, Any] | None = None
    error: str | None = None
    skipped: bool = False

    @property
    def ok(self) -> bool:
        return self.error is None and (self.response is not None or self.skipped)


def write_step_summary(lines: Iterable[str]) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    except OSError as e:
        log(f"::warning::could not write step summary: {e}")


def notify_slack(text: str) -> None:
    hook = env("SLACK_WEBHOOK_URL")
    if not hook:
        return
    try:
        requests.post(hook, json={"text": text}, timeout=20)
    except requests.RequestException as e:
        log(f"::warning::Slack notification failed: {e}")


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description="Import Breezeway CSV exports from Drive into Tendwell.")
    ap.add_argument(
        "--date",
        help="Backfill mode: import files whose filename starts with this YYYY-MM-DD export date "
        "(instead of the createdTime window).",
    )
    ap.add_argument(
        "--lookback-hours",
        type=int,
        help="Import files created within this many hours (default LOOKBACK_HOURS or 30).",
    )
    ap.add_argument("--file-id", action="append", default=[], help="Import a specific Drive file id (repeatable).")
    ap.add_argument("--dry-run", action="store_true", help="Download and classify, but do not POST.")
    args = ap.parse_args()

    base_url = env("TENDWELL_BASE_URL", "https://app.tendwellcleaningco.com")
    folder_id = env("DRIVE_FOLDER_ID", required=True)
    import_key = env("BREEZEWAY_IMPORT_KEY", required=True)
    business_tz = ZoneInfo(env("BUSINESS_TZ", "America/New_York"))
    unmatched_warn = env_int("UNMATCHED_WARN_THRESHOLD", 10)
    lookback = args.lookback_hours if args.lookback_hours is not None else env_int("LOOKBACK_HOURS", DEFAULT_LOOKBACK_HOURS)

    export_date: dt.date | None = None
    if args.date:
        try:
            export_date = dt.date.fromisoformat(args.date)
        except ValueError:
            die(f"--date must be YYYY-MM-DD, got {args.date!r}")

    now_utc = dt.datetime.now(dt.timezone.utc)
    since = now_utc - dt.timedelta(hours=lookback)

    if args.file_id:
        scope = f"file ids {', '.join(args.file_id)}"
    elif export_date:
        scope = f"export date {export_date.isoformat()}"
    else:
        scope = f"created since {since.isoformat(timespec='seconds')} (lookback {lookback}h)"
    log(f"Breezeway import — folder {folder_id}, {scope}")

    drive = build("drive", "v3", credentials=load_credentials(), cache_discovery=False)
    candidates = list_candidates(drive, folder_id)
    log(f"Folder listing: {len(candidates)} CSV file(s) (newest {MAX_FILES})")

    files = select_files(candidates, since=since, export_date=export_date, file_ids=args.file_id)
    if not files:
        newest = candidates[0] if candidates else None
        detail = f" Newest in folder: {newest.name} (created {newest.created_time})." if newest else ""
        msg = f"No Breezeway CSVs matched {scope}.{detail}"
        log(f"::error::{msg}")
        write_step_summary(["## Breezeway import — FAILED", "", msg])
        notify_slack(f":rotating_light: Breezeway import found no CSVs to import. {msg}")
        return 1

    # Oldest first so that when two exports overlap, the newer one lands last
    # and wins on the shared external_id rows.
    files.sort(key=lambda f: f.created_time)
    log(f"Selected {len(files)} file(s):")
    for f in files:
        log(f"  - {f.name} ({f.size:,} bytes, created {f.created_time})")

    results: list[Result] = []
    for f in files:
        log(f"\n{f.name}")
        try:
            data = download(drive, f)
        except HttpError as e:
            log(f"::error::download failed: {e}")
            results.append(Result(file=f, label=None, error=f"download failed: {e}"))
            continue

        ref_date = f.export_date or now_utc.astimezone(business_tz).date()
        summary = summarize_csv(data, (ref_date.year, ref_date.month))

        if summary.missing_columns:
            # Don't post a CSV whose shape the endpoint can't read — it would
            # return 200 while writing rows with null titles/dates.
            err = f"missing expected column(s): {', '.join(summary.missing_columns)}"
            log(f"::error::{err}")
            results.append(Result(file=f, label=None, summary=summary, error=err))
            continue

        if summary.rows == 0:
            err = "CSV has a header but no data rows"
            log(f"::error::{err}")
            results.append(Result(file=f, label=None, summary=summary, error=err))
            continue

        log(
            f"  rows={summary.rows} first_due={summary.first_due} "
            f"dominant_due_month={month_str(summary.dominant_month)} "
            f"ref_month={ref_date.year:04d}-{ref_date.month:02d} -> label={summary.label or '(none)'}"
        )
        if summary.label is None:
            log("::warning::no parseable Due date in any row; posting without a source label")

        if args.dry_run:
            log("  dry run — not posting")
            results.append(Result(file=f, label=summary.label, summary=summary, skipped=True))
            continue

        try:
            body = post_csv(base_url, import_key, summary.label, data)
        except RuntimeError as e:
            log(f"::error::POST failed: {e}")
            results.append(Result(file=f, label=summary.label, summary=summary, error=str(e)))
            continue

        log(
            f"  posted: {body.get('rows_upserted')} upserted, "
            f"{body.get('rows_skipped')} skipped, {body.get('cleans_in_batch')} cleans, "
            f"{body.get('deep_cleans_in_batch')} deep, "
            f"{body.get('unmatched_addresses_count')} unmatched"
        )
        unmatched = body.get("unmatched_addresses_count") or 0
        if unmatched >= unmatched_warn:
            log(
                f"::warning::{unmatched} unmatched propert(ies) in {f.name}: "
                f"{', '.join(body.get('sample_unmatched_addresses') or [])} — "
                "resolve them on API Sync -> Breezeway"
            )
        results.append(Result(file=f, label=summary.label, summary=summary, response=body))

    posted = [r for r in results if r.response]
    labels = [r.label for r in posted if r.label]
    if len(labels) != len(set(labels)):
        # Both daily exports carrying the same label means one of them
        # overwrote the other's source_label; rows still land, but the
        # current/next split in breezeway_import_log is wrong.
        log(f"::warning::duplicate source label(s) across files this run: {labels}")

    failures = [r for r in results if not r.ok]

    lines = ["## Breezeway import", ""]
    lines.append(f"Scope: {scope}")
    lines.append("")
    lines.append("| File | Label | Rows | Upserted | Cleans | Deep | Unmatched | Status |")
    lines.append("|---|---|---:|---:|---:|---:|---:|---|")
    for r in results:
        b = r.response or {}
        status = "dry run" if r.skipped else ("ok" if r.response else f"FAILED — {r.error}")
        lines.append(
            f"| `{r.file.name}` | {r.label or '—'} | {r.summary.rows if r.summary else '—'} "
            f"| {b.get('rows_upserted', '—')} | {b.get('cleans_in_batch', '—')} "
            f"| {b.get('deep_cleans_in_batch', '—')} | {b.get('unmatched_addresses_count', '—')} | {status} |"
        )
    write_step_summary(lines)

    total_upserted = sum((r.response or {}).get("rows_upserted") or 0 for r in results)
    total_cleans = sum((r.response or {}).get("cleans_in_batch") or 0 for r in results)
    log(
        f"\nDone: {len(posted)}/{len(files)} posted, "
        f"{total_upserted:,} rows upserted, {total_cleans:,} cleans"
    )

    if failures:
        detail = "; ".join(f"{r.file.name}: {r.error}" for r in failures)
        log(f"::error::{len(failures)} file(s) failed — {detail}")
        notify_slack(
            f":rotating_light: Breezeway import: {len(failures)} of {len(files)} file(s) failed.\n{detail}"
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
