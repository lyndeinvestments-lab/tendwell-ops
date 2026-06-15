// ─────────────────────────────────────────────────────────────────────────
// /test — Master List redesign PREVIEW (admin-only, READ-ONLY).
//
// This page is a sandbox for previewing a bold visual redesign of the
// Master List · Cost Tracking page WITHOUT touching the real page or any
// data. It reuses the exact same live Supabase reads as cost-tracking.tsx
// (the `operational_properties` view / `properties` table + the contacts
// join) so the rows and numbers match production — but every mutation,
// inline edit, context menu, and archive action has been stripped. Nothing
// on this page can write to the database.
//
// Route guard: admin role only (see AdminRoute in App.tsx).
// Safe to delete wholesale once a redesign direction is chosen.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAppSettings } from '@/hooks/use-app-settings'
import { usePageTitle } from '@/hooks/use-page-title'
import { profitTier, profitColorClass, PROFIT_THRESHOLDS } from '@/lib/profit-colors'
import { PageContainer } from '@/components/PageContainer'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Search, ChevronDown, ChevronRight, TrendingUp, DollarSign, Wallet,
  Percent, Building2, ArrowUpDown, FlaskConical,
} from 'lucide-react'

const STAGES = ['Active', 'Onboarding', 'Offboarding', 'Lead', 'Quote', 'Offboarded'] as const

type SortKey =
  | 'name' | 'stage_name' | 'ce_charged' | 'cleaner_pay'
  | 'est_laundry' | 'est_consumables' | 'total_estimated_cost'
  | 'estimated_profit' | 'profit_percentage'

// $1,234.00
function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
// Compact money for the big KPI tiles: $12.3k / $1.2M
function fmtCompact(n: number | null | undefined) {
  if (n == null) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

const STAGE_DOT: Record<string, string> = {
  Active: 'bg-success',
  Onboarding: 'bg-info',
  Offboarding: 'bg-warning',
  Quote: 'bg-primary',
  Lead: 'bg-muted-foreground/50',
  Offboarded: 'bg-muted-foreground/30',
}

// ── Margin meter: number + a thin tier-colored bar (0–30% scale) ───────────
function MarginMeter({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <span className="text-muted-foreground text-xs">—</span>
  const t = profitTier(pct)
  const barColor = t === 'high' ? 'bg-success' : t === 'mid' ? 'bg-warning' : 'bg-destructive'
  const width = Math.max(4, Math.min(100, (pct / 30) * 100))
  return (
    <div className="flex items-center gap-2 min-w-[7rem]">
      <span className={`tabular-nums text-xs font-semibold w-12 text-right ${profitColorClass(pct)}`}>
        {pct.toFixed(1)}%
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

// ── A single hero KPI tile ─────────────────────────────────────────────────
function Kpi({
  icon: Icon, label, value, sub, accent = 'primary', children,
}: {
  icon: typeof DollarSign
  label: string
  value: string
  sub?: string
  accent?: 'primary' | 'success' | 'warning' | 'destructive'
  children?: React.ReactNode
}) {
  const ring = {
    primary: 'from-primary/12 to-primary/[0.02] ring-primary/15',
    success: 'from-success/12 to-success/[0.02] ring-success/15',
    warning: 'from-warning/12 to-warning/[0.02] ring-warning/15',
    destructive: 'from-destructive/12 to-destructive/[0.02] ring-destructive/15',
  }[accent]
  const iconTone = {
    primary: 'text-primary bg-primary/10',
    success: 'text-success bg-success/10',
    warning: 'text-warning bg-warning/10',
    destructive: 'text-destructive bg-destructive/10',
  }[accent]
  return (
    <div className={`relative rounded-2xl border border-border/60 bg-gradient-to-br ${ring} ring-1 p-4 sm:p-5 shadow-sm`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-2xs uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
          <p className="mt-1.5 text-2xl sm:text-3xl font-bold tabular-nums tracking-tight">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <span className={`shrink-0 rounded-xl p-2 ${iconTone}`}><Icon className="w-4 h-4" /></span>
      </div>
      {children}
    </div>
  )
}

export default function TestPage() {
  usePageTitle('Master List — Redesign Preview')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('estimated_profit')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [showAllStages, setShowAllStages] = useState(true)
  const pageSize = 50

  const { getNumber } = useAppSettings()
  const inspectionCost = getNumber('cost_inspection', 15)
  const trashCost = getNumber('cost_trash', 5)
  const breakEvenMargin = getNumber('break_even_target_margin', 0.20)

  // Same read as cost-tracking.tsx — read-only, no mutations anywhere.
  const { data: properties, isLoading } = useQuery({
    queryKey: ['/test/operational_properties', showAllStages ? 'all-stages' : 'operational'],
    queryFn: async () => {
      if (showAllStages) {
        const { data, error } = await supabase
          .from('properties')
          .select('*, pipeline_stages!properties_stage_id_fkey(name, slug, color)')
        if (error) throw error
        return (data || []).map((p: any) => ({
          ...p,
          stage_name: p.pipeline_stages?.name || null,
        }))
      }
      const { data, error } = await supabase.from('operational_properties').select('*')
      if (error) throw error
      return data || []
    },
  })

  const { data: propertyContacts } = useQuery({
    queryKey: ['/test/properties_contact_join'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, contact:contacts(id, full_name, company, payment_method)')
      if (error) throw error
      return data || []
    },
  })

  const contactById = useMemo(() => {
    const m: Record<string, { full_name?: string; company?: string; payment_method?: string } | null> = {}
    for (const r of (propertyContacts as any[]) || []) {
      const c = Array.isArray(r.contact) ? r.contact[0] : r.contact
      m[String(r.id)] = c && c.full_name ? c : null
    }
    return m
  }, [propertyContacts])

  function clientLabel(p: any): string | null {
    const c = contactById[String(p.id)]
    if (c?.full_name) {
      return c.company && c.company !== c.full_name ? `${c.full_name} (${c.company})` : c.full_name
    }
    return p.company || null
  }

  const all: any[] = (properties as any[]) ?? []

  const stageTally = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of all) counts[p.stage_name || 'Unknown'] = (counts[p.stage_name || 'Unknown'] || 0) + 1
    return counts
  }, [all])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    let arr = all.filter((p: any) => {
      const matchSearch = !q || (
        p.name?.toLowerCase().includes(q)
        || p.stage_name?.toLowerCase().includes(q)
        || p.address?.toLowerCase().includes(q)
        || clientLabel(p)?.toLowerCase().includes(q)
      )
      const matchStatus = statusFilter === 'all' || p.stage_name === statusFilter
      return matchSearch && matchStatus
    })
    arr = [...arr].sort((a: any, b: any) => {
      const av = a[sortKey] ?? (typeof a[sortKey] === 'string' ? '' : -Infinity)
      const bv = b[sortKey] ?? (typeof b[sortKey] === 'string' ? '' : -Infinity)
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, search, statusFilter, sortKey, sortDir, contactById])

  const totals = useMemo(() => {
    if (!filtered.length) return null
    const ceTotal = filtered.reduce((s, p) => s + (p.ce_charged || 0), 0)
    const costTotal = filtered.reduce((s, p) => s + (p.total_estimated_cost || 0), 0)
    const profitTotal = filtered.reduce((s, p) => s + (p.estimated_profit || 0), 0)
    const avgProfitPct = ceTotal > 0
      ? filtered.reduce((s, p) => s + (p.profit_percentage || 0) * ((p.ce_charged || 0) / ceTotal), 0)
      : 0
    const tiers = { high: 0, mid: 0, low: 0 }
    for (const p of filtered) {
      const t = profitTier(p.profit_percentage)
      if (t) tiers[t]++
    }
    return { ceTotal, costTotal, profitTotal, avgProfitPct, tiers }
  }, [filtered])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page])
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(k === 'name' || k === 'stage_name' ? 'asc' : 'desc') }
  }

  const tierTotal = totals ? totals.tiers.high + totals.tiers.mid + totals.tiers.low : 0
  const tieredPct = (n: number) => (tierTotal > 0 ? (n / tierTotal) * 100 : 0)

  // Column header cell
  const Th = ({ k, children, right }: { k?: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th
      onClick={k ? () => toggleSort(k) : undefined}
      className={`text-2xs font-semibold uppercase tracking-wider text-muted-foreground py-3 px-4 whitespace-nowrap select-none ${right ? 'text-right' : 'text-left'} ${k ? 'cursor-pointer hover:text-foreground' : ''}`}
    >
      <span className={`inline-flex items-center gap-1 ${right ? 'flex-row-reverse' : ''}`}>
        {children}
        {k && <ArrowUpDown className={`w-3 h-3 ${sortKey === k ? 'text-primary' : 'text-muted-foreground/40'}`} />}
      </span>
    </th>
  )

  return (
    <PageContainer width="full" className="h-full flex flex-col gap-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Master List</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-2xs font-semibold px-2.5 py-1 ring-1 ring-primary/20">
              <FlaskConical className="w-3 h-3" /> Redesign Preview
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            A bold reimagining of the cost-tracking view — live data, fully read-only. Nothing here writes to the database.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!showAllStages}
            onChange={e => { setShowAllStages(!e.target.checked); setPage(1) }}
            className="rounded border-input"
          />
          Operational stages only
        </label>
      </div>

      {/* ── Hero KPI band ──────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : totals ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi icon={DollarSign} label="Client Charged" value={fmtCompact(totals.ceTotal)} sub={`${filtered.length} properties`} accent="primary" />
          <Kpi icon={Wallet} label="Total Cost" value={fmtCompact(totals.costTotal)} sub="Estimated per turn" accent="warning" />
          <Kpi
            icon={TrendingUp}
            label="Net Profit"
            value={fmtCompact(totals.profitTotal)}
            sub="Across filtered set"
            accent={totals.profitTotal >= 0 ? 'success' : 'destructive'}
          />
          <Kpi
            icon={Percent}
            label="Avg Margin"
            value={`${totals.avgProfitPct.toFixed(1)}%`}
            accent={profitTier(totals.avgProfitPct) === 'high' ? 'success' : profitTier(totals.avgProfitPct) === 'mid' ? 'warning' : 'destructive'}
          >
            {/* Tier distribution bar */}
            <div className="mt-3">
              <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                <div className="bg-success" style={{ width: `${tieredPct(totals.tiers.high)}%` }} />
                <div className="bg-warning" style={{ width: `${tieredPct(totals.tiers.mid)}%` }} />
                <div className="bg-destructive" style={{ width: `${tieredPct(totals.tiers.low)}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-2xs text-muted-foreground tabular-nums">
                <span className="text-success">●{totals.tiers.high} ≥{PROFIT_THRESHOLDS.high}%</span>
                <span className="text-warning">●{totals.tiers.mid}</span>
                <span className="text-destructive">●{totals.tiers.low} &lt;{PROFIT_THRESHOLDS.mid}%</span>
              </div>
            </div>
          </Kpi>
        </div>
      ) : null}

      {/* ── Controls: segmented stage pills + search ───────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-xl bg-muted/60 p-1 overflow-x-auto">
          <button
            onClick={() => { setStatusFilter('all'); setPage(1) }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${statusFilter === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            All <span className="tabular-nums text-muted-foreground">{all.length}</span>
          </button>
          {STAGES.map(stage => {
            const n = stageTally[stage] || 0
            if (n === 0) return null
            const active = statusFilter === stage
            return (
              <button
                key={stage}
                onClick={() => { setStatusFilter(active ? 'all' : stage); setPage(1) }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${active ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${STAGE_DOT[stage] || 'bg-muted-foreground/50'}`} />
                {stage} <span className="tabular-nums text-muted-foreground">{n}</span>
              </button>
            )
          })}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search property, client, address…"
            className="pl-9 h-9 rounded-xl"
          />
        </div>
      </div>

      {/* ── Data grid ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-border">
              <tr>
                <th className="sticky left-0 z-30 bg-card/95 backdrop-blur w-8" />
                <Th k="name">Property</Th>
                <Th k="stage_name">Status</Th>
                <Th>Client</Th>
                <Th k="ce_charged" right>Charged</Th>
                <Th k="cleaner_pay" right>Cleaner</Th>
                <Th k="est_laundry" right>Laundry</Th>
                <Th k="est_consumables" right>Consum.</Th>
                <Th k="total_estimated_cost" right>Total Cost</Th>
                <Th k="estimated_profit" right>Profit</Th>
                <Th k="profit_percentage">Margin</Th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td colSpan={11} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td>
                  </tr>
                ))
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8">
                    <EmptyState icon={Building2} title="No properties found" description="No properties match your current filters." />
                  </td>
                </tr>
              ) : (
                paged.map((p: any) => {
                  const expanded = expandedRow === p.id
                  const beCe = p.total_estimated_cost != null ? p.total_estimated_cost / (1 - breakEvenMargin) : null
                  return (
                    <FragmentRow key={p.id}>
                      <tr
                        onClick={() => setExpandedRow(expanded ? null : p.id)}
                        className={`group border-b border-border/40 cursor-pointer transition-colors ${expanded ? 'bg-primary/[0.04]' : 'hover:bg-muted/40'}`}
                      >
                        <td className="sticky left-0 z-10 bg-inherit pl-3 text-muted-foreground">
                          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 opacity-40 group-hover:opacity-100" />}
                        </td>
                        <td className="py-2.5 px-4 font-medium text-sm whitespace-nowrap max-w-[16rem] truncate" title={p.name}>{p.name}</td>
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
                            <span className={`w-2 h-2 rounded-full ${STAGE_DOT[p.stage_name] || 'bg-muted-foreground/40'}`} />
                            {p.stage_name || '—'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-xs text-muted-foreground max-w-[12rem] truncate" title={clientLabel(p) || ''}>{clientLabel(p) || '—'}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-sm whitespace-nowrap">{fmt(p.ce_charged)}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">{fmt(p.cleaner_pay)}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">{fmt(p.est_laundry)}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">{fmt(p.est_consumables)}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-sm font-medium whitespace-nowrap">{fmt(p.total_estimated_cost)}</td>
                        <td className={`py-2.5 px-4 text-right tabular-nums text-sm font-semibold whitespace-nowrap ${(p.estimated_profit || 0) < 0 ? 'text-destructive' : ''}`}>{fmt(p.estimated_profit)}</td>
                        <td className="py-2.5 px-4"><MarginMeter pct={p.profit_percentage} /></td>
                      </tr>
                      {expanded && (
                        <tr className="bg-muted/20 border-b border-border/40">
                          <td />
                          <td colSpan={10} className="px-4 py-4">
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-3 text-xs">
                              <Detail label="Address" value={p.address} />
                              <Detail label="Beds / Baths" value={p.bedrooms != null || p.full_baths != null ? `${p.bedrooms ?? '—'} bd / ${p.full_baths ?? '—'} ba${p.half_baths ? ` +${p.half_baths}½` : ''}` : null} />
                              <Detail label="Sq Ft" value={p.square_footage ? Number(p.square_footage).toLocaleString() : null} />
                              <Detail label="Kitchens" value={p.kitchens} />
                              <Detail label="Guests" value={p.guest_count} />
                              <Detail label="Hot Tub" value={p.hot_tub ? 'Yes' : 'No'} />
                              <Detail label="Inspection" value={fmt(inspectionCost)} />
                              <Detail label="Trash" value={fmt(trashCost)} />
                              <Detail label={`B/E CE @ ${Math.round(breakEvenMargin * 100)}%`} value={beCe != null ? fmt(beCe) : null} />
                              <Detail label="Deep-Clean Cost" value={p.estimated_deep_clean_cost != null ? fmt(Number(p.estimated_deep_clean_cost)) : null} />
                              <Detail label="Deep-Clean Income" value={p.deep_clean_3x_ce != null ? fmt(Number(p.deep_clean_3x_ce)) : null} />
                              <Detail label="Deep-Clean Profit" value={p.profit_deep_clean != null ? fmt(Number(p.profit_deep_clean)) : null} tone={(p.profit_deep_clean || 0) < 0 ? 'destructive' : undefined} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Footer / pagination ─────────────────────────────────────── */}
        {!isLoading && filtered.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="rounded-lg px-3 py-1 hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
              >Prev</button>
              <span className="tabular-nums px-1">Page {page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="rounded-lg px-3 py-1 hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
              >Next</button>
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  )
}

// A keyed wrapper so each row + its expansion render as siblings without a
// real DOM node (tbody only allows <tr> children).
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

// Expanded-row detail cell (read-only)
function Detail({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'destructive' }) {
  return (
    <div>
      <span className="block text-2xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`font-medium ${tone === 'destructive' ? 'text-destructive' : 'text-foreground'}`}>
        {value == null || value === '' ? '—' : value}
      </span>
    </div>
  )
}
