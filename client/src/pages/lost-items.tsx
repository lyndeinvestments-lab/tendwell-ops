import { useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth, canAccessView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Search, Loader2, AlertTriangle, RefreshCw, Plus, KanbanSquare, List as ListIcon } from 'lucide-react'
import { ErrorState } from '@/components/ErrorState'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import {
  STATUS_COLORS, LOST_ITEM_PIPELINE,
  authFetch, statusLabel,
  type LostItemAssignment, type LostItemCase, type LostItemStatus,
} from '@/components/lost-items/shared'
import { LostItemsBoardView } from '@/components/lost-items/board-view'
import { NewLostItemCaseDialog } from '@/components/lost-items/new-case-dialog'

type ViewMode = 'board' | 'list'
type StatusFilter = LostItemStatus | 'all' | 'open'

export default function LostItemsPage() {
  usePageTitle('Lost Items')
  const { t } = useLocale('lostItems')
  const { effectiveUser } = useAuth()
  const canAccess = canAccessView('lost-items', effectiveUser)
  const canEdit = !!effectiveUser && (effectiveUser.role === 'admin' || effectiveUser.role === 'operations')

  const [view, setView] = useState<ViewMode>('board')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [newCaseOpen, setNewCaseOpen] = useState(false)
  const [, navigate] = useLocation()

  const { toast } = useToast()
  const qc = useQueryClient()

  const openCase = (id: string) => navigate(`/lost-items/${id}`)

  const { data: cases, isLoading, isError, error, refetch, isRefetching } = useQuery<LostItemCase[]>({
    queryKey: ['/api/lost-items/list', statusFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (statusFilter !== 'all' && statusFilter !== 'open') params.set('status', statusFilter)
      if (search.trim()) params.set('search', search.trim())
      const all = (await authFetch(`/api/lost-items/list${params.toString() ? `?${params}` : ''}`)) as LostItemCase[]
      if (statusFilter === 'open') {
        return (all ?? []).filter(c => c.status === 'pending_pickup' || c.status === 'picked_up' || c.status === 'delivered')
      }
      return all ?? []
    },
    enabled: canAccess,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  })

  const caseIds = useMemo(() => (cases ?? []).map(c => c.id), [cases])

  const { data: assignmentsData } = useQuery<{ assignments: LostItemAssignment[] }>({
    queryKey: ['/api/lost-items/assignments', caseIds.join(',')],
    queryFn: async () => {
      const params = caseIds.length > 0 ? `?case_ids=${caseIds.join(',')}` : ''
      return authFetch(`/api/lost-items/assignments${params}`)
    },
    enabled: canAccess && caseIds.length > 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  })

  const assignmentsByCase = useMemo(() => {
    const m = new Map<string, LostItemAssignment>()
    for (const a of assignmentsData?.assignments ?? []) m.set(a.haven_case_id, a)
    return m
  }, [assignmentsData])

  const setStatus = useMutation({
    mutationFn: async ({ caseId, status }: { caseId: string; status: LostItemStatus }) => {
      return authFetch(`/api/lost-items/update?id=${encodeURIComponent(caseId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
    },
    onSuccess: (_d, vars) => {
      toast({ title: t('toasts.movedTo', { status: statusLabel(vars.status, t) }) })
      qc.invalidateQueries({ queryKey: ['/api/lost-items/list'] })
      qc.invalidateQueries({ queryKey: ['/api/lost-items/get', vars.caseId] })
    },
    onError: (e: any) => {
      toast({ title: t('toasts.moveFailed'), description: e?.message ?? t('toasts.unknownError'), variant: 'destructive' })
      qc.invalidateQueries({ queryKey: ['/api/lost-items/list'] })
    },
  })

  const summaryCounts = useMemo(() => {
    const m: Record<LostItemStatus, number> = {
      pending_pickup: 0, picked_up: 0, delivered: 0, failed: 0, completed: 0,
    }
    for (const c of cases ?? []) m[c.status] += 1
    return m
  }, [cases])

  if (!canAccess) {
    return (
      <PageContainer>
        <h1 className="text-xl font-semibold">{t('page.noAccessTitle')}</h1>
        <p className="text-sm text-muted-foreground mt-2">
          {t('page.noAccessDescription')}
        </p>
      </PageContainer>
    )
  }

  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <>
            <ViewToggle value={view} onChange={setView} />
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t('page.searchPlaceholder')}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 w-full sm:w-72 text-sm"
                data-testid="input-lost-items-search"
              />
            </div>
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="h-8 w-44 text-xs" data-testid="select-lost-items-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">{t('page.filterOpen')}</SelectItem>
                <SelectItem value="all">{t('page.filterAllStatuses')}</SelectItem>
                {LOST_ITEM_PIPELINE.map(k => (
                  <SelectItem key={k} value={k}>{statusLabel(k, t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={`w-3 h-3 ${isRefetching ? 'animate-spin' : ''}`} />
              {t('common.actions.refresh')}
            </Button>
            {canEdit ? (
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setNewCaseOpen(true)} data-testid="button-new-lost-item">
                <Plus className="w-3.5 h-3.5" />
                {t('page.newCase')}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {LOST_ITEM_PIPELINE.map(s => (
          <SummaryTile
            key={s}
            label={statusLabel(s, t)}
            count={summaryCounts[s]}
            colorClass={STATUS_COLORS[s]}
            onClick={() => setStatusFilter(s)}
            active={statusFilter === s}
          />
        ))}
      </div>

      {isError && <ErrorState onRetry={() => refetch()} description={t('page.errorLoad', { error: error instanceof Error ? error.message : t('toasts.unknownError') })} />}

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-48 w-full" />
            ))}
          </div>
        ) : view === 'board' ? (
          <LostItemsBoardView
            cases={cases ?? []}
            assignmentsByCase={assignmentsByCase}
            onCaseClick={openCase}
            onStatusChange={(caseId, newStatus) => setStatus.mutate({ caseId, status: newStatus })}
            canEdit={canEdit}
          />
        ) : (
          <ListView
            cases={cases ?? []}
            assignmentsByCase={assignmentsByCase}
            onCaseClick={openCase}
          />
        )}
      </div>

      <NewLostItemCaseDialog open={newCaseOpen} onOpenChange={setNewCaseOpen} onCreated={(id) => openCase(id)} />

      {isLoading && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t('common.actions.loading')}
        </div>
      )}
    </PageContainer>
  )
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const { t } = useLocale('lostItems')
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-card overflow-hidden h-8">
      <button
        type="button"
        onClick={() => onChange('board')}
        className={`px-2 h-full text-xs flex items-center gap-1 ${value === 'board' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
        data-testid="button-view-board"
      >
        <KanbanSquare className="w-3.5 h-3.5" /> {t('page.viewBoard')}
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        className={`px-2 h-full text-xs flex items-center gap-1 border-l border-border ${value === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
        data-testid="button-view-list"
      >
        <ListIcon className="w-3.5 h-3.5" /> {t('page.viewList')}
      </button>
    </div>
  )
}

function SummaryTile({
  label, count, colorClass, onClick, active,
}: {
  label: string
  count: number
  colorClass: string
  onClick: () => void
  active: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-lg border px-3 py-2 text-left transition-colors ' +
        (active ? 'border-primary ring-1 ring-primary/40 bg-primary/5' : 'border-border hover:bg-muted/40')
      }
    >
      <div className={`text-2xs font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 inline-flex items-center gap-1 border ${colorClass}`}>
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{count}</div>
    </button>
  )
}

function ListView({
  cases, assignmentsByCase, onCaseClick,
}: {
  cases: LostItemCase[]
  assignmentsByCase: Map<string, LostItemAssignment>
  onCaseClick: (id: string) => void
}) {
  const { t } = useLocale('lostItems')
  const { format } = useDateFormat()
  return (
    <div className="rounded-2xl border border-border shadow-sm overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
          <tr>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('page.list.case')}</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('detail.fields.item')}</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('common.labels.property')}</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('detail.fields.guest')}</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('page.list.assignee')}</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('common.labels.status')}</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('page.list.updated')}</th>
          </tr>
        </thead>
        <tbody>
          {cases.length === 0 ? (
            <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">{t('page.list.empty')}</td></tr>
          ) : cases.map(c => {
            const a = assignmentsByCase.get(c.id)
            return (
              <tr
                key={c.id}
                className="border-b border-border/50 hover:bg-muted/20 cursor-pointer"
                onClick={() => onCaseClick(c.id)}
                data-testid={`row-lost-item-${c.id}`}
              >
                <td className="py-1.5 px-3 font-mono text-2xs">{c.case_number}</td>
                <td className="py-1.5 px-3 max-w-[280px] truncate" title={c.item_description}>{c.item_description}</td>
                <td className="py-1.5 px-3 text-muted-foreground">{c.property?.name ?? c.property_name ?? '—'}</td>
                <td className="py-1.5 px-3 text-muted-foreground">{c.guest_name ?? '—'}</td>
                <td className="py-1.5 px-3 text-muted-foreground">{a?.assignee?.label ?? '—'}</td>
                <td className="py-1.5 px-3">
                  <span className={`px-1.5 py-0.5 rounded font-medium text-2xs border ${STATUS_COLORS[c.status]}`}>
                    {statusLabel(c.status, t)}
                  </span>
                </td>
                <td className="py-1.5 px-3 text-muted-foreground tabular-nums">
                  {c.updated_at ? format(new Date(c.updated_at), 'MMM d, h:mm a') : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

