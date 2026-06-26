# Portal Merge — Phase 0 Go-Live Runbook

**Companion to:** `2026-06-26-portal-merge-phase0-hosting-design.md`
**Status:** Prep done; waiting on DNS. Execute the steps below in order at go-live.

## What is already done (staged, NOT deployed)

- ✅ `app.tendwellcleaningco.com` attached to the **tendwell-ops** Vercel project (`vercel domains add`). Pending DNS verification.
- ✅ Ops link canonicalization committed to branch **`claude/portal-merge-phase0-spec`** (this branch): `SITE_URL`, email ctaUrls, `FORM_URL`, email footer link, breezeway doc examples → `app.tendwellcleaningco.com`; new host added to the notify CTA allowlist (legacy hosts kept for transition). `npm run check` passes. **Not merged.**
- ✅ Marketing "Portal" link + `/portal` 301 redirect committed to branch **`claude/portal-link-and-redirect`** in `tendwell-cleaning-co`. `npm run build` passes. **Not merged.**
- ✅ Phase 0 design spec committed (this branch).

Nothing above changes production until the branches are merged and the DNS/redirect steps below are taken.

## Go-live steps (in order)

### Step 1 — [JORDAN] Add the Slamdot DNS record *(gating)*
Nothing serves on the new host until this exists.

| Type | Host/Name | Value/Target | TTL |
|---|---|---|---|
| CNAME | `app` | `cname.vercel-dns.com` | default |

(If Slamdot rejects a CNAME at that label, use the A record Vercel shows in the ops project's Domains page instead.)

### Step 2 — [CLAUDE] Verify domain + TLS
Once DNS propagates (minutes): confirm `dig +short app.tendwellcleaningco.com` resolves and `curl -I https://app.tendwellcleaningco.com` returns 200 with a valid cert. Vercel issues the cert automatically once it sees the record.

### Step 3 — [JORDAN] Supabase Auth URL config *(make-or-break for login)*
Project `eetsudoksvsmwtiqraot` → Authentication → URL Configuration:
- Add `https://app.tendwellcleaningco.com/**` (and the reset-password route) to **Redirect URLs / allow-list**.
- At go-live, set **Site URL** to `https://app.tendwellcleaningco.com` so OAuth + password-reset emails point to the canonical host.
- (This is a dashboard step — not exposed via the Supabase MCP tools, so Claude can't do it programmatically.)

### Step 4 — [JORDAN] Google OAuth (only if staff login fails on new host)
Google Cloud console → the OAuth client used by Supabase. Supabase proxies the OAuth callback, so this is usually already correct. If Google sign-in errors on the new host, add `https://app.tendwellcleaningco.com` to Authorized JavaScript origins.

### Step 5 — [CLAUDE] Merge the ops link branch
Merge `claude/portal-merge-phase0-spec` → main (squash + delete-branch). Deploys the canonicalized email/link host + allowlist. Safe once Steps 2-3 are done.

### Step 6 — [CLAUDE] Redirect the old domain
On the ops Vercel project, set `tendwellcleaning.com` + `www.tendwellcleaning.com` to **301-redirect** to `https://app.tendwellcleaningco.com` (Vercel domain-level redirect — host-only, NOT a path rewrite, to avoid mangling the SPA `/#/` hash routes). Do this only AFTER Step 2 confirms the new host serves ops, or the old (currently live) domain breaks.

### Step 7 — [CLAUDE] Merge the marketing branch
Merge `claude/portal-link-and-redirect` in `tendwell-cleaning-co` → main (squash + delete-branch). Deploys the Portal nav link + `/portal` redirect. Safe once Step 2 confirms the host is live.

### Step 8 — [CLAUDE] Verification suite
1. `curl -I https://app.tendwellcleaningco.com` → 200.
2. Staff Google sign-in on the new host → dashboard.
3. Owner email/password sign-in on the new host → owner portal.
4. Password reset → email link opens the new host's reset route and completes.
5. `curl -I https://tendwellcleaning.com` and `https://www.tendwellcleaning.com` → 301 to new host.
6. `curl -I https://tendwellcleaningco.com/portal` → 301 to new host.
7. `POST /api/notify/test` → email link points to the new host and is clickable (not stripped by the allowlist).
8. Marketing site shows the Portal link and it navigates to the new host.

## Open item for Jordan's review before go-live
- The **Portal nav-link placement** (added as a text link before the "Book Audit" CTA, desktop + mobile) is a default choice — eyeball it on a preview deploy and adjust styling/placement if you want it to read more like a button.

## Rollback
- Detach the `app` domain / remove the DNS record → new host goes away, no data impact (no schema changes this phase).
- Revert the two branches' merges; remove the old-domain redirect to restore `tendwellcleaning.com` as the live ops host.
- Supabase allow-list additions are additive and harmless to leave.
