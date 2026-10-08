import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { parseISO } from 'date-fns'
import {
  ArrowLeft, CalendarRange, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, FileText, Hourglass, Loader2,
  Paperclip, Pencil, Plus, RefreshCw, RotateCcw, Search, Send, Trash2, Undo2, XCircle,
} from 'lucide-react'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import type { StatusTone } from '@/lib/status-colors'
import type { VendorRunStatus } from '@shared/vendor-invoice'
import { AddItemDialog } from '@/components/vendor-invoicing/AddItemDialog'
import {
  money, openReceipt, suggestPeriod, vendorApi, VendorApiError,
  type VendorHome, type VendorLine, type VendorProperty, type VendorRun, type VendorRunDetail,
} from '@/lib/vendor-invoices'

/**
 * Operations → Invoicing — a cleaning company's own invoice (Busy Bee).
 *
 * The draft is built from COMPLETED Breezeway/Trellis cleans (one per
 * property per day, at the Cleaner Pay rate); the vendor adds inspection
 * hours, labor, reimbursements, extras and missing cleans, then submits it
 * to Tendwell's Invoice Reconciliation queue. Everything shown comes from
 * api/vendor-invoices/*, which allow-lists fields: the vendor's pay, the
 * task and date, and the Property List's own columns — never what Tendwell
 * charges its clients.
 */

const STATUS_TONE: Record<VendorRunStatus, StatusTone> = {
  draft: 'neutral',
  returned: 'warning',
  submitted: 'info',
  approved: 'success',
  void: 'destructive',
}

type LineFilter = 'all' | 'cleans' | 'items' | 'review' | 'removed'
const FILTER_KEY: Record<LineFilter, string> = {
  all: 'detail.filterAll',
  cleans: 'detail.filterCleans',
  items: 'detail.filterItems',
  review: 'detail.filterReview',
  removed: 'detail.filterRemoved',
}

function useVendorText() {
  const { t } = useLocale('vendorInvoicing')
  const { format, formatDistanceToNow } = useDateFormat()
  const fmtDay = (iso: string | null) => (iso ? format(parseISO(iso), 'EEE MMM d') : '')
  const fmtRange = (a: string, b: string) => `${format(parseISO(a), 'MMM d')} – ${format(parseISO(b), 'MMM d, yyyy')}`
  const ago = (iso: string | null) => (iso ? formatDistanceToNow(parseISO(iso), { addSuffix: true }) : '')
  const errText = (e: unknown) =>
    e instanceof VendorApiError ? t(`errors.${e.code}`, undefined, t('errors.generic')) : t('errors.generic')
  return { t, fmtDay, fmtRange, ago, errText }
}

export default function VendorInvoicingPage() {
  const { t } = useLocale('vendorInvoicing')
  usePageTitle(t('page.title'))
  const [runId, setRunId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('run'))

  const openRun = (id: string | null) => {
    setRunId(id)
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('run', id)
    else url.searchParams.delete('run')
    window.history.replaceState(null, '', url.toString())
  }

  const home = useQuery({
    queryKey: ['vendor-invoices', 'home'],
    queryFn: () => vendorApi<VendorHome>('runs'),
    retry: (n, e) => !(e instanceof VendorApiError && (e.status === 403 || e.status === 401)) && n < 2,
  })

  if (home.error instanceof VendorApiError && home.error.code === 'not_linked') {
    return (
      <PageContainer>
        <PageHeader title={t('page.title')} />
        <EmptyState icon={FileText} title={t('page.notLinkedTitle')} description={t('page.notLinkedBody')} />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      {home.data?.me.is_admin && (
        <div className="mb-4 rounded-xl border border-info/30 bg-info/10 px-4 py-2 text-sm text-info" data-testid="banner-admin-preview">
          {t('page.adminPreview', { vendor: home.data.vendor.name })}
        </div>
      )}
      {runId ? (
        <RunView runId={runId} today={home.data?.today ?? null} onBack={() => openRun(null)} />
      ) : (
        <RunList home={home.data} loading={home.isLoading} error={!!home.error} onRetry={() => home.refetch()} onOpen={openRun} />
      )}
    </PageContainer>
  )
}

// ─── List ────────────────────────────────────────────────────────────────────

function RunList({ home, loading, error, onRetry, onOpen }: {
  home: VendorHome | undefined
  loading: boolean
  error: boolean
  onRetry: () => void
  onOpen: (id: string) => void
}) {
  const { t, fmtRange, ago } = useVendorText()
  const [creating, setCreating] = useState(false)
  const runs = home?.runs ?? []
  const count = (s: VendorRunStatus) => runs.filter(r => r.status === s).length

  return (
    <>
      <PageHeader
        title={home?.vendor.name ? `${t('page.title')} · ${home.vendor.name}` : t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <Button onClick={() => setCreating(true)} disabled={!home} data-testid="button-new-invoice">
            <Plus className="w-4 h-4 mr-1.5" /> {t('list.newInvoice')}
          </Button>
        }
      />
      <p className="text-sm text-muted-foreground mt-2 mb-4 max-w-3xl">{t('page.howItWorks')}</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard title={t('list.tiles.drafts')} value={count('draft')} icon={Pencil} loading={loading} />
        <StatCard title={t('list.tiles.returned')} value={count('returned')} icon={Undo2} tone="warning" loading={loading} />
        <StatCard title={t('list.tiles.waiting')} value={count('submitted')} icon={Hourglass} tone="info" loading={loading} />
        <StatCard title={t('list.tiles.approved')} value={count('approved')} icon={CheckCircle2} tone="success" loading={loading} />
      </div>

      {error ? (
        <ErrorState onRetry={onRetry} />
      ) : loading ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
      ) : runs.length === 0 ? (
        <EmptyState icon={FileText} title={t('list.emptyTitle')} description={t('list.emptyBody')} action={{ label: t('list.newInvoice'), onClick: () => setCreating(true) }} />
      ) : (
        <div className="rounded-2xl border border-card-border bg-card shadow-sm overflow-hidden">
          <ul className="divide-y divide-border">
            {runs.map(r => (
              <li key={r.id}>
                <button
                  className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                  onClick={() => onOpen(r.id)}
                  data-testid={`row-run-${r.id}`}
                >
                  <CalendarRange className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">{fmtRange(r.period_start, r.period_end)}</span>
                  <StatusBadge tone={STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</StatusBadge>
                  {r.vendor_reference && <span className="text-xs text-muted-foreground">#{r.vendor_reference}</span>}
                  <span className="ml-auto flex items-center gap-4">
                    {r.submitted_at && <span className="text-xs text-muted-foreground hidden sm:inline">{t('list.submitted')} {ago(r.submitted_at)}</span>}
                    <span className="font-semibold tabular-nums">{money(r.total)}</span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {creating && home && (
        <CreateDialog
          today={home.today}
          lastEnd={runs.reduce<string | null>((m, r) => (r.status === 'void' ? m : !m || r.period_end > m ? r.period_end : m), null)}
          onClose={() => setCreating(false)}
          onCreated={id => { setCreating(false); onOpen(id) }}
        />
      )}
    </>
  )
}

function CreateDialog({ today, lastEnd, onClose, onCreated }: {
  today: string
  lastEnd: string | null
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { t, errText } = useVendorText()
  const { toast } = useToast()
  const qc = useQueryClient()
  const initial = suggestPeriod(today, lastEnd)
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const detail = await vendorApi<VendorRunDetail>('runs', { method: 'POST', body: { action: 'create', period_start: start, period_end: end } })
      qc.setQueryData(['vendor-invoices', 'run', detail.run.id], detail)
      qc.invalidateQueries({ queryKey: ['vendor-invoices', 'home'] })
      toast({ title: t('toast.created', { count: detail.lines.filter(l => l.category === 'clean').length }) })
      onCreated(detail.run.id)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-md" data-testid="dialog-new-invoice">
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
          <DialogDescription>{t('create.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t('create.start')}</Label>
            <Input type="date" value={start} max={today} onChange={e => setStart(e.target.value)} data-testid="input-period-start" />
          </div>
          <div>
            <Label>{t('create.end')}</Label>
            <Input type="date" value={end} max={today} onChange={e => setEnd(e.target.value)} data-testid="input-period-end" />
          </div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('item.cancel')}</Button>
          <Button onClick={create} disabled={busy || !start || !end} data-testid="button-create-invoice">
            {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            {busy ? t('create.creating') : t('create.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── One invoice ─────────────────────────────────────────────────────────────

function RunView({ runId, today, onBack }: { runId: string; today: string | null; onBack: () => void }) {
  const { t, fmtRange, fmtDay, ago, errText } = useVendorText()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<LineFilter>('all')
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<VendorLine | null>(null)
  const [removing, setRemoving] = useState<VendorLine | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [showSkipped, setShowSkipped] = useState(false)

  const q = useQuery({
    queryKey: ['vendor-invoices', 'run', runId],
    queryFn: () => vendorApi<VendorRunDetail>('runs', { query: { id: runId } }),
  })
  const editable = q.data?.run.status === 'draft' || q.data?.run.status === 'returned'
  const propsQ = useQuery({
    queryKey: ['vendor-invoices', 'properties'],
    queryFn: () => vendorApi<{ properties: VendorProperty[] }>('runs', { query: { properties: '1' } }),
    enabled: editable && (adding || !!editing),
    staleTime: 5 * 60_000,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['vendor-invoices', 'run', runId] })
    qc.invalidateQueries({ queryKey: ['vendor-invoices', 'home'] })
  }

  async function act(key: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(key)
    try {
      await fn()
      if (success) toast({ title: success })
      refresh()
    } catch (e) {
      toast({ title: errText(e), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const detail = q.data
  const props = detail?.properties ?? {}
  const lines = detail?.lines ?? []
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return lines.filter(l => {
      if (filter === 'cleans' && (l.category !== 'clean' || l.removed)) return false
      if (filter === 'items' && (l.category === 'clean' || l.removed)) return false
      if (filter === 'review' && (!l.in_review || l.removed)) return false
      if (filter === 'removed' && !l.removed) return false
      if (filter === 'all' && l.removed) return false
      if (!needle) return true
      const p = l.property_id != null ? props[String(l.property_id)] : null
      return [p?.name, p?.address, l.service_type, l.task_title, l.detail.description, l.detail.worker].some(v => v?.toLowerCase().includes(needle))
    })
  }, [lines, filter, search, props])

  if (q.isLoading) {
    return <div className="space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-96 w-full rounded-xl" /></div>
  }
  if (q.error || !detail) {
    return (
      <>
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-3"><ArrowLeft className="w-4 h-4 mr-1.5" />{t('detail.back')}</Button>
        <ErrorState onRetry={() => q.refetch()} />
      </>
    )
  }

  const run = detail.run
  const active = lines.filter(l => !l.removed)
  const cleans = active.filter(l => l.category === 'clean')
  const items = active.filter(l => l.category !== 'clean')
  const removedCount = lines.filter(l => l.removed).length

  return (
    <>
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-2" data-testid="button-back"><ArrowLeft className="w-4 h-4 mr-1.5" />{t('detail.back')}</Button>
      <PageHeader
        title={fmtRange(run.period_start, run.period_end)}
        subtitle={detail.pulled_at ? t('detail.pulledAt', { when: ago(detail.pulled_at) }) : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={STATUS_TONE[run.status]}>{t(`status.${run.status}`)}</StatusBadge>
            {editable && (
              <>
                <Button variant="outline" size="sm" onClick={() => act('refresh', async () => {
                  const r = await vendorApi<VendorRunDetail>('runs', { method: 'POST', body: { action: 'refresh', run_id: run.id } })
                  toast({ title: t('toast.refreshed', { count: r.added ?? 0 }) })
                })} disabled={!!busy} data-testid="button-refresh">
                  {busy === 'refresh' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
                  {busy === 'refresh' ? t('detail.refreshing') : t('detail.refresh')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAdding(true)} disabled={!!busy} data-testid="button-add-item">
                  <Plus className="w-4 h-4 mr-1.5" />{t('detail.addItem')}
                </Button>
                <Button size="sm" onClick={() => setSubmitting(true)} disabled={!!busy || active.length === 0} data-testid="button-submit">
                  <Send className="w-4 h-4 mr-1.5" />{t('detail.submit')}
                </Button>
                {!run.submitted_at && (
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(true)} disabled={!!busy} data-testid="button-delete-draft">
                    <Trash2 className="w-4 h-4 mr-1.5" />{t('detail.delete')}
                  </Button>
                )}
              </>
            )}
          </div>
        }
      />

      {run.status === 'returned' && (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3" data-testid="banner-returned">
          <p className="font-medium text-warning">{t('detail.returnedTitle')}</p>
          {run.returned_note && <p className="text-sm mt-1 whitespace-pre-line">{run.returned_note}</p>}
          <p className="text-xs text-muted-foreground mt-1">{t('detail.returnedBody')}</p>
        </div>
      )}
      {run.status === 'submitted' && (
        <div className="mt-4 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm text-info">{t('detail.submittedBanner', { when: ago(run.submitted_at) })}</div>
      )}
      {run.status === 'approved' && (
        <div className="mt-4 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">{t('detail.approvedBanner', { when: ago(run.approved_at) })}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 my-5">
        <StatCard title={t('detail.total')} value={<span className="tabular-nums">{money(run.total)}</span>} icon={FileText} className="border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card" />
        <StatCard title={t('detail.cleans')} value={cleans.length} icon={ClipboardCheck} />
        <StatCard title={t('detail.items')} value={items.length} icon={Paperclip} tone="info" />
        <StatCard title={t('detail.inReview')} value={detail.in_review_count} icon={Hourglass} tone="warning" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(Object.keys(FILTER_KEY) as LineFilter[]).map(f => (
          <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" onClick={() => setFilter(f)} data-testid={`filter-${f}`}>
            {t(FILTER_KEY[f])}
            {f === 'removed' && removedCount > 0 ? ` (${removedCount})` : ''}
          </Button>
        ))}
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input className="pl-8" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('detail.search')} data-testid="input-search-lines" />
        </div>
      </div>

      <div className="rounded-2xl border border-card-border bg-card shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground text-center">{t('detail.noLines')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map(l => (
              <LineRow
                key={l.id}
                line={l}
                property={l.property_id != null ? props[String(l.property_id)] ?? null : null}
                editable={editable}
                busy={busy === l.id}
                fmtDay={fmtDay}
                onEdit={() => setEditing(l)}
                onDelete={() => act(l.id, () => vendorApi('items', { method: 'POST', body: { action: 'delete', run_id: run.id, line_no: l.line_no, line_id: l.id } }), t('toast.itemDeleted'))}
                onRemove={() => setRemoving(l)}
                onRestore={() => act(l.id, () => vendorApi('items', { method: 'POST', body: { action: 'restore', run_id: run.id, line_no: l.line_no, line_id: l.id } }), t('toast.restored'))}
                onReceipt={() => openReceipt(l.id).catch(() => toast({ title: t('errors.generic'), variant: 'destructive' }))}
              />
            ))}
          </ul>
        )}
      </div>

      {detail.skipped.length > 0 && (
        <div className="mt-4 rounded-2xl border border-card-border bg-card shadow-sm">
          <button className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium" onClick={() => setShowSkipped(s => !s)} data-testid="toggle-skipped">
            {showSkipped ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {t('detail.skippedTitle', { count: detail.skipped.length })}
          </button>
          {showSkipped && (
            <ul className="divide-y divide-border border-t border-border">
              {detail.skipped.map(s => (
                <li key={`${s.property_id}-${s.date}`} className="px-4 py-2 text-sm flex flex-wrap gap-x-3">
                  <span className="font-medium">{s.property_name}</span>
                  <span className="text-muted-foreground">{fmtDay(s.date)} · {s.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {s.reason === 'already_invoiced'
                      ? (s.ref ? t('detail.skippedAlready', { ref: s.ref }) : t('detail.skippedElsewhere'))
                      : t('detail.skippedUnknown')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(adding || editing) && today && (
        propsQ.data ? (
          <AddItemDialog
            runId={run.id}
            periodStart={run.period_start}
            periodEnd={run.period_end}
            today={today}
            properties={propsQ.data.properties}
            editing={editing}
            onClose={() => { setAdding(false); setEditing(null) }}
            onSaved={() => { setAdding(false); setEditing(null); toast({ title: t('toast.itemSaved') }); refresh() }}
          />
        ) : (
          <Dialog open onOpenChange={o => { if (!o) { setAdding(false); setEditing(null) } }}>
            <DialogContent className="max-w-sm">
              <DialogHeader><DialogTitle>{t('item.titleAdd')}</DialogTitle></DialogHeader>
              {propsQ.error ? <ErrorState onRetry={() => propsQ.refetch()} /> : <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
            </DialogContent>
          </Dialog>
        )
      )}

      {removing && (
        <RemoveDialog
          line={removing}
          propertyName={removing.property_id != null ? props[String(removing.property_id)]?.name ?? '' : ''}
          dateLabel={fmtDay(removing.date)}
          onClose={() => setRemoving(null)}
          onConfirm={reason => act(removing.id, async () => {
            await vendorApi('items', { method: 'POST', body: { action: 'remove', run_id: run.id, line_no: removing.line_no, line_id: removing.id, reason } })
            setRemoving(null)
          }, t('toast.removed'))}
        />
      )}

      {submitting && (
        <SubmitDialog
          run={run}
          lineCount={active.length}
          onClose={() => setSubmitting(false)}
          onSubmit={reference => act('submit', async () => {
            await vendorApi('runs', { method: 'POST', body: { action: 'submit', run_id: run.id, vendor_reference: reference } })
            setSubmitting(false)
          }, t('toast.submitted'))}
          busy={busy === 'submit'}
        />
      )}

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('detail.deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('item.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => act('delete', async () => {
                await vendorApi('runs', { method: 'POST', body: { action: 'delete', run_id: run.id } })
                onBack()
              }, t('toast.deleted'))}
            >
              {t('detail.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function LineRow({ line, property, editable, busy, fmtDay, onEdit, onDelete, onRemove, onRestore, onReceipt }: {
  line: VendorLine
  property: VendorProperty | null
  editable: boolean
  busy: boolean
  fmtDay: (iso: string | null) => string
  onEdit: () => void
  onDelete: () => void
  onRemove: () => void
  onRestore: () => void
  onReceipt: () => void
}) {
  const { t } = useLocale('vendorInvoicing')
  const d = line.detail
  const hourly = line.category === 'inspection' || line.category === 'labor'
  const title = hourly ? `${t(`category.${line.category}`)} · ${d.worker ?? ''}` : property?.name ?? t(`category.${line.category}`)
  const service = line.category === 'clean' ? (line.service_type ?? line.task_title) : line.service_type ?? t(`category.${line.category}`)

  return (
    <li className={`px-4 py-3 ${line.removed ? 'opacity-60' : ''}`} data-testid={`line-${line.id}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-medium ${line.removed ? 'line-through' : ''}`}>{title}</span>
            {line.category !== 'clean' && <StatusBadge tone="info">{t(`category.${line.category}`)}</StatusBadge>}
            {line.in_review && !line.removed && <StatusBadge tone="warning">{t('table.inReview')}</StatusBadge>}
            {line.removed && <StatusBadge tone="neutral">{line.removed_by === 'you' ? t('table.removedByYou') : t('table.removedByTendwell')}</StatusBadge>}
          </div>
          {property && (
            <p className="text-2xs text-muted-foreground mt-0.5">
              {[
                hourly ? property.name : null,
                property.address,
                property.bedrooms != null ? `${property.bedrooms} ${t('property.beds')}` : null,
                property.full_baths != null ? `${property.full_baths} ${t('property.baths')}` : null,
                property.guest_count != null ? `${property.guest_count} ${t('property.guests')}` : null,
                property.square_footage != null ? `${property.square_footage.toLocaleString()} ${t('property.sqft')}` : null,
                property.cleaner_pay != null ? `${t('property.cleanerPay')} ${money(property.cleaner_pay)}` : null,
                property.status,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className="text-sm mt-0.5">
            <span>{service}</span>
            <span className="text-muted-foreground"> · {line.date ? fmtDay(line.date) : t('table.noDate')}</span>
            {hourly && d.hours != null && d.rate != null && (
              <span className="text-muted-foreground"> · {t('table.hoursAt', { hours: d.hours, rate: money(d.rate) })}</span>
            )}
            {line.task_count > 1 && <span className="text-muted-foreground"> · {t('table.tasks', { count: line.task_count })}</span>}
          </p>
          {d.description && <p className="text-xs text-muted-foreground mt-0.5">{d.description}</p>}
          {d.requested_by && <p className="text-xs text-muted-foreground">{t('table.requestedBy', { who: d.requested_by })}</p>}
          {line.removed_reason && <p className="text-xs text-muted-foreground italic">“{line.removed_reason}”</p>}
          {line.notices.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {line.notices.map(n => <StatusBadge key={n} tone="warning" className="text-2xs">{t(`notice.${n}`, undefined, n)}</StatusBadge>)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="font-semibold tabular-nums mr-2">{money(line.amount)}</span>
          {d.has_receipt && (
            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onReceipt} title={t('table.receipt')} data-testid={`button-receipt-${line.id}`}>
              <Paperclip className="w-4 h-4" />
            </Button>
          )}
          {d.evidence_url && (
            <a className="text-xs text-primary underline px-1" href={d.evidence_url} target="_blank" rel="noopener noreferrer">{t('table.link')}</a>
          )}
          {editable && busy && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          {editable && !busy && line.editable && (
            <>
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onEdit} title={t('table.edit')} data-testid={`button-edit-${line.id}`}><Pencil className="w-4 h-4" /></Button>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive" onClick={onDelete} title={t('table.deleteItem')} data-testid={`button-delete-${line.id}`}><Trash2 className="w-4 h-4" /></Button>
            </>
          )}
          {editable && !busy && line.category === 'clean' && !line.removed && (
            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onRemove} title={t('table.remove')} data-testid={`button-remove-${line.id}`}><XCircle className="w-4 h-4" /></Button>
          )}
          {editable && !busy && line.category === 'clean' && line.removed && line.removed_by === 'you' && (
            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onRestore} title={t('table.restore')} data-testid={`button-restore-${line.id}`}><RotateCcw className="w-4 h-4" /></Button>
          )}
        </div>
      </div>
    </li>
  )
}

function RemoveDialog({ line, propertyName, dateLabel, onClose, onConfirm }: {
  line: VendorLine
  propertyName: string
  dateLabel: string
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const { t } = useLocale('vendorInvoicing')
  const [reason, setReason] = useState('')
  const ok = reason.trim().length >= 10
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md" data-testid={`dialog-remove-${line.id}`}>
        <DialogHeader>
          <DialogTitle>{t('remove.title')}</DialogTitle>
          <DialogDescription>{t('remove.body', { property: propertyName, date: dateLabel })}</DialogDescription>
        </DialogHeader>
        <div>
          <Label>{t('remove.reason')}</Label>
          <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder={t('remove.placeholder')} rows={3} maxLength={500} data-testid="input-remove-reason" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('item.cancel')}</Button>
          <Button variant="destructive" disabled={!ok} onClick={() => onConfirm(reason.trim())} data-testid="button-confirm-remove">{t('remove.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SubmitDialog({ run, lineCount, busy, onClose, onSubmit }: {
  run: VendorRun
  lineCount: number
  busy: boolean
  onClose: () => void
  onSubmit: (reference: string) => void
}) {
  const { t } = useLocale('vendorInvoicing')
  const [reference, setReference] = useState(run.vendor_reference ?? '')
  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-md" data-testid="dialog-submit">
        <DialogHeader>
          <DialogTitle>{t('detail.submitTitle')}</DialogTitle>
          <DialogDescription>{t('detail.submitBody', { total: money(run.total), count: lineCount })}</DialogDescription>
        </DialogHeader>
        <div>
          <Label>{t('detail.reference')}</Label>
          <Input value={reference} onChange={e => setReference(e.target.value)} placeholder={t('detail.referencePlaceholder')} maxLength={60} data-testid="input-vendor-reference" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('item.cancel')}</Button>
          <Button onClick={() => onSubmit(reference.trim())} disabled={busy} data-testid="button-confirm-submit">
            {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            {busy ? t('detail.submitting') : t('detail.submitConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
