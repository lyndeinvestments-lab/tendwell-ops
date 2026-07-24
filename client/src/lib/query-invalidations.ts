import type { QueryClient } from '@tanstack/react-query'

// Every property-derived query key registered across the app. When a property
// row changes in any view, invalidate ALL of these so every cache tied to
// the property table refetches. Prevents the cross-view desync where Quote
// Sheet / Master List / Pipeline / Cost Tracking hold stale overlays of
// the same row.
//
// Add new prefixes here when introducing a new property-backed query key.
const PROPERTY_QUERY_KEY_PREFIXES = [
  '/supabase/properties',
  '/supabase/properties-list',
  '/supabase/property-detail',
  '/supabase/property-notes',
  '/supabase/pipeline',
  '/supabase/master-list',
  '/supabase/master-list-archived',
  '/supabase/quote-sheet',
  '/supabase/operational_properties',
  '/supabase/dashboard-stats',
  '/supabase/dashboard-velocity',
  '/supabase/dashboard-followups',
  '/supabase/dashboard-unassigned',
  '/supabase/dashboard-inspections',
  '/supabase/dashboard-scheduled-week',
  '/supabase/pro-forma',
  '/supabase/revenue',
  '/supabase/contact-properties',
  // Cmd+K palette read-cache. Without this prefix, the palette could
  // serve a stale property list (renamed/moved/created elsewhere) for
  // up to its 30s staleTime after any property mutation.
  '/supabase/command-palette-properties',
  // Linen Tracker is a property-derived read view (queries all properties
  // with their towel/bed columns). Without this prefix, any property
  // mutation made elsewhere — including the modal's linen-program toggle,
  // the bulk-edit save, etc. — left linen-tracker stale until window-focus
  // refetch.
  '/supabase/linen-tracker',
  // Property-derived read views that were previously NOT invalidated, so an
  // edit made anywhere (modal, quote sheet, master list, …) left them stale
  // until their staleTime lapsed — the "have to hard-refresh to see it" bug.
  // These all read property fields the modal edits (address, door/other codes,
  // Wi-Fi, filter size, bed counts, cleaner pay, stage, etc.).
  '/supabase/access-codes',            // Access Codes page (operational_properties view)
  '/supabase/ac-filters',              // AC Filters page (operational_properties view)
  '/supabase/alerts-properties',       // Alerts page property scan
  '/supabase/issues-properties',       // Issues page property picker
  '/supabase/all-assignments',         // Cleaners page (joins properties)
  '/supabase/cleaners-active-props',   // Cleaners page active-properties list
  '/supabase/inspection-priority/properties', // Inspection priority dashboard
  '/supabase/inspection-form-properties',      // Inspection form property picker
  '/supabase/assignable-properties',   // ContactModal property picker
  '/supabase/hostaway-property-options',       // Hostaway link picker
  '/supabase/trellis-sync',            // API Sync page (opsProperties sub-query)
  '/supabase/owner-assignable-properties',     // Settings → Owners property picker
  '/supabase/owner-assigned-props',    // Settings → Owners assigned list
  '/supabase/owner-props-for-agreements',      // Settings → Agreements picker
  '/onboarding_submissions/merge-candidates',  // Onboarding queue merge picker
  // Owner portal's own property list (RPC get_owner_properties). Note: no
  // '/supabase/' prefix — the startsWith predicate handles it either way.
  'owner-properties',
]

export function invalidateAllPropertyQueries(
  qc: QueryClient,
  opts?: { except?: string[] },
) {
  const except = opts?.except ?? []
  qc.invalidateQueries({
    predicate: q => {
      const first = Array.isArray(q.queryKey) ? q.queryKey[0] : q.queryKey
      if (typeof first !== 'string') return false
      // Skip any key whose matching prefix is in `except`. Callers that have
      // already written a fresh row into a specific cache (e.g. the property
      // detail modal using the write's RETURNING representation) pass that
      // prefix here so a racy stale re-read does not clobber the good value.
      if (except.some(p => first.startsWith(p))) return false
      return PROPERTY_QUERY_KEY_PREFIXES.some(p => first.startsWith(p))
    },
  })
}
