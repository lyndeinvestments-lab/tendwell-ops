# Owner Portal — Account Management (contact, payment, password, login email)

**Date:** 2026-07-01
**Branch:** `claude/owner-portal-account-mgmt-1264`
**Status:** Design approved, pending spec review

---

## Problem

Property owners using the owner portal have no way to manage their own account:

1. **Password** — the only way to change it is the emailed reset link (`/reset-password`). A signed-in owner has no in-portal option.
2. **Contact & payment** — this lives *inside each `PropertyCard`* and is stored per-property (`properties.owner_contact_name/email/phone`, `properties.preferred_payment_method`). It is duplicated across every property and conceptually wrong: an owner's contact/payment info is owner-wide, not per-property.
3. **Login email** — cannot be changed at all from the portal.

## Goals

- Signed-in owner can change their **password** directly in the portal.
- Owner contact + payment becomes **owner-wide** (one section, not per-property).
- Signed-in owner can change their **login email** without any change to their permissions or property access.
- Fix the incorrect `Trellis` → "Trello" badge label on scheduled tasks.

## Non-goals

- No changes to staff-facing views (none read the per-property owner columns).
- No email-ownership verification round-trip for the login-email change (see Security).
- No changes to the owner **role**, property assignments, or the field-permission model beyond removing the two keys that no longer apply.

---

## Key finding that makes this safe

A repo-wide search shows the per-property columns `owner_contact_name`, `owner_contact_email`, `owner_contact_phone`, and `preferred_payment_method` are referenced **only** by the owner portal (`owner-portal.tsx`) and the generated `shared/database.types.ts`. No staff page (PropertyDetailModal, quote sheet, financials) reads them. Moving contact/payment to owner level therefore breaks no staff view.

---

## Data model

`property_owners` already has `id`, `email` (login, lowercased, UNIQUE), `name`, `phone`, `active`, `created_at`. It becomes the single home for owner-wide contact/payment.

| Field | Column | Notes |
|---|---|---|
| Contact name | `name` *(exists)* | Also drives the portal greeting / owner label |
| Contact phone | `phone` *(exists)* | |
| Email | `email` *(exists)* | The **login** email; editable via the secure flow below |
| Payment method | `preferred_payment_method` *(new)* | `TEXT`, nullable |

There is **one** email (the login email). The earlier idea of a separate `contact_email` column is dropped.

### Migration `20260701_owner_account.sql`

1. `ALTER TABLE property_owners ADD COLUMN IF NOT EXISTS preferred_payment_method TEXT;`
2. **Backfill** from the per-property values, per owner (via `owner_properties`):
   - `preferred_payment_method` ← first non-null `properties.preferred_payment_method` among the owner's assigned properties.
   - `name` ← first non-null `owner_contact_name` **only if** `property_owners.name` is null/empty.
   - `phone` ← first non-null `owner_contact_phone` **only if** `property_owners.phone` is null/empty.
   - (email is the login email; not backfilled.)
3. Remove the `owner_contact` and `payment_method` field keys from the owner permission model:
   - Rewrite `owner_field_permissions_default()` to drop those two keys.
   - Rewrite `get_owner_properties()` to stop returning `owner_contact_*` / `preferred_payment_method` and to stop emitting those two permission keys.
   - Rewrite the `properties_owner_update_guard` trigger to drop the two fields from its editability overlay.
4. **Drop** the now-unused per-property columns: `properties.owner_contact_name`, `owner_contact_email`, `owner_contact_phone`, `preferred_payment_method`. (Destructive; done after backfill. Approved.)
5. New RPC `owner_update_self_contact(...)` — see below.

Regenerate `shared/database.types.ts` after the migration (Supabase MCP `generate_typescript_types`).

---

## Component 1 — Owner-wide contact & payment

### Save path: `owner_update_self_contact` RPC

`SECURITY DEFINER`, whitelisted columns only, scoped to the caller:

```sql
CREATE OR REPLACE FUNCTION public.owner_update_self_contact(
  p_name TEXT, p_phone TEXT, p_payment_method TEXT
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE oid UUID;
BEGIN
  oid := current_owner_id();            -- NULL for staff / inactive owners
  IF oid IS NULL THEN RAISE EXCEPTION 'Not an active owner'; END IF;
  UPDATE property_owners
     SET name = p_name, phone = p_phone, preferred_payment_method = p_payment_method
   WHERE id = oid;
END $$;
```

Rationale: an RPC with an explicit column whitelist prevents an owner from touching `email`, `active`, or `id` via a crafted `from('property_owners').update(...)`. Mirrors the existing owner RPC pattern (`get_owner_properties`, `owner_respond_to_quote`). Email is intentionally **not** in this RPC — it has its own flow.

### Email change path: `POST /api/owners/change-email`

Owner self-service, gated by the owner's **own** session Bearer token (mirrors `api/owners/provision.ts` but owner-gated, not admin-gated):

1. Verify the token → resolve the auth user (uid + current email). The target is always the token's own user — the request body's email is only the *new* value, never an identity to act on.
2. Validate/lowercase `newEmail`; reject if unchanged.
3. Reject if `newEmail` is already used (check `auth.users`, `property_owners`, `app_users.google_email`).
4. Service role: `supabaseAdmin.auth.admin.updateUserById(uid, { email: newEmail, email_confirm: true })` — immediate, no verification email.
5. Service role: `UPDATE property_owners SET email = newEmail WHERE id = <owner id>` (the `lower_email` trigger normalizes). The owner id is unchanged, so all `owner_properties` / `owner_property_permissions` rows are untouched → **permissions and access preserved**.
6. Return `{ ok: true }`.

Client helper `changeOwnerEmail(newEmail)` in `client/src/lib/owners.ts` (same shape as `provisionOwnerLogin`). On success the portal calls `supabase.auth.refreshSession()` so `sessionEmail` updates and `resolveOwnerFromEmail` re-runs against the new email. Because the DB helper `current_auth_email()` reads live `auth.users` (not the JWT claim) and `property_owners.email` was updated in step 5, RLS access is continuous even before the refresh.

### UI

- **Remove** the "Owner contact & payment" `<section>` from `PropertyCard`, along with the `contactKeys`, the `owner_contact`/`payment_method` entries in `EDITABLE_COLUMNS`, and the related fields on the `OwnerProperty` type. `PropertyCard` keeps only property details (address, beds, codes, Wi-Fi) + scheduled tasks.
- **Add** a single **"Your contact & payment"** `Card` in the portal shell, near the top (after quotes/onboarding, before "Your properties"). Fields: Contact name, Contact phone, Email, Preferred payment method (with the same `datalist` suggestions currently in `PropertyCard`). One **Save** button:
  - If email changed → `await changeOwnerEmail(newEmail)`; on error, show toast and stop (don't save the rest).
  - Then `await supabase.rpc('owner_update_self_contact', { p_name, p_phone, p_payment_method })`.
  - If email changed and both succeeded → `await supabase.auth.refreshSession()`.
  - Invalidate `['owner-properties']` / owner identity as needed; success toast.
- Light validation: valid email format; trim empties to null.

## Component 2 — Password change

- **Add** an **"Account security"** `Card` at the bottom of the portal: New password + Confirm password, min 8 chars, must match — identical validation to `reset-password.tsx`.
- On submit → `updatePassword(newPassword)` (already in the auth context via `supabase.auth.updateUser({ password })`). Success toast; clear the fields.

## Component 3 — Trellis label fix

In `owner-portal.tsx` `TasksSection`, change:
```tsx
{t.source === 'trellis' ? 'Trello' : t.source}
```
to render **`Trellis`** for the `trellis` source (keep the capitalized display for other sources).

---

## Files touched

- `supabase/migrations/20260701_owner_account.sql` — new
- `api/owners/change-email.ts` — new (owner-gated, service role)
- `client/src/lib/owners.ts` — add `changeOwnerEmail()`
- `client/src/pages/owner-portal.tsx` — remove per-property contact section; add contact/payment card, password card; Trellis label fix
- `client/src/lib/owners.ts` `OWNER_FIELD_DEFS` — remove `owner_contact` + `payment_method` keys (auto-updates the Settings → Owners permission dialog and `normalizeOwnerPermissions`)
- `shared/database.types.ts` — regenerate after migration
- `CLAUDE.md` — update owner-portal notes, Database section, migration list

---

## Security notes

- **Email change skips inbox verification.** Acceptable: the caller is already authenticated as themselves, can only change their own email, and the worst case is self-lockout. Uniqueness checks prevent collisions with other accounts. If stronger assurance is wanted later, switch to `supabase.auth.updateUser({ email })` + a confirmation link and sync `property_owners.email` from an `auth.users` update trigger.
- **RPC + endpoint both derive the subject from the caller's session**, never from client-supplied ids — an owner can only ever modify their own row.
- **Permissions/assignments preserved** because `property_owners.id` never changes.

## Testing

- Type-check (`npm run check`).
- Manual (Playwright, owner test account): change password → sign out → sign in with new password; edit contact/payment → persists and shows owner-wide (single section); change login email → still signed in, still sees the same properties, can sign in with the new email; scheduled-task badge reads "Trellis".
- Verify a staff/admin view is unaffected (no per-property owner contact fields anywhere).
