import { useAuth, type AuthUser } from '@/lib/auth'

/**
 * Who may read client money and client contact data — the client-side mirror
 * of `public.staff_has_financial_view()` (migration 20261008g). KEEP THE TWO
 * LISTS IDENTICAL.
 *
 * The database is the enforcement: for a crew login (cleaning / inspector /
 * supervisor — field pages only) `properties`, `contacts`, the money views,
 * the edit/activity logs and money settings return nothing. This helper only
 * picks the right SOURCE so crew pages read the crew-safe views
 * (`property_ops`, `operational_property_ops`) instead of getting empty data.
 */
export const FINANCIAL_VIEWS = [
  'dashboard', 'pipeline', 'contacts', 'quote-sheet', 'cost-tracking', 'master-list', 'pro-forma',
  'forecaster', 'revenue-report', 'financial-dashboard', 'north-star', 'report', 'invoicing',
  'onboarding-queue', 'settings', 'activity', 'trellis-sync',
] as const

export function canViewFinancialData(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  return FINANCIAL_VIEWS.some(v => (user.resolvedViews as readonly string[]).includes(v))
}

/** For the signed-in user as they are currently viewing the app (an admin
 *  previewing a crew role reads what that crew reads). */
export function useCanViewFinancials(): boolean {
  const { effectiveUser } = useAuth()
  return canViewFinancialData(effectiveUser)
}

/** The property table a user may read/write: the full row for finance staff,
 *  the crew-safe view (same ids, no money / client columns) for everyone else.
 *  property_ops is a simple view, so updates through it work. */
export function propertySource(canViewFinancials: boolean): 'properties' | 'property_ops' {
  return canViewFinancials ? 'properties' : 'property_ops'
}
