// Shared types and constants for the Lost Items UI.
// Mirrors Haven-OS lib/lost-items/types.ts.

export const LOST_ITEM_STATUSES = [
  'pending_pickup',
  'picked_up',
  'delivered',
  'failed',
  'completed',
] as const
export type LostItemStatus = (typeof LOST_ITEM_STATUSES)[number]

export const STATUS_LABELS: Record<LostItemStatus, string> = {
  pending_pickup: 'Pending Pickup',
  picked_up: 'Picked Up',
  delivered: 'Delivered',
  failed: 'Failed',
  completed: 'Completed',
}

export const LOST_ITEM_PIPELINE: LostItemStatus[] = [
  'pending_pickup',
  'picked_up',
  'delivered',
  'failed',
  'completed',
]

export const STATUS_COLORS: Record<LostItemStatus, string> = {
  pending_pickup: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  picked_up: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  delivered: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 border-green-200 dark:border-green-800',
  failed: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 border-red-200 dark:border-red-800',
  completed: 'bg-muted text-muted-foreground border-border',
}

export const RETURN_METHODS = ['shipped', 'guest_pickup', 'in_person', 'other'] as const
export type LostItemReturnMethod = (typeof RETURN_METHODS)[number]

export interface LostItemAssignment {
  haven_case_id: string
  assigned_user_id: number | null
  assigned_by_user_id: number | null
  assigned_at: string
  updated_at: string
  notes: string | null
  assignee?: { id: number; label: string; role: string } | null
}

export interface LostItemCase {
  id: string
  case_number: string
  status: LostItemStatus
  item_description: string
  found_location: string | null
  photo_urls?: string[]
  property_id: string | null
  property_name: string | null
  guest_name: string | null
  guest_email: string | null
  guest_phone: string | null
  reservation_ref?: string | null
  cleaning_vendor: string | null
  pickup_scheduled_at: string | null
  return_method: string | null
  shipping_carrier: string | null
  shipping_tracking: string | null
  notes: string | null
  source: string
  external_source: string | null
  external_url: string | null
  follow_up_date: string | null
  created_at: string
  updated_at: string
  property?: { id: string; name: string } | null
  assignee?: { id: string; full_name: string | null; email: string; avatar_url: string | null } | null
  events?: Array<{
    id: string
    case_id: string
    event_type: 'status_change' | 'comment' | 'assignment' | 'created' | 'updated'
    body: string | null
    from_value: string | null
    to_value: string | null
    actor_label: string | null
    created_at: string
    actor?: { id: string; full_name: string | null; email: string; avatar_url: string | null } | null
  }>
}

// Tendwell Supabase access wrapper used by the page-level fetcher.
// Pulls the Bearer token from the active Supabase session and forwards
// to our /api/lost-items/* proxy.
export async function authFetch(path: string, init?: RequestInit): Promise<any> {
  const { supabase } = await import('@/lib/supabase')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')
  const r = await fetch(path, {
    ...(init ?? {}),
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  })
  const text = await r.text()
  if (!r.ok) {
    let body: any = text
    try { body = JSON.parse(text) } catch {}
    throw new Error(body?.error || `Request failed (${r.status})`)
  }
  return text ? JSON.parse(text) : null
}
