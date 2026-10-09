import { describe, expect, it } from 'vitest'
import {
  CHARGE_CHANGED_FLAG,
  NOT_HAVEN_LISTING_FLAG,
  RESOLVE_NOTE_FLAGS,
  flagsNeedingResolveNote,
  resolveNoteMissing,
  resolveNoteOk,
} from './invoice-review'

describe('resolve-note flags', () => {
  it('covers exactly the charge-change and non-Haven-listing flags', () => {
    expect([...RESOLVE_NOTE_FLAGS].sort()).toEqual([CHARGE_CHANGED_FLAG, NOT_HAVEN_LISTING_FLAG].sort())
    expect(CHARGE_CHANGED_FLAG).toBe('charge_changed_since_last_invoice')
    expect(NOT_HAVEN_LISTING_FLAG).toBe('not_haven_listing')
  })

  it('picks the note-required flags out of a line', () => {
    expect(flagsNeedingResolveNote(['paid_at_rate', CHARGE_CHANGED_FLAG])).toEqual([CHARGE_CHANGED_FLAG])
    expect(flagsNeedingResolveNote(['paid_at_rate'])).toEqual([])
    expect(flagsNeedingResolveNote(null)).toEqual([])
  })

  it('a note counts only when it has some substance', () => {
    expect(resolveNoteOk('ok')).toBe(false)
    expect(resolveNoteOk('   ')).toBe(false)
    expect(resolveNoteOk(null)).toBe(false)
    expect(resolveNoteOk('Owner agreed to $200 on 10/1')).toBe(true)
  })
})

describe('resolveNoteMissing', () => {
  const flagged = { flags: [NOT_HAVEN_LISTING_FLAG], review_status: 'resolved', line_kind: 'clean' }

  it('is true for a flagged line with no usable note', () => {
    expect(resolveNoteMissing({ ...flagged, review_note: null })).toBe(true)
    expect(resolveNoteMissing({ ...flagged, review_note: 'fine' })).toBe(true)
  })

  it('is false once the note explains it', () => {
    expect(resolveNoteMissing({ ...flagged, review_note: 'Property is managed by Haven, not yet in Hostaway' })).toBe(false)
  })

  it('is false for unflagged lines and for excluded lines', () => {
    expect(resolveNoteMissing({ flags: ['paid_at_rate'], review_note: null })).toBe(false)
    expect(resolveNoteMissing({ ...flagged, review_note: null, review_status: 'excluded' })).toBe(false)
    expect(resolveNoteMissing({ ...flagged, review_note: null, line_kind: 'excluded' })).toBe(false)
  })
})
