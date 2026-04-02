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
│   ├── routes.ts                # API routes (/api/auth/login + CORS)
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
| `/previous-properties` | `previous-properties.tsx` | admin, viewer |
| `/settings` | `settings.tsx` | admin |
| `/revenue-report` | `revenue-report.tsx` | admin, viewer |
| `/inspections` | `inspections.tsx` | admin, operations, viewer |
| `/cleaners` | `cleaners.tsx` | admin, operations |
| `/alerts` | `alerts.tsx` | admin, operations, viewer |
| `/activity` | `activity.tsx` | admin, viewer |

---

## Auth & Roles

- **Login**: Google OAuth via Supabase Auth (`supabase.auth.signInWithOAuth({ provider: 'google' })`)
- **Authorization**: After Google sign-in, user's email is looked up in `app_users.google_email`. If not found → signed out with "not authorized" error.
- **Session**: Supabase Auth handles session persistence (localStorage key `tendwell-sb-auth`). 30-min inactivity timeout.
- **Roles**: `admin` | `operations` | `cleaning` | `viewer`
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

---

## Git / PR Workflow

- Org: `lyndeinvestments-lab`
- Repo: `lyndeinvestments-lab/tendwell-ops`
- Feature branches → PR → merge to main
- Active development branch pattern: `claude/<description>-<id>`
- No test suite currently configured

---

## Current State & Recent Work

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
