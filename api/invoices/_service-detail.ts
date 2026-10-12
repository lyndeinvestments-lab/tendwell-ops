// Loads the service detail for every line of one invoice run: the task behind
// each line (Trellis, or a Breezeway row plus its Trellis twin) and the stays
// around the service day. The reading itself is shared/service-detail.ts.
//
// Read-only and computed on demand, so it works on approved and exported
// runs too, and improves as soon as the task sync stores more detail.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './_lib.js'
import { buildServiceDetail, type ServiceDetail, type StayInput, type TaskInput } from '../../shared/service-detail.js'
import { fetchTaskDetails } from '../trellis/_sync-core.js'

const TRELLIS_PREFIX = 'trellis:'
const CHUNK = 150
/** Stays this far either side of the run's dates give last-out / next-in. */
const STAY_PAD_DAYS = 45

interface LineRow {
  id: string
  line_no: number
  matched_task_id: string | null
  property_id: number | null
  service_date: string | null
  raw_date_mentioned: string | null
  service_type: string | null
  line_kind: string | null
  client_charge_amount: number | string | null
}

export interface TrellisTaskRow {
  trellis_task_id: string
  workspace?: string | null
  trellis_property_id: string | null
  title: string | null
  description?: string | null
  department_name: string | null
  status: string | null
  priority: string | null
  assigned_to_name: string | null
  assignees?: Array<{ assignee_name?: string | null }> | null
  scheduled_date: string | null
  scheduled_time?: string | null
  completed_at: string | null
  task_created_at?: string | null
  reservation_id?: string | null
  checklist_total?: number | null
  checklist_completed?: number | null
  linked_issue_count?: number | null
  is_no_charge?: boolean | null
}

export interface BreezewayTaskRow {
  external_id: string
  task_title: string | null
  department: string | null
  priority: string | null
  status: string | null
  assignees: string | null
  completed_by: string | null
  due_date: string | null
  completed_date: string | null
  created_date: string | null
}

interface ReservationRow {
  trellis_reservation_id: string
  trellis_property_id: string | null
  guest_name: string | null
  checkin_date: string | null
  checkout_date: string | null
  status: string | null
  source: string | null
  is_owner_block: boolean | null
}

const chunks = <T>(xs: T[]): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK))
  return out
}

const shiftDate = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const uniqNames = (names: Array<string | null | undefined>): string[] =>
  [...new Set(names.map(n => (n ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))]

export function trellisTaskInput(t: TrellisTaskRow): TaskInput {
  const fromAssignees = Array.isArray(t.assignees) ? t.assignees.map(a => a?.assignee_name ?? null) : []
  const named = uniqNames(fromAssignees)
  return {
    source: 'trellis',
    ref: t.trellis_task_id,
    title: t.title,
    description: t.description ?? null,
    department: t.department_name,
    priority: t.priority,
    status: t.status,
    requestedAt: t.task_created_at ?? null,
    requestedDate: null,
    scheduledDate: t.scheduled_date,
    scheduledTime: t.scheduled_time ?? null,
    completedAt: t.completed_at,
    completedDate: null,
    doneBy: named.length > 0 ? named : uniqNames([t.assigned_to_name]),
    checklistTotal: t.checklist_total ?? null,
    checklistCompleted: t.checklist_completed ?? null,
    linkedIssueCount: t.linked_issue_count ?? null,
    noCharge: t.is_no_charge ?? null,
    reservationId: t.reservation_id ?? null,
  }
}

export function breezewayTaskInput(b: BreezewayTaskRow): TaskInput {
  // Breezeway's export repeats vendor names ("230 Busy Bee cleaning 230 Busy
  // Bee cleaning"); the split + dedupe keeps one of each.
  const people = b.completed_by ? [b.completed_by] : (b.assignees ?? '').split(';')
  return {
    source: 'breezeway',
    ref: b.external_id,
    title: b.task_title,
    description: null,
    department: b.department,
    priority: b.priority,
    status: b.status,
    requestedAt: null,
    requestedDate: b.created_date,
    scheduledDate: b.due_date,
    scheduledTime: null,
    completedAt: null,
    completedDate: b.completed_date,
    doneBy: uniqNames(people),
    checklistTotal: null,
    checklistCompleted: null,
    linkedIssueCount: null,
    noCharge: null,
    reservationId: null,
  }
}

/** The Trellis copy of a Breezeway task: same property, same day, same title.
 *  Title must match exactly (case-insensitive): showing the WRONG task's
 *  description would be worse than showing none. Several matches → prefer a
 *  completed one, then the lowest id for a stable answer. */
export function findTrellisTwin(
  candidates: ReadonlyArray<TrellisTaskRow>,
  title: string | null,
): TrellisTaskRow | null {
  const want = (title ?? '').trim().toLowerCase()
  if (!want) return null
  const same = candidates.filter(c => (c.title ?? '').trim().toLowerCase() === want)
  if (same.length === 0) return null
  return [...same].sort((a, b) =>
    Number(b.status === 'COMPLETED') - Number(a.status === 'COMPLETED') || a.trellis_task_id.localeCompare(b.trellis_task_id),
  )[0]
}

const stayInput = (r: ReservationRow): StayInput => ({
  reservationId: r.trellis_reservation_id,
  guestName: r.guest_name,
  checkin: r.checkin_date,
  checkout: r.checkout_date,
  channel: r.source,
  ownerBlock: !!r.is_owner_block,
  status: r.status,
})

const TASK_COLS = 'trellis_task_id, workspace, trellis_property_id, title, description, department_name, status, priority, assigned_to_name, assignees, scheduled_date, scheduled_time, completed_at, task_created_at, reservation_id, checklist_total, checklist_completed, linked_issue_count, is_no_charge'
const STAY_COLS = 'trellis_reservation_id, trellis_property_id, guest_name, checkin_date, checkout_date, status, source, is_owner_block'

/** Drops null / empty fields: a 500-line run is otherwise ~0.5 MB of nulls. */
export function compactDetail<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, x) => (x === null || (Array.isArray(x) && x.length === 0) ? undefined : x)))
}

/** Fetches task detail from Trellis. Injectable for tests. */
export type DetailFetcher = (workspace: 'A' | 'B', ids: ReadonlyArray<string>, opts: { deadlineMs?: number }) => Promise<Map<string, Record<string, unknown>>>

/** How long one page view may spend fetching missing detail from Trellis. */
const DETAIL_FETCH_BUDGET_MS = 9_000

export async function loadServiceDetails(
  supabase: SupabaseClient,
  runId: string,
  opts: { fetchDetails?: DetailFetcher | null } = {},
): Promise<Record<string, ServiceDetail>> {
  const fetchDetails = opts.fetchDetails === undefined ? fetchTaskDetails : opts.fetchDetails
  const lines = await fetchAllRows<LineRow>(
    'invoice_lines (service detail)',
    () => supabase
      .from('invoice_lines')
      .select('id, line_no, matched_task_id, property_id, service_date, raw_date_mentioned, service_type, line_kind, client_charge_amount')
      .eq('run_id', runId)
      .order('id'),
    'id',
  )
  if (lines.length === 0) return {}

  const dateOf = (l: LineRow) => l.service_date ?? l.raw_date_mentioned
  const matched = lines.map(l => l.matched_task_id).filter((x): x is string => !!x)
  const trellisIds = [...new Set(matched.filter(x => x.startsWith(TRELLIS_PREFIX)).map(x => x.slice(TRELLIS_PREFIX.length)))]
  const bwIds = [...new Set(matched.filter(x => !x.startsWith(TRELLIS_PREFIX)))]
  const propIds = [...new Set(lines.map(l => l.property_id).filter((x): x is number => x != null))]
  const dates = lines.map(dateOf).filter((d): d is string => !!d).sort()
  const lo = dates[0] ?? null
  const hi = dates[dates.length - 1] ?? null

  const [trellisRows, bwRows, propRows] = await Promise.all([
    Promise.all(chunks(trellisIds).map(ids => fetchAllRows<TrellisTaskRow>(
      'trellis_task_snapshot (matched)',
      () => supabase.from('trellis_task_snapshot').select(TASK_COLS).in('trellis_task_id', ids).order('trellis_task_id'),
      'trellis_task_id',
    ))).then(p => p.flat()),
    Promise.all(chunks(bwIds).map(ids => fetchAllRows<BreezewayTaskRow>(
      'breezeway_tasks (matched)',
      () => supabase.from('breezeway_tasks')
        .select('external_id, task_title, department, priority, status, assignees, completed_by, due_date, completed_date, created_date')
        .in('external_id', ids).order('external_id'),
      'external_id',
    ))).then(p => p.flat()),
    Promise.all(chunks(propIds).map(ids => fetchAllRows<{ id: number; trellis_id: string | null }>(
      'properties (trellis ids)',
      () => supabase.from('properties').select('id, trellis_id').in('id', ids).order('id'),
      'id',
    ))).then(p => p.flat()),
  ])

  const trellisById = new Map(trellisRows.map(t => [t.trellis_task_id, t]))
  const bwById = new Map(bwRows.map(b => [b.external_id, b]))
  const trellisPropOf = new Map(propRows.filter(p => p.trellis_id).map(p => [p.id, p.trellis_id as string]))
  const trellisPropIds = [...new Set(trellisPropOf.values())]

  // Trellis twins for Breezeway-matched lines, and every stay near the run.
  const haveWindow = !!lo && !!hi && trellisPropIds.length > 0
  const [twinRows, stayRows] = await Promise.all([
    haveWindow && bwRows.length > 0
      ? Promise.all(chunks(trellisPropIds).map(ids => fetchAllRows<TrellisTaskRow>(
        'trellis_task_snapshot (twins)',
        () => supabase.from('trellis_task_snapshot').select(TASK_COLS)
          .in('trellis_property_id', ids).gte('scheduled_date', shiftDate(lo!, -3)).lte('scheduled_date', shiftDate(hi!, 3))
          .order('trellis_task_id'),
        'trellis_task_id',
      ))).then(p => p.flat())
      : Promise.resolve([] as TrellisTaskRow[]),
    haveWindow
      ? Promise.all(chunks(trellisPropIds).map(ids => fetchAllRows<ReservationRow>(
        'trellis_reservation_snapshot',
        () => supabase.from('trellis_reservation_snapshot').select(STAY_COLS)
          .in('trellis_property_id', ids)
          .gte('checkout_date', shiftDate(lo!, -STAY_PAD_DAYS))
          .lte('checkin_date', shiftDate(hi!, STAY_PAD_DAYS))
          .order('trellis_reservation_id'),
        'trellis_reservation_id',
      ))).then(p => p.flat())
      : Promise.resolve([] as ReservationRow[]),
  ])

  const twinsByPropDay = new Map<string, TrellisTaskRow[]>()
  for (const t of twinRows) {
    if (!t.trellis_property_id || !t.scheduled_date) continue
    const k = `${t.trellis_property_id}|${t.scheduled_date}`
    twinsByPropDay.set(k, [...(twinsByPropDay.get(k) ?? []), t])
  }
  const staysByProp = new Map<string, StayInput[]>()
  const stayById = new Map<string, StayInput>()
  for (const r of stayRows) {
    const s = stayInput(r)
    stayById.set(s.reservationId, s)
    if (r.trellis_property_id) staysByProp.set(r.trellis_property_id, [...(staysByProp.get(r.trellis_property_id) ?? []), s])
  }

  // Add-on lines are the ones a reviewer has to justify, and the bulk sync
  // stores only a task's basics (Trellis pages are size-capped). Fetch the
  // rest for those tasks now, once, and keep it in the snapshot.
  const taskFor = (l: LineRow): TrellisTaskRow | null => {
    const m = l.matched_task_id
    if (!m) return null
    if (m.startsWith(TRELLIS_PREFIX)) return trellisById.get(m.slice(TRELLIS_PREFIX.length)) ?? null
    const b = bwById.get(m)
    const prop = l.property_id != null ? trellisPropOf.get(l.property_id) : null
    const day = b?.due_date ?? dateOf(l)
    return b && prop && day ? findTrellisTwin(twinsByPropDay.get(`${prop}|${day}`) ?? [], b.task_title) : null
  }
  if (fetchDetails) {
    const missing = new Map<'A' | 'B', TrellisTaskRow[]>()
    for (const l of lines) {
      if (l.line_kind !== 'extra') continue
      const t = taskFor(l)
      if (!t || t.task_created_at || (t.workspace !== 'A' && t.workspace !== 'B')) continue
      missing.set(t.workspace, [...(missing.get(t.workspace) ?? []), t])
    }
    const deadlineMs = Date.now() + DETAIL_FETCH_BUDGET_MS
    for (const [ws, rows] of missing) {
      try {
        const got = await fetchDetails(ws, [...new Set(rows.map(r => r.trellis_task_id))], { deadlineMs })
        await Promise.all([...got].map(async ([id, cols]) => {
          for (const r of rows) if (r.trellis_task_id === id) Object.assign(r, cols)
          const { error } = await supabase.from('trellis_task_snapshot').update(cols).eq('trellis_task_id', id)
          if (error) console.warn('[service-detail] caching task detail failed', id, error.message)
        }))
      } catch (e) {
        // Detail is a nicety: the basics still render without it.
        console.warn('[service-detail] Trellis detail fetch failed', ws, e instanceof Error ? e.message : e)
      }
    }
  }

  // A linked stay can sit outside the window (a long-ago booking): fetch those by id.
  const linkedIds = [...new Set([...trellisRows, ...twinRows].map(t => t.reservation_id).filter((x): x is string => !!x && !stayById.has(x)))]
  if (linkedIds.length > 0) {
    const extra = (await Promise.all(chunks(linkedIds).map(ids => fetchAllRows<ReservationRow>(
      'trellis_reservation_snapshot (linked)',
      () => supabase.from('trellis_reservation_snapshot').select(STAY_COLS).in('trellis_reservation_id', ids).order('trellis_reservation_id'),
      'trellis_reservation_id',
    )))).flat()
    for (const r of extra) stayById.set(r.trellis_reservation_id, stayInput(r))
  }

  const out: Record<string, ServiceDetail> = {}
  for (const l of lines) {
    const date = dateOf(l)
    const trellisProp = l.property_id != null ? trellisPropOf.get(l.property_id) ?? null : null
    let task: TaskInput | null = null
    let fromTrellisTwin = false
    const m = l.matched_task_id
    if (m?.startsWith(TRELLIS_PREFIX)) {
      const t = trellisById.get(m.slice(TRELLIS_PREFIX.length))
      if (t) task = trellisTaskInput(t)
    } else if (m) {
      const b = bwById.get(m)
      if (b) {
        const day = b.due_date ?? date
        const twin = trellisProp && day ? findTrellisTwin(twinsByPropDay.get(`${trellisProp}|${day}`) ?? [], b.task_title) : null
        if (twin) {
          task = trellisTaskInput(twin)
          fromTrellisTwin = true
        } else {
          task = breezewayTaskInput(b)
        }
      }
    }
    out[l.id] = buildServiceDetail({
      serviceType: l.service_type,
      serviceDate: date,
      clientCharge: l.client_charge_amount != null ? Number(l.client_charge_amount) : null,
      expectsTask: !!m,
      isExtra: l.line_kind === 'extra',
      task,
      fromTrellisTwin,
      stays: trellisProp ? staysByProp.get(trellisProp) ?? [] : [],
      linkedStay: task?.reservationId ? stayById.get(task.reservationId) ?? null : null,
    })
  }
  return out
}
