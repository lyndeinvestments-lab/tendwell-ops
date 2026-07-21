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
import { Search, RefreshCw, Loader2, Check, Undo2 } from 'lucide-react'
import { parseISO } from 'date-fns'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { ErrorState } from '@/components/ErrorState'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import type { TFunc } from '@/lib/i18n/t'

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
  const { t } = useLocale('shipments')
  const { format: formatDate } = useDateFormat()
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
      toast({ title: t('toasts.markedReceived') })
      qc.invalidateQueries({ queryKey: ['/incoming_shipments'] })
      setReceivingId(null)
      setReceivingNotes('')
    },
    onError: (e: any) => {
      toast({ title: t('toasts.markReceivedFailed'), description: e?.message ?? t('toasts.unknownError'), variant: 'destructive' })
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
      toast({ title: t('toasts.movedToPending') })
      qc.invalidateQueries({ queryKey: ['/incoming_shipments'] })
    },
    onError: (e: any) => {
      toast({ title: t('toasts.undoFailed'), description: e?.message ?? t('toasts.unknownError'), variant: 'destructive' })
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
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t('page.searchPlaceholder')}
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
                <SelectItem value="all">{t('page.allParties')}</SelectItem>
                {/* 'Haven'/'Tendwell' are company names (delivery_responsible enum values) — not translated */}
                <SelectItem value="Haven">Haven</SelectItem>
                <SelectItem value="Tendwell">Tendwell</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={`w-3 h-3 ${isRefetching ? 'animate-spin' : ''}`} />
              {t('common.actions.refresh')}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-2">
        <SummaryTile label={t('status.pending')} count={counts.pending}
          colorClass="bg-warning/15 text-warning border-warning/30"
          onClick={() => setStatusFilter('pending')} active={statusFilter === 'pending'} />
        <SummaryTile label={t('status.received')} count={counts.received}
          colorClass="bg-success/15 text-success border-success/30"
          onClick={() => setStatusFilter('received')} active={statusFilter === 'received'} />
        <SummaryTile label={t('common.actions.all')} count={counts.total}
          colorClass="bg-muted text-foreground border-border"
          onClick={() => setStatusFilter('all')} active={statusFilter === 'all'} />
      </div>

      {isError && (
        <ErrorState
          onRetry={() => refetch()}
          description={t('page.errorDescription', { message: error instanceof Error ? error.message : t('toasts.unknownError') })}
        />
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
            t={t}
            formatDate={formatDate}
          />
        )}
      </div>

      {isLoading && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t('common.actions.loading')}
        </div>
      )}

      <Dialog open={!!receivingId} onOpenChange={open => { if (!open) { setReceivingId(null); setReceivingNotes('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('form.markReceivedTitle')}</DialogTitle>
            <DialogDescription>
              {receivingRow
                ? `${receivingRow.sender_name} → ${receivingRow.property_name}`
                : t('form.markReceivedFallback')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">{t('form.notesLabel')}</label>
            <Textarea
              value={receivingNotes}
              onChange={e => setReceivingNotes(e.target.value)}
              placeholder={t('form.notesPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReceivingId(null); setReceivingNotes('') }}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              onClick={() => receivingId && markReceived.mutate({ id: receivingId, notes: receivingNotes })}
              disabled={markReceived.isPending || !receivingId}
              className="gap-1.5"
            >
              {markReceived.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Check className="w-3.5 h-3.5" />}
              {t('table.markReceived')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingId} onOpenChange={open => { if (!open) setViewingId(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('form.detailsTitle')}</DialogTitle>
            <DialogDescription>
              {viewingRow ? t('form.submittedAt', { time: safeFormatTimestamp(viewingRow.submitted_at, formatDate) }) : ''}
            </DialogDescription>
          </DialogHeader>
          {viewingRow && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <ShipKV k={t('table.headers.sender')} v={viewingRow.sender_name} />
                <ShipKV k={t('common.labels.property')} v={viewingRow.property_name} />
                <ShipKV k={t('form.trackingNumber')} v={viewingRow.tracking_number || '—'} mono />
                <ShipKV k={t('form.estimatedDelivery')} v={safeFormatDate(viewingRow.estimated_delivery, 'MMM d, yyyy', formatDate)} />
                <ShipKV k={t('form.deliveryResponsible')} v={viewingRow.delivery_responsible} />
                <ShipKV k={t('common.labels.status')} v={viewingRow.received_at ? t('status.received') : t('status.pending')} />
              </div>
              <div>
                <p className="text-2xs uppercase tracking-wide font-medium text-muted-foreground mb-1">{t('table.headers.description')}</p>
                <div className="rounded-md border border-border bg-muted/30 p-2.5 whitespace-pre-wrap break-words">
                  {viewingRow.description}
                </div>
              </div>
              {viewingRow.received_at && (
                <div className="rounded-md border border-success/20 bg-success/5 p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <Check className="w-3.5 h-3.5 text-success" />
                    <span>{t('form.receivedAt', { time: safeFormatTimestamp(viewingRow.received_at, formatDate) })}</span>
                    {viewingRow.received_by && receiverMap?.[viewingRow.received_by] && (
                      <span className="text-muted-foreground">{t('form.receivedBy', { name: receiverMap[viewingRow.received_by] })}</span>
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
    </PageContainer>
  )
}

function ShipKV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-2xs uppercase tracking-wide font-medium text-muted-foreground">{k}</p>
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
      <div className={`text-2xs font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 inline-flex items-center gap-1 border ${colorClass}`}>
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{count}</div>
    </button>
  )
}

function ListView({
  rows, receiverMap, canEdit, onMarkReceived, onUndo, undoingId, onView, t, formatDate,
}: {
  rows: Shipment[]
  receiverMap: Record<string, string>
  canEdit: boolean
  onMarkReceived: (id: string) => void
  onUndo: (id: string) => void
  undoingId: string | null
  onView: (id: string) => void
  t: TFunc
  formatDate: DateFormatFn
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
        {t('table.empty')}
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-border shadow-sm overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
          <tr>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('table.headers.sender')}</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('common.labels.property')}</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('table.headers.description')}</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('table.headers.tracking')}</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('table.headers.estDelivery')}</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('table.headers.responsible')}</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('table.headers.submitted')}</th>
            <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('common.labels.status')}</th>
            <th className="text-right font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('common.labels.actions')}</th>
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
                <td className="py-1.5 px-3 font-mono text-2xs text-muted-foreground">{s.tracking_number || '—'}</td>
                <td className="py-1.5 px-3 text-muted-foreground tabular-nums">
                  {safeFormatDate(s.estimated_delivery, 'MMM d, yyyy', formatDate)}
                </td>
                <td className="py-1.5 px-3">
                  {/* 'Haven'/'Tendwell' are company names (delivery_responsible enum value) — not translated */}
                  <span className={`px-1.5 py-0.5 rounded font-medium text-2xs border ${
                    s.delivery_responsible === 'Haven'
                      ? 'bg-info/15 text-info border-info/30'
                      : 'bg-primary/10 text-primary border-primary/25'
                  }`}>
                    {s.delivery_responsible}
                  </span>
                </td>
                <td className="py-1.5 px-3 text-muted-foreground tabular-nums">
                  {safeFormatTimestamp(s.submitted_at, formatDate)}
                </td>
                <td className="py-1.5 px-3">
                  {isReceived ? (
                    <div className="flex flex-col">
                      <span className="px-1.5 py-0.5 rounded font-medium text-2xs border bg-success/15 text-success border-success/30 inline-flex items-center gap-1 w-fit">
                        <Check className="w-3 h-3" /> {t('status.received')}
                      </span>
                      <span className="text-2xs text-muted-foreground mt-0.5 tabular-nums">
                        {safeFormatTimestamp(s.received_at, formatDate)}
                        {s.received_by && receiverMap[s.received_by] ? ` · ${receiverMap[s.received_by]}` : ''}
                      </span>
                      {s.received_notes && (
                        <span className="text-2xs text-muted-foreground italic mt-0.5 max-w-[240px] truncate" title={s.received_notes}>
                          "{s.received_notes}"
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded font-medium text-2xs border bg-warning/15 text-warning border-warning/30">
                      {t('status.pending')}
                    </span>
                  )}
                </td>
                <td className="py-1.5 px-3 text-right" onClick={e => e.stopPropagation()}>
                  {canEdit && !isReceived && (
                    <Button size="sm" variant="default" className="h-7 gap-1 text-xs"
                      onClick={() => onMarkReceived(s.id)}
                      data-testid={`button-mark-received-${s.id}`}
                    >
                      <Check className="w-3 h-3" /> {t('table.markReceived')}
                    </Button>
                  )}
                  {canEdit && isReceived && (
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-muted-foreground"
                      onClick={() => onUndo(s.id)}
                      disabled={undoingId === s.id}
                      data-testid={`button-undo-received-${s.id}`}
                    >
                      <Undo2 className="w-3 h-3" /> {t('table.undo')}
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

type DateFormatFn = (date: Date | number, pattern: string) => string

function safeFormatDate(value: string | null | undefined, pattern: string, formatDate: DateFormatFn): string {
  if (!value) return '—'
  try { return formatDate(parseISO(value), pattern) } catch { return value }
}

function safeFormatTimestamp(value: string | null | undefined, formatDate: DateFormatFn): string {
  if (!value) return '—'
  try { return formatDate(parseISO(value), 'MMM d, h:mm a') } catch { return value }
}
