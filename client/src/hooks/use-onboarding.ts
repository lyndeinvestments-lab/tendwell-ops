import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  ONBOARDING_STAGE_ID,
  daysSince,
  normalizeEmail,
  onboardingReadiness,
  sortReadiness,
  type OnboardingSubmission,
  type ReadinessAgreement,
  type ReadinessOwner,
  type ReadinessProperty,
  type ReadinessResult,
  type ReadinessSubmission,
} from '@/lib/onboarding'

// Query-key root for everything about submissions. The dialog invalidates this
// prefix after applying one, so the list, the counts and the sidebar badge all
// refresh together.
export const SUBMISSIONS_KEY = '/onboarding_submissions'

async function headCount(statuses: string[]): Promise<number> {
  const { count, error } = await supabase
    .from('onboarding_submissions')
    .select('id', { count: 'exact', head: true })
    .in('status', statuses)
  if (error) throw error
  return count ?? 0
}

export interface SubmissionCounts {
  pending: number
  applied: number
  rejected: number
  total: number
}

/** Counts for the KPI tiles. Independent of whichever status tab is showing. */
export function useSubmissionCounts() {
  return useQuery<SubmissionCounts>({
    queryKey: [SUBMISSIONS_KEY, 'counts'],
    queryFn: async () => {
      const [pending, applied, rejected] = await Promise.all([
        headCount(['pending']),
        headCount(['converted', 'approved']),
        headCount(['rejected']),
      ])
      return { pending, applied, rejected, total: pending + applied + rejected }
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

/** Cheap head count for the sidebar badge. Staff-only: pass `enabled` from the view permission. */
export function usePendingSubmissionCount(enabled: boolean) {
  return useQuery<number>({
    queryKey: [SUBMISSIONS_KEY, 'pending-count'],
    queryFn: () => headCount(['pending']),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export interface LinkedProperty {
  id: number
  name: string
  address: string | null
  stage: string | null
}
export interface LinkedOwner {
  id: string
  name: string | null
  email: string | null
  active: boolean | null
}

/** Names for the properties and owner accounts the visible submissions point at (one query each, batched). */
export function useSubmissionLookups(rows: OnboardingSubmission[] | undefined) {
  const propertyIds = Array.from(new Set((rows ?? []).map(r => r.property_id).filter((x): x is number => x != null))).sort((a, b) => a - b)
  const ownerIds = Array.from(new Set((rows ?? []).map(r => r.owner_id).filter((x): x is string => !!x))).sort()

  const properties = useQuery<Map<number, LinkedProperty>>({
    queryKey: ['/supabase/onboarding-linked-properties', propertyIds.join(',')],
    enabled: propertyIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id,name,address,pipeline_stages!properties_stage_id_fkey(name)')
        .in('id', propertyIds)
      if (error) throw error
      const m = new Map<number, LinkedProperty>()
      for (const p of (data ?? []) as any[]) {
        m.set(Number(p.id), { id: Number(p.id), name: p.name, address: p.address ?? null, stage: p.pipeline_stages?.name ?? null })
      }
      return m
    },
  })

  const owners = useQuery<Map<string, LinkedOwner>>({
    queryKey: ['/onboarding_submissions/owners', ownerIds.join(',')],
    enabled: ownerIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('property_owners').select('id,name,email,active').in('id', ownerIds)
      if (error) throw error
      return new Map(((data ?? []) as LinkedOwner[]).map(o => [o.id, o]))
    },
  })

  return { properties: properties.data, owners: owners.data }
}

export interface ContactMatch {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  /** How we found them: the owner's linked client, or an email match. */
  how: 'owner' | 'email'
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`)

/**
 * The existing client a submission belongs to, so converting it never creates a
 * duplicate contact: an owner-portal submission uses the owner's own linked
 * client; anything else is matched by email (case-insensitive).
 */
export function useSubmissionContactMatch(submission: OnboardingSubmission | null, enabled = true) {
  return useQuery<ContactMatch | null>({
    queryKey: [SUBMISSIONS_KEY, 'contact-match', submission?.id],
    enabled: enabled && !!submission,
    staleTime: 15_000,
    queryFn: async () => {
      const sub = submission!
      if (sub.owner_id) {
        const { data: owner } = await supabase.from('property_owners').select('contact_id').eq('id', sub.owner_id).maybeSingle()
        const cid = (owner as any)?.contact_id as string | null | undefined
        if (cid) {
          const { data: c } = await supabase.from('contacts').select('id,full_name,email,phone').eq('id', cid).maybeSingle()
          if (c) return { ...(c as any), how: 'owner' as const }
        }
      }
      const email = normalizeEmail(sub.contact_email)
      if (!email) return null
      const { data } = await supabase
        .from('contacts')
        .select('id,full_name,email,phone')
        .ilike('email', escapeLike(email))
        .order('created_at', { ascending: true })
        .limit(1)
      const c = (data ?? [])[0] as any
      return c ? { ...c, how: 'email' as const } : null
    },
  })
}

// ─── Properties in onboarding (readiness panel) ─────────────────────────────

export interface OnboardingPropertyRow {
  property: ReadinessProperty
  owners: ReadinessOwner[]
  submissions: ReadinessSubmission[]
  result: ReadinessResult
  /** Days since the property entered Onboarding (stage history, else when the row was created). */
  days: number | null
}

/**
 * Every Onboarding-stage property with the six go-live checks graded. Staff can
 * read all of these tables directly (is_staff() RLS), so this is plain batched
 * reads: one for the properties, then one per related table keyed on the
 * property / owner ids. Never fetches API secrets: the API-key check selects
 * only `property_id` behind an `api_key IS NOT NULL` filter.
 */
export function useOnboardingProperties() {
  return useQuery<OnboardingPropertyRow[]>({
    queryKey: ['/supabase/onboarding-readiness'],
    staleTime: 15_000,
    queryFn: async () => {
      const { data: props, error } = await supabase
        .from('properties')
        .select('id,name,address,door_code,has_auto_code,ical_url,trellis_id,contact_id,created_at')
        .eq('stage_id', ONBOARDING_STAGE_ID)
        .is('archived_at', null)
        .order('name')
      if (error) throw error
      const properties = (props ?? []) as unknown as (ReadinessProperty & { created_at: string | null })[]
      if (properties.length === 0) return []
      const ids = properties.map(p => p.id)

      const [ownerLinks, subs, apiSubs, transitions] = await Promise.all([
        supabase.from('owner_properties').select('owner_id,property_id').in('property_id', ids),
        supabase.from('onboarding_submissions').select('id,property_id,status,source,submitted_at').in('property_id', ids),
        supabase.from('onboarding_submissions').select('property_id').in('property_id', ids).not('api_key', 'is', null),
        supabase
          .from('stage_transitions')
          .select('property_id,created_at')
          .eq('to_stage_id', ONBOARDING_STAGE_ID)
          .in('property_id', ids)
          .order('created_at', { ascending: false }),
      ])
      if (ownerLinks.error) throw ownerLinks.error
      if (subs.error) throw subs.error
      if (apiSubs.error) throw apiSubs.error
      // Stage history is only a nicety (days in onboarding); never fail the panel over it.

      const ownerIds = Array.from(new Set((ownerLinks.data ?? []).map(l => l.owner_id)))
      let owners: ReadinessOwner[] = []
      let agreements: ReadinessAgreement[] = []
      if (ownerIds.length > 0) {
        const [o, a] = await Promise.all([
          supabase.from('property_owners').select('id,name,email,active,trellis_portal_url').in('id', ownerIds),
          // Explicit columns: this table also holds drawn signature images.
          supabase.from('owner_agreements').select('owner_id,status,owner_signed_at,created_at').in('owner_id', ownerIds),
        ])
        if (o.error) throw o.error
        if (a.error) throw a.error
        owners = (o.data ?? []) as ReadinessOwner[]
        agreements = (a.data ?? []) as ReadinessAgreement[]
      }

      const ownerById = new Map(owners.map(o => [o.id, o]))
      const apiProps = new Set((apiSubs.data ?? []).map(r => Number(r.property_id)))
      const since = new Map<number, string>()
      for (const t of (transitions.data ?? []) as { property_id: number; created_at: string | null }[]) {
        // Rows arrive newest first; keep the most recent entry into Onboarding.
        if (t.created_at && !since.has(Number(t.property_id))) since.set(Number(t.property_id), t.created_at)
      }

      const now = new Date()
      const rows: OnboardingPropertyRow[] = properties.map(property => {
        const linked = (ownerLinks.data ?? [])
          .filter(l => Number(l.property_id) === Number(property.id))
          .map(l => ownerById.get(l.owner_id))
          .filter((o): o is ReadinessOwner => !!o)
        const submissions = ((subs.data ?? []) as unknown as ReadinessSubmission[]).filter(s => Number(s.property_id) === Number(property.id))
        const result = onboardingReadiness({
          property,
          owners: linked,
          agreements: agreements.filter(a => linked.some(o => o.id === a.owner_id)),
          submissions,
          hasApiKey: apiProps.has(Number(property.id)),
        })
        return {
          property,
          owners: linked,
          submissions,
          result,
          days: daysSince(since.get(Number(property.id)) ?? property.created_at, now),
        }
      })
      return sortReadiness(rows)
    },
  })
}
