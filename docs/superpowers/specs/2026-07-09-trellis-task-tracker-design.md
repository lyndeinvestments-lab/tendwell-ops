# Trellis Task Tracker — Design Spec (2026-07-09)

## Problem

1. The dashboard "Trellis Tasks Today" tile is non-deterministic: `api/trellis/tasks-today.ts` asks a Trellis AI agent for a count and regex-parses an integer from its free-text reply. The number changes on refresh and each pageview bills a Trellis agent invoke.
2. There is no way to see overdue Trellis tasks, completed tasks, turn cleans due today, or Trellis roster members not yet set up in Ops.
3. Overdue property follow-ups on the dashboard can't be closed out — the property modal has no way to clear `follow_up_date`.

## Approach (approved by Jordan 2026-07-09)

Everything reads from the existing `trellis_task_snapshot` / `trellis_roster` tables (populated by the nightly sync + on-demand sync). No new Trellis agent calls.

### 1. Dashboard tile — deterministic

- **Delete** `api/trellis/tasks-today.ts` (agent-invoke endpoint).
- Rewrite `client/src/hooks/use-trellis-tasks-today.ts` to query `trellis_task_snapshot` directly via the Supabase client: count of rows with `status in (SCHEDULED, OPEN)` and `scheduled_date = today` (America/Chicago).
- Tile shows the count, an "as of <last synced time>" caption, and navigates to `/trellis-tasks` on click.

### 2. New page `/trellis-tasks`

Sidebar: Operations group. Access: admin + viewer (`VIEW_ACCESS` + data-driven RBAC grant to admin per standing rule). Roster panel is admin-only (roster RLS stays admin-only; panel hides itself when the roster query is denied/empty for non-admins).

- **KPI tiles** (shared `StatCard`): Overdue (open, `scheduled_date < today`), Due Today (open), Turn Cleans Today (`title = 'Turn Clean'`, `scheduled_date = today`, any status, with completed/open split in the caption), Completed Today (`status = COMPLETED` and `scheduled_date = today`).
- **Task table** (desktop) / cards (mobile): property name, title, status badge, scheduled date, days-overdue badge, assignee, workspace chip (A/B). Filter tabs: Overdue / Due Today / Completed / All. Search across property/title/assignee. "Turn cleans only" toggle. Default tab: Overdue.
- **"In Trellis, not in Ops" panel** (admin-only): active `trellis_roster` members whose email is in neither `cleaners.email` nor `app_users.google_email` (case-insensitive), excluding `@trellistech.com` and `.test` emails and the "Tendwell Cleaning Co." pseudo-member. Row: name, email, Trellis role, workspace. Action: link to `/cleaners` to add them.
- Header: last-synced timestamp (max `synced_at`) + Refresh button reusing the existing on-demand sync endpoint (`api/trellis/sync-now.ts`) with its progress polling, same as the API Sync page.

### 3. Hourly tasks-only sync

- `api/trellis/_sync-core.ts` gains a `tasksOnly` option: skips roster + property phases; reads the workspace-A roster user ids **from the DB** (`trellis_roster`) for the workspace-B per-member task queries; same date window (-30/+90); same stale-B-task pruning.
- New endpoint `api/cron/trellis-tasks-refresh.ts` (CRON_SECRET-gated like the nightly cron) calling `runSync({ ..., tasksOnly: true })`, logged to `trellis_sync_log`.
- `vercel.json`: hourly cron through the Central business day; `maxDuration: 300` + includeFiles like the nightly cron. Nightly full sync unchanged.

### 4. RLS migration

- `trellis_task_snapshot`: SELECT policy widened from admin-only to any staff (`is_staff()`), so the dashboard tile (admin, viewer) and the new page work.
- `trellis_roster`: unchanged (admin-only; contains personal emails).

### 5. Follow-up close-out (property modal)

- In `PropertyDetailModal` Overview, the "Follow-up: <date>" chip gets a clear (✕) action: sets `properties.follow_up_date = null`, logs via `logPropertyEdit`, invalidates property queries. Removing the date also removes the item from the dashboard Today's Actions list (it derives from `follow_up_date`).

## Non-goals

- No write-back to Trellis (tasks are read-only here).
- No follow-up history table or next-date prompt (Jordan chose plain clear).
- No changes to Breezeway/Hostaway sync or the financial dedup views.

## Testing

- `npm run check` + `npm run build`.
- SQL sanity: tile count matches `select count(*) ... scheduled_date = today` after migration.
- Manual: page renders all four tiles + table + roster panel as admin; tile matches page's Due Today.
