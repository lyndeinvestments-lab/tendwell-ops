# Tendwell Ops — Claude Context File

> Quick-start context for new Claude sessions. Read this first before any task.

---

## What This App Is

**Tendwell Ops** is a full-stack operations management and CRM dashboard for a property management / short-term rental business. It tracks properties through a 6-stage lifecycle, manages operational tasks (linens, AC filters, access codes), handles CRM contacts, and generates financial reports and quotes.

**Property lifecycle stages (in order):**
`Lead → Quote → Onboarding → Active → Offboarding → Offboarded`

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, TypeScript 5.6, Vite 7 |
| Routing | Wouter 3 (lightweight, not React Router) |
| State / Data | TanStack React Query 5 |
| Styling | Tailwind CSS 3 + Shadcn/ui + Radix UI |
| Animations | Framer Motion 11 |
| Charts | Recharts 2 |
| Forms | react-hook-form + Zod |
| Drag & Drop | dnd-kit 6 (pipeline Kanban) |
| Backend | Node.js + Express 5, TypeScript |
| Primary DB | Supabase (PostgreSQL) |
| Fallback DB | SQLite via Drizzle ORM + better-sqlite3 |
| Auth | Google OAuth via Supabase Auth, role stored in `app_users` table |
| Deployment | Vercel (configured) |

---

## Project Structure

```
tendwell-ops/
├── client/src/
│   ├── App.tsx                  # Router + auth context wiring
│   ├── pages/                   # 14 feature pages (see below)
│   ├── components/              # Shared components + Shadcn ui/
│   │   ├── AppSidebar.tsx       # Nav sidebar (role-based menu items)
│   │   ├── PropertyDetailModal.tsx  # Universal property modal (~630 LOC)
│   │   ├── PropertyEditDialog.tsx
│   │   ├── StageTransitionModal.tsx
│   │   ├── CommandPalette.tsx   # Cmd+K global search
│   │   ├── CsvImportModal.tsx
│   │   ├── ChatBot.tsx          # Floating agentic chatbot (Claude API)
│   │   └── ui/                  # ~50 Shadcn components
│   ├── hooks/
│   │   ├── use-auth.tsx         # Auth context hook
│   │   ├── use-property-modal.tsx  # Global property modal state
│   │   ├── use-app-settings.ts  # App-wide config settings
│   │   └── use-toast.ts
│   └── lib/
│       ├── auth.tsx             # Role definitions + VIEW_ACCESS map
│       ├── supabase.ts          # Supabase client + stage colors/order
│       ├── queryClient.ts       # React Query client + apiRequest util
│       └── utils.ts             # cn() Tailwind merge util
├── server/
│   ├── index.ts                 # Express app, middleware, error handling
│   ├── routes.ts                # API routes (/api/chat + CORS)
│   ├── chat.ts                  # Claude API agentic chat handler + tool definitions
│   ├── storage.ts               # Drizzle ORM interface (SQLite fallback)
│   └── vite.ts                  # Vite dev middleware setup
├── api/auth/login.ts            # Vercel serverless login endpoint
├── shared/schema.ts             # Drizzle schema (users table + Zod types)
├── supabase/migrations/         # SQL migration files
├── script/build.ts              # esbuild server bundle + Vite client build
├── vercel.json                  # Vercel deployment + CSP headers
├── .env.example                 # Required env vars (see below)
├── tailwind.config.ts
├── vite.config.ts
└── drizzle.config.ts
```

---

## Pages

| Route | File | Access |
|---|---|---|
| `/login` | `login.tsx` | Public |
| `/` → `/dashboard` | `dashboard.tsx` | admin, viewer |
| `/pipeline` | `pipeline.tsx` | admin, viewer |
| `/property-list` | `property-list.tsx` | all roles |
| `/cost-tracking` | `cost-tracking.tsx` | admin, viewer |
| `/linen-tracker` | `linen-tracker.tsx` | admin, operations, cleaning |
| `/access-codes` | `access-codes.tsx` | admin, operations |
| `/ac-filters` | `ac-filters.tsx` | admin, operations, viewer |
| `/contacts` | `contacts.tsx` | admin, viewer |
| `/quote-sheet` | `quote-sheet.tsx` | admin |
| `/master-list` | `master-list.tsx` | admin, viewer |
| `/pro-forma` | `pro-forma.tsx` | admin, viewer |
| `/settings` | `settings.tsx` | admin |
| `/revenue-report` | `revenue-report.tsx` | admin, viewer |
| `/inspections` | `inspections.tsx` | admin, operations, viewer |
| `/trellis-sync` | `trellis-sync.tsx` | **admin only** (`AdminRoute`) |
| `/owner` (implicit) | `owner-portal.tsx` | **owner role only** (separate sidebar-free portal) |
| `/reset-password` | `reset-password.tsx` | Public (password-recovery link target) |
| `/cleaners` | `cleaners.tsx` | admin, operations |
| `/alerts` | `alerts.tsx` | admin, operations, viewer |
| `/activity` | `activity.tsx` | admin, viewer |

---

## Auth & Roles

- **Login (staff)**: Google OAuth via Supabase Auth (`supabase.auth.signInWithOAuth({ provider: 'google' })`)
- **Login (owners)**: Email/password via Supabase Auth (`signInWithPassword`). Forgot-password uses `resetPasswordForEmail` → email link → `/reset-password` → `supabase.auth.updateUser({ password })`. The `PASSWORD_RECOVERY` auth event gates the app behind the reset screen.
- **Authorization**: After sign-in, email is looked up first in `app_users.google_email` (staff). If not found, it's looked up in `property_owners.email` (owner role). If neither → signed out with "not authorized" error.
- **Session**: Supabase Auth handles session persistence (localStorage key `tendwell-sb-auth`). 7-day inactivity timeout (`SESSION_TIMEOUT_MS` in `client/src/lib/auth.tsx`).
- **Roles**: `admin` | `operations` | `cleaning` | `viewer` | `owner`
- **Owner portal**: users with role `owner` are routed (by role, in `App.tsx`) to a dedicated sidebar-free portal (`owner-portal.tsx`) and never see staff routes. RLS restricts them to their assigned properties only.
- Role definitions and view access map: `client/src/lib/auth.tsx`
- **User management**: Settings page (`/settings`, admin only) — add users by Google email, set role, inline role editing, remove users. No password needed.

---

## Database

### Supabase (Primary)

Key tables:
- `properties` — main property records (stage_id, contact_id, financials, follow_up_date)
- `pipeline_stages` — stage definitions (id, name, display_order)
- `stage_transitions` — audit trail of stage changes
- `property_edit_log` — field-level edit audit trail
- `contacts` — CRM contacts (payment_method, created_at)
- `app_users` — login users (role, label, password_hash)
- `app_settings` — KV config store (inspection cost, profit tiers, AC filter interval, etc.)
- `operational_properties` — DB view for cost tracking
- `property_owners` — owner portal login identities (email/password owners; separate from staff `app_users`). Has an `active` flag (`20260623b_owner_admin.sql`) — when false, the owner can't sign in and loses all property access (`current_owner_id()` returns NULL for inactive owners).
- `owner_properties` — join table linking owners → properties (access scope for the owner portal)

Owner-editable property columns (added `20260623_owner_portal.sql`): `owner_contact_name`, `owner_contact_email`, `owner_contact_phone`, `preferred_payment_method` (plus existing `address`, `bed_sizes_text`, `number_of_beds`, `square_footage`, `door_code`, `auto_code`, `other_codes`, `wifi_info`). A BEFORE-UPDATE guard trigger (`properties_owner_update_guard`) ensures an owner UPDATE can only ever change these whitelisted columns. RPC `get_owner_property_tasks(p_property_id)` (SECURITY DEFINER) returns the combined inspections + Trellis task feed for an owned property.

Inferred tables: `linen_inventory`, `access_codes`, `ac_filters`

New tables (migration `20260324_round6_features.sql`):
- `contact_notes` — notes attached to CRM contacts (contact_id, content, created_by)
- `inspection_photos` — photos attached to inspections
- `property_photos` — photo gallery per property (photo_url, sort_order) — stored in Supabase Storage bucket `property-photos`
- `property_supplies` — supply checklist per property (item_name, par_level, current_qty, last_restocked)

### SQLite (Fallback via Drizzle)

Simple `users` table only. Schema in `shared/schema.ts`. Config in `drizzle.config.ts`.

### Recent Migrations

- `20260323_add_follow_up_date.sql` — adds `follow_up_date` to properties
- `20260324_add_app_settings.sql` — creates `app_settings` KV table with defaults
- `20260324_round6_features.sql` — adds contact_notes, inspection_photos, property_photos, property_supplies

---

## API

No Express API endpoints — all data access goes client → Supabase directly with RLS enforcement. The legacy `/api/auth/login` password endpoint was removed in the security hardening pass.

---

## Environment Variables

```env
# Server-side (secret — never expose to client)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Client-side (exposed via Vite VITE_ prefix)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

---

## Dev Commands

```bash
npm run dev        # Start dev server (Vite HMR + Express on port 5000)
npm run build      # Production build (Vite client + esbuild server)
npm run start      # Start production server
npm run check      # TypeScript type-check
npm run db:push    # Push Drizzle schema to SQLite
```

---

## Key Patterns & Conventions

- **Data fetching**: React Query hooks calling Supabase client directly (no server middleman for CRUD)
- **Global property modal**: Any page can open a property detail via `use-property-modal.tsx` context — don't create per-page modals
- **Inline editing**: Use `InlineEdit.tsx` component for table cell edits
- **Notifications**: Use `use-toast.ts` hook (Shadcn toast)
- **Styling**: Always Tailwind + `cn()` utility. Don't add inline styles.
- **Icons**: Lucide React only
- **Form validation**: Zod schemas + react-hook-form
- **Path aliases**: `@/` = `client/src/`, `@shared/` = `shared/`
- **Dark mode**: Enabled via `next-themes`, class-based. CSS vars in `client/src/index.css`
- **Status colors**: NEVER hardcode `text-red-700 bg-red-50 dark:...` chips. Use the semantic tokens `success` / `warning` / `info` / `destructive` (with alpha variants like `bg-success/10`) via `<StatusBadge>` or the `TONE_*` maps in `client/src/lib/status-colors.ts`
- **Page shell**: Every internal page wraps content in `<PageContainer>` (standard padding/max-width) with a `<PageHeader>` title row (actions/filters in its `actions`/`beneath` slots)
- **KPI tiles**: Use the shared `<StatCard>` (`components/StatCard.tsx`) — don't define per-page KpiCards
- **Error/empty states**: Surface query errors with `<ErrorState onRetry>`, empty lists with `<EmptyState>`
- **Microtype**: Use `text-2xs` (11px) instead of `text-[10px]`/`text-[11px]`

---

## Git / PR Workflow

- Org: `lyndeinvestments-lab`
- Repo: `lyndeinvestments-lab/tendwell-ops`
- Feature branches → PR → merge to main
- Active development branch pattern: `claude/<description>-<id>`
- No test suite currently configured

---

## Current State & Recent Work

- **Owner Portal (2026-06-23, branch `claude/owner-portal-*`):** new owner-facing portal. Adds email/password login + forgot-password (Supabase Auth `signInWithPassword` / `resetPasswordForEmail` / `updateUser`) alongside the existing staff Google OAuth. New `owner` role: users in the new `property_owners` table (keyed by auth email) are routed by role in `App.tsx` to a sidebar-free `owner-portal.tsx` where they can (1) see only their assigned properties, (2) edit a whitelisted field set (bed sizes, codes, Wi-Fi, other codes, bed count, square footage, address, owner contact info, preferred payment method), and (3) view scheduled tasks (title + date) sourced from internal inspections + the Trellis snapshot. Access is enforced in Postgres: `properties` RLS rewritten to staff-full + owner-scoped (`owner_owns_property(id)`), a guard trigger restricts owner column writes, and tasks are read via the SECURITY DEFINER RPC `get_owner_property_tasks` (owners can't read the admin-only `trellis_task_snapshot` directly). Migration: `20260623_owner_portal.sql`. New pages: `owner-portal.tsx`, `reset-password.tsx`. **Trellis hookup:** tasks reuse the existing `trellis_task_snapshot` (refreshed by the Trellis sync cron) matched by `trellis_id`/name — no separate Trello call.

- **Owner admin / Settings → Owners tab (2026-06-23, branch `claude/owner-portal-49519`):** admin UI to manage owners end-to-end, no manual SQL needed. New **Owners** tab on the Settings page (`settings.tsx` → `OwnersSection`, admin-only like the rest of Settings) lets admins: search owners; create an owner (provisions the Supabase Auth email/password login **and** the `property_owners` record in one step); edit name/phone inline; toggle **Active** (enable/disable portal access without deleting); manage **property access** via a searchable checkbox dialog writing `owner_properties`; send a password-reset email; and remove an owner (deletes the record + cascade assignments + the auth login). **Provisioning boundary:** creating/deleting a Supabase Auth user needs the service role, so it runs server-side at **`POST/DELETE /api/owners/provision`** (admin Bearer-gated, mirrors the QBO/notify endpoints) — the `property_owners`/`owner_properties` rows are still written client-side under admin RLS. Client helpers: `client/src/lib/owners.ts` (`provisionOwnerLogin`, `deleteOwnerLogin`). Migration `20260623b_owner_admin.sql` adds `property_owners.active` and gates `current_owner_id()` on it. **Manual/live setup still required:** apply both owner migrations to Supabase; ensure `SUPABASE_SERVICE_ROLE_KEY` is set in the deployment env (already used by other `/api` endpoints) so provisioning works; email/password account creation is now **automatic** from the Add Owner dialog (admin sets a temp password; owner can reset it via Forgot password).

- **Mobile web optimization (2026-06-22, branch `claude/mobile-web-optimization-8ilwv8`):** fixed the "impossible to scroll on mobile" bug. Root cause: every full-page view wrapped content in `<PageContainer className="h-full flex flex-col">`, locking the page to viewport height with the wide table in a nested `overflow-auto flex-1` pane — on a phone that nested both-axis scroll pane trapped touch. Fix: the height-lock + inner-scroll now applies only at `md:`+ (`md:h-full md:flex md:flex-col`) across all ~22 table/list pages, so on mobile the page grows and scrolls naturally via the `main` scroll container while tables scroll horizontally only. **Pattern going forward:** use `md:h-full md:flex md:flex-col` (not `h-full flex flex-col`) on `PageContainer` for fixed-height table pages. Master List (`cost-tracking.tsx`, the explicit complaint — 17 columns) additionally gets a dedicated mobile card view (`md:hidden` stacked cards with inline-editable cost fields + MarginMeter; desktop table is now `hidden md:block`). Desktop layout is unchanged (the new classes are identical at `md:`+).

- **Trellis Sync & Reconciliation (2026-06-18, branch `claude/trellis-sync-reconciliation`):** new admin-only `/trellis-sync` page maps Ops `properties` to Trellis across two workspaces (A = Tendwell's own Trellis / direct clients; B = Haven's Trellis, where most Tendwell cleaning happens), flags exceptions (Tendwell work in Trellis with no Ops home), and hosts a Workflows tab + Tendwell roster tab. Data lives in snapshot tables refreshed by a **local nightly cron** (`scripts/trellis-sync.sh` runs Claude Code headless with the `trellis-sync` skill — the only context with the Trellis MCP connections) + an on-demand poller (`scripts/trellis-sync-poller.mjs`) triggered by the page's Refresh button. New tables: `trellis_property_snapshot`, `trellis_task_snapshot`, `trellis_roster`, `trellis_sync_log` (all admin-only RLS). Tendwell-attribution + reconciliation logic lives in SQL views (`trellis_task_attributed`, `trellis_property_enriched`, `trellis_reconciliation`, `trellis_exceptions`). **Note:** `properties.trellis_id` is TEXT while Trellis ids are uuid — views cast `::text` to join. A task is Tendwell's if workspace='A' OR `assigned_to_name='Tendwell Cleaning Co.'` OR `assigned_to_id` ∈ workspace-A roster (shared `user_id`). Migration: `20260618_trellis_sync.sql`. Runner setup + ops in `docs/trellis-sync-cron.md`.

- **Page-standard sweep + Previous Properties removed (2026-06-17):** modernized table/card containers to `rounded-2xl` + `shadow-sm` and added `ErrorState` on primary queries across the remaining pages (access-codes, linen-tracker, linen-inventory, property-verifications, cleaners, cleaner-metrics, lost-items, lost-item-detail, tasks, issues, activity, pro-forma, revenue-report, north-star, onboarding-queue, incoming-shipments). Deleted the `/previous-properties` page entirely — Master List (`/master-list`→cost-tracking.tsx) covers it via the **Offboarded** status filter; removed its route, sidebar nav, command-palette entry, `previous-properties` view definition + role-view refs, and repointed the dashboard offboarded links to `/master-list`.

- **AC Filters redesign (2026-06-17, branch `claude/ac-filters-redesign`):** added a summary strip (Total Tracked · Overdue · Due Soon · Missing Filter Size), upgraded the table to `rounded-2xl` + `shadow-sm`, added an `ErrorState`, and folded the old header overdue/due-soon pills into the tiles. Tiles compute client-side (no new query); inline edits, bulk mode, Mark Changed Today, CSV import, search/status filter/sort all preserved. Built directly on the real page.
- **Inspections redesign (2026-06-17, branch `claude/inspections-redesign`):** migrated to the shared `PageContainer`/`PageHeader` shell, added a summary strip (Total · Avg Overall Score · Inspected 7d · Needs Re-inspection), `rounded-2xl` + `shadow-sm` table/cards, and an `ErrorState` on query failure. Two new head-only `count` queries for the tiles; all existing behavior (two tabs, server-side pagination, 5 filters, detail + Log slide-overs, mobile cards, CSV, delete) preserved. Built directly on the real page (no `/test` proposal step).
- **Property List redesign (2026-06-17):** applied to the real `/property-list` page (proposal #342 → apply #343). Summary strip, all-operational default, trimmed stage filter, modernized table; `operational_properties` view unchanged.
- **`/test` previously hosted the Property List redesign proposal (branch `claude/property-list-redesign`):** summary strip (Total/Onboarding/Active/Offboarding), default lands on all in-scope stages ("All Operational") instead of Active-only, stage filter trimmed to stages present in `operational_properties` (Onboarding/Active/Offboarding), modernized table shell (rounded-2xl, pill stage badges, ErrorState, tile skeletons). Data source unchanged. Pending apply to the real `/property-list` page. Spec + plan in `docs/superpowers/`.
- **Design-system unification + perf pass (2026-06-09, branch `claude/full-redesign-20260609`):**
  - New semantic status tokens (`success`/`warning`/`info`) in index.css + Tailwind; real shadow scale (was all-zero); `text-2xs` utility
  - New shared components: `StatusBadge`, `StatCard`, `PageContainer`, `ErrorState` (+ existing `PageHeader`/`EmptyState` now used app-wide)
  - All ~38 pages migrated to the shared shell; hardcoded per-page status color maps removed (only data-driven palettes like CLEANER_COLORS remain)
  - Perf: inspections page moved to server-side pagination/filtering (was a 2,000-row client fetch) with chunked CSV export; contacts page joined the shared `['contacts']` query-key family (fixes stale-after-mutation); PropertyDetailModal tabs now fetch lazily and recharts is code-split out of the always-mounted modal (`PropertyModalChart.tsx`)
  - index.html: light/dark `theme-color` + `color-scheme` meta
  - Backups: git tag `backup-pre-redesign-20260609`, branch `backup/pre-redesign-20260609`, source archive in `_backups/`
- CRM module built (contacts, activity logging, Bill.com payment integration label)
- Mobile UX pass (sidebar, pipeline, dashboard)
- Universal property modal wired across all pages
- Cmd+K command palette
- App settings page with configurable cost thresholds
- Follow-up date tracking on Lead/Quote/Onboarding pipeline cards
- Cleaner calendar: drag-and-drop assignments, "+Assign" per cell, color legend, cleaner-based reconciliation tab
- Inspection form: right slide-over for logging + row detail panel
- Contact modal: converted to Sheet slide-over, Notes tab with `contact_notes` table, Send Email button
- Activity Feed page (`/activity`): field-level edit log with filters, search, revert button
- Revenue Report: Forecast tab with occupancy input, 6-month projections, Best/Worst Case toggles, CSV export
- Property modal: Photos tab (Supabase Storage upload/delete) + Supplies tab (par levels, restock badges)
- Cost Tracking: optimistic updates, green flash on save, right-click context menu "Reset Row", Laundry/Consumables now editable
- Pipeline: card click opens right-side slide-over with financials, onboarding checklist, notes, Move Stage dropdown
- **Overnight improvements (2026-03-27):**
  - Audit logging: `logPropertyEdit()` utility wired into all inline edits across 6 pages + stage transitions; Activity Feed now auto-populates
  - Revenue Report: 12-month chart uses `stage_transitions` for historical accuracy; By Client view falls back to name-based contact matching for payment method
  - Cleaners: reconciliation tab shows pay rate vs expected pay variance, summary KPIs
  - Property Modal: tabs grouped into Operations (Linens, AC Filter, Supplies) and Setup (Access Codes, Onboarding)
  - Pipeline: cards show first line of notes as stage note; mobile stage selector with vertical stacking
  - Mobile: sticky first column on all table pages (Master List, Cost Tracking, Access Codes, Pro Forma)
  - AC Filters: bulk edit mode (multi-select + bulk set size / mark changed today), CSV import
  - Data integrity: duplicate detection on Add Lead, `exclude_from_financials` flag for SCounty properties, auto `offboarded_at` timestamp
  - UX polish: `?` shortcuts button in header, CSV export toast on all pages, KPI tooltip explanations, sidebar `⌘K` / `?` hints
- **Google Auth + User Management (2026-03-31):**
  - Password login removed; replaced with Google OAuth via Supabase Auth
  - `app_users.google_email` column added — sign-in looks up role by email
  - Settings page user management: add users by Google email, inline role editing, remove users; no password required
- **Security Hardening (2026-04-01):**
  - RLS enabled on ALL Supabase tables — anon key can no longer read/write any data
  - `app_users` and `app_settings` restricted to admin-only writes (prevents privilege escalation)
  - All existing "allow all" RLS policies replaced with authenticated-only policies
  - Route-level access guards (`GuardedRoute` component) — unauthorized users see "no access" instead of page content
  - Legacy `/api/auth/login` password endpoint removed entirely
  - `setViewAs` emulation restricted to admin role at function level
  - CSP hardened: removed `unsafe-eval` from script-src
  - All legacy `password_hash` values cleared from `app_users`

- **UX Improvements (2026-04-02):**
  - Dashboard: Follow-Up Due Today widget, Pipeline Velocity KPIs (conversions, avg onboarding days)
  - CSV export on Inspections and Cleaners reconciliation pages
  - Date-range filtering on Inspections, month picker on Cleaners reconciliation
  - Mobile: sticky cleaner name column on calendar, touch-visible assign button
  - In-line alert highlights on Cost Tracking rows (financial/data quality alerts)
  - Cleaners linked to inspections via `cleaner_id` column + dropdown in Log Inspection form
  - Persistent alert dismissals in Supabase (replaces localStorage)
  - Sticky property name column on Inspections table

### Recent Migrations

- `20260327_exclude_from_financials.sql` — adds `exclude_from_financials` boolean + `offboarded_at` timestamp to properties
- `20260331_google_auth.sql` — adds `google_email` (unique) to `app_users`, makes `password_hash` nullable
- `20260401_security_rls.sql` — enables RLS on all tables, creates `current_user_role()` helper, restricts `app_users`/`app_settings` to admin writes
- `20260402_alert_dismissals.sql` — creates `alert_dismissals` table for persistent dismissal/snooze state
- `20260402_inspections_cleaner.sql` — adds `cleaner_id` FK to `inspections` for quality attribution
- `20260616_fix_zero_laundry_consumables.sql` — fixes 30+ properties stuck at $0 laundry/consumables (a 2026-06-09 bulk import wrote literal `0`s, which the recalc trigger only auto-fills when `NULL`). Adds an INSERT-time guard treating an explicit `0` as "unset" (UPDATE still preserves a deliberate `0`), and backfills affected rows via null-and-recompute.
- `20260623_owner_portal.sql` — owner portal: `property_owners` + `owner_properties` tables, owner contact/payment columns on `properties`, identity helpers (`current_auth_email`, `is_staff`, `current_owner_id`, `owner_owns_property`), rewritten `properties` RLS (staff-full + owner-scoped), owner-column guard trigger, and the `get_owner_property_tasks` RPC.
- `20260623b_owner_admin.sql` — adds `property_owners.active` (owner enable/disable) and re-defines `current_owner_id()` to return NULL for inactive owners, so disabling an owner immediately revokes portal sign-in + all property access. Backs the Settings → Owners admin tab.

---

## Keeping This File Updated

**Every time a new branch is created or a feature is completed, update this file.**

Specifically:
- Add any new pages/routes to the Pages table
- Add any new Supabase tables/columns to the Database section
- Note new patterns or conventions introduced
- Update "Current State & Recent Work" with a one-line summary of what changed
- If new env vars are introduced, add them to the Environment Variables section
- If new dependencies are added, update the Tech Stack table

This keeps the file useful as the app grows. Treat it like a living document — not a one-time snapshot.

---

## Common Task Checklist

Before starting any feature:
1. Check which role(s) need access → update `auth.tsx` VIEW_ACCESS if needed
2. Check if a Supabase migration is needed → add to `supabase/migrations/`
3. Use the existing universal property modal — don't create new ones
4. Add new pages to `App.tsx` router and `AppSidebar.tsx` nav
5. Keep data fetching in React Query hooks, not useEffect+useState
