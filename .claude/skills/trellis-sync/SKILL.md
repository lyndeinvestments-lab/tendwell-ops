---
name: trellis-sync
description: Pull Tendwell properties/tasks/roster from Trellis workspace A and B via MCP and upsert into Supabase snapshot tables. Run by the nightly cron and on-demand poller.
---

# Trellis Sync

Refresh the Supabase snapshot tables that back the Tendwell Ops `/trellis-sync` page.
Supabase project id: `eetsudoksvsmwtiqraot`.

## Steps

1. **Claim a sync-log row.** Find the oldest `trellis_sync_log` row with `status='requested'`
   (if invoked on-demand); else insert one with `trigger='nightly'`. Set it to
   `status='running', started_at=now()`.
2. **Workspace A (`mcp__trellis-workspace-a__trellis`):**
   - `call read_workforce {"limit":100}` → upsert all members into `trellis_roster`.
   - `call trellisql_query {"view":"properties","select":["id","name","status","city"],"limit":200}` → upsert into `trellis_property_snapshot` with `workspace='A'`.
   - `call trellisql_query {"view":"tasks","select":["id","title","property_id","property_name","department_name","status","priority","assigned_to_id","assigned_to_name","scheduled_date","completed_at"],"limit":500}` → upsert into `trellis_task_snapshot` with `workspace='A'`.
3. **Workspace B (`mcp__trellis-workspace-b__trellis`):**
   - Properties: `call trellisql_query {"view":"properties","select":["id","name","status","city"],"limit":1000}` (paginate via offset) → upsert with `workspace='B'`.
   - Tasks: page the `tasks` view for `department_name='Cleaning'`, `scheduled_date` from 30 days ago to 90 days ahead. Keep rows where `assigned_to_name='Tendwell Cleaning Co.'` OR `assigned_to_id` ∈ the roster `user_id`s from step 2. Upsert with `workspace='B'`.
4. **Upsert** with `mcp__supabase__execute_sql` using `insert … on conflict (<pk>) do update set …, synced_at=now()`.
5. **Finish:** set the sync-log row `status='done', finished_at=now(), counts='{"roster":N,"props_a":N,"props_b":N,"tasks":N}'`. On any error, set `status='error', error='<message>'`.

## Guardrails
- Read-only against Trellis (no task/property mutations).
- Never write to `properties` — matching is admin-confirmed in the UI.
- Idempotent: safe to re-run; always upsert by primary key.
