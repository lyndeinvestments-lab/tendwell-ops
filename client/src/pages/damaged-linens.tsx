import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import { Camera, DollarSign, Download, Plus, Recycle, Search, ShieldAlert, Trash2 } from 'lucide-react'
import { supabase, logActivity } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { useCleaners } from '@/hooks/use-cleaners'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { DamagedLinenSheet, DAMAGED_LINENS_QUERY_KEY } from '@/components/damaged-linens/DamagedLinenSheet'
import {
  DAMAGE_TYPES, DAMAGE_TYPE_LABELS, DAMAGED_STATUSES, DAMAGED_STATUS_LABELS, DAMAGED_STATUS_TONES,
  isOpenStatus, itemFallbackLabel, summarizeDamaged,
  type DamagedLinen, type DamagedStatus,
} from '@/lib/damaged-linens'

type RangeFilter = '30' | '90' | 'ytd' | 'all'
type StatusFilter = 'open' | 'all' | DamagedStatus

const PAGE_SIZE = 1000

function rangeStart(range: RangeFilter): string | null {
  const d = new Date()
  if (range === 'all') return null
  if (range === 'ytd') return `${d.getFullYear()}-01-01`
  d.setDate(d.getDate() - Number(range))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 === 0 ? 0 : 2 })
}

export default function DamagedLinensPage() {
  const { t } = useLocale('linens')
  const { format } = useDateFormat()
  usePageTitle(t('damaged.page.title', undefined, 'Damaged Linens'))
  const { toast } = useToast()
  const qc = useQueryClient()
  const { effectiveUser } = useAuth()
  const canEdit = canEditView('damaged-linens', effectiveUser)
  const userLabel = effectiveUser?.label ?? ''

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [damageFilter, setDamageFilter] = useState<string>('all')
  const [range, setRange] = useState<RangeFilter>('90')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [selected, setSelected] = useState<DamagedLinen | null>(null)

  const itemLabel = (key: string) => t(`damaged.items.${key}`, undefined, itemFallbackLabel(key))
  const damageLabel = (key: string) => t(`damaged.damageTypes.${key}`, undefined, DAMAGE_TYPE_LABELS[key as keyof typeof DAMAGE_TYPE_LABELS] ?? key)
  const statusLabel = (key: string) => t(`damaged.statuses.${key}`, undefined, DAMAGED_STATUS_LABELS[key as DamagedStatus] ?? key)

  // Paged read — PostgREST caps a select at 1000 rows and reports truncation
  // only in a header, so an unpaged read would silently drop older reports.
  const { data: rows, isLoading, isError, refetch } = useQuery<DamagedLinen[]>({
    queryKey: DAMAGED_LINENS_QUERY_KEY,
    queryFn: async () => {
      const all: DamagedLinen[] = []
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await (supabase as any)
          .from('damaged_linens')
          .select('*, property:properties(id, name)')
          .order('found_date', { ascending: false })
          .order('created_at', { ascending: false })
          .range(from, from + PAGE_SIZE - 1)
        if (error) throw error
        all.push(...((data ?? []) as DamagedLinen[]))
        if (!data || data.length < PAGE_SIZE) break
      }
      return all
    },
    staleTime: 60_000,
  })

  const { data: properties } = useQuery({
    queryKey: ['/supabase/damaged-linens-properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, pipeline_stages!inner(name)')
        .not('pipeline_stages.name', 'in', '("Lead","Quote")')
        .order('name')
      if (error) throw error
      return (data || []).map(({ id, name }) => ({ id: Number(id), name: name as string }))
    },
    enabled: sheetOpen,
    staleTime: 5 * 60_000,
  })

  const { data: cleaners } = useCleaners({ activeOnly: true, enabled: sheetOpen })

  const start = rangeStart(range)
  const inRange = useMemo(
    () => (rows ?? []).filter(r => !start || r.found_date >= start),
    [rows, start],
  )
  const openSummary = useMemo(() => summarizeDamaged(rows ?? []), [rows])
  const rangeSummary = useMemo(() => summarizeDamaged(inRange), [inRange])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    // "Open" ignores the date range — an old untreated report is still open.
    const base = statusFilter === 'open' ? (rows ?? []).filter(r => isOpenStatus(r.status)) : inRange
    return base.filter(r => {
      if (statusFilter !== 'open' && statusFilter !== 'all' && r.status !== statusFilter) return false
      if (damageFilter !== 'all' && r.damage_type !== damageFilter) return false
      if (!q) return true
      return [r.property?.name, itemLabel(r.item_type), r.item_type, r.notes, r.found_by]
        .some(v => v && v.toLowerCase().includes(q))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, inRange, statusFilter, damageFilter, search, t])

  function openRow(r: DamagedLinen | null) {
    setSelected(r)
    setSheetOpen(true)
  }

  async function quickStatus(r: DamagedLinen, status: DamagedStatus) {
    if (status === r.status) return
    const patch: Record<string, unknown> = { status }
    if (status === 'restored' || status === 'discarded') patch.resolved_by = userLabel || null
    const { error } = await (supabase as any).from('damaged_linens').update(patch).eq('id', r.id)
    if (error) {
      toast({ title: t('damaged.toasts.saveFailed'), description: error.message, variant: 'destructive' })
      return
    }
    void logActivity({
      entity_type: 'linen', entity_id: r.id,
      entity_name: `${r.property?.name ?? t('damaged.page.noProperty')} · ${itemFallbackLabel(r.item_type)}`,
      action: 'update', field_name: 'damaged_linen_status', old_value: r.status, new_value: status,
      changed_by: userLabel || null,
    })
    toast({ title: t('damaged.toasts.statusChanged', { status: statusLabel(status) }) })
    qc.invalidateQueries({ queryKey: DAMAGED_LINENS_QUERY_KEY })
  }

  function exportCsv() {
    const csv = Papa.unparse(filtered.map(r => ({
      'Date Found': r.found_date,
      Property: r.property?.name ?? '',
      Item: itemFallbackLabel(r.item_type),
      Quantity: r.quantity,
      Damage: DAMAGE_TYPE_LABELS[r.damage_type] ?? r.damage_type,
      Status: DAMAGED_STATUS_LABELS[r.status] ?? r.status,
      'Found By': r.found_by ?? '',
      'Est. Cost': r.estimated_cost ?? '',
      'Charge-back': r.charge_back ? 'Yes' : '',
      Notes: r.notes ?? '',
      Photos: r.photo_urls.join(' '),
      Resolved: r.resolved_at ? r.resolved_at.slice(0, 10) : '',
      'Resolved By': r.resolved_by ?? '',
    })))
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `damaged-linens-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: t('damaged.page.exported', { count: filtered.length }) })
  }

  const hasAny = (rows?.length ?? 0) > 0

  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      <PageHeader
        title={t('damaged.page.title')}
        subtitle={t('damaged.page.subtitle')}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={exportCsv} disabled={!filtered.length}>
              <Download className="w-3.5 h-3.5" /> {t('damaged.page.exportCsv')}
            </Button>
            {canEdit && (
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openRow(null)} data-testid="button-report-damage">
                <Plus className="w-3.5 h-3.5" /> {t('damaged.page.report')}
              </Button>
            )}
          </>
        }
        beneath={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('damaged.page.searchPlaceholder')}
                className="pl-8 h-8 text-sm"
              />
            </div>
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">{t('damaged.filters.open')}</SelectItem>
                <SelectItem value="all">{t('damaged.filters.allStatuses')}</SelectItem>
                {DAMAGED_STATUSES.map(s => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={damageFilter} onValueChange={setDamageFilter}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('damaged.filters.allDamage')}</SelectItem>
                {DAMAGE_TYPES.map(d => <SelectItem key={d} value={d}>{damageLabel(d)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={range} onValueChange={v => setRange(v as RangeFilter)}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">{t('damaged.filters.last30')}</SelectItem>
                <SelectItem value="90">{t('damaged.filters.last90')}</SelectItem>
                <SelectItem value="ytd">{t('damaged.filters.thisYear')}</SelectItem>
                <SelectItem value="all">{t('damaged.filters.allTime')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      {isError ? (
        <ErrorState onRetry={() => refetch()} description={t('damaged.page.errorLoad')} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              title={t('damaged.kpi.open')}
              value={openSummary.openUnits}
              subtitle={
                openSummary.chargeBackOpen > 0
                  ? `${t('damaged.kpi.openSub', { count: openSummary.openReports })} · ${t('damaged.kpi.chargeBack', { count: openSummary.chargeBackOpen })}`
                  : t('damaged.kpi.openSub', { count: openSummary.openReports })
              }
              icon={ShieldAlert}
              tone={openSummary.openUnits > 0 ? 'warning' : 'success'}
              loading={isLoading}
              onClick={() => setStatusFilter('open')}
            />
            <StatCard
              title={t('damaged.kpi.discarded')}
              value={rangeSummary.discardedUnits}
              subtitle={t('damaged.kpi.discardedSub')}
              icon={Trash2}
              tone="destructive"
              loading={isLoading}
              onClick={() => setStatusFilter('discarded')}
            />
            <StatCard
              title={t('damaged.kpi.loss')}
              value={money(rangeSummary.estimatedLoss)}
              subtitle={t('damaged.kpi.lossSub')}
              icon={DollarSign}
              tone="neutral"
              loading={isLoading}
            />
            <StatCard
              title={t('damaged.kpi.restoreRate')}
              value={rangeSummary.restoreRate == null ? '—' : `${Math.round(rangeSummary.restoreRate * 100)}%`}
              subtitle={t('damaged.kpi.restoreRateSub', {
                restored: rangeSummary.restoredUnits,
                resolved: rangeSummary.restoredUnits + rangeSummary.discardedUnits,
              })}
              icon={Recycle}
              tone="success"
              loading={isLoading}
              onClick={() => setStatusFilter('restored')}
            />
          </div>

          {hasAny && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <HotspotCard
                title={t('damaged.hotspots.properties')}
                empty={t('damaged.hotspots.none')}
                rows={rangeSummary.topProperties.map(p => ({
                  key: String(p.propertyId ?? 'none'),
                  label: p.name || t('damaged.page.noProperty'),
                  value: p.units,
                  detail: `${t('damaged.hotspots.units', { count: p.units })} · ${t('damaged.hotspots.reports', { count: p.reports })}`,
                  onClick: p.name ? () => { setSearch(p.name); setStatusFilter('all') } : undefined,
                }))}
              />
              <HotspotCard
                title={t('damaged.hotspots.items')}
                empty={t('damaged.hotspots.none')}
                rows={rangeSummary.topItems.map(i => ({
                  key: i.itemType,
                  label: itemLabel(i.itemType),
                  value: i.units,
                  detail: t('damaged.hotspots.units', { count: i.units }),
                }))}
              />
            </div>
          )}

          <div className="md:flex-1 md:overflow-auto">
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !hasAny ? (
              <EmptyState
                icon={ShieldAlert}
                title={t('damaged.page.emptyTitle')}
                description={t('damaged.page.emptyDescription')}
                action={canEdit ? { label: t('damaged.page.report'), onClick: () => openRow(null) } : undefined}
              />
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl border border-border shadow-sm py-10 text-center text-sm text-muted-foreground">
                {t('damaged.page.noMatches')}
              </div>
            ) : (
              <>
                {/* Mobile cards */}
                <div className="md:hidden space-y-2">
                  {filtered.map(r => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => openRow(r)}
                      className="w-full text-left rounded-2xl border border-border bg-card shadow-sm p-3 space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{r.quantity} × {itemLabel(r.item_type)}</div>
                          <div className="text-xs text-muted-foreground truncate">{r.property?.name ?? t('damaged.page.noProperty')}</div>
                        </div>
                        <StatusBadge tone={DAMAGED_STATUS_TONES[r.status]}>{statusLabel(r.status)}</StatusBadge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                        <span>{format(new Date(`${r.found_date}T00:00:00`), 'MMM d, yyyy')}</span>
                        <span>{damageLabel(r.damage_type)}</span>
                        {r.found_by && <span>{r.found_by}</span>}
                        {r.estimated_cost != null && <span>{money(Number(r.estimated_cost))}</span>}
                        {r.charge_back && <StatusBadge tone="info">{t('damaged.table.chargeBack')}</StatusBadge>}
                        {r.photo_urls.length > 0 && (
                          <span className="inline-flex items-center gap-1"><Camera className="w-3 h-3" />{r.photo_urls.length}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden md:block rounded-2xl border border-border shadow-sm overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
                      <tr>
                        {[
                          t('damaged.table.found'), t('damaged.table.property'), t('damaged.table.item'),
                          t('damaged.table.qty'), t('damaged.table.damage'), t('damaged.table.status'),
                          t('damaged.table.foundBy'), t('damaged.table.cost'), '',
                        ].map((h, i) => (
                          <th key={i} className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(r => (
                        <tr
                          key={r.id}
                          className="border-b border-border/50 hover:bg-muted/20 cursor-pointer"
                          onClick={() => openRow(r)}
                        >
                          <td className="py-1.5 px-3 tabular-nums whitespace-nowrap">{format(new Date(`${r.found_date}T00:00:00`), 'MMM d, yyyy')}</td>
                          <td className="py-1.5 px-3 max-w-[220px] truncate">{r.property?.name ?? <span className="text-muted-foreground">{t('damaged.page.noProperty')}</span>}</td>
                          <td className="py-1.5 px-3 whitespace-nowrap">{itemLabel(r.item_type)}</td>
                          <td className="py-1.5 px-3 tabular-nums">{r.quantity}</td>
                          <td className="py-1.5 px-3 whitespace-nowrap">{damageLabel(r.damage_type)}</td>
                          <td className="py-1.5 px-3" onClick={e => e.stopPropagation()}>
                            {canEdit ? (
                              <Select value={r.status} onValueChange={v => quickStatus(r, v as DamagedStatus)}>
                                <SelectTrigger className="h-7 w-32 text-2xs border-0 bg-transparent px-0 shadow-none focus:ring-0">
                                  <StatusBadge tone={DAMAGED_STATUS_TONES[r.status]}>{statusLabel(r.status)}</StatusBadge>
                                </SelectTrigger>
                                <SelectContent>
                                  {DAMAGED_STATUSES.map(s => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            ) : (
                              <StatusBadge tone={DAMAGED_STATUS_TONES[r.status]}>{statusLabel(r.status)}</StatusBadge>
                            )}
                          </td>
                          <td className="py-1.5 px-3 text-muted-foreground whitespace-nowrap">{r.found_by ?? '—'}</td>
                          <td className="py-1.5 px-3 tabular-nums">{r.estimated_cost != null ? money(Number(r.estimated_cost)) : '—'}</td>
                          <td className="py-1.5 px-3">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              {r.charge_back && <StatusBadge tone="info">{t('damaged.table.chargeBack')}</StatusBadge>}
                              {r.photo_urls.length > 0 && (
                                <span className="inline-flex items-center gap-1" title={t('damaged.table.photos', { count: r.photo_urls.length })}>
                                  <Camera className="w-3.5 h-3.5" />{r.photo_urls.length}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}

      <DamagedLinenSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        row={selected}
        properties={properties ?? []}
        cleaners={cleaners ?? []}
        canEdit={canEdit}
        userLabel={userLabel}
      />
    </PageContainer>
  )
}

function HotspotCard({
  title, empty, rows,
}: {
  title: string
  empty: string
  rows: Array<{ key: string; label: string; value: number; detail: string; onClick?: () => void }>
}) {
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(r => (
            <li key={r.key}>
              <button
                type="button"
                onClick={r.onClick}
                disabled={!r.onClick}
                className="w-full text-left disabled:cursor-default group"
              >
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate font-medium group-enabled:group-hover:underline">{r.label}</span>
                  <span className="text-muted-foreground whitespace-nowrap tabular-nums">{r.detail}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-warning" style={{ width: `${(r.value / max) * 100}%` }} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
