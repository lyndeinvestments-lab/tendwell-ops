# Financial Overview (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken financial-dashboard + Executive Summary with one trustworthy **Overview** page driven by a shared, de-duplicated financial data layer.

**Architecture:** A Postgres view (`financial_monthly_cleans`) encapsulates the property-level Trellis/Breezeway dedup ONCE; a `financial_task_load` view does the same for current task counts. A small client `lib/financials/` module parses QBO actuals and computes unit economics. The Overview page composes these with an extended Ramp endpoint. QBO actuals are the dollar source of truth; Ramp is a labeled card-spend lens, never summed with QBO.

**Tech Stack:** Vite + React 18 + TypeScript, wouter, TanStack Query, Supabase JS, recharts, Tailwind + shadcn/Radix, Vercel serverless (`@vercel/node`). Unit tests via **vitest** (added in Task 2).

## Global Constraints

- **Dollar source of truth = QuickBooks** (`app_settings.qbo_pl_data`). `operational_properties` estimates are labeled "estimate" and never summed with QBO.
- **Trellis/Breezeway dedup is PROPERTY-LEVEL, single-source:** each property counts from **Breezeway if it has any `breezeway_tasks`**, otherwise from **Trellis**. Never both. (Grounded counts: 107 in-both, 7 Breezeway-only, 68 Trellis-only.)
- **Ramp ≠ QBO:** Ramp spend is shown only as a labeled breakdown ("already inside QuickBooks expenses"), never added to QBO totals.
- **Trellis↔Ops join:** `properties.trellis_id` (text) = `trellis_*.trellis_property_id::text`. **Breezeway↔Ops join:** `breezeway_tasks.property_id` (bigint) = `properties.id`.
- **Access:** Overview is in the Admin group (per the standing rule new pages go to admin; existing viewer access to the dashboard view is retained).
- **UI conventions:** wrap in `PageContainer` + `PageHeader`; KPIs via `StatCard`; errors via `ErrorState`; loading via `Skeleton`; icons from `lucide-react`; `cn()` for classes; path alias `@/` = `client/src/`. Never render silent `$0` for missing data — show a "not connected / stale" notice.
- **Trailing window:** 12 months for all trends.

---

### Task 1: Dedup views migration (`financial_monthly_cleans`, `financial_task_load`)

**Files:**
- Create: `supabase/migrations/20260627_financial_dedup_views.sql`

**Interfaces:**
- Produces (read by Task 6 hook):
  - View `financial_monthly_cleans(month text /* 'YYYY-MM' */, cleans bigint)` — deduped monthly clean counts, trailing 12 months, `<= current_date`.
  - View `financial_task_load(bucket text /* 'overdue'|'today'|'week' */, tasks bigint)` — current open task counts, deduped.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260627_financial_dedup_views.sql`:

```sql
-- Property-level single-source dedup for cleans/tasks across Breezeway + Trellis.
-- A property is counted from Breezeway if it has ANY breezeway_tasks rows;
-- otherwise from Trellis. Never both. (Breezeway is system-of-record.)

create or replace view financial_breezeway_property_ids as
  select distinct property_id from breezeway_tasks where property_id is not null;

-- Monthly cleans, deduped, trailing 12 months, no future dates.
create or replace view financial_monthly_cleans as
with bz as (
  select to_char(date_trunc('month', coalesce(completed_date, due_date)), 'YYYY-MM') as month,
         count(*) as cleans
  from breezeway_tasks
  where is_clean = true
    and coalesce(completed_date, due_date) is not null
    and coalesce(completed_date, due_date) <= current_date
    and coalesce(completed_date, due_date) >= (current_date - interval '12 months')
  group by 1
),
-- Trellis cleans ONLY for properties absent from Breezeway (Trellis-only).
trel as (
  select to_char(date_trunc('month', t.scheduled_date), 'YYYY-MM') as month,
         count(*) as cleans
  from trellis_task_snapshot t
  join properties p on p.trellis_id = t.trellis_property_id::text
  where t.department_name ilike '%clean%'
    and t.scheduled_date is not null
    and t.scheduled_date <= current_date
    and t.scheduled_date >= (current_date - interval '12 months')
    and p.id not in (select property_id from financial_breezeway_property_ids)
  group by 1
)
select month, sum(cleans)::bigint as cleans
from (select * from bz union all select * from trel) u
group by month
order by month;

-- Current open task load, deduped (same single-source rule).
create or replace view financial_task_load as
with bz as (
  select
    count(*) filter (where due_date < current_date) as overdue,
    count(*) filter (where due_date = current_date) as today,
    count(*) filter (where due_date > current_date and due_date <= current_date + interval '7 days') as week
  from breezeway_tasks
  where is_clean = true and status is distinct from 'Completed' and due_date is not null
),
trel as (
  select
    count(*) filter (where t.scheduled_date < current_date) as overdue,
    count(*) filter (where t.scheduled_date = current_date) as today,
    count(*) filter (where t.scheduled_date > current_date and t.scheduled_date <= current_date + interval '7 days') as week
  from trellis_task_snapshot t
  join properties p on p.trellis_id = t.trellis_property_id::text
  where t.department_name ilike '%clean%'
    and t.completed_at is null
    and t.scheduled_date is not null
    and p.id not in (select property_id from financial_breezeway_property_ids)
)
select 'overdue' as bucket, (bz.overdue + trel.overdue)::bigint as tasks from bz, trel
union all select 'today', (bz.today + trel.today)::bigint from bz, trel
union all select 'week', (bz.week + trel.week)::bigint from bz, trel;

grant select on financial_monthly_cleans, financial_task_load, financial_breezeway_property_ids to authenticated;
```

- [ ] **Step 2: Apply the migration**

Apply via Supabase MCP `apply_migration` (name `financial_dedup_views`) or `supabase db push`.

- [ ] **Step 3: Verify dedup correctness with SQL assertions**

Run these and confirm:
```sql
-- Deduped universe should be 182 (114 breezeway + 68 trellis-only), NOT 289.
select count(*) from (
  select property_id from financial_breezeway_property_ids
  union
  select p.id from trellis_task_snapshot t join properties p on p.trellis_id = t.trellis_property_id::text
) u;  -- expect 182

-- Monthly cleans present for trailing 12 months, no future months:
select * from financial_monthly_cleans;            -- months <= current month only
select * from financial_task_load;                  -- 3 rows: overdue/today/week
```
Expected: union count = 182; `financial_monthly_cleans` rows are all `<= ` current month; `financial_task_load` returns exactly 3 buckets.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260627_financial_dedup_views.sql
git commit -m "feat(financials): deduped monthly-cleans + task-load views (property single-source)"
```

---

### Task 2: vitest setup + `format.ts`

**Files:**
- Modify: `package.json` (add `vitest` devDep + `"test": "vitest run"` script)
- Create: `vitest.config.ts`
- Create: `client/src/lib/financials/format.ts`
- Test: `client/src/lib/financials/format.test.ts`

**Interfaces:**
- Produces: `fmtCurrency(n: number | null): string`, `fmtPct(n: number | null, digits?: number): string`, `fmtDelta(curr: number | null, prev: number | null): { text: string; dir: 'up' | 'down' | 'flat' }`. All return `'—'` for null/NaN.

- [ ] **Step 1: Add vitest**

```bash
npm i -D vitest
```
Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import path from 'path'
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'client/src'), '@shared': path.resolve(__dirname, 'shared') } },
  test: { environment: 'node', include: ['client/src/**/*.test.ts'] },
})
```

- [ ] **Step 3: Write the failing test** — `client/src/lib/financials/format.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { fmtCurrency, fmtPct, fmtDelta } from './format'

describe('format', () => {
  it('formats currency and handles null', () => {
    expect(fmtCurrency(1234.5)).toBe('$1,235')
    expect(fmtCurrency(null)).toBe('—')
  })
  it('formats percent and handles null', () => {
    expect(fmtPct(12.345, 1)).toBe('12.3%')
    expect(fmtPct(null)).toBe('—')
  })
  it('computes delta direction', () => {
    expect(fmtDelta(110, 100).dir).toBe('up')
    expect(fmtDelta(90, 100).dir).toBe('down')
    expect(fmtDelta(100, null).dir).toBe('flat')
  })
})
```

- [ ] **Step 4: Run, expect FAIL** — `npx vitest run client/src/lib/financials/format.test.ts` → fails (module missing).

- [ ] **Step 5: Implement `format.ts`**

```ts
export function fmtCurrency(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}
export function fmtPct(n: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `${n.toFixed(digits)}%`
}
export function fmtDelta(curr: number | null, prev: number | null): { text: string; dir: 'up' | 'down' | 'flat' } {
  if (curr == null || prev == null || prev === 0 || Number.isNaN(curr) || Number.isNaN(prev)) return { text: '—', dir: 'flat' }
  const pct = ((curr - prev) / Math.abs(prev)) * 100
  const dir = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat'
  return { text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, dir }
}
```

- [ ] **Step 6: Run, expect PASS** — `npx vitest run client/src/lib/financials/format.test.ts` → passes.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts client/src/lib/financials/format.ts client/src/lib/financials/format.test.ts
git commit -m "test(financials): add vitest + format helpers"
```

---

### Task 3: `qbo.ts` — parse QBO monthly P&L

**Files:**
- Create: `client/src/lib/financials/qbo.ts`
- Test: `client/src/lib/financials/qbo.test.ts`

**Interfaces:**
- Consumes: raw `app_settings.qbo_pl_data` parsed JSON (object).
- Produces:
  - `type QboMonth = { ym: string; income: number; cogs: number; expenses: number; totalExpenses: number; netIncome: number; marginPct: number | null }`
  - `parseQboMonthly(raw: any): { months: QboMonth[]; updatedAt: string | null; connected: boolean }` — `months` sorted ascending by `ym`, `"Mon YYYY"` keys converted to `"YYYY-MM"`; `totalExpenses = cogs + expenses`; `marginPct = netIncome/income*100` or null.

- [ ] **Step 1: Write the failing test** — `qbo.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { parseQboMonthly } from './qbo'

const raw = {
  updated_at: '2026-06-27T12:00:00Z',
  monthly: {
    'Jan 2026': { income: 70849.75, cogs: 60675.01, expenses: 1802.88, netIncome: 8371.86 },
    'Jun 2026': { income: 130399.52, cogs: 99736.97, expenses: 1747.24, netIncome: 28915.31 },
  },
}

describe('parseQboMonthly', () => {
  it('normalizes keys to YYYY-MM, sorts, computes totals/margin', () => {
    const { months, connected, updatedAt } = parseQboMonthly(raw)
    expect(connected).toBe(true)
    expect(updatedAt).toBe('2026-06-27T12:00:00Z')
    expect(months[0].ym).toBe('2026-01')
    expect(months[1].ym).toBe('2026-06')
    expect(months[1].totalExpenses).toBeCloseTo(101484.21, 2)
    expect(months[1].marginPct).toBeCloseTo(22.17, 1)
  })
  it('handles missing blob', () => {
    expect(parseQboMonthly(null)).toEqual({ months: [], updatedAt: null, connected: false })
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `qbo.ts`**

```ts
export type QboMonth = {
  ym: string; income: number; cogs: number; expenses: number
  totalExpenses: number; netIncome: number; marginPct: number | null
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function toYm(key: string): string | null {
  const m = key.match(/^([A-Za-z]{3})\s+(\d{4})$/)
  if (!m) return /^\d{4}-\d{2}$/.test(key) ? key : null
  const idx = MONTHS.indexOf(m[1])
  if (idx < 0) return null
  return `${m[2]}-${String(idx + 1).padStart(2, '0')}`
}
export function parseQboMonthly(raw: any): { months: QboMonth[]; updatedAt: string | null; connected: boolean } {
  if (!raw || typeof raw !== 'object' || !raw.monthly) return { months: [], updatedAt: null, connected: false }
  const months: QboMonth[] = []
  for (const [key, v] of Object.entries(raw.monthly as Record<string, any>)) {
    const ym = toYm(key); if (!ym) continue
    const income = Number(v.income ?? v.totalIncome ?? 0)
    const cogs = Number(v.cogs ?? v.totalCOGS ?? 0)
    const expenses = Number(v.expenses ?? v.totalExpenses ?? 0)
    const netIncome = Number(v.netIncome ?? income - cogs - expenses)
    months.push({ ym, income, cogs, expenses, totalExpenses: cogs + expenses, netIncome,
      marginPct: income ? (netIncome / income) * 100 : null })
  }
  months.sort((a, b) => a.ym.localeCompare(b.ym))
  return { months, updatedAt: raw.updated_at ?? null, connected: months.length > 0 }
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `git commit -m "test(financials): QBO monthly P&L parser"`

---

### Task 4: `perClean.ts` — unit economics + 12-month axis join

**Files:**
- Create: `client/src/lib/financials/perClean.ts`
- Test: `client/src/lib/financials/perClean.test.ts`

**Interfaces:**
- Consumes: `QboMonth[]` (Task 3); `Array<{ month: string; cleans: number }>` (from `financial_monthly_cleans`).
- Produces:
  - `type MonthRow = { ym: string; income: number; totalExpenses: number; netIncome: number; marginPct: number | null; cleans: number; revPerClean: number | null; costPerClean: number | null }`
  - `buildMonthlySeries(qbo: QboMonth[], cleans: Array<{month:string;cleans:number}>, monthsBack = 12): MonthRow[]` — zero-filled trailing-`monthsBack` axis ending at the latest QBO month; joins cleans by `ym`; per-clean = value/cleans or null when cleans===0.
  - `lastTwo(series: MonthRow[]): { curr: MonthRow | null; prev: MonthRow | null }`

- [ ] **Step 1: Write the failing test** — `perClean.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { buildMonthlySeries } from './perClean'

const qbo = [
  { ym: '2026-05', income: 142235.52, cogs: 127773.65, expenses: 2257.96, totalExpenses: 130031.61, netIncome: 12203.91, marginPct: 8.58 },
  { ym: '2026-06', income: 130399.52, cogs: 99736.97, expenses: 1747.24, totalExpenses: 101484.21, netIncome: 28915.31, marginPct: 22.17 },
]
describe('buildMonthlySeries', () => {
  it('joins cleans and computes per-clean economics', () => {
    const s = buildMonthlySeries(qbo as any, [{ month: '2026-06', cleans: 305 }], 2)
    const jun = s.find(r => r.ym === '2026-06')!
    expect(jun.cleans).toBe(305)
    expect(jun.revPerClean).toBeCloseTo(427.54, 1)
    const may = s.find(r => r.ym === '2026-05')!
    expect(may.cleans).toBe(0)
    expect(may.revPerClean).toBeNull()  // divide-by-zero guard
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `perClean.ts`**

```ts
import type { QboMonth } from './qbo'
export type MonthRow = {
  ym: string; income: number; totalExpenses: number; netIncome: number; marginPct: number | null
  cleans: number; revPerClean: number | null; costPerClean: number | null
}
export function buildMonthlySeries(qbo: QboMonth[], cleans: Array<{ month: string; cleans: number }>, monthsBack = 12): MonthRow[] {
  if (qbo.length === 0) return []
  const cleanMap = new Map(cleans.map(c => [c.month, c.cleans]))
  const qboMap = new Map(qbo.map(q => [q.ym, q]))
  const end = qbo[qbo.length - 1].ym
  const [ey, em] = end.split('-').map(Number)
  const rows: MonthRow[] = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(ey, em - 1 - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const q = qboMap.get(ym)
    const cl = cleanMap.get(ym) ?? 0
    rows.push({
      ym, income: q?.income ?? 0, totalExpenses: q?.totalExpenses ?? 0, netIncome: q?.netIncome ?? 0,
      marginPct: q?.marginPct ?? null, cleans: cl,
      revPerClean: cl > 0 && q ? q.income / cl : null,
      costPerClean: cl > 0 && q ? q.totalExpenses / cl : null,
    })
  }
  return rows
}
export function lastTwo(series: MonthRow[]) {
  return { curr: series[series.length - 1] ?? null, prev: series[series.length - 2] ?? null }
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `git commit -m "test(financials): per-clean unit economics + 12mo series"`

---

### Task 5: Extend Ramp endpoint with monthly + category aggregation

**Files:**
- Modify: `api/ramp/spend.ts`

**Interfaces:**
- Produces (HTTP `GET /api/ramp/spend?months=12`): existing fields PLUS `byMonth: Array<{ month: string; total: number }>`, `byCategory: Array<{ category: string; total: number }>`, `windowMonths: number`. Backward compatible (existing `totalSpend`/`topCategories` retained).

- [ ] **Step 1: Read current `api/ramp/spend.ts`** to confirm the token + pagination pattern and the transaction field names (do not change auth).

- [ ] **Step 2: Implement aggregation** — replace the 30-day `from_date` with the N-month window and add aggregation before the response:

```ts
const months = Math.min(Number(req.query.months) || 12, 12)
const since = new Date(); since.setMonth(since.getMonth() - months); since.setDate(1)
// in the fetch loop, use: from_date = since.toISOString().slice(0,10)
const byMonthMap = new Map<string, number>()
const byCatMap = new Map<string, number>()
for (const t of allTransactions) {
  const d = (t.user_transaction_time || t.transaction_time || '').slice(0, 10)
  if (!d) continue
  const ym = d.slice(0, 7)
  const amt = Number(t.amount) || 0
  byMonthMap.set(ym, (byMonthMap.get(ym) || 0) + amt)
  const cat = t.sk_category_name || t.category_name || 'Uncategorized'
  byCatMap.set(cat, (byCatMap.get(cat) || 0) + amt)
}
const byMonth = [...byMonthMap.entries()].map(([month, total]) => ({ month, total })).sort((a,b)=>a.month.localeCompare(b.month))
const byCategory = [...byCatMap.entries()].map(([category, total]) => ({ category, total })).sort((a,b)=>b.total-a.total).slice(0, 8)
// add byMonth, byCategory, windowMonths: months to the existing res.json({...})
```
(Confirm `allTransactions` accumulates all pages; if the existing var differs, use it.)

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit --skipLibCheck --module nodenext --moduleResolution nodenext --target es2022 --types node api/ramp/spend.ts` → no errors.

- [ ] **Step 4: Commit** — `git commit -m "feat(ramp): monthly + category spend aggregation (12mo window)"`

---

### Task 6: Overview data hook `useFinancialOverview`

**Files:**
- Create: `client/src/hooks/use-financial-overview.ts`

**Interfaces:**
- Consumes: `parseQboMonthly` (T3), `buildMonthlySeries` (T4), the two views (T1), the Ramp endpoint (T5).
- Produces: `useFinancialOverview()` returning `{ series: MonthRow[]; taskLoad: {overdue:number;today:number;week:number} | null; ramp: {byMonth; byCategory; windowMonths} | null; qboUpdatedAt: string | null; qboConnected: boolean; isLoading: boolean; isError: boolean; refetch: () => void }`.

- [ ] **Step 1: Implement the hook**

```ts
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { parseQboMonthly } from '@/lib/financials/qbo'
import { buildMonthlySeries } from '@/lib/financials/perClean'

async function authFetch(path: string) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return null
  const r = await fetch(path, { headers: { Authorization: `Bearer ${session.access_token}` } })
  return r.ok ? r.json() : null
}

export function useFinancialOverview() {
  const q = useQuery({
    queryKey: ['/financial-overview'],
    staleTime: 300_000,
    queryFn: async () => {
      const [cleansRes, qboRes, taskRes, ramp] = await Promise.all([
        supabase.from('financial_monthly_cleans').select('month, cleans'),
        supabase.from('app_settings').select('value').eq('key', 'qbo_pl_data').single(),
        supabase.from('financial_task_load').select('bucket, tasks'),
        authFetch('/api/ramp/spend?months=12'),
      ])
      const cleans = (cleansRes.data ?? []) as Array<{ month: string; cleans: number }>
      const rawQbo = qboRes.data?.value ? (typeof qboRes.data.value === 'string' ? JSON.parse(qboRes.data.value) : qboRes.data.value) : null
      const qbo = parseQboMonthly(rawQbo)
      const series = buildMonthlySeries(qbo.months, cleans, 12)
      const tl = (taskRes.data ?? []) as Array<{ bucket: string; tasks: number }>
      const taskLoad = tl.length ? { overdue: 0, today: 0, week: 0, ...Object.fromEntries(tl.map(r => [r.bucket, Number(r.tasks)])) } as any : null
      return { series, taskLoad, ramp, qboUpdatedAt: qbo.updatedAt, qboConnected: qbo.connected }
    },
  })
  return { ...(q.data ?? { series: [], taskLoad: null, ramp: null, qboUpdatedAt: null, qboConnected: false }), isLoading: q.isLoading, isError: q.isError, refetch: q.refetch }
}
```

- [ ] **Step 2: Typecheck** — `npm run check` → EXIT 0.

- [ ] **Step 3: Commit** — `git commit -m "feat(financials): useFinancialOverview data hook"`

---

### Task 7: Overview page `financial-overview.tsx`

**Files:**
- Create: `client/src/pages/financial-overview.tsx`

**Interfaces:**
- Consumes: `useFinancialOverview` (T6), `fmtCurrency`/`fmtPct`/`fmtDelta` (T2), `lastTwo` (T4).
- Produces: `export default function FinancialOverviewPage()`.

- [ ] **Step 1: Implement the page.** Structure (reuse shell + recharts `ComposedChart`):
  - `usePageTitle('Financial Overview')`; `const o = useFinancialOverview()`; `const { curr, prev } = lastTwo(o.series)`.
  - `PageContainer width="full" className="md:h-full md:flex md:flex-col"` → `PageHeader` title "Financial Overview", subtitle "QuickBooks actuals, clean throughput, and card spend — last 12 months." `actions`: a freshness chip showing `o.qboUpdatedAt` (or "QuickBooks not connected" when `!o.qboConnected`).
  - **KPI tiles** (`StatCard`, grid `grid-cols-2 lg:grid-cols-3 xl:grid-cols-6`): Revenue `fmtCurrency(curr?.income ?? null)` + `fmtDelta(curr?.income ?? null, prev?.income ?? null)` as subtitle; Expenses `fmtCurrency(curr?.totalExpenses ?? null)`; Net income `fmtCurrency(curr?.netIncome ?? null)`; Margin `fmtPct(curr?.marginPct ?? null)`; Cleans `String(curr?.cleans ?? '—')`; Revenue/clean `fmtCurrency(curr?.revPerClean ?? null)`. When `o.taskLoad`: a tile "Tasks due" value `${o.taskLoad.today + o.taskLoad.overdue}` subtitle `${o.taskLoad.overdue} overdue`.
  - **Margin trend** (`ResponsiveContainer h=280` + `ComposedChart data={o.series}`): `XAxis dataKey="ym"`, left `YAxis`, right `YAxis yAxisId="right"`, `Bar dataKey="income" name="Revenue"`, `Bar dataKey="totalExpenses" name="Expenses"`, `Line yAxisId="right" dataKey="marginPct" name="Margin %"`, `Tooltip`, `Legend`.
  - **Throughput** (`ComposedChart data={o.series}`): `Bar dataKey="cleans" name="Cleans"` + `Line yAxisId="right" dataKey="revPerClean" name="Rev/clean"`.
  - **Ramp panel**: caption exactly "Ramp card spend — already included within QuickBooks expenses; shown here by category." Render `o.ramp.byCategory` rows (category + `fmtCurrency(total)`); if `!o.ramp` show a muted "Ramp not connected" notice. Never add to QBO.
  - **States:** `o.isError` → `<ErrorState onRetry={o.refetch} />` in place of charts; `o.isLoading` → `Skeleton` tiles + chart placeholders; `!o.qboConnected && !o.isLoading` → a notice card "QuickBooks data not connected or stale — financial figures unavailable" above the (still-rendered) throughput/Ramp sections.
  - Footnote (`text-2xs text-muted-foreground`): "Clean & task counts are de-duplicated across Breezeway and Trellis (one source per property)."

- [ ] **Step 2: Typecheck + build** — `npm run check` → EXIT 0; `npm run build` → succeeds, emits a `financial-overview-*.js` chunk.

- [ ] **Step 3: Commit** — `git commit -m "feat(financials): Financial Overview page"`

---

### Task 8: Wire route + nav + retire Executive Summary

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/AppSidebar.tsx`

- [ ] **Step 1:** In `App.tsx`, point the financial-dashboard lazy import at the new page and redirect `/report`:

```tsx
const FinancialDashboardPage = lazyRetry(() => import("@/pages/financial-overview"));
// keep the existing /financial-dashboard route using FinancialDashboardPage.
// add (or repoint) the report route to redirect:
<Route path="/report">{() => { if (location.pathname === '/report') { window.history.replaceState(null, '', '/financial-dashboard'); } return <GuardedRoute viewId="financial-dashboard" component={FinancialDashboardPage} /> }}</Route>
```
(Confirm the old `RevenueReport`/`ReportPage` import for `/report` is removed if now unused.)

- [ ] **Step 2:** In `AppSidebar.tsx`, rename the Admin financial group label to "Financials", rename the Financial Dashboard item label to "Overview" (href stays `/financial-dashboard`), and remove the `{ title: 'Executive Summary', href: '/report', ... }` nav item.

- [ ] **Step 3:** Typecheck — `npm run check` → EXIT 0.

- [ ] **Step 4: Commit** — `git commit -m "feat(financials): route Overview at /financial-dashboard; retire Executive Summary"`

---

### Task 9: Refresh QBO to trailing 12 months + CLAUDE.md + verify + PR

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Refresh QBO `monthly`** to cover Jul 2025–Jun 2026 via the QuickBooks MCP (fetch monthly P&L; write the same-shaped blob into `app_settings.qbo_pl_data` with updated `updated_at`, preserving the `{ "Mon YYYY": {income,cogs,expenses,netIncome} }` shape). Verify: `select count(*) from jsonb_object_keys((value::jsonb)->'monthly') where key='qbo_pl_data';` shows 12 months.

- [ ] **Step 2: Update `CLAUDE.md`** — add `/financial-dashboard` = Financial Overview (admin) to the Pages table; note the `lib/financials` source-of-truth contract, the `financial_monthly_cleans`/`financial_task_load` dedup views (property single-source), and that `/report` (Executive Summary) is retired.

- [ ] **Step 3: Live verify (Playwright)** — log in (admin), open `/financial-dashboard`; confirm KPI tiles populate from QBO, both charts render 12 months, the Ramp panel shows categories (or a clean notice), the Trellis "tasks due" tile shows deduped counts, and visiting `/report` lands on the Overview. Clear the service worker first (this app caches an SW) before checking.

- [ ] **Step 4: Commit + open PR** — `git commit -m "docs(financials): document Overview + dedup views"`; push `claude/financial-overview`; open PR with summary + the dedup verification numbers.

---

## Self-Review Notes
- **Spec coverage:** shared layer (T2–T6), Overview page (T7), Ramp lens (T5), dedup property-single-source (T1, verified T1.S3), QBO-as-truth (T3/T7), retire Executive Summary (T8), QBO 12-month refresh (T9). ✓
- **Dedup correctness** has an explicit SQL assertion (union = 182) and a live check across A/B/C.
- **Divide-by-zero** guarded in `perClean` + tested.
- **No silent $0:** `qboConnected`/freshness notices in T7.
- **Out of scope (Phase 2/3):** Forecaster + Pro Forma hardening, Revenue Report retirement, North Star — not touched here.
