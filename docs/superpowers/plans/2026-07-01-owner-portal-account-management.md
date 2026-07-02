# Owner Portal Account Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in property owner manage their own account from the owner portal — change password, change login email, and edit owner-wide contact + payment info — and fix the "Trello" task badge to read "Trellis".

**Architecture:** Contact/payment moves from per-property `properties` columns to the owner-level `property_owners` table, saved via a whitelisted `SECURITY DEFINER` RPC. Login-email change runs through a new owner-gated service-role endpoint that updates the auth user and `property_owners.email` in place (id unchanged → permissions preserved). Password change reuses the existing auth-context `updatePassword()`. All portal UI lives in `owner-portal.tsx`.

**Tech Stack:** React 18 + TypeScript + Vite, TanStack Query, Supabase (Postgres + Auth), Vercel serverless (`api/`), Tailwind + Shadcn/ui, Wouter.

## Global Constraints

- Path aliases: `@/` = `client/src/`, `@shared/` = `shared/`.
- Styling: Tailwind + `cn()` only; no inline styles. Icons: Lucide React only. Status colors via semantic tokens, never hardcoded chips.
- Notifications via `use-toast.ts`. Data fetching via React Query hooks calling Supabase directly.
- Owner-scoped DB access is enforced in Postgres; both the RPC and the endpoint MUST derive the subject from the caller's session/token, never from client-supplied ids.
- Supabase project id: `eetsudoksvsmwtiqraot`. Migrations live in `supabase/migrations/`. Regenerate `shared/database.types.ts` via Supabase MCP `generate_typescript_types` after schema changes.
- No em dashes in owner-facing copy (use commas/colons/periods).
- Verification cycle per task: `npm run check` must pass, plus the task's manual checks. There is no unit-test harness for SQL/endpoints/UI in this repo.
- Migration column drop is destructive and pre-approved; apply only after the backfill step in the same migration.

---

## File Structure

- `supabase/migrations/20260701_owner_account.sql` — **new.** Adds `preferred_payment_method`, backfills owner-level contact/payment, trims the field-permission model (drops `owner_contact` + `payment_method` keys), adds `owner_update_self_contact` RPC, drops the dead per-property columns.
- `api/owners/change-email.ts` — **new.** Owner-gated (own session token) service-role endpoint to change login email + sync `property_owners.email`.
- `client/src/lib/owners.ts` — **modify.** Add `changeOwnerEmail()` helper; remove `owner_contact` + `payment_method` from `OWNER_FIELD_DEFS`.
- `client/src/pages/owner-portal.tsx` — **modify.** Remove per-property contact/payment section; add owner-wide "Your contact & payment" card + "Account security" (password) card; fix Trellis badge label.
- `shared/database.types.ts` — **regenerate** after migration.
- `CLAUDE.md` — **modify.** Update owner-portal notes, Database section, migration list.

---

## Task 1: Database migration — schema, backfill, permission trim, RPC, column drop

**Files:**
- Create: `supabase/migrations/20260701_owner_account.sql`
- Reference (do not edit, read for exact prior definitions): `supabase/migrations/20260623_owner_portal.sql`, `supabase/migrations/20260623c_owner_field_permissions.sql`

**Interfaces:**
- Consumes: existing helpers `current_owner_id()`, `owner_property_perms()`, `owner_field_permissions_default()`, trigger `properties_owner_update_guard`, RPC `get_owner_properties()`.
- Produces: column `property_owners.preferred_payment_method TEXT`; RPC `owner_update_self_contact(p_name text, p_phone text, p_payment_method text) returns void`; `get_owner_properties()` and `owner_field_permissions_default()` no longer emit the `owner_contact`/`payment_method` keys; `properties` no longer has `owner_contact_name/email/phone`, `preferred_payment_method`.

- [ ] **Step 1: Read the two prior owner migrations to copy exact current definitions**

Read `supabase/migrations/20260623c_owner_field_permissions.sql` in full and `supabase/migrations/20260623_owner_portal.sql` (the `properties_owner_update_guard` trigger + `get_owner_properties` RPC + `owner_field_permissions_default`). You must reproduce the current bodies exactly, minus the two removed field keys. Do not guess at the SQL — copy the real current versions and delete only the `owner_contact` / `payment_method` handling.

- [ ] **Step 2: Write the migration file**

Create `supabase/migrations/20260701_owner_account.sql`. Structure (fill the CREATE OR REPLACE bodies from Step 1's real definitions):

```sql
-- 20260701_owner_account.sql
-- Owner portal account management: owner-wide contact/payment on property_owners,
-- self-service contact RPC, remove the now-owner-wide field-permission keys, and
-- drop the dead per-property owner-contact columns.

-- 1. New owner-level payment column (name, phone, email already exist).
ALTER TABLE property_owners
  ADD COLUMN IF NOT EXISTS preferred_payment_method TEXT;

-- 2. Backfill owner-level values from the per-property columns before dropping them.
--    Pick a deterministic non-null value per owner (lowest property id wins).
WITH ranked AS (
  SELECT op.owner_id,
         p.owner_contact_name,
         p.owner_contact_phone,
         p.preferred_payment_method,
         row_number() OVER (PARTITION BY op.owner_id ORDER BY p.id) AS rn
    FROM owner_properties op
    JOIN properties p ON p.id = op.property_id
),
agg AS (
  SELECT owner_id,
         (array_remove(array_agg(owner_contact_name    ORDER BY rn), NULL))[1] AS name,
         (array_remove(array_agg(owner_contact_phone   ORDER BY rn), NULL))[1] AS phone,
         (array_remove(array_agg(preferred_payment_method ORDER BY rn), NULL))[1] AS pay
    FROM ranked
   GROUP BY owner_id
)
UPDATE property_owners po
   SET preferred_payment_method = COALESCE(po.preferred_payment_method, agg.pay),
       name  = CASE WHEN po.name  IS NULL OR po.name  = '' THEN agg.name  ELSE po.name  END,
       phone = CASE WHEN po.phone IS NULL OR po.phone = '' THEN agg.phone ELSE po.phone END
  FROM agg
 WHERE po.id = agg.owner_id;

-- 3. Self-service contact/payment RPC (whitelisted columns, caller-scoped).
CREATE OR REPLACE FUNCTION public.owner_update_self_contact(
  p_name TEXT, p_phone TEXT, p_payment_method TEXT
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE oid UUID;
BEGIN
  oid := current_owner_id();
  IF oid IS NULL THEN RAISE EXCEPTION 'Not an active owner'; END IF;
  UPDATE property_owners
     SET name = p_name, phone = p_phone, preferred_payment_method = p_payment_method
   WHERE id = oid;
END $$;

REVOKE ALL ON FUNCTION public.owner_update_self_contact(TEXT, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.owner_update_self_contact(TEXT, TEXT, TEXT) TO authenticated;

-- 4. Trim the field-permission model: drop 'owner_contact' and 'payment_method'.
--    Reproduce the CURRENT bodies from 20260623c minus those two keys.
CREATE OR REPLACE FUNCTION public.owner_field_permissions_default()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  -- <copy current default jsonb from 20260623c, REMOVE owner_contact + payment_method keys>
$$;

CREATE OR REPLACE FUNCTION public.get_owner_properties()
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- <copy current body from 20260623c, REMOVE owner_contact_name/email/phone and
  --  preferred_payment_method from the returned jsonb AND remove the two keys from
  --  the emitted permissions map>
$$;

-- Guard trigger: drop the two fields from the editability overlay.
CREATE OR REPLACE FUNCTION public.properties_owner_update_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
  -- <copy current body from 20260623c, REMOVE the owner_contact_* and
  --  preferred_payment_method overlay branches>
$$;

-- 5. Drop the now-dead per-property columns (destructive, pre-approved).
ALTER TABLE properties
  DROP COLUMN IF EXISTS owner_contact_name,
  DROP COLUMN IF EXISTS owner_contact_email,
  DROP COLUMN IF EXISTS owner_contact_phone,
  DROP COLUMN IF EXISTS preferred_payment_method;
```

- [ ] **Step 3: Apply the migration to Supabase**

Use Supabase MCP `apply_migration` (project `eetsudoksvsmwtiqraot`, name `20260701_owner_account`) with the file contents. If it reports an error, fix the SQL and re-apply (the `CREATE OR REPLACE` / `IF EXISTS` / `IF NOT EXISTS` guards make it safe to re-run; the backfill is idempotent because of the `COALESCE`/`CASE` guards).

- [ ] **Step 4: Verify schema + RPC via SQL**

Run via Supabase MCP `execute_sql`:

```sql
-- payment column exists, old columns gone
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'property_owners' AND column_name = 'preferred_payment_method';
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'properties'
   AND column_name IN ('owner_contact_name','owner_contact_email','owner_contact_phone','preferred_payment_method');
-- RPC exists
SELECT proname FROM pg_proc WHERE proname = 'owner_update_self_contact';
```
Expected: first query returns 1 row; second returns 0 rows; third returns 1 row.

- [ ] **Step 5: Regenerate DB types**

Use Supabase MCP `generate_typescript_types` (project `eetsudoksvsmwtiqraot`) and overwrite `shared/database.types.ts` with the output. Confirm the `properties` type no longer lists the four dropped columns and `property_owners` now lists `preferred_payment_method`.

- [ ] **Step 6: Typecheck**

Run: `npm run check`
Expected: PASS. If `owner-portal.tsx` errors because it still references the dropped columns, that's expected — it is fixed in Task 3. To keep this task green in isolation, note the errors and proceed (they resolve in Task 3). If you prefer a clean gate, run Task 3 immediately after.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260701_owner_account.sql shared/database.types.ts
git commit -m "feat(db): owner-wide contact/payment, self-service contact RPC, drop per-property owner columns"
```

---

## Task 2: Login-email change endpoint + client helper

**Files:**
- Create: `api/owners/change-email.ts`
- Modify: `client/src/lib/owners.ts`
- Reference (read for the exact service-role + auth pattern): `api/owners/provision.ts`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` env; the caller's Supabase session access token.
- Produces: `POST /api/owners/change-email` accepting `{ newEmail: string }`, returning `{ ok: true }` or `{ error: string }` with an appropriate status; client helper `changeOwnerEmail(newEmail: string): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Read the provisioning endpoint for the exact pattern**

Read `api/owners/provision.ts` fully. Copy its structure for: Vercel handler signature, CORS/headers, reading the Bearer token, constructing the service-role client, and its admin-token verification. **Change the gate:** provision is admin-gated; this endpoint is *owner-self-gated* — it only needs a valid session and always acts on that session's own user. If `provision.ts` uses a different `createClient` import path or handler export style, match it exactly rather than the sketch below.

- [ ] **Step 2: Write the endpoint**

Create `api/owners/change-email.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Not signed in' })

  const newEmailRaw = (req.body?.newEmail ?? '').toString().trim().toLowerCase()
  if (!EMAIL_RE.test(newEmailRaw)) return res.status(400).json({ error: 'Enter a valid email address.' })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  // 1. Resolve the caller from their own token — never trust a client-supplied id.
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  const authUser = userData?.user
  if (userErr || !authUser) return res.status(401).json({ error: 'Session expired. Please sign in again.' })

  const currentEmail = (authUser.email || '').toLowerCase()
  if (newEmailRaw === currentEmail) return res.status(400).json({ error: 'That is already your email.' })

  // 2. Must be an existing owner (self-service is owner-only).
  const { data: owner, error: ownerErr } = await admin
    .from('property_owners').select('id').eq('email', currentEmail).maybeSingle()
  if (ownerErr) return res.status(500).json({ error: ownerErr.message })
  if (!owner) return res.status(403).json({ error: 'Not an owner account.' })

  // 3. Reject if the new email is already taken anywhere.
  const [ownerHit, staffHit] = await Promise.all([
    admin.from('property_owners').select('id').eq('email', newEmailRaw).maybeSingle(),
    admin.from('app_users').select('id').eq('google_email', newEmailRaw).maybeSingle(),
  ])
  if (ownerHit.data || staffHit.data) return res.status(409).json({ error: 'That email is already in use.' })

  // 4. Change the auth email immediately (no verification round-trip).
  const { error: updErr } = await admin.auth.admin.updateUserById(authUser.id, {
    email: newEmailRaw, email_confirm: true,
  })
  if (updErr) {
    const dup = /already|registered|exists/i.test(updErr.message)
    return res.status(dup ? 409 : 500).json({ error: dup ? 'That email is already in use.' : updErr.message })
  }

  // 5. Sync property_owners.email in place (id unchanged → permissions preserved).
  const { error: syncErr } = await admin
    .from('property_owners').update({ email: newEmailRaw }).eq('id', owner.id)
  if (syncErr) return res.status(500).json({ error: syncErr.message })

  return res.status(200).json({ ok: true })
}
```

- [ ] **Step 3: Add the client helper**

In `client/src/lib/owners.ts`, add after `deleteOwnerLogin` (reuse the existing `getToken()` helper already in the file):

```ts
// Change the signed-in owner's login email. Runs server-side (service role) so
// the email is updated immediately and property_owners.email is kept in sync.
export async function changeOwnerEmail(newEmail: string): Promise<{ ok: boolean; error?: string }> {
  const token = await getToken()
  if (!token) return { ok: false, error: 'Not signed in' }
  try {
    const res = await fetch('/api/owners/change-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ newEmail }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data.error || `Failed (${res.status})` }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' }
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run check`
Expected: PASS for `owners.ts` and the new endpoint. (`owner-portal.tsx` may still show pre-Task-3 errors from Task 1; ignore those here.)

- [ ] **Step 5: Commit**

```bash
git add api/owners/change-email.ts client/src/lib/owners.ts
git commit -m "feat(api): owner self-service login-email change endpoint + client helper"
```

---

## Task 3: Portal UI — owner-wide contact/payment card, remove per-property section, Trellis fix

**Files:**
- Modify: `client/src/pages/owner-portal.tsx`
- Modify: `client/src/lib/owners.ts` (`OWNER_FIELD_DEFS`)

**Interfaces:**
- Consumes: `changeOwnerEmail` (Task 2), RPC `owner_update_self_contact` (Task 1), `useAuth()`, `supabase.auth.refreshSession()`, `supabase.rpc`.
- Produces: an owner-wide `ContactPaymentCard` rendered in the portal shell; `PropertyCard` with no contact/payment section; `OWNER_FIELD_DEFS` without `owner_contact`/`payment_method`.

- [ ] **Step 1: Trim `OWNER_FIELD_DEFS`**

In `client/src/lib/owners.ts`, delete these two lines from `OWNER_FIELD_DEFS`:

```ts
  { key: 'owner_contact',  label: 'Owner contact information' },
  { key: 'payment_method', label: 'Preferred payment method' },
```
This narrows the derived `OwnerFieldKey`/`OwnerPermissions` types automatically. (The Settings → Owners `OwnerPermissionsDialog` iterates `OWNER_FIELD_DEFS`, so it drops the two rows with no further change.)

- [ ] **Step 2: Remove per-property contact/payment from `PropertyCard`**

In `client/src/pages/owner-portal.tsx`:
- In `EDITABLE_COLUMNS`, delete the `owner_contact:` and `payment_method:` entries.
- In the `OwnerProperty` type, delete `owner_contact_name`, `owner_contact_email`, `owner_contact_phone`, `preferred_payment_method`.
- Delete the entire `{/* Owner contact + payment */}` `<section>` block (the `showContact` section, roughly lines 298-347).
- Delete the `contactKeys` and `showContact` locals.
- Update the save-button guard `{(showDetails || showContact) && anyEditable && (` to `{showDetails && anyEditable && (`.

- [ ] **Step 3: Fix the Trellis badge label**

In `TasksSection`, change:

```tsx
{t.source === 'trellis' ? 'Trello' : t.source}
```
to:

```tsx
{t.source === 'trellis' ? 'Trellis' : t.source}
```

- [ ] **Step 4: Add the `ContactPaymentCard` component**

Add this component in `owner-portal.tsx` (above `OwnerPortalPage`). It reads the owner's current name/phone/email/payment, saves name/phone/payment via the RPC, and routes an email change through `changeOwnerEmail` + `refreshSession`:

```tsx
function ContactPaymentCard() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-self'],
    queryFn: async () => {
      // current_owner_id() resolves the signed-in owner in the DB; RLS also
      // restricts property_owners rows to the owner themselves.
      const { data: oid } = await supabase.rpc('current_owner_id')
      const { data, error } = await supabase
        .from('property_owners')
        .select('name, phone, email, preferred_payment_method')
        .eq('id', (oid as any) ?? '')
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const [form, setForm] = useState({ name: '', phone: '', email: '', preferred_payment_method: '' })
  const [initialEmail, setInitialEmail] = useState('')
  useEffect(() => {
    if (data) {
      setForm({
        name: data.name ?? '', phone: data.phone ?? '',
        email: data.email ?? '', preferred_payment_method: data.preferred_payment_method ?? '',
      })
      setInitialEmail(data.email ?? '')
    }
  }, [data])

  const save = useMutation({
    mutationFn: async () => {
      const email = form.email.trim().toLowerCase()
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.')
      const emailChanged = email !== initialEmail.toLowerCase()
      if (emailChanged) {
        const r = await changeOwnerEmail(email)
        if (!r.ok) throw new Error(r.error || 'Could not change email.')
      }
      const { error } = await supabase.rpc('owner_update_self_contact', {
        p_name: form.name.trim() || null,
        p_phone: form.phone.trim() || null,
        p_payment_method: form.preferred_payment_method.trim() || null,
      })
      if (error) throw error
      if (emailChanged) await supabase.auth.refreshSession()
    },
    onSuccess: () => {
      toast({ title: 'Saved', description: 'Your contact information was updated.' })
      queryClient.invalidateQueries({ queryKey: ['owner-self'] })
    },
    onError: (e: unknown) =>
      toast({ title: 'Could not save', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' }),
  })

  if (isLoading) return <Skeleton className="h-40 rounded-2xl" />
  if (isError) return <ErrorState onRetry={() => refetch()} title="Couldn't load your info" description="Please try again." />

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="py-4">
        <h2 className="text-base font-semibold text-foreground">Your contact &amp; payment</h2>
      </CardHeader>
      <CardContent className="space-y-4 pb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Contact name">
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-owner-name" />
          </Field>
          <Field label="Contact phone">
            <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} data-testid="input-owner-phone" />
          </Field>
          <Field label="Login email">
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} data-testid="input-owner-email" />
          </Field>
          <Field label="Preferred payment method">
            <>
              <Input
                list="owner-payment-methods"
                value={form.preferred_payment_method}
                onChange={e => setForm(f => ({ ...f, preferred_payment_method: e.target.value }))}
                placeholder="e.g. ACH, Zelle, Check"
                data-testid="input-owner-payment"
              />
              <datalist id="owner-payment-methods">
                <option value="ACH / Bank transfer" />
                <option value="Zelle" />
                <option value="Venmo" />
                <option value="Check" />
                <option value="Credit card" />
              </datalist>
            </>
          </Field>
        </div>
        <p className="text-2xs text-muted-foreground">
          Changing your login email updates the address you sign in with. It does not change your properties or access.
        </p>
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-owner-contact">
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: Wire imports and render the card**

In `owner-portal.tsx`:
- Add `useEffect` to the `react` import; add `changeOwnerEmail` to the `@/lib/owners` import.
- Render `<ContactPaymentCard />` in the `<main>` of `OwnerPortalPage`, right after the `{!isLoading && !isError && data && <OnboardingSection .../>}` line and before the "Your properties" heading `<div>`, guarded by `{ownerId && <ContactPaymentCard />}`.

- [ ] **Step 6: Typecheck**

Run: `npm run check`
Expected: PASS with no remaining references to the dropped columns anywhere.

- [ ] **Step 7: Manual verification (dev server, owner test account)**

Run `npm run dev`, sign in as the owner test account (email/password), open the portal. Confirm: the per-property cards no longer show contact/payment; one "Your contact & payment" card appears near the top; editing name/phone/payment and Save persists (reload shows values); the scheduled-task badge reads "Trellis". (Login-email change is verified end-to-end in Task 5 against the deployed endpoint, since `/api/*` needs the serverless runtime.)

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/owner-portal.tsx client/src/lib/owners.ts
git commit -m "feat(owner-portal): owner-wide contact/payment card, remove per-property section, Trellis label fix"
```

---

## Task 4: Portal UI — password change card

**Files:**
- Modify: `client/src/pages/owner-portal.tsx`
- Reference: `client/src/pages/reset-password.tsx` (validation to mirror)

**Interfaces:**
- Consumes: `useAuth().updatePassword(newPassword) => Promise<{ error: string | null }>`.
- Produces: an `AccountSecurityCard` rendered at the bottom of the portal.

- [ ] **Step 1: Add the `AccountSecurityCard` component**

Add in `owner-portal.tsx` (above `OwnerPortalPage`):

```tsx
function AccountSecurityCard() {
  const { toast } = useToast()
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      toast({ title: 'Password too short', description: 'Use at least 8 characters.', variant: 'destructive' })
      return
    }
    if (password !== confirm) {
      toast({ title: 'Passwords do not match', description: 'Please re-enter them.', variant: 'destructive' })
      return
    }
    setSubmitting(true)
    const { error } = await updatePassword(password)
    setSubmitting(false)
    if (error) {
      toast({ title: 'Could not update password', description: error, variant: 'destructive' })
      return
    }
    setPassword(''); setConfirm('')
    toast({ title: 'Password updated', description: 'Your new password is now active.' })
  }

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="py-4">
        <h2 className="text-base font-semibold text-foreground">Account security</h2>
      </CardHeader>
      <CardContent className="pb-6">
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="New password">
              <Input type="password" autoComplete="new-password" value={password}
                onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters"
                data-testid="input-owner-new-password" />
            </Field>
            <Field label="Confirm password">
              <Input type="password" autoComplete="new-password" value={confirm}
                onChange={e => setConfirm(e.target.value)} placeholder="Re-enter password"
                data-testid="input-owner-confirm-password" />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={submitting} data-testid="button-owner-update-password">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update password'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Render the card**

In `OwnerPortalPage`'s `<main>`, add `<AccountSecurityCard />` as the last card (after `FeedbackSection`).

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Manual verification (dev server)**

As the owner test account: open the "Account security" card, enter mismatched passwords (expect a toast), then a valid matching password ≥8 chars (expect "Password updated"). Sign out, sign back in with the new password.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/owner-portal.tsx
git commit -m "feat(owner-portal): in-portal password change card"
```

---

## Task 5: Docs, deploy, and end-to-end verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

- In the Pages table / owner-portal notes, note that owners can now manage owner-wide contact + payment, change their password, and change their login email in-portal.
- In the Database section: add `property_owners.preferred_payment_method`; note the per-property `owner_contact_*` / `preferred_payment_method` columns were dropped; note the `owner_update_self_contact` RPC and that the field-permission model dropped the `owner_contact` + `payment_method` keys.
- Add `20260701_owner_account.sql` to the Recent Migrations list with a one-line summary.
- Add `POST /api/owners/change-email` (owner-gated, service role) to the API notes.

- [ ] **Step 2: Commit docs**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for owner portal account management"
```

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin claude/owner-portal-account-mgmt-1264
gh pr create --title "Owner portal: account management (contact/payment, password, login email)" --body "$(cat <<'EOF'
Owner-facing account management in the owner portal.

- Owner-wide **contact & payment** (moved off per-property columns; one card, saved via the whitelisted `owner_update_self_contact` RPC).
- **Login-email change** while authenticated via owner-gated `POST /api/owners/change-email` (service role, immediate, id preserved so permissions/assignments are unchanged).
- In-portal **password change** (reuses auth-context `updatePassword`).
- Fixed the scheduled-task badge to read **Trellis** (was "Trello").
- Migration `20260701_owner_account.sql`: adds `preferred_payment_method`, backfills owner-level values, trims the field-permission model, drops the dead per-property columns.

Spec: `docs/superpowers/specs/2026-07-01-owner-portal-account-management-design.md`
Plan: `docs/superpowers/plans/2026-07-01-owner-portal-account-management.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: End-to-end verification on the Vercel preview (owner test account)**

Wait for the preview deploy, then with Playwright against the preview URL (owner test account):
1. **Contact/payment:** edit name/phone/payment, Save → reload → values persist.
2. **Login email:** change the email, Save → still signed in, "Your properties" still lists the same properties (permissions preserved) → sign out → sign in with the new email succeeds.
3. **Password:** change it → sign out → sign in with the new password.
4. **Trellis:** a scheduled task shows the "Trellis" badge.
5. **Staff unaffected:** sign in as admin → open a property in PropertyDetailModal → no owner-contact regressions; Settings → Owners permission dialog no longer lists "Owner contact information" / "Preferred payment method".

- [ ] **Step 5: Merge**

Squash-merge the PR and delete the branch (per the standing git workflow).

---

## Self-Review

**Spec coverage:**
- Password change → Task 4. ✓
- Owner-wide contact/payment (move off per-property, one card) → Task 1 (schema/RPC) + Task 3 (UI). ✓
- Login-email change, permissions preserved → Task 2 (endpoint/helper) + Task 3 (UI wiring). ✓
- Trellis label fix → Task 3 Step 3. ✓
- Drop per-property columns after backfill → Task 1 Steps 2 + 5. ✓
- Remove `owner_contact`/`payment_method` permission keys → Task 1 Step 2 (SQL) + Task 3 Step 1 (TS). ✓
- Regenerate types, update CLAUDE.md → Task 1 Step 5, Task 5 Step 1. ✓

**Placeholder scan:** The three `CREATE OR REPLACE` bodies in Task 1 Step 2 are intentionally marked to be copied from the real current definitions in `20260623c` (Step 1 requires reading them first) rather than guessed — reproducing prior SQL verbatim is safer than inventing it. All UI/endpoint/helper code is complete.

**Type consistency:** `changeOwnerEmail(newEmail: string): Promise<{ ok, error? }>` defined in Task 2, consumed in Task 3. RPC `owner_update_self_contact(p_name, p_phone, p_payment_method)` defined in Task 1, called with those exact param names in Task 3. `OWNER_FIELD_DEFS` key removal (Task 3 Step 1) matches the SQL key removal (Task 1). Consistent.
