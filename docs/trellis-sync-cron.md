# Trellis Sync — Cron Runbook

The `/trellis-sync` page reads Supabase snapshot tables refreshed by a local
runner on **this Mac** (the only machine with the Trellis MCP connections).
Two cron jobs: a **nightly** full sync, and a **2-minute poller** that honors the
page's "Refresh" button (it watches `trellis_sync_log` for a `requested` row).

Concrete paths on this machine:
- repo: `/Users/jordanlynde/tendwell-ops`
- `claude`: `/Users/jordanlynde/.local/bin/claude`
- `node`: `/opt/homebrew/bin/node`
- Supabase URL: `https://eetsudoksvsmwtiqraot.supabase.co`

---

## 1. Grant the unattended runner its tool permissions (you decide this)

The nightly run is non-interactive, so `claude` can't prompt for tool approval.
Grant a **scoped** allowlist of exactly the 3 MCP tools it needs (preferred over
a blanket `--dangerously-skip-permissions`). Create this file:

`/Users/jordanlynde/tendwell-ops/.claude/settings.local.json`
```json
{
  "permissions": {
    "allow": [
      "mcp__trellis-workspace-a__trellis",
      "mcp__trellis-workspace-b__trellis",
      "mcp__supabase__execute_sql"
    ]
  }
}
```
This file is local to this machine (don't commit it). The wrapper relies on it;
keep it in place. (Alternative: append `--dangerously-skip-permissions` to the
`claude` line in `scripts/trellis-sync.sh` — broader, your call.)

## 2. Make the wrapper executable
```bash
cd /Users/jordanlynde/tendwell-ops
chmod +x scripts/trellis-sync.sh
```

## 3. Test it once, by hand, before scheduling
```bash
./scripts/trellis-sync.sh
```
Watch the log path it prints. When it finishes, confirm a fresh row in Supabase
(SQL editor):
```sql
select status, finished_at, counts from trellis_sync_log order by created_at desc limit 1;
select count(*) from trellis_task_snapshot where workspace='B';
```
Status should be `done` and the B-task count should jump into the hundreds.

## 4. Install the cron jobs
```bash
crontab -e
```
Add (paste your real `service_role` key — Supabase → Project Settings → API):
```cron
# Nightly full Trellis→Supabase sync at 3:15am
15 3 * * * cd /Users/jordanlynde/tendwell-ops && ./scripts/trellis-sync.sh

# On-demand: honor the page's "Refresh" button every 2 minutes
*/2 * * * * cd /Users/jordanlynde/tendwell-ops && SUPABASE_URL='https://eetsudoksvsmwtiqraot.supabase.co' SUPABASE_SERVICE_ROLE_KEY='YOUR_SERVICE_ROLE_KEY' /opt/homebrew/bin/node scripts/trellis-sync-poller.mjs
```

## 5. macOS gotcha — Full Disk Access
cron on macOS needs Full Disk Access to run, or jobs silently never fire:
System Settings → Privacy & Security → Full Disk Access → add `/usr/sbin/cron`.

## Verify end-to-end
- **Nightly:** wait for 3:15am (or run `./scripts/trellis-sync.sh`), then check the
  `trellis_sync_log` row + the page's "Last synced" timestamp.
- **Refresh button:** click Refresh on `/trellis-sync`; within ~2 min the latest
  `trellis_sync_log` row should go `requested → running → done` and the page refreshes.

## Notes
- The sync is **idempotent** (upsert by primary key) — safe to run repeatedly.
- It pulls only **Tendwell-attributable** tasks (assignee "Tendwell Cleaning Co."
  + each workspace-A roster member), never all of Haven's cleaning tasks.
- Logs: `$TMPDIR/trellis-sync-*.log`.
- Robust alternative to the agentic sync for the big task pull: dump tasks to a
  JSONL file and load with `scripts/trellis-load-tasks.mjs` (needs `SUPABASE_URL`
  + `SUPABASE_SERVICE_ROLE_KEY`).
