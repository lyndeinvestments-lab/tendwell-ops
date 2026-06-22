import { useState, useMemo, useEffect } from 'react'
import { TablePagination } from '@/components/TablePagination'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePageTitle } from '@/hooks/use-page-title'
import { useAuth } from '@/lib/auth'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { usePipelineStages } from '@/hooks/use-pipeline-stages'
import { Search, X, Download, Building2, DoorOpen, CheckCircle2, LogOut, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import Papa from 'papaparse'

function StageBadgePopover({ propertyId, propertyName, currentStageName, stageColor, stages }: {
  propertyId: string; propertyName: string; currentStageName: string; stageColor: string; stages: any[]
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const { effectiveUser } = useAuth()

  const { mutate: changeStage } = useGuardedMutation('property-list', {
    mutationFn: async (stageId: string) => {
      const fromStage = stages.find((s: any) => s.name === currentStageName)
      const toStage = stages.find((s: any) => s.id === stageId)
      const { executeStageTransition } = await import('@/lib/stage-transition')
      const result = await executeStageTransition({
        propertyId: Number(propertyId),
        propertyName: propertyName,
        fromStageId: Number(fromStage?.id),
        fromStageName: fromStage?.name || '',
        toStageId: Number(stageId),
        toStageName: toStage?.name || '',
        changedBy: effectiveUser?.label || 'unknown',
      })
      if (!result.ok) throw new Error(result.error)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/properties-list'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
      toast({ title: 'Stage updated' })
      setOpen(false)
    },
    onError: (error: any) => toast({ title: 'Update failed', description: error?.message, variant: 'destructive' }),
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          onClick={e => { e.stopPropagation(); setOpen(true) }}
          className="text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all duration-300"
          style={{ backgroundColor: stageColor + '20', color: stageColor, border: `1px solid ${stageColor}40` }}
          title="Click to change stage"
        >
          {currentStageName}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start" onClick={e => e.stopPropagation()}>
        {stages.map((s: any) => (
          <button
            key={s.id}
            onClick={() => changeStage(s.id)}
            className={`w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors ${s.name === currentStageName ? 'font-semibold bg-muted/50' : ''}`}
          >
            {s.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export default function PropertyListPage() {
  usePageTitle('Property List')
  const { openPropertyModal } = usePropertyModal()
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<string | null>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortKey !== col) return <ArrowUpDown className="inline w-3 h-3 ml-1 opacity-40" />
    return sortDir === 'asc'
      ? <ArrowUp className="inline w-3 h-3 ml-1" />
      : <ArrowDown className="inline w-3 h-3 ml-1" />
  }

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const [statusFilter, setStatusFilter] = useState<string>(() => {
    try { return localStorage.getItem('property-list-filter') || 'all' } catch { return 'all' }
  })

  useEffect(() => {
    try { localStorage.setItem('property-list-filter', statusFilter) } catch { /* ignore */ }
  }, [statusFilter])

  const { data: properties, isLoading, isError, refetch } = useQuery({
    queryKey: ['/supabase/properties-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, address, bedrooms, full_baths, guest_count, square_footage, cleaner_pay, stage_name, stage_color')
      if (error) throw error
      return data || []
    },
  })

  const { data: stages } = usePipelineStages()

  const total = properties?.length ?? 0
  const countByStage = (name: string) => properties?.filter((p: any) => p.stage_name === name).length ?? 0

  // Only show stages that actually appear in the operational data, in pipeline order.
  const stagesInData = useMemo(() => {
    if (!properties || !stages) return [] as any[]
    const present = new Set(properties.map((p: any) => p.stage_name).filter(Boolean))
    return stages.filter((s: any) => present.has(s.name))
  }, [properties, stages])

  const filtered = useMemo(() => {
    if (!properties) return []
    const base = properties.filter((p: any) => {
      const matchSearch = p.name?.toLowerCase().includes(search.toLowerCase()) ||
        p.address?.toLowerCase().includes(search.toLowerCase())
      const matchStatus = !statusFilter || statusFilter === 'all' || p.stage_name === statusFilter
      return matchSearch && matchStatus
    })

    if (!sortKey) return base

    return [...base].sort((a: any, b: any) => {
      const dir = sortDir === 'asc' ? 1 : -1

      // Status sorts by the stage_name string
      const av = sortKey === 'stage_name' ? (a.stage_name ?? null) : a[sortKey]
      const bv = sortKey === 'stage_name' ? (b.stage_name ?? null) : b[sortKey]

      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1

      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * dir
      }
      return (av - bv) * dir
    })
  }, [properties, search, statusFilter, sortKey, sortDir])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  function exportCsv() {
    const rows = filtered.map((p: any) => ({
      'Property': p.name || '',
      'Address': p.address || '',
      'Bedrooms': p.bedrooms ?? '',
      'Full Baths': p.full_baths ?? '',
      'Max Guests': p.guest_count ?? '',
      'Sq Ft': p.square_footage ?? '',
      'Cleaner Pay': p.cleaner_pay ?? '',
      'Status': p.stage_name || '',
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'property-list.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      <PageHeader
        title="Property List"
        subtitle="Operational properties — onboarding, active & offboarding"
        actions={
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search properties…"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
                data-testid="input-search-properties"
                className="pl-8 pr-7 h-8 w-56 text-sm"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1) }}>
              <SelectTrigger data-testid="select-status-filter" className="h-8 w-44 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Operational ({total})</SelectItem>
                {stagesInData.map((s: any) => (
                  <SelectItem key={s.id} value={s.name}>{s.name} ({countByStage(s.name)})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={filtered.length === 0}
              className="h-8 text-xs gap-1.5"
              data-testid="button-export-csv"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </Button>
          </>
        }
      />

      {isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <>
          {/* Summary strip — at-a-glance operational stats */}
          {isLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="rounded-2xl border border-card-border bg-card shadow-sm p-4">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-8 w-12 mt-2" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm p-4">
                <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><Building2 className="w-3.5 h-3.5" /> Total Properties</div>
                <p className="mt-1 text-3xl font-bold tabular-nums leading-none">{total}</p>
              </div>
              <div className="rounded-2xl border border-card-border bg-card shadow-sm p-4">
                <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><DoorOpen className="w-3.5 h-3.5" /> Onboarding</div>
                <p className="mt-1 text-3xl font-bold tabular-nums leading-none text-info">{countByStage('Onboarding')}</p>
              </div>
              <div className="rounded-2xl border border-card-border bg-card shadow-sm p-4">
                <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><CheckCircle2 className="w-3.5 h-3.5" /> Active</div>
                <p className="mt-1 text-3xl font-bold tabular-nums leading-none text-success">{countByStage('Active')}</p>
              </div>
              <div className={`rounded-2xl border shadow-sm p-4 ${countByStage('Offboarding') > 0 ? 'border-warning/30 bg-warning/5' : 'border-card-border bg-card'}`}>
                <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><LogOut className="w-3.5 h-3.5" /> Offboarding</div>
                <p className={`mt-1 text-3xl font-bold tabular-nums leading-none ${countByStage('Offboarding') > 0 ? 'text-warning' : ''}`}>{countByStage('Offboarding')}</p>
              </div>
            </div>
          )}

          <div className="overflow-auto flex-1 rounded-2xl border border-border shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
                <tr>
                  <th
                    className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap sticky left-0 top-0 z-30 bg-muted"
                    tabIndex={0}
                    role="columnheader"
                    aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    onClick={() => toggleSort('name')}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleSort('name')}
                  >
                    Property<SortIcon col="name" />
                  </th>
                  {([
                    { col: 'address', label: 'Address' },
                    { col: 'bedrooms', label: 'Beds' },
                    { col: 'full_baths', label: 'Baths' },
                    { col: 'guest_count', label: 'Guests' },
                    { col: 'square_footage', label: 'Sq Ft' },
                    { col: 'cleaner_pay', label: 'Cleaner Pay' },
                    { col: 'stage_name', label: 'Status' },
                  ] as { col: string; label: string }[]).map(({ col, label }) => (
                    <th
                      key={col}
                      className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap"
                      tabIndex={0}
                      role="columnheader"
                      aria-sort={sortKey === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      onClick={() => toggleSort(col)}
                      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleSort(col)}
                    >
                      {label}<SortIcon col={col} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(8)].map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {[...Array(8)].map((_, j) => (
                        <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState icon={Building2} title="No properties found" description="Try adjusting your search or filter criteria." />
                    </td>
                  </tr>
                ) : (
                  paged.map((p: any) => {
                    const color = p.stage_color || '#6b7280'
                    return (
                      <tr
                        key={p.id}
                        data-testid={`row-property-${p.id}`}
                        className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                      >
                        <td className="py-2 px-3 font-medium text-xs sticky left-0 z-10 bg-background">
                          <button onClick={() => openPropertyModal(p.id, 'property-list')} className="text-primary hover:underline text-left">{p.name}</button>
                        </td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">{p.address || '—'}</td>
                        <td className="py-2 px-3 text-xs tabular-nums">{p.bedrooms ?? '—'}</td>
                        <td className="py-2 px-3 text-xs tabular-nums">{p.full_baths ?? '—'}</td>
                        <td className="py-2 px-3 text-xs tabular-nums">{p.guest_count ?? '—'}</td>
                        <td className="py-2 px-3 text-xs tabular-nums">{p.square_footage ? p.square_footage.toLocaleString() : '—'}</td>
                        <td className="py-2 px-3 text-xs tabular-nums">{p.cleaner_pay ? `$${Number(p.cleaner_pay).toFixed(2)}` : '—'}</td>
                        <td className="py-2 px-3">
                          {p.stage_name && stages?.length ? (
                            <StageBadgePopover
                              propertyId={p.id}
                              propertyName={p.name || ''}
                              currentStageName={p.stage_name}
                              stageColor={color}
                              stages={stages}
                            />
                          ) : p.stage_name ? (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{ backgroundColor: color + '20', color, border: `1px solid ${color}40` }}>
                              {p.stage_name}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />}
        </>
      )}
    </PageContainer>
  )
}
