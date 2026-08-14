import { createClient } from '@supabase/supabase-js'
import type { Database } from '@shared/database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Strongly-typed client. With <Database> parameterized, every .from('xyz')
// call and column reference is checked against the schema at compile time —
// the silent runtime bugs from days 2-5 (wrong column names, nonexistent
// tables) would have failed `tsc` instead of returning 400 at runtime.
// Types generated from the live schema via the Supabase MCP; regenerate via
//   mcp__supabase__generate_typescript_types  →  shared/database.types.ts
//
// Use localStorage so the Supabase session persists across page refreshes and
// new tabs. The previous in-memory adapter caused every reload to lose the
// session, which meant any RLS policy that checked auth.uid() returned 0 rows
// — including the activity_log and property_edit_log tables.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'tendwell-sb-auth',
  },
  // cache: 'no-store' on every REST call (2026-08-13, the "quote sheet
  // frozen at 80 quotes while Safari shows 81" bug). Supabase's gateway
  // returns NO Cache-Control header, and the iOS home-screen web app's HTTP
  // cache served repeat GETs of the SAME URL from disk without hitting the
  // network — Supabase's API logs showed the created row's POST (201) and
  // the moving-timestamp KPI queries arriving, while the static-URL list
  // query never arrived again after its first fetch. React Query "refetched"
  // into the stale cached bytes, so invalidation, the manual refresh button,
  // and focus refetches all appeared to do nothing. no-store forces every
  // read to the network; payloads here are small and this app's whole point
  // is freshness.
  global: {
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
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
      // activity_log.metadata is JSONB; Record<string, unknown> isn't assignable
      // to the codegen-derived Json type. Cast at the boundary.
      metadata: (entry.metadata ?? null) as any,
    })
    if (error) {
      console.warn('[logActivity] insert failed:', error.message)
    }
  } catch (e) {
    console.warn('[logActivity] unexpected error:', e)
  }
}

// ─── Current-user identity resolution for audit logging ──────────────────────
// Most callers of logPropertyEdit forget to pass `changedBy`, so historical
// audit entries had `changed_by = null` (e.g. all 12 filter_size edits on
// 2026-04-28). Rather than fix every call site, resolve the current user's
// app_users.label automatically when no name was provided. Cached briefly so
// rapid bulk edits don't make a round-trip per row.

let cachedIdentity: { label: string; cachedAt: number } | null = null
const IDENTITY_TTL_MS = 60_000

export function clearCachedIdentity(): void {
  cachedIdentity = null
}

async function resolveCurrentUserLabel(): Promise<string | null> {
  if (cachedIdentity && Date.now() - cachedIdentity.cachedAt < IDENTITY_TTL_MS) {
    return cachedIdentity.label
  }
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return null
    const { data } = await supabase
      .from('app_users')
      .select('label')
      .eq('google_email', user.email)
      .maybeSingle()
    const label = (data?.label as string | undefined) ?? user.email ?? null
    if (label) cachedIdentity = { label, cachedAt: Date.now() }
    return label
  } catch {
    return null
  }
}

// ─── Property-edit convenience wrapper ───────────────────────────────────────
// Writes to both activity_log (new) and property_edit_log (legacy compat).
// When `changedBy` is omitted, falls back to the signed-in user's
// app_users.label (or auth email) so the audit log is never anonymous.

export async function logPropertyEdit(
  propertyId: string | number,
  fieldName: string,
  oldValue: string | number | null | undefined,
  newValue: string | number | null | undefined,
  propertyName?: string | null,
  changedBy?: string | null,
): Promise<void> {
  // Suppress no-op edits (value unchanged) so the audit log isn't noisy.
  const normalize = (v: string | number | null | undefined) =>
    v == null || v === '' ? null : String(v).trim()
  if (normalize(oldValue) === normalize(newValue)) return

  // If no property name provided, try to look it up (best-effort)
  let resolvedName = propertyName ?? null
  if (!resolvedName) {
    try {
      const { data } = await supabase
        .from('properties')
        .select('name')
        .eq('id', Number(propertyId))
        .single()
      resolvedName = data?.name ?? null
    } catch {
      // ignore — we'll log without a name
    }
  }

  // Resolve the user when the caller didn't supply one. Best-effort —
  // returns null if there's no Supabase session or the lookup fails.
  const resolvedChangedBy = changedBy ?? (await resolveCurrentUserLabel())

  // New central log
  await logActivity({
    entity_type: 'property',
    entity_id: String(propertyId),
    entity_name: resolvedName,
    action: fieldName === 'stage' ? 'stage_change' : 'update',
    field_name: fieldName,
    old_value: oldValue != null ? String(oldValue) : null,
    new_value: newValue != null ? String(newValue) : null,
    changed_by: resolvedChangedBy,
  })

  // Legacy table — log errors but never throw. Kept because the property
  // modal's profit-history chart reads ce_charged/cleaner_pay history from
  // it. `changed_by` IS a real column with DEFAULT 'ops-user' — omitting it
  // (as this insert used to) is where every mystery "ops-user" row in the
  // Activity feed came from; pass the resolved name so both logs agree.
  try {
    const { error } = await supabase.from('property_edit_log').insert({
      property_id: Number(propertyId),
      field_name: fieldName,
      old_value: oldValue != null ? String(oldValue) : null,
      new_value: newValue != null ? String(newValue) : null,
      changed_by: resolvedChangedBy ?? undefined,
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
