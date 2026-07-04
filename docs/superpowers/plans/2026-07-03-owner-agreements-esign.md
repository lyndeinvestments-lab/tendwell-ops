# Owner Portal E-Signature Agreements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Admin assigns the Cleaning Services Agreement to an owner (pre-signed by Tendwell); the owner reviews, fills their fields, draws a signature, and the completed, timestamped PDF is stored and downloadable from their portal. Owners with no assigned agreement see nothing. Mobile-optimized.

**Architecture:** New `owner_agreements` + admin-only `agreement_config` tables (RLS-enforced). Server endpoints (service role) generate the signed PDF with **pdf-lib** — filling page 1, stamping both signatures on page 5, and appending a Certificate of Completion — store it in a private `agreements` bucket, and record an ESIGN/UETA audit trail. Owner portal + admin Settings UIs; a dependency-free touch SignaturePad.

**Tech Stack:** React 18 + TS + Vite, TanStack Query, Supabase (Postgres + Auth + Storage), Vercel serverless, pdf-lib, Tailwind + Shadcn/ui.

## Global Constraints
- Authoritative design: `docs/superpowers/specs/2026-07-03-owner-agreements-esign-design.md`.
- Supabase project id `eetsudoksvsmwtiqraot`; migrations in `supabase/migrations/`; regenerate `shared/database.types.ts` via Supabase MCP after schema changes.
- Endpoints derive the subject from the caller's own session token (never client-supplied ids); mirror `api/owners/provision.ts` auth. The Tendwell signature is server-only and never returned to owners.
- Server timestamps only (`now()`); capture IP (x-forwarded-for) + user-agent; SHA-256 source + signed PDF.
- Tailwind + `cn()` only; Lucide icons only; toasts via `use-toast`; React Query. No em dashes in owner-facing copy.
- Mobile-first: touch signature pad (`touch-action:none`, pointer/touch events, DPR scaling), single-column full-width inputs, `text-base` inputs, large tap targets, PDF review via new tab (site sends `X-Frame-Options: DENY`, so no iframe).
- Verification per task: `npm run check` passes + task-specific checks. No unit-test harness for SQL/UI/endpoints; the PDF output is verified by generating a sample and reading it.

---

## File Structure
- `supabase/migrations/20260703_owner_agreements.sql` — tables, RLS, RPC, storage bucket + policies.
- `client/public/agreements/service-agreement-v1.pdf` — the template (committed).
- `api/agreements/_lib.ts` — shared: config/env, caller resolution, PDF generation (pdf-lib), hashing.
- `api/agreements/sign.ts`, `api/agreements/download.ts` — endpoints.
- `vercel.json` — `functions` includeFiles for `api/agreements/*.ts`.
- `client/src/lib/agreements.ts` — client fetch helpers + types.
- `client/src/components/SignaturePad.tsx` — touch signature pad.
- `client/src/pages/owner-portal.tsx` — `AgreementSection`.
- `client/src/pages/settings.tsx` — Agreements admin.
- `package.json` — add `pdf-lib`.
- `shared/database.types.ts`, `CLAUDE.md`.

---

## Task 1: Database migration

**Files:** Create `supabase/migrations/20260703_owner_agreements.sql`. Reference: `20260623_owner_portal.sql` (`is_staff()`, `current_owner_id()`, `current_auth_email()`), `20260401_security_rls.sql` (RLS style), an existing storage-policy migration if present (grep `storage.objects` / `buckets`).

**Interfaces produced:** tables `agreement_config`, `owner_agreements` (fields per spec); RPC `get_owner_agreement()`; private bucket `agreements`.

- [ ] **Step 1: Write the migration.**
  - `agreement_config` (single row, id int PK default 1 with `CHECK (id = 1)`, `tendwell_signer_name text, tendwell_signer_title text, tendwell_signature_png text, updated_at timestamptz default now()`). Enable RLS; policies: SELECT/INSERT/UPDATE restricted to `is_staff()` (no owner access). `INSERT INTO agreement_config (id) VALUES (1) ON CONFLICT DO NOTHING;`
  - `owner_agreements` with all columns from the spec's Database section. Enable RLS. Policies: staff ALL (`is_staff()`); owner SELECT own (`owner_id = current_owner_id()`). Index `idx_owner_agreements_owner ON owner_agreements(owner_id)`.
  - RPC `get_owner_agreement()` (SECURITY DEFINER, STABLE, `search_path=public`): if `current_owner_id()` is null return no row; else return the owner's single agreement as jsonb with: id, status, effective_date, owner_name, entity, mailing_address, property_addresses, email, phone, owner_printed_name, owner_title, owner_signed_at, tendwell_signer_name, tendwell_signer_title, tendwell_signed_at, created_at. (Do NOT return any signature image.) `REVOKE ALL FROM public; GRANT EXECUTE TO authenticated`.
  - Private storage bucket: `INSERT INTO storage.buckets (id, name, public) VALUES ('agreements','agreements',false) ON CONFLICT DO NOTHING;` No public policies (access is service-role only via endpoints). If the project requires an explicit staff read policy on `storage.objects` for this bucket, add one gated on `is_staff()`; owners never read storage directly.
- [ ] **Step 2: Apply** via Supabase MCP `apply_migration` (name `20260703_owner_agreements`). Fix + re-apply on error.
- [ ] **Step 3: Verify** via `execute_sql`: both tables exist; `agreement_config` has one row; `get_owner_agreement` in `pg_proc`; bucket `agreements` exists and `public=false`.
- [ ] **Step 4: Regenerate types** (`generate_typescript_types`) → overwrite `shared/database.types.ts`.
- [ ] **Step 5: `npm run check`** (expect pass; UI not yet using it).
- [ ] **Step 6: Commit** `feat(db): owner_agreements + agreement_config tables, RLS, get_owner_agreement RPC, agreements bucket`.

---

## Task 2: PDF generation core + template asset + dependency

**Files:** add `client/public/agreements/service-agreement-v1.pdf`; add `pdf-lib` to `package.json`; create `api/agreements/_lib.ts`; edit `vercel.json`.

**Interfaces produced:** `_lib.ts` exports: `getSupabaseConfig()`, `resolveOwnerFromToken(token)` → `{ authEmail, ownerId, ownerName } | null`, `loadTemplateBytes(host)` → `Uint8Array`, `sha256Hex(bytes)` → string, `dataUrlToPngBytes(dataUrl)` → `Uint8Array`, and `generateSignedPdf({ templateBytes, agreement, tendwell:{name,title,signaturePng,signedAt}, owner:{signaturePng,printedName,title,signedAt,ip,userAgent}, consentText })` → `Uint8Array`.

- [ ] **Step 1: Commit the template.** Copy the provided PDF to `client/public/agreements/service-agreement-v1.pdf` (source: `/Users/jordanlynde/Downloads/TendwellCleaningCo-ServiceAgreement.pdf`). Confirm it is 5 pages.
- [ ] **Step 2: Add dependency.** `npm install pdf-lib` (adds to package.json + lock).
- [ ] **Step 3: vercel.json.** Add to `functions`: `"api/agreements/*.ts": { "includeFiles": "api/agreements/_lib.ts" }`.
- [ ] **Step 4: Write `_lib.ts`.** Include:
  - Env/config + caller resolution copied from the raw-fetch pattern in `api/owners/provision.ts`/`change-email.ts` (GET `/auth/v1/user` with the caller token → email; then look up `property_owners` by email via service-role REST → id + name). Reuse that exact style.
  - `loadTemplateBytes(host)`: `fetch(\`https://${host}/agreements/service-agreement-v1.pdf\`)` → arrayBuffer → Uint8Array.
  - `sha256Hex`: Node `crypto.createHash('sha256')`.
  - `generateSignedPdf(...)` with pdf-lib:
    - `PDFDocument.load(templateBytes)`; embed `StandardFonts.Helvetica`.
    - Page 1 (`pages[0]`): draw party field values on the blank lines. US Letter is 612x792pt (origin bottom-left). Determine y-coordinates for Effective Date, Owner Name, Entity, Mailing Address, Property Address(es), Email, Phone by measuring the template (labels are known; draw the value just above each underscore line). START with estimated coordinates and refine in Step 5's sample check. Font size ~10-11.
    - Page 5 (`pages[4]`): embed Tendwell signature PNG (`embedPng`) above the Tendwell "Signature" line; draw Printed Name, Title, Date (formatted `MMM d, yyyy`). Embed owner signature PNG above the Owner "Signature" line; draw Printed Name, Title/Capacity, Date. Scale signatures to ~160x50pt preserving aspect.
    - Append a Certificate of Completion page (`addPage([612,792])`): title "Certificate of Completion"; agreement id; document name + template version; source & signed SHA-256; Tendwell signer name/title + signed timestamp; Owner name/email + signed timestamp + IP + user-agent; the consent statement. Helvetica, wrapped text.
    - Return `await doc.save()`.
- [ ] **Step 5: Sample-PDF verification.** Write a throwaway Node script (e.g. `scripts/_agreement-sample.mjs`, NOT committed) that reads the template and calls the pdf-lib logic with dummy party data + two small placeholder PNG signatures, writing `/tmp/agreement-sample.pdf`. Run it; report the path so the controller can read the PDF and confirm placement. Adjust coordinates until page-1 fields sit on their lines and page-5 signatures sit in the signature blocks. Remove the throwaway script before committing.
- [ ] **Step 6: `npm run check`** (types for _lib; Node runtime/crypto).
- [ ] **Step 7: Commit** `feat(agreements): pdf-lib signed-PDF generation core + template asset`.

---

## Task 3: Sign + download endpoints + client helpers

**Files:** `api/agreements/sign.ts`, `api/agreements/download.ts`, `client/src/lib/agreements.ts`.

**Interfaces produced:** `POST /api/agreements/sign`, `GET /api/agreements/download?id=`; client `signAgreement(payload)`, `getAgreementDownloadUrl(id)`.

- [ ] **Step 1: `sign.ts`** (owner-gated, service role). Resolve caller (from `_lib`); load the agreement by `agreementId` via service-role REST; assert `owner_id` matches the caller and `status='sent'`; require `consent===true` + non-empty `signatureDataUrl`. Load `agreement_config` (service role) for Tendwell signer name/title/signature; if signature missing → 409 "Agreement signer not configured." Compute source hash; call `generateSignedPdf`; upload to `agreements/signed/<id>.pdf` via storage REST (`POST /storage/v1/object/agreements/signed/<id>.pdf`, service key, `content-type: application/pdf`, `x-upsert: true`); compute signed hash; PATCH the row (owner block fields from body, `owner_signed_at=now`, ip = first x-forwarded-for, user_agent, hashes, `signed_pdf_path`, `status='signed'`, `consent_text`). Return `{ok:true}`. Surface REST/network failures as 500 (don't swallow).
- [ ] **Step 2: `download.ts`** (GET). Resolve caller; load agreement by `id`; allow if caller is the owner OR staff (look up `app_users` by email via service role); else 403; 404 if not yet signed. Create a signed URL: `POST /storage/v1/object/sign/agreements/signed/<id>.pdf` with `{ expiresIn: 300 }`; return `{ url }` (absolute Supabase URL).
- [ ] **Step 3: `agreements.ts`** client helpers mirroring `owners.ts` `getToken()` + fetch pattern: `signAgreement(payload): Promise<{ok:boolean,error?:string}>` (POST) and `getAgreementDownloadUrl(id): Promise<{ok:boolean,url?:string,error?:string}>` (GET). Export a `SignAgreementPayload` type with fields: `agreementId, signatureDataUrl, ownerName, entity, mailingAddress, propertyAddresses, email, phone, ownerPrintedName, ownerTitle, consent`.
- [ ] **Step 4: `npm run check`.**
- [ ] **Step 5: Commit** `feat(agreements): sign + download endpoints and client helpers`.

---

## Task 4: SignaturePad + owner portal AgreementSection (mobile-first)

**Files:** `client/src/components/SignaturePad.tsx`; `client/src/pages/owner-portal.tsx`.

**Interfaces consumed:** `get_owner_agreement()` RPC (Task 1), `signAgreement`/`getAgreementDownloadUrl` (Task 3). Produces: `<SignaturePad onChange={(dataUrl|null)=>...} />`; `AgreementSection` in the portal.

- [ ] **Step 1: SignaturePad.** Self-contained canvas component:
  - Props: `onChange(dataUrl: string | null)`, optional `className`, `height` (default 180).
  - Canvas full-width, DPR-scaled (`canvas.width = cssW*dpr`), `style={{ touchAction: 'none' }}`. Draw with `pointerdown/move/up` (covers mouse + touch); `setPointerCapture` on pointerdown. Stroke round cap/join, width ~2.5, foreground color. Track "hasInk"; call `onChange(canvas.toDataURL('image/png'))` on stroke end and `onChange(null)` on Clear. "Clear" button (Lucide `Eraser`), large tap target. Prevent default on touch to stop page scroll while drawing. Rescale/clear-preserving redraw on resize.
- [ ] **Step 2: AgreementSection.** Query `['owner-agreement']` → `supabase.rpc('get_owner_agreement')` (jsonb or null). Render:
  - null → `return null`.
  - `status==='sent'` → `Card` (border-primary/40) "Action needed: review & sign your Service Agreement". Body: an "Open agreement" link button (`<a href="/agreements/service-agreement-v1.pdf" target="_blank" rel="noopener noreferrer">`, Lucide `ExternalLink`); editable prefilled party fields (owner_name, entity, mailing_address, property_addresses, email, phone) via `Field`+`Input`/`Textarea`; owner printed name + title/capacity inputs; read-only "Date: <today>"; `<SignaturePad onChange={setSig} />`; a consent `<label>` + checkbox with the consent text; a full-width Sign button disabled until `sig && consent && !pending`. On submit call `signAgreement({ agreementId: a.id, signatureDataUrl: sig, ...fields, consent: true })`; success → invalidate `['owner-agreement']` + toast; error → destructive toast. Single-column, `text-base` inputs, full-width button.
  - `status==='signed'` → `Card` "Service Agreement" with "Signed on <formatDate(owner_signed_at)>" + a **Download PDF** button that calls `getAgreementDownloadUrl(a.id)` and opens the returned url in a new tab.
  - Render `{ownerId && <AgreementSection />}` near the top of `<main>`, after the Trellis card and before "Your properties".
- [ ] **Step 3: `npm run check`.**
- [ ] **Step 4: Manual (dev, owner test account + a seeded `sent` row):** card appears; Open opens the PDF; drawing works; Sign → flips to signed → Download opens the signed PDF; an owner with no row sees nothing.
- [ ] **Step 5: Commit** `feat(owner-portal): review + draw-to-sign agreement flow (mobile-first)`.

---

## Task 5: Admin Settings — signer config + assign

**Files:** `client/src/pages/settings.tsx` (reuse `SignaturePad`).

**Interfaces consumed:** `agreement_config` (staff RLS), `owner_agreements` (staff RLS), `property_owners`, `owner_properties`+`properties` (prefill), `getAgreementDownloadUrl`.

- [ ] **Step 1: `AgreementsSection` (admin).** Add a new Settings section/tab:
  - **Signer setup:** load `agreement_config` (id=1). Inputs for `tendwell_signer_name`, `tendwell_signer_title`, and a `SignaturePad` (show current signature preview via `<img>` if set; allow re-draw). Save → `update agreement_config set ... where id=1`. Toast.
  - **Send agreement:** pick an owner (searchable select from `property_owners`) → dialog prefilling party fields from the owner (name/email/phone) and their assigned properties (join `owner_properties`→`properties` for `property_addresses`; mailing_address editable), `effective_date` default today, Tendwell block from config (name/title) + `tendwell_signed_at=now`. Confirm → `insert into owner_agreements (...) values (... status 'sent')`. Guard: if `agreement_config.tendwell_signature_png` is empty, disable send + show "Set up your signature first."
  - **List:** existing `owner_agreements` (join owner name) with status badge + created date; for `signed`, a Download button (`getAgreementDownloadUrl`).
  - Register the section following the existing `OwnersSection` registration pattern.
- [ ] **Step 2: `npm run check`.**
- [ ] **Step 3: Manual (admin):** set signer + signature; send to the owner test account; row appears; send blocked when no signature configured.
- [ ] **Step 4: Commit** `feat(settings): agreement signer config + assign/send to owners`.

---

## Task 6: Docs, deploy, verification, merge

- [ ] **Step 1: CLAUDE.md** — document the feature: `owner_agreements` + `agreement_config` tables, `get_owner_agreement` RPC, `/api/agreements/sign` + `/api/agreements/download`, the private `agreements` bucket, `pdf-lib` dep, the template asset, owner-portal + Settings surfaces; add `20260703_owner_agreements.sql` to Recent Migrations; note owners see it only when assigned.
- [ ] **Step 2: Commit** `docs: CLAUDE.md for owner e-signature agreements`.
- [ ] **Step 3: Push + PR** (title "Owner portal: e-signature service agreements"; body summarizes the flow, links spec + plan, notes migration applied + `agreements` bucket).
- [ ] **Step 4: End-to-end verification (Vercel preview, owner + admin accounts):** configure signer; assign to a test owner; sign; download; confirm the PDF has page-1 fields, both page-5 signatures, and the certificate page (timestamps/IP/hash); confirm a non-assigned owner sees nothing; confirm mobile signing works (touch). Call out anything needing manual live verification.
- [ ] **Step 5: Merge** (squash + delete branch) once CI is green.

---

## Self-Review
- Assign (admin, pre-signed) → Task 5 + Task 1. ✓
- Owner review + fill fields + draw signature + consent → Task 4 + Task 3. ✓
- Both parties fill their fields → admin dialog (Task 5) + owner form (Task 4). ✓
- Timestamped, pre-signed, audit trail → Task 2 (certificate) + Task 3 (records time/IP/UA/hash). ✓
- Downloadable forever → Task 3 download + Task 4 signed state. ✓
- Hidden unless assigned (Rick/Shane/Ashley) → `get_owner_agreement` returns nothing + `AgreementSection` returns null. ✓
- Mobile-optimized → SignaturePad touch + single-column forms (Task 4), responsive Settings (Task 5). ✓
- Types consistency: `SignAgreementPayload` (Task 3) matches the owner form (Task 4) and columns written; `get_owner_agreement` fields match `AgreementSection` reads.
