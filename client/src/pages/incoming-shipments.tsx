import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Search, RefreshCw, AlertTriangle, Loader2, PackagePlus, Check, Undo2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'

// ─── Types ──────────────────────────────────────────────────────────────────
type DeliveryResponsible = 'Haven' | 'Tendwell'

interface Shipment {
  id: string
  sender_name: string
  property_name: string
  tracking_number: string | null
  estimated_delivery: string // 'YYYY-MM-DD'
  description: string
  delivery_responsible: DeliveryResponsible
  submitted_at: string
  received_at: string | null
  received_by: string | null
  received_notes: string | null
}

type StatusFilter = 'pending' | 'received' | 'all'
type RespFilter = 'all' | DeliveryResponsible

// ─── Page ───────────────────────────────────────────────────────────────────
export default function IncomingShipmentsPage() {
  usePageTitle('Incoming Shipments')
  const { effectiveUser } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canEdit = canEditView('incoming-shipments', effectiveUser)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [respFilter, setRespFilter] = useState<RespFilter>('all')
  const [search, setSearch] = useState('')

  const [receivingId, setReceivingId] = useState<string | null>(null)
  const [receivingNotes, setReceivingNotes] = useState('')

  const { data: shipments, isLoading, isError, error, refetch, isRefetching } = useQuery<Shipment[]>({
    queryKey: ['/incoming_shipments'],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('incoming_shipments')
        .select('*')
        .order('received_at', { ascending: false, nullsFirst: true })
        .order('estimated_delivery', { ascending: true })
        .limit(500)
      if (e) throw e
      return (data ?? []) as Shipment[]
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  })

  // Resolve `received_by` uuids → user labels for display.
  const receiverIds = useMemo(() => {
    const ids = new Set<string>()
    for (const s of shipments ?? []) if (s.received_by) ids.add(s.received_by)
    return Array.from(ids)
  }, [shipments])

  const { data: receiverMap } = useQuery<Record<string, string>>({
    queryKey: ['/incoming_shipments/receivers', receiverIds.join(',')],
    queryFn: async () => {
      if (receiverIds.length === 0) return {}
      // TODO: incoming_shipments.received_by is auth.users.uuid; app_users.id
      // is integer. This lookup never matches, so the "received by" name has
      // always been blank in the UI. To fix properly we need an auth.users
      // → app_users bridge (e.g. by google_email). For now, satisfy the typed
      // client without changing observed behavior.
      const { data, error: e } = await supabase
        .from('app_users')
        .select('id,label')
        .in('id', receiverIds as unknown as number[])
      if (e) throw e
      const m: Record<string, string> = {}
      for (const u of (data ?? [])) {
        if (u.id != null) m[String(u.id)] = u.label ?? '—'
      }
      return m
    },
    enabled: receiverIds.length > 0,
    staleTime: 60_000,
  })

  // ─── Mutations ────────────────────────────────────────────────────────────
  const markReceived = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { error: e } = await supabase
        .from('incoming_shipments')
        .update({
          received_at: new Date().toISOString(),
          received_by: effectiveUser?.id ?? null,
          received_notes: notes.trim() || null,
        })
        .eq('id', id)
      if (e) throw e
    },
    onSuccess: () => {
      toast({ title: 'Marked received' })
      qc.invalidateQueries({ queryKey: ['/incoming_shipments'] })
      setReceivingId(null)
      setReceivingNotes('')
    },
    onError: (e: any) => {
      toast({ title: 'Failed to mark received', description: e?.message ?? 'Unknown error', variant: 'destructive' })
    },
  })

  const undoReceived = useMutation({
    mutationFn: async (id: string) => {
      const { error: e } = await supabase
        .from('incoming_shipments')
        .update({ received_at: null, received_by: null, received_notes: null })
        .eq('id', id)
      if (e) throw e
    },
    onSuccess: () => {
      toast({ title: 'Moved back to pending' })
      qc.invalidateQueries({ queryKey: ['/incoming_shipments'] })
    },
    onError: (e: any) => {
      toast({ title: 'Failed to undo', description: e?.message ?? 'Unknown error', variant: 'destructive' })
    },
  })

  // ─── Filtering ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (shipments ?? []).filter(s => {
      if (statusFilter === 'pending' && s.received_at) return false
      if (statusFilter === 'received' && !s.received_at) return false
      if (respFilter !== 'all' && s.delivery_responsible !== respFilter) return false
      if (!q) return true
      return (
        s.sender_name.toLowerCase().includes(q) ||
        s.property_name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.tracking_number ?? '').toLowerCase().includes(q)
      )
    })
  }, [shipments, statusFilter, respFilter, search])

  const counts = useMemo(() => {
    let pending = 0, received = 0
    for (const s of shipments ?? []) (s.received_at ? received++ : pending++)
    return { pending, received, total: (shipments ?? []).length }
  }, [shipments])

  const receivingRow = useMemo(
    () => (shipments ?? []).find(s => s.id === receivingId) ?? null,
    [shipments, receivingId],
  )

  const [viewingId, setViewingId] = useState<string | null>(null)
  const viewingRow = useMemo(
    () => (shipments ?? []).find(s => s.id === viewingId) ?? null,
    [shipments, viewingId],
  )

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-5 h-full flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <PackagePlus className="w-5 h-5 text-muted-foreground" />
            Incoming Shipments
          </h1>
          <p className="text-sm text-muted-foreground">
            Submissions from the public report form · auto-refreshes every 30s
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search sender, property, description, tracking…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 w-full sm:w-80 text-sm"
              data-testid="input-shipments-search"
            />
          </div>
          <Select value={respFilter} onValueChange={v => setRespFilter(v as RespFilter)}>
            <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-shipments-responsible">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All parties</SelectItem>
              <SelectItem value="Haven">Haven</SelectItem>
              <SelectItem value="Tendwell">Tendwell</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={`w-3 h-3 ${isRefetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <SummaryTile label="Pending" count={counts.pending}
          colorClass="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
          onClick={() => setStatusFilter('pending')} active={statusFilter === 'pending'} />
        <SummaryTile label="Received" count={counts.received}
          colorClass="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
          onClick={() => setStatusFilter('received')} active={statusFilter === 'received'} />
        <SummaryTile label="All" count={counts.total}
          colorClass="bg-muted text-foreground border-border"
          onClick={() => setStatusFilter('all')} active={statusFilter === 'all'} />
      </div>

      {isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Couldn't load Incoming Shipments: {error instanceof Error ? error.message : 'Unknown error'}</span>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <ListView
            rows={filtered}
            receiverMap={receiverMap ?? {}}
            canEdit={canEdit}
            onMarkReceived={(id) => { setReceivingId(id); setReceivingNotes('') }}
            onUndo={(id) => undoReceived.mutate(id)}
            undoingId={undoReceived.isPending ? undoReceived.variables ?? null : null}
            onView={(id) => setViewingId(id)}
          />
        )}
      </div>

      {isLoading && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading…
        </div>
      )}

      <Dialog open={!!receivingId} onOpenChange={open => { if (!open) { setReceivingId(null); setReceivingNotes('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark shipment received</DialogTitle>
            <DialogDescription>
              {receivingRow
                ? `${receivingRow.sender_name} → ${receivingRow.property_name}`
                : 'Confirm the package has physically arrived.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
            <Textarea
              value={receivingNotes}
              onChange={e => setReceivingNotes(e.target.value)}
              placeholder="Anything worth recording — damage, location, who handed it off…"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReceivingId(null); setReceivingNotes('') }}>
              Cancel
            </Button>
            <Button
              onClick={() => receivingId && markReceived.mutate({ id: receivingId, notes: receivingNotes })}
              disabled={markReceived.isPending || !receivingId}
              className="gap-1.5"
            >
              {markReceived.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Check className="w-3.5 h-3.5" />}
              Mark received
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingId} onOpenChange={open => { if (!open) setViewingId(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Shipment details</DialogTitle>
            <DialogDescription>
              {viewingRow ? `Submitted ${safeFormatTimestamp(viewingRow.submitted_at)}` : ''}
            </DialogDescription>
          </DialogHeader>
          {viewingRow && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <ShipKV k="Sender" v={viewingRow.sender_name} />
                <ShipKV k="Property" v={viewingRow.property_name} />
                <ShipKV k="Tracking #" v={viewingRow.tracking_number || '—'} mono />
                <ShipKV k="Estimated delivery" v={safeFormatDate(viewingRow.estimated_delivery, 'MMM d, yyyy')} />
                <ShipKV k="Delivery responsible" v={viewingRow.delivery_responsible} />
                <ShipKV k="Status" v={viewingRow.received_at ? 'Received' : 'Pending'} />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground mb-1">Description</p>
                <div className="rounded-md border border-border bg-muted/30 p-2.5 whitespace-pre-wrap break-words">
                  {viewingRow.description}
                </div>
              </div>
              {viewingRow.received_at && (
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Received {safeFormatTimestamp(viewingRow.received_at)}</span>
                    {viewingRow.received_by && receiverMap?.[viewingRow.received_by] && (
                      <span className="text-muted-foreground">· by {receiverMap[viewingRow.received_by]}</span>
                    )}
                  </div>
                  {viewingRow.received_notes && (
                    <div className="text-xs italic text-muted-foreground whitespace-pre-wrap break-words pl-5.5">
                      "{viewingRow.received_notes}"
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ShipKV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground">{k}</p>
      <p className={`text-sm break-words ${mono ? 'font-mono text-xs' : ''}`}>{v || '—'}</p>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────
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
  rows, receiverMap, canEdit, onMarkReceived, onUndo, undoingId, onView,
}: {
  rows: Shipment[]
  receiverMap: Record<string, string>
  canEdit: boolean
  onMarkReceived: (id: string) => void
  onUndo: (id: string) => void
  undoingId: string | null
  onView: (id: string) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
        No shipments match your filters.
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-border overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
          <tr>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Sender</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Property</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Description</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Tracking</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Est. Delivery</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Responsible</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Submitted</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Status</th>
            <th className="text-right font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(s => {
            const isReceived = !!s.received_at
            return (
              <tr
                key={s.id}
                className={`border-b border-border/50 hover:bg-muted/20 cursor-pointer ${isReceived ? 'opacity-70' : ''}`}
                data-testid={`row-shipment-${s.id}`}
                onClick={() => onView(s.id)}
              >
                <td className="py-1.5 px-3 font-medium">{s.sender_name}</td>
                <td className="py-1.5 px-3 text-muted-foreground">{s.property_name}</td>
                <td className="py-1.5 px-3 max-w-[320px] truncate text-primary hover:underline" title={s.description}>{s.description}</td>
                <td className="py-1.5 px-3 font-mono text-[11px] text-muted-foreground">{s.tracking_number || '—'}</td>
                <td className="py-1.5 px-3 text-muted-foreground tabular-nums">
                  {safeFormatDate(s.estimated_delivery, 'MMM d, yyyy')}
                </td>
                <td className="py-1.5 px-3">
                  <span className={`px-1.5 py-0.5 rounded font-medium text-[10px] border ${
                    s.delivery_responsible === 'Haven'
                      ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30'
                      : 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30'
                  }`}>
                    {s.delivery_responsible}
                  </span>
                </td>
                <td className="py-1.5 px-3 text-muted-foreground tabular-nums">
                  {safeFormatTimestamp(s.submitted_at)}
                </td>
                <td className="py-1.5 px-3">
                  {isReceived ? (
                    <div className="flex flex-col">
                      <span className="px-1.5 py-0.5 rounded font-medium text-[10px] border bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 inline-flex items-center gap-1 w-fit">
                        <Check className="w-3 h-3" /> Received
                      </span>
                      <span className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                        {safeFormatTimestamp(s.received_at)}
                        {s.received_by && receiverMap[s.received_by] ? ` · ${receiverMap[s.received_by]}` : ''}
                      </span>
                      {s.received_notes && (
                        <span className="text-[10px] text-muted-foreground italic mt-0.5 max-w-[240px] truncate" title={s.received_notes}>
                          “{s.received_notes}”
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded font-medium text-[10px] border bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
                      Pending
                    </span>
                  )}
                </td>
                <td className="py-1.5 px-3 text-right" onClick={e => e.stopPropagation()}>
                  {canEdit && !isReceived && (
                    <Button size="sm" variant="default" className="h-7 gap-1 text-xs"
                      onClick={() => onMarkReceived(s.id)}
                      data-testid={`button-mark-received-${s.id}`}
                    >
                      <Check className="w-3 h-3" /> Mark received
                    </Button>
                  )}
                  {canEdit && isReceived && (
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-muted-foreground"
                      onClick={() => onUndo(s.id)}
                      disabled={undoingId === s.id}
                      data-testid={`button-undo-received-${s.id}`}
                    >
                      <Undo2 className="w-3 h-3" /> Undo
                    </Button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function safeFormatDate(value: string | null | undefined, pattern: string): string {
  if (!value) return '—'
  try { return format(parseISO(value), pattern) } catch { return value }
}

function safeFormatTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  try { return format(parseISO(value), 'MMM d, h:mm a') } catch { return value }
}
