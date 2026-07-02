# Owner Portal Beds/Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Owner portal shows broken-out bed-size fields (King/Queen/Full/Twin) instead of free text, auto-derives total beds and runs the auto-fill-from-beds linen formula on increase, offers QuickBooks/Bill.com as payment method, and adds owner-authored per-property notes visible to staff with an "Owner" badge.

**Architecture:** Bed derivation + linen auto-fill move into the `properties_owner_update_guard` trigger (owner branch) so the owner's normal `properties` update triggers them server-side. Owner notes use a new `owner_id` column on `property_notes` plus two SECURITY DEFINER RPCs so owners never see staff notes. `get_owner_properties()` returns the four bed columns (under the `bed_sizes` permission) and restores the `stage` field.

**Tech Stack:** React 18 + TS + Vite, TanStack Query, Supabase (Postgres + Auth), Tailwind + Shadcn/ui.

## Global Constraints
- Design spec: `docs/superpowers/specs/2026-07-02-owner-portal-beds-notes-design.md` (authoritative for formulas and exact behavior).
- Supabase project id `eetsudoksvsmwtiqraot`; migrations in `supabase/migrations/`; regenerate `shared/database.types.ts` via Supabase MCP after schema changes.
- The three SQL function bodies (`owner_field_permissions_default`, `get_owner_properties`, `properties_owner_update_guard`) must be reproduced from the CURRENT definitions in `supabase/migrations/20260701_owner_account.sql` (plus the `stage` line from `20260626_owner_properties_include_stage.sql`), changing ONLY what the spec lists. No invented SQL.
- Auto-fill formula (verbatim from `client/src/lib/linen-calc.ts`): sleep = guest_count if >0 else king*2+queen*2+full*2+twin*1; hand_towels=sleep; washcloths=sleep; bath_towels=sleep+full_baths; bathmats=full_baths; pool_towels = sleep if hot_tub else 0. No `has_pool`/`sofa_beds` columns exist.
- Owner note read/write only via SECURITY DEFINER RPCs scoped to `current_owner_id()` + `owner_owns_property()`. Owners must never see staff notes.
- No em dashes in owner-facing copy. Tailwind + `cn()` only; Lucide icons only; toasts via `use-toast`; React Query for data.
- Verification per task: `npm run check` passes + task manual checks. No unit-test harness for SQL/UI.

---

## File Structure
- `supabase/migrations/20260702_owner_beds_notes.sql` — new (owner_id column, 2 note RPCs, perm-default 7 keys, get_owner_properties rewrite, guard rewrite).
- `shared/database.types.ts` — regenerate.
- `client/src/lib/owners.ts` — drop `bed_count` from `OWNER_FIELD_DEFS`; add note RPC helpers.
- `client/src/pages/owner-portal.tsx` — beds UI, remove bed count, notes section, payment dropdown.
- `client/src/components/PropertyNotesFeed.tsx` — owner attribution badge.
- `CLAUDE.md` — update.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260702_owner_beds_notes.sql`
- Reference (read for exact current bodies): `supabase/migrations/20260701_owner_account.sql`, `supabase/migrations/20260626_owner_properties_include_stage.sql`, `supabase/migrations/20260623_owner_portal.sql` (for `owner_owns_property`, `current_owner_id`, `is_staff`).

**Interfaces produced:** `property_notes.owner_id UUID`; RPCs `owner_add_property_note(bigint,text) returns jsonb`, `get_owner_property_notes(bigint) returns setof jsonb`; `owner_field_permissions_default()` 7 keys; `get_owner_properties()` returns king/queen/full/twin (under bed_sizes visibility) + stage, no bed_sizes_text/number_of_beds; `properties_owner_update_guard()` derives number_of_beds + auto-fills linens on owner bed increase.

- [ ] **Step 1: Read the current SQL definitions.** Read `20260701_owner_account.sql` (the three function bodies) and `20260626_owner_properties_include_stage.sql` (the `stage` jsonb line) and `20260623_owner_portal.sql` (helper signatures + the property_owners `name` column used for the note author). Reproduce bodies verbatim minus the documented changes. If any current body can't be determined confidently, report BLOCKED.

- [ ] **Step 2: Write the migration** per the spec's Design → Migration section (parts a–e). Structure:

```sql
-- 20260702_owner_beds_notes.sql
-- Owner portal: broken-out beds (king/queen/full/twin) with server-derived
-- number_of_beds + auto-fill linens on increase; owner-authored property notes.

-- a. owner attribution on property_notes
ALTER TABLE property_notes
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES property_owners(id) ON DELETE SET NULL;

-- b. owner note RPCs
CREATE OR REPLACE FUNCTION public.owner_add_property_note(p_property_id BIGINT, p_content TEXT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE oid UUID; oname TEXT; row property_notes;
BEGIN
  oid := current_owner_id();
  IF oid IS NULL OR NOT owner_owns_property(p_property_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_content IS NULL OR btrim(p_content) = '' THEN RAISE EXCEPTION 'Note is empty'; END IF;
  SELECT name INTO oname FROM property_owners WHERE id = oid;
  INSERT INTO property_notes (property_id, content, context, created_by, owner_id)
  VALUES (p_property_id, btrim(p_content), NULL, COALESCE(oname, 'Owner'), oid)
  RETURNING * INTO row;
  RETURN jsonb_build_object('id', row.id, 'content', row.content, 'created_at', row.created_at);
END $$;
REVOKE ALL ON FUNCTION public.owner_add_property_note(BIGINT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.owner_add_property_note(BIGINT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_owner_property_notes(p_property_id BIGINT)
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE oid UUID;
BEGIN
  oid := current_owner_id();
  IF oid IS NULL OR NOT owner_owns_property(p_property_id) THEN RETURN; END IF;
  RETURN QUERY
    SELECT jsonb_build_object('id', id, 'content', content, 'created_at', created_at)
      FROM property_notes
     WHERE property_id = p_property_id AND owner_id = oid
     ORDER BY created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.get_owner_property_notes(BIGINT) FROM public;
GRANT EXECUTE ON FUNCTION public.get_owner_property_notes(BIGINT) TO authenticated;

-- c/d/e: reproduce owner_field_permissions_default() (7 keys, drop bed_count),
--        get_owner_properties() (king/queen/full/twin under bed_sizes visibility,
--        restore stage, drop bed_sizes_text + number_of_beds), and
--        properties_owner_update_guard() (bed_sizes overlays the 4 bed columns;
--        derive number_of_beds + auto-fill towels on owner bed increase) here,
--        copied from the current bodies with only the documented changes.
```

Guard derived-logic block (owner branch, after overlays), per spec part e — implement exactly:
```sql
-- inside the owner branch of properties_owner_update_guard, after per-field overlays:
IF (result.king_beds IS DISTINCT FROM OLD.king_beds
     OR result.queen_beds IS DISTINCT FROM OLD.queen_beds
     OR result.full_beds  IS DISTINCT FROM OLD.full_beds
     OR result.twin_beds  IS DISTINCT FROM OLD.twin_beds) THEN
  DECLARE
    new_sum INT := coalesce(result.king_beds,0)+coalesce(result.queen_beds,0)+coalesce(result.full_beds,0)+coalesce(result.twin_beds,0);
    old_sum INT := coalesce(OLD.king_beds,0)+coalesce(OLD.queen_beds,0)+coalesce(OLD.full_beds,0)+coalesce(OLD.twin_beds,0);
    sleep INT;
  BEGIN
    result.number_of_beds := new_sum;
    IF new_sum > old_sum THEN
      sleep := CASE WHEN coalesce(result.guest_count,0) > 0 THEN result.guest_count
                    ELSE coalesce(result.king_beds,0)*2 + coalesce(result.queen_beds,0)*2
                       + coalesce(result.full_beds,0)*2 + coalesce(result.twin_beds,0)*1 END;
      result.hand_towels := sleep;
      result.washcloths  := sleep;
      result.bath_towels := sleep + coalesce(result.full_baths,0);
      result.bathmats    := coalesce(result.full_baths,0);
      result.pool_towels := CASE WHEN coalesce(result.hot_tub,false) THEN sleep ELSE 0 END;
      IF coalesce(result.guest_count,0) = 0 AND sleep > 0 THEN result.guest_count := sleep; END IF;
    END IF;
  END;
END IF;
```
(Note: a nested `DECLARE ... BEGIN ... END` block is valid inside plpgsql; or hoist the vars to the function's top DECLARE. Either is fine — keep it compiling.)

- [ ] **Step 3: Apply** via Supabase MCP `apply_migration` (project `eetsudoksvsmwtiqraot`, name `20260702_owner_beds_notes`). Fix + re-apply on error.

- [ ] **Step 4: Verify via `execute_sql`:**
```sql
SELECT column_name FROM information_schema.columns WHERE table_name='property_notes' AND column_name='owner_id';         -- 1 row
SELECT proname FROM pg_proc WHERE proname IN ('owner_add_property_note','get_owner_property_notes');                     -- 2 rows
-- Rick's owned property: confirm the bed columns hold data (spot check the row):
SELECT king_beds, queen_beds, full_beds, twin_beds, number_of_beds FROM properties WHERE name ILIKE 'Rick Aquino Lodge A%';
```
Expected: owner_id present; both RPCs exist; Rick's row shows the bed counts (e.g. 1/2/–/2, total 5).

- [ ] **Step 5: Regenerate types** via Supabase MCP `generate_typescript_types`; overwrite `shared/database.types.ts`. Confirm `property_notes` now has `owner_id` and the two RPCs appear.

- [ ] **Step 6: Typecheck.** `npm run check`. Owner-portal.tsx may show errors from removed fields — expected, fixed in Task 2/3. Note and proceed.

- [ ] **Step 7: Commit.**
```bash
git add supabase/migrations/20260702_owner_beds_notes.sql shared/database.types.ts
git commit -m "feat(db): owner broken-out beds (derive total + auto-fill linens on increase) + owner property notes"
```

---

## Task 2: Owner portal beds UI

**Files:** Modify `client/src/pages/owner-portal.tsx`, `client/src/lib/owners.ts`.

**Interfaces consumed:** `get_owner_properties()` now returns `king_beds`/`queen_beds`/`full_beds`/`twin_beds`/`stage` (Task 1). Produces: `PropertyCard` with four bed inputs, no bed-count; `OWNER_FIELD_DEFS` without `bed_count`.

- [ ] **Step 1: `owners.ts`** — remove the `{ key: 'bed_count', ... }` entry from `OWNER_FIELD_DEFS` (keep `bed_sizes`, label "Bed sizes"). This narrows the derived types.

- [ ] **Step 2: `owner-portal.tsx` `PropertyCard`:**
  - `OwnerProperty` type: remove `bed_sizes_text` and `number_of_beds`; add `king_beds?: number | null`, `queen_beds?: number | null`, `full_beds?: number | null`, `twin_beds?: number | null`.
  - `EDITABLE_COLUMNS`: replace `bed_sizes: ['bed_sizes_text']` with `bed_sizes: ['king_beds','queen_beds','full_beds','twin_beds']`; remove the `bed_count: ['number_of_beds']` entry.
  - In the property-details grid, remove the single "Bed sizes" text field and the "Bed count" numeric field. Under the `bed_sizes` permission, render four numeric inputs labelled King beds / Queen beds / Full beds / Twin beds, each bound to its column, `type="number" min={0}`, using the existing `renderField`/`setNum` patterns (extend `setNum` or add a numeric setter that accepts these four keys). Pre-fill from the property values. When `bed_sizes` is not editable, show `ReadOnlyValue` for each (mirror existing behavior).
  - Keep the existing save mutation as-is (it builds the payload from editable columns and calls `supabase.from('properties').update`). Remove the now-dead `bed_sizes_text`/`number_of_beds` references and any numeric-validation that referenced `number_of_beds` (keep `square_footage` validation).

- [ ] **Step 3: Typecheck.** `npm run check` — expect PASS (no dangling refs).

- [ ] **Step 4: Manual (dev server, Rick owner account):** beds pre-fill (King 1 / Queen 2 / Full – / Twin 2); no bed-count field; editing a bed and Save persists.

- [ ] **Step 5: Commit.**
```bash
git add client/src/pages/owner-portal.tsx client/src/lib/owners.ts
git commit -m "feat(owner-portal): broken-out bed-size fields, remove bed count"
```

---

## Task 3: Owner portal notes section + payment dropdown

**Files:** Modify `client/src/pages/owner-portal.tsx` (and optionally add helpers to `client/src/lib/owners.ts`).

**Interfaces consumed:** RPCs `get_owner_property_notes(p_property_id)`, `owner_add_property_note(p_property_id, p_content)` (Task 1). Produces: `OwnerNotesSection` under Wi-Fi in `PropertyCard`; payment `<select>` in `ContactPaymentCard`.

- [ ] **Step 1: Notes section.** Add an `OwnerNotesSection({ propertyId }: { propertyId: number })` component in `owner-portal.tsx`:
  - `useQuery(['owner-property-notes', propertyId], () => supabase.rpc('get_owner_property_notes', { p_property_id: propertyId }))` → list newest-first (fields id/content/created_at; format date with the existing `formatDate`).
  - A `Textarea` + "Add note" `Button`; on submit `supabase.rpc('owner_add_property_note', { p_property_id: propertyId, p_content: text })`, then invalidate `['owner-property-notes', propertyId]`, clear the box, success toast. Disable when empty/pending. Errors → destructive toast.
  - Header label "Notes". Loading `Skeleton`, error `ErrorState`, empty copy "No notes yet." (no em dashes).
  - Render it inside the property-details `CardContent`, immediately after the Wi-Fi field block (below Wi-Fi), inside the same card. It is always shown (not permission-gated).

- [ ] **Step 2: Payment dropdown.** In `ContactPaymentCard`, replace the payment-method `Input`+`datalist` with a native `<select>` (styled like other selects in the file, e.g. the testimonial `<select>` classes) offering options: an empty placeholder ("Select a method"), "QuickBooks", "Bill.com". Bind to `form.preferred_payment_method`; keep the same save path (`owner_update_self_contact`) and the existing `dirty` gating.

- [ ] **Step 3: Typecheck.** `npm run check` — PASS.

- [ ] **Step 4: Manual (Rick):** add a note → it appears in the list; reload persists. Payment dropdown shows QuickBooks/Bill.com and saves.

- [ ] **Step 5: Commit.**
```bash
git add client/src/pages/owner-portal.tsx client/src/lib/owners.ts
git commit -m "feat(owner-portal): per-property owner notes + QuickBooks/Bill.com payment dropdown"
```

---

## Task 4: Staff-side owner-note attribution

**Files:** Modify `client/src/components/PropertyNotesFeed.tsx`.

**Interfaces consumed:** `property_notes.owner_id` (Task 1). Produces: an "Owner" badge on owner-authored notes in the staff feed.

- [ ] **Step 1:** Add `owner_id` to the `property_notes` select in `PropertyNotesFeed` and to its note type. Owner notes have `context = NULL` so they already appear in the staff Notes tab.

- [ ] **Step 2:** Where the note author (`created_by`) is rendered, when `owner_id` is not null, render a small "Owner" badge next to the name (use the existing `Badge` component or a `text-2xs` pill with semantic tokens — match the file's existing chip style). The `created_by` already holds the owner's name (set by the RPC), so no join is needed.

- [ ] **Step 3: Typecheck.** `npm run check` — PASS.

- [ ] **Step 4: Manual:** a note added by Rick in the portal shows in the property's staff Notes tab with an "Owner" badge and Rick's name; staff-authored notes have no badge and are NOT visible in Rick's portal.

- [ ] **Step 5: Commit.**
```bash
git add client/src/components/PropertyNotesFeed.tsx
git commit -m "feat(notes): show Owner badge for owner-authored property notes"
```

---

## Task 5: Docs, deploy, verification, merge

**Files:** Modify `CLAUDE.md`.

- [ ] **Step 1: CLAUDE.md** — owner-portal notes: beds are broken out (King/Queen/Full/Twin) writing the real columns; `number_of_beds` auto-derived + auto-fill-from-beds runs server-side (guard trigger) on owner bed increase; owners add per-property notes (own notes only; staff see them with an Owner badge); payment method is QuickBooks/Bill.com. Database: `property_notes.owner_id`; RPCs `owner_add_property_note`/`get_owner_property_notes`; field-permission keys now 7 (dropped `bed_count`, `bed_sizes` governs the four bed columns); note `get_owner_properties()` stage field restored. Add `20260702_owner_beds_notes.sql` to Recent Migrations.

- [ ] **Step 2: Commit docs.**
```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for owner beds/notes/payment changes"
```

- [ ] **Step 3: Push + PR.**
```bash
git push -u origin claude/owner-portal-beds-notes-7817
gh pr create --title "Owner portal: broken-out beds + auto-fill linens, owner notes, payment options" --body "<summary; links to spec + plan; 🤖 Generated with Claude Code>"
```

- [ ] **Step 4: Verify on Vercel preview / prod (Rick owner account + a staff admin):**
  1. Beds pre-fill correctly; no bed-count field.
  2. Increase a bed count → Save → staff Operations tab shows recomputed towels (hand/wash = sleep, bath = sleep+full_baths, bathmats = full_baths, pool = sleep iff hot_tub) and updated total beds.
  3. Decreasing / non-bed edits do NOT wipe towels or number_of_beds.
  4. Payment dropdown offers QuickBooks/Bill.com and persists.
  5. Owner adds a note → visible in staff Notes tab with "Owner" badge; owner does NOT see staff notes.
  6. Settings → Owners permission dialog lists 7 keys (no "Bed count").

- [ ] **Step 5: Merge** (squash + delete branch) once CI is green.

---

## Self-Review
- Beds broken out + pre-filled + editable + same columns → Task 1 (RPC output) + Task 2 (UI). ✓
- Bed count removed; number_of_beds auto-derived → Task 1 (guard) + Task 2 (UI). ✓
- Auto-fill on increase server-side → Task 1 guard derived-logic. ✓
- Payment QuickBooks/Bill.com → Task 3 Step 2. ✓
- Owner notes under Wi-Fi, own-only, staff-visible with source → Task 1 (RPCs + owner_id) + Task 3 (UI) + Task 4 (badge). ✓
- Stage regression fix → Task 1 get_owner_properties. ✓
- Types consistency: RPC names/params (`owner_add_property_note(p_property_id,p_content)`, `get_owner_property_notes(p_property_id)`) match Task 3 calls; `EDITABLE_COLUMNS.bed_sizes` columns match the guard's overlaid columns and `get_owner_properties` output. ✓
