# Portal Merge — Phase 0: Hosting + Single Front Door

**Date:** 2026-06-26
**Status:** Design (awaiting review)
**Repo(s) touched:** `tendwell-ops` (primary), `tendwell-cleaning-co` (marketing link + redirect)

## Background

We are merging the two Tendwell web properties into one experience:

- **`tendwell-cleaning-co`** — Next.js 14 marketing site, live at `tendwellcleaningco.com`. Also contains a demo-only owner-portal scaffold under `/portal`.
- **`tendwell-ops`** — Vite + React (Wouter) SPA: the real CRM, staff dashboard, and a working owner portal. Currently served at the look-alike domain `tendwellcleaning.com` (no "co").

The end goal is one branded front door: the marketing site stays public-facing at the root domain, and a single "Portal" entry routes users to the ops app, which already does role-based routing (one login → staff get the dashboard, owners get the owner portal). The full feature port of the cleaning-co portal ideas into ops is a later, multi-phase effort.

**This spec covers Phase 0 only: the hosting/front-door consolidation.** It ships independently of any feature work and delivers the "one site" goal immediately.

### Confirmed decisions

1. Marketing Next.js site stays at the root domain `tendwellcleaningco.com`.
2. Ops is served at the subdomain **`app.tendwellcleaningco.com`**.
3. One login, role/permission-based access (already how ops works — no auth-model change).
4. Owner login stays email/password; staff stay Google OAuth.
5. **`app.tendwellcleaningco.com` becomes the single canonical host for ops.** The old `tendwellcleaning.com` 301-redirects to it, and ops' `SITE_URL` + email link targets are updated to the new domain.
6. The cleaning-co demo `/portal` is retired via 301 redirect to `https://app.tendwellcleaningco.com` (demo code deleted in a later cleanup, not this phase).

## Goal / success criteria

- Visiting `https://app.tendwellcleaningco.com` serves the ops app over HTTPS.
- Staff (Google OAuth) and owners (email/password) can both sign in on the new host; password-reset links land on the new host and work.
- The marketing site has a visible "Portal" link that lands on the new host.
- `tendwellcleaning.com` (and `www.`) 301-redirect to `https://app.tendwellcleaningco.com`.
- `tendwellcleaningco.com/portal` 301-redirects to `https://app.tendwellcleaningco.com`.
- Notification emails link to the new host, and the notify ctaUrl allowlist accepts it.
- No regression: existing bookmarks/email links to the old domain still resolve (via redirect).

## Units of work

Each unit is independently verifiable. Units marked **[MANUAL]** require Jordan (external dashboards Claude can't reach); the rest Claude executes.

### 1. Vercel — attach the subdomain to ops
- Add domain `app.tendwellcleaningco.com` to the `tendwell-ops` Vercel project.
- Vercel issues the DNS target (expected `CNAME → cname.vercel-dns.com`) and provisions the TLS cert once DNS resolves.
- Depends on: unit 2 (DNS) before the cert validates.

### 2. **[MANUAL]** Slamdot DNS — create the subdomain record
- DNS for `tendwellcleaningco.com` is hosted at Slamdot (`ns1/ns2.slamdot.com`), not Vercel.
- Add a record for `app` per Vercel's instruction: a `CNAME app → cname.vercel-dns.com` (or the A record Vercel specifies if a CNAME at that label isn't accepted).
- Owner: Jordan (or whoever holds the Slamdot login). This is the gating external step.

### 3. Supabase Auth — allow the new host *(the core Supabase consideration)*
- Project `eetsudoksvsmwtiqraot` (Tendwell Property Operations).
- Add `https://app.tendwellcleaningco.com` (and its `/reset-password` callback path as needed) to the Auth **redirect allow-list**, and set/keep the **Site URL** appropriately so OAuth + recovery emails point at the canonical host.
- Without this, Google OAuth sign-in and password-reset links break on the new host (redirect-mismatch error). This is the single most important correctness item in Phase 0.

### 4. **[MANUAL]** Google OAuth — authorized redirect URIs
- In Google Cloud console for the OAuth client used by Supabase Auth, ensure the Supabase callback domain is authorized (Supabase proxies the OAuth callback, so this is usually already correct), and add `https://app.tendwellcleaningco.com` to authorized JavaScript origins if the client lists explicit origins.
- Owner: Jordan (Google Cloud console). Verify during testing; only act if OAuth fails on the new host.

### 5. Ops — canonicalize to the new host
- Update `SITE_URL` / hardcoded link bases from `https://www.tendwellcleaning.com` to `https://app.tendwellcleaningco.com` in:
  - `api/notify/invite.ts` (`SITE_URL`)
  - `api/notify/digest.ts`, `api/notify/test.ts`, `api/notify/public.ts` (ctaUrls)
  - `client/src/pages/issues.tsx`, `client/src/pages/tasks.tsx`, `client/src/pages/laundry-weigh-ins.tsx` (ctaUrl / FORM_URL)
- Update the notify ctaUrl/origin allowlist in `api/notify/_lib.ts` (currently lists `www.tendwellcleaning.com` / `tendwellcleaning.com`) to include `app.tendwellcleaningco.com`. Keep the old entries during transition so in-flight links still validate.
- `docs/breezeway-agent-instructions.md` references the old domain in curl examples — update for accuracy (docs only, non-functional).

### 6. Ops — redirect the old domain
- Add `app.tendwellcleaningco.com` as the primary domain and configure `tendwellcleaning.com` + `www.tendwellcleaning.com` to 301-redirect to it (Vercel domain redirect on the ops project, or a `vercel.json` redirect — prefer the Vercel domain-level redirect to avoid SPA hash-routing edge cases).
- Verify no redirect loop with the SPA hash routes (`/#/...`).

### 7. Marketing — add the "Portal" link
- Add a "Portal" nav item linking to `https://app.tendwellcleaningco.com` in the cleaning-co site, sourced through the content/nav layer (`src/lib/site.ts` + `Header.tsx`/`Footer.tsx`) per that repo's "one source of truth" convention.
- No em dashes (brand rule). Use the shared `LinkButton`/nav patterns; don't hand-roll markup.

### 8. Marketing — retire the demo `/portal`
- Add a 301 redirect `/portal` (and `/portal/:path*`) → `https://app.tendwellcleaningco.com` in `next.config.mjs`.
- Leave the demo code in place for now; deletion is a separate later cleanup.

## Data flow / behavior

- **Auth (OAuth):** user hits `app.tendwellcleaningco.com` → ops login → Supabase Auth → Google → Supabase callback → redirect back to `app.tendwellcleaningco.com`. Requires unit 3 (and possibly 4) so the return URL is allow-listed.
- **Auth (owner password + recovery):** reset email link uses the Supabase Site URL → must point to the new host's `/reset-password` route.
- **Email ctaUrls:** notify emails now render links to `app.tendwellcleaningco.com`; `_lib.ts` allowlist must accept that origin or links are stripped/blocked.
- **Old links:** any existing email or bookmark to `tendwellcleaning.com/#/...` → 301 to the new host, preserving the path/hash where possible.

## Risks / opportunities for error

- **Auth redirect mismatch (highest):** forgetting unit 3 → users can't log in on the new host. Mitigation: do unit 3 before announcing the new host; test OAuth + recovery explicitly.
- **DNS propagation lag:** cert won't issue until the Slamdot record resolves. Mitigation: create DNS first, then verify in Vercel.
- **Redirect loop / hash-route breakage:** SPA uses hash routing; a naive catch-all redirect could mangle `/#/...`. Mitigation: use Vercel domain-level 301 (host-only), not a path rewrite; test a deep link.
- **ctaUrl allowlist:** if `_lib.ts` allowlist isn't updated, new-domain links get stripped from emails. Mitigation: unit 5 updates it; keep old entries too.
- **Domain look-alike confusion:** `tendwellcleaning.com` vs `tendwellcleaningco.com` are easy to mix up. The redirect (unit 6) collapses them to one canonical host, reducing this risk going forward.
- **Two Vercel projects, two deploys:** marketing changes (units 7-8) deploy on the cleaning-co project; ops changes (units 5-6) on the ops project. Sequence so neither half points at a host that isn't live yet.

## Testing / verification

1. `dig +short app.tendwellcleaningco.com` resolves to Vercel after unit 2.
2. `curl -I https://app.tendwellcleaningco.com` → 200, valid TLS.
3. Sign in as staff (Google) on the new host → lands on dashboard.
4. Sign in as an owner (email/password) on the new host → lands on owner portal.
5. Trigger a password reset → email link opens `app.tendwellcleaningco.com/#/reset-password` (or equivalent) and completes.
6. `curl -I https://tendwellcleaning.com` and `https://www.tendwellcleaning.com` → 301 to the new host.
7. `curl -I https://tendwellcleaningco.com/portal` → 301 to the new host.
8. Send a test notification (`/api/notify/test`) → email link points to the new host and is clickable (not stripped).
9. Marketing site shows the "Portal" link and it navigates to the new host.
10. `npm run check` (ops) and `npm run build` (marketing) pass.

## Rollback

- Removing the `app` DNS record / detaching the Vercel domain reverts the new host with no data impact (no schema changes in this phase).
- The old-domain redirect and link/allowlist edits are revertible via git; the old domain can be restored as a live ops host by removing the redirect.
- Supabase Auth allow-list additions are additive and harmless to leave in place on rollback.

## Out of scope (later phases)

- Branded portal shell / dashboard reskin (Phase 1).
- Owner-facing features: quotes, onboarding wizard, shipments view, referrals, testimonials, feedback (Phases 2-7).
- Owner notifications (cross-cutting).
- Deleting the cleaning-co `/portal` demo code (later cleanup).
