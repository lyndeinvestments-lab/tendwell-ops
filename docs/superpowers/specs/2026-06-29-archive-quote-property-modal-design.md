# Archive Quote from the Property Modal — Design

**Date:** 2026-06-29
**Status:** Approved, ready for implementation plan

## Problem

A quote can be archived from the quote sheet today, but not from the property detail modal. Operators reviewing a property in the modal have no way to archive a quote that did not pan out without leaving the modal and finding the row in the quote sheet. We want an Archive action available directly in the property modal, gated so it only appears for properties in the Quote stage.

## Background / current state

Archive is **already fully implemented in the quote sheet** (`client/src/pages/quote-sheet.tsx`):

- `archiveQuote` / `restoreQuote` mutations via `useGuardedMutation` (lines ~492-526).
- Per-row Archive / Restore buttons (lines ~867-910).
- A required-reason confirmation dialog (lines ~1318-1362).
- An active / archived / all view filter that hides archived quotes by default.

Archive is **non-destructive**. It writes three existing columns on the `properties` table:

- `archived_at: string | null` — ISO timestamp.
- `archived_reason: string | null` — required free text.
- `archived_by: string | null` — user label.

These columns already exist (migration `supabase/migrations/20260501_quote_archive_fields.sql`). All data access is client to Supabase directly (no Express CRUD endpoints), guarded by `useGuardedMutation` for role-based edit permission.

The property modal (`client/src/components/PropertyDetailModal.tsx`) currently has **no** archive action. It fetches the property with its stage via:

```ts
supabase.from('properties')
  .select('*, pipeline_stages!properties_stage_id_fkey(id, name, color)')
  .eq('id', Number(propertyId)).single()
```

Stage values come from `usePipelineStages()`; the Quote stage is found by `stages.find(s => s.name === 'Quote')`.

## Scope

In scope:

- Add an Archive action and a Restore action to the property modal's **header action group** (beside the existing copy/edit icon buttons).
- A confirmation dialog for archive that requires a reason, mirroring the quote-sheet dialog.

Out of scope:

- No changes to the quote sheet (archive already works there and is implicitly stage-correct because it only queries Quote-stage properties).
- No database/schema changes (columns already exist).
- No new Express/API endpoints.
- No extraction of a shared archive-dialog component (inline in the modal for now; revisit only if a third caller appears).

## Visibility rules

Computed in the modal from the fetched property and `usePipelineStages()`:

```ts
const quoteStage = stages?.find(s => s.name === 'Quote')
const isQuoteStage = property?.stage_id === quoteStage?.id
const isArchived = !!property?.archived_at
```

- **Archive button** renders only when `isQuoteStage && !isArchived`.
- **Restore button** renders only when `isArchived` (any stage, so an archived quote can always be un-archived from its modal).
- Otherwise neither button renders.

## Archive flow

1. Click **Archive** to open the confirmation dialog. Copy mirrors the quote sheet: explains the property stays in the database and is hidden from the quote sheet by default and can be restored any time. A **required** reason textarea.
2. Confirm (disabled until reason is non-empty) runs `useGuardedMutation` to update:
   - `archived_at = new Date().toISOString()`
   - `archived_reason = reason.trim()`
   - `archived_by = effectiveUser?.label ?? null`
   on `properties` where `id = property.id`.
3. On success: toast "Quote archived"; invalidate property caches via `invalidateAllPropertyQueries(qc)` plus the quote-sheet query key; close the dialog. The modal stays open; its property query refetches and the header button flips from Archive to Restore automatically.
4. On error: destructive toast with the error message.

## Restore flow

- Click **Restore** to clear `archived_at`, `archived_reason`, `archived_by` (matching quote-sheet's `restoreQuote`). No reason required. Toast plus same invalidation. Button flips back to Archive (if still in Quote stage).

## Permissions

Use `useGuardedMutation` with the same view-id the modal already uses for its edit-permission guard (to be confirmed during implementation by reading the modal's existing mutations, not guessed). This ensures read-only users cannot archive.

## Audit logging

Log the archive/restore using the same helper the modal's other field edits use (`logPropertyEdit` / `logActivity` in `client/src/lib/supabase.ts`) so the change appears in the property's activity trail, consistent with other edits.

## Testing / verification

- Typecheck: `npm run check` must pass.
- Manual verification (Playwright against the running app or preview):
  - Open the modal for a Quote-stage property: Archive button visible; archive with a reason gives a toast, button becomes Restore, quote sheet hides it.
  - Restore from the modal: button returns to Archive, quote appears again.
  - Open the modal for a non-Quote-stage, non-archived property: no Archive/Restore button.
  - Read-only user: archive blocked with the guard's toast.

## Files touched

- `client/src/components/PropertyDetailModal.tsx` — add stage/archive state, mutations, header buttons, confirmation dialog.
- (Reference only, no change) `client/src/pages/quote-sheet.tsx`, `client/src/hooks/use-guarded-mutation.ts`, `client/src/hooks/use-pipeline-stages.ts`, `client/src/lib/supabase.ts`, `client/src/lib/query-invalidations.ts`.
