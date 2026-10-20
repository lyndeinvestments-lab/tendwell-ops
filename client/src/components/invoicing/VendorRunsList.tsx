// Vendor invoices tab: the list of vendor invoice runs, split into what needs
// you and what is done. The per-run numbers (lines to review, vendor pay,
// client total, client invoices sent) come from useInvoicingOverview, one
// aggregate load; if that fails the table falls back to the plain Stated /
// Computed columns so the list always works.

import { useMemo } from 'react'
import { AlertTriangle, Archive, ArchiveRestore, CheckCircle2, Receipt, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { cn } from '@/lib/utils'
import { vendorNameOf, type InvoiceRun } from '@/lib/invoices'
import { formatQboNumbers, groupRuns, runStatusTone, type RunGroup } from '@/lib/invoicing-overview'
import { runAllowsSendControl } from '@shared/billcom-send'
import type { useInvoicingOverview } from './useInvoicingOverview'

type Overview = ReturnType<typeof useInvoicingOverview>

const fmtMoney = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) ? '-' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function parseDay(d: string): Date | null {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return y && m && day ? new Date(y, m - 1, day) : null
}
function fmtShort(d: string | null | undefined): string {
  const dt = d ? parseDay(d) : null
  return dt ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'
}
function fmtFull(d: string | null | undefined): string {
  const dt = d ? parseDay(d) : null
  return dt ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'
}
function weekLabel(run: Pick<InvoiceRun, 'period_start' | 'period_end'>): string {
  return `${fmtShort(run.period_start)} to ${fmtFull(run.period_end)}`
}

function SourceBadge({ source }: { source: InvoiceRun['source'] }) {
  if (source === 'vendor_portal') return <StatusBadge tone="info">Vendor portal</StatusBadge>
  if (source === 'vendor_csv') return <StatusBadge tone="neutral">CSV</StatusBadge>
  return null
}

const GROUP_COPY: Record<RunGroup, { title: string; hint: string }> = {
  needs_you: { title: 'Needs you', hint: 'To review or approve, or approved with client invoices still to send.' },
  writing: { title: 'Vendor still writing', hint: 'Drafts the vendor is still working on. Nothing to do yet.' },
  done: { title: 'Done', hint: 'Approved with every client invoice sent, or void.' },
}

export function VendorRunsList({
  runs, loading, error, onRetry, overview, archivedCount, showArchived, onToggleArchived, onArchive, onOpen, onGenerate,
}: {
  runs: InvoiceRun[]
  loading: boolean
  error: boolean
  onRetry: () => void
  overview: Overview
  archivedCount: number
  showArchived: boolean
  onToggleArchived: () => void
  onArchive: (id: string, archive: boolean) => void
  onOpen: (id: string) => void
  onGenerate: () => void
}) {
  const stats = useMemo(() => {
    const needsReview = runs.filter(r => r.status === 'review_needed').length
    const now = new Date()
    const approvedThisMonth = runs.filter(r => {
      if (r.status !== 'approved' && r.status !== 'exported') return false
      if (!r.approved_at) return false
      const d = new Date(r.approved_at)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    }).length
    return { needsReview, approvedThisMonth }
  }, [runs])

  const groups = useMemo(() => groupRuns(runs, overview.unsentByRun), [runs, overview.unsentByRun])
  // When the aggregate load fails, show the plain columns instead.
  const degraded = overview.isError
  const numbersLoading = overview.isLoading && !degraded

  const toSend = overview.data?.toSend ?? []
  const sendAvailable = overview.data?.sendAvailable ?? true
  const toSendApproved = toSend.filter(r => r.status === 'approved').length
  const toSendHeld = toSend.length - toSendApproved

  const sections: Array<{ id: RunGroup; runs: InvoiceRun[] }> = [
    { id: 'needs_you', runs: groups.needsYou },
    { id: 'writing', runs: groups.writing },
    { id: 'done', runs: groups.done },
  ]

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          title="Runs needing review"
          value={stats.needsReview}
          icon={AlertTriangle}
          tone={stats.needsReview > 0 ? 'warning' : 'success'}
          loading={loading}
          testId="stat-needs-review"
        />
        <StatCard
          title="Approved this month"
          value={stats.approvedThisMonth}
          icon={CheckCircle2}
          tone="success"
          loading={loading}
          testId="stat-approved-month"
        />
        <StatCard
          title="Client invoices to send"
          value={overview.data && sendAvailable ? toSend.length : '-'}
          subtitle={overview.data && sendAvailable
            ? (toSend.length > 0 ? `${toSendApproved} approved, ${toSendHeld} held` : 'Everything approved has gone out')
            : (overview.data ? 'Send tracking is not set up yet' : undefined)}
          icon={Send}
          tone={overview.data && sendAvailable && toSend.length > 0 ? 'warning' : 'success'}
          loading={loading || numbersLoading}
          testId="stat-client-invoices-to-send"
        />
      </div>

      {(archivedCount > 0 || showArchived) && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" className="h-7 px-2.5 text-muted-foreground" onClick={onToggleArchived} data-testid="button-toggle-archived">
            <Archive className="w-3.5 h-3.5 mr-1.5" />
            {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
          </Button>
        </div>
      )}

      {error ? (
        <ErrorState title="Couldn't load invoice runs" onRetry={onRetry} />
      ) : loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : runs.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No invoice runs yet"
          description="Generate a draft from Trellis/Breezeway tasks or upload a vendor CSV to get started."
          action={{ label: 'Generate draft', onClick: onGenerate }}
        />
      ) : (
        <div className="space-y-5">
          {sections.filter(s => s.runs.length > 0 || s.id === 'needs_you').map(s => (
            <section key={s.id} className={cn('space-y-2', s.id === 'writing' && 'opacity-70')} data-testid={`runs-group-${s.id}`}>
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2 className="text-sm font-semibold">{GROUP_COPY[s.id].title}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">{s.runs.length}</span>
                <span className="text-xs text-muted-foreground">{GROUP_COPY[s.id].hint}</span>
              </div>
              {s.runs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-card-border px-3 py-4 text-sm text-muted-foreground" data-testid="runs-nothing-needs-you">
                  Nothing needs you right now.
                </p>
              ) : (
                <RunsTable
                  runs={s.runs}
                  overview={overview}
                  degraded={degraded}
                  numbersLoading={numbersLoading}
                  onOpen={onOpen}
                  onArchive={onArchive}
                />
              )}
            </section>
          ))}
        </div>
      )}
    </>
  )
}

function statsOf(overview: Overview, runId: string) {
  return overview.data?.statsByRun.get(runId) ?? null
}

/** "12 of 14" for an approved / exported run, "-" otherwise. */
function sentProgressCell(run: InvoiceRun, overview: Overview, loading: boolean): React.ReactNode {
  if (!runAllowsSendControl(run.status)) return <span className="text-muted-foreground">-</span>
  if (loading) return <Skeleton className="h-4 w-14 ml-auto inline-block" />
  const p = overview.progressByRun.get(run.id)
  if (!p || !overview.data?.sendAvailable) return <span className="text-muted-foreground">-</span>
  if (p.total === 0) return <span className="text-muted-foreground">None</span>
  return (
    <span className={cn(p.sent < p.total ? 'text-warning font-medium' : 'text-success')}>
      {p.sent} of {p.total}
    </span>
  )
}

function RunsTable({ runs, overview, degraded, numbersLoading, onOpen, onArchive }: {
  runs: InvoiceRun[]
  overview: Overview
  degraded: boolean
  numbersLoading: boolean
  onOpen: (id: string) => void
  onArchive: (id: string, archive: boolean) => void
}) {
  const cell = (run: InvoiceRun, node: (stats: NonNullable<ReturnType<typeof statsOf>>) => React.ReactNode) => {
    if (numbersLoading) return <Skeleton className="h-4 w-14 ml-auto" />
    const s = statsOf(overview, run.id)
    return s ? node(s) : <span className="text-muted-foreground">-</span>
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block rounded-2xl border border-card-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Week</th>
                <th className="px-3 py-2 font-medium">Vendor</th>
                <th className="px-3 py-2 font-medium">Status</th>
                {degraded ? (
                  <>
                    <th className="px-3 py-2 font-medium">Invoice #</th>
                    <th className="px-3 py-2 font-medium text-right">Stated</th>
                    <th className="px-3 py-2 font-medium text-right">Computed</th>
                  </>
                ) : (
                  <>
                    <th className="px-3 py-2 font-medium text-right">To review</th>
                    <th className="px-3 py-2 font-medium text-right">Vendor pay</th>
                    <th className="px-3 py-2 font-medium text-right">Client total</th>
                  </>
                )}
                <th className="px-3 py-2 font-medium">QuickBooks #</th>
                {!degraded && <th className="px-3 py-2 font-medium text-right">Client invoices sent</th>}
                <th className="px-3 py-2 font-medium w-12" />
              </tr>
            </thead>
            <tbody>
              {runs.map(run => {
                const qbo = formatQboNumbers(run.qbo_invoice_nos, run.qbo_invoice_no)
                return (
                  <tr
                    key={run.id}
                    className={cn('border-t border-border/60 hover:bg-muted/30 cursor-pointer', run.archived_at && 'opacity-50')}
                    onClick={() => onOpen(run.id)}
                    data-testid={`row-run-${run.id}`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      <p>{weekLabel(run)}</p>
                      {run.invoice_number && <p className="text-2xs text-muted-foreground">#{run.invoice_number}</p>}
                    </td>
                    <td className="px-3 py-2 max-w-56">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-medium truncate">{vendorNameOf(run)}</span>
                        <SourceBadge source={run.source} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={runStatusTone(run.status)}>{run.status.replace(/_/g, ' ')}</StatusBadge>
                    </td>
                    {degraded ? (
                      <>
                        <td className="px-3 py-2 text-muted-foreground">{run.invoice_number ?? '-'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(run.stated_subtotal)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(run.computed_subtotal)}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {cell(run, s => s.needsReview > 0
                            ? <StatusBadge tone="warning">{s.needsReview}</StatusBadge>
                            : <span className="text-muted-foreground">-</span>)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{cell(run, s => fmtMoney(s.vendorPay))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{cell(run, s => fmtMoney(s.clientTotal))}</td>
                      </>
                    )}
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{qbo ?? <span className="text-muted-foreground">-</span>}</td>
                    {!degraded && (
                      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums" data-testid={`sent-progress-${run.id}`}>
                        {sentProgressCell(run, overview, numbersLoading)}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-muted-foreground"
                        onClick={(e) => { e.stopPropagation(); onArchive(run.id, !run.archived_at) }}
                        title={run.archived_at ? 'Restore run' : 'Archive run (hides from this list)'}
                        data-testid={`button-archive-${run.id}`}
                      >
                        {run.archived_at ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {runs.map(run => {
          const s = statsOf(overview, run.id)
          const qbo = formatQboNumbers(run.qbo_invoice_nos, run.qbo_invoice_no)
          return (
            <Card
              key={run.id}
              className={cn('border-card-border active:bg-muted/40 transition-colors cursor-pointer', run.archived_at && 'opacity-60')}
              onClick={() => onOpen(run.id)}
              data-testid={`card-run-${run.id}`}
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm font-medium truncate">{vendorNameOf(run)}</p>
                      <SourceBadge source={run.source} />
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {weekLabel(run)}{run.invoice_number ? ` · #${run.invoice_number}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <StatusBadge tone={runStatusTone(run.status)}>{run.status.replace(/_/g, ' ')}</StatusBadge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-1.5 text-muted-foreground"
                      onClick={(e) => { e.stopPropagation(); onArchive(run.id, !run.archived_at) }}
                      aria-label={run.archived_at ? 'Restore run' : 'Archive run'}
                    >
                      {run.archived_at ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>
                {degraded ? (
                  <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground tabular-nums">
                    <span>Stated {fmtMoney(run.stated_subtotal)}</span>
                    <span>Computed {fmtMoney(run.computed_subtotal)}</span>
                  </div>
                ) : (
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
                    <span>Vendor pay {s ? fmtMoney(s.vendorPay) : '-'}</span>
                    <span className="text-right">Client total {s ? fmtMoney(s.clientTotal) : '-'}</span>
                    <span>To review {s ? s.needsReview : '-'}</span>
                    <span className="text-right">Sent {sentProgressCell(run, overview, numbersLoading)}</span>
                    {qbo && <span className="col-span-2">QuickBooks {qbo}</span>}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </>
  )
}
