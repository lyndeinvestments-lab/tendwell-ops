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
   - Properties: page `call trellisql_query {"view":"properties","select":["id","name","status","city"],"limit":50,"offset":N}` (increment offset by 50 until a short page) → upsert each page with `workspace='B'`.
   - Tasks — **Tendwell-attributable ONLY, and ALWAYS date-bounded.** NEVER page the whole Cleaning department or a member's full history: Haven has THOUSANDS of cleaning tasks and an unbounded pull runs for hours and never converges.
     - **REQUIRED date window:** compute `window_start` = today − 30 days and `window_end` = today + 90 days as ISO dates (e.g. on 2026-06-19 → `window_start`=`2026-05-20`, `window_end`=`2026-09-17`). Apply `"scheduled_date":{"gte":"<window_start>","lte":"<window_end>"}` to **EVERY** task query below. This caps the pull at a few hundred near-term tasks instead of thousands of historical ones.
     - (a) `call trellisql_query {"view":"tasks","select":[...],"filters":{"assigned_to_name":"Tendwell Cleaning Co.","scheduled_date":{"gte":"<window_start>","lte":"<window_end>"}},"limit":50,"offset":N}` — paginate until a short page.
     - (b) For EACH `user_id` in `trellis_roster` (from step 2): `call trellisql_query {"view":"tasks","select":[...],"filters":{"assigned_to_id":"<user_id>","scheduled_date":{"gte":"<window_start>","lte":"<window_end>"}},"limit":50,"offset":N}` — paginate. (Each member's windowed set is small.)
     - Upsert each page with `workspace='B'` (`trellis_property_id` = the row's `property_id`).
   - Use the same task `select` list as workspace A.
4. **Upsert** with `mcp__supabase__execute_sql` using `insert … on conflict (<pk>) do update set …, synced_at=now()`. Work strictly sequentially — one MCP call, then its upsert, then the next. Do not spawn sub-agents.
   - **Robust alternative for the large B-task pull:** dump the fetched task rows to a JSONL file and load them with `scripts/trellis-load-tasks.mjs` (deterministic, resumable) instead of building upserts inline.
5. **Finish:** set the sync-log row `status='done', finished_at=now(), counts='{"roster":N,"props_a":N,"props_b":N,"tasks":N}'`. On any error, set `status='error', error='<message>'`.

## Guardrails
- Read-only against Trellis (no task/property mutations).
- Never write to `properties` — matching is admin-confirmed in the UI.
- Idempotent: safe to re-run; always upsert by primary key.
