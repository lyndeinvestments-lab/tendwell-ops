// Auto-activate properties when real guest-turnover work is scheduled at them.
//
// Rule (Jordan, 2026-08-28): a property in any pre-Active stage (Lead, Quote,
// Onboarding) moves to Active when a Turn or Departure clean exists for it in
// Breezeway or Trellis, dated within the last AUTO_ACTIVATE_LOOKBACK_DAYS or
// in the future. Runs after every task ingest (Trellis sync + Breezeway
// import), so activation follows the data in, not a human remembering to
// move the card.
//
// The recency guard is load-bearing, not a nicety: at rollout, 7 Quote-stage
// properties carried turn cleans from Dec 2025 — history from before they
// churned back to Quote. Without the cutoff they would all have silently
// reactivated. Only forward moves happen; Active/Offboarding/Offboarded rows
// are never touched.

export const AUTO_ACTIVATE_LOOKBACK_DAYS = 30

const PRE_ACTIVE_STAGES = ['Lead', 'Quote', 'Onboarding']
const TURN_CLEAN_RE = /\b(turn(over)?|departure)\b/i

export function isTurnOrDepartureClean(title: string | null | undefined): boolean {
  return !!title && TURN_CLEAN_RE.test(title)
}

export function activationCutoff(today: Date = new Date()): string {
  const d = new Date(today)
  d.setDate(d.getDate() - AUTO_ACTIVATE_LOOKBACK_DAYS)
  return d.toISOString().slice(0, 10)
}

export interface PreActiveProp {
  id: number
  name: string | null
  trellis_id: string | null
  stage_id: number
}

export interface TaskEvidence {
  title: string
  date: string
  source: 'Breezeway' | 'Trellis'
}

// Pure candidate selection (unit-tested): which pre-Active properties have a
// qualifying turn/departure clean, and the task that proves it. Prefers the
// most recent qualifying task as the evidence line.
export function qualifyingActivations(
  props: PreActiveProp[],
  bwTasks: Array<{ property_id: number | null; task_title: string | null; due_date: string | null }>,
  trTasks: Array<{ trellis_property_id: string | null; title: string | null; scheduled_date: string | null }>,
  cutoff: string,
): Map<number, TaskEvidence> {
  const byTrellisId = new Map<string, number>()
  const ids = new Set<number>()
  for (const p of props) {
    ids.add(p.id)
    if (p.trellis_id) byTrellisId.set(String(p.trellis_id), p.id)
  }

  const out = new Map<number, TaskEvidence>()
  const consider = (propId: number | undefined, title: string | null, date: string | null, source: TaskEvidence['source']) => {
    if (propId == null || !ids.has(propId)) return
    if (!date || date < cutoff) return
    if (!isTurnOrDepartureClean(title)) return
    const prev = out.get(propId)
    if (!prev || date > prev.date) out.set(propId, { title: title as string, date, source })
  }

  for (const t of bwTasks) consider(t.property_id ?? undefined, t.task_title, t.due_date, 'Breezeway')
  for (const t of trTasks) {
    const propId = t.trellis_property_id ? byTrellisId.get(String(t.trellis_property_id)) : undefined
    consider(propId, t.title, t.scheduled_date, 'Trellis')
  }
  return out
}

export interface ActivatedProperty {
  id: number
  name: string | null
  evidence: TaskEvidence
}

// I/O shell: find candidates and move them to Active, writing the same audit
// trail a human stage change leaves (stage_transitions + activity_log).
// Best-effort by design — a failure here must never fail the ingest that
// called it, so the caller wraps it in try/catch.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function autoActivateProperties(supabase: any): Promise<ActivatedProperty[]> {
  const { data: stages, error: stagesErr } = await supabase
    .from('pipeline_stages')
    .select('id, name')
  if (stagesErr) throw stagesErr
  const stageByName = new Map<string, number>((stages ?? []).map((s: { id: number; name: string }) => [s.name, s.id]))
  const activeId = stageByName.get('Active')
  const preActiveIds = PRE_ACTIVE_STAGES.map(n => stageByName.get(n)).filter((v): v is number => v != null)
  if (activeId == null || preActiveIds.length === 0) return []

  const { data: props, error: propsErr } = await supabase
    .from('properties')
    .select('id, name, trellis_id, stage_id')
    .in('stage_id', preActiveIds)
  if (propsErr) throw propsErr
  if (!props?.length) return []

  const cutoff = activationCutoff()
  const propIds = props.map((p: PreActiveProp) => p.id)
  const trellisIds = props.map((p: PreActiveProp) => p.trellis_id).filter(Boolean)

  const { data: bwTasks, error: bwErr } = await supabase
    .from('breezeway_tasks')
    .select('property_id, task_title, due_date')
    .in('property_id', propIds)
    .gte('due_date', cutoff)
  if (bwErr) throw bwErr

  let trTasks: Array<{ trellis_property_id: string; title: string | null; scheduled_date: string | null }> = []
  if (trellisIds.length > 0) {
    const { data, error } = await supabase
      .from('trellis_task_snapshot')
      .select('trellis_property_id, title, scheduled_date')
      .in('trellis_property_id', trellisIds)
      .gte('scheduled_date', cutoff)
    if (error) throw error
    trTasks = data ?? []
  }

  const qualifying = qualifyingActivations(props, bwTasks ?? [], trTasks, cutoff)
  const activated: ActivatedProperty[] = []

  for (const p of props as PreActiveProp[]) {
    const evidence = qualifying.get(p.id)
    if (!evidence) continue
    const fromStage = (stages ?? []).find((s: { id: number }) => s.id === p.stage_id)
    // Guard on the stage we read: if a human moved the property concurrently,
    // this update matches 0 rows and we skip the audit writes.
    const { data: updated, error: updErr } = await supabase
      .from('properties')
      .update({ stage_id: activeId })
      .eq('id', p.id)
      .eq('stage_id', p.stage_id)
      .select('id')
    if (updErr) throw updErr
    if (!updated?.length) continue

    const note = `Auto-activated: ${evidence.source} ${evidence.title} on ${evidence.date}`
    await supabase.from('stage_transitions').insert({
      property_id: p.id,
      from_stage_id: p.stage_id,
      to_stage_id: activeId,
      transitioned_by: 'Auto (task detected)',
      notes: note,
    })
    await supabase.from('activity_log').insert({
      entity_type: 'property',
      entity_id: String(p.id),
      entity_name: p.name,
      action: 'stage_change',
      field_name: 'stage',
      old_value: fromStage?.name ?? String(p.stage_id),
      new_value: 'Active',
      changed_by: 'Auto (task detected)',
      metadata: { reason: note },
    })
    activated.push({ id: p.id, name: p.name, evidence })
  }
  return activated
}
