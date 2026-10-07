import { supabase, logActivity, logPropertyEdit } from '@/lib/supabase'
import {
  ONBOARDING_STAGE_ID,
  buildCreatePayload,
  buildMergePatch,
  buildOnboardingNote,
  isBlank,
  noteAlreadyExists,
  planPhotoInserts,
  type Beds,
  type OnboardingSubmission,
  type Pick,
} from '@/lib/onboarding'

/**
 * Writes a reviewed onboarding submission to the database. The pure decisions
 * (what changes, what the note says, which photos are new) live in
 * `lib/onboarding.ts`; this module only sequences the writes.
 *
 * Ordering is the data-loss protection. The property write and the "mark the
 * submission applied" write are the critical pair, and they run first. Notes,
 * photos, stage history and the owner link come after and are best-effort: a
 * failure there is reported as a warning, never rolled into a failed apply that
 * would invite a second, duplicate property. Every follow-up step dedupes, so
 * "Re-apply" on an applied submission safely repairs whichever step failed.
 */

export const onboardingPhotoUrl = (path: string): string =>
  supabase.storage.from('onboarding-uploads').getPublicUrl(path).data.publicUrl

export type ContactAction =
  | { kind: 'none' }
  | { kind: 'use'; contactId: string }
  | { kind: 'create'; name: string; email: string; phone: string }
  | { kind: 'update'; contactId: string; name: string; email: string; phone: string }

export interface ApplyArgs {
  submission: OnboardingSubmission
  /** null = create a new property. */
  propertyId: number | null
  /** The current property row (merge mode). */
  existing: Record<string, any> | null
  /** Editable values (create mode). */
  values: Record<string, any>
  choices: Record<string, Pick>
  overrides: Record<string, unknown>
  beds: Beds
  hasAutoCode: boolean
  contact: ContactAction
  copyPhotos: boolean
  changedBy: string
  staff: { id: number | null; label: string | null }
}

export type ApplyWarningCode = 'stage_history' | 'note' | 'legacy_note' | 'photos' | 'owner_link'
export interface ApplyWarning {
  code: ApplyWarningCode
  detail?: string
}

export interface ApplyResult {
  propertyId: number
  mode: 'create' | 'merge'
  /** Columns changed on the property (merge). */
  filled: number
  photosAdded: number
  noteAdded: boolean
  ownerLinked: boolean
  warnings: ApplyWarning[]
}

/**
 * `mark_failed`: the property was written but the submission could not be marked applied, so a
 * retry of a *create* would duplicate it. `already_applied`: somebody else applied or rejected
 * this submission first (`propertyId` is null when we noticed before writing anything).
 */
export class ApplyError extends Error {
  constructor(
    public code: 'mark_failed' | 'already_applied',
    public propertyId: number | null,
    public detail: string,
    public mode: 'create' | 'merge',
  ) {
    super(detail)
    this.name = 'ApplyError'
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : (e as any)?.message ?? String(e))

async function createContact(c: { name: string; email: string; phone: string }): Promise<string> {
  const { data, error } = await supabase
    .from('contacts')
    .insert({ full_name: c.name.trim(), email: c.email || null, phone: c.phone || null, source: 'Onboarding' } as any)
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

/**
 * Claims the submission. The `status = 'pending'` filter is the lock: if another
 * staff member applied or rejected it first, zero rows update and we say so
 * instead of converting it twice.
 */
async function markApplied(sub: OnboardingSubmission, propertyId: number, changedBy: string, mode: 'create' | 'merge') {
  const { data, error } = await supabase
    .from('onboarding_submissions')
    .update({
      status: 'converted',
      approved_at: new Date().toISOString(),
      approved_by: changedBy,
      property_id: propertyId,
    })
    .eq('id', sub.id)
    .eq('status', 'pending')
    .select('id')
  if (error) throw new ApplyError('mark_failed', propertyId, error.message, mode)
  if (!data || data.length === 0) throw new ApplyError('already_applied', propertyId, '', mode)
}

/** Fresh read before any write, so a stale list row cannot create a second property for the same submission. */
async function assertStillPending(sub: OnboardingSubmission, mode: 'create' | 'merge') {
  if (sub.status !== 'pending') return // re-applying an applied row: nothing to claim
  const { data, error } = await supabase.from('onboarding_submissions').select('status').eq('id', sub.id).single()
  if (error) throw error
  if ((data as { status?: string } | null)?.status !== 'pending') throw new ApplyError('already_applied', null, '', mode)
}

/** Removes a client row this apply just inserted when the write it was for failed. Best effort. */
async function discardContact(id: string | null) {
  if (!id) return
  try { await supabase.from('contacts').delete().eq('id', id) } catch { /* nothing more to do */ }
}

export async function applySubmission(a: ApplyArgs): Promise<ApplyResult> {
  const sub = a.submission
  const warnings: ApplyWarning[] = []
  const isMerge = a.propertyId != null
  let propertyId: number
  let propertyName: string | null
  let filled = 0
  let legacyNotesBlank = true

  await assertStillPending(sub, isMerge ? 'merge' : 'create')

  if (!isMerge) {
    // ── Create ────────────────────────────────────────────────────────────
    let contactId: string | null = null
    let createdContactId: string | null = null
    if (a.contact.kind === 'use') contactId = a.contact.contactId
    else if (a.contact.kind === 'create') contactId = createdContactId = await createContact(a.contact)

    const payload = buildCreatePayload({ submission: sub, values: a.values, beds: a.beds, hasAutoCode: a.hasAutoCode, contactId })
    const { data: np, error } = await supabase.from('properties').insert(payload as any).select('id,name').single()
    if (error) {
      // No property was made, so do not leave the client row we just inserted behind.
      await discardContact(createdContactId)
      throw error
    }
    propertyId = Number(np.id)
    propertyName = np.name ?? null
    await markApplied(sub, propertyId, a.changedBy, 'create')

    // Same audit trail a stage move writes: a stage_transitions row (no "from"
    // stage: it was born in Onboarding) and the activity feed entry.
    try {
      const { error: stErr } = await supabase.from('stage_transitions').insert({
        property_id: propertyId,
        from_stage_id: null,
        to_stage_id: ONBOARDING_STAGE_ID,
        transitioned_by: a.changedBy,
        notes: 'Created from an onboarding submission',
        created_at: new Date().toISOString(),
      })
      if (stErr) throw stErr
    } catch (e) {
      warnings.push({ code: 'stage_history', detail: msg(e) })
    }
    await logActivity({
      entity_type: 'property',
      entity_id: propertyId,
      entity_name: propertyName,
      action: 'create',
      field_name: 'stage',
      new_value: 'Onboarding',
      changed_by: `${a.changedBy} (onboarding create)`,
      metadata: { source: 'onboarding_submission', submission_id: sub.id, submission_source: sub.source },
    })
  } else {
    // ── Merge ─────────────────────────────────────────────────────────────
    propertyId = a.propertyId!
    const existing = a.existing!
    propertyName = existing.name ?? null
    legacyNotesBlank = isBlank(existing.notes)
    let createdContactId: string | null = null
    const patch = buildMergePatch({
      submission: sub,
      existing,
      choices: a.choices,
      beds: a.beds,
      hasAutoCode: a.hasAutoCode,
      overrides: a.overrides,
    })

    if (a.contact.kind === 'update') {
      const { error } = await supabase
        .from('contacts')
        .update({ full_name: a.contact.name.trim(), email: a.contact.email || null, phone: a.contact.phone || null, updated_at: new Date().toISOString() } as any)
        .eq('id', a.contact.contactId)
      if (error) throw error
    } else if (a.contact.kind === 'use') {
      patch.contact_id = a.contact.contactId
    } else if (a.contact.kind === 'create') {
      patch.contact_id = createdContactId = await createContact(a.contact)
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from('properties').update(patch as any).eq('id', propertyId)
      if (error) {
        await discardContact(createdContactId)
        throw error
      }
      for (const [field, newValue] of Object.entries(patch)) {
        await logPropertyEdit(propertyId, field, existing[field] ?? null, newValue ?? null, propertyName, `${a.changedBy} (onboarding merge)`)
      }
    }
    filled = Object.keys(patch).length
    // Re-applying an already applied submission must not rewrite who/when approved it.
    if (sub.status === 'pending') await markApplied(sub, propertyId, a.changedBy, 'merge')
  }

  // ── Best-effort, idempotent follow-ups ──────────────────────────────────
  let noteAdded = false
  try {
    const note = buildOnboardingNote(sub, onboardingPhotoUrl)
    if (note) {
      const { data: rows, error } = await supabase
        .from('property_notes')
        .select('content')
        .eq('property_id', propertyId)
        .like('content', 'Onboarding form%')
      if (error) throw error
      if (!noteAlreadyExists((rows ?? []).map(r => r.content as string), note.key)) {
        const { error: insErr } = await supabase.from('property_notes').insert({
          property_id: propertyId,
          content: note.content,
          context: null,
          created_by: a.staff.label,
          created_by_user_id: a.staff.id,
        })
        if (insErr) throw insErr
        noteAdded = true
        // Keep the legacy list-preview column in step, like the Notes tab does,
        // but never overwrite text staff already put there.
        if (legacyNotesBlank) {
          const { error: legacyErr } = await supabase.from('properties').update({ notes: note.content }).eq('id', propertyId)
          if (legacyErr) warnings.push({ code: 'legacy_note', detail: legacyErr.message })
        }
      }
    }
  } catch (e) {
    warnings.push({ code: 'note', detail: msg(e) })
  }

  let photosAdded = 0
  if (a.copyPhotos && (sub.photos ?? []).length > 0) {
    try {
      const { data: have, error } = await supabase
        .from('property_photos')
        .select('photo_url,sort_order')
        .eq('property_id', propertyId)
      if (error) throw error
      const nextOrder = (have ?? []).reduce((m, r) => Math.max(m, (r.sort_order ?? -1) + 1), 0)
      const rows = planPhotoInserts(sub.photos, (have ?? []).map(r => r.photo_url as string), onboardingPhotoUrl, nextOrder)
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('property_photos').insert(rows.map(r => ({ property_id: propertyId, ...r })))
        if (insErr) throw insErr
        photosAdded = rows.length
      }
    } catch (e) {
      warnings.push({ code: 'photos', detail: msg(e) })
    }
  }

  // The owner who filed this form gets portal access to the property their
  // submission created. owner_properties writes are admin-only, so this goes
  // through the narrow RPC. It is idempotent and guarded (the submission must be
  // an owner-portal one, applied within the last 30 days, onto an Onboarding
  // property nobody owns yet; or the owner is already linked), so it runs on
  // every apply, Re-apply included: that is what repairs a link that failed the
  // first time. A deployment without the RPC falls back to a direct insert
  // (admins only); any other failure is reported as a warning.
  let ownerLinked = false
  if (sub.owner_id) {
    try {
      const { data, error } = await supabase.rpc('onboarding_link_owner_property' as never, { p_submission_id: sub.id } as never)
      if (error) {
        if (error.code !== 'PGRST202' && error.code !== '42883') throw error
        const { error: insErr } = await supabase.from('owner_properties').insert({ owner_id: sub.owner_id, property_id: propertyId })
        if (insErr && insErr.code !== '23505') throw insErr
        ownerLinked = true
      } else {
        ownerLinked = data === true
        if (!ownerLinked) warnings.push({ code: 'owner_link' })
      }
    } catch (e) {
      warnings.push({ code: 'owner_link', detail: msg(e) })
    }
  }

  return { propertyId, mode: isMerge ? 'merge' : 'create', filled, photosAdded, noteAdded, ownerLinked, warnings }
}
