# Trellis Sync — Operations

> **The Mac-local cron runner has been retired.** Sync now runs entirely server-side on Vercel.

## Vercel endpoints

| Trigger | File | Schedule |
|---|---|---|
| Nightly cron | `api/cron/trellis-sync.ts` | 03:00 UTC daily (configured in `vercel.json`) |
| On-demand (Refresh button) | `api/trellis/sync-now.ts` | Admin-only POST, called by the `/trellis-sync` page |

Both call the shared sync core at `api/trellis/_sync-core.ts`. Live progress is written to `trellis_sync_log.progress`.

## Local / manual reference

`scripts/trellis-sync-direct.mjs` — a deterministic local sync script kept for manual use or debugging. Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in the environment.

## Monitoring

Check sync status in Supabase SQL editor:
```sql
select status, finished_at, counts from trellis_sync_log order by created_at desc limit 5;
```
