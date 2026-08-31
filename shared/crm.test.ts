import { describe, expect, it } from 'vitest'
import {
  ACTIVE_CLIENT_STAGES,
  ATTENTION_REASONS,
  CLIENT_STAGES,
  CLIENT_STAGE_IDS,
  TERMINAL_CLIENT_STAGES,
  attentionReasonLabel,
  attentionReasonTone,
  clientStageDef,
  clientStageLabel,
  clientStageTone,
  isTerminalStage,
} from './crm.js'

// The database is the authority on which stage strings are legal. These two
// literals are transcribed from supabase/migrations/20260831_crm_client_lifecycle.sql
// — the `contacts_client_stage_check` constraint and the guard inside
// crm_set_client_stage. If someone renames a stage in crm.ts without changing
// the migration (or vice versa), the write would be rejected at the database
// with a constraint violation at runtime; these tests turn that into a red
// build instead.
const DB_CHECK_STAGES = [
  'new',
  'prospect',
  'quoted',
  'won',
  'nurture',
  'not_interested',
  'churned',
]

// crm_attention emits exactly these five reason strings, one row per
// (client, reason).
const DB_ATTENTION_REASONS = [
  'unreviewed_lead',
  'overdue_action',
  'quote_no_response',
  'stale_prospect',
  'nurture_due',
]

describe('client stage contract with the database', () => {
  it('exposes exactly the stages the CHECK constraint allows', () => {
    expect([...CLIENT_STAGE_IDS].sort()).toEqual([...DB_CHECK_STAGES].sort())
  })

  it('has a definition for every id, with no duplicates', () => {
    expect(new Set(CLIENT_STAGE_IDS).size).toBe(CLIENT_STAGE_IDS.length)
    for (const id of DB_CHECK_STAGES) {
      expect(clientStageDef(id), `missing def for ${id}`).toBeDefined()
    }
  })

  it('orders columns contiguously from 0 so the board has no gaps', () => {
    const orders = CLIENT_STAGES.map(s => s.order).sort((a, b) => a - b)
    expect(orders).toEqual(orders.map((_, i) => i))
  })

  it('declares the array in board order', () => {
    const asDeclared = CLIENT_STAGES.map(s => s.order)
    expect(asDeclared).toEqual([...asDeclared].sort((a, b) => a - b))
  })

  it('splits active and terminal stages exhaustively', () => {
    expect([...ACTIVE_CLIENT_STAGES, ...TERMINAL_CLIENT_STAGES].sort())
      .toEqual([...CLIENT_STAGE_IDS].sort())
    // The three exits Jordan named: nurture, not interested, churned.
    expect([...TERMINAL_CLIENT_STAGES].sort())
      .toEqual(['churned', 'not_interested', 'nurture'])
  })

  it('treats `new` as active — it is the review queue, not an exit', () => {
    expect(isTerminalStage('new')).toBe(false)
    expect(ACTIVE_CLIENT_STAGES).toContain('new')
  })

  it('gives every stage a non-empty label and blurb', () => {
    for (const s of CLIENT_STAGES) {
      expect(s.label.trim().length, s.id).toBeGreaterThan(0)
      expect(s.blurb.trim().length, s.id).toBeGreaterThan(0)
    }
  })
})

describe('stage display helpers degrade safely', () => {
  it('falls back to the raw value for an unknown stage rather than throwing', () => {
    expect(clientStageLabel('some_future_stage')).toBe('some_future_stage')
    expect(clientStageTone('some_future_stage')).toBe('neutral')
    expect(isTerminalStage('some_future_stage')).toBe(false)
  })

  it('renders an em dash for null/undefined', () => {
    expect(clientStageLabel(null)).toBe('—')
    expect(clientStageLabel(undefined)).toBe('—')
    expect(clientStageDef(null)).toBeUndefined()
  })

  it('resolves real stages', () => {
    expect(clientStageLabel('not_interested')).toBe('Not interested')
    expect(clientStageTone('churned')).toBe('destructive')
    expect(clientStageTone('won')).toBe('success')
  })
})

describe('attention reason contract with the view', () => {
  it('covers exactly the reasons crm_attention emits', () => {
    expect(ATTENTION_REASONS.map(r => r.id).sort())
      .toEqual([...DB_ATTENTION_REASONS].sort())
  })

  it('uses only the priority values the view assigns', () => {
    for (const r of ATTENTION_REASONS) {
      expect([1, 2, 3], r.id).toContain(r.priority)
    }
  })

  it('marks the two act-today reasons as priority 1', () => {
    const p1 = ATTENTION_REASONS.filter(r => r.priority === 1).map(r => r.id).sort()
    expect(p1).toEqual(['overdue_action', 'unreviewed_lead'])
  })

  it('falls back for an unknown reason rather than rendering blank', () => {
    expect(attentionReasonLabel('brand_new_reason')).toBe('brand_new_reason')
    expect(attentionReasonTone('brand_new_reason')).toBe('neutral')
    expect(attentionReasonLabel(null)).toBe('—')
  })

  it('resolves real reasons', () => {
    expect(attentionReasonLabel('stale_prospect')).toBe('Gone quiet')
    expect(attentionReasonTone('overdue_action')).toBe('destructive')
  })
})
