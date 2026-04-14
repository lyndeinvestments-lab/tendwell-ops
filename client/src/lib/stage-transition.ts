// Centralized stage transition logic.
// Handles: property update, stage_transitions insert, activity log,
// offboarded_at, and auto-creation of workflow tasks from templates.

import { supabase, logActivity } from '@/lib/supabase'

interface TransitionParams {
  propertyId: number
  propertyName: string
  fromStageId: number
  fromStageName: string
  toStageId: number
  toStageName: string
  changedBy: string
}

// Cache the public task list ID
let publicListIdCache: string | null = null

async function getPublicListId(): Promise<string | null> {
  if (publicListIdCache) return publicListIdCache
  const { data } = await supabase.from('task_lists').select('id').eq('type', 'public').limit(1).single()
  if (data) publicListIdCache = data.id
  return publicListIdCache
}

export async function executeStageTransition(params: TransitionParams): Promise<{ ok: boolean; error?: string }> {
  const { propertyId, propertyName, fromStageId, fromStageName, toStageId, toStageName, changedBy } = params

  // 1. Update property stage
  const updates: Record<string, any> = { stage_id: toStageId }
  if (toStageName === 'Offboarded') updates.offboarded_at = new Date().toISOString()
  const { error } = await supabase.from('properties').update(updates).eq('id', propertyId)
  if (error) return { ok: false, error: error.message }

  // 2. Insert stage_transitions record
  await supabase.from('stage_transitions').insert({
    property_id: propertyId,
    from_stage_id: fromStageId,
    to_stage_id: toStageId,
    changed_by: changedBy,
    transitioned_at: new Date().toISOString(),
  })

  // 3. Activity log
  logActivity({
    entity_type: 'pipeline',
    entity_id: String(propertyId),
    entity_name: propertyName,
    action: 'update',
    field_name: 'stage',
    old_value: fromStageName,
    new_value: toStageName,
    changed_by: changedBy,
  })

  // 4. Create workflow tasks from templates (fire-and-forget)
  createWorkflowTasks(fromStageName, toStageName, propertyId, propertyName, changedBy).catch(() => {})

  return { ok: true }
}

async function createWorkflowTasks(
  fromStage: string,
  toStage: string,
  propertyId: number,
  propertyName: string,
  createdBy: string,
) {
  // Fetch matching enabled templates
  let query = supabase
    .from('stage_workflow_templates')
    .select('*')
    .eq('to_stage', toStage)
    .eq('enabled', true)
    .order('sort_order')

  const { data: templates } = await query
  if (!templates || templates.length === 0) return

  // Filter: match from_stage (null = any)
  const matching = templates.filter(t => !t.from_stage || t.from_stage === fromStage)
  if (matching.length === 0) return

  const listId = await getPublicListId()
  if (!listId) return

  const today = new Date()
  const rows = matching.map(t => {
    const title = (t.title || '').replace(/\{property_name\}/g, propertyName)
    const dueDate = new Date(today)
    dueDate.setDate(dueDate.getDate() + (t.due_offset_days || 0))

    // Build description from checklist items
    let description = t.description || ''
    const items = Array.isArray(t.checklist_items) ? t.checklist_items : []
    if (items.length > 0) {
      description += (description ? '\n\n' : '') + 'Checklist:\n' + items.map((i: string) => `- [ ] ${i}`).join('\n')
    }

    return {
      title,
      description,
      status: 'To Do',
      priority: 'Medium',
      category: 'Onboarding',
      property_name: propertyName,
      assignee_name: t.default_assignee_name || null,
      due_date: dueDate.toISOString().split('T')[0],
      created_by: createdBy,
      list_id: listId,
      workflow_template_id: t.id,
    }
  })

  await supabase.from('tasks').insert(rows)
}
