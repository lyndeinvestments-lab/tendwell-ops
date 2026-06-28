import { useState, useMemo, Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useContacts } from '@/hooks/use-contacts'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowUpDown, ChevronDown, ChevronRight, Users } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageContainer } from '@/components/PageContainer'
import { StatusBadge } from '@/components/StatusBadge'
import { profitTier } from '@/lib/profit-colors'
import { useInProFormaWrapper } from '@/pages/pro-forma-wrapper'

// ---------------------------------------------------------------------------
// Helpers (mirrored from revenue-report.tsx)
// ---------------------------------------------------------------------------

function ProfitBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>
  const t = profitTier(pct)
  const tier = t === 'high' ? 'High' : t === 'mid' ? 'Mid' : 'Low'
  const tone = t === 'high' ? 'success' : t === 'mid' ? 'warning' : 'destructive'
  return (
    <StatusBadge tone={tone}>
      {pct.toFixed(1)}%<span className="sr-only"> ({tier} profit)</span>
    </StatusBadge>
  )
}

function HealthDot({ pct }: { pct: number }) {
  const t = profitTier(pct)
  const tier = t === 'high' ? 'High' : t === 'mid' ? 'Mid' : 'Low'
  const color = t === 'high' ? 'bg-success' : t === 'mid' ? 'bg-warning' : 'bg-destructive'
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${color}`}
      role="img"
      aria-label={`${tier} profit: ${pct.toFixed(1)}%`}
    />
  )
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ---------------------------------------------------------------------------
// Sort types
// ---------------------------------------------------------------------------

type SortKey = 'name' | 'ce_charged' | 'cleaner_pay' | 'profit' | 'profit_pct'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProFormaByClientPage() {
  const inWrapper = useInProFormaWrapper()
  usePageTitle(inWrapper ? 'Pro Forma — By Client' : 'Pro Forma by Client')

  const { openPropertyModal } = usePropertyModal()
  const [sortKey, setSortKey] = useState<SortKey>('ce_charged')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set())

  // ------------------------------------------------------------------
  // Data: properties (same select as revenue-report, active-stage filter)
  // ------------------------------------------------------------------
  const { data: properties, isLoading, isError, refetch } = useQuery({
    queryKey: ['/supabase/pro-forma-by-client-properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select(
          'id, name, contact_id, ce_charged, cleaner_pay, estimated_profit, profit_percentage, pipeline_stages(name)'
        )
        .or('exclude_from_financials.is.null,exclude_from_financials.eq.false')
      if (error) throw error
      return data || []
    },
  })

  // Contacts (shared cache)
  const { data: contacts } = useContacts()

  // Active/Onboarding/Offboarding only
  const activeProperties = useMemo(() => {
    if (!properties) return []
    return properties.filter((p: any) => {
      const stageName = (p.pipeline_stages as any)?.name
      return stageName === 'Active' || stageName === 'Onboarding' || stageName === 'Offboarding'
    })
  }, [properties])

  // ------------------------------------------------------------------
  // Sort active properties (used for client grouping ordering)
  // ------------------------------------------------------------------
  const sorted = useMemo(() => {
    const arr = [...activeProperties]
    arr.sort((a: any, b: any) => {
      let av: any, bv: any
      if (sortKey === 'name') { av = a.name || ''; bv = b.name || '' }
      else if (sortKey === 'ce_charged') { av = a.ce_charged || 0; bv = b.ce_charged || 0 }
      else if (sortKey === 'cleaner_pay') { av = a.cleaner_pay || 0; bv = b.cleaner_pay || 0 }
      else if (sortKey === 'profit') { av = a.estimated_profit || 0; bv = b.estimated_profit || 0 }
      else { av = a.profit_percentage || 0; bv = b.profit_percentage || 0 }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [activeProperties, sortKey, sortDir])

  // ------------------------------------------------------------------
  // Client grouping
  // ------------------------------------------------------------------
  const clientGroups = useMemo(() => {
    const contactMap = new Map((contacts || []).map((c: any) => [c.id, c]))
    const groups: Record<string, {
      name: string
      paymentMethod: string | null
      contactId: string | null
      properties: any[]
    }> = {}

    for (const p of sorted) {
      const contact = p.contact_id ? contactMap.get(p.contact_id) : null
      const key = contact ? `contact_${contact.id}` : 'unassigned'
      if (!groups[key]) {
        groups[key] = {
          name: contact?.full_name || 'Unassigned',
          paymentMethod: contact?.payment_method || null,
          contactId: contact?.id || null,
          properties: [],
        }
      }
      groups[key].properties.push(p)
    }

    return Object.entries(groups)
      .map(([key, g]) => {
        const ce = g.properties.reduce((s: number, p: any) => s + (p.ce_charged || 0), 0)
        const pay = g.properties.reduce((s: number, p: any) => s + (p.cleaner_pay || 0), 0)
        const profit = ce - pay
        const avgPct =
          g.properties.length > 0
            ? g.properties.reduce((s: number, p: any) => s + (p.profit_percentage || 0), 0) /
              g.properties.length
            : 0
        return {
          key,
          ...g,
          ce,
          pay,
          profit,
          avgPct,
          activeCount: g.properties.length,
        }
      })
      .sort((a, b) => {
        let av: any, bv: any
        if (sortKey === 'name') { av = a.name || ''; bv = b.name || ''; return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av) }
        if (sortKey === 'ce_charged') { av = a.ce; bv = b.ce }
        else if (sortKey === 'cleaner_pay') { av = a.pay; bv = b.pay }
        else if (sortKey === 'profit') { av = a.profit; bv = b.profit }
        else { av = a.avgPct; bv = b.avgPct }
        if (av < bv) return sortDir === 'asc' ? -1 : 1
        if (av > bv) return sortDir === 'asc' ? 1 : -1
        return 0
      })
  }, [sorted, contacts])

  // ------------------------------------------------------------------
  // Interactions
  // ------------------------------------------------------------------
  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  function toggleClientExpand(key: string) {
    setExpandedClients((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------
  const thCls =
    'text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap'

  function SortIcon({ col }: { col: SortKey }) {
    return (
      <ArrowUpDown
        className={`w-3 h-3 inline ml-1 ${
          sortKey === col ? 'text-primary' : 'text-muted-foreground/40'
        }`}
      />
    )
  }

  // ------------------------------------------------------------------
  // JSX
  // ------------------------------------------------------------------
  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      {isError && <ErrorState onRetry={() => refetch()} />}

      <div className="overflow-auto flex-1 rounded-2xl border border-border shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
            <tr>
              <th className={thCls} onClick={() => toggleSort('name')}>
                Client <SortIcon col="name" />
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">
                Payment
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">
                Properties
              </th>
              <th className={thCls} onClick={() => toggleSort('ce_charged')}>
                Client Charged <SortIcon col="ce_charged" />
              </th>
              <th className={thCls} onClick={() => toggleSort('cleaner_pay')}>
                Cleaner Pay <SortIcon col="cleaner_pay" />
              </th>
              <th className={thCls} onClick={() => toggleSort('profit')}>
                Gross Margin <SortIcon col="profit" />
              </th>
              <th className={thCls} onClick={() => toggleSort('profit_pct')}>
                Gross Margin % <SortIcon col="profit_pct" />
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">
                Health
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(8)].map((_, j) => (
                    <td key={j} className="py-2 px-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : clientGroups.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    icon={Users}
                    title="No clients"
                    description="No active properties with client data found."
                  />
                </td>
              </tr>
            ) : (
              clientGroups.map((g) => (
                <Fragment key={g.key}>
                  {/* Client rollup row */}
                  <tr
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer bg-muted/10"
                    onClick={() => toggleClientExpand(g.key)}
                  >
                    <td className="py-2 px-3 font-medium text-xs">
                      <div className="flex items-center gap-1">
                        {expandedClients.has(g.key) ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                        {g.name}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-xs">
                      {g.paymentMethod && (
                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-xs">
                          {g.paymentMethod}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 tabular-nums text-xs font-medium">
                      {g.activeCount}
                    </td>
                    <td className="py-2 px-3 tabular-nums text-xs font-medium">{fmt(g.ce)}</td>
                    <td className="py-2 px-3 tabular-nums text-xs font-medium">{fmt(g.pay)}</td>
                    <td className="py-2 px-3 tabular-nums text-xs font-medium">{fmt(g.profit)}</td>
                    <td className="py-2 px-3">
                      <ProfitBadge pct={g.avgPct} />
                    </td>
                    <td className="py-2 px-3">
                      <HealthDot pct={g.avgPct} />
                    </td>
                  </tr>
                  {/* Expanded property rows */}
                  {expandedClients.has(g.key) &&
                    g.properties.map((p: any) => (
                      <tr
                        key={p.id}
                        className="border-b border-border/50 hover:bg-muted/30 transition-colors bg-muted/5"
                      >
                        <td className="py-1.5 px-3 text-xs pl-10">
                          <button
                            onClick={() => openPropertyModal(p.id)}
                            className="hover:underline text-left text-muted-foreground"
                          >
                            {p.name}
                          </button>
                        </td>
                        <td className="py-1.5 px-3" />
                        <td className="py-1.5 px-3" />
                        <td className="py-1.5 px-3 tabular-nums text-xs">{fmt(p.ce_charged)}</td>
                        <td className="py-1.5 px-3 tabular-nums text-xs">{fmt(p.cleaner_pay)}</td>
                        <td className="py-1.5 px-3 tabular-nums text-xs">
                          {fmt(p.estimated_profit)}
                        </td>
                        <td className="py-1.5 px-3">
                          <ProfitBadge pct={p.profit_percentage} />
                        </td>
                        <td className="py-1.5 px-3" />
                      </tr>
                    ))}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageContainer>
  )
}
