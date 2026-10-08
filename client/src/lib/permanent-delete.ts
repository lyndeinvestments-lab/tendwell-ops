// Permanent delete for properties/quotes and clients.
//
// The server does the real work in one transaction (admin_delete_property_permanently /
// admin_delete_contact_permanently, migration 20261008c) and re-checks every rule here.
// This module only shapes the impact preview for the confirm dialog and mirrors the
// server's name comparison, so the Delete button enables exactly when the server
// would accept the typed name.

export type DeleteKind = 'property' | 'contact'

export interface DeleteTarget {
  kind: DeleteKind
  id: number | string
  name: string
}

export interface DeleteImpact {
  kind: DeleteKind
  id: number | string
  name: string
  stage?: string | null
  erased: Record<string, number>
  unlinked: Record<string, number>
  linked_properties?: { id: number; name: string; stage: string | null }[]
  blocked_by_invoices: number
  name_shared_with_other_property?: boolean
}

export interface ImpactLine {
  table: string
  count: number
}

export interface ImpactSummary {
  blocked: boolean
  invoiceLines: number
  erased: ImpactLine[]
  unlinked: ImpactLine[]
  linkedProperties: { id: number; name: string; stage: string | null }[]
  /** True when nothing but the record itself goes: a clean duplicate. */
  isClean: boolean
}

function toLines(map: Record<string, number> | null | undefined): ImpactLine[] {
  return Object.entries(map ?? {})
    .map(([table, count]) => ({ table, count: Number(count) || 0 }))
    .filter(l => l.count > 0)
    .sort((a, b) => b.count - a.count || a.table.localeCompare(b.table))
}

export function summarizeImpact(impact: DeleteImpact): ImpactSummary {
  const erased = toLines(impact.erased)
  const unlinked = toLines(impact.unlinked)
  const linkedProperties = impact.linked_properties ?? []
  const invoiceLines = Number(impact.blocked_by_invoices) || 0
  return {
    blocked: invoiceLines > 0,
    invoiceLines,
    erased,
    unlinked,
    linkedProperties,
    isClean: erased.length === 0 && unlinked.length === 0 && linkedProperties.length === 0,
  }
}

/** Mirrors the server: trimmed, case-insensitive. */
export function confirmMatches(typed: string, name: string): boolean {
  const a = typed.trim().toLowerCase()
  return a.length > 0 && a === name.trim().toLowerCase()
}
