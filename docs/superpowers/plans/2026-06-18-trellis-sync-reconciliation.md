# Tendwell ↔ Trellis Sync & Reconciliation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin-only Tendwell Ops page that maps every Ops property to its Trellis counterpart across both Trellis workspaces, flags Tendwell work in Trellis that has no Ops home, and hosts a Workflows tab — backed by a nightly + on-demand snapshot sync.

**Architecture:** A nightly local cron runs Claude Code headless (the only context with the Trellis MCP connections) to dump Trellis properties/tasks/roster into Supabase snapshot tables. All Tendwell-attribution and reconciliation logic lives in **Postgres views** (testable via SQL). The React page reads only Supabase (snapshot views + live `properties`); its "Refresh" button enqueues a sync request that the local poller executes.

**Tech Stack:** React 18 + Wouter + TanStack Query + Tailwind/Shadcn (frontend), Supabase Postgres (data + RLS + views), Claude Code headless + Trellis MCP (sync), tsx + Node cron (runner). Verification: `npm run check` (tsc), Supabase MCP `execute_sql` against a branch, Playwright smoke. (Repo has no JS unit runner — logic that must be unit-tested is implemented in SQL and verified with seeded fixtures on a Supabase branch.)

**Reference spec:** `docs/superpowers/specs/2026-06-18-trellis-sync-reconciliation-design.md`

---

## Canonical names (use these exact identifiers everywhere)

- Tables: `trellis_property_snapshot`, `trellis_task_snapshot`, `trellis_roster`, `trellis_sync_log`
- Function: `public.tendwell_normalize_name(text)`
- Views: `trellis_task_attributed`, `trellis_property_enriched`, `trellis_reconciliation`, `trellis_exceptions`
- Page view id: `trellis-sync` · Route: `/trellis-sync` · Page file: `client/src/pages/trellis-sync.tsx` · Hook: `client/src/hooks/use-trellis-sync.ts`
- Supabase project id: `eetsudoksvsmwtiqraot`
- Tendwell attribution rule: a task is Tendwell's if `workspace = 'A'` OR `assigned_to_name = 'Tendwell Cleaning Co.'` OR `assigned_to_id ∈ trellis_roster.user_id`. A property is a Tendwell property if `workspace = 'A'` OR it has ≥1 Tendwell task.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260618_trellis_sync.sql` | Snapshot tables, RLS, normalize function, reconciliation views |
| `shared/database.types.ts` | Regenerated to include new tables/views (modify) |
| `client/src/lib/auth.tsx` | Register `trellis-sync` view id (modify) |
| `client/src/App.tsx` | Lazy import + `AdminRoute` for `/trellis-sync` (modify) |
| `client/src/components/AppSidebar.tsx` | Admin nav entry (modify) |
| `client/src/hooks/use-trellis-sync.ts` | Query views + sync log; mutations: link match, request sync |
| `client/src/pages/trellis-sync.tsx` | Page shell + 3 tabs (Reconciliation, Workflows, Roster) |
| `.claude/skills/trellis-sync/SKILL.md` | Headless sync instructions (MCP → Supabase upserts) |
| `scripts/trellis-sync.sh` | Cron wrapper invoking Claude Code headless |
| `scripts/trellis-sync-poller.mjs` | On-demand: detect `requested` sync rows, trigger wrapper |
| `docs/trellis-sync-cron.md` | Cron install + operations runbook |

---

## Phase 1 — Database schema, attribution & reconciliation (SQL)

### Task 1: Write the migration

**Files:**
- Create: `supabase/migrations/20260618_trellis_sync.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Tendwell ↔ Trellis sync & reconciliation.
-- Snapshot tables are written by the nightly/on-demand sync (service role).
-- All Tendwell-attribution + reconciliation logic lives in views below so it
-- is testable with plain SQL and the sync stays a dumb ingest.

-- ── Snapshot tables ─────────────────────────────────────────────────────────
create table if not exists public.trellis_property_snapshot (
  trellis_id   uuid primary key,
  workspace    text not null check (workspace in ('A','B')),
  name         text not null,
  status       text,
  city         text,
  synced_at    timestamptz not null default now()
);

create table if not exists public.trellis_task_snapshot (
  trellis_task_id     uuid primary key,
  workspace           text not null check (workspace in ('A','B')),
  trellis_property_id uuid,
  property_name       text,
  title               text,
  department_name     text,
  status              text,
  priority            text,
  assigned_to_id      uuid,
  assigned_to_name    text,
  scheduled_date      date,
  completed_at        timestamptz,
  synced_at           timestamptz not null default now()
);
create index if not exists trellis_task_snapshot_prop_idx on public.trellis_task_snapshot(trellis_property_id);
create index if not exists trellis_task_snapshot_sched_idx on public.trellis_task_snapshot(scheduled_date);

create table if not exists public.trellis_roster (
  user_id     uuid primary key,
  member_id   uuid,
  workspace   text not null default 'A',
  name        text,
  email       text,
  role        text,
  departments text[] not null default '{}',
  is_active   boolean not null default true,
  synced_at   timestamptz not null default now()
);

create table if not exists public.trellis_sync_log (
  id          uuid primary key default gen_random_uuid(),
  status      text not null check (status in ('requested','running','done','error')),
  trigger     text not null default 'manual' check (trigger in ('manual','nightly','poller')),
  requested_by text,
  started_at  timestamptz,
  finished_at timestamptz,
  counts      jsonb,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists trellis_sync_log_status_idx on public.trellis_sync_log(status);

-- ── Name normalization: strip trailing "(XXX)" area code, lowercase, collapse ─
create or replace function public.tendwell_normalize_name(p text)
returns text language sql immutable as $$
  select nullif(
    trim(regexp_replace(
      lower(regexp_replace(coalesce(p,''), '\s*\([^)]*\)\s*$', '')),
      '\s+', ' ', 'g')),
    '')
$$;

-- ── Task-level Tendwell attribution ─────────────────────────────────────────
create or replace view public.trellis_task_attributed
with (security_invoker = true) as
select t.*,
  (t.workspace = 'A'
   or t.assigned_to_name = 'Tendwell Cleaning Co.'
   or t.assigned_to_id in (select user_id from public.trellis_roster))
   as is_tendwell
from public.trellis_task_snapshot t;

-- ── Property enrichment: task counts + Tendwell flags ───────────────────────
create or replace view public.trellis_property_enriched
with (security_invoker = true) as
select p.*,
  coalesce(tc.tendwell_task_count, 0) as tendwell_task_count,
  (p.workspace = 'A' or coalesce(tc.tendwell_task_count, 0) > 0) as is_tendwell_property
from public.trellis_property_snapshot p
left join (
  select trellis_property_id, count(*) as tendwell_task_count
  from public.trellis_task_attributed
  where is_tendwell and trellis_property_id is not null
  group by trellis_property_id
) tc on tc.trellis_property_id = p.trellis_id;

-- ── Reconciliation from the Ops-property perspective ────────────────────────
create or replace view public.trellis_reconciliation
with (security_invoker = true) as
select
  pr.id          as ops_property_id,
  pr.name        as ops_name,
  pr.trellis_id  as linked_trellis_id,
  ts.name        as linked_trellis_name,
  ts.workspace   as linked_workspace,
  ts.is_tendwell_property,
  ts.tendwell_task_count,
  sug.trellis_id as suggested_trellis_id,
  sug.name       as suggested_trellis_name,
  sug.workspace  as suggested_workspace,
  case
    when pr.trellis_id is not null and ts.trellis_id is not null then 'matched'
    when pr.trellis_id is not null and ts.trellis_id is null     then 'stale'
    when pr.trellis_id is null and sug.trellis_id is not null    then 'suggested'
    else 'unmatched'
  end as match_status
from public.properties pr
left join public.trellis_property_enriched ts on ts.trellis_id = pr.trellis_id
left join lateral (
  select e.* from public.trellis_property_enriched e
  where pr.trellis_id is null
    and public.tendwell_normalize_name(e.name) = public.tendwell_normalize_name(pr.name)
  order by e.workspace
  limit 1
) sug on true;

-- ── Exceptions: Tendwell properties in Trellis with no Ops home ─────────────
create or replace view public.trellis_exceptions
with (security_invoker = true) as
select e.trellis_id, e.name, e.workspace, e.status, e.tendwell_task_count
from public.trellis_property_enriched e
where e.is_tendwell_property
  and not exists (select 1 from public.properties pr where pr.trellis_id = e.trellis_id)
  and not exists (
    select 1 from public.properties pr
    where pr.trellis_id is null
      and public.tendwell_normalize_name(pr.name) = public.tendwell_normalize_name(e.name)
  );

-- ── RLS: admin-only read; service role (sync) bypasses RLS ──────────────────
alter table public.trellis_property_snapshot enable row level security;
alter table public.trellis_task_snapshot    enable row level security;
alter table public.trellis_roster           enable row level security;
alter table public.trellis_sync_log         enable row level security;

drop policy if exists trellis_prop_admin_read on public.trellis_property_snapshot;
create policy trellis_prop_admin_read on public.trellis_property_snapshot
  for select to authenticated using (public.current_user_role() = 'admin');

drop policy if exists trellis_task_admin_read on public.trellis_task_snapshot;
create policy trellis_task_admin_read on public.trellis_task_snapshot
  for select to authenticated using (public.current_user_role() = 'admin');

drop policy if exists trellis_roster_admin_read on public.trellis_roster;
create policy trellis_roster_admin_read on public.trellis_roster
  for select to authenticated using (public.current_user_role() = 'admin');

-- Sync log: admins read + insert (the "Refresh" enqueue); updates come from
-- the service-role sync, which bypasses RLS.
drop policy if exists trellis_synclog_admin_read on public.trellis_sync_log;
create policy trellis_synclog_admin_read on public.trellis_sync_log
  for select to authenticated using (public.current_user_role() = 'admin');
drop policy if exists trellis_synclog_admin_insert on public.trellis_sync_log;
create policy trellis_synclog_admin_insert on public.trellis_sync_log
  for insert to authenticated with check (public.current_user_role() = 'admin');

grant select on public.trellis_task_attributed   to authenticated;
grant select on public.trellis_property_enriched to authenticated;
grant select on public.trellis_reconciliation    to authenticated;
grant select on public.trellis_exceptions        to authenticated;
```

- [ ] **Step 2: Commit the migration file**

```bash
git add supabase/migrations/20260618_trellis_sync.sql
git commit -m "feat(trellis): add sync snapshot tables, attribution + reconciliation views"
```

### Task 2: Apply to a Supabase branch and verify logic with fixtures

**Tooling:** Supabase MCP (`mcp__supabase__create_branch`, `apply_migration`, `execute_sql`, `merge_branch`).

- [ ] **Step 1: Create a dev branch**

Call `mcp__supabase__create_branch` with `project_id: eetsudoksvsmwtiqraot`, `name: "trellis-sync"`. Record the returned branch project ref for the next calls.

- [ ] **Step 2: Apply the migration to the branch**

Call `mcp__supabase__apply_migration` against the branch with `name: "20260618_trellis_sync"` and the SQL from Task 1.
Expected: success, no errors.

- [ ] **Step 3: Seed fixtures + assert attribution**

Run via `mcp__supabase__execute_sql` against the branch:

```sql
insert into trellis_roster(user_id, name) values
  ('5871ab0c-a42b-4c14-91b5-1181918d9d28','Saira Vega');
insert into trellis_property_snapshot(trellis_id, workspace, name) values
  ('00000000-0000-0000-0000-0000000000a1','A','Rick Aquino Lodge A'),
  ('ad832e4d-189c-4464-938c-af444d356415','B','Candace Thompson 720 (SCounty)'),
  ('3dc2e4e2-3f8e-4413-8ab0-54190e877b5a','B','Sandra Hill 116-101 (KCity)');
insert into trellis_task_snapshot(trellis_task_id, workspace, trellis_property_id, assigned_to_name) values
  ('00000000-0000-0000-0000-0000000000t1','A','00000000-0000-0000-0000-0000000000a1', null),
  ('00000000-0000-0000-0000-0000000000t2','B','ad832e4d-189c-4464-938c-af444d356415','Tendwell Cleaning Co.'),
  ('00000000-0000-0000-0000-0000000000t3','B','3dc2e4e2-3f8e-4413-8ab0-54190e877b5a','Knoxville Haven''s Company');
select trellis_property_id, is_tendwell from trellis_task_attributed order by trellis_task_id;
```

Expected: task t1 (workspace A) `is_tendwell = true`; t2 (Tendwell Cleaning Co.) `true`; t3 (Knoxville) `false`.

- [ ] **Step 4: Assert property flags + exceptions**

```sql
select name, is_tendwell_property, tendwell_task_count from trellis_property_enriched order by name;
select name from trellis_exceptions order by name;
```

Expected: `Rick Aquino Lodge A` → tendwell (workspace A), `Candace Thompson 720` → tendwell, `Sandra Hill` → NOT tendwell.
`trellis_exceptions` returns `Candace Thompson 720 (SCounty)` and `Rick Aquino Lodge A` **only if** no `properties` row name-matches them. (On the branch, `properties` is copied from prod; Candace Thompson 720 already has a `trellis_id` link, so it should NOT appear. Rick Aquino Lodge A has no Ops match → appears. Confirm this matches the real linkage and note any surprises.)

- [ ] **Step 5: Assert reconciliation statuses + normalization**

```sql
select public.tendwell_normalize_name('Candace Thompson 720 (SCounty)'); -- expect: candace thompson 720
select match_status, count(*) from trellis_reconciliation group by match_status order by 1;
```

Expected: normalization strips the `(SCounty)` suffix; `match_status` buckets include `matched` (~63), plus `unmatched`/`suggested`/`stale` counts. Sanity-check the matched count ≈ 63 existing links.

- [ ] **Step 6: Merge the branch to production**

Once assertions pass, call `mcp__supabase__merge_branch` for the branch. Then `mcp__supabase__list_migrations` on the main project to confirm `20260618_trellis_sync` is applied.

### Task 3: Regenerate typed schema

**Files:**
- Modify: `shared/database.types.ts`

- [ ] **Step 1: Regenerate types**

Call `mcp__supabase__generate_typescript_types` with `project_id: eetsudoksvsmwtiqraot` and overwrite `shared/database.types.ts` with the result.

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: PASS (new tables/views now present in `Database`).

- [ ] **Step 3: Commit**

```bash
git add shared/database.types.ts
git commit -m "chore(trellis): regenerate database types for sync tables/views"
```

---

## Phase 2 — Page data hook

### Task 4: `use-trellis-sync.ts`

**Files:**
- Create: `client/src/hooks/use-trellis-sync.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, logPropertyEdit } from '@/lib/supabase'

const KEY = ['/supabase/trellis-sync'] as const

export interface ReconRow {
  ops_property_id: number
  ops_name: string
  linked_trellis_id: string | null
  linked_trellis_name: string | null
  linked_workspace: 'A' | 'B' | null
  is_tendwell_property: boolean | null
  tendwell_task_count: number | null
  suggested_trellis_id: string | null
  suggested_trellis_name: string | null
  suggested_workspace: 'A' | 'B' | null
  match_status: 'matched' | 'stale' | 'suggested' | 'unmatched'
}
export interface ExceptionRow {
  trellis_id: string
  name: string
  workspace: 'A' | 'B'
  status: string | null
  tendwell_task_count: number
}
export interface RosterRow {
  user_id: string
  name: string | null
  email: string | null
  role: string | null
  departments: string[]
  is_active: boolean
}
export interface TaskRow {
  trellis_task_id: string
  workspace: 'A' | 'B'
  property_name: string | null
  title: string | null
  department_name: string | null
  status: string | null
  priority: string | null
  assigned_to_name: string | null
  scheduled_date: string | null
  completed_at: string | null
  is_tendwell: boolean
}
export interface SyncLogRow {
  id: string
  status: 'requested' | 'running' | 'done' | 'error'
  trigger: string
  started_at: string | null
  finished_at: string | null
  counts: Record<string, number> | null
  error: string | null
  created_at: string
}

export function useTrellisSync() {
  const qc = useQueryClient()

  const recon = useQuery({
    queryKey: [...KEY, 'recon'],
    queryFn: async (): Promise<ReconRow[]> => {
      const { data, error } = await supabase.from('trellis_reconciliation').select('*').order('ops_name')
      if (error) throw error
      return (data ?? []) as ReconRow[]
    },
    refetchOnWindowFocus: false,
  })

  const exceptions = useQuery({
    queryKey: [...KEY, 'exceptions'],
    queryFn: async (): Promise<ExceptionRow[]> => {
      const { data, error } = await supabase.from('trellis_exceptions').select('*').order('name')
      if (error) throw error
      return (data ?? []) as ExceptionRow[]
    },
    refetchOnWindowFocus: false,
  })

  const roster = useQuery({
    queryKey: [...KEY, 'roster'],
    queryFn: async (): Promise<RosterRow[]> => {
      const { data, error } = await supabase.from('trellis_roster').select('*').order('name')
      if (error) throw error
      return (data ?? []) as RosterRow[]
    },
    refetchOnWindowFocus: false,
  })

  const lastSync = useQuery({
    queryKey: [...KEY, 'lastSync'],
    queryFn: async (): Promise<SyncLogRow | null> => {
      const { data, error } = await supabase
        .from('trellis_sync_log').select('*')
        .order('created_at', { ascending: false }).limit(1)
      if (error) throw error
      return (data?.[0] ?? null) as SyncLogRow | null
    },
    // Poll while a sync is in flight so the page reflects requested→running→done.
    refetchInterval: (q) => {
      const s = (q.state.data as SyncLogRow | null)?.status
      return s === 'requested' || s === 'running' ? 5000 : false
    },
    refetchOnWindowFocus: false,
  })

  // Link an Ops property to a Trellis property (confirm a suggested/changed match).
  const linkMatch = useMutation({
    mutationFn: async ({ opsId, opsName, trellisId }: { opsId: number; opsName: string; trellisId: string | null }) => {
      const { error } = await supabase.from('properties').update({ trellis_id: trellisId }).eq('id', opsId)
      if (error) throw error
      await logPropertyEdit(opsId, 'trellis_id', null, trellisId, opsName)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...KEY, 'recon'] })
      qc.invalidateQueries({ queryKey: [...KEY, 'exceptions'] })
    },
  })

  // Enqueue an on-demand sync; the local poller picks it up.
  const requestSync = useMutation({
    mutationFn: async (requestedBy: string) => {
      const { error } = await supabase.from('trellis_sync_log').insert({ status: 'requested', trigger: 'manual', requested_by: requestedBy })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'lastSync'] }),
  })

  return { recon, exceptions, roster, lastSync, linkMatch, requestSync }
}

// Workflows tab pulls task rows on demand (one query per workflow).
export async function fetchTasks(filter: {
  tendwellOnly?: boolean
  scheduledFrom?: string
  scheduledTo?: string
  titleILike?: string
  unassignedTendwellCo?: boolean
  openOnly?: boolean
}): Promise<TaskRow[]> {
  let q = supabase.from('trellis_task_attributed').select('*')
  if (filter.tendwellOnly) q = q.eq('is_tendwell', true)
  if (filter.unassignedTendwellCo) q = q.eq('assigned_to_name', 'Tendwell Cleaning Co.')
  if (filter.scheduledFrom) q = q.gte('scheduled_date', filter.scheduledFrom)
  if (filter.scheduledTo) q = q.lte('scheduled_date', filter.scheduledTo)
  if (filter.titleILike) q = q.ilike('title', `%${filter.titleILike}%`)
  if (filter.openOnly) q = q.is('completed_at', null)
  const { data, error } = await q.order('scheduled_date').limit(500)
  if (error) throw error
  return (data ?? []) as TaskRow[]
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: PASS. (If `.from('trellis_reconciliation')` errors, Task 3 types weren't regenerated — fix before continuing.)

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/use-trellis-sync.ts
git commit -m "feat(trellis): add use-trellis-sync data hook"
```

---

## Phase 3 — Page registration & UI

### Task 5: Register the view, route, and nav

**Files:**
- Modify: `client/src/lib/auth.tsx` (VIEW_DEFINITIONS ~line 42; ROLE_VIEWS.admin ~line 85)
- Modify: `client/src/App.tsx` (lazy imports ~line 80; routes ~line 266)
- Modify: `client/src/components/AppSidebar.tsx` (Admin section ~line 82)

- [ ] **Step 1: Add the view id to `auth.tsx`**

In `VIEW_DEFINITIONS`, add to the Admin group (after the `settings` entry):

```ts
  { id: 'trellis-sync',        label: 'Trellis Sync',        group: 'Admin' },
```

In `ROLE_VIEWS.admin`, append `'trellis-sync'` to the array (admin only — do not add to other roles):

```ts
    'incoming-shipments', 'laundry-weigh-ins', 'onboarding-queue', 'trellis-sync',
```

- [ ] **Step 2: Add the lazy import + route in `App.tsx`**

After the other `lazyRetry` page consts (near line 80):

```ts
const TrellisSyncPage = lazyRetry(() => import("@/pages/trellis-sync"));
```

In the `<Switch>` (near the other admin routes), use the strict admin guard:

```tsx
        <Route path="/trellis-sync">{() => <AdminRoute component={TrellisSyncPage} />}</Route>
```

- [ ] **Step 3: Add the sidebar entry in `AppSidebar.tsx`**

Extend the existing `lucide-react` import with `Plug`, then add to the Admin section `items` (after Settings):

```ts
      { title: 'Trellis Sync', href: '/trellis-sync', view: 'trellis-sync', icon: Plug },
```

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: PASS for these files. (Will still error importing `@/pages/trellis-sync` until Task 6 — acceptable; verify no *other* errors, then proceed.)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/auth.tsx client/src/App.tsx client/src/components/AppSidebar.tsx
git commit -m "feat(trellis): register admin-only /trellis-sync route + nav"
```

### Task 6: Page shell with tabs, tiles, and refresh

**Files:**
- Create: `client/src/pages/trellis-sync.tsx`

- [ ] **Step 1: Write the page shell**

```tsx
import { useMemo, useState } from 'react'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/lib/auth'
import { RefreshCw, Link2, CheckCircle2, AlertTriangle, HelpCircle, Unlink } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useTrellisSync, fetchTasks, type TaskRow } from '@/hooks/use-trellis-sync'

function workspaceBadge(ws: 'A' | 'B' | null) {
  if (!ws) return null
  return <StatusBadge tone={ws === 'A' ? 'info' : 'primary'}>{ws === 'A' ? 'Tendwell' : 'Haven'}</StatusBadge>
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const plusDaysISO = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

export default function TrellisSyncPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const { recon, exceptions, roster, lastSync, linkMatch, requestSync } = useTrellisSync()

  const tiles = useMemo(() => {
    const rows = recon.data ?? []
    const by = (s: string) => rows.filter(r => r.match_status === s).length
    return {
      matched: by('matched'),
      suggested: by('suggested'),
      stale: by('stale'),
      unmatchedOps: by('unmatched'),
      unmatchedTrellis: exceptions.data?.length ?? 0,
    }
  }, [recon.data, exceptions.data])

  const syncing = lastSync.data?.status === 'requested' || lastSync.data?.status === 'running'

  const refresh = async () => {
    try {
      await requestSync.mutateAsync(user?.label || 'admin')
      toast({ title: 'Sync requested', description: 'The local runner will pick this up within a couple of minutes.' })
    } catch (e) {
      toast({ title: 'Could not request sync', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Trellis Sync"
        subtitle={
          <span>
            Last synced {timeAgo(lastSync.data?.finished_at ?? null)}
            {syncing && <span className="ml-2 text-warning">· sync {lastSync.data?.status}…</span>}
          </span>
        }
        actions={
          <Button size="sm" variant="outline" onClick={refresh} disabled={requestSync.isPending || syncing}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard title="Matched" value={tiles.matched} icon={CheckCircle2} tone="success" loading={recon.isLoading} />
        <StatCard title="Unmatched in Ops" value={tiles.unmatchedOps} icon={HelpCircle} tone="warning" loading={recon.isLoading} />
        <StatCard title="In Trellis, not in Ops" value={tiles.unmatchedTrellis} icon={AlertTriangle} tone="destructive" loading={exceptions.isLoading} />
        <StatCard title="Suggested" value={tiles.suggested} icon={Link2} tone="info" loading={recon.isLoading} />
        <StatCard title="Stale links" value={tiles.stale} icon={Unlink} tone="warning" loading={recon.isLoading} />
      </div>

      <Tabs defaultValue="reconciliation" className="w-full">
        <TabsList>
          <TabsTrigger value="reconciliation" data-testid="tab-reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="workflows" data-testid="tab-workflows">Workflows</TabsTrigger>
          <TabsTrigger value="roster" data-testid="tab-roster">Tendwell Roster</TabsTrigger>
        </TabsList>

        <TabsContent value="reconciliation" className="space-y-5">
          <ReconciliationTab recon={recon} exceptions={exceptions} linkMatch={linkMatch} />
        </TabsContent>
        <TabsContent value="workflows">
          <WorkflowsTab />
        </TabsContent>
        <TabsContent value="roster">
          <RosterTab roster={roster} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
```

(The three tab components and the workflow list are added in Tasks 7–9 in this same file, above `export default function TrellisSyncPage`. The file will not compile until Task 9 adds them — that is expected; do not run `tsc` between 6 and 9.)

- [ ] **Step 2: Commit (compiles after Task 9)**

```bash
git add client/src/pages/trellis-sync.tsx
git commit -m "feat(trellis): page shell, summary tiles, refresh enqueue"
```

### Task 7: Reconciliation tab

**Files:**
- Modify: `client/src/pages/trellis-sync.tsx` (add component above `export default`)

- [ ] **Step 1: Add the `ReconciliationTab` component**

```tsx
function ReconciliationTab({ recon, exceptions, linkMatch }: {
  recon: ReturnType<typeof useTrellisSync>['recon']
  exceptions: ReturnType<typeof useTrellisSync>['exceptions']
  linkMatch: ReturnType<typeof useTrellisSync>['linkMatch']
}) {
  const { toast } = useToast()
  if (recon.error) return <ErrorState onRetry={() => recon.refetch()} />

  const rows = recon.data ?? []
  const exRows = exceptions.data ?? []

  const confirm = async (opsId: number, opsName: string, trellisId: string | null) => {
    try {
      await linkMatch.mutateAsync({ opsId, opsName, trellisId })
      toast({ title: trellisId ? 'Match linked' : 'Match cleared', description: opsName })
    } catch (e) {
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-5">
      {/* Exceptions panel — Tendwell work in Trellis with no Ops home */}
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <h2 className="text-sm font-semibold">In Trellis, not in Ops ({exRows.length})</h2>
        </div>
        {exceptions.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : exRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing unaccounted for. Every Tendwell-serviced Trellis property maps to an Ops property.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-2xs uppercase text-muted-foreground text-left">
                <th className="py-1 pr-3">Trellis property</th><th className="py-1 pr-3">Workspace</th><th className="py-1 pr-3">Tendwell tasks</th>
              </tr></thead>
              <tbody>
                {exRows.map(e => (
                  <tr key={e.trellis_id} className="border-t border-border/50">
                    <td className="py-1.5 pr-3">{e.name}</td>
                    <td className="py-1.5 pr-3">{workspaceBadge(e.workspace)}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{e.tendwell_task_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mapping table */}
      <div className="rounded-2xl border border-card-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-2xs uppercase text-muted-foreground text-left">
                <th className="py-2 px-3">Ops property</th>
                <th className="py-2 px-3">Trellis match</th>
                <th className="py-2 px-3">Workspace</th>
                <th className="py-2 px-3">Tendwell tasks</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {recon.isLoading ? (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground text-xs">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6}><EmptyState title="No properties" description="Run a sync to populate Trellis data." /></td></tr>
              ) : rows.map(r => (
                <tr key={r.ops_property_id} className="border-t border-border/50">
                  <td className="py-1.5 px-3 font-medium">{r.ops_name}</td>
                  <td className="py-1.5 px-3 text-muted-foreground">
                    {r.match_status === 'matched' && r.linked_trellis_name}
                    {r.match_status === 'stale' && <span className="text-warning">link no longer resolves</span>}
                    {r.match_status === 'suggested' && <span>{r.suggested_trellis_name}</span>}
                    {r.match_status === 'unmatched' && <span className="text-muted-foreground/60">—</span>}
                  </td>
                  <td className="py-1.5 px-3">{workspaceBadge(r.linked_workspace ?? r.suggested_workspace)}</td>
                  <td className="py-1.5 px-3 tabular-nums">{r.tendwell_task_count ?? 0}</td>
                  <td className="py-1.5 px-3">
                    <StatusBadge tone={r.match_status === 'matched' ? 'success' : r.match_status === 'suggested' ? 'info' : 'warning'}>
                      {r.match_status}
                    </StatusBadge>
                  </td>
                  <td className="py-1.5 px-3 text-right">
                    {r.match_status === 'suggested' && (
                      <Button size="sm" variant="outline" onClick={() => confirm(r.ops_property_id, r.ops_name, r.suggested_trellis_id)} disabled={linkMatch.isPending}>
                        Confirm
                      </Button>
                    )}
                    {r.match_status === 'stale' && (
                      <Button size="sm" variant="ghost" onClick={() => confirm(r.ops_property_id, r.ops_name, null)} disabled={linkMatch.isPending}>
                        Clear link
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/trellis-sync.tsx
git commit -m "feat(trellis): reconciliation tab — mapping table + exceptions panel"
```

### Task 8: Workflows tab

**Files:**
- Modify: `client/src/pages/trellis-sync.tsx`

- [ ] **Step 1: Add the workflow list + `WorkflowsTab` component**

```tsx
const WORKFLOWS: { id: string; label: string; description: string; run: () => Promise<TaskRow[]> }[] = [
  { id: 'today', label: "Today's Tendwell cleans", description: 'All Tendwell cleaning/inspection tasks scheduled today (A + B).',
    run: () => fetchTasks({ tendwellOnly: true, scheduledFrom: todayISO(), scheduledTo: todayISO() }) },
  { id: 'upcoming', label: 'Upcoming (next 7 days)', description: 'Scheduled Tendwell cleans/inspections in the next week.',
    run: () => fetchTasks({ tendwellOnly: true, scheduledFrom: todayISO(), scheduledTo: plusDaysISO(7) }) },
  { id: 'selfinspections', label: 'Cleaner self-inspections due', description: 'Open Cleaner Self-Inspection tasks.',
    run: () => fetchTasks({ tendwellOnly: true, titleILike: 'Self-Inspection', openOnly: true }) },
  { id: 'unassigned', label: 'Unassigned Tendwell work', description: 'B tasks still on "Tendwell Cleaning Co." — not yet dispatched to a person.',
    run: () => fetchTasks({ unassignedTendwellCo: true, openOnly: true }) },
  { id: 'airfilters', label: 'Air-filter changes scheduled', description: 'Upcoming Air Filter Change tasks.',
    run: () => fetchTasks({ tendwellOnly: true, titleILike: 'Air Filter', scheduledFrom: todayISO(), scheduledTo: plusDaysISO(60) }) },
]

function WorkflowsTab() {
  const [active, setActive] = useState(WORKFLOWS[0].id)
  const wf = WORKFLOWS.find(w => w.id === active)!
  const q = useQuery({
    queryKey: ['/supabase/trellis-sync', 'workflow', active],
    queryFn: wf.run,
    refetchOnWindowFocus: false,
  })

  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-4">
      <div className="space-y-1">
        {WORKFLOWS.map(w => (
          <button key={w.id} onClick={() => setActive(w.id)}
            className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${active === w.id ? 'bg-primary/10 text-foreground' : 'hover:bg-muted text-muted-foreground'}`}>
            <div className="font-medium">{w.label}</div>
            <div className="text-2xs text-muted-foreground">{w.description}</div>
          </button>
        ))}
      </div>
      <div className="rounded-2xl border border-card-border shadow-sm overflow-hidden">
        {q.error ? <ErrorState onRetry={() => q.refetch()} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr className="text-2xs uppercase text-muted-foreground text-left">
                <th className="py-2 px-3">Property</th><th className="py-2 px-3">Task</th><th className="py-2 px-3">Dept</th>
                <th className="py-2 px-3">Assignee</th><th className="py-2 px-3">Scheduled</th><th className="py-2 px-3">Status</th>
              </tr></thead>
              <tbody>
                {q.isLoading ? (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground text-xs">Loading…</td></tr>
                ) : (q.data ?? []).length === 0 ? (
                  <tr><td colSpan={6}><EmptyState title="Nothing here" description="No tasks match this workflow right now." /></td></tr>
                ) : (q.data ?? []).map(t => (
                  <tr key={t.trellis_task_id} className="border-t border-border/50">
                    <td className="py-1.5 px-3">{t.property_name}</td>
                    <td className="py-1.5 px-3">{t.title}</td>
                    <td className="py-1.5 px-3 text-muted-foreground">{t.department_name}</td>
                    <td className="py-1.5 px-3 text-muted-foreground">{t.assigned_to_name ?? '—'}</td>
                    <td className="py-1.5 px-3 tabular-nums">{t.scheduled_date ?? '—'}</td>
                    <td className="py-1.5 px-3"><StatusBadge status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/trellis-sync.tsx
git commit -m "feat(trellis): workflows tab with the five starting data-pulls"
```

### Task 9: Roster tab + finalize

**Files:**
- Modify: `client/src/pages/trellis-sync.tsx`

- [ ] **Step 1: Add the `RosterTab` component**

```tsx
function RosterTab({ roster }: { roster: ReturnType<typeof useTrellisSync>['roster'] }) {
  if (roster.error) return <ErrorState onRetry={() => roster.refetch()} />
  const rows = roster.data ?? []
  return (
    <div className="rounded-2xl border border-card-border shadow-sm overflow-hidden">
      <div className="px-4 py-2 text-2xs text-muted-foreground border-b border-border/50">
        Workspace A members — the canonical "is this person Tendwell?" list used for task attribution.
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40"><tr className="text-2xs uppercase text-muted-foreground text-left">
            <th className="py-2 px-3">Name</th><th className="py-2 px-3">Email</th><th className="py-2 px-3">Role</th><th className="py-2 px-3">Departments</th>
          </tr></thead>
          <tbody>
            {roster.isLoading ? (
              <tr><td colSpan={4} className="py-6 text-center text-muted-foreground text-xs">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4}><EmptyState title="No roster" description="Run a sync to populate the Tendwell roster." /></td></tr>
            ) : rows.map(m => (
              <tr key={m.user_id} className="border-t border-border/50">
                <td className="py-1.5 px-3 font-medium">{m.name ?? '—'}</td>
                <td className="py-1.5 px-3 text-muted-foreground">{m.email ?? '—'}</td>
                <td className="py-1.5 px-3">{m.role && <StatusBadge tone={m.role === 'ADMIN' ? 'info' : 'primary'}>{m.role}</StatusBadge>}</td>
                <td className="py-1.5 px-3 text-muted-foreground">{m.departments.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check the whole page**

Run: `npm run check`
Expected: PASS (page + hook + registration all compile).

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/trellis-sync.tsx
git commit -m "feat(trellis): roster tab"
```

---

## Phase 4 — Initial sync & end-to-end verification

### Task 10: Run an initial sync via MCP and verify the page

This proves the page before the cron exists. Performed by the implementing Claude session (has MCP access).

- [ ] **Step 1: Pull workspace A roster, properties, tasks via MCP**

Use `mcp__trellis-workspace-a__trellis`:
- `call read_workforce {"limit":100}` (all 34 members → roster)
- `call trellisql_query {"view":"properties","select":["id","name","status","city"],"limit":200}`
- `call trellisql_query {"view":"tasks","select":["id","title","property_id","property_name","department_name","status","priority","assigned_to_id","assigned_to_name","scheduled_date","completed_at"],"limit":500}`

- [ ] **Step 2: Pull workspace B properties + Tendwell tasks via MCP**

Use `mcp__trellis-workspace-b__trellis`:
- Properties: `call trellisql_query {"view":"properties","select":["id","name","status","city"],"limit":1000}` (paginate via offset as needed)
- Tendwell tasks: page the `tasks` view filtered to `department_name='Cleaning'` within a window (`scheduled_date` from 30 days ago to 90 days ahead). Keep rows where `assigned_to_name = 'Tendwell Cleaning Co.'` OR `assigned_to_id` ∈ the workspace-A roster `user_id`s from Step 1.

- [ ] **Step 3: Upsert into snapshot tables**

Use `mcp__supabase__execute_sql` (project `eetsudoksvsmwtiqraot`) to `insert ... on conflict (<pk>) do update` into `trellis_roster`, `trellis_property_snapshot` (workspace tagged A/B), and `trellis_task_snapshot`. Then insert a `trellis_sync_log` row: `status='done', trigger='manual', finished_at=now(), counts='{...}'`.

- [ ] **Step 4: Verify reconciliation counts**

```sql
select match_status, count(*) from trellis_reconciliation group by 1 order by 1;
select count(*) from trellis_exceptions;
```

Expected: `matched` ≈ 63; a populated `suggested` bucket; `trellis_exceptions` lists Tendwell Trellis properties (incl. the 12 workspace-A direct clients) with no Ops match. Spot-check that Rick Aquino / Shane Stephens appear as exceptions if they aren't in Ops.

- [ ] **Step 5: Manual UI verification**

Run: `npm run dev`, sign in as an admin, open `/trellis-sync`.
Expected: tiles populated; Reconciliation table + exceptions render; clicking **Confirm** on a suggested row links it (row moves to `matched`); Workflows tab returns today's/upcoming tasks; Roster tab lists the 34 members. Confirm a non-admin (or emulated) session gets "no access".

- [ ] **Step 6: Commit any fixes**

```bash
git add -A && git commit -m "fix(trellis): adjustments from initial sync verification"
```

---

## Phase 5 — Automated nightly + on-demand sync runner

### Task 11: The sync skill

**Files:**
- Create: `.claude/skills/trellis-sync/SKILL.md`

- [ ] **Step 1: Write the skill**

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/trellis-sync/SKILL.md
git commit -m "feat(trellis): headless sync skill"
```

### Task 12: Cron wrapper + on-demand poller + runbook

**Files:**
- Create: `scripts/trellis-sync.sh`
- Create: `scripts/trellis-sync-poller.mjs`
- Create: `docs/trellis-sync-cron.md`

- [ ] **Step 1: Write the wrapper**

```bash
#!/usr/bin/env bash
# Nightly + on-demand Trellis → Supabase sync. Runs Claude Code headless with
# the trellis-sync skill (the only context that has the Trellis MCP servers).
set -euo pipefail
cd "$(dirname "$0")/.."
LOG="${TMPDIR:-/tmp}/trellis-sync-$(date +%Y%m%d-%H%M%S).log"
echo "[trellis-sync] start $(date)" >> "$LOG"
claude -p "Use the trellis-sync skill to run a full Trellis→Supabase sync now." >> "$LOG" 2>&1
echo "[trellis-sync] done $(date)" >> "$LOG"
```

- [ ] **Step 2: Write the poller**

```js
// scripts/trellis-sync-poller.mjs
// Runs every 1–2 min via cron. If a `requested` sync row exists, fire the
// wrapper (which runs Claude headless). Uses the Supabase service role key so
// it can read the sync log without an interactive session.
import { createClient } from '@supabase/supabase-js'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1) }

const supabase = createClient(url, key)
const { data, error } = await supabase
  .from('trellis_sync_log').select('id').eq('status', 'requested').limit(1)
if (error) { console.error(error.message); process.exit(1) }
if (!data || data.length === 0) { process.exit(0) }

const here = dirname(fileURLToPath(import.meta.url))
execFile(join(here, 'trellis-sync.sh'), (err) => {
  if (err) console.error('[poller] wrapper failed:', err.message)
})
```

- [ ] **Step 3: Write the runbook**

```markdown
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
```

- [ ] **Step 4: Verify the runner end-to-end**

Run: `./scripts/trellis-sync.sh`
Expected: completes; `select status, counts from trellis_sync_log order by created_at desc limit 1;` shows `done` with non-zero counts. Then click Refresh in the UI and confirm the poller path advances a `requested` row to `done`.

- [ ] **Step 5: Commit**

```bash
git add scripts/trellis-sync.sh scripts/trellis-sync-poller.mjs docs/trellis-sync-cron.md
git commit -m "feat(trellis): nightly cron wrapper, on-demand poller, runbook"
```

---

## Phase 6 — Docs & PR

### Task 13: Update CLAUDE.md and open the PR

- [ ] **Step 1: Update `CLAUDE.md`**

Add `/trellis-sync` to the Pages table (admin), the four `trellis_*` tables to the Database section, and a "Current State & Recent Work" line summarizing the feature.

- [ ] **Step 2: Commit, push, open PR**

```bash
git add CLAUDE.md && git commit -m "docs(trellis): document /trellis-sync page, sync tables, runner"
git push -u origin claude/trellis-sync-reconciliation
gh pr create --title "Trellis sync & reconciliation (admin)" --body "Implements docs/superpowers/specs/2026-06-18-trellis-sync-reconciliation-design.md"
```

(Per repo workflow: squash-merge + delete branch after review.)

---

## Self-review notes (coverage check)

- Spec §2 attribution rule → Task 1 `trellis_task_attributed` + Task 2 fixture assertions.
- Spec §4 architecture (snapshot tables, nightly, refresh enqueue) → Tasks 1, 11, 12.
- Spec §5 page (route/access, tiles, 3 tabs, exceptions) → Tasks 5–9.
- Spec §5 exception flags 1–4 → `trellis_exceptions` view + Reconciliation `match_status` (`matched/stale/suggested/unmatched`) + exceptions panel.
- Spec §6 matching (exact + normalized + suggested, admin-confirmed) → `tendwell_normalize_name`, `trellis_reconciliation`, Task 7 Confirm action.
- Decisions: nightly local cron (Task 12), working refresh via enqueue (hook `requestSync` + poller), five workflows (Task 8).
- Type consistency: `match_status` values, `is_tendwell`/`is_tendwell_property` flags, `linkMatch`/`requestSync`/`fetchTasks` names, and table/view identifiers are used identically across the migration, hook, and page.
