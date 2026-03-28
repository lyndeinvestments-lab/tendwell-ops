# Tendwell Ops — Remaining TODO List
**Date:** March 27, 2026
**Repo:** https://github.com/lyndeinvestments-lab/tendwell-ops
**Branch from:** main (after PR #23 merged)

Run all of these as a single branch `claude/overnight-improvements`. Commit after each numbered group. Push and create PR when done.

---

## Group 1: Activity Feed Audit Logging (HIGH PRIORITY)

The Activity Feed page (`client/src/pages/activity.tsx`) shows 0 entries because the `property_edit_log` table is never written to from the frontend. Wire up audit logging:

1. Create a shared utility function `logPropertyEdit(propertyId, fieldName, oldValue, newValue)` in `client/src/lib/supabase.ts` that inserts into the `property_edit_log` table.
2. Call this function from every inline edit save handler across these pages:
   - `client/src/pages/cost-tracking.tsx` — when CE Charged, Cleaner Pay, Laundry, Consumables are edited inline
   - `client/src/pages/master-list.tsx` — when any property field is edited inline
   - `client/src/pages/linen-tracker.tsx` — when linen counts are edited
   - `client/src/pages/access-codes.tsx` — when access codes are edited
   - `client/src/pages/ac-filters.tsx` — when filter size or dates are edited
3. Also log stage transitions — in `client/src/pages/pipeline.tsx` where `moveProperty` mutation succeeds, log the stage change.
4. The Activity Feed page already queries `property_edit_log` and displays entries — once the writes are in place, it should populate automatically.

---

## Group 2: Revenue Report Data Fixes

### 2a. Fix 12-Month Revenue Trend Chart (flat lines)
In `client/src/pages/revenue-report.tsx`, the `chartData` computation uses the same static values for every month. Fix it:
- Query `stage_transitions` to find when each property became Active
- For each of the last 12 months, sum only properties that were Active during that month
- This gives real month-over-month variation instead of flat lines

### 2b. Fix By Client PAYMENT column
In the Revenue Report By Client view, the PAYMENT column is empty. The `contacts` table has a `payment_method` field. Join properties → contacts to get the payment method for each client group.

### 2c. Fix By Client view to actually aggregate by client
The "By Client" tab should group properties by their `client` field and show aggregate CE, Cleaner Pay, and Profit per client. Verify this works correctly — the toggle may not be switching the data source.

---

## Group 3: Cleaners Module

The Cleaners page (`client/src/pages/cleaners.tsx`) has Roster, Calendar, and Reconciliation tabs but shows empty states.

### 3a. Pre-populate cleaner roster from cost data
Query `properties` for distinct `cleaner_name` values (or a dedicated cleaners table if it exists). Show them in the Roster tab.

### 3b. Calendar — make cells clickable
In the Calendar tab, make each day cell clickable with a "+" on hover to create a new cleaning assignment. The `clean_assignments` table likely already exists.

### 3c. Reconciliation tab
Show total cleans × pay rate per cleaner per month. Pull from `clean_assignments` joined with the cleaner's rate.

---

## Group 4: Property Detail Modal Improvements

### 4a. Group related tabs
In `client/src/components/PropertyDetailModal.tsx`, the modal has 11 tabs. Group them:
- Keep: Overview, Financials, Notes
- Group into "Operations" tab with sub-sections: Linens, AC Filter, Supplies
- Group into "Setup" tab with sub-sections: Access Codes, Onboarding
- Keep: Inspections, Assignments, Photos

### 4b. Add "Stage Notes" visible on pipeline cards
In `client/src/pages/pipeline.tsx`, add a single-line "stage note" field displayed directly on pipeline cards (e.g., "Waiting for owner contract"). This is separate from the full Notes history. Store in a `stage_note` column on `properties` or use the first line of `notes`.

---

## Group 5: Mobile Responsiveness

### 5a. Sidebar collapse to hamburger on mobile
In `client/src/components/ui/sidebar.tsx` and `client/src/App.tsx`, ensure the sidebar collapses to a hamburger menu on screens < 768px. The Shadcn sidebar component may already support this — verify and fix if needed.

### 5b. Tables horizontally scrollable with frozen first column
For Master List, Cost Tracking, Access Codes, Pro Forma — add `sticky left-0` to the first column (Property name) so it stays visible while scrolling horizontally on mobile.

### 5c. Pipeline columns stack vertically on mobile
In `client/src/pages/pipeline.tsx`, on mobile screens, show pipeline stages as a vertical list instead of horizontal columns. Add a stage selector dropdown at the top.

---

## Group 6: AC Filters Improvements

### 6a. Bulk edit mode
In `client/src/pages/ac-filters.tsx`, add a "Bulk Edit" button that enables multi-select checkboxes and a bulk action bar (similar to Master List). Allow bulk-setting filter size and bulk-marking as "changed today".

### 6b. AC Filters CSV import
Add an "Import CSV" button to AC Filters that accepts a CSV with columns: Property, Filter Size, Last Changed. Match to existing properties and update.

---

## Group 7: Data Integrity & Validation

### 7a. Duplicate detection on property creation
In the pipeline Add Lead form and CsvImportModal, before creating a new property, check if a property with a similar name already exists. Show a warning: "A property named [X] already exists. Create anyway?"

### 7b. SCounty / sub-property handling
Add a `property_type` field or `exclude_from_financials` boolean to the properties table. Properties with $0 CE and "(SCounty)" in their name should be auto-flagged. Exclude them from Revenue Report, Financial Dashboard, and Pro Forma financial aggregates. Add a Supabase migration for this.

### 7c. Offboarded date auto-populate
When a property's stage changes to "Offboarded" via the pipeline, auto-set an `offboarded_at` timestamp. Check the stage transition logic in `client/src/pages/pipeline.tsx`.

---

## Group 8: UX Polish

### 8a. Keyboard shortcuts help modal
The `?` shortcut and `KeyboardShortcuts` component already exist. Verify it's discoverable — add a small `?` icon button in the header next to the search button that opens the shortcuts modal.

### 8b. Export CSV toast on ALL pages
Check these pages and add toast feedback after CSV export if missing:
- `client/src/pages/cost-tracking.tsx`
- `client/src/pages/linen-tracker.tsx`
- `client/src/pages/access-codes.tsx`
- `client/src/pages/pro-forma.tsx`
- `client/src/pages/revenue-report.tsx`
- `client/src/pages/previous-properties.tsx`

### 8c. Financial Dashboard vs Revenue Report number mismatch
Add tooltips to the Financial Dashboard KPI cards explaining: "Includes all active properties × estimated cleans/month. See Revenue Report for actual CE charged totals." This clarifies why the numbers differ.

### 8d. Property name truncation consistency
Check all remaining table pages and add `max-w-[200px] truncate` with `title={p.name}` to property name cells if not already done:
- `client/src/pages/cost-tracking.tsx`
- `client/src/pages/linen-tracker.tsx`
- `client/src/pages/access-codes.tsx`
- `client/src/pages/ac-filters.tsx`

### 8e. Sidebar keyboard shortcut hint
Add `⌘K` and `?` shortcut hints to the sidebar footer area so users discover them.

---

## Group 9: New Features (Lower Priority)

### 9a. Linen Tracker CSV import
Add "Import CSV" button to `client/src/pages/linen-tracker.tsx` matching the export format. Bulk-update linen counts for matched properties.

### 9b. Linen history tracking
When linen counts are updated, store a snapshot in a `linen_history` table (property_id, field, old_value, new_value, timestamp). Show a small history icon per property that opens a popover with the change log.

### 9c. Owner report PDF export
Add a "Generate Report" button on the Revenue Report page that creates a print-friendly summary for a selected property or client. Use `@media print` CSS or a simple HTML-to-PDF approach.

### 9d. Per-user preferences
Add a "My Preferences" section to Settings: default rows per page, default dark/light mode, default date range for Revenue Report. Store in localStorage keyed by user role.

### 9e. Column visibility toggle
Add a "Columns" button to Master List and Cost Tracking that opens a checklist of columns. Save visibility preferences to localStorage.

---

## Group 10: Performance (Lowest Priority)

### 10a. Pipeline virtual scrolling
The Active column renders 81+ cards at once. Consider using `react-window` or `@tanstack/react-virtual` to virtualize the card list within each column.

### 10b. Dashboard lazy-load below-fold sections
Wrap the bottom sections of the dashboard (CRM Overview, Quality Leaderboard) in a lazy-loading boundary that only renders when scrolled into view.

---

## Instructions for the overnight session

1. `cd ~/tendwell-ops && git checkout main && git pull origin main`
2. `git checkout -b claude/overnight-improvements`
3. Work through groups 1-8 in order (skip 9-10 if running low on time)
4. Commit after each group with descriptive message
5. Run `tsc --noEmit` after each group to verify no type errors (ignore pre-existing errors in PropertyDetailModal and contacts.tsx)
6. `git push -u origin claude/overnight-improvements`
7. `gh pr create --title "feat: overnight improvements — audit logging, revenue fixes, cleaners, mobile, polish" --body "..."`
8. Update `CLAUDE.md` Current State section with what was done
