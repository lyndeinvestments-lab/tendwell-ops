import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Use localStorage so the Supabase session persists across page refreshes and
// new tabs. The previous in-memory adapter caused every reload to lose the
// session, which meant any RLS policy that checked auth.uid() returned 0 rows
// — including the activity_log and property_edit_log tables.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'tendwell-sb-auth',
  },
})

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivityEntityType =
  | 'property'
  | 'pipeline'
  | 'contact'
  | 'inspection'
  | 'cleaner'
  | 'linen'
  | 'access_code'
  | 'ac_filter'
  | 'other'

export type ActivityAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'stage_change'
  | 'note'
  | 'other'

export interface ActivityLogEntry {
  entity_type: ActivityEntityType
  entity_id?: string | number | null
  entity_name?: string | null
  action: ActivityAction
  field_name?: string | null
  old_value?: string | number | null
  new_value?: string | number | null
  changed_by?: string | null
  metadata?: Record<string, unknown> | null
}

// ─── Central activity logger ──────────────────────────────────────────────────
// Writes to activity_log. All pages should call this when data changes.
// Never throws — audit logging must never block the UI.

export async function logActivity(entry: ActivityLogEntry): Promise<void> {
  try {
    const { error } = await supabase.from('activity_log').insert({
      entity_type: entry.entity_type,
      entity_id: entry.entity_id != null ? String(entry.entity_id) : null,
      entity_name: entry.entity_name ?? null,
      action: entry.action,
      field_name: entry.field_name ?? null,
      old_value: entry.old_value != null ? String(entry.old_value) : null,
      new_value: entry.new_value != null ? String(entry.new_value) : null,
      changed_by: entry.changed_by ?? null,
      metadata: entry.metadata ?? null,
    })
    if (error) {
      console.warn('[logActivity] insert failed:', error.message)
    }
  } catch (e) {
    console.warn('[logActivity] unexpected error:', e)
  }
}

// ─── Property-edit convenience wrapper ───────────────────────────────────────
// Writes to both activity_log (new) and property_edit_log (legacy compat).

export async function logPropertyEdit(
  propertyId: string | number,
  fieldName: string,
  oldValue: string | number | null | undefined,
  newValue: string | number | null | undefined,
  propertyName?: string | null,
  changedBy?: string | null,
): Promise<void> {
  // If no property name provided, try to look it up (best-effort)
  let resolvedName = propertyName ?? null
  if (!resolvedName) {
    try {
      const { data } = await supabase
        .from('properties')
        .select('name')
        .eq('id', propertyId)
        .single()
      resolvedName = data?.name ?? null
    } catch {
      // ignore — we'll log without a name
    }
  }

  // New central log
  await logActivity({
    entity_type: 'property',
    entity_id: String(propertyId),
    entity_name: resolvedName,
    action: fieldName === 'stage' ? 'stage_change' : 'update',
    field_name: fieldName,
    old_value: oldValue != null ? String(oldValue) : null,
    new_value: newValue != null ? String(newValue) : null,
    changed_by: changedBy ?? null,
  })

  // Legacy table — log errors but never throw
  // Note: property_edit_log may not have changed_by column; keep insert minimal
  try {
    const { error } = await supabase.from('property_edit_log').insert({
      property_id: propertyId,
      field_name: fieldName,
      old_value: oldValue != null ? String(oldValue) : null,
      new_value: newValue != null ? String(newValue) : null,
    })
    if (error) console.warn('[logPropertyEdit] legacy insert failed:', error.message)
  } catch (e) {
    console.warn('[logPropertyEdit] legacy insert error:', e)
  }
}

// ─── Stage colors ─────────────────────────────────────────────────────────────

export const STAGE_COLORS: Record<string, string> = {
  Lead: '#6b7280',
  Quote: '#9333ea',
  Onboarding: '#3b82f6',
  Active: '#3f7a63',
  Offboarding: '#f97316',
  Offboarded: '#9ca3af',
}

export const STAGE_ORDER = ['Lead', 'Quote', 'Onboarding', 'Active', 'Offboarding', 'Offboarded']
