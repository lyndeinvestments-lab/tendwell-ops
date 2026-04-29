import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth, canAccessView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Search, Loader2, AlertTriangle, RefreshCw, Plus, KanbanSquare, List as ListIcon } from 'lucide-react'
import { format } from 'date-fns'
import {
  STATUS_COLORS, STATUS_LABELS, LOST_ITEM_PIPELINE,
  authFetch,
  type LostItemAssignment, type LostItemCase, type LostItemStatus,
} from '@/components/lost-items/shared'
import { LostItemsBoardView } from '@/components/lost-items/board-view'
import { NewLostItemCaseDialog } from '@/components/lost-items/new-case-dialog'
import { LostItemDetailPanel } from '@/components/lost-items/detail-panel'

type ViewMode = 'board' | 'list'
type StatusFilter = LostItemStatus | 'all' | 'open'

export default function LostItemsPage() {
  usePageTitle('Lost Items')
  const { effectiveUser } = useAuth()
  const canAccess = canAccessView('lost-items', effectiveUser)
  const canEdit = !!effectiveUser && (effectiveUser.role === 'admin' || effectiveUser.role === 'operations')

  const [view, setView] = useState<ViewMode>('board')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [newCaseOpen, setNewCaseOpen] = useState(false)

  const { toast } = useToast()
  const qc = useQueryClient()

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
    refetchOnWindowFocus: true,
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
  })

  const assignmentsByCase = useMemo(() => {
    const m = new Map<string, LostItemAssignment>()
    for (const a of assignmentsData?.assignments ?? []) m.set(a.haven_case_id, a)
    return m
  }, [assignmentsData])

  const { data: detail, isLoading: detailLoading } = useQuery<LostItemCase>({
    queryKey: ['/api/lost-items/get', activeId],
    queryFn: () => authFetch(`/api/lost-items/get?id=${encodeURIComponent(activeId!)}`),
    enabled: !!activeId,
  })

  const setStatus = useMutation({
    mutationFn: async ({ caseId, status }: { caseId: string; status: LostItemStatus }) => {
      return authFetch(`/api/lost-items/update?id=${encodeURIComponent(caseId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
    },
    onSuccess: (_d, vars) => {
      toast({ title: `Moved to ${STATUS_LABELS[vars.status]}` })
      qc.invalidateQueries({ queryKey: ['/api/lost-items/list'] })
      qc.invalidateQueries({ queryKey: ['/api/lost-items/get', vars.caseId] })
    },
    onError: (e: any) => {
      toast({ title: 'Failed to move case', description: e?.message ?? 'Unknown error', variant: 'destructive' })
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
      <div className="p-5">
        <h1 className="text-xl font-semibold">Lost Items</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Your role doesn't have access to Lost Items. Contact an admin if you need this view.
        </p>
      </div>
    )
  }

  return (
    <div className="p-5 h-full flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Lost Items</h1>
          <p className="text-sm text-muted-foreground">
            Live data from Haven-OS · auto-refreshes every 30s
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ViewToggle value={view} onChange={setView} />
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search description, guest, location…"
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
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
              {LOST_ITEM_PIPELINE.map(k => (
                <SelectItem key={k} value={k}>{STATUS_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={`w-3 h-3 ${isRefetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {canEdit ? (
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setNewCaseOpen(true)} data-testid="button-new-lost-item">
              <Plus className="w-3.5 h-3.5" />
              New Case
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {LOST_ITEM_PIPELINE.map(s => (
          <SummaryTile
            key={s}
            label={STATUS_LABELS[s]}
            count={summaryCounts[s]}
            colorClass={STATUS_COLORS[s]}
            onClick={() => setStatusFilter(s)}
            active={statusFilter === s}
          />
        ))}
      </div>

      {isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Couldn't load Lost Items: {error instanceof Error ? error.message : 'Unknown error'}</span>
        </div>
      )}

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
            onCaseClick={setActiveId}
            onStatusChange={(caseId, newStatus) => setStatus.mutate({ caseId, status: newStatus })}
            canEdit={canEdit}
          />
        ) : (
          <ListView
            cases={cases ?? []}
            assignmentsByCase={assignmentsByCase}
            onCaseClick={setActiveId}
          />
        )}
      </div>

      <NewLostItemCaseDialog open={newCaseOpen} onOpenChange={setNewCaseOpen} onCreated={(id) => setActiveId(id)} />

      <Sheet open={!!activeId} onOpenChange={v => !v && setActiveId(null)}>
        <SheetContent className="w-full sm:w-[520px] overflow-y-auto">
          <SheetHeader className="pb-3">
            <SheetTitle className="text-base font-mono">{detail?.case_number ?? '…'}</SheetTitle>
          </SheetHeader>
          {detailLoading || !detail ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <LostItemDetailPanel
              caseId={activeId!}
              detail={detail}
              assignment={activeId ? assignmentsByCase.get(activeId) : undefined}
              canEdit={canEdit}
            />
          )}
        </SheetContent>
      </Sheet>

      {isLoading && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading…
        </div>
      )}
    </div>
  )
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-card overflow-hidden h-8">
      <button
        type="button"
        onClick={() => onChange('board')}
        className={`px-2 h-full text-xs flex items-center gap-1 ${value === 'board' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
        data-testid="button-view-board"
      >
        <KanbanSquare className="w-3.5 h-3.5" /> Board
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        className={`px-2 h-full text-xs flex items-center gap-1 border-l border-border ${value === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
        data-testid="button-view-list"
      >
        <ListIcon className="w-3.5 h-3.5" /> List
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
      <div className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 inline-flex items-center gap-1 border ${colorClass}`}>
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
  return (
    <div className="rounded-lg border border-border overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
          <tr>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Case</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Item</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Property</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Guest</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Assignee</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Status</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Updated</th>
          </tr>
        </thead>
        <tbody>
          {cases.length === 0 ? (
            <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No lost items match your filters.</td></tr>
          ) : cases.map(c => {
            const a = assignmentsByCase.get(c.id)
            return (
              <tr
                key={c.id}
                className="border-b border-border/50 hover:bg-muted/20 cursor-pointer"
                onClick={() => onCaseClick(c.id)}
                data-testid={`row-lost-item-${c.id}`}
              >
                <td className="py-1.5 px-3 font-mono text-[11px]">{c.case_number}</td>
                <td className="py-1.5 px-3 max-w-[280px] truncate" title={c.item_description}>{c.item_description}</td>
                <td className="py-1.5 px-3 text-muted-foreground">{c.property?.name ?? c.property_name ?? '—'}</td>
                <td className="py-1.5 px-3 text-muted-foreground">{c.guest_name ?? '—'}</td>
                <td className="py-1.5 px-3 text-muted-foreground">{a?.assignee?.label ?? '—'}</td>
                <td className="py-1.5 px-3">
                  <span className={`px-1.5 py-0.5 rounded font-medium text-[10px] border ${STATUS_COLORS[c.status]}`}>
                    {STATUS_LABELS[c.status]}
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

