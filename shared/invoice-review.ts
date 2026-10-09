// Review flags whose resolution must carry a written note.
//
// Dependency-free: imported by the invoicing engine, the approve endpoint and
// the Invoice Reconciliation page, so all three agree on which flags cannot be
// waved through with a bare "Accept".

/** The client charge differs from the last approved/exported invoice for the
 *  same property and service. */
export const CHARGE_CHANGED_FLAG = 'charge_changed_since_last_invoice'

/** A Haven-billed line whose property has no matched Hostaway listing. */
export const NOT_HAVEN_LISTING_FLAG = 'not_haven_listing'

/** Flags that need an explanation in `review_note` before the line can be
 *  resolved: a reviewer must say why the price moved, or why a property that
 *  is not on Haven's Hostaway is being billed to Haven. */
export const RESOLVE_NOTE_FLAGS: readonly string[] = [CHARGE_CHANGED_FLAG, NOT_HAVEN_LISTING_FLAG]

/** A resolution note is substantive when it has some words, not just "ok". */
export const MIN_RESOLVE_NOTE_LENGTH = 10

export function flagsNeedingResolveNote(flags: readonly string[] | null | undefined): string[] {
  return (flags ?? []).filter(f => RESOLVE_NOTE_FLAGS.includes(f))
}

export function resolveNoteOk(note: string | null | undefined): boolean {
  return (note ?? '').trim().length >= MIN_RESOLVE_NOTE_LENGTH
}

/** True when the line carries a note-required flag and has no usable note.
 *  Excluded lines are never billed, so they are exempt. */
export function resolveNoteMissing(l: {
  flags?: readonly string[] | null
  review_note?: string | null
  review_status?: string | null
  line_kind?: string | null
}): boolean {
  if (l.review_status === 'excluded' || l.line_kind === 'excluded') return false
  return flagsNeedingResolveNote(l.flags).length > 0 && !resolveNoteOk(l.review_note)
}
