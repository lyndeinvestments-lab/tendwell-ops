// Redos: a cleaner going back to fix a clean (Breezeway/Trellis "Cleaner
// Callback", "Reclean", "Redo", "... not done").
//
// A clean billed on day D at a property that then gets a callback within a
// week is a question for a human before the client is charged for it: either
// the charge stands (the redo was for something else, or the client caused
// it) or the redo was our fault and the clean is not billed. The engine flags
// such lines `redo_pending` (api/invoices/_engine.ts), and Approve refuses
// them until one of those two decisions is written on the line.
//
// The decision lives in the line's review note as a token ("[redo: bill]" /
// "[redo: no charge]") so it needs no new column, survives reconcile (resolved
// rows are preserved verbatim) and is visible to anyone reading the note.
//
// Keep this file dependency-free: it is imported by the Vite client bundle and
// the NodeNext serverless functions.

export const REDO_PENDING_FLAG = 'redo_pending'

/** A redo task counts against a clean on its own day and up to this many days after. */
export const REDO_WINDOW_DAYS = 7

export type RedoDecision = 'bill' | 'no_charge'

export const REDO_DECISION_LABELS: Record<RedoDecision, string> = {
  bill: 'Bill (charge stands)',
  no_charge: 'No charge (redo was our fault, charge zeroed)',
}

// Every phrase Breezeway/Trellis titles use for "go back and fix it". The
// live vocabulary (shared/aux-tasks.test.ts) has "Cleaner Callback",
// "Cleaner: Callback" and "Cleaner callback needed today - bathrooms…".
const REDO_TITLE_RE =
  /\bcall\s*-?\s*backs?\b|\bre\s*-?\s*clean(s|ed|ing)?\b|\bre\s*-?\s*do(ne)?\b|\bnot\s+(done|completed|finished|cleaned)\b/i

// A task status that says the clean was not done. Neither system has one
// today (Breezeway: Created/Closed/Finished/Overdue/In Progress; Trellis:
// SCHEDULED/COMPLETED/…), so this only fires if one appears.
const REDO_STATUS_RE = /\bnot\s*done\b|\bredo\b|\bre-?clean\b/i

/** Is this task a redo of an earlier clean? Title is the main signal. */
export function isRedoTask(title: string | null | undefined, status?: string | null): boolean {
  if (title && REDO_TITLE_RE.test(title)) return true
  return !!status && REDO_STATUS_RE.test(status)
}

const DECISION_TOKEN_RE = /\[?\s*redo(?:\s+decision)?\s*:\s*(bill|no[\s_-]*charge)\s*\]?/gi

/** The decision written on a line, or null when none (or two conflicting ones) is recorded. */
export function redoDecisionFromNote(note: string | null | undefined): RedoDecision | null {
  const found: RedoDecision[] = []
  const re = new RegExp(DECISION_TOKEN_RE.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(note ?? '')) !== null) {
    const d: RedoDecision = /^bill$/i.test(m[1]) ? 'bill' : 'no_charge'
    if (!found.includes(d)) found.push(d)
  }
  return found.length === 1 ? found[0] : null
}

/** The note with exactly one decision token, replacing any earlier one. */
export function withRedoDecision(note: string | null | undefined, decision: RedoDecision): string {
  const rest = (note ?? '').replace(DECISION_TOKEN_RE, '').replace(/\s{2,}/g, ' ').trim()
  const token = decision === 'bill' ? '[redo: bill]' : '[redo: no charge]'
  return rest ? `${token} ${rest}` : token
}

export interface RedoCheckLine {
  flags: readonly string[] | null
  review_status: string
  line_kind: string
  review_note: string | null
  client_charge_amount: number | string | null
}

/** Why a redo_pending line still blocks Approve, or null when it doesn't.
 *  Mirrored by lineIssues() in client/src/lib/invoices.ts. */
export function redoBlocker(l: RedoCheckLine): string | null {
  if (!(l.flags ?? []).includes(REDO_PENDING_FLAG)) return null
  if (l.review_status === 'excluded' || l.line_kind === 'excluded') return null
  const decision = redoDecisionFromNote(l.review_note)
  if (l.review_status === 'needs_review' || decision == null) {
    return 'A redo/callback followed this clean: decide "bill" (charge stands) or "no charge" (redo was our fault) before approving'
  }
  if (decision === 'no_charge' && Number(l.client_charge_amount ?? 0) !== 0) {
    return 'Redo marked "no charge" but the client charge is not zero: set it to 0 or change the decision to "bill"'
  }
  return null
}
