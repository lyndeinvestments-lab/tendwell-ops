import { describe, expect, it } from 'vitest'
import {
  REDO_PENDING_FLAG,
  isRedoTask,
  redoBlocker,
  redoDecisionFromNote,
  withRedoDecision,
  type RedoCheckLine,
} from './invoice-redo'

describe('isRedoTask', () => {
  it('catches the live callback titles and reclean / redo / not done wording', () => {
    for (const t of [
      'Cleaner Callback',
      'Cleaner: Callback',
      'Cleaner callback needed today - bathrooms, stained bedding...',
      'Call back - kitchen',
      'Reclean master bath',
      'Re-clean',
      'Re clean upstairs',
      'Redo Turn Clean',
      'Re-do bathrooms',
      'Turn clean not done',
      'Bedrooms not cleaned',
    ]) expect(isRedoTask(t), t).toBe(true)
  })

  it('leaves ordinary cleans and look-alike words alone', () => {
    for (const t of [
      'Departure Clean',
      'Departure Clean - HT',
      'Turn Clean',
      'Pre-check-in cleaning',
      'Same Day Turn / Arrival Clean',
      'DO NOT CLEAN - Maintenance',
      'NO CLEAN NEEDED - Departure Clean',
      'Remove trash for owner',
      'Hot Tub Refresh',
      'Cleaner Self-Inspection',
      '',
    ]) expect(isRedoTask(t), t).toBe(false)
    expect(isRedoTask(null)).toBe(false)
  })

  it('also reads a status that says the work was not done', () => {
    expect(isRedoTask('Turn Clean', 'Not Done')).toBe(true)
    expect(isRedoTask('Turn Clean', 'Closed')).toBe(false)
  })
})

describe('redo decision in the review note', () => {
  it('parses both decisions, case- and spacing-tolerant', () => {
    expect(redoDecisionFromNote('[redo: bill]')).toBe('bill')
    expect(redoDecisionFromNote('[redo: no charge] towels left wet')).toBe('no_charge')
    expect(redoDecisionFromNote('Redo decision: No-Charge')).toBe('no_charge')
    expect(redoDecisionFromNote('redo:no_charge')).toBe('no_charge')
  })

  it('is null when missing or contradictory', () => {
    expect(redoDecisionFromNote(null)).toBeNull()
    expect(redoDecisionFromNote('callback was for the hot tub')).toBeNull()
    expect(redoDecisionFromNote('[redo: bill] [redo: no charge]')).toBeNull()
  })

  it('withRedoDecision keeps the note text and replaces an earlier decision', () => {
    expect(withRedoDecision('', 'bill')).toBe('[redo: bill]')
    expect(withRedoDecision('guest spilled wine', 'no_charge')).toBe('[redo: no charge] guest spilled wine')
    const switched = withRedoDecision('[redo: no charge] guest spilled wine', 'bill')
    expect(switched).toBe('[redo: bill] guest spilled wine')
    expect(redoDecisionFromNote(switched)).toBe('bill')
  })
})

describe('redoBlocker', () => {
  const line = (over: Partial<RedoCheckLine> = {}): RedoCheckLine => ({
    flags: [REDO_PENDING_FLAG],
    review_status: 'resolved',
    line_kind: 'clean',
    review_note: null,
    client_charge_amount: 175,
    ...over,
  })

  it('ignores lines without the flag and excluded lines', () => {
    expect(redoBlocker(line({ flags: [] }))).toBeNull()
    expect(redoBlocker(line({ review_status: 'excluded' }))).toBeNull()
    expect(redoBlocker(line({ line_kind: 'excluded' }))).toBeNull()
  })

  it('blocks an unresolved line even with a decision, and a resolved one without', () => {
    expect(redoBlocker(line({ review_status: 'needs_review', review_note: '[redo: bill]' }))).not.toBeNull()
    expect(redoBlocker(line({ review_note: 'looked fine to me' }))).not.toBeNull()
  })

  it('passes "bill" as is, and "no charge" only with a zero client charge', () => {
    expect(redoBlocker(line({ review_note: '[redo: bill]' }))).toBeNull()
    expect(redoBlocker(line({ review_note: '[redo: no charge]' }))).toMatch(/not zero/)
    expect(redoBlocker(line({ review_note: '[redo: no charge]', client_charge_amount: 0 }))).toBeNull()
    expect(redoBlocker(line({ review_note: '[redo: no charge]', client_charge_amount: '0.00' }))).toBeNull()
  })
})
