// Client invoices tab: AR follow-up across every run in one place.
//
//   1. To send: client invoices on approved / exported runs that are not yet
//      marked sent (held or approved). Read-only here; a row opens its run,
//      where the send panel does the approving, holding and marking sent.
//   2. Sent invoices: the append-only register, with search and a month filter.
//
// Either half is hidden on its own when its table is missing (migration not
// applied): the page shows whatever exists.

import { useMemo } from 'react'
import { Inbox, Send } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { cn } from '@/lib/utils'
import type { StatusTone } from '@/lib/status-colors'
import { vendorNameOf, type InvoiceRun } from '@/lib/invoices'
import { monthLong, type ClientInvoiceRow } from '@/lib/invoicing-overview'
import { channelLabel, type ClientInvoiceStatus } from '@shared/billcom-send'
import { SentInvoicesRegister, useSentInvoicesRegister } from './SentInvoicesRegister'
import { BillComCustomersCard } from './BillComCustomersCard'
import type { useInvoicingOverview } from './useInvoicingOverview'

type Overview = ReturnType<typeof useInvoicingOverview>

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '-' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
function fmtDay(d: string | null | undefined, withYear: boolean): string {
  if (!d) return '-'
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' })
}

const STATUS_TONE: Record<ClientInvoiceStatus, StatusTone> = { held: 'warning', approved: 'info', sent: 'success' }
const STATUS_LABEL: Record<ClientInvoiceStatus, string> = { held: 'Held', approved: 'Approved to send', sent: 'Sent' }

export function ClientInvoicesTab({ runs, overview, onOpenRun }: {
  runs: InvoiceRun[]
  overview: Overview
  onOpenRun: (runId: string) => void
}) {
  const register = useSentInvoicesRegister()
  const registerAvailable = register.data != null
  const registerSettled = !register.isLoading
  const runById = useMemo(() => new Map(runs.map(r => [r.id, r])), [runs])

  const sendAvailable = overview.data?.sendAvailable ?? true
  const toSend = overview.data?.toSend ?? []
  const nothingSetUp = overview.data != null && !sendAvailable && registerSettled && !registerAvailable

  if (nothingSetUp) {
    return (
      <EmptyState
        icon={Inbox}
        title="Client invoice tracking is not set up yet"
        description="Sending and the sent register need their database migrations applied. Until then, client invoices are handled from each approved run."
      />
    )
  }

  return (
    <div className="space-y-6" data-testid="client-invoices-tab">
      <BillComCustomersCard />
      {(sendAvailable || overview.isLoading) && (
        <section className="space-y-2" data-testid="client-invoices-to-send">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-sm font-semibold">To send</h2>
            {overview.data && <span className="text-xs text-muted-foreground tabular-nums">{toSend.length}</span>}
            <span className="text-xs text-muted-foreground">
              Approved runs only. Open a row to approve, hold or mark the invoice sent.
            </span>
          </div>
          {overview.isError ? (
            <ErrorState title="Couldn't load client invoices" onRetry={() => overview.refetch()} />
          ) : overview.isLoading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : toSend.length === 0 ? (
            <EmptyState
              icon={Send}
              title="Nothing waiting to be sent"
              description="Every client invoice on an approved run has been marked sent."
            />
          ) : (
            <ToSendList rows={toSend} runById={runById} onOpenRun={onOpenRun} />
          )}
        </section>
      )}

      {registerAvailable ? (
        <section className="space-y-2" data-testid="client-invoices-sent">
          <h2 className="text-sm font-semibold">Sent invoices</h2>
          <SentInvoicesRegister />
        </section>
      ) : registerSettled ? (
        <p className="text-xs text-muted-foreground" data-testid="sent-register-missing">
          The sent invoices register is not set up yet, so past invoices are not listed here.
        </p>
      ) : null}
    </div>
  )
}

function runLabel(run: InvoiceRun | undefined): { title: string; sub: string } {
  if (!run) return { title: 'Run no longer in the list', sub: '' }
  const period = `${fmtDay(run.period_start, false)} to ${fmtDay(run.period_end, true)}`
  return {
    title: `${vendorNameOf(run)}${run.invoice_number ? ` #${run.invoice_number}` : ''}`,
    sub: period,
  }
}

function ToSendList({ rows, runById, onOpenRun }: {
  rows: ClientInvoiceRow[]
  runById: Map<string, InvoiceRun>
  onOpenRun: (runId: string) => void
}) {
  return (
    <>
      <div className="hidden md:block rounded-2xl border border-card-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Service month</th>
                <th className="px-3 py-2 font-medium">Channel</th>
                <th className="px-3 py-2 font-medium text-right">Total</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Run</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const run = runById.get(r.runId)
                const label = runLabel(run)
                return (
                  <tr
                    key={`${r.runId}|${r.key}`}
                    className="border-t border-border/60 hover:bg-muted/30 cursor-pointer"
                    onClick={() => onOpenRun(r.runId)}
                    data-testid={`row-to-send-${r.runId}-${r.key}`}
                  >
                    <td className="px-3 py-2 max-w-56">
                      <p className={cn('truncate font-medium', !r.clientName && 'text-muted-foreground italic font-normal')}>{r.clientName ?? 'No client set'}</p>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{monthLong(r.serviceMonth)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{channelLabel(r.channel)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.total)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
                      {r.status === 'held' && r.holdReason && (
                        <p className="text-2xs text-muted-foreground mt-0.5 max-w-48 truncate" title={r.holdReason}>{r.holdReason}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <p className="truncate max-w-56">{label.title}</p>
                      {label.sub && <p className="text-2xs text-muted-foreground">{label.sub}</p>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="md:hidden space-y-2">
        {rows.map(r => {
          const label = runLabel(runById.get(r.runId))
          return (
            <Card
              key={`${r.runId}|${r.key}`}
              className="border-card-border active:bg-muted/40 transition-colors cursor-pointer"
              onClick={() => onOpenRun(r.runId)}
              data-testid={`card-to-send-${r.runId}-${r.key}`}
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.clientName ?? 'No client set'}</p>
                    <p className="text-xs text-muted-foreground">{monthLong(r.serviceMonth)} · {channelLabel(r.channel)}</p>
                  </div>
                  <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
                </div>
                <div className="flex items-center justify-between gap-2 mt-2 text-xs text-muted-foreground">
                  <span className="truncate">{label.title}{label.sub ? ` · ${label.sub}` : ''}</span>
                  <span className="tabular-nums text-foreground">{fmtMoney(r.total)}</span>
                </div>
                {r.status === 'held' && r.holdReason && <p className="text-2xs text-muted-foreground mt-1">{r.holdReason}</p>}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </>
  )
}
