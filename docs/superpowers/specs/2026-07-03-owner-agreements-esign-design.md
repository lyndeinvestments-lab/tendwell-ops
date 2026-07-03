# Owner Portal — E-Signature Service Agreements

**Date:** 2026-07-03
**Branch:** `claude/owner-agreements-esign-26223`
**Status:** Approved (user directed build; key UX choices confirmed). Proceeding to plan + implementation.

---

## Goal
A DocuSign-style flow in the Tendwell owner portal: an admin assigns the Cleaning Services Agreement to a specific owner (pre-signed by Tendwell), the owner reviews it, fills their fields, signs with a drawn digital signature, and the completed, timestamped PDF is stored and downloadable from their portal forever. Owners who were **not** sent an agreement see nothing.

## Confirmed decisions
- **Signed PDF look:** fill the party fields on page 1, stamp the Tendwell pre-signature (page 5 Tendwell block) and the owner's drawn signature (page 5 Owner block), and append a **Certificate of Completion** page (audit trail). (Option A.)
- **Owner signs by drawing** (touch/mouse signature pad) + typed printed name + title/capacity + consent checkbox.
- **Both parties fill fields:** admin fills/edits party info + effective date + Tendwell signer name/title/date when sending; owner fills/confirms their party fields + printed name + title/capacity + date + signature.
- **Mobile-optimized** end to end (owner signing flow especially).
- **ESIGN/UETA audit:** consent, server timestamps, IP, user-agent, SHA-256 hashes.

## The source document
`TendwellCleaningCo-ServiceAgreement.pdf` (5 pages, US Letter 612x792pt). Page 1 blanks: Effective Date; Owner/Authorized Rep Name; Entity; Mailing Address; Property Address(es); Email; Phone. Page 5 blocks: Tendwell (Signature, Printed Name, Title, Date) and Owner (Signature, Printed Name, Title/Capacity, Date). Committed to the repo as a public static asset (it is a blank contract, not secret).

---

## Architecture

### Storage & assets
- **Template (public):** commit the PDF to `client/public/agreements/service-agreement-v1.pdf`. Owners "review" it via an Open-in-new-tab link; the sign function fetches it same-origin (`https://<host>/agreements/service-agreement-v1.pdf`). No XFO/iframe issues.
- **Signed docs (private):** new private Supabase Storage bucket `agreements`; signed PDFs at `agreements/signed/<agreement_id>.pdf`. Access only via server endpoints (service role) that check the caller.

### Database (migration `20260703_owner_agreements.sql`)

**`agreement_config`** (single-row admin-only config; keeps the Tendwell signature out of owner reach):
```
id int PK default 1 (check id=1), tendwell_signer_name text, tendwell_signer_title text,
tendwell_signature_png text (data URL), updated_at timestamptz
```
RLS: SELECT + write restricted to staff (`is_staff()`); no owner access. Seed one empty row.

**`owner_agreements`**:
```
id uuid PK, owner_id uuid FK property_owners ON DELETE CASCADE,
status text CHECK in ('sent','signed','void') default 'sent',
-- party fields (page 1) — admin sets, owner may edit before signing:
effective_date date, owner_name text, entity text, mailing_address text,
property_addresses text, email text, phone text,
-- Tendwell block (page 5) — snapshot at send time (pre-signed):
tendwell_signer_name text, tendwell_signer_title text, tendwell_signed_at timestamptz,
-- Owner block (page 5) — set at signing:
owner_printed_name text, owner_title text, owner_signed_at timestamptz,
owner_signature_png text,  -- retained for audit; also embedded in the PDF
consent_text text, owner_ip text, owner_user_agent text,
-- document integrity:
template_version text default 'v1', source_pdf_sha256 text, signed_pdf_path text, signed_pdf_sha256 text,
created_by text, created_at timestamptz default now()
```
RLS: staff = ALL. Owner = SELECT own only (`owner_id = current_owner_id()`). Owners never INSERT/UPDATE directly — the sign endpoint (service role) writes the signing fields. Index on `owner_id`.

**RPC `get_owner_agreement()`** (SECURITY DEFINER, scoped to `current_owner_id()`): returns the signed-in owner's agreement row (party fields + status + owner block + `signed` flag), or no row. Does NOT return the Tendwell signature image (embedded server-side only). Grant to authenticated.

### Endpoints (Vercel serverless, service role; mirror `api/owners/provision.ts` auth patterns). New `api/agreements/_lib.ts` (shared) added to `vercel.json` `functions.includeFiles` for `api/agreements/*.ts`.
- **`POST /api/agreements/sign`** — owner-gated by the caller's own session token. Body: `{ agreementId, signatureDataUrl, ownerName, entity, mailingAddress, propertyAddresses, email, phone, ownerPrintedName, ownerTitle, consent: true }`. Steps:
  1. Resolve caller from token → the owner's `property_owners` row (by auth email); the agreement must belong to them and be status `sent`; reject otherwise. Require `consent === true` and a non-empty signature.
  2. Load template PDF (same-origin fetch); compute `source_pdf_sha256`.
  3. With **pdf-lib**: fill page-1 party fields (final values from the submitted body), stamp Tendwell signature (from `agreement_config`) + name/title/date on page 5, stamp owner signature PNG + printed name + title + date (server `now`) on page 5, and append a Certificate of Completion page (agreement id, both signers + timestamps, owner IP + user-agent, consent statement, source + signed SHA-256).
  4. Upload the signed PDF to `agreements/signed/<id>.pdf` (upsert). Compute `signed_pdf_sha256`.
  5. Update the row: owner block fields, `owner_signed_at=now`, `owner_ip` (x-forwarded-for), `owner_user_agent`, hashes, `signed_pdf_path`, `status='signed'`, `consent_text`.
  6. Return `{ ok: true }`.
- **`GET /api/agreements/download?id=<uuid>`** — caller must be the owner of that agreement OR staff. Returns a short-lived signed URL (`createSignedUrl`) for the signed PDF.

### Client
- **`client/src/lib/agreements.ts`**: helpers `signAgreement(payload)` and `getAgreementDownloadUrl(id)` (fetch endpoints with the session bearer token, mirroring `owners.ts`), plus shared TS types.
- **`client/src/components/SignaturePad.tsx`**: a small self-contained canvas signature pad. Pointer + touch events (`touch-action: none`), high-DPR scaling, Clear button, `toDataURL('image/png')`. No external dependency (keeps CSP simple). Mobile-first sizing (full width, ~180px tall, large Clear/Done targets).
- **Owner portal (`owner-portal.tsx`)**: an `AgreementSection` driven by `get_owner_agreement()`:
  - No row → render nothing.
  - `sent` → a prominent card "Action needed: review & sign your Service Agreement" with an **Open agreement** button (new tab to the template), the editable party fields (pre-filled), owner printed name + title/capacity + date (today), the SignaturePad, a consent checkbox ("I agree to sign electronically and I have read and agree to the Cleaning Services Agreement"), and a Sign button (disabled until signature + consent). Submits to `/api/agreements/sign`, then invalidates and flips to signed.
  - `signed` → "Service Agreement — signed <date>" + **Download PDF** button (`/api/agreements/download`).
  - Placed near the top of the portal `main` (above properties), mobile-first (stacked, full-width).
- **Admin (`settings.tsx`)**: a new **Agreements** area (admin only):
  - **Tendwell signature setup**: signer name, title, and a SignaturePad (or upload) → save to `agreement_config`. Required before sending. Shows current signature preview.
  - **Assign/send**: pick an owner (from `property_owners`), a dialog pre-fills party fields from the owner + their assigned properties (owner_name, email, phone, mailing/property addresses), editable, effective date default today, Tendwell signer name/title/date default from config/today → insert `owner_agreements` (status `sent`, tendwell block snapshot + `tendwell_signed_at=now`). List existing agreements with status + a link to download signed ones. Guard: block send if `agreement_config` has no signature.
  - Responsive (works on mobile, though admin is desktop-primary).

### Dependencies
- Add **`pdf-lib`** (MIT, pure-JS, no native deps) for server-side PDF generation.

---

## Mobile optimization (explicit)
- SignaturePad: `touch-action: none`, pointer/touch handlers, DPR-scaled canvas, full-width, large Clear button; prevents page scroll while drawing.
- Owner signing card: single-column, full-width inputs, `text-base` inputs (avoid iOS zoom), sticky/large Sign button, Open-agreement in new tab (native mobile PDF viewer).
- Settings agreements UI: responsive stacking; dialog scrolls on small screens.
- Follow existing `md:` responsive patterns in the codebase.

## Security / legal
- Owner privacy: the Tendwell signature never exposed to owners; owner reads only their own agreement via the RPC; signed PDF only via caller-checked endpoint (signed URLs, short TTL).
- Integrity: server timestamps (never client), IP + user-agent captured, SHA-256 of source + signed PDF, immutable-ish record (owner can't rewrite after `signed`; endpoint rejects non-`sent`).
- ESIGN/UETA: explicit consent checkbox recorded (`consent_text`), attribution (name/email/owner_id), intent (drawn signature + Sign action), retained copy (download).
- `agreement_config` and `owner_agreements` RLS enforced in Postgres, not just UI.

## Files
- `supabase/migrations/20260703_owner_agreements.sql` — new
- `client/public/agreements/service-agreement-v1.pdf` — new (the template)
- `api/agreements/_lib.ts`, `api/agreements/sign.ts`, `api/agreements/download.ts` — new
- `vercel.json` — add `api/agreements/*.ts` includeFiles
- `client/src/lib/agreements.ts`, `client/src/components/SignaturePad.tsx` — new
- `client/src/pages/owner-portal.tsx` — AgreementSection
- `client/src/pages/settings.tsx` — Agreements admin (config + assign)
- `package.json` — add `pdf-lib`
- `shared/database.types.ts` — regenerate
- `CLAUDE.md` — update

## Testing
- `npm run check`.
- Generate a sample signed PDF (from the sign endpoint or a local pdf-lib script) and visually verify page-1 fill + page-5 signatures + certificate placement (Read the PDF).
- Manual (owner test account): sent → review (opens PDF) → fill fields, draw signature, consent, Sign → becomes Download; downloaded PDF shows both signatures, party info, timestamps, certificate.
- Visibility: an owner with no agreement (e.g. Rick/Shane/Ashley) sees no card.
- Mobile: signature pad works with touch; layout is single-column and tappable.
- Admin: configure Tendwell signature; assign to an owner; block send when signature missing.
