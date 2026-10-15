# Trellis API expansion — plan (2026-10-14)

Goal: make Trellis the single automated source for Tendwell Ops (tasks, roster, reviews,
clean history), retire the sloppy/manual paths, attribute quality signals (inspections +
guest reviews) to the clean and cleaner that earned them, and document the whole thing
inside the app.

## Facts established before planning (live DB + live Trellis API)

- **Workspaces:** A = Tendwell's own Trellis (44 workforce members, 76 Ops properties link
  here). B = Haven's Trellis (242 Ops properties link here). Sync talks to the Trellis MCP
  JSON-RPC endpoint (`api/trellis/_sync-core.ts` `callTool`), tools `trellisql_query`,
  `read_workforce`; `read_reviews` is callable the same way. Responses cap at ~12 KB.
- **Reviews ARE in Trellis (workspace B).** `read_reviews` returns `overall_rating`,
  `max_rating`, `category_ratings.cleanliness`, `content`, `source`, `reviewer_name`,
  `review_date`, `property_id`, `reservation_id`, and with `include:["reservation"]` the
  stay's `checkin_date`/`checkout_date`. The current `/reviews` page proxies Haven-OS
  (`api/reviews/*`, env key never finished on Haven's side) — replace with Trellis.
- **Inspection checklist answers are NOT exposed** by any Trellis API (MCP `tasks_get`
  projects no checklist; `read_tasks include:["media"]` returns only photos; the public REST
  API has no task endpoints). Only `checklist_total/completed` counts are available. So the
  "rate the previous clean" score must be captured in Ops. Ops already has 1,549
  inspections (250 in the last 30 days, all scored in Ops) but only ~43% carry a
  `cleaner_id`, and none link to a clean task. Trellis itself has only a handful of
  inspection tasks (A: "Cleaning Inspection", "Turn Cleaning Inspection").
- **Cleaner identity on Haven cleans:** last 30 days of completed B cleans: 971 assigned to
  the vendor "Tendwell Cleaning Co." (no individual), 161 to a Tendwell roster member, 480
  to non-Tendwell Haven people (ignore). Workspace A: 364 roster-assigned. So attribution is
  individual when a roster member is on the task, otherwise "Tendwell crew (unassigned)".
- **Cleaners** (`cleaners`, 22 rows) are hand-maintained; only `is_active`; hard delete is
  the only exit; matched to Trellis by email only. `trellis_roster` holds 61 rows vs 44 live
  members — the sync never deactivates people who left Trellis.
- **Breezeway** is still fed daily by `.github/workflows/breezeway-import.yml` →
  `api/tasks/breezeway-import.ts`. Every financial clean-count view is Breezeway-first
  (Trellis only for properties with zero Breezeway rows). Haven's Trellis B tasks are
  themselves synced from Breezeway (they carry `breezeway_declined` flags), so Trellis B is a
  superset going forward. Snapshot history: A from 2026-04-11, B only from 2026-09-08.
- **Porchlight Retreat** = Ops #577 "Craig Sheflin 2746" (second Haven Trellis record
  `52447150…`, Hostaway 588230). FIXED during planning: `property_aliases` row inserted and
  the 6 snapshot tasks re-pointed.

## Scope decisions (made autonomously; flag in the final report)

1. Keep the Breezeway CSV import running for now — invoicing (`api/invoices/*`) is out of
   scope and still reads `breezeway_tasks`. Financial views switch to Trellis from a
   configurable cutover month; Breezeway stays only as the archive before it.
2. Removing `/trellis-tasks` and `/property-verifications` (Jordan asked: "get rid of
   that"). Code and routes go; **DB tables are kept** (no destructive drops):
   `property_verifications`, `trellis_roster_dismissals`, `tasks.verification_property_id`,
   `notification_preferences.notify_verification_due` stay, unused.
3. Sync-created cleaners do **not** get app logins automatically (security): the
   `cleaner_grant_app_access` trigger must skip `source='trellis'` rows; the existing Invite
   button grants access deliberately.
4. A guest review rates the clean that **prepared the stay**: last completed Tendwell clean
   at the property with `scheduled_date <= reservation.checkin_date` (and within 14 days).
   An inspection rates the last completed clean at the property on/before `inspected_at`.

## Workstreams

Each workstream = one worktree, one branch `claude/<name>`, one PR, squash-merged when CI is
green (repo auto-merge policy). Migrations are applied to the live DB
(`eetsudoksvsmwtiqraot`) via Supabase MCP AND saved under `supabase/migrations/` with a
`20261014x_` prefix. Only additive DDL. Nobody edits `CLAUDE.md` except WS6.

### WS1 — Backend: schema, sync engine, attribution (phase 1, blocks WS3–WS5)

Migration(s):
- `trellis_review_snapshot` (pk `trellis_review_id` text): workspace, trellis_property_id,
  property_name, reservation_id, checkin_date, checkout_date, guest_name/reviewer_name,
  overall_rating, max_rating, normalized_rating, cleanliness_rating, category_ratings jsonb,
  content, title, source, review_date timestamptz, host_response_status, synced_at.
  Same alias rewrite as `trellis_task_snapshot` (BEFORE trigger reusing the alias logic) so
  property ids line up. RLS: staff read (`is_staff()`), service-role write.
- `trellis_roster`: add `last_seen_at`, `removed_at`. Sync sets `is_active=false,
  removed_at=now()` for members not returned by a full roster pull (never delete); clears
  on return.
- `cleaners`: add `trellis_user_id uuid unique`, `status text not null default 'active'
  check (status in ('active','offboarded'))`, `offboarded_at timestamptz`, `source text
  default 'manual'`. Keep `is_active` consistent with status (trigger or sync writes both).
  Backfill links by email/alt_email, then exact normalized name, against `trellis_roster`.
  Patch `cleaner_grant_app_access` to skip `source='trellis'`.
- `inspections`: add `trellis_task_id uuid unique` (the Trellis inspection task this rates,
  nullable), `rated_clean_task_id uuid` (the clean being rated), `attribution text`
  ('manual'|'trellis'). BEFORE INSERT/UPDATE trigger: when `rated_clean_task_id` is null,
  find the previous completed clean (rule 4) via the mapping view and fill
  `rated_clean_task_id`, `last_cleaned_on` (if null), and `cleaner_id` (if null and the clean's
  assignee maps to a cleaner) with `attribution='trellis'`. Never overwrite a manually chosen
  cleaner. One-time backfill over existing inspections (only fills nulls).
- Views (security_invoker on, staff readable):
  - `trellis_ops_property_map(trellis_id, property_id)` = `properties.trellis_id` ∪
    `property_aliases.trellis_id`.
  - `trellis_clean_tasks`: COMPLETED Tendwell clean tasks (A all; B where vendor
    "Tendwell Cleaning Co." or assignee in roster) classified as a clean by title (turn,
    departure, deep, onboarding, vacancy/touch-up, owner-stay clean; exclude inspection, hot
    tub, trash, filter, linen-only), with ops `property_id`, `cleaner_id` (via
    `cleaners.trellis_user_id` on assigned_to_id or any `assignees[].assignee_id`),
    `crew_label`. Keep the SQL classifier consistent with `shared/aux-tasks.ts` and add a
    TS mirror + vitest cases.
  - `review_clean_attribution`: each review → ops property → prepared-by clean task →
    cleaner.
  - `trellis_inspection_tasks`: Trellis tasks whose title matches inspection, with ops
    property, previous clean, and the Ops inspection that rated it (if any).
Sync engine:
- Roster: paginate `read_workforce`; deactivate missing members (full sync only).
- Cleaner sync (full sync, after roster): roster members in a Cleaning / Quality Control /
  Inspection department, excluding role ADMIN and the "AI Agent" user, are upserted into
  `cleaners` by `trellis_user_id` (link existing by email first; create with
  `source='trellis'` otherwise; never rename a manual record). Linked cleaners whose roster
  row went inactive → `status='offboarded'`, `offboarded_at`; back on roster → active.
- Reviews: new cron `api/cron/trellis-reviews-sync.ts` (own 300 s budget) pulling B
  `read_reviews` with `include:["reservation"]`, sorted by review_date desc, page size small
  enough for the 12 KB cap, incremental (stop once past `max(review_date) - 14 days`;
  first run backfills 365 days, resumable across runs via the sync log). Add to vercel.json.
- History backfill: `backfillCompletedTasks(from, to)` in `_sync-core.ts` + admin endpoint
  `POST /api/trellis/backfill` (month at a time, deadline-aware) pulling COMPLETED Tendwell
  tasks for A and B. Run it for 2025-06 → today once deployed and record how far back
  Trellis B actually has data.
- Regenerate `shared/database.types.ts`.

### WS2 — Cleanup + API Sync property tools (phase 1, parallel with WS1)

- Remove `/trellis-tasks` page + wiring (App.tsx, AppSidebar, auth VIEW_DEFINITIONS/ROLE_VIEWS,
  i18n dictionaries + registry, nav labels, api-areas entry may stay). Dashboard
  "Trellis Tasks Today" tile: keep the hook, point the click at `/api-sync`. Remove the id
  from the live `app_settings.role_permissions` blob.
- Remove `/property-verifications` page + wiring (App, sidebar, CommandPalette, keyboard
  shortcut `i`, auth, chat allowed-views in api/chat.ts + server/chat.ts, notify event
  `verification_due` + prefs UI + digest section, i18n). Property modal: remove the
  Verification tab + `VerificationHistory`, reword `inspectionExemptTooltip` (no
  "verifications"). Leave north-star.tsx alone (WS5 owns it).
- API Sync → "In Trellis, not in Ops" panel: per-row **Link to Ops property** (SearchSelect
  → inserts `property_aliases` with trellis_id + name; re-point existing snapshot rows for
  that trellis id, like the Porchlight fix). Creating a property from there is out of scope.
  Mapping table rows: **Use Trellis name** (rename Ops property to the linked Trellis name,
  logged via `logPropertyEdit`; confirm dialog). New **Aliases** card listing
  `property_aliases` with remove (confirm dialog). Verify `property_aliases` RLS allows
  admin insert/delete; add policies via migration if not.
- Breezeway tab: label "Breezeway (legacy archive)" with a one-line explanation.

### WS3 — Cleaners + Cleaner Metrics on Trellis (phase 2)

- Cleaners page: status filter (Active / Offboarded / All), Trellis-linked badge + source,
  manual "Offboard"/"Reactivate" (replaces hard delete as the primary action; keep delete
  behind confirm for admins), link-to-Trellis picker for unlinked rows, "Unlinked Trellis
  members" panel (roster rows with no cleaner; Link / Create / Ignore using
  `trellis_roster_dismissals`).
- Cleaner Metrics: per cleaner over a date range — completed cleans (from
  `trellis_clean_tasks`), inspections received + avg overall/cleanliness score, guest
  reviews on stays they prepared + avg cleanliness (normalized to 5), low-review count
  (cleanliness ≤ 3), issues (existing logic), plus a "Tendwell crew (unassigned)" row.
  Offboarded cleaners included with a badge (toggle). Drill-down sheet per cleaner: clean
  history list (date, property, task title, inspection score, review cleanliness + snippet).
  Existing coaching flags keep working.

### WS4 — Reviews page on Trellis + Inspections ↔ Trellis (phase 2)

- `/reviews` reads `trellis_review_snapshot` + `review_clean_attribution` directly via
  Supabase (no Haven-OS proxy). Keep the page's UX (KPIs, filters, drawer) but add Ops
  property (opens universal property modal), "Prepared by" cleaner + clean date. Stop using
  `api/reviews/*`; leave env vars untouched.
- Inspections: new "From Trellis" panel listing `trellis_inspection_tasks` not yet rated in
  Ops → "Rate previous clean" opens `InspectionFormSheet` prefilled (property, date,
  inspector via assignee → cleaner, previous clean date + cleaner, `trellis_task_id`).
  InspectionFormSheet shows a "Rating the clean on <date> by <cleaner> (from Trellis)" hint
  whenever property+date are set, and prefills cleaner/last_cleaned_on when empty.

### WS5 — Financials Trellis-first (phase 2)

- `app_settings.clean_source_cutover` (YYYY-MM-01). Redefine `property_monthly_cleans`,
  `financial_monthly_cleans`, `property_clean_stats`, `financial_task_load` (and anything
  depending on them, e.g. `property_month_financials`) so months ≥ cutover count
  `trellis_clean_tasks` (distinct clean days per property) and months < cutover keep the
  Breezeway logic. Validate on overlapping months (Sep/Oct 2026) per property before
  choosing the default cutover; report diffs.
- Forecaster: stop reading `breezeway_tasks`/`breezeway_import_log` directly — use the views
  + `trellis_sync_log`. `proforma_months.tasks` manual upload replaced by view counts (keep
  manual box only as override for pre-history months).
- Master List: show auto cleans/month + first clean from `property_clean_stats` (same as
  Pricing), so the two pages agree; hide the `breezeway_id` field.
- North Star `inspections` auto metric = completed Ops inspections ÷ Trellis completed cleans
  in the month (was verifications ÷ `cleaning_history`).
- Data freshness alert: Trellis sync staleness (`trellis_sync_log`) becomes primary;
  Breezeway alert downgraded to info.
- Pro Forma CSV import (`CsvImportModal`, `cleaning_history`): hide behind "Legacy import"
  menu, history slide-over reads Trellis cleans.

### WS6 — In-app documentation + repo docs (phase 3)

- Settings → new "Integrations" tab (admin): one section per source (Trellis A/B, Hostaway,
  QuickBooks, Ramp, Breezeway legacy, Haven-OS lost items): what is pulled, schedule (cron
  table), tables written, which pages consume them, matching/attribution rules (property
  map, aliases, cleaner linking, review/inspection attribution), known limits (checklist
  answers, vendor-assigned cleans, 12 KB cap), troubleshooting (sync log, Refresh). Content
  in a typed TS module so it's reviewable; link to it from API Sync.
- Update CLAUDE.md (pages table, migrations list, cron table) and memory.

## Verification (every workstream)

`npm run check`, `npx vitest run`, `npm run build`; for UI, run dev server and click through
with Playwright/screenshots; for SQL, query the live views and sanity-check counts; for
sync, invoke the core against live Trellis locally (keys from ~/.claude.json fallback)
against the real tables once migrations are applied.

## Review amendments (2026-10-14, supersede conflicting text above)

Plan review found (live): nightly sync averages 231 s of a 300 s budget; hourly tasks-only
sync failed 104/210 runs in 14 days (91 timeouts, 13 Trellis 429s).

**Migration letters:** WS1 `20261014a`, `c`, `d` (+ more letters `i`..`k` if needed);
WS2 `b`; WS3 `e`; WS4 `f`; WS5 `g`, `h`. `shared/database.types.ts` is owned by WS1; later
workstreams rebase and regenerate.

**WS1 changes**
- Sync reliability first: a run-wide deadline (stop cleanly with partial-success status
  before the platform kills it), per-member B loop only over ACTIVE roster members,
  429 backoff with jitter + inter-call pacing, no new Trellis calls added to the nightly or
  hourly paths (reviews/backfill/assignee enrichment get their own cron + budget).
- Classify in TypeScript at upsert time (reuse `classifyAuxTask` / `isTendwellTask` from
  `shared/aux-tasks.ts`; vacancy/touch-up are NOT cleans, matching invoicing) and store
  `clean_kind text`, `is_tendwell boolean` on `trellis_task_snapshot` (backfill existing rows
  with a one-off script using the same TS). Views filter indexed columns only. Add indexes
  `(status, scheduled_date)`, `(assigned_to_id)`, `(trellis_property_id, scheduled_date)`.
- Views are SECURITY DEFINER-style (`security_invoker = off`) gated with
  `where public.is_staff_or_server()` (or `current_user_can_view('reviews')` for review
  data), `revoke select ... from anon`; never expose pay or `properties` financial columns.
- Attribution: the rated clean is the last completed clean **by anyone** at the property
  (all workspace-B completed tasks are kept) within 14 days before
  `coalesce(inspected_at, scheduled_for)` / before the review's `checkin_date`; credited to
  Tendwell/cleaner only if that clean is Tendwell's (`is_tendwell`).
- Inspection trigger: SECURITY DEFINER, `set search_path`, named `inspections_attribute_clean`
  (sorts before `inspections_snapshot_cleaner_name`), fires on INSERT or when
  property_id / inspected_at / scheduled_for change, only while `rated_clean_task_id` is
  null. Columns: `rated_clean_task_id`, `cleaner_auto_filled boolean` (true only when the
  trigger filled cleaner_id). Backfill only inspections dated ≥ 2026-04-11, in batches.
- Cleaner sync: exclude the vendor user "Tendwell Cleaning Co.", rows with no name, role
  ADMIN, the "AI Agent" user and known test/duplicate accounts (inspect roster); handle one
  person with two user_ids (link the one whose email matches; never violate the unique
  index). Gate auto-create behind `app_settings.trellis_cleaner_sync_enabled` (default
  'false'; WS3 flips it after its UI lands). Linking existing cleaners and offboarding may
  run regardless.
- Roster deactivation only when the workforce pull completed (pagination exhausted),
  after a member is missed on 2 consecutive full pulls (`missed_runs int`), and never more
  than ~10% of active members in one run.
- Reviews: separate state (own table `trellis_aux_sync_log(kind, ...)`, NOT
  `trellis_sync_log`, whose CHECK + skip logic would break hourly runs). Use
  `read_reviews` filters `review_after` (= max(review_date) − 14 d; first run 365 d),
  cursor pagination, small pages. Store no amounts. Restrict to reviews whose property maps
  to an Ops property (keep all rows, filter in views).
- Assignee enrichment: throttled pass in the aux cron fetching only `id, assignees` for
  recent completed clean tasks lacking `assignees`, so individual cleaners are known.
- `link_trellis_property` RPC is owned by WS2 (already in flight); WS1 adds the review
  snapshot re-point if WS2 didn't.
- vercel.json: explicit function entries (`maxDuration: 300`, `includeFiles` incl.
  `api/tasks/_auto-stage.ts`, `api/notify/_lib.ts`) for `api/trellis/backfill.ts` and the
  aux cron; schedule the aux cron off-hour (e.g. `20 4 * * *` + `40 */6 * * *` style),
  skipping while another sync runs.
- Record the Porchlight alias fix in a migration file (data-only, idempotent).

**WS2:** tighten `property_aliases` writes to admin; all alias writes via definer RPCs;
unlink dialog states that re-pointed tasks are not moved back. Re-link of a wrong
`properties.trellis_id` already exists via MatchPicker "Change".

**WS3:** also show upcoming/scheduled cleans per cleaner; gate pay columns on
`can_view_financials()`; roster-dependent panels admin-only (roster is admin-read);
offboarding dialog offers removing the app login (default on for manual offboard; sync
offboarding only flags "still has app login"); flip `trellis_cleaner_sync_enabled` on
after verifying. Coaching-flag thresholds now divide by Trellis clean counts: note it in UI.

**WS4:** reviews gated by `current_user_can_view('reviews')`; InspectionFormSheet must not
re-fill a cleaner the user deliberately cleared (only prefill on new rows / property-date
change).

**WS5:** apply view rewrites with `clean_source_cutover` defaulting to `'9999-12-01'`
(no production change on apply), `CREATE OR REPLACE` with identical columns/types; cover
`property_month_financials`, `property_breezeway_stats`, `compute_monthly_estimate()`.
Validate overlap months, then set the cutover (not before 2026-10 unless the backfill
proves earlier coverage). Freshness for non-admins via a definer function.
