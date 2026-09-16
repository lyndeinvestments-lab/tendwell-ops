// Grouping for the owner-portal activity sweep. Pure — no I/O — so the
// bunching rules can be unit-tested against real shapes from activity_log.

export interface OwnerActivityRow {
  entity_type: string
  entity_id: string | null
  entity_name: string | null
  action: string
  field_name: string | null
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  created_at: string
}

export interface OwnerActivityChange {
  field: string
  from: string | null
  to: string | null
  action: string
}

export interface OwnerActivityRecord {
  entityType: string
  entityId: string | null
  entityName: string | null
  changes: OwnerActivityChange[]
}

export interface OwnerActivityGroup {
  owner: string
  at: string
  records: OwnerActivityRecord[]
  /** Total changes across every record — what the subject line counts. */
  changeCount: number
}

// One email per owner per sitting, not per row and not per property.
//
// Two real cases set this. Morgan Hogg's 2026-08-28 save wrote fourteen
// activity_log rows sharing one timestamp, because the portal logs one row per
// changed field — fourteen emails for one save. And Robin Bulba's 2026-07-27
// onboarding session touched eight different cabins over twenty-five minutes
// with two-to-fourteen-minute gaps; grouping per property turned one sitting
// into eight emails. Both read as spam and get the feature muted.
//
// Fifteen minutes matches the sweep interval, so an owner working straight
// through arrives as one message. A genuinely separate visit later in the day
// is still its own email.
export const BURST_WINDOW_MS = 15 * 60_000

/**
 * Collapse owner-attributed activity rows into one group per owner per sitting,
 * with the changes broken out per record inside. Input must be ordered by
 * created_at ascending.
 */
export function groupOwnerActivity(rows: OwnerActivityRow[]): OwnerActivityGroup[] {
  const groups: OwnerActivityGroup[] = []
  const open = new Map<string, { group: OwnerActivityGroup; lastAt: number }>()

  for (const row of rows) {
    const owner = ownerName(row.changed_by)
    if (!owner) continue // not an owner row; the query filter is deliberately loose

    const ts = Date.parse(row.created_at)
    const change: OwnerActivityChange = {
      field: row.field_name || row.action,
      from: row.old_value,
      to: row.new_value,
      action: row.action,
    }
    const recordKey = `${row.entity_type}::${row.entity_id ?? ''}`

    const current = open.get(owner)
    // The window runs from the PREVIOUS row, not the group's first row, so a
    // continuous session stays one email however long the person keeps working.
    // A gap longer than the window is what starts a new one.
    if (current && !Number.isNaN(ts) && ts - current.lastAt <= BURST_WINDOW_MS) {
      const existing = current.group.records.find(
        r => `${r.entityType}::${r.entityId ?? ''}` === recordKey,
      )
      if (existing) {
        existing.changes.push(change)
        if (!existing.entityName && row.entity_name) existing.entityName = row.entity_name
      } else {
        current.group.records.push({
          entityType: row.entity_type,
          entityId: row.entity_id,
          entityName: row.entity_name,
          changes: [change],
        })
      }
      current.group.changeCount++
      current.lastAt = ts
      continue
    }

    const group: OwnerActivityGroup = {
      owner,
      at: row.created_at,
      records: [{
        entityType: row.entity_type,
        entityId: row.entity_id,
        entityName: row.entity_name,
        changes: [change],
      }],
      changeCount: 1,
    }
    groups.push(group)
    open.set(owner, { group, lastAt: Number.isNaN(ts) ? 0 : ts })
  }

  return groups
}

/**
 * Strip the ' (owner)' suffix the audit trail uses to mark portal writes.
 * Returns null for anything that is not an owner row, so a staff edit can
 * never be reported as owner activity.
 */
export function ownerName(changedBy: string | null | undefined): string | null {
  if (!changedBy) return null
  const m = /^(.*)\s\(owner\)$/.exec(changedBy.trim())
  const name = m?.[1]?.trim()
  return name ? name : null
}

/** What the subject line calls the thing they touched. */
export function groupSubjectTarget(g: OwnerActivityGroup): string {
  const named = g.records.filter(r => r.entityName)
  if (named.length === 0) return 'their portal'
  if (named.length === 1) return named[0].entityName!
  // A sitting often mixes a property edit with a contact or payment change, so
  // only call them properties when they all are.
  const allProperties = named.every(r => r.entityType === 'property')
  return `${named.length} ${allProperties ? 'properties' : 'records'}`
}
