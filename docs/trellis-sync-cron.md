# Trellis Sync — Cron Runbook

The `/trellis-sync` page reads Supabase snapshot tables refreshed by a local
runner on this device (the only machine with the Trellis MCP connections).

## Prerequisites
- `claude` CLI on PATH, authenticated, with `trellis-workspace-a/b` + `supabase` MCP servers configured.
- Env for the poller: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Install
    chmod +x scripts/trellis-sync.sh
    crontab -e

Add:
    # Nightly full sync at 03:15
    15 3 * * * cd /Users/jordanlynde/tendwell-ops && ./scripts/trellis-sync.sh
    # On-demand: check for Refresh requests every 2 minutes
    */2 * * * * cd /Users/jordanlynde/tendwell-ops && SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/trellis-sync-poller.mjs

## Verify
- Manual: `./scripts/trellis-sync.sh` then check `trellis_sync_log` for a `done` row.
- On-demand: click Refresh on the page; within ~2 min the log row goes requested → running → done.
