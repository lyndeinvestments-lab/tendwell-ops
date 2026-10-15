// In-app documentation for Settings → Integrations (WS6 of the Trellis API
// expansion, 2026-10-14): how each external system feeds Tendwell Ops, where
// the data lands, which pages read it, how fresh it is and what an admin can
// do about it.
//
// Content is a typed module so it is reviewable in PRs and unit-tested
// (integrations-docs.test.ts: every section well-formed, no em dashes).
// It is English only on purpose: it names tables, functions and endpoints that
// stay English everywhere. The surrounding chrome (headings, labels) is
// translated in settingsPage.{en,es}.ts.
//
// Every statement here was checked against the merged code and the live DB on
// 2026-10-14. When the behaviour changes, change this file in the same PR.
//
// Formatting: text wrapped in `backticks` renders as code. Keep sentences
// short; never use em dashes (house style), use commas, colons or periods.

export interface IntegrationDocBlock {
  /** Short label for the block, e.g. "Where the data comes from". */
  heading: string
  /** One paragraph or bullet per entry. */
  items: string[]
}

export interface IntegrationDocLink {
  label: string
  /** In-app route (starts with '/'). */
  href: string
}

export interface IntegrationDocSection {
  /** Stable id: used as the accordion value and the `?doc=` deep link. */
  id: string
  title: string
  /** One or two sentences: what this is and why it matters. */
  summary: string
  blocks: IntegrationDocBlock[]
  links?: IntegrationDocLink[]
}

/** Date the content was last checked against code + live DB. */
export const INTEGRATIONS_DOCS_REVIEWED = '2026-10-14'

export const INTEGRATIONS_DOCS: IntegrationDocSection[] = [
  {
    id: 'overview',
    title: 'How data comes in (overview)',
    summary:
      'Ops never asks Trellis, Hostaway or QuickBooks for data while you browse. Scheduled server jobs copy what Ops needs into Supabase tables ("snapshots"), and every page reads those tables and the views built on them. That keeps pages fast and keeps API keys on the server.',
    blocks: [
      {
        heading: 'Scheduled jobs (Vercel cron, times in UTC)',
        items: [
          'Trellis full sync: every night at 03:00 (`/api/cron/trellis-sync`). Roster, cleaner linking, properties, tasks and Haven reservations.',
          'Trellis task refresh: every hour on the hour from 12:00 to 02:00, roughly 8 AM to 10 PM Eastern (`/api/cron/trellis-tasks-refresh`). Tasks only.',
          'Trellis auxiliary jobs: at :40 past 01, 05, 09, 13, 17 and 21 (`/api/cron/trellis-aux-sync`). Guest reviews, assignee details, history backfill, inspection attribution.',
          'Hostaway listings: nightly at 03:30 (`/api/cron/hostaway-sync`).',
          'QuickBooks classes at 04:15 and QuickBooks P&L at 04:45 (`/api/cron/qbo-classes-sync`, `/api/cron/qbo-pl-sync`).',
          'Breezeway (legacy): a GitHub Actions workflow posts the daily CSV export at 13:00 (`.github/workflows/breezeway-import.yml`).',
        ],
      },
      {
        heading: 'Keys and security',
        items: [
          'All API keys live in Vercel environment variables (for example `TRELLIS_WORKSPACE_A_KEY`, `TRELLIS_WORKSPACE_B_KEY`, `HOSTAWAY_API_KEY`) and are only read by server functions. They are never sent to the browser and never shown in the app.',
          'Cron endpoints only run with the `CRON_SECRET` bearer that Vercel sends. On-demand endpoints (Refresh from Trellis, backfill) require a signed-in admin.',
          'Snapshot tables are protected by row level security. Most Trellis views are staff only; review data needs the Reviews view permission; sync logs are admin only.',
        ],
      },
      {
        heading: 'Where to check health',
        items: [
          'API Sync (`/api-sync`) shows the latest Trellis runs, their status and progress, and has the Refresh button.',
          'Alerts (`/alerts`) raises a data freshness alert when the Trellis sync has not succeeded for 26 hours (warning) or 72 hours (critical).',
        ],
      },
    ],
    links: [
      { label: 'API Sync', href: '/api-sync' },
      { label: 'Alerts', href: '/alerts' },
    ],
  },
  {
    id: 'trellis-overview',
    title: 'Trellis: workspaces and API',
    summary:
      'Trellis is the operations platform where cleaning work is scheduled and completed. Ops reads two Trellis workspaces and uses them as the single automated source for tasks, roster, guest reviews and clean history.',
    blocks: [
      {
        heading: 'The two workspaces',
        items: [
          'Workspace A is Tendwell\'s own Trellis: direct clients and the Tendwell roster (the people who work for Tendwell). Every task in workspace A is Tendwell work.',
          'Workspace B is Haven\'s Trellis: Haven properties, where most Tendwell cleaning happens. A workspace B task is Tendwell\'s only when it is assigned to the vendor account "Tendwell Cleaning Co." or to someone on the Tendwell roster. Haven\'s own people do the rest.',
          'Guest reviews come from workspace B only.',
        ],
      },
      {
        heading: 'How Ops talks to Trellis',
        items: [
          'Server functions call the Trellis MCP endpoint (JSON-RPC, `https://api.trellistech.com/v1/mcp-server`) with the workspace key. Code: `api/trellis/_sync-core.ts` (`callTool`).',
          'Tools used: `trellisql_query` (the `properties`, `tasks` and `reservations` views), `read_workforce` (the roster) and `read_reviews` (guest reviews with their reservation).',
          'Read only. Ops never creates, edits or completes anything in Trellis.',
          'Trellis caps each response at about 12 KB, so pages are small (25 roster members, 50 to 100 tasks, 8 reviews per call). Burst limits answer HTTP 429: the sync waits 2 s, 4 s, 8 s and so on (plus jitter) and retries, but never past its deadline.',
        ],
      },
      {
        heading: 'Known limits',
        items: [
          'Trellis does not expose inspection checklist answers through any API (only the count of checklist items done), so inspection scores are entered in Ops. See Inspections below.',
          'Many Haven cleans are assigned to the vendor account, not a person. The individual cleaner is only known when the task\'s assignee list names a roster member (fetched by the auxiliary job). Otherwise the clean is credited to "Tendwell crew (unassigned)".',
          'Workspace A history starts on 2026-04-11 (nothing earlier exists in that workspace).',
        ],
      },
    ],
  },
  {
    id: 'trellis-sync',
    title: 'Task, property and roster sync',
    summary:
      'The main sync copies Trellis properties, tasks and the Tendwell roster into Ops. It runs nightly in full, hourly for tasks, and on demand from API Sync.',
    blocks: [
      {
        heading: 'What each run pulls',
        items: [
          'Nightly full sync (03:00 UTC) and the API Sync "Refresh from Trellis" button: workspace A roster, cleaner linking, workspace A and B properties, workspace A tasks, workspace B tasks, then Haven reservations if at least a minute of budget is left.',
          'Task window: scheduled from 30 days ago to 90 days ahead. Workspace B tasks are pulled for the vendor account "Tendwell Cleaning Co." plus every ACTIVE roster member, 15 members per query. The full sync also pulls every COMPLETED workspace B task from the last 30 days, whoever did it (reviews and inspections need "the last clean by anyone").',
          'Hourly refresh (12:00 to 02:00 UTC): tasks only. The roster is read from the database instead of Trellis.',
          'Haven reservations (full sync): checkouts from 45 days ago to 14 days ahead, into `trellis_reservation_snapshot`. Invoicing uses them to tell an owner stay from a guest stay.',
          'After tasks are saved, properties still in Lead, Quote or Onboarding that now have a turn or departure clean are moved to Active automatically.',
        ],
      },
      {
        heading: 'Where it is stored',
        items: [
          '`trellis_property_snapshot`: Trellis properties of both workspaces.',
          '`trellis_task_snapshot`: one row per Trellis task, with the classification columns below. Readable by staff.',
          '`trellis_roster`: workspace A members (admin read). Members are never deleted: someone who leaves Trellis gets `is_active = false` and `removed_at`.',
          '`trellis_sync_log`: one row per run (admin read) with status, counts and progress.',
        ],
      },
      {
        heading: 'Task classification (computed at sync time)',
        items: [
          '`clean_kind`: the kind of clean (`turn`, `departure`, `deep`, `onboarding`, `last`, `arrival`, `double`, `owner_stay`, `clean`), or empty when the task is not a clean. Vacancy cleans and touch-ups are not cleans (same as invoicing). A title with "inspection" or "walkthrough" is never a clean.',
          '`task_category`: hot tub, trash, filter, linen, inspection and so on, from the same rules invoicing uses (`shared/aux-tasks.ts`), with rating inspections always classed as `inspection` (cleaner self-inspections and walkthroughs are not).',
          '`is_tendwell`: true for every workspace A task, and for a workspace B task assigned to "Tendwell Cleaning Co." or to a roster member, either as the main assignee or anywhere in its assignee list.',
          'The rules live in `shared/trellis-sync-rules.ts` and are unit tested. Views filter these stored columns instead of re-reading titles.',
        ],
      },
      {
        heading: 'Reliability rules',
        items: [
          'Every run has a 250 second deadline (the function limit is 300 s). When the deadline arrives the run stops cleanly: what was fetched is saved, the prune is skipped and the run is marked `partial`. A partial run counts as a successful sync for freshness.',
          'Calls are paced (about 200 ms apart plus jitter). HTTP 429 retries up to 5 times with backoff; HTTP 502, 503 and 504 up to 3 times.',
          'Prune: after a complete workspace B pull, B tasks the run did not see are deleted, except COMPLETED tasks, which are kept as the record that a clean happened. A partial run never prunes.',
          'Roster removal: only after a complete roster pull, only for members missed on 2 complete pulls in a row, and never more than 10% of active members in one run (at least 1). The rest wait for the next night.',
          'Only one run at a time. The hourly job skips if another run started in the last 30 minutes and marks older runs that never finished as `error`.',
        ],
      },
      {
        heading: 'Admin actions',
        items: [
          'API Sync → Trellis → "Refresh from Trellis" runs a full sync now, with a progress bar and a Stop button (Stop keeps what was already saved and marks the run `canceled`).',
        ],
      },
    ],
    links: [{ label: 'API Sync', href: '/api-sync' }],
  },
  {
    id: 'trellis-history',
    title: 'Clean history backfill',
    summary:
      'The main sync only looks 30 days back, so a separate resumable job loads older completed Trellis tasks. That history lets reviews and inspections find the clean they rate, and feeds Trellis-era financial counts and Cleaner Metrics.',
    blocks: [
      {
        heading: 'How deep it goes',
        items: [
          'Workspace A: every completed task from 2026-04-11, when that workspace starts.',
          'Workspace B: every completed Cleaning-department task by anyone, plus Tendwell vendor or roster tasks in other departments. Loaded back to 2025-05-28 (the job walks back in 7-day windows to a floor of 2025-06-01).',
          'Guest reviews: the first run loaded about one year (365 days).',
        ],
      },
      {
        heading: 'How it runs',
        items: [
          'Step `task_backfill` of the auxiliary job (`api/trellis/_aux-core.ts`). It walks back one 7-day window at a time and saves its position in `trellis_aux_sync_log.state`, so a run that hits its deadline continues where it stopped next time. Once it reaches the floor it is done and later runs skip it.',
          'Rows are upserted, so re-reading a window is harmless.',
          'The owner portal shows only Trellis tasks from the last 90 days onward (`get_owner_property_tasks`, migration 20261014j), so owners do not see the backfilled history.',
        ],
      },
      {
        heading: 'Admin action: POST /api/trellis/backfill',
        items: [
          'Admin session only (same auth as Refresh from Trellis). Runs one slice of the auxiliary steps on demand and returns what it did.',
          'Body, all optional: `steps` (any of `reviews`, `assignees`, `review_backfill`, `task_backfill`, `inspections`), `budget_s` (10 to 250 seconds), `task_floor` (for example `{ "B": "2025-06-01" }`; a lower floor reopens a finished walk), `review_days` (up to 3650), `assignee_days` (`null` = all history).',
          'Call it again to continue: each call resumes from the saved state.',
        ],
      },
    ],
  },
  {
    id: 'trellis-aux',
    title: 'Auxiliary sync: reviews, assignees, inspections',
    summary:
      'Jobs that would slow the main sync run on their own schedule and budget: guest reviews, assignee details for vendor-assigned cleans, history backfill and inspection attribution.',
    blocks: [
      {
        heading: 'Schedule and order',
        items: [
          'Every 4 hours at :40 past 01, 05, 09, 13, 17 and 21 UTC (`api/cron/trellis-aux-sync.ts`), off the hour so it never collides with the hourly refresh or the 03:00 full sync.',
          'Steps in order: `reviews` (new reviews since the newest stored review minus 14 days), `assignees`, `review_backfill`, `task_backfill`, `inspections`.',
          '`assignees`: for completed Tendwell cleans in workspace B with no assignee list (last 60 days on the cron), fetches only the task id and assignees, so the individual cleaner on a vendor-assigned clean becomes known.',
          '`inspections`: attributes inspections from the last 45 days that had no clean when they were logged (database only, no Trellis calls).',
        ],
      },
      {
        heading: 'Safety rules',
        items: [
          'Skips the whole run while a main sync (`trellis_sync_log`) started in the last 30 minutes is still running, or while another auxiliary run is active.',
          'Same 250 second deadline, pacing and 429 backoff as the main sync. Review backfill and assignee enrichment may use at most half of the remaining budget, so one long job never starves the next.',
        ],
      },
      {
        heading: 'Where it is logged',
        items: [
          '`trellis_aux_sync_log` (admin read): one row per run (`kind = run`) plus one row per step, with status `running`, `done`, `partial`, `error` or `skipped`, counts, and the resume state.',
          'This is a separate table from `trellis_sync_log` on purpose: the hourly sync\'s skip logic reads that one.',
        ],
      },
    ],
  },
  {
    id: 'property-linking',
    title: 'Property linking and aliases',
    summary:
      'Every Trellis property has to map to one Ops property before its tasks, reviews and cleans count anywhere. API Sync is where you fix a property that does not match.',
    blocks: [
      {
        heading: 'How mapping works',
        items: [
          '`properties.trellis_id` is a property\'s primary Trellis record.',
          '`property_aliases` holds extra names and extra Trellis records for the same Ops property (Trellis duplicates, renames, listing names).',
          'The view `trellis_ops_property_map` combines both: Trellis property id → Ops property id. Every Trellis view (cleans, reviews, inspections, financial counts) maps through it.',
          'Triggers on `trellis_task_snapshot` and `trellis_review_snapshot` rewrite an aliased Trellis id to the property\'s primary id as rows are saved. Reservations keep their original id; invoicing maps them through `property_aliases`.',
        ],
      },
      {
        heading: 'Admin actions on API Sync → Trellis',
        items: [
          'KPI tiles: Matched, Unmatched in Ops, In Trellis not in Ops, Suggested, Stale links.',
          '"Link to Ops property" (on rows in "In Trellis, not in Ops"): pick the Ops property. If it has no Trellis link yet, this becomes its primary link. If it already has one, the Trellis record is saved as an alias and the tasks, reservations and reviews already stored under it are re-pointed to the property (RPC `link_trellis_property`).',
          '"Use Trellis name" (on mapped rows): renames the Ops property to the Trellis name after a confirm. The change is logged in the property edit history.',
          'Aliases card: lists every alias and removes one after a confirm (RPC `unlink_trellis_alias`). Rows that were re-pointed are not moved back; the next sync rewrites tasks Trellis still returns with their real id.',
          'Alias and link changes are admin only and recorded in `activity_log` and `property_edit_log`.',
        ],
      },
      {
        heading: 'Example: Porchlight Retreat',
        items: [
          '"Porchlight Retreat" is a second Haven Trellis record for Ops property #577 "Craig Sheflin 2746". It showed under "In Trellis, not in Ops". Saving it as an alias of #577 re-pointed its 6 tasks, and every future task and review for that record now lands on #577 (recorded in migration 20261014i).',
        ],
      },
    ],
    links: [{ label: 'API Sync', href: '/api-sync' }],
  },
  {
    id: 'reviews',
    title: 'Guest reviews',
    summary:
      'Guest reviews of Haven stays come from Haven\'s Trellis (workspace B) and are tied to the clean that prepared the stay, so cleanliness feedback reaches the right cleaner.',
    blocks: [
      {
        heading: 'Where the data comes from',
        items: [
          'Trellis `read_reviews` (workspace B) with the reservation included, pulled by the auxiliary job every 4 hours. About one year of history was loaded first.',
          'Stored in `trellis_review_snapshot`: rating, category ratings, text, channel, reviewer, reservation and check-in/check-out dates. No money is stored.',
        ],
      },
      {
        heading: 'Rating scales',
        items: [
          'Each review keeps its own scale: `overall_rating` out of `max_rating`. Today every channel Trellis returns (Airbnb, Booking.com, VRBO, Direct) uses a 5 point scale.',
          '`normalized_rating` is Trellis\'s 0 to 1 value (overall divided by max). `cleanliness_5` is the cleanliness rating converted to a 0 to 5 scale, which is what the pages and Cleaner Metrics use.',
        ],
      },
      {
        heading: 'Which clean a review rates',
        items: [
          'View `review_clean_attribution`: the review\'s Trellis property → Ops property → the last COMPLETED clean by anyone at that property on or before the check-in date, at most 14 days before it.',
          'The clean is credited to Tendwell only if it was Tendwell\'s (`is_tendwell`), and to a named cleaner only if that cleaner is linked to the Trellis user on the task.',
          'Outcomes: `cleaner` (a linked cleaner did the clean), `tendwell_crew` (Tendwell clean with no linked person, for example vendor-assigned), `not_tendwell` (Haven\'s own team cleaned), `no_clean_found` (no completed clean in the 14 days), `no_checkin` (the review has no reservation dates), `no_ops_property` (the Trellis property is not mapped to Ops).',
        ],
      },
      {
        heading: 'Who sees it and where',
        items: [
          'Gated in the database by the Reviews view permission (both the table and the view check it), not just by the page.',
          'Used by Reviews (`/reviews`; the default filter hides reviews of properties not in Ops) and Cleaner Metrics (average cleanliness, and low reviews at cleanliness 3 or less, per cleaner).',
          'The old Haven-OS reviews proxy (`api/reviews/*`, Hostaway reviews) is no longer used by any page. The files are kept until Jordan decides whether to delete them.',
        ],
      },
    ],
    links: [
      { label: 'Reviews', href: '/reviews' },
      { label: 'Cleaner Metrics', href: '/cleaner-metrics' },
    ],
  },
  {
    id: 'cleaners',
    title: 'Cleaners and the Trellis roster',
    summary:
      'Each Ops cleaner can be linked to a person on the Tendwell Trellis roster. The link is what lets cleans, reviews and inspections be credited to that cleaner.',
    blocks: [
      {
        heading: 'Linking',
        items: [
          '`cleaners.trellis_user_id` holds the link (unique: one roster member per cleaner).',
          'The nightly sync links an unlinked cleaner when `email` or `alt_email` matches exactly one roster member\'s email, or else when the full name matches exactly one eligible member and one cleaner. It never renames a cleaner.',
          'Admins can link, change or remove the link by hand on the Cleaners page (RPC `cleaner_link_trellis`).',
        ],
      },
      {
        heading: 'Automatic cleaner creation',
        items: [
          'When `app_settings.trellis_cleaner_sync_enabled` is `true` (switched on 2026-10-14), the nightly sync creates a cleaner for each active, unlinked roster member in a Cleaning, Quality Control or Inspection department.',
          'Never created: the AI agent, the vendor account "Tendwell Cleaning Co.", nameless or test accounts, Trellis staff, ADMIN-role members, members not seen by a roster pull in the last 3 days, members marked Ignore on the Cleaners page, and likely duplicates of an existing member or cleaner (same name or within 2 letters).',
          'Created cleaners have `source = trellis` and NO app login. Staff give a login deliberately with the Invite button.',
          'Admins can also create one by hand from the "Unlinked Trellis roster members" panel (RPC `cleaner_create_from_roster`), or Ignore a member so the sync never creates a cleaner for them.',
        ],
      },
      {
        heading: 'Offboarding',
        items: [
          '`cleaners.status` is `active` or `offboarded` (`is_active` follows it). Offboarding replaces delete as the normal exit; delete stays admin only behind a confirm.',
          'By sync: when a linked cleaner\'s roster member is removed from Trellis, the sync offboards them with `offboarded_by = trellis-sync`. If they come back on the roster, the sync reactivates them. It only reverses offboardings it did itself.',
          'By hand: Offboard on the Cleaners page (RPC `cleaner_set_status`) records the staff member\'s name in `offboarded_by`; the sync never undoes it. The dialog offers to remove the app login as well (admins only). A sync offboarding leaves the login and shows a "Still has app login" badge.',
        ],
      },
      {
        heading: 'Pay rate privacy',
        items: [
          'Since migration 20261014e2 the browser role can read every `cleaners` column EXCEPT `pay_rate` (column privileges). Finance staff read pay through `cleaner_pay_rates()` and change it through `cleaner_set_pay_rate()`.',
          'Status, Trellis link and source change only through the RPCs above, never by a direct update.',
        ],
      },
      {
        heading: 'Cleaner Metrics',
        items: [
          'Reads `trellis_cleaner_tasks` (Tendwell cleans of any status, so upcoming work shows too), `review_clean_attribution` and Ops inspections. Cleans not tied to a person roll up as "Tendwell crew (unassigned)".',
          'Coaching-flag thresholds now divide by Trellis clean counts.',
        ],
      },
    ],
    links: [
      { label: 'Cleaners', href: '/cleaners' },
      { label: 'Cleaner Metrics', href: '/cleaner-metrics' },
    ],
  },
  {
    id: 'inspections',
    title: 'Inspections and Trellis',
    summary:
      'Inspection scores are entered in Ops, and each inspection is tied to the Trellis clean it rates so the score reaches the cleaner who did that clean.',
    blocks: [
      {
        heading: 'Why scores live in Ops',
        items: [
          'Trellis does not expose inspection checklist answers through any API, so the rating of the previous clean has to be captured in Ops.',
        ],
      },
      {
        heading: 'The "From Trellis" tab',
        items: [
          'Inspections → From Trellis lists Trellis inspection tasks from the last 30 days (view `trellis_inspection_tasks`; cleaner self-inspections and walkthroughs are excluded) with the Ops property, the inspector, and the previous clean.',
          '"Rate previous clean" opens the inspection form prefilled with the property, date, inspector, previous clean date and cleaner, and the Trellis task id (`inspections.trellis_task_id`, so a Trellis inspection is rated once).',
        ],
      },
      {
        heading: 'Automatic attribution',
        items: [
          'Trigger `inspections_attribute_clean` (before insert or update): while `rated_clean_task_id` is empty, it finds the last COMPLETED clean by anyone at the property within 14 days on or before the inspection date and fills `rated_clean_task_id`, `last_cleaned_on` (if empty) and `cleaner_id` (only if empty, the clean is Tendwell\'s and its assignee is a linked cleaner; then `cleaner_auto_filled = true`).',
          'It never overwrites a cleaner someone chose, and once `rated_clean_task_id` is set it never runs again.',
          'The form shows "Rating the clean on <date> by <cleaner> (from Trellis)" as soon as the property and date are set, using `inspection_rated_clean_hint` (same rule). It prefills only new rows or a property/date change, and saves the rated clean itself, so a cleaner you deliberately cleared stays cleared.',
          'Inspections logged before their clean was synced are attributed later by the auxiliary job (last 45 days, `backfill_inspection_attribution`).',
        ],
      },
    ],
    links: [{ label: 'Inspections', href: '/inspections' }],
  },
  {
    id: 'financials',
    title: 'Financial clean counts',
    summary:
      'Every financial clean count comes from Trellis from the cutover month on, and from the Breezeway archive before it.',
    blocks: [
      {
        heading: 'The cutover',
        items: [
          '`app_settings.clean_source_cutover` = 2026-10-01 (read through the `clean_source_cutover()` function). Days before it count Breezeway cleans; days from it on count Trellis.',
          'A Trellis clean counts when it is COMPLETED, is a clean (`clean_kind` set) and is Tendwell\'s (`is_tendwell`). One clean per property per day, mapped through `trellis_ops_property_map` (so aliases count). View `trellis_era_clean_days`.',
          'Per-property Breezeway fallback: in a month where a property had no Trellis history at the start of the month (not linked yet, or added to Trellis mid-month), its Breezeway cleans are used instead. It retires itself as properties get linked.',
          'The cutover was validated on Aug to Oct 2026: every Breezeway clean at a Trellis-linked property had a matching Tendwell Trellis clean within 3 days.',
        ],
      },
      {
        heading: 'Which page reads which view',
        items: [
          'Financial Overview (`/financial-dashboard`): `financial_monthly_cleans`, `financial_task_load`, plus QuickBooks P&L.',
          'Pro Forma: the Live (Forecaster) tab reads `financial_monthly_cleans`, `property_monthly_cleans` and `compute_monthly_estimate()`; the P&L and Per-Property tabs read `property_month_financials` (built on `property_monthly_cleans`); Pricing reads `property_clean_stats`, with clean history from `trellis_clean_tasks`.',
          'Master List (`/master-list`): auto cleans per month and first clean from `property_clean_stats`, the same numbers as Pricing.',
          'North Star: "% Cleans Inspected" = completed Ops inspections ÷ Tendwell\'s completed Trellis cleans in the month (`trellis_clean_tasks`).',
        ],
      },
      {
        heading: 'Freshness alert',
        items: [
          '`trellis_sync_freshness()` returns the last successful (`done` or `partial`) sync to any staff login, without counts or errors.',
          'Alerts (`/alerts`) raises a warning after 26 hours without a successful Trellis sync and a critical alert after 72 hours. The Forecaster shows the last sync time and the cutover month. The Breezeway import alert drops to info while Trellis is the primary source.',
        ],
      },
    ],
    links: [
      { label: 'Financial Overview', href: '/financial-dashboard' },
      { label: 'Pro Forma', href: '/pro-forma' },
      { label: 'Master List', href: '/master-list' },
      { label: 'North Star', href: '/north-star' },
    ],
  },
  {
    id: 'breezeway',
    title: 'Breezeway (legacy)',
    summary:
      'Breezeway is the old task system. It is still imported every day, but only invoicing and the pre-cutover clean archive depend on it.',
    blocks: [
      {
        heading: 'How it comes in',
        items: [
          'There is no Breezeway API client. A GitHub Actions workflow (`.github/workflows/breezeway-import.yml`, daily 13:00 UTC) posts the Breezeway CSV export to `POST /api/tasks/breezeway-import`, which writes `breezeway_tasks` and `breezeway_import_log`.',
          'Invoicing (`api/invoices/*`) still reconciles vendor invoices against `breezeway_tasks`.',
          'API Sync → Breezeway (legacy) shows coverage and orphans.',
          'If the import stops, Alerts shows a Breezeway freshness alert (2 days warning, 5 days critical), shown as info only while Trellis is the primary source.',
        ],
      },
    ],
  },
  {
    id: 'hostaway-qbo',
    title: 'Hostaway and QuickBooks',
    summary: 'Two other nightly feeds: Haven\'s Hostaway listings and Tendwell\'s QuickBooks books.',
    blocks: [
      {
        heading: 'Hostaway',
        items: [
          'Nightly at 03:30 UTC (`api/cron/hostaway-sync.ts`) listings are copied into `hostaway_listing_snapshot`. The `hostaway_reconciliation` view compares them with Ops properties. Shown on API Sync → Hostaway.',
        ],
      },
      {
        heading: 'QuickBooks',
        items: [
          '04:15 UTC: the QuickBooks class list into `qbo_classes` (used by the invoicing exports; manual class links are set on API Sync → QuickBooks).',
          '04:45 UTC: Profit and Loss by month into `qbo_pl_months` (Financial Overview, Pro Forma, Forecaster) and by class into `qbo_class_pl_months`.',
          'The QuickBooks connection is managed server side; Reconnect is in the status list above.',
        ],
      },
    ],
  },
  {
    id: 'haven-os',
    title: 'Haven-OS',
    summary: 'Haven\'s own system. Ops talks to it through server-side proxies so the key never reaches the browser.',
    blocks: [
      {
        heading: 'What uses it',
        items: [
          'Lost Items (`/lost-items`) reads and updates Haven-OS lost items through `api/lost-items/*`.',
          'The reviews proxy (`api/reviews/*`) is unused since Reviews moved to Trellis. The files are kept pending a decision.',
        ],
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    summary: 'What to check when something looks wrong.',
    blocks: [
      {
        heading: 'A sync shows "partial"',
        items: [
          'The run reached its 250 second deadline and stopped cleanly. Everything it fetched is saved; only the prune was skipped. One partial run is normal on a busy night; the next hourly run continues.',
          'Many partial runs in a row: open the run on API Sync and look at the stopped phase and the 429 retry count. Trellis rate limiting is the usual cause.',
        ],
      },
      {
        heading: 'A sync shows "error"',
        items: [
          'Read the error on API Sync. "Marked stale by hourly refresh" means a run was killed before it could finish; the next run starts normally.',
          '"Trellis API keys not configured": the workspace key env vars are missing in Vercel.',
          'Run "Refresh from Trellis" to try again now. The freshness alert clears after the next successful run.',
        ],
      },
      {
        heading: 'A property is not matching',
        items: [
          'API Sync → Trellis: look for it under "In Trellis, not in Ops" and use "Link to Ops property". If the Ops property already has a link, this saves an alias and moves the stored tasks over.',
          'If the property is linked to the wrong Trellis record, use "Change" on its mapping row.',
          'Until a property is mapped, its cleans do not count in financials (apart from the Breezeway fallback), and its reviews show as `no_ops_property`.',
        ],
      },
      {
        heading: 'A cleaner is not linked',
        items: [
          'Cleaners page: check the cleaner\'s email and alt email against their Trellis email, then link by hand from the cleaner row or the "Unlinked Trellis roster members" panel.',
          'Two cleaners sharing one Trellis email cannot both link (one roster member per cleaner); confirm who is who first.',
          'A new hire shows up after the next nightly sync (03:00 UTC), or after "Refresh from Trellis".',
        ],
      },
      {
        heading: 'A review is not attributed',
        items: [
          '`no_ops_property`: map the Trellis property (see above).',
          '`no_checkin`: the review has no reservation dates in Trellis; nothing to match.',
          '`no_clean_found`: no completed clean in the 14 days before check-in. Check that the clean was completed in Trellis; older history comes from the backfill.',
          '`tendwell_crew`: the clean was Tendwell\'s but no linked person was on it. Link the cleaner, or wait for the assignee step of the auxiliary job (every 4 hours) to fetch the assignee list.',
          '`not_tendwell`: Haven\'s own team did the last clean, so no Tendwell credit is given.',
        ],
      },
    ],
    links: [
      { label: 'API Sync', href: '/api-sync' },
      { label: 'Cleaners', href: '/cleaners' },
    ],
  },
]

/** Every string in a section (title, summary, block headings/items, links). */
export function sectionStrings(s: IntegrationDocSection): string[] {
  return [
    s.id,
    s.title,
    s.summary,
    ...s.blocks.flatMap(b => [b.heading, ...b.items]),
    ...(s.links ?? []).flatMap(l => [l.label, l.href]),
  ]
}

/** Split text on `backticks` into plain / code segments for rendering. */
export function splitInlineCode(text: string): Array<{ code: boolean; text: string }> {
  return text
    .split('`')
    .map((t, i) => ({ code: i % 2 === 1, text: t }))
    .filter(p => p.text.length > 0)
}
