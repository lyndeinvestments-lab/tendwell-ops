#!/usr/bin/env python3
"""
Breezeway daily CSV import — pulls two exports from Google Drive and
POSTs each to the Tendwell import endpoint.

Required env vars:
  GOOGLE_SERVICE_ACCOUNT_JSON  Service account credentials JSON (string, not path)
  BREEZEWAY_IMPORT_KEY         x-tendwell-import-key header value
  DRIVE_FOLDER_ID              Google Drive folder to search (default hardcoded below)

Optional:
  IMPORT_DATE                  Override today's date as YYYY-MM-DD (default: today)
  IMPORT_URL                   Override the target base URL
"""

import csv
import io
import json
import os
import sys
import time
from datetime import date, datetime

import requests
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

# ── config ───────────────────────────────────────────────────────────────────

DRIVE_FOLDER_ID = os.environ.get("DRIVE_FOLDER_ID", "1XkEs242mTVZjulZiPW4zse9oa6y-sR0W")
IMPORT_URL = os.environ.get("IMPORT_URL", "https://www.tendwellcleaning.com/api/tasks/breezeway-import")
BREEZEWAY_IMPORT_KEY = os.environ["BREEZEWAY_IMPORT_KEY"]
IMPORT_DATE_STR = os.environ.get("IMPORT_DATE", date.today().isoformat())
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 10

# ── helpers ───────────────────────────────────────────────────────────────────

def build_drive_service():
    sa_json = os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]
    creds_info = json.loads(sa_json)
    creds = service_account.Credentials.from_service_account_info(
        creds_info,
        scopes=["https://www.googleapis.com/auth/drive.readonly"],
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def search_csvs(drive, today: str):
    query = (
        f"title contains '{today}' "
        f"and '{DRIVE_FOLDER_ID}' in parents "
        f"and mimeType = 'text/csv' "
        f"and trashed = false"
    )
    result = drive.files().list(
        q=query,
        fields="files(id, name, createdTime)",
        orderBy="createdTime",
    ).execute()
    return result.get("files", [])


def download_csv(drive, file_id: str) -> bytes:
    request = drive.files().get_media(fileId=file_id)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue()


def detect_label(csv_bytes: bytes, today: date) -> str:
    reader = csv.DictReader(io.StringIO(csv_bytes.decode("utf-8-sig")))
    first_row = next(reader)
    due_date = date.fromisoformat(first_row["Due date"].strip())
    if due_date.year == today.year and due_date.month == today.month:
        return "current_month"
    return "next_month"


def post_with_retry(label: str, csv_bytes: bytes, filename: str) -> dict:
    url = f"{IMPORT_URL}?source={label}"
    headers = {
        "Content-Type": "text/csv",
        "x-tendwell-import-key": BREEZEWAY_IMPORT_KEY,
    }
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(url, data=csv_bytes, headers=headers, timeout=120)
            if resp.status_code == 200:
                body = resp.json()
                if body.get("ok"):
                    return body
                last_err = f"ok=false: {resp.text[:400]}"
            else:
                last_err = f"HTTP {resp.status_code}: {resp.text[:400]}"
        except requests.RequestException as exc:
            last_err = str(exc)

        if attempt < MAX_RETRIES:
            print(f"  [attempt {attempt}/{MAX_RETRIES}] {label} failed: {last_err} — retrying in {RETRY_DELAY_SECONDS}s", flush=True)
            time.sleep(RETRY_DELAY_SECONDS)

    raise RuntimeError(f"All {MAX_RETRIES} attempts failed for {filename} ({label}): {last_err}")


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    today_str = IMPORT_DATE_STR
    today = date.fromisoformat(today_str)
    print(f"[{today_str}] Starting Breezeway import", flush=True)

    drive = build_drive_service()

    # Step 1 — find today's files
    files = search_csvs(drive, today_str)
    if len(files) != 2:
        msg = f"WARNING: Expected 2 CSVs for {today_str}, found {len(files)}."
        print(msg, flush=True)
        sys.exit(1)

    print(f"  Found {len(files)} CSV files: {[f['name'] for f in files]}", flush=True)

    # Step 2 — download
    file_data = []
    for f in files:
        csv_bytes = download_csv(drive, f["id"])
        file_data.append({"meta": f, "bytes": csv_bytes})
        print(f"  Downloaded {f['name']} ({len(csv_bytes):,} bytes)", flush=True)

    # Step 3 — label
    for item in file_data:
        item["label"] = detect_label(item["bytes"], today)
        print(f"  {item['meta']['name']} → {item['label']} (first Due date row)", flush=True)

    labels = [item["label"] for item in file_data]
    if labels[0] == labels[1]:
        msg = (
            f"WARNING: Both CSVs produced the same label '{labels[0]}'. "
            f"File 1: {file_data[0]['meta']['name']}, "
            f"File 2: {file_data[1]['meta']['name']}. "
            "Halting — do not POST either."
        )
        print(msg, flush=True)
        sys.exit(1)

    # Step 4+5 — POST and verify
    results = {}
    for item in file_data:
        label = item["label"]
        filename = item["meta"]["name"]
        print(f"  POSTing {filename} as {label}…", flush=True)
        resp = post_with_retry(label, item["bytes"], filename)
        results[label] = {"resp": resp, "filename": filename}

        if resp.get("unmatched_addresses_count", 0) > 0:
            samples = resp.get("sample_unmatched_addresses", [])
            print(
                f"  WARNING: {label} — {resp['unmatched_addresses_count']} unmatched addresses. "
                f"Samples: {samples}",
                flush=True,
            )

    # Step 6 — summary
    parts = []
    for label in ("current_month", "next_month"):
        if label in results:
            r = results[label]["resp"]
            fname = results[label]["filename"]
            parts.append(
                f"{label}: {r.get('rows_upserted', '?')} upserted, "
                f"{r.get('cleans_in_batch', '?')} cleans ({fname})"
            )
    summary = f"[{today_str}] " + " | ".join(parts)
    print(summary, flush=True)


if __name__ == "__main__":
    main()
