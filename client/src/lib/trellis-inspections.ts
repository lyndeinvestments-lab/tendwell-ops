// Pure logic linking Trellis inspection tasks to Ops inspections (WS4).
//
// Trellis does not expose inspection checklist answers, so the score for
// "how good was the previous clean" is captured in Ops through the normal
// inspection form. This module decides which Trellis tasks to offer for
// rating, what the form is prefilled with, and how the cleaner prefill
// behaves (a cleaner the user cleared must never come back). Unit-tested in
// trellis-inspections.test.ts.

export interface TrellisInspectionTask {
  trellis_task_id: string
  workspace: string | null
  title: string | null
  status: string | null
  scheduled_date: string | null
  completed_at: string | null
  assigned_to_name: string | null
  inspector_cleaner_id: string | null
  inspector_name: string | null
  property_id: number | null
  property_name: string | null
  trellis_property_name: string | null
  prev_clean_task_id: string | null
  prev_clean_date: string | null
  prev_clean_kind: string | null
  prev_clean_title: string | null
  prev_clean_is_tendwell: boolean | null
  prev_cleaner_id: string | null
  prev_cleaner_name: string | null
  ops_inspection_id: string | null
  ops_inspection_status: string | null
  ops_inspected_at: string | null
  ops_overall_score: number | null
  ops_cleanliness_score: number | null
}

export const TRELLIS_INSPECTION_SELECT =
  'trellis_task_id, workspace, title, status, scheduled_date, completed_at, assigned_to_name, inspector_cleaner_id, inspector_name, property_id, property_name, trellis_property_name, prev_clean_task_id, prev_clean_date, prev_clean_kind, prev_clean_title, prev_clean_is_tendwell, prev_cleaner_id, prev_cleaner_name, ops_inspection_id, ops_inspection_status, ops_inspected_at, ops_overall_score, ops_cleanliness_score'

/**
 * Trellis's inspection category also holds maintenance work ("Inspect TVs",
 * "Maintenance: Mold Inspection"). Only cleaning inspections rate a clean:
 * "Cleaning Inspection", "Turn Cleaning Inspection", "Urgent cleaner
 * inspection", "Clean inspection".
 */
export function isCleanInspectionTitle(title: string | null | undefined): boolean {
  if (!title) return false
  return /\bclean(ing|er)?\s+inspection\b/i.test(title)
}

const CLOSED_STATUSES = new Set(['CANCELLED', 'CANCELED', 'DELETED', 'DECLINED'])

/** The inspection's own date: scheduled date, else the day it was completed. */
export function taskDate(t: Pick<TrellisInspectionTask, 'scheduled_date' | 'completed_at'>): string | null {
  return t.scheduled_date ?? (t.completed_at ? t.completed_at.slice(0, 10) : null)
}

export interface TrellisQueue {
  toRate: TrellisInspectionTask[]
  rated: TrellisInspectionTask[]
}

/**
 * Recent cleaning-inspection tasks at Ops properties, dated within
 * `windowDays` before `today` (YYYY-MM-DD) up to today. Future tasks wait
 * until their day. Split by whether Ops already holds a rating
 * (`ops_inspection_id`); newest first.
 */
export function trellisInspectionQueue(
  rows: readonly TrellisInspectionTask[],
  today: string,
  windowDays = 30,
): TrellisQueue {
  const t0 = new Date(`${today}T00:00:00`)
  t0.setDate(t0.getDate() - windowDays)
  const from = `${t0.getFullYear()}-${String(t0.getMonth() + 1).padStart(2, '0')}-${String(t0.getDate()).padStart(2, '0')}`
  const eligible = rows.filter((r) => {
    const d = taskDate(r)
    if (!d || d < from || d > today) return false
    if (r.property_id == null) return false
    if (CLOSED_STATUSES.has((r.status ?? '').toUpperCase())) return false
    return isCleanInspectionTitle(r.title)
  })
  const byDateDesc = (a: TrellisInspectionTask, b: TrellisInspectionTask) =>
    (taskDate(b) ?? '').localeCompare(taskDate(a) ?? '') ||
    (a.property_name ?? '').localeCompare(b.property_name ?? '')
  return {
    toRate: eligible.filter((r) => !r.ops_inspection_id).sort(byDateDesc),
    rated: eligible.filter((r) => !!r.ops_inspection_id).sort(byDateDesc),
  }
}

// ---------------------------------------------------------------------------
// "Which clean is being rated" label
// ---------------------------------------------------------------------------

export type CleanLabelKind = 'cleaner' | 'crew' | 'not_tendwell' | 'none'

export interface CleanLabel {
  kind: CleanLabelKind
  date: string | null
  cleanerName: string | null
}

/** Shared by the Trellis panel (prev_* columns) and the form hint (RPC row). */
export function cleanLabel(c: {
  taskId: string | null
  date: string | null
  isTendwell: boolean | null
  cleanerName: string | null
}): CleanLabel {
  if (!c.taskId) return { kind: 'none', date: null, cleanerName: null }
  if (!c.isTendwell) return { kind: 'not_tendwell', date: c.date, cleanerName: null }
  if (c.cleanerName) return { kind: 'cleaner', date: c.date, cleanerName: c.cleanerName }
  return { kind: 'crew', date: c.date, cleanerName: null }
}

export function taskCleanLabel(t: TrellisInspectionTask): CleanLabel {
  return cleanLabel({
    taskId: t.prev_clean_task_id,
    date: t.prev_clean_date,
    isTendwell: t.prev_clean_is_tendwell,
    cleanerName: t.prev_cleaner_name,
  })
}

// ---------------------------------------------------------------------------
// Form prefill
// ---------------------------------------------------------------------------

export interface InspectionPrefill {
  propertyId: number
  date: string
  trellisTaskId: string
  trellisTitle: string | null
  inspectorId: string | null
  cleanerId: string | null
  lastCleanedOn: string | null
  ratedCleanTaskId: string | null
}

export function prefillFromTrellisTask(
  t: TrellisInspectionTask,
  fallbackInspectorId: string | null,
): InspectionPrefill | null {
  const date = taskDate(t)
  if (t.property_id == null || !date) return null
  return {
    propertyId: t.property_id,
    date,
    trellisTaskId: t.trellis_task_id,
    trellisTitle: t.title,
    inspectorId: t.inspector_cleaner_id ?? fallbackInspectorId,
    // The view only names a cleaner when the clean was Tendwell's.
    cleanerId: t.prev_cleaner_id,
    lastCleanedOn: t.prev_clean_date,
    ratedCleanTaskId: t.prev_clean_task_id,
  }
}

/**
 * Cleaner field state. `autoId` is the value the app filled in; `touched`
 * flips the moment the user picks anything (including "Not specified").
 */
export interface AutoField {
  value: string | null
  autoId: string | null
  touched: boolean
}

export const EMPTY_AUTO_FIELD: AutoField = { value: null, autoId: null, touched: false }

/** A value the app filled in (not typed or picked by the user). */
export function autoField(value: string | null): AutoField {
  return { value, autoId: value, touched: false }
}

/**
 * A value from a saved row. A cleaner the trigger or the app filled
 * (`cleaner_auto_filled`) can follow a later property/date change; one a
 * person chose cannot. (The form only applies hints to a saved row after
 * its property or date changes.)
 */
export function savedField(value: string | null, wasAutoFilled = false): AutoField {
  if (wasAutoFilled && value != null) return autoField(value)
  return { value, autoId: null, touched: value != null }
}

export function userSetField(value: string | null): AutoField {
  return { value, autoId: null, touched: true }
}

/**
 * Apply a new hint (property/date changed, or the hint just loaded).
 * Only replaces a value the app itself filled, or an empty untouched field;
 * a user's choice, including clearing the field, always wins.
 */
export function applyHint(state: AutoField, hint: string | null): AutoField {
  if (state.touched) return state
  if (state.value == null || state.value === state.autoId) return autoField(hint)
  return state
}

/** `inspections.cleaner_auto_filled`: the saved cleaner came from Trellis attribution, untouched. */
export function cleanerAutoFilled(state: AutoField): boolean {
  return state.value != null && !state.touched && state.value === state.autoId
}
