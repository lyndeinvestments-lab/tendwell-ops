# Financial Suite Rebuild — Design Spec

**Date:** 2026-06-27
**Status:** Shape approved (3-page consolidation · QBO actuals = source of truth · North Star parked)
**Area:** tendwell-ops financial reporting pages

## Background / why

An audit of the six financial pages (`financial-dashboard`, `revenue-report`, `pro-forma`, `forecaster`, `north-star`, `report`) found they are fragmented and largely broken/unused:

- **No source of truth:** all six re-query `operational_properties` and recompute revenue/cost/profit/margin with *different stage scopes* and *separate caches* → the same KPI shows different numbers on different pages.
- **Fake history:** no monthly financial snapshots are stored, so "12-month trend" charts apply *today's* costs to past months.
- **Wrong math:** div-by-zero issue rates ("Infinity%"), "Urgent"≠overdue, ambiguous `cleaner_pay × occupancy` forecast, inverted "missing data" filter, profit thresholds misaligned with break-even, silent overwrite of manual clean frequencies, deep-clean undercount.
- **Silent failures:** missing data renders `$0`/`0%` indistinguishable from real zero; no error states.

**Verified data foundation that already works** (underused): QBO monthly P&L cached in `app_settings.qbo_pl_data` (refreshable via QBO MCP), the `proforma_months` actuals table, `breezeway_tasks` (real cleans per property/month) + `property_breezeway_stats` view, `cleaning_history`, the live Ramp endpoint `api/ramp/spend.ts`, and the `trellis_task_snapshot`.

## Target architecture (approved)

Collapse six pages → **three**, each with one clear job, all reading a **shared financial data layer**:

1. **Overview** (new exec view) — *this spec, Phase 1*. Replaces the dashboard's KPI role + Executive Summary (`report`) + North Star's "company KPI" role.
2. **Forecast** — Phase 2: harden `forecaster` (fix deep-clean undercount, QBO key matching, seasonality on live estimate).
3. **Per-Property P&L** — Phase 3: harden `pro-forma` table (fix inverted filter, thresholds, silent overwrite; drop dead in-memory "scenarios"); absorb Revenue Report's By-Property/By-Client.

**Deprecation order (retire a page only once its replacement ships):**
- Phase 1 retires **Executive Summary** (`/report`) — Overview supersedes it.
- Phase 3 retires **Revenue Report** (`/revenue-report`).
- **North Star** (`/north-star`) is **parked** ("decide later") — left untouched for now; its auto-computed KPIs are reproduced in Overview, but its manual targets framework is not removed yet.

**Source of truth (approved): QuickBooks actuals.** Real money from QBO drives revenue / expenses / net / margin. `operational_properties` estimate sums appear only where useful and are **explicitly labeled "estimate."** The two are never conflated or summed.

## Cross-cutting data-quality rule: Trellis ⟂ Breezeway de-duplication

**Trellis mirrors/duplicates Breezeway tasks for some properties.** Any count of "tasks" or "cleans" that touches both systems MUST de-duplicate so totals are not inflated. This applies to (a) the canonical clean-volume series used across all three pages and (b) the live Trellis task tile. Dedup approach: treat Breezeway as the system of record for cleans where a property exists in both; identify overlap by (property + date + task type) and/or an external-id/source mapping, and never sum Trellis + Breezeway for the same property/period. The dedup logic lives once, in the shared layer (`cleanVolume.ts` / a `taskLoad` helper), not per page. Surface the dedup assumption in the UI footnote.

---

# Phase 1 (this spec): Shared data layer + Overview page

## 1. Shared financial data layer — `client/src/lib/financials/`
The core fix for "no source of truth." A small, tested module all three pages import:

- **`scope.ts`** — the single definition of which property stages count as operational for financials (resolves the Active-only vs Active+Onboarding+Offboarding inconsistency). One exported predicate, used everywhere.
- **`qbo.ts`** — parse `app_settings.qbo_pl_data`: normalize `monthly` (object keyed `"Mon YYYY"`, each `{income, cogs, expenses, netIncome}`) into a sorted `{ ym: "YYYY-MM", income, cogs, expenses, totalExpenses: cogs+expenses, netIncome, marginPct }[]`; expose `updatedAt`, breakdowns, and a "connected/stale" status. Tolerate both `totalX`/`x` key forms.
- **`cleanVolume.ts`** — ONE canonical monthly clean-count source, **de-duplicated across Breezeway and Trellis** (see cross-cutting rule). Prefer `breezeway_tasks`/`property_breezeway_stats` as system-of-record; fold in `cleaning_history` only for months/properties Breezeway doesn't cover; never double-count a property present in both Breezeway and Trellis. Filter `<= today` (drop stray future-dated rows). This same de-duplicated series is what Forecast and P&L must consume.
- **`taskLoad.ts`** — current open/overdue/due-this-week task counts from `trellis_task_snapshot`, **de-duplicated against Breezeway** so a clean represented in both isn't counted twice.
- **`perClean.ts`** — unit economics from QBO + (deduped) clean volume: revenue/clean, cost/clean, net/clean, margin%; divide-by-zero → `null` ("—").
- **`format.ts`** — shared currency/percent/delta formatting (no more per-page `fmt` variants).

## 2. Overview page (`client/src/pages/financial-overview.tsx`, route `/financial-dashboard` repurposed)
Access: Admin (per the standing rule new pages go to admin; viewers retained where they already had the dashboard). Reuses `PageContainer`/`PageHeader`/`StatCard`/`ErrorState`/`Skeleton` + recharts.

**Sections:**
1. **KPI tiles** (current month + MoM delta), all QBO-truth where money is involved: Revenue, Total expenses (COGS+opex), Net income, Net margin %, Cleans (deduped canonical volume), Revenue-per-clean. Plus a best-effort **live Trellis tile** (tasks due / overdue, deduped vs Breezeway; hidden if no read access).
2. **Margin trend** (trailing 12 mo, recharts ComposedChart): Revenue & Expenses bars + Net-margin-% line. Built from QBO monthly (real history, not retroactive estimates).
3. **Throughput trend**: monthly clean volume (bars) + revenue-per-clean (line).
4. **Ramp card-spend lens** — extend `api/ramp/spend.ts` to accept `?months=12` and return `byMonth` + `byCategory`. Labeled: *"Ramp card spend — already included within QuickBooks expenses; shown here by category."* **Never summed with QBO.**
5. Each integration panel shows freshness (`updated_at` / fetch time) and a clean "not connected / stale" notice instead of silent `$0`. A footnote states the Trellis/Breezeway dedup assumption.

**QBO data refresh:** `qbo_pl_data.monthly` currently holds ~6 months (2026 YTD). As a delivery step, refresh it via the QBO MCP to cover the trailing 12 months, preserving the documented shape. Freshness shown via `updated_at`. (No new cron; refresh stays MCP-driven.)

## 3. Retire Executive Summary (`/report`)
Remove its nav entry; redirect `/report` → `/financial-dashboard` (Overview). Keep `report.tsx` until Overview is verified live, then delete. Its unique bits (month picker, top/bottom-by-margin) are reproduced in Overview where useful.

## 4. Edge cases
- QBO blob missing/stale → financial tiles + margin chart show a "not connected / last updated …" notice; the rest of the page still renders.
- Ramp endpoint error/503 → spend panel shows a clean notice.
- Trellis snapshot unreadable/empty → tile hidden.
- Months with 0 cleans → per-clean metrics show "—" (guard divide-by-zero).
- 12-month axis zero-filled for gap months; `"Mon YYYY"` parsed to `YYYY-MM`.
- **Trellis/Breezeway overlap** must not inflate any count (cross-cutting rule).

## 5. Out of scope (Phase 1)
- Forecast page changes (Phase 2) and Per-Property P&L (Phase 3).
- Removing/altering North Star (parked).
- New historical snapshot tables (we rely on QBO `monthly` + `proforma_months` + Breezeway as the real history).
- Any writes to QBO/Ramp/Trellis.

## 6. Acceptance criteria (Phase 1)
- Shared `lib/financials` modules exist and are the only place Overview computes financials.
- Clean/task counts are de-duplicated across Trellis and Breezeway (no inflation); verified against a known property that exists in both.
- `/financial-dashboard` shows the KPI tiles, 12-month margin trend, throughput trend, and Ramp category panel; numbers reconcile to QBO.
- Revenue-per-clean / cost-per-clean computed with divide-by-zero guarded.
- Ramp shown as a separate, clearly-labeled lens, never summed with QBO.
- Live Trellis tile renders for admins; degrades gracefully.
- `/report` redirected; nav entry removed.
- Loading skeletons + per-panel error/empty states; `tsc` + build green; verified live on a preview.

## 7. File-level change list (Phase 1)
- **New** `client/src/lib/financials/{scope,qbo,cleanVolume,taskLoad,perClean,format}.ts`.
- **New** `client/src/pages/financial-overview.tsx` (replaces old `financial-dashboard.tsx` content; route `/financial-dashboard`).
- **Edit** `api/ramp/spend.ts` — add `months` param + `byMonth`/`byCategory` aggregation (backward compatible).
- **Edit** `client/src/App.tsx` — point `/financial-dashboard` at the new page; redirect `/report`.
- **Edit** `client/src/components/AppSidebar.tsx` — group label "Financials"; remove Executive Summary entry.
- **Edit** `client/src/lib/auth.tsx` — keep `financial-dashboard` view; mark `report` deprecated.
- **Delivery step** — refresh `app_settings.qbo_pl_data` to trailing 12 months via QBO MCP.
- **Edit** `CLAUDE.md` — document the consolidation + the `lib/financials` source-of-truth contract + the Trellis/Breezeway dedup rule.
