# Property List Redesign — Design Spec

**Date:** 2026-06-17
**Branch:** `claude/property-list-redesign`
**Status:** Approved for planning

---

## Context

Tendwell Ops runs an established redesign workflow: a page is first rebuilt on the
`/test` route as a full-functionality "redesign proposal" (with a visible badge), reviewed,
then applied to the real page in a follow-up change. The last five pages through this
pipeline were Master List, Pipeline, Dashboard, Quote Sheet, and Clients (most recently
approved and applied: commits `9d5b197` → `71e631b`).

This spec covers the **Property List** (`/property-list` → `client/src/pages/property-list.tsx`),
the next page in the queue.

## Audience & Intent

The Property List is for **middle-level managers**. They do not need every field (financials
such as profit/revenue stay on the admin Cost Tracking page). They need a single, highly
visible, easy-to-scan roster of every property they are operationally responsible for.

## Scope of Properties ("outside the Quote stage")

The property lifecycle is: `Lead → Quote → Onboarding → Active → Offboarding → Offboarded`.

The page reads from the `operational_properties` Postgres view, which is defined with
`WHERE ps.is_operational = true`. Verified `is_operational` flags and live counts (queried
2026-06-17):

| Stage | `is_operational` | Live count | In view? |
|---|---|---|---|
| Lead | false | 0 | no |
| Quote | false | 26 | no |
| Onboarding | true | 31 | yes |
| Active | true | 154 | yes |
| Offboarding | true | 7 | yes |
| Offboarded | false | 19 | no |

**Decision:** Scope = the view as-is (Onboarding + Active + Offboarding = **192 properties**).
Offboarded units are intentionally excluded — they are no longer managed, and including them
would require abandoning the `operational_properties` view for a direct query. Keeping the view
means **no data-layer change** and preserves data integrity.

## Design

### Workflow

Build the redesign on the `/test` route first (`client/src/pages/test.tsx`), as a
full-functionality clone of the Property List with the redesign applied and a
"⚗ Redesign proposal" badge in the header. A separate, later change applies the approved
design to the real `property-list.tsx`. This spec defines the `/test` proposal; the apply
step mirrors it minus the badge.

### What changes

1. **Summary strip (new).** Four KPI tiles above the table, following the existing redesign
   pattern (`grid grid-cols-2 lg:grid-cols-4 gap-3`, `rounded-2xl border shadow-sm p-4`,
   `text-2xs` uppercase label + icon, `text-3xl font-bold tabular-nums` value):
   - **Total Properties** — highlighted tile (`border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card`); count of all in-scope rows.
   - **Onboarding** — `info` tone; count where `stage_name === 'Onboarding'`.
   - **Active** — `success` tone; count where `stage_name === 'Active'`.
   - **Offboarding** — `warning` tone; count where `stage_name === 'Offboarding'`.

   Counts are derived client-side from the already-loaded `operational_properties` result
   (no extra query).

2. **Default landing view = all in-scope.** The `statusFilter` default changes from `'Active'`
   to `'all'`, so the page opens showing every in-scope property. The localStorage
   persistence (`property-list-filter`) is kept, but the initial/default value is `'all'`.
   The "all" option label reads **"All Operational (192)"**.

3. **Filter dropdown trimmed.** Today the dropdown lists all six stages from
   `usePipelineStages()`, but Lead/Quote/Offboarded always return zero rows because the view
   excludes them. The dropdown is restricted to stages actually present in the loaded data
   (Onboarding, Active, Offboarding) plus the "All Operational" entry. Derive the option list
   from the distinct `stage_name` values in the result, ordered by the stage `display_order`.

4. **Modernized table shell.** Match the Clients redesign: outer container
   `rounded-2xl border border-border shadow-sm` (was `rounded-lg`), sticky
   `bg-muted/80 backdrop-blur` header, `hover:bg-muted/20` rows. Stage badge becomes a
   rounded-full pill but keeps the existing data-driven `stage_color` styling (data-driven
   palettes are explicitly allowed by the design system) and keeps its inline
   stage-change popover behavior.

### What stays identical (integrity guarantees)

- **Data source:** `operational_properties` view, same `select` column set
  (`id, name, address, bedrooms, full_baths, guest_count, square_footage, cleaner_pay, stage_name, stage_color`).
  No schema, view, or query-shape change.
- **Columns:** Property · Address · Beds · Baths · Guests · Sq Ft · Cleaner Pay · Status.
- **Functionality:** search (name + address), column sort, CSV export (same columns/filename),
  pagination (default 50), inline stage-change via `StageBadgePopover` (uses
  `executeStageTransition` + `useGuardedMutation('property-list', …)` and the same
  query invalidations), row click → `openPropertyModal(id, 'property-list')`.
- **Access control:** unchanged. The real page is `GuardedRoute viewId="property-list"`
  (all roles); the `/test` proposal stays `AdminRoute` (admin-only preview), as with prior
  redesigns.
- **Shared shell components:** `PageContainer`, `PageHeader`, `EmptyState` (already in use);
  add `StatCard`/inline tiles consistent with the redesign pattern.

## Components & Boundaries

- `client/src/pages/test.tsx` — replaced with the Property List redesign proposal. Self-contained
  page component; depends only on existing hooks/components (`usePipelineStages`,
  `usePropertyModal`, `useGuardedMutation`, `TablePagination`, `PageContainer`, `PageHeader`,
  `EmptyState`, supabase client, `papaparse`).
- `StageBadgePopover` — reused as-is (or lifted unchanged into the proposal); same props/behavior.
- Summary-tile markup — local to the page, following the established tile pattern; no new shared
  component required (consistent with how Clients/Quote redesigns inlined their summary strips).

## Error / Empty / Loading States

- **Loading:** existing skeleton rows (8 × 8 cells); add skeletons for the four summary tiles.
- **Empty:** existing `<EmptyState icon={Building2} …>` when the filtered set is empty.
- **Query error:** surface via `<ErrorState onRetry>` (the current page has no explicit error
  state; add one to match the design-system convention).

## Testing / Verification

No automated suite is configured (per CLAUDE.md). Verify manually with `npm run dev`:
1. `npm run check` passes (TypeScript).
2. `/test` renders the Property List proposal with the badge; tiles show 192 / 31 / 154 / 7.
3. Default view shows all in-scope stages; dropdown lists only Onboarding/Active/Offboarding + All Operational.
4. Search, sort, CSV export, pagination, inline stage change, and row→modal all work.
5. Stage change updates the row and refreshes counts.

## Out of Scope

- Applying the design to the real `property-list.tsx` (separate follow-up change).
- Any change to the `operational_properties` view, `pipeline_stages`, or financial columns.
- Including Offboarded/Lead/Quote properties.
