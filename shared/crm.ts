// Canonical CRM client-lifecycle vocabulary.
//
// Single source of truth shared by:
//   • the client — the CRM board / list / attention tabs on /contacts
//   • the server — MCP tool enums and descriptions (api/mcp/*)
//   • the tests  — shared/crm.test.ts asserts parity with the DB CHECK
//
// The stage ids MUST stay in lockstep with the `contacts_client_stage_check`
// constraint in supabase/migrations/20260831_crm_client_lifecycle.sql and with
// the stage list inside the crm_set_client_stage RPC. crm.test.ts pins that
// contract so a rename here fails loudly rather than silently rejecting writes
// at the database.
//
// This is the CLIENT axis. The six property stages (Lead → Quote → Onboarding →
// Active → Offboarding → Offboarded) live in client/src/lib/supabase.ts as
// STAGE_ORDER / STAGE_COLORS and are deliberately untouched — the two
// lifecycles are independent and never cascade into each other.
//
// Keep this file dependency-free — it is imported from both the Vite client
// bundle and the NodeNext serverless functions.

/** Tone names mirror StatusTone in client/src/lib/status-colors.ts. */
export type CrmTone = 'success' | 'warning' | 'destructive' | 'info' | 'neutral' | 'primary'

export type ClientStage =
  | 'new'
  | 'prospect'
  | 'quoted'
  | 'won'
  | 'nurture'
  | 'not_interested'
  | 'churned'

export interface ClientStageDef {
  id: ClientStage
  label: string
  /** Board column order, left to right. Contiguous from 0. */
  order: number
  /**
   * Terminal = the relationship is not being actively worked. Terminal stages
   * are hidden from the board's default view and excluded from pipeline value,
   * but they are NOT deleted — the whole point is to keep a record of the
   * people who said no.
   */
  terminal: boolean
  /** Column subtitle in the UI, and the enum description in the MCP schema. */
  blurb: string
  tone: CrmTone
}

export const CLIENT_STAGES: ClientStageDef[] = [
  {
    id: 'new',
    label: 'New',
    order: 0,
    terminal: false,
    // This column IS the review queue for meeting intake — see the migration
    // header. A card sitting here means "a meeting happened and nobody has
    // decided whether it's real yet".
    blurb: 'Auto-created from a meeting — needs your glance',
    tone: 'info',
  },
  {
    id: 'prospect',
    label: 'Prospect',
    order: 1,
    terminal: false,
    blurb: 'Real and actively in conversation',
    tone: 'primary',
  },
  {
    id: 'quoted',
    label: 'Quoted',
    order: 2,
    terminal: false,
    blurb: 'Numbers sent, waiting on their answer',
    tone: 'warning',
  },
  {
    id: 'won',
    label: 'Won',
    order: 3,
    terminal: false,
    blurb: 'Signed and onboarding or active',
    tone: 'success',
  },
  {
    id: 'nurture',
    label: 'Nurture',
    order: 4,
    terminal: true,
    blurb: 'Long-term hold — resurfaces on its own',
    tone: 'neutral',
  },
  {
    id: 'not_interested',
    label: 'Not interested',
    order: 5,
    terminal: true,
    blurb: 'They said no',
    tone: 'neutral',
  },
  {
    id: 'churned',
    label: 'Churned',
    order: 6,
    terminal: true,
    blurb: 'Was a client, left',
    tone: 'destructive',
  },
]

export const CLIENT_STAGE_IDS: ClientStage[] = CLIENT_STAGES.map(s => s.id)

const STAGE_BY_ID = new Map<string, ClientStageDef>(CLIENT_STAGES.map(s => [s.id, s]))

export function clientStageDef(id: string | null | undefined): ClientStageDef | undefined {
  if (!id) return undefined
  return STAGE_BY_ID.get(id)
}

/** Human label, falling back to the raw value so an unknown stage still renders. */
export function clientStageLabel(id: string | null | undefined): string {
  return clientStageDef(id)?.label ?? (id ?? '—')
}

export function clientStageTone(id: string | null | undefined): CrmTone {
  return clientStageDef(id)?.tone ?? 'neutral'
}

export function isTerminalStage(id: string | null | undefined): boolean {
  return clientStageDef(id)?.terminal ?? false
}

export const ACTIVE_CLIENT_STAGES: ClientStage[] =
  CLIENT_STAGES.filter(s => !s.terminal).map(s => s.id)

export const TERMINAL_CLIENT_STAGES: ClientStage[] =
  CLIENT_STAGES.filter(s => s.terminal).map(s => s.id)

// ─── Attention reasons (crm_attention.reason) ───────────────────────────────
// The view emits one row per (client, reason); these are the display labels.
// Priority mirrors the view's own `priority` column: 1 = act today.

export type AttentionReason =
  | 'unreviewed_lead'
  | 'overdue_action'
  | 'quote_no_response'
  | 'stale_prospect'
  | 'nurture_due'

export interface AttentionReasonDef {
  id: AttentionReason
  label: string
  tone: CrmTone
  /** Matches crm_attention.priority. Lower sorts first. */
  priority: 1 | 2 | 3
}

export const ATTENTION_REASONS: AttentionReasonDef[] = [
  { id: 'unreviewed_lead',   label: 'Unreviewed lead',   tone: 'info',        priority: 1 },
  { id: 'overdue_action',    label: 'Overdue action',    tone: 'destructive', priority: 1 },
  { id: 'quote_no_response', label: 'Quote unanswered',  tone: 'warning',     priority: 2 },
  { id: 'stale_prospect',    label: 'Gone quiet',        tone: 'warning',     priority: 2 },
  { id: 'nurture_due',       label: 'Nurture due',       tone: 'neutral',     priority: 3 },
]

const REASON_BY_ID = new Map<string, AttentionReasonDef>(ATTENTION_REASONS.map(r => [r.id, r]))

export function attentionReasonLabel(id: string | null | undefined): string {
  return REASON_BY_ID.get(id ?? '')?.label ?? (id ?? '—')
}

export function attentionReasonTone(id: string | null | undefined): CrmTone {
  return REASON_BY_ID.get(id ?? '')?.tone ?? 'neutral'
}

// ─── Row shapes for the read models ─────────────────────────────────────────
// Hand-written to match the views, following the same convention as
// client/src/lib/invoices.ts: the query casts and these narrow the result.

export interface Client360 {
  id: string
  full_name: string
  company: string | null
  email: string | null
  phone: string | null
  client_stage: ClientStage
  client_stage_since: string
  days_in_stage: number
  next_action: string | null
  next_action_date: string | null
  source: string | null
  tags: string[] | null
  client_since: string | null
  is_active: boolean | null
  billing_channel: string | null
  payment_method: string | null
  property_count: number
  active_count: number
  quote_count: number
  onboarding_count: number
  offboarded_count: number
  monthly_value: number
  interaction_count: number
  last_interaction_at: string | null
  last_interaction_summary: string | null
  note_count: number
  last_touch_at: string
}

export interface AttentionRow {
  contact_id: string
  full_name: string
  company: string | null
  client_stage: ClientStage
  days_in_stage: number
  monthly_value: number
  next_action: string | null
  next_action_date: string | null
  last_interaction_at: string | null
  reason: AttentionReason
  detail: string
  priority: number
}

export interface StaleQuoteProperty {
  property_id: number
  property_name: string | null
  contact_id: string | null
  client_name: string | null
  monthly_revenue_estimate: number | null
  since: string
  days_stale: number
}
