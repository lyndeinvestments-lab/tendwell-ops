// Billable-task lines: pure builder, NO I/O (same contract as _engine.ts).
//
// Busy Bee no longer bills auxiliary work (Jordan 2026-09-22), so a hot tub
// refresh or trash pickup never appears on the vendor CSV — but the task is
// done and the client owes for it. For every run, reconcile adds one line per
// COMPLETED billable auxiliary task inside the run's period:
//
//   source              'task'   (provenance: Breezeway / Trellis, not the vendor file)
//   line_kind           'extra'
//   raw_amount          0        (the vendor billed nothing — the penny gate is untouched)
//   cleaner_pay_amount  null     (NOT paid to the vendor — absent from the Ramp export)
//   client_charge_amount standard price (settings-driven) → QBO / bill.com
//   review_status       'ok' when priced (auto-approved — Jordan: "auto-approve
//                       all of them"); 'needs_review' when no price is on file.
//
// A human can dismiss (exclude) or edit a task line like any other; those rows
// are preserved by reconcile. Untouched task lines are rebuilt every reconcile
// so a price or billability change in settings propagates without a deploy.

import {
  AUX_CATEGORIES,
  auxPrice,
  classifyAuxTask,
  isBillableCategory,
  type AuxBillingSettings,
  type AuxCategory,
  type AuxTaskSource,
} from '../../shared/aux-tasks.js'
import {
  FLAGS,
  REASON_REQUIRED_EXTRAS,
  extraReasonFromNote,
  round2,
  type BillingChannel,
  type PropertyRates,
} from './_engine.js'

/** One completed-or-not task from either source, already property-resolved. */
export interface AuxTaskRow {
  externalId: string      // breezeway_tasks.external_id, or 'trellis:<uuid>'
  source: AuxTaskSource
  propertyId: number | null
  date: string | null     // yyyy-mm-dd (Breezeway due_date / Trellis scheduled_date)
  title: string
  department: string | null
  completed: boolean
  cancelled: boolean
}

/** The slice of an existing invoice line the builder needs to avoid duplicates. */
export interface ExistingLineRef {
  source: string
  propertyId: number | null
  serviceType: string | null
  date: string | null
  matchedTaskId: string | null
  lineKind: string
  reviewStatus: string
}

export interface TaskLineInsert {
  line_no: number
  split_group: null
  source: 'task'
  raw_property_text: string | null
  raw_note_text: string
  raw_amount: 0
  raw_date_mentioned: string | null
  property_id: number
  alias_confidence: null
  matched_task_id: string
  service_type: string
  line_kind: 'extra'
  cleaner_pay_amount: null
  client_charge_amount: number | null
  billing_channel: BillingChannel | null
  flags: string[]
  review_status: 'ok' | 'needs_review'
  engine_note: string
}

export type SkipReason =
  | 'not_completed'
  | 'cancelled'
  | 'not_billable'
  | 'no_property'
  | 'outside_period'
  | 'already_on_run'
  | 'duplicate_source'
  | 'covered_by_vendor_line'

export interface BuildTaskLinesResult {
  inserts: TaskLineInsert[]
  skipped: Array<{ externalId: string; reason: SkipReason }>
  totalClientCharge: number
  needsReviewCount: number
}

export interface BuildTaskLinesInput {
  tasks: AuxTaskRow[]
  existing: ExistingLineRef[]
  properties: ReadonlyMap<number, PropertyRates>
  settings: AuxBillingSettings
  periodStart: string
  periodEnd: string
  nextLineNo: number
}

const usd = (n: number) => `$${round2(n).toFixed(2)}`
const sourceLabel = (s: AuxTaskSource) => (s === 'breezeway' ? 'Breezeway' : 'Trellis')

function dateDiffDays(a: string, b: string): number {
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
  return Math.abs(Math.round((da - db) / 86_400_000))
}

export function categoryFor(task: Pick<AuxTaskRow, 'title'>): AuxCategory {
  return classifyAuxTask(task.title)
}

/**
 * Build the task-derived lines for one run.
 *
 * Duplicate rules, in order:
 *  1. A task already represented on the run (any line with matched_task_id =
 *     this task, including a dismissed one) is skipped — a dismissal sticks.
 *  2. Breezeway and Trellis usually both carry the same task. Same
 *     (property, day, service) collapses to ONE line; Breezeway wins, matching
 *     the clean path in loadEngineContext.
 *  3. If the vendor DID bill it (a non-task line on the run with the same
 *     property + service within ±1 day — Busy Bee occasionally still lists a
 *     hot tub refresh), the task is not billed twice.
 */
export function buildTaskLines(input: BuildTaskLinesInput): BuildTaskLinesResult {
  const { tasks, existing, properties, settings, periodStart, periodEnd } = input
  const inserts: TaskLineInsert[] = []
  const skipped: BuildTaskLinesResult['skipped'] = []

  const representedTaskIds = new Set(existing.map(e => e.matchedTaskId).filter((x): x is string => !!x))
  const vendorLines = existing.filter(e => e.source !== 'task' && e.lineKind !== 'excluded' && e.reviewStatus !== 'excluded')

  // Breezeway first so it wins the per-(property, day, service) dedup.
  const ordered = [...tasks].sort((a, b) =>
    (a.source === b.source ? 0 : a.source === 'breezeway' ? -1 : 1) ||
    (a.date ?? '').localeCompare(b.date ?? '') ||
    (a.propertyId ?? 0) - (b.propertyId ?? 0),
  )
  const seenKeys = new Set<string>()
  let lineNo = input.nextLineNo

  for (const t of ordered) {
    const skip = (reason: SkipReason) => skipped.push({ externalId: t.externalId, reason })
    if (t.cancelled) { skip('cancelled'); continue }
    if (!t.completed) { skip('not_completed'); continue }
    const category = categoryFor(t)
    if (!isBillableCategory(category, settings)) { skip('not_billable'); continue }
    const serviceType = AUX_CATEGORIES[category].serviceType!
    if (t.propertyId == null) { skip('no_property'); continue }
    if (t.date == null || t.date < periodStart || t.date > periodEnd) { skip('outside_period'); continue }
    if (representedTaskIds.has(t.externalId)) { skip('already_on_run'); continue }
    const key = `${t.propertyId}|${t.date}|${serviceType}`
    if (seenKeys.has(key)) { skip('duplicate_source'); continue }
    const vendorBilled = vendorLines.some(v =>
      v.propertyId === t.propertyId &&
      v.serviceType === serviceType &&
      v.date != null &&
      dateDiffDays(v.date, t.date!) <= 1,
    )
    if (vendorBilled) { seenKeys.add(key); skip('covered_by_vendor_line'); continue }
    seenKeys.add(key)

    const property = properties.get(t.propertyId) ?? null
    const priced = auxPrice(serviceType, settings, property)
    const charge = priced?.charge ?? null
    const flags: string[] = [FLAGS.AUX_TASK]
    let reviewStatus: 'ok' | 'needs_review' = 'ok'
    const notes: string[] = [
      `${AUX_CATEGORIES[category].label} completed per ${sourceLabel(t.source)} task "${t.title}" — not on the vendor invoice and not paid to the vendor; billed to the client.`,
    ]

    if (priced) {
      if (priced.source === 'client') {
        flags.push(FLAGS.CLIENT_PRICED)
        notes.push(`This client's agreed ${usd(priced.charge)} applied${property?.hotTub && property.feeOverrides?.[serviceType]?.hotTubCharge != null ? ' (hot tub property)' : ''}.`)
      } else {
        flags.push(FLAGS.STANDARD_PRICED)
        notes.push(`Standard ${usd(priced.charge)} applied${property?.hotTub && settings.hotTubPricing[serviceType] != null ? ' (hot tub property)' : ''}.`)
      }
    } else {
      flags.push(FLAGS.MISSING_RATE)
      reviewStatus = 'needs_review'
      notes.push(`No standard price on file for ${serviceType} — set one (Invoicing → Task audit → Pricing) or edit the charge on this line.`)
    }

    // Finance requires a reason in the exported title for these; the task
    // title is the reason. Only a title that reduces to nothing queues.
    if (REASON_REQUIRED_EXTRAS.has(serviceType) && extraReasonFromNote(t.title, serviceType) == null) {
      flags.push(FLAGS.REASON_REQUIRED)
      reviewStatus = 'needs_review'
      notes.push(`${serviceType} needs a reason in the invoice title — add one in the review note.`)
    }

    const channel: BillingChannel | null = property?.billingChannel ?? null
    if (channel == null || channel === 'none') {
      flags.push(FLAGS.NO_BILLING_CHANNEL)
      notes.push("No billing channel on this property's client — set the Payment Method on the Clients page.")
    }

    inserts.push({
      line_no: lineNo++,
      split_group: null,
      source: 'task',
      raw_property_text: property?.name ?? String(t.propertyId),
      raw_note_text: t.title,
      raw_amount: 0,
      raw_date_mentioned: t.date,
      property_id: t.propertyId,
      alias_confidence: null,
      matched_task_id: t.externalId,
      service_type: serviceType,
      line_kind: 'extra',
      cleaner_pay_amount: null,
      client_charge_amount: charge != null ? round2(charge) : null,
      billing_channel: channel,
      flags,
      review_status: reviewStatus,
      engine_note: notes.join(' '),
    })
  }

  return {
    inserts,
    skipped,
    totalClientCharge: round2(inserts.reduce((a, l) => a + (l.client_charge_amount ?? 0), 0)),
    needsReviewCount: inserts.filter(l => l.review_status === 'needs_review').length,
  }
}

/** Task rows a human has touched keep their state across reconciles; the rest are rebuilt. */
export function isHumanTouchedTaskLine(r: {
  source?: string | null
  review_status?: string | null
  line_kind?: string | null
  resolved_by?: string | null
}): boolean {
  if (r.source !== 'task') return false
  return (
    r.review_status === 'resolved' ||
    r.review_status === 'excluded' ||
    r.line_kind === 'excluded' ||
    (r.resolved_by != null && r.resolved_by !== '')
  )
}
