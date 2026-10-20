// Shared data access for the price configuration cards (Prices tab) and the
// Unbilled work lists, which show what each task will bill at. Query keys keep
// their original 'task-audit' prefix so one invalidation refreshes both.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  APP_SETTING_AUX_BILLABLE,
  APP_SETTING_EXTRA_PRICING,
  resolveAuxSettings,
  type AuxBillingSettings,
} from '@shared/aux-tasks'
import { isMissingSchemaError } from '@shared/db-errors'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClientFeeOverride {
  id: string
  contact_id: string
  service_type: string
  charge: number
  hot_tub_charge: number | null
  note: string | null
  // Evidence (migration 20261009f). Absent until that migration is applied.
  accepted_date?: string | null
  source_link?: string | null
  updated_by: string | null
  updated_at: string | null
  contacts?: { full_name: string | null; company: string | null } | { full_name: string | null; company: string | null }[] | null
}

export interface OverridesData {
  rows: ClientFeeOverride[]
  // False until migration 20261009f adds accepted_date / source_link: the
  // dialog then hides those fields instead of failing every save.
  hasEvidence: boolean
}

export interface ClientPriceAgreement {
  id: string
  contact_id: string
  accepted_clean_price: number | null
  linen_fee: number | null
  onboarding_fee: number | null
  accepted_date: string | null
  source_link: string | null
  note: string | null
  updated_by: string | null
  updated_at: string | null
  contacts?: { full_name: string | null; company: string | null } | { full_name: string | null; company: string | null }[] | null
}

export interface AgreementsData {
  rows: ClientPriceAgreement[]
  // False until migration 20261009f creates client_price_agreements.
  available: boolean
}

export interface ContactLite { id: string; full_name: string | null; company: string | null }

// ── Helpers ───────────────────────────────────────────────────────────────────

// The generated Database types predate several of these tables; these queries
// go through an untyped handle so they do not wait on a types regeneration.
export const db = supabase as any

/** Fee types an override can target: the ones with a standard price. */
export function pricedServiceTypes(settings: AuxBillingSettings): string[] {
  return Object.keys(settings.pricing).sort()
}

export function clientName(c: { full_name: string | null; company: string | null } | null | undefined): string {
  return c?.company?.trim() || c?.full_name?.trim() || 'Unnamed client'
}

export function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

// PostgREST caps a response at 1000 rows and reports it only in a header,
// same trap as api/invoices/_lib.ts fetchAllRows. Page until a short page.
export async function fetchAll<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }> },
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    // Keep the code so isMissingSchemaError can spot a not-yet-applied migration.
    if (error) throw Object.assign(new Error(error.message), { code: error.code })
    const page = data ?? []
    out.push(...page)
    if (page.length < PAGE || out.length > 50_000) return out
  }
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function useAuxSettings() {
  return useQuery<AuxBillingSettings>({
    queryKey: ['task-audit', 'settings'],
    queryFn: async () => {
      const { data, error } = await db.from('app_settings').select('key, value').in('key', [APP_SETTING_EXTRA_PRICING, APP_SETTING_AUX_BILLABLE])
      if (error) throw error
      const by = new Map<string, unknown>(((data ?? []) as Array<{ key: string; value: unknown }>).map(r => [r.key, r.value]))
      return resolveAuxSettings({ pricing: by.get(APP_SETTING_EXTRA_PRICING), billable: by.get(APP_SETTING_AUX_BILLABLE) })
    },
  })
}

export function useFeeOverrides() {
  return useQuery<OverridesData>({
    queryKey: ['task-audit', 'fee-overrides'],
    queryFn: async () => {
      const base = 'id, contact_id, service_type, charge, hot_tub_charge, note, updated_by, updated_at, contacts(full_name, company)'
      try {
        const rows = await fetchAll<ClientFeeOverride>(() => db
          .from('client_fee_overrides')
          .select(`${base}, accepted_date, source_link`)
          .order('id'))
        return { rows, hasEvidence: true }
      } catch (e) {
        if (!isMissingSchemaError(e)) throw e
        const rows = await fetchAll<ClientFeeOverride>(() => db.from('client_fee_overrides').select(base).order('id'))
        return { rows, hasEvidence: false }
      }
    },
    staleTime: 300_000,
  })
}

export function useClientAgreements(enabled = true) {
  return useQuery<AgreementsData>({
    queryKey: ['task-audit', 'price-agreements'],
    queryFn: async () => {
      try {
        const rows = await fetchAll<ClientPriceAgreement>(() => db
          .from('client_price_agreements')
          .select('id, contact_id, accepted_clean_price, linen_fee, onboarding_fee, accepted_date, source_link, note, updated_by, updated_at, contacts(full_name, company)')
          .order('id'))
        return { rows, available: true }
      } catch (e) {
        if (isMissingSchemaError(e)) return { rows: [], available: false }
        throw e
      }
    },
    staleTime: 300_000,
    enabled,
  })
}
