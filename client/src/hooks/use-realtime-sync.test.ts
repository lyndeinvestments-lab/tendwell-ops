import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateForTable, REALTIME_TABLES } from './use-realtime-sync'

function seed(qc: QueryClient, key: unknown[]) {
  qc.setQueryData(key, { seeded: true })
}

function isInvalidated(qc: QueryClient, key: unknown[]) {
  return qc.getQueryState(key)?.isInvalidated ?? false
}

describe('invalidateForTable', () => {
  it('property tables hit the shared property registry, not unrelated keys', () => {
    const qc = new QueryClient()
    seed(qc, ['/supabase/ac-filters'])
    seed(qc, ['/supabase/master-list'])
    seed(qc, ['cleaners'])
    invalidateForTable(qc, 'properties')
    expect(isInvalidated(qc, ['/supabase/ac-filters'])).toBe(true)
    expect(isInvalidated(qc, ['/supabase/master-list'])).toBe(true)
    expect(isInvalidated(qc, ['cleaners'])).toBe(false)
  })

  it('non-property tables invalidate their own key families only', () => {
    const qc = new QueryClient()
    seed(qc, ['cleaners'])
    seed(qc, ['contacts', 'with-property-counts'])
    seed(qc, ['/supabase/inspections-all', { page: 1 }])
    seed(qc, ['/supabase/cleaning-issues'])
    seed(qc, ['/supabase/ac-filters'])

    invalidateForTable(qc, 'cleaners')
    expect(isInvalidated(qc, ['cleaners'])).toBe(true)
    expect(isInvalidated(qc, ['/supabase/ac-filters'])).toBe(false)

    invalidateForTable(qc, 'contacts')
    expect(isInvalidated(qc, ['contacts', 'with-property-counts'])).toBe(true)

    invalidateForTable(qc, 'inspections')
    expect(isInvalidated(qc, ['/supabase/inspections-all', { page: 1 }])).toBe(true)

    invalidateForTable(qc, 'cleaning_issues')
    expect(isInvalidated(qc, ['/supabase/cleaning-issues'])).toBe(true)

    expect(isInvalidated(qc, ['/supabase/ac-filters'])).toBe(false)
  })

  it('an unknown table is a no-op', () => {
    const qc = new QueryClient()
    seed(qc, ['cleaners'])
    seed(qc, ['/supabase/ac-filters'])
    invalidateForTable(qc, 'some_future_table')
    expect(isInvalidated(qc, ['cleaners'])).toBe(false)
    expect(isInvalidated(qc, ['/supabase/ac-filters'])).toBe(false)
  })

  it('every subscribed table routes to at least one cache — a table added to REALTIME_TABLES without a mapping would silently drop its events', () => {
    // One representative query key per subscribed table.
    const representative: Record<(typeof REALTIME_TABLES)[number], unknown[]> = {
      properties: ['/supabase/ac-filters'],
      property_notes: ['/supabase/property-notes', 42],
      cleaners: ['cleaners'],
      contacts: ['contacts'],
      inspections: ['/supabase/inspections-all'],
      cleaning_issues: ['/supabase/cleaning-issues'],
    }
    for (const table of REALTIME_TABLES) {
      const qc = new QueryClient()
      seed(qc, representative[table])
      invalidateForTable(qc, table)
      expect(isInvalidated(qc, representative[table]), `table ${table} has no invalidation route`).toBe(true)
    }
  })
})
