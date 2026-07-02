# Owner Portal — Broken-out Beds, Auto-fill Linens, Payment Options, Owner Notes

**Date:** 2026-07-02
**Branch:** `claude/owner-portal-beds-notes-7817`
**Status:** Design approved (detailed spec from user); proceeding to implementation.

---

## Problem / Goals

1. **Beds show empty** in the owner portal because it renders the free-text `bed_sizes_text`, while the real data lives in per-size count columns (`king_beds`/`queen_beds`/`full_beds`/`twin_beds`) shown in the staff PropertyDetailModal → Operations → LINENS. Rick's portal shows blank bed sizes even though staff has King 1 / Queen 2 / Twin 2.
   - Owner portal must show the **same broken-out bed-size fields** (King/Queen/Full/Twin), pre-filled from those columns, editable, writing back to the same columns so staff and owner see one source of truth.
2. **Bed count field must go** from the owner portal. `number_of_beds` becomes **auto-derived** (sum of the four bed counts) whenever the owner changes beds.
3. When the owner **increases** the bed total, the existing **auto-fill-from-beds** linen formula must run **on the backend** and update the linen par levels (towels) shown on the Operations tab.
4. **Preferred payment method** (owner-wide card) becomes a choice of **QuickBooks** or **Bill.com** (was free text).
5. **Owner notes:** a per-property "Notes" field under Wi-Fi. Owners add notes that are **visible to staff with owner attribution**; staff-authored notes must **not** be shown to the owner.

## Non-goals
- No change to staff bed/linen editing (staff keep the manual "Auto-fill from beds" button; the guard-trigger auto-fill applies to owner updates only).
- Not tightening the pre-existing broad `property_notes` RLS (`USING(true)`); owner privacy for this feature is enforced via SECURITY DEFINER RPCs. (Noted as a separate latent concern.)
- `bed_sizes_text` column is left in place (no longer used by the portal); not dropped.

---

## Confirmed data model
- `properties`: `king_beds`, `queen_beds`, `full_beds`, `twin_beds`, `number_of_beds`, `bed_sizes_text`, `guest_count`, `full_baths` (all `numeric | null`), `hot_tub` (`boolean | null`), towels `bath_towels`/`hand_towels`/`washcloths`/`bathmats`/`pool_towels`. **No `has_pool` column** (pool towels key off `hot_tub` only). No `sofa_beds` column.
- Auto-fill formula (`client/src/lib/linen-calc.ts`, Haven rules): `sleep = guest_count if >0 else king*2+queen*2+full*2+twin*1`; `hand_towels=sleep`; `washcloths=sleep`; `bath_towels=sleep+full_baths`; `bathmats=full_baths`; `pool_towels = sleep if hot_tub else 0`.
- `number_of_beds` feeds `recalc_property_formulas()` (est_laundry/est_consumables/linen_program_cost) — deriving it from bed sums keeps financials correct.
- `property_notes`: `id`, `property_id`, `content`, `context` (null=general, 'linen'=linen notes), `created_at`, `created_by` (text label), `created_by_user_id` (int FK app_users). RLS is `FOR ALL TO authenticated USING(true)`. Rendered by `PropertyNotesFeed` (Notes tab uses context=null; Linen Notes uses context='linen').
- Owner portal plumbing: `get_owner_properties()` (returns visible fields + permissions), `properties_owner_update_guard` (owner-writable overlay per permission), `owner_field_permissions_default()` + `OWNER_FIELD_DEFS` (currently 8 keys incl. `bed_sizes`→bed_sizes_text and `bed_count`→number_of_beds). A prior migration (`20260626`) added a `stage` field to `get_owner_properties()` that `20260701` accidentally dropped — restore it.

---

## Design

### Migration `20260702_owner_beds_notes.sql`

**a. property_notes owner attribution**
```sql
ALTER TABLE property_notes
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES property_owners(id) ON DELETE SET NULL;
```
A note is owner-authored iff `owner_id IS NOT NULL`.

**b. Owner note RPCs (SECURITY DEFINER, caller-scoped)**
- `owner_add_property_note(p_property_id bigint, p_content text) RETURNS jsonb` — requires `current_owner_id()` not null AND `owner_owns_property(p_property_id)`; inserts `property_notes(property_id, content, context=NULL, created_by=<owner name>, owner_id=current_owner_id())`; returns the new row. Rejects blank content.
- `get_owner_property_notes(p_property_id bigint) RETURNS SETOF jsonb` — requires ownership; returns only rows for that property where `owner_id = current_owner_id()` (the owner's own notes — never staff notes), newest first. Fields: id, content, created_at.

**c. Permission model: repurpose `bed_sizes`, drop `bed_count`**
- `owner_field_permissions_default()` → 7 keys: `address`, `bed_sizes`, `square_footage`, `door_code`, `auto_code`, `other_codes`, `wifi_info` (drop `bed_count`). `bed_sizes` now governs the four per-size bed columns.

**d. `get_owner_properties()` rewrite**
- Keep the existing visibility-gated fields; under the `bed_sizes` visibility gate return `king_beds`, `queen_beds`, `full_beds`, `twin_beds` (instead of `bed_sizes_text`). Drop `bed_sizes_text` and `number_of_beds` from output. **Restore the `stage` field** (regression fix). Emit permission keys for the 7 keys.

**e. `properties_owner_update_guard()` rewrite (owner branch only)**
- Staff bypass unchanged (`is_staff()` → RETURN NEW).
- Owner overlay: when `bed_sizes` editable, overlay `king_beds`/`queen_beds`/`full_beds`/`twin_beds` from NEW (instead of bed_sizes_text). Keep the other 6 keys' overlays. `number_of_beds` and towels are NOT directly owner-writable.
- **Derived logic (owner branch), only when the bed columns actually changed** (`result.king_beds IS DISTINCT FROM OLD.king_beds OR ...`):
  - `new_sum = coalesce(king,0)+coalesce(queen,0)+coalesce(full,0)+coalesce(twin,0)`; `old_sum` from OLD.
  - `result.number_of_beds := new_sum`.
  - IF `new_sum > old_sum` (bed total increased): run the auto-fill formula on `result` —
    `sleep := CASE WHEN coalesce(result.guest_count,0) > 0 THEN result.guest_count ELSE coalesce(king,0)*2+coalesce(queen,0)*2+coalesce(full,0)*2+coalesce(twin,0)*1 END`;
    `result.hand_towels := sleep`; `result.washcloths := sleep`; `result.bath_towels := sleep + coalesce(result.full_baths,0)`; `result.bathmats := coalesce(result.full_baths,0)`; `result.pool_towels := CASE WHEN coalesce(result.hot_tub,false) THEN sleep ELSE 0 END`;
    IF `coalesce(result.guest_count,0) = 0 AND sleep > 0` THEN `result.guest_count := sleep`.
  - Conditioning derivation on "beds changed" prevents an unrelated update (e.g. Wi-Fi) from zeroing `number_of_beds` on properties whose bed columns are null.
- `result.updated_at := now()`; RETURN result.

Reproduce the current function bodies from `20260701_owner_account.sql` (and the `stage` line from `20260626_owner_properties_include_stage.sql`) verbatim, changing only what this spec lists.

Regenerate `shared/database.types.ts` after applying.

### Owner portal — `client/src/pages/owner-portal.tsx` + `client/src/lib/owners.ts`

- `OWNER_FIELD_DEFS`: remove `bed_count`; keep `bed_sizes` (label "Bed sizes").
- `PropertyCard`:
  - `OwnerProperty` type: add `king_beds`/`queen_beds`/`full_beds`/`twin_beds` (`number|null`); remove `bed_sizes_text`, `number_of_beds`.
  - `EDITABLE_COLUMNS`: `bed_sizes: ['king_beds','queen_beds','full_beds','twin_beds']`; remove `bed_count`.
  - Render under the `bed_sizes` permission: four numeric inputs (King/Queen/Full/Twin), pre-filled, `min={0}`. Remove the single bed-sizes text field and the bed-count field. The existing save path (build payload from editable columns → `supabase.from('properties').update`) works unchanged; the guard derives number_of_beds + linens.
  - **Notes section** below Wi-Fi: an `OwnerNotesSection({ propertyId })` — lists the owner's notes via `get_owner_property_notes`, and a textarea + "Add note" button calling `owner_add_property_note`; invalidates on success. Header label "Notes". Always shown (no permission key). Owner-facing copy: no em dashes.
- `ContactPaymentCard`: replace the payment `datalist` free-text input with a `<select>` offering "QuickBooks" and "Bill.com" (plus a blank/placeholder option so an unset value renders cleanly). Save path unchanged (`owner_update_self_contact`).

### Staff side — `client/src/components/PropertyNotesFeed.tsx`
- Add `owner_id` to the note select. When `owner_id` is present, render an **"Owner" badge** next to the author name (which already holds the owner's name via the RPC). No other change; owner notes (context=null) already appear in the staff Notes tab.

---

## Files touched
- `supabase/migrations/20260702_owner_beds_notes.sql` — new
- `shared/database.types.ts` — regenerate
- `client/src/lib/owners.ts` — `OWNER_FIELD_DEFS` (drop bed_count); add `get_owner_property_notes`/`owner_add_property_note` client helpers if a lib home is preferred (or call `supabase.rpc` inline)
- `client/src/pages/owner-portal.tsx` — beds UI, remove bed count, notes section, payment dropdown
- `client/src/components/PropertyNotesFeed.tsx` — owner attribution badge
- `CLAUDE.md` — update

## Security notes
- Owner note read/write go through SECURITY DEFINER RPCs scoped to `current_owner_id()` + `owner_owns_property()`, so owners never see staff notes through the portal and can only write to their own properties.
- Bed writes remain gated by the `bed_sizes` permission in the guard; `number_of_beds`/towels are derived server-side, never client-supplied.

## Testing
- `npm run check`.
- Manual (owner test account = Rick): beds pre-fill (King 1/Queen 2/Full –/Twin 2), no bed-count field; increasing a bed count saves, and the staff Operations tab shows recomputed towels + updated total beds; payment dropdown offers QuickBooks/Bill.com; owner adds a note → appears in staff Notes tab with an "Owner" badge; owner does NOT see staff notes.
- Staff regression: Settings → Owners permission dialog lists 7 keys (no "Bed count"); PropertyDetailModal beds/linens unaffected by staff edits.
