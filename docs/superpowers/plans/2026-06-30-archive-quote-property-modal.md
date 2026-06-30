# Archive Quote from the Property Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Archive and Restore actions to the property detail modal's header, visible only for Quote-stage properties, mirroring the quote sheet's existing archive behavior.

**Architecture:** Pure client-side change in one component (`PropertyDetailModal.tsx`). Two `useGuardedMutation` hooks write the existing `archived_at` / `archived_reason` / `archived_by` columns on `properties` directly via the Supabase client. Visibility is derived from the property's stage (`property.stage_id` vs the Quote stage from `usePipelineStages()`) and `property.archived_at`. A required-reason confirmation dialog reuses the quote sheet's pattern.

**Tech Stack:** React 18 + TypeScript, TanStack React Query 5, Supabase client, Shadcn/Radix `Dialog`/`Button`/`Label`, Lucide icons, `useGuardedMutation` hook.

## Global Constraints

- No new DB migration: `archived_at` (ISO timestamp string), `archived_reason` (text), `archived_by` (text) already exist on `properties`.
- No Express/API endpoint: data access is client to Supabase directly (RLS-enforced).
- Permission gate for archive/restore: `canEditView('quote-sheet', effectiveUser)` and `useGuardedMutation('quote-sheet', …)`, identical to the quote sheet, so the same users can archive from either place.
- Audit trail is the three archive columns themselves. Do NOT add a separate `logActivity`/`logPropertyEdit` call: match the quote sheet exactly.
- Styling: Tailwind + `cn()` only, no inline styles for the new buttons; Lucide icons only; copy must avoid em dashes (use commas, colons, periods).
- Archive requires a non-empty reason; Restore requires no reason.
- Type-check must pass: `npm run check` (exit 0). No component test infra exists, so verification is type-check + manual Playwright.

---

### Task 1: Add Archive/Restore to the property modal

**Files:**
- Modify: `client/src/components/PropertyDetailModal.tsx`
  - Import line: `client/src/components/PropertyDetailModal.tsx:6` (add `useGuardedMutation` import after it)
  - Derived permission/stage flags: near `client/src/components/PropertyDetailModal.tsx:1037-1052`
  - Mutations + dialog state: near `client/src/components/PropertyDetailModal.tsx:1052-1055` (alongside `changeStage`)
  - Header action group: `client/src/components/PropertyDetailModal.tsx:1189-1232`
  - Dialog JSX: just after the main modal's closing `</Dialog>` (pairs with `client/src/components/PropertyDetailModal.tsx:1114`)

**Interfaces:**
- Consumes (already in file): `effectiveUser` from `useAuth()` (line 759); `qc` from `useQueryClient()` (line 763); `toast` from `useToast()` (line 760); `property` from the detail query (line 779, has `stage_id` and `archived_at`); `allStages` from `usePipelineStages()` (line 1052); `closePropertyModal` (line 758); `canEditView`, `canAccessView` from `@/lib/auth` (line 6); `invalidateAllPropertyQueries` (line 13); `Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter` (line 17); `Button` (line 19); `Label` (line 21).
- Produces: no exported surface, all internal to the component.

- [ ] **Step 1: Add the `useGuardedMutation` import**

In `client/src/components/PropertyDetailModal.tsx`, immediately after line 6 (`import { useAuth, canAccessView, canEditView } from '@/lib/auth'`), add:

```ts
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
```

- [ ] **Step 2: Add the `Archive` and `ArchiveRestore` icons to the existing lucide import**

Edit line 25 (`import { Pencil, X, Loader2, Copy, Check, Users, ExternalLink, Plus, ChevronDown } from 'lucide-react'`) to add `Archive` and `ArchiveRestore`:

```ts
import { Pencil, X, Loader2, Copy, Check, Users, ExternalLink, Plus, ChevronDown, Archive, ArchiveRestore } from 'lucide-react'
```

- [ ] **Step 3: Add derived archive flags (and widen the stages query)**

The existing block at lines 1047-1052 is:

```ts
  const canChangeStage = canEditView('property-list', effectiveUser)

  const stageColor = property?.pipeline_stages?.color || '#6b7280'
  const stageName = property?.pipeline_stages?.name || '—'

  const { data: allStages } = usePipelineStages({ enabled: canChangeStage && !!propertyId })
```

Replace it with (declares `canArchiveQuote` before it is used in the `enabled` flag, and adds the derived archive flags):

```ts
  const canChangeStage = canEditView('property-list', effectiveUser)
  // Archive is a quote-stage action mirroring the quote sheet. Gate on the same
  // permission so the same users can archive from either entry point.
  const canArchiveQuote = canEditView('quote-sheet', effectiveUser)

  const stageColor = property?.pipeline_stages?.color || '#6b7280'
  const stageName = property?.pipeline_stages?.name || '—'

  const { data: allStages } = usePipelineStages({ enabled: (canChangeStage || canArchiveQuote) && !!propertyId })

  const quoteStage = (allStages || []).find((s: any) => s.name === 'Quote')
  const isQuoteStage = !!quoteStage && property?.stage_id === quoteStage.id
  const isArchived = !!property?.archived_at
```

- [ ] **Step 4: Add dialog state**

Alongside `const [stagePopoverOpen, setStagePopoverOpen] = useState(false)` (line 1054), add:

```ts
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveReason, setArchiveReason] = useState('')
```

- [ ] **Step 5: Add the archive + restore mutations**

After the `changeStage` mutation block (ends ~line 1100, just after its `onSuccess`/`onError`), add:

```ts
  const { mutate: archiveQuote, isPending: archivePending } = useGuardedMutation('quote-sheet', {
    mutationFn: async (reason: string) => {
      const { error } = await supabase
        .from('properties')
        .update({
          archived_at: new Date().toISOString(),
          archived_reason: reason,
          archived_by: effectiveUser?.label ?? null,
        })
        .eq('id', Number(propertyId!))
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Quote archived' })
      invalidateAllPropertyQueries(qc)
      qc.invalidateQueries({ queryKey: ['/supabase/quote-sheet'] })
      qc.invalidateQueries({ queryKey: ['/supabase/property-detail', propertyId] })
      setArchiveOpen(false)
      setArchiveReason('')
    },
    onError: (e: any) => toast({ title: 'Failed to archive', description: e?.message, variant: 'destructive' }),
  })

  const { mutate: restoreQuote, isPending: restorePending } = useGuardedMutation('quote-sheet', {
    mutationFn: async () => {
      const { error } = await supabase
        .from('properties')
        .update({ archived_at: null, archived_reason: null, archived_by: null })
        .eq('id', Number(propertyId!))
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Quote restored' })
      invalidateAllPropertyQueries(qc)
      qc.invalidateQueries({ queryKey: ['/supabase/quote-sheet'] })
      qc.invalidateQueries({ queryKey: ['/supabase/property-detail', propertyId] })
    },
    onError: (e: any) => toast({ title: 'Failed to restore', description: e?.message, variant: 'destructive' }),
  })
```

- [ ] **Step 6: Add the header buttons**

In the header action group `<div className="flex items-center gap-1 flex-shrink-0">` (line 1189), add these as the FIRST children (before the existing copy button at line 1190), so Archive/Restore sit to the left of the copy/edit icons:

```tsx
              {!isLoading && property && canArchiveQuote && isQuoteStage && !isArchived && (
                <button
                  onClick={() => { setArchiveReason(''); setArchiveOpen(true) }}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
                  title="Archive quote (didn't pan out)"
                  data-testid="modal-archive-btn"
                >
                  <Archive className="w-4 h-4" />
                </button>
              )}
              {!isLoading && property && canArchiveQuote && isArchived && (
                <button
                  onClick={() => restoreQuote()}
                  disabled={restorePending}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  title="Restore quote"
                  data-testid="modal-restore-btn"
                >
                  {restorePending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArchiveRestore className="w-4 h-4" />}
                </button>
              )}
```

- [ ] **Step 7: Add the confirmation dialog**

The component's `return (` currently wraps a single `<Dialog open={!!propertyId} …>…</Dialog>` (opens at line 1114). Wrap that existing `<Dialog>…</Dialog>` in a React fragment and add the archive dialog as a sibling AFTER it:

```tsx
  return (
    <>
      {/* existing <Dialog open={!!propertyId} …> … </Dialog> stays here unchanged */}

      <Dialog open={archiveOpen} onOpenChange={v => !v && !archivePending && setArchiveOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Archive quote</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>Archive <span className="font-medium">{property?.name ?? '—'}</span>?
              The property stays in the database, the quote sheet hides it by default,
              and you can restore it any time.</p>
            <div>
              <Label htmlFor="modal-archive-reason" className="text-xs">
                Reason <span className="text-destructive">*</span>
              </Label>
              <textarea
                id="modal-archive-reason"
                value={archiveReason}
                onChange={e => setArchiveReason(e.target.value)}
                placeholder="e.g. Owner decided to self-manage; price gap; ghosted after follow-up."
                rows={3}
                className="w-full mt-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                data-testid="modal-archive-reason"
                autoFocus
              />
              <p className="text-2xs text-muted-foreground mt-1">
                Required. Visible in the quote sheet's archived view so you can audit why a quote didn't onboard.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setArchiveOpen(false)} disabled={archivePending}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => archiveReason.trim() && archiveQuote(archiveReason.trim())}
              disabled={archivePending || !archiveReason.trim()}
              data-testid="modal-confirm-archive"
            >
              {archivePending ? 'Archiving…' : 'Archive quote'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
```

- [ ] **Step 8: Type-check**

Run: `npm run check`
Expected: exit 0, no TypeScript errors. (The existing `usePipelineStages({ enabled: … })` call confirms the hook accepts an options object, so widening the `enabled` condition is type-safe.)

- [ ] **Step 9: Commit**

```bash
git add client/src/components/PropertyDetailModal.tsx
git commit -m "feat: archive/restore quote from property modal (quote stage only)"
```

---

### Task 2: Manual verification

**Files:** none (verification only).

No automated component test exists in this repo, so verify behavior against the running app (dev server `npm run dev` on port 5000, or the Vercel preview deploy) with Playwright/browser.

- [ ] **Step 1: Archive button visibility**

Open the property modal for a property in the **Quote** stage (from the pipeline or quote sheet) as an admin. Confirm the Archive icon button (`data-testid="modal-archive-btn"`) appears in the header. Open the modal for a property in **Active** (or any non-Quote) stage and confirm no Archive/Restore button shows.

- [ ] **Step 2: Archive flow**

Click Archive, dialog opens. Confirm the "Archive quote" button is disabled until a reason is typed. Enter a reason, confirm. Expect: toast "Quote archived", dialog closes, and the header button switches to Restore (`data-testid="modal-restore-btn"`). Open the quote sheet and confirm the property is hidden from the default Active view and appears under the Archived view with the reason.

- [ ] **Step 3: Restore flow**

With the same property's modal open (now showing Restore), click Restore. Expect: toast "Quote restored", button returns to Archive, and the quote reappears in the quote sheet's Active view.

- [ ] **Step 4: Permission gate**

As a non-admin / read-only user (or via view-as), open a Quote-stage property modal. Confirm the Archive button is hidden (since `canEditView('quote-sheet', …)` is false). If reached via a crafted call, the `useGuardedMutation('quote-sheet', …)` guard blocks it with the read-only toast.

---

## Self-Review

- **Spec coverage:** Archive from modal (Task 1, steps 5-7), Restore from modal (steps 5-6), Quote-stage gating (step 3 + step 6 condition), required reason (step 7 disabled-until-reason), non-destructive + restore copy (step 7), permission gate (Global Constraints + step 6 `canArchiveQuote`), no DB/API change (Global Constraints), audit via columns not logActivity (Global Constraints, documented deviation from spec's speculative audit section), verification incl. read-only (Task 2). Quote sheet unchanged: confirmed, no task touches it.
- **Placeholder scan:** none, all steps contain concrete code/commands.
- **Type consistency:** `archiveQuote(reason: string)` is called with `archiveReason.trim()` (string) in step 7; `restoreQuote()` takes no arg and is called with `()` in step 6, consistent. `canArchiveQuote` declared before its use in the `usePipelineStages` enabled flag (step 3). `quoteStage`/`isQuoteStage`/`isArchived` defined once in step 3, used in step 6.
- **Deviation noted:** the spec's "Audit logging" section floated `logPropertyEdit`/`logActivity`; this plan deliberately omits it to match the quote sheet (the archive columns are the audit trail). Behavior of the two entry points stays identical.
