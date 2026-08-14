// Canonical catalogue of app "areas" reachable through in-app API keys.
//
// Single source of truth shared by:
//   • the client   — Settings → API Keys picker (client/src/components/settings/ApiKeysSection.tsx)
//   • the server   — generic scoped data gateway (api/data/[resource].ts)
//
// Each area maps a URL/scope slug to a real Postgres table or view. A key is
// granted per-area access at one of two levels:
//   • view  → scope `<key>:view`  → GET  (list / by-id)
//   • edit  → scope `<key>:edit`  → POST (create) + PATCH (update). Implies view.
//
// SECURITY BOUNDARY — sensitive areas are intentionally ABSENT from this list
// and therefore can never be granted to an API key or reached via /api/data:
//   app_users, api_keys, app_settings, property_owners, owner_*, portal_*,
//   agreement_config, owner_agreements, notification_*, auth, and all *_backup_*
//   / internal sync-log tables. User/key/owner/agreement/settings management is
//   never exposed to API keys.
//
// Keep this file dependency-free — it is imported from both the Vite client
// bundle and the NodeNext serverless functions.

export type ApiAccess = 'rw' | 'read'

export interface ApiArea {
  /** URL slug + scope prefix, e.g. "properties" → /api/data/properties, scopes properties:view / properties:edit */
  key: string
  /** Human label for the picker */
  label: string
  /** Grouping for the picker UI */
  group: string
  /** Underlying Postgres table or view */
  table: string
  /** Primary-key column (used for by-id GET and PATCH) */
  pk: string
  /** rw = view + create/edit offered; read = view only (reports / snapshots) */
  access: ApiAccess
  /** Optional clarifying note shown in the picker */
  note?: string
}

export const API_AREAS: ApiArea[] = [
  // ─── Sales ────────────────────────────────────────────────────────────────
  { key: 'clients',           label: 'Clients',              group: 'Sales',       table: 'contacts',               pk: 'id', access: 'rw' },
  { key: 'client-notes',      label: 'Client Notes',         group: 'Sales',       table: 'contact_notes',          pk: 'id', access: 'rw' },

  // ─── Operations ─────────────────────────────────────────────────────────────
  { key: 'properties',        label: 'Properties',           group: 'Operations',  table: 'properties',             pk: 'id', access: 'rw', note: 'Includes access codes, AC filter size, bed sizes, and Wi-Fi (all property columns).' },
  { key: 'property-notes',    label: 'Property Notes',       group: 'Operations',  table: 'property_notes',         pk: 'id', access: 'rw' },
  { key: 'property-supplies', label: 'Property Supplies',    group: 'Operations',  table: 'property_supplies',      pk: 'id', access: 'rw' },
  { key: 'inspections',       label: 'Inspections',          group: 'Operations',  table: 'inspections',            pk: 'id', access: 'rw' },
  { key: 'verifications',     label: 'Property Verifications',group: 'Operations',  table: 'property_verifications', pk: 'id', access: 'rw' },
  { key: 'linen-inventory',   label: 'Linen Inventory',      group: 'Operations',  table: 'linen_inventory_counts', pk: 'id', access: 'rw' },
  { key: 'shipments',         label: 'Incoming Shipments',   group: 'Operations',  table: 'incoming_shipments',     pk: 'id', access: 'rw' },
  { key: 'weigh-ins',         label: 'Laundry Weigh-Ins',    group: 'Operations',  table: 'laundry_weigh_ins',      pk: 'id', access: 'rw' },
  { key: 'lost-items',        label: 'Lost Items',           group: 'Operations',  table: 'lost_item_assignments',  pk: 'haven_case_id', access: 'rw' },
  { key: 'clean-assignments', label: 'Cleaning Assignments', group: 'Operations',  table: 'clean_assignments',      pk: 'id', access: 'rw' },

  // ─── Management ──────────────────────────────────────────────────────────────
  { key: 'issues',            label: 'Issues',               group: 'Management',  table: 'cleaning_issues',        pk: 'id', access: 'rw', note: 'The Issues Tracker. Richer create semantics are also available at POST /api/issues.' },
  { key: 'tasks',             label: 'Tasks',                group: 'Management',  table: 'tasks',                  pk: 'id', access: 'rw' },
  { key: 'cleaners',          label: 'Cleaners',             group: 'Management',  table: 'cleaners',               pk: 'id', access: 'rw' },

  // ─── Reports (view only) ─────────────────────────────────────────────────────
  { key: 'property-list',     label: 'Property List',        group: 'Reports',     table: 'operational_properties', pk: 'id', access: 'read' },
  { key: 'trellis-tasks',     label: 'Trellis Tasks',        group: 'Reports',     table: 'trellis_task_snapshot',  pk: 'id', access: 'read' },
  { key: 'pipeline-stages',   label: 'Pipeline Stages',      group: 'Reports',     table: 'pipeline_stages',        pk: 'id', access: 'read' },
  { key: 'stage-transitions', label: 'Stage Transitions',    group: 'Reports',     table: 'stage_transitions',      pk: 'id', access: 'read' },
  { key: 'activity',          label: 'Activity Log',         group: 'Reports',     table: 'activity_log',           pk: 'id', access: 'read' },
  { key: 'fin-monthly-cleans',label: 'Financials: Monthly Cleans', group: 'Reports', table: 'financial_monthly_cleans', pk: 'id', access: 'read' },
  { key: 'fin-task-load',     label: 'Financials: Task Load',group: 'Reports',     table: 'financial_task_load',    pk: 'id', access: 'read' },
  { key: 'fin-snapshot',      label: 'Financials: Monthly Snapshot', group: 'Reports', table: 'monthly_financial_snapshot', pk: 'id', access: 'read' },
  { key: 'proforma',          label: 'Pro Forma',            group: 'Reports',     table: 'property_proforma',      pk: 'id', access: 'read' },
  { key: 'north-star',        label: 'North Star',           group: 'Reports',     table: 'north_star_values',      pk: 'id', access: 'read' },
]

const AREA_BY_KEY = new Map(API_AREAS.map(a => [a.key, a]))

export function findArea(key: string | undefined | null): ApiArea | undefined {
  if (!key) return undefined
  return AREA_BY_KEY.get(key)
}

export function scopeView(key: string): string {
  return `${key}:view`
}
export function scopeEdit(key: string): string {
  return `${key}:edit`
}

/** Every scope string this catalogue can grant (view for all, edit for rw). */
export function allScopes(): string[] {
  const out: string[] = []
  for (const a of API_AREAS) {
    out.push(scopeView(a.key))
    if (a.access === 'rw') out.push(scopeEdit(a.key))
  }
  return out
}
