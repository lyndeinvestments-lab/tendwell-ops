# Tendwell ↔ Trellis Sync & Reconciliation — Design

- **Date:** 2026-06-18
- **Status:** Draft for review
- **Branch:** `claude/trellis-sync-reconciliation`
- **Author:** Claude (with Jordan)

---

## 1. Overview

A new **admin-only** page in Tendwell Ops that maps every Tendwell Ops property to its
Trellis counterpart across **both** Trellis workspaces, surfaces reconciliation
exceptions where Trellis and Tendwell Ops disagree, and hosts a **Workflows** tab of
regular Trellis data-pulls.

The page's primary value is the **exception detector**: anything Tendwell is doing in
Trellis (a property serviced, a task assigned to a Tendwell cleaner) that has no matching
property in Tendwell Ops gets flagged as a potential data gap.

---

## 2. Background — the two Trellis workspaces (verified 2026-06-18)

There are two Trellis MCP connections, structurally identical but scoped to different data:

| | **Workspace A — Tendwell's Trellis** | **Workspace B — Haven's Trellis** |
|---|---|---|
| Contents | 12 Tendwell-direct client properties | Haven's full portfolio (~240+ properties) |
| Properties | Rick Aquino Lodge A–H, Shane Stephens 3516, William Seith 741, Beautiful View, Rustic Chandelier, Jordan Test | Owner-name + unit# + area-code, e.g. `Candace Thompson 720 (SCounty)` |
| Cleaning vendors | Tendwell only | Multiple: **Tendwell Cleaning Co.**, Knoxville Haven's Company, Blessed Cleaning and More LLC, … |
| Members | 34 (the canonical Tendwell roster) | 233 (Haven's full workforce) |

**Verified facts that drive the design:**

1. **Haven does not route tasks into workspace A.** Workspace A holds exactly 37 tasks,
   all for its own 12 properties; 0 tasks scheduled "today" there. The Haven→Tendwell
   handoff lives entirely in workspace B.
2. **Trellis B has no property-level "who cleans this" marker.** `assignees`,
   `division_id`, and `custom_fields` are null on sampled properties (both Tendwell and
   non-Tendwell). So the definition of "Tendwell services this property" cannot be read
   out of Trellis — it must live in Tendwell Ops (Supabase).
3. **Tendwell's work in B is identifiable by assignee.** A task in B is Tendwell's if:
   - `assigned_to_name = "Tendwell Cleaning Co."` (the company label — used until the task
     is dispatched to a person), **OR**
   - `assigned_to_id` is a member of **workspace A** (joined by shared `user_id`, which is
     identical across both Trellis instances).
   - Confirmed: Saira Vega, Joselin Gonzalez, Yeimi Ruiz, Yeimi Blandin, Marbyn Garcia,
     Wendy Navarro, Fani Raudales all appear on B's cleaning board today AND are workspace
     A members with matching `user_id`s. Donnita Thomas (Knoxville's) is correctly excluded
     — not in A.
   - "Tendwell Cleaning Co." is itself a workspace A member (`user_id 8f45e842…`,
     `tendwellcleaning@gmail.com`).
4. **Tendwell's work = Cleaning department** in both workspaces. Task types observed:
   `Departure Clean`, `Turn Clean`, `Air Filter Change`, `Cleaner Self-Inspection`.
   (Maintenance and Runner tasks in B belong to Haven, not Tendwell.)

**Canonical rule:**
> A Trellis task is Tendwell's if it is in workspace A, OR it is in workspace B and its
> assignee is "Tendwell Cleaning Co." or a workspace-A member (`user_id` join).
> A Trellis property is "Tendwell-serviced" if it has ≥1 Tendwell task.

---

## 3. Tendwell Ops current state

- Supabase `properties` table: 241 rows, with a nullable `trellis_id` column. 63 rows
  already have a `trellis_id`; **all 63 resolve in workspace B** (none in A). 178 are
  unmatched.
- Existing Trellis integration scaffold: `/api/trellis/*` serverless proxies hit the public
  REST API (`api.trellistech.com/v1`) with `TRELLIS_API_KEY`. That public API is thin (no
  structured list endpoints; `tasks-today.ts` resorts to `/agent/invoke`). **This page will
  not depend on the thin REST API** — see architecture below.

---

## 4. Architecture

The deployed Vercel site **cannot reach the Trellis MCP gateway** (that is available only to
a Claude Code session / agent). Therefore:

```
Nightly Claude agent (MCP access to workspace A + B)
   │  reads: properties, tasks, workforce  (structured trellisql / read_* tools)
   ▼
Supabase snapshot tables  ◄── the page only ever reads these + live `properties`
   │
   ▼
/trellis-sync admin page  (React Query → Supabase)
```

- **No per-view agent billing**, fast page loads, data is "as of last sync" (timestamp shown).
- **Sync runner: a local cron on this device** (the Mac running Claude Code, which has the
  `trellis-workspace-a/b` MCP connections authenticated). Runs **nightly** as the scheduled
  baseline.
- **On-demand refresh:** because the deployed Vercel site cannot reach the MCP gateway, the
  page's "Refresh" button does not run the sync directly — it **enqueues a sync request**
  (a row in `trellis_sync_log` with `status = 'requested'`). The local runner polls for
  requested syncs (short interval, e.g. every 1–2 min) and executes them, so the button is
  functional end-to-end with a small delay. The page reflects request → running → done via
  the sync-log row.

### 4.1 New Supabase tables

`trellis_property_snapshot`
- `trellis_id` (uuid, PK), `workspace` ('A'|'B'), `name`, `status`, `city`,
  `is_tendwell_serviced` (bool), `tendwell_task_count` (int), `synced_at` (timestamptz)

`trellis_task_snapshot`
- `trellis_task_id` (uuid, PK), `workspace`, `trellis_property_id`, `property_name`,
  `title`, `department_name`, `status`, `priority`, `assigned_to_id`, `assigned_to_name`,
  `is_tendwell` (bool), `scheduled_date`, `completed_at`, `synced_at`

`trellis_roster`
- `user_id` (uuid, PK), `member_id`, `workspace` ('A'), `name`, `email`, `role`,
  `departments` (text[]), `is_active` (bool), `synced_at`

`trellis_sync_log`
- `id`, `started_at`, `finished_at`, `status`, `counts` (jsonb), `error` (text)

All tables: admin-only RLS (consistent with the existing security model; writes only by the
service-role sync job).

---

## 5. The page — `/trellis-sync`

- **Route/access:** `/trellis-sync`, **admin only** (add to `VIEW_ACCESS` in `auth.tsx`,
  `GuardedRoute`, `App.tsx` router, `AppSidebar.tsx` nav). Uses the shared `PageContainer` /
  `PageHeader` / `StatCard` / `StatusBadge` / `ErrorState` shell.
- **Header:** "Last synced" timestamp + working **"Refresh"** button that enqueues an
  on-demand sync request (picked up by the local runner; see §4). Shows request/running/done state.

### Tab 1 — Reconciliation (default)

- **Summary tiles:** Matched · Unmatched (Trellis→Ops) · Unmatched (Ops→Trellis) ·
  Suggested matches · Stale links
- **Mapping table:** one row per Tendwell Ops property ↔ its Trellis property. Columns:
  Ops property, stage, Trellis match (name + workspace A/B badge), Tendwell-serviced?, task
  count, match status. Inline "confirm / change match" writes `properties.trellis_id`
  (admin-reviewed; nothing auto-writes).
- **Exceptions panel** (the core requirement) flags:
  1. **In Trellis, not in Ops** — Trellis property (A or B) with Tendwell tasks but no
     matching Ops property → "add or match this property."
  2. **Name match, not linked** — high-confidence name match with no `trellis_id` → one-click confirm.
  3. **Stale link** — `trellis_id` set but no longer resolves in Trellis.
  4. **Serviced but unmatched** — Tendwell tasks in B on a property not matched in Ops.

### Tab 2 — Workflows

A list of named Trellis data-pulls, each with a run/refresh affordance and last-result
display. Confirmed initial set (extensible):
- **Today's Tendwell cleans** — A tasks today + B tasks today where `is_tendwell`.
- **Upcoming (next 7 days)** — scheduled Tendwell cleans/inspections.
- **Cleaner self-inspections due** — `Cleaner Self-Inspection` tasks, open/scheduled.
- **Unassigned Tendwell work** — B tasks still assigned to "Tendwell Cleaning Co." (not yet
  dispatched to a person) → actionable dispatch queue.
- **Air-filter changes scheduled** — `Air Filter Change` tasks upcoming.

Workflows read from the snapshot tables (fast) with the option to mark which need live data.

### Tab 3 — Tendwell Roster

Workspace A's 34 members (read-only) so an admin can verify who counts as "Tendwell" for the
task-attribution rule. Highlights the ~19 active cleaners + "Tendwell Cleaning Co."

---

## 6. Matching logic

1. **Exact name match** (Ops `name` == Trellis `name`).
2. **Normalized match** — strip Trellis area-code suffixes (`(SCounty)`, `(PF)`, `(GAT)`,
   `(KCity)`, `(BC)`, `(JC)` …), trim/casefold, compare owner-name + unit number.
3. Remaining Trellis-Tendwell properties with no confident match → **Suggested** for
   one-click human confirm.
4. **Nothing auto-writes `trellis_id`** — every link is admin-confirmed. The 63 existing
   links are treated as ground truth unless flagged stale.

---

## 7. Out of scope (v1)

- Writing back to Trellis (creating/reassigning tasks) — read-only this round.
- Replacing the existing `/api/trellis/tasks-today` dashboard tile.
- Auto-creating missing Ops properties (we flag; admin decides).

---

## 8. Decisions (resolved 2026-06-18)

1. **Sync runner:** local cron on this device (the Mac with the Trellis MCP connections),
   running nightly. To verify during implementation: the exact headless Claude Code
   invocation and that both MCP servers authenticate in that context.
2. **Workflows set:** ship the five listed in §5 Tab 2 as the starting set.
3. **Manual refresh:** the "Refresh" button works — it enqueues an on-demand sync request
   that the local runner executes (see §4).
