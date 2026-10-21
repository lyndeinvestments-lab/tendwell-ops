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
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { usePropertyCleanStats } from '@/hooks/use-property-clean-stats'
import { monthlyFigures, resolveCleansPerMonth, rollupMonthly, type MonthlyFigures } from '@/lib/financials/monthlyPace'

// ---------------------------------------------------------------------------
// Helpers (mirrored from revenue-report.tsx)
// ---------------------------------------------------------------------------

function ProfitBadge({ pct }: { pct: number | null }) {
  const { t } = useLocale('financials')
  if (pct == null) return <span className="text-muted-foreground">-</span>
  const tierKey = profitTier(pct)
  const tier = tierKey === 'high' ? t('byClient.profitTier.high') : tierKey === 'mid' ? t('byClient.profitTier.mid') : t('byClient.profitTier.low')
  const tone = tierKey === 'high' ? 'success' : tierKey === 'mid' ? 'warning' : 'destructive'
  return (
    <StatusBadge tone={tone}>
      {pct.toFixed(1)}%<span className="sr-only">{t('byClient.profitSr', { tier })}</span>
    </StatusBadge>
  )
}

function HealthDot({ pct }: { pct: number }) {
  const { t } = useLocale('financials')
  const tierKey = profitTier(pct)
  const tier = tierKey === 'high' ? t('byClient.profitTier.high') : tierKey === 'mid' ? t('byClient.profitTier.mid') : t('byClient.profitTier.low')
  const color = tierKey === 'high' ? 'bg-success' : tierKey === 'mid' ? 'bg-warning' : 'bg-destructive'
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${color}`}
      role="img"
      aria-label={t('byClient.healthAria', { tier, pct: pct.toFixed(1) })}
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

type SortKey = 'name' | 'revenue' | 'cost' | 'profit' | 'margin'

interface PacedProperty {
  id: number
  name: string | null
  contact_id: string | null
  ce_charged: number | null
  total_estimated_cost: number | null
  cleansPerMonth: number | null
  monthly: MonthlyFigures | null
  marginPct: number | null
}

function sortValue(m: MonthlyFigures | null, marginPct: number | null, key: SortKey): number {
  if (key === 'margin') return marginPct ?? -Infinity
  if (!m) return -Infinity
  return key === 'revenue' ? m.revenue : key === 'cost' ? m.cost : m.profit
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProFormaByClientPage() {
  const { t } = useLocale('financials')
  const inWrapper = useInProFormaWrapper()
  usePageTitle(inWrapper ? t('byClient.page.titleWrapped') : t('byClient.page.title'))

  const { openPropertyModal } = usePropertyModal()
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
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
          'id, name, contact_id, ce_charged, total_estimated_cost, avg_cleans_per_month, pipeline_stages(name)'
        )
        .or('exclude_from_financials.is.null,exclude_from_financials.eq.false')
        .is('deleted_at', null)
      if (error) throw error
      return data || []
    },
  })

  // Contacts (shared cache)
  const { data: contacts } = useContacts()

  // Same cleans/month source as the Pricing tab.
  const { byId: cleanStatsById, isLoading: cleanStatsLoading } = usePropertyCleanStats()

  // Active/Onboarding/Offboarding only, priced at the monthly pace
  const activeProperties = useMemo<PacedProperty[]>(() => {
    if (!properties) return []
    return properties
      .filter((p: any) => {
        const stageName = (p.pipeline_stages as any)?.name
        return stageName === 'Active' || stageName === 'Onboarding' || stageName === 'Offboarding'
      })
      .map((p: any) => {
        const { cleansPerMonth } = resolveCleansPerMonth(cleanStatsById.get(String(p.id)), p.avg_cleans_per_month)
        const ce = Number(p.ce_charged) || 0
        return {
          id: p.id,
          name: p.name,
          contact_id: p.contact_id,
          ce_charged: p.ce_charged,
          total_estimated_cost: p.total_estimated_cost,
          cleansPerMonth,
          monthly: monthlyFigures(p, cleansPerMonth),
          marginPct: ce > 0 ? ((ce - (Number(p.total_estimated_cost) || 0)) / ce) * 100 : null,
        }
      })
  }, [properties, cleanStatsById])

  // ------------------------------------------------------------------
  // Sort active properties (used for client grouping ordering)
  // ------------------------------------------------------------------
  const sorted = useMemo(() => {
    const arr = [...activeProperties]
    arr.sort((a, b) => {
      let av: any, bv: any
      if (sortKey === 'name') { av = a.name || ''; bv = b.name || '' }
      else { av = sortValue(a.monthly, a.marginPct, sortKey); bv = sortValue(b.monthly, b.marginPct, sortKey) }
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
      properties: PacedProperty[]
    }> = {}

    for (const p of sorted) {
      const contact = p.contact_id ? contactMap.get(p.contact_id) : null
      const key = contact ? `contact_${contact.id}` : 'unassigned'
      if (!groups[key]) {
        groups[key] = {
          name: contact?.full_name || t('byClient.unassigned'),
          paymentMethod: contact?.payment_method || null,
          contactId: contact?.id || null,
          properties: [],
        }
      }
      groups[key].properties.push(p)
    }

    return Object.entries(groups)
      .map(([key, g]) => ({
        key,
        ...g,
        rollup: rollupMonthly(g.properties.map(p => p.monthly)),
        activeCount: g.properties.length,
      }))
      .sort((a, b) => {
        let av: any, bv: any
        if (sortKey === 'name') { av = a.name || ''; bv = b.name || ''; return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av) }
        av = sortValue(a.rollup.included > 0 ? a.rollup : null, a.rollup.marginPct, sortKey)
        bv = sortValue(b.rollup.included > 0 ? b.rollup : null, b.rollup.marginPct, sortKey)
        if (av < bv) return sortDir === 'asc' ? -1 : 1
        if (av > bv) return sortDir === 'asc' ? 1 : -1
        return 0
      })
  }, [sorted, contacts, t])

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

      <p className="text-xs text-muted-foreground" data-testid="text-by-client-pace">{t('byClient.paceNote')}</p>

      <div className="overflow-auto flex-1 rounded-2xl border border-border shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
            <tr>
              <th className={thCls} onClick={() => toggleSort('name')}>
                {t('byClient.table.client')} <SortIcon col="name" />
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">
                {t('byClient.table.payment')}
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">
                {t('byClient.table.properties')}
              </th>
              <th className={thCls} onClick={() => toggleSort('revenue')}>
                {t('byClient.table.moRevenue')} <SortIcon col="revenue" />
              </th>
              <th className={thCls} onClick={() => toggleSort('cost')}>
                {t('byClient.table.moCost')} <SortIcon col="cost" />
              </th>
              <th className={thCls} onClick={() => toggleSort('profit')}>
                {t('byClient.table.moProfit')} <SortIcon col="profit" />
              </th>
              <th className={thCls} onClick={() => toggleSort('margin')}>
                {t('byClient.table.marginPct')} <SortIcon col="margin" />
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">
                {t('byClient.table.health')}
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading || cleanStatsLoading ? (
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
                    title={t('byClient.empty.title')}
                    description={t('byClient.empty.description')}
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
                      {g.rollup.withoutCleans > 0 && (
                        <span className="block font-normal text-2xs text-muted-foreground">
                          {t('byClient.table.withoutCleans', { count: g.rollup.withoutCleans })}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 tabular-nums text-xs font-medium">{g.rollup.included > 0 ? fmt(g.rollup.revenue) : '—'}</td>
                    <td className="py-2 px-3 tabular-nums text-xs font-medium">{g.rollup.included > 0 ? fmt(g.rollup.cost) : '—'}</td>
                    <td className={`py-2 px-3 tabular-nums text-xs font-medium ${g.rollup.profit < 0 ? 'text-destructive' : ''}`}>{g.rollup.included > 0 ? fmt(g.rollup.profit) : '—'}</td>
                    <td className="py-2 px-3">
                      <ProfitBadge pct={g.rollup.marginPct} />
                    </td>
                    <td className="py-2 px-3">
                      {g.rollup.marginPct != null && <HealthDot pct={g.rollup.marginPct} />}
                    </td>
                  </tr>
                  {/* Expanded property rows */}
                  {expandedClients.has(g.key) &&
                    g.properties.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-border/50 hover:bg-muted/30 transition-colors bg-muted/5"
                      >
                        <td className="py-1.5 px-3 text-xs pl-10">
                          <button
                            onClick={() => openPropertyModal(String(p.id))}
                            className="hover:underline text-left text-muted-foreground"
                          >
                            {p.name}
                          </button>
                        </td>
                        <td className="py-1.5 px-3" />
                        <td className="py-1.5 px-3 text-2xs text-muted-foreground whitespace-nowrap">
                          {p.monthly
                            ? t('byClient.table.perClean', { rate: fmt(p.ce_charged), cleans: p.cleansPerMonth ?? 0 })
                            : t('byClient.table.noCleans', { rate: fmt(p.ce_charged) })}
                        </td>
                        <td className="py-1.5 px-3 tabular-nums text-xs">{p.monthly ? fmt(p.monthly.revenue) : '—'}</td>
                        <td className="py-1.5 px-3 tabular-nums text-xs">
                          {p.monthly ? fmt(p.monthly.cost) : <span className="text-muted-foreground">{t('byClient.table.perCleanCost', { cost: fmt(p.total_estimated_cost) })}</span>}
                        </td>
                        <td className={`py-1.5 px-3 tabular-nums text-xs ${p.monthly && p.monthly.profit < 0 ? 'text-destructive' : ''}`}>
                          {p.monthly ? fmt(p.monthly.profit) : '—'}
                        </td>
                        <td className="py-1.5 px-3">
                          <ProfitBadge pct={p.marginPct} />
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
