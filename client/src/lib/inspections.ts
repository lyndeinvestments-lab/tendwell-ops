// Shared inspection types + select string, used by the Inspections page and
// the inspector-facing MyInspectionsTab so the row shape can't drift.

export type InspectionStatus = 'scheduled' | 'completed' | 'skipped'
export type ReinspectUrgency = 'none' | 'low' | 'medium' | 'high' | 'critical'

export type Inspection = {
  id: string
  property_id: number
  cleaner_id: string | null
  cleaner_name: string | null
  inspector_id: string | null
  inspected_by: string | null
  inspected_at: string
  scheduled_for: string | null
  last_cleaned_on: string | null
  status: InspectionStatus
  reinspect_urgency: ReinspectUrgency
  reinspect_by: string | null
  overall_score: number | null
  cleanliness_score: number | null
  linens_score: number | null
  supplies_score: number | null
  exterior_score: number | null
  notes: string | null
  photos_url: string[] | null
  share_token: string | null
  properties?: { name: string; address: string | null } | null
  cleaners?: { full_name: string } | null
  inspectors?: { full_name: string } | null
}

export const INSPECTION_SELECT = 'id, property_id, cleaner_id, cleaner_name, inspector_id, inspected_by, inspected_at, scheduled_for, last_cleaned_on, status, reinspect_urgency, reinspect_by, overall_score, cleanliness_score, linens_score, supplies_score, exterior_score, notes, photos_url, share_token, properties(name, address), cleaners!inspections_cleaner_id_fkey(full_name), inspectors:cleaners!inspections_inspector_id_fkey(full_name)'

export function scoreColorClass(score: number | null): string {
  if (score == null) return 'bg-muted text-muted-foreground'
  if (score >= 4) return 'bg-success/15 text-success'
  if (score >= 3) return 'bg-warning/15 text-warning'
  return 'bg-destructive/15 text-destructive'
}
