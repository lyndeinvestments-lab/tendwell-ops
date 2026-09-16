# Tendwell Ops — Improvement Log

Session: 2026-09-15 (improve/ops-audit-2026-09-15)

## Baseline (verified before changes)

| Check | Result |
|---|---|
| `npm run check` (tsc) | Pass |
| `npm test` (vitest) | 320 passed |
| Git | `main` @ `5f4bfc4`, clean |
| Production | `https://app.tendwellcleaningco.com/login` → HTTP 200 |
| Local `.env` | Pulled from Vercel development |
| E2E auth fixture | Missing (`tests/.auth/`) — authenticated browser journeys unverified this session |
| Supabase MCP / DB push | Unavailable (no interactive auth / no DB password) |

### Product context (from repo evidence)

Staff ops + CRM dashboard for Tendwell Cleaning Co. (STR property cleaning). Roles: admin/operations/cleaning/inspector/viewer/owner. Core journeys: pipeline stage moves, invoicing reconcile/approve, issues, owner portal, Trellis/Breezeway sync.

## Significant findings → fixes

| Sev | Finding | Evidence | Fix |
|---|---|---|---|
| Critical | Human “Exclude” on invoice lines undone by re-reconcile | `reconcileRun` preserved only `resolved`/`manual` | Preserve `excluded`; set `line_kind: 'excluded'` on exclude |
| High | CRM views lack explicit `is_staff()` guard | Bounty #574 flagged only | Migration `20260915_crm_views_staff_guard.sql` (**apply to live DB**) |
| High | Agreement template fetch used request `Host` | SSRF / content substitution into signed PDF hash | Load bundled PDF / allowlisted origin only |
| High | Spoofable leftmost XFF in e-sign audit IP | `sign.ts` | Prefer `x-vercel-forwarded-for` / rightmost XFF |
| High | Stage move succeeded while workflow tasks silently failed | `.catch(() => {})` in `stage-transition` | Await + surface warning toast |
| High | UTC day-shift on “today” writes/comparisons | `toISOString().split('T')[0]` | `localISODate()` on issues, alerts, verifications, workflow dues, pipeline follow-up |
| Medium | Add/edit invoice line swallowed reconcile failures | `.catch(() => {})` then success toast | Await reconcile; fail the mutation on error |
| Medium | Inspection share leaked internal errors | `err.message` to client | Generic `Server error` |
| Medium | Issue share photo URL accepted any `*.supabase.co` | Stored XSS / phishing risk | Allowlist project host + `issue-photos` path |
| Medium | `agreement_config` readable by all staff | Signature PNG exposure | Admin-only RLS in same migration |
| Medium | Reset password form shown without recovery session | `/reset-password` open | Gate on `isPasswordRecovery`; marketing-auth styling |
| Medium | Login muted text contrast + 148KB 3200px logo | Lighthouse/manual a11y | Darken to `#6B5A45`; 480w WebP (~6KB); `role="alert"` |

## Verification (this branch)

| Check | Result |
|---|---|
| `npm run check` | Run after edits |
| `npm test` | Includes new preserve-line / local-date / photo-url / audit-IP tests |
| Browser (prod login/reset) | Pre-fix audit screenshots on disk; post-fix local verify pending |
| Migration applied to production | **Not applied this session** — requires Supabase SQL/dashboard |
| Authenticated E2E | **Not run** — no `tests/.auth/admin.json` |
| Lighthouse field CWV | **Unavailable** — lab-only not re-run post-fix on production build |

## Remaining issues / decisions needed

1. **Apply** `supabase/migrations/20260915_crm_views_staff_guard.sql` in production Supabase (HIGH until applied). Uses `crm_caller_allowed()` so staff **and** service-role/MCP keep access; owners still get zero rows.
2. Authenticated E2E: run `npm run test:e2e:auth` once, then wire CI optionally.
3. CRM write RPCs still gate on `is_staff()` not `can_edit('contacts')` — intentional until product decides view-only staff must be blocked server-side.
4. Login still may load chart vendor chunk via shared entry — not fully eliminated this pass.
5. Weekly CI schedule added in `.github/workflows/ci.yml` (Mondays); first scheduled run happens next Monday unless workflow_dispatch is added later.

## Recurring checks configured

- Replaced typecheck-only CI with `ci.yml`: typecheck + unit tests + build on PR/push, plus weekly cron.
- Existing `typecheck.yml` left in place (redundant but harmless); prefer consolidating later.
