// Pure draft builder for vendor-portal invoices: completed Breezeway/Trellis
// cleans → one invoice line per property per day. NO I/O (see runs.ts).
//
// Why not generateDraftLines (api/invoices/_engine.ts)? It emits one line per
// TASK, and the task tables carry real duplicates: Breezeway re-keys a task
// when the property's name changes (Raman Gurai 1118 on 2026-10-04 exists
// twice, both "Turn Clean — Closed", once with an emoji in the name), and a
// rescheduled task can be closed early while its replacement is closed on the
// day (Derek Trainer 1687, 2026-10-07). The admin-generated draft for
// Oct 4–7 billed both of those twice. Here a property-day is billed once,
// extra tasks are recorded on the line (`possible_duplicate`, reviewed by
// Tendwell), and a day already on another invoice is skipped with the reason.

import type { TaskRow } from '../invoices/_engine.js'

export interface DraftProperty {
  id: number
  name: string
  cleanerPay: number | null
}

export interface DraftInput {
  tasks: TaskRow[]
  periodStart: string
  periodEnd: string
  properties: ReadonlyMap<number, DraftProperty>
  /** property|date → where it was already billed: the period of the vendor's
   *  own invoice, or null when it is someone else's (not shown to them). */
  blockedDays: ReadonlyMap<string, string | null>
  /** property|date already on THIS run (a refresh adds only what is new). */
  existingDays?: ReadonlySet<string>
}

export interface DraftLine {
  propertyId: number
  propertyName: string
  date: string
  title: string
  deep: boolean
  /** Every completed clean task found for this property-day (primary first). */
  taskIds: string[]
  amount: number
  flags: string[]
}

export interface SkippedDay {
  propertyId: number
  propertyName: string
  date: string
  title: string
  reason: 'already_invoiced' | 'unknown_property'
  ref: string | null
}

export interface DraftResult {
  lines: DraftLine[]
  skipped: SkippedDay[]
}

const DAY = 86_400_000

export function dayKey(propertyId: number, date: string): string {
  return `${propertyId}|${date}`
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Breezeway (system of record) before Trellis, then stable id order. */
function primaryOrder(a: TaskRow, b: TaskRow): number {
  const as = a.source === 'trellis' ? 1 : 0
  const bs = b.source === 'trellis' ? 1 : 0
  if (as !== bs) return as - bs
  return a.externalId.localeCompare(b.externalId)
}

export function buildPortalDraft(input: DraftInput): DraftResult {
  const groups = new Map<string, TaskRow[]>()
  for (const t of input.tasks) {
    if (!(t.isClean || t.isDeepClean)) continue
    // Only completed work is billable: an open task is not evidence of a clean.
    if (t.completed === false) continue
    if (t.propertyId == null || t.dueDate == null) continue
    if (t.dueDate < input.periodStart || t.dueDate > input.periodEnd) continue
    const k = dayKey(t.propertyId, t.dueDate)
    const g = groups.get(k)
    if (g) g.push(t)
    else groups.set(k, [t])
  }

  const lines: DraftLine[] = []
  const skipped: SkippedDay[] = []
  const keys = [...groups.keys()].sort((a, b) => {
    const [pa, da] = a.split('|')
    const [pb, db] = b.split('|')
    return da.localeCompare(db) || Number(pa) - Number(pb)
  })

  for (const k of keys) {
    const tasks = [...groups.get(k)!].sort(primaryOrder)
    const propertyId = tasks[0].propertyId!
    const date = tasks[0].dueDate!
    // A deep clean on the same day as a regular one is billed as the deep
    // clean (the bigger job) and the pair goes to review as a possible
    // duplicate — never both.
    const deep = tasks.some(t => t.isDeepClean)
    const primary = deep ? tasks.find(t => t.isDeepClean)! : tasks[0]
    const ordered = [primary, ...tasks.filter(t => t !== primary)]
    const prop = input.properties.get(propertyId)

    if (!prop) {
      skipped.push({ propertyId, propertyName: String(propertyId), date, title: primary.title, reason: 'unknown_property', ref: null })
      continue
    }
    if (input.existingDays?.has(k)) continue
    if (input.blockedDays.has(k)) {
      skipped.push({ propertyId, propertyName: prop.name, date, title: primary.title, reason: 'already_invoiced', ref: input.blockedDays.get(k) ?? null })
      continue
    }

    const flags: string[] = []
    if (tasks.length > 1) flags.push('possible_duplicate')
    if (primary.completedOn && Math.abs(Date.parse(primary.completedOn) - Date.parse(date)) / DAY >= 2) {
      flags.push('completed_off_date')
    }
    const pay = prop.cleanerPay != null && prop.cleanerPay > 0 ? prop.cleanerPay : null
    lines.push({
      propertyId,
      propertyName: prop.name,
      date,
      title: primary.title,
      deep,
      taskIds: ordered.map(t => t.externalId),
      // No stored deep-clean vendor rate: 3x Cleaner Pay, flagged by the
      // engine (deep_rate_assumed) and reviewed by Tendwell.
      amount: pay == null ? 0 : round2(deep ? pay * 3 : pay),
      flags,
    })
  }
  return { lines, skipped }
}
