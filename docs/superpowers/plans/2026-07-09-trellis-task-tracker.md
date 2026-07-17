# Trellis Task Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministic Trellis task tracking — a real dashboard count from the snapshot tables, a `/trellis-tasks` page (overdue / due today / turn cleans / completed / roster gaps), an hourly tasks-only sync, and a follow-up clear action in the property modal.

**Architecture:** All reads come from the existing `trellis_task_snapshot` + `trellis_roster` Supabase tables (nightly full sync + new hourly tasks-only refresh). The flaky agent-invoke endpoint is deleted. Client queries go direct via the Supabase client under RLS, per the repo pattern.

**Tech Stack:** React 18 + TanStack Query 5 + Supabase JS, Vercel serverless (cron), Postgres RLS.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-09-trellis-task-tracker-design.md`
- Status colors via semantic tokens / `StatusBadge` — never hardcoded red/amber classes.
- Page shell: `<PageContainer>` + `<PageHeader>`; KPI tiles via shared `<StatCard>`; `md:h-full md:flex md:flex-col` pattern for fixed-height table pages.
- `trellis_roster` RLS stays admin-only.
- No test suite beyond vitest for pure libs; verification = `npm run check` + `npm run build` + live SQL sanity checks.
- New page must be granted in the data-driven RBAC (`app_settings.role_permissions`) for admin (and viewer), not just `ROLE_VIEWS`.

---

### Task 1: RLS + RBAC migration

**Files:**
- Create: `supabase/migrations/20260709_trellis_task_tracker.sql`

**Interfaces:**
- Produces: staff SELECT on `trellis_task_snapshot`; `'hourly'` allowed in `trellis_sync_log.trigger`; `'trellis-tasks'` view granted to admin+viewer in `app_settings.role_permissions`.

- [ ] Write migration:

```sql
-- Trellis task tracker (spec 2026-07-09).
-- 1. Widen trellis_task_snapshot read from admin-only to all staff so the
--    dashboard tile (admin, viewer) and /trellis-tasks can query it.
--    trellis_roster stays admin-only (personal emails).
drop policy if exists trellis_task_admin_read on public.trellis_task_snapshot;
drop policy if exists trellis_task_staff_read on public.trellis_task_snapshot;
create policy trellis_task_staff_read on public.trellis_task_snapshot
  for select to authenticated using (public.is_staff());

-- 2. Allow the hourly tasks-only cron to log itself.
alter table public.trellis_sync_log drop constraint if exists trellis_sync_log_trigger_check;
alter table public.trellis_sync_log add constraint trellis_sync_log_trigger_check
  check (trigger in ('manual','nightly','poller','hourly'));

-- 3. Grant the new 'trellis-tasks' view to admin + viewer in the data-driven
--    RBAC store (app_settings.role_permissions). No-op if the key is absent
--    (hardcoded ROLE_VIEWS fallback then applies).
do $$
declare
  v jsonb;
  r text;
begin
  select value into v from public.app_settings where key = 'role_permissions';
  if v is null then return; end if;
  foreach r in array array['admin','viewer'] loop
    if v ? r then
      if not (v->r->'views') @> '"trellis-tasks"' then
        v := jsonb_set(v, array[r,'views'], (v->r->'views') || '"trellis-tasks"');
      end if;
      v := jsonb_set(v, array[r,'permissions','trellis-tasks'],
                     jsonb_build_object('view', true, 'edit', r = 'admin'));
    end if;
  end loop;
  update public.app_settings set value = v where key = 'role_permissions';
end $$;
```

- [ ] Apply via `mcp__supabase__apply_migration` (project `eetsudoksvsmwtiqraot`).
- [ ] Verify: `select policyname from pg_policies where tablename='trellis_task_snapshot'` shows `trellis_task_staff_read`; `select value->'admin'->'views' from app_settings where key='role_permissions'` includes `trellis-tasks`.
- [ ] Commit: `feat: staff read on trellis task snapshot + trellis-tasks RBAC grant`

### Task 2: Deterministic dashboard tile

**Files:**
- Delete: `api/trellis/tasks-today.ts`
- Rewrite: `client/src/hooks/use-trellis-tasks-today.ts`
- Modify: `client/src/pages/dashboard.tsx:749-760` (tile props)

**Interfaces:**
- Produces: `useTrellisTasksToday()` → `{ date: string; count: number; syncedAt: string | null }`; exported `todayInCentral(): string` (YYYY-MM-DD in America/Chicago).

- [ ] Rewrite hook to a direct snapshot count (status SCHEDULED/OPEN, `scheduled_date = today` Central) plus latest `synced_at`:

```ts
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** YYYY-MM-DD for "today" in America/Chicago (en-CA locale formats ISO-style). */
export function todayInCentral(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

export interface TrellisTasksToday {
  date: string
  count: number
  syncedAt: string | null
}

export function useTrellisTasksToday() {
  return useQuery<TrellisTasksToday>({
    queryKey: ['/supabase/trellis-tasks-today'],
    queryFn: async () => {
      const date = todayInCentral()
      const { count, error } = await supabase
        .from('trellis_task_snapshot')
        .select('*', { count: 'exact', head: true })
        .in('status', ['SCHEDULED', 'OPEN'])
        .eq('scheduled_date', date)
      if (error) throw error
      const { data: latest } = await supabase
        .from('trellis_task_snapshot')
        .select('synced_at')
        .order('synced_at', { ascending: false })
        .limit(1)
      return { date, count: count ?? 0, syncedAt: latest?.[0]?.synced_at ?? null }
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
}
```

- [ ] Update the dashboard tile: subtitle shows "as of <h:mm a>" from `syncedAt`, `onClick={() => navigate('/trellis-tasks')}`, hint explains snapshot source.
- [ ] `git rm api/trellis/tasks-today.ts` (nothing else references it — verify with grep).
- [ ] `npm run check` passes.
- [ ] Commit: `feat: dashboard Trellis tile reads snapshot (delete agent-invoke endpoint)`

### Task 3: /trellis-tasks page

**Files:**
- Create: `client/src/pages/trellis-tasks.tsx`
- Modify: `client/src/App.tsx` (lazy import + `<Route path="/trellis-tasks">` with `GuardedRoute viewId="trellis-tasks"`)
- Modify: `client/src/components/AppSidebar.tsx` (Operations group item, `ListChecks` icon)
- Modify: `client/src/lib/auth.tsx` (VIEW_DEFINITIONS entry `{ id: 'trellis-tasks', label: 'Trellis Tasks', group: 'Operations' }`; add to ROLE_VIEWS.admin + ROLE_VIEWS.viewer)

**Interfaces:**
- Consumes: `trellis_task_snapshot` (staff read, Task 1), `trellis_roster` (admin only), `cleaners.email`, `app_users.google_email`, `todayInCentral()` from Task 2.
- Produces: route `/trellis-tasks`.

- [ ] Page structure: `PageContainer` + `PageHeader` ("Trellis Tasks", last-synced + Refresh in `actions`); 4 `StatCard` tiles (Overdue / Due Today / Turn Cleans Today / Completed Today); tab filter (Overdue default | Due Today | Completed | All) + search input + "Turn cleans only" toggle; desktop table + mobile cards; admin-only "In Trellis, not in Ops" panel.
- [ ] Queries: one fetch of tasks in the tracking window (open with `scheduled_date <= today`, plus anything dated today) — counts derived client-side; roster gap = `trellis_roster` where active, minus `cleaners`/`app_users` emails (case-insensitive), excluding `@trellistech.com`, `.test`, "Tendwell Cleaning Co.". Roster queries only run when `effectiveUser.role === 'admin'`.
- [ ] Refresh button: enqueue a `trellis_sync_log` `status='requested'` row + call `api/trellis/sync-now.ts`, matching the API Sync page's pattern, with a spinner while running.
- [ ] `npm run check` passes.
- [ ] Commit: `feat: /trellis-tasks page (overdue, due today, turn cleans, roster gaps)`

### Task 4: Hourly tasks-only sync

**Files:**
- Modify: `api/trellis/_sync-core.ts` (add `tasksOnly?: boolean` to `SyncOptions`; skip roster/props phases; roster ids from DB)
- Create: `api/cron/trellis-tasks-refresh.ts` (clone of `api/cron/trellis-sync.ts` with `trigger: 'hourly'`, `runSync({ trigger: 'hourly', tasksOnly: true })`)
- Modify: `vercel.json` (function config with includeFiles + maxDuration 300; cron `{ "path": "/api/cron/trellis-tasks-refresh", "schedule": "0 0-2,12-23 * * *" }` — hourly through the Central business day, skipping the 03:00 UTC nightly window)

**Interfaces:**
- Consumes: `runSync` / `SyncOptions` from `_sync-core.ts`; `trellis_sync_log.trigger='hourly'` (Task 1).
- Produces: `SyncOptions.tasksOnly?: boolean`; `SyncCounts` unchanged (roster/props counts 0 when tasksOnly).

- [ ] In `runSync`, when `opts.tasksOnly`: load workspace-A roster user ids from `trellis_roster` (`select user_id where workspace='A' and is_active`) instead of `read_workforce`; skip both property phases; keep tasks A, tasks B (Tendwell-assigned + per-member), and stale-B pruning identical. `SyncOptions.trigger` type gains `'hourly'`.
- [ ] `npm run check` passes.
- [ ] Commit: `feat: hourly tasks-only Trellis sync cron`

### Task 5: Follow-up clear in property modal

**Files:**
- Modify: `client/src/components/PropertyDetailModal.tsx` (~line 1659 chip; new `clearFollowUp` mutation modeled on `toggleHotTub` at ~line 961)

**Interfaces:**
- Consumes: `logPropertyEdit`, `invalidateAllPropertyQueries`, `PROPERTY_DETAIL_SELECT` (all already imported in the file).

- [ ] Mutation: `update properties set follow_up_date = null`, `setQueryData` detail row, `logPropertyEdit(propertyId, 'follow_up_date', old, '', ...)`, invalidate all property queries, toast "Follow-up cleared".
- [ ] Chip: keep the amber date chip, add a ✕ button inside it (visible when `canEditProperty`), `data-testid="chip-clear-follow-up"`, `title="Mark follow-up done (clears the date)"`.
- [ ] `npm run check` passes.
- [ ] Commit: `feat: clear follow-up date from property modal`

### Task 6: Verify + docs + ship

- [ ] `npm run check` + `npm run build` green.
- [ ] SQL sanity: hook count query matches direct SQL count for today.
- [ ] Update `CLAUDE.md`: Pages table (+ `/trellis-tasks`), API section (tasks-today deleted, hourly cron added), migrations list, Current State entry.
- [ ] PR → squash-merge → delete branch (Jordan's standing git workflow).
