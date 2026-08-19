#!/usr/bin/env python3
"""Self-test for the pure logic in breezeway_import.py.

Runs before the daily import in CI (fast, no network, no credentials) so a
regression in label detection or column validation fails visibly instead of
mislabelling months in breezeway_import_log.

Header names and the ISO `Due date` format are taken from the real export
shape stored in `breezeway_tasks.raw`.
"""

from __future__ import annotations

import datetime as dt
import sys

from breezeway_import import (
    DEFAULT_LOOKBACK_HOURS,
    DriveFile,
    parse_due_date,
    select_files,
    summarize_csv,
)

HEADER = (
    "Task title,Property,Department,Assignees,Due date,Issues,Comments,Status,Priority,"
    "Total cost,Currency (Total cost),Estimated time,Created date,Created by,"
    "Completed date,Completed by,Last updated date,Property Time Zone"
)

failures: list[str] = []


def check(label: str, got: object, want: object) -> None:
    if got != want:
        failures.append(f"{label}: got {got!r}, want {want!r}")


def row(title: str, due: str, created: str = "2026-08-01") -> str:
    prop = "Bobby Nicely 1132 (SCounty) - 1132 Sanctuary Shrs Wy"
    return f"{title},\"{prop}\",Cleaning,Someone,{due},,,Finished,Normal,120,USD,120,{created},BW,,,,America/New_York"


def csv_bytes(rows: list[str], *, bom: bool = False) -> bytes:
    text = "\n".join([HEADER, *rows]) + "\n"
    return (("﻿" if bom else "") + text).encode("utf-8")


# --- Due date parsing ------------------------------------------------------
check("iso", parse_due_date("2026-08-18"), dt.date(2026, 8, 18))
check("iso+time", parse_due_date("2026-08-18 14:00"), dt.date(2026, 8, 18))
check("us", parse_due_date("08/18/2026"), dt.date(2026, 8, 18))
check("blank", parse_due_date(""), None)
check("none", parse_due_date(None), None)
check("garbage", parse_due_date("not a date"), None)

# --- label detection -------------------------------------------------------
# Export taken in August whose tasks are mostly due in August.
s = summarize_csv(csv_bytes([row("Departure Clean", "2026-08-18"), row("Turn Clean", "2026-08-20")]), (2026, 8))
check("current label", s.label, "current_month")
check("current rows", s.rows, 2)
check("current dominant", s.dominant_month, (2026, 8))

# Same export day, the next-month file.
s = summarize_csv(csv_bytes([row("Departure Clean", "2026-09-02"), row("Turn Clean", "2026-09-11")]), (2026, 8))
check("next label", s.label, "next_month")

# One stray out-of-window row must not flip the label. This is why the modal
# month is used instead of the runbook's original "read row 2 only" rule —
# under that rule this file would have been labelled next_month.
s = summarize_csv(
    csv_bytes([row("Turn Clean", "2026-09-30"), *[row("Departure Clean", "2026-08-1%d" % i) for i in range(1, 8)]]),
    (2026, 8),
)
check("stray first row", s.label, "current_month")
check("stray first_due", s.first_due, dt.date(2026, 9, 30))

# Backfilling a July export: reference month comes from the filename date, so
# it still labels as current_month rather than being judged against today.
s = summarize_csv(csv_bytes([row("Departure Clean", "2026-07-04")]), (2026, 7))
check("backfill label", s.label, "current_month")

# BOM (Breezeway emits one) must not corrupt the first header.
s = summarize_csv(csv_bytes([row("Departure Clean", "2026-08-18")], bom=True), (2026, 8))
check("bom columns", s.missing_columns, [])
check("bom label", s.label, "current_month")

# Rows with no due date are counted but can't vote on the label.
s = summarize_csv(csv_bytes([row("Air Filter Change", ""), row("Departure Clean", "2026-08-18")]), (2026, 8))
check("blank due rows", s.rows, 2)
check("blank due label", s.label, "current_month")

# No parseable due date anywhere -> no label (posted without ?source=).
s = summarize_csv(csv_bytes([row("Air Filter Change", "")]), (2026, 8))
check("no due label", s.label, None)

# Header-only export is caught before posting.
s = summarize_csv(csv_bytes([]), (2026, 8))
check("header only rows", s.rows, 0)

# A renamed/dropped column is caught before posting.
short = ("Task title,Property,Due date\n" "Departure Clean,X - Y,2026-08-18\n").encode("utf-8")
check("missing columns", summarize_csv(short, (2026, 8)).missing_columns, ["Created date", "Status"])

# --- file selection --------------------------------------------------------
daily_a = DriveFile("a", "2026-08-18_03-15-02_x_breezeway-task-custom-export.csv", "2026-08-18T11:33:24.157Z", 154087)
daily_b = DriveFile("b", "2026-08-18_03-15-53_x_breezeway-task-custom-export.csv", "2026-08-18T11:33:25.531Z", 242713)
# Real case: a manual Apps Script run — filename says 08-18, Drive says 08-19.
manual = DriveFile("c", "2026-08-18_16-35-24_x_breezeway-task-custom-export.csv", "2026-08-19T01:29:43.478Z", 243204)
older = DriveFile("d", "2026-08-17_03-13-42_x_breezeway-task-custom-export.csv", "2026-08-17T11:33:26.274Z", 241690)
pool = [manual, daily_b, daily_a, older]

check("export_date parsed", daily_a.export_date, dt.date(2026, 8, 18))
check("export_date missing", DriveFile("e", "notes.csv", "2026-08-18T00:00:00Z", 1).export_date, None)

# A run at 13:00 UTC on 08-19. The 08-18 11:33 drop is 25.5h old, so a 24h
# window would miss it entirely while the default 30h window catches it —
# which is what makes a skipped run self-heal instead of needing a backfill.
run_at = dt.datetime(2026, 8, 19, 13, 0, tzinfo=dt.timezone.utc)
picked = select_files(pool, since=run_at - dt.timedelta(hours=24), export_date=None, file_ids=[])
check("24h window catches only the late manual file", sorted(f.id for f in picked), ["c"])

picked = select_files(pool, since=run_at - dt.timedelta(hours=DEFAULT_LOOKBACK_HOURS), export_date=None, file_ids=[])
check("default window catches the 08-18 drop + manual", sorted(f.id for f in picked), ["a", "b", "c"])
check("default window excludes the 08-17 drop", "d" in [f.id for f in picked], False)

picked = select_files(pool, since=run_at - dt.timedelta(hours=DEFAULT_LOOKBACK_HOURS), export_date=dt.date(2026, 8, 18), file_ids=[])
check("date mode picks all three 08-18 files", sorted(f.id for f in picked), ["a", "b", "c"])

picked = select_files(pool, since=run_at, export_date=None, file_ids=["d"])
check("file-id mode", [f.id for f in picked], ["d"])

if failures:
    print("FAILED:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("breezeway_import self-test: all checks passed")
