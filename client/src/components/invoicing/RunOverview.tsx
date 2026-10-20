import { Fragment, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  EXPORT_FORMATS,
  propertyOf,
  vendorNameOf,
  type ExportFormat,
  type InvoiceLine,
  type InvoiceRun,
} from '@/lib/invoices'
import { isArLine, serviceMonth, summarizeRunOutputs, type OutputLine } from '@shared/invoice-outputs'

/**
 * The top of an invoice run: where it is in Review → Approve → Export → Send,
 * and what it turns into once approved, month by month (Haven's QuickBooks
 * invoice, client invoices, the vendor's Ramp bill). A run that crosses a
 * month becomes one invoice and one bill per month; this card is where that
 * is visible before anything is downloaded. Same rules as the export files
 * (shared/invoice-outputs.ts).
 */

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '-' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return y && mo ? new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : m
}
const fmtDay = (d: string | null | undefined) => {
  if (!d) return '-'
  const [y, mo, da] = d.slice(0, 10).split('-').map(Number)
  return new Date(y, mo - 1, da).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function toOutputLine(l: InvoiceLine): OutputLine {
  return {
    lineKind: l.line_kind,
    reviewStatus: l.review_status,
    billingChannel: l.billing_channel,
    cleanerPayAmount: l.cleaner_pay_amount != null ? Number(l.cleaner_pay_amount) : null,
    clientChargeAmount: l.client_charge_amount != null ? Number(l.client_charge_amount) : null,
    serviceDate: l.service_date ?? l.raw_date_mentioned,
  }
}

export interface ClientInvoiceCounts {
  held: number
  approved: number
  sent: number
}

type StepState = 'done' | 'current' | 'todo'

export function RunStepper({ run, needsReview, issues, clientInvoices }: {
  run: InvoiceRun
  needsReview: number
  issues: number
  /** null = the run has no bill.com / QuickBooks client invoices panel. */
  clientInvoices: ClientInvoiceCounts | null
}) {
  const approved = run.status === 'approved' || run.status === 'exported'
  const exported = run.status === 'exported'
  const totalClient = clientInvoices ? clientInvoices.held + clientInvoices.approved + clientInvoices.sent : 0
  const noClientInvoices = clientInvoices == null || totalClient === 0
  const allSent = !noClientInvoices && clientInvoices!.sent === totalClient

  const reviewDone = approved || (run.status !== 'draft' && needsReview === 0 && issues === 0)
  const steps: Array<{ label: string; detail: string; state: StepState }> = [
    {
      label: 'Review',
      detail: run.status === 'draft'
        ? 'The vendor is still writing this invoice'
        : reviewDone
          ? 'All lines reviewed'
          : `${needsReview} line${needsReview === 1 ? '' : 's'} need review${issues > needsReview ? `, ${issues} with issues` : ''}`,
      state: reviewDone ? 'done' : run.status === 'draft' ? 'todo' : 'current',
    },
    {
      label: 'Approve',
      detail: approved
        ? `Approved${run.approved_by ? ` by ${run.approved_by}` : ''}${run.approved_at ? ` on ${fmtDay(run.approved_at)}` : ''}`
        : reviewDone ? 'Ready to approve' : 'After review',
      state: approved ? 'done' : reviewDone ? 'current' : 'todo',
    },
    {
      label: 'Export',
      detail: exported ? 'Files downloaded for Ramp and QuickBooks' : approved ? 'Download the files below' : 'After approval',
      state: exported ? 'done' : approved ? 'current' : 'todo',
    },
    {
      label: 'Send to clients',
      detail: !approved
        ? 'After approval'
        : noClientInvoices
          ? 'Haven is billed by the QuickBooks import'
          : `${clientInvoices!.sent} of ${totalClient} client invoice${totalClient === 1 ? '' : 's'} sent`,
      state: !approved ? 'todo' : allSent || (noClientInvoices && exported) ? 'done' : noClientInvoices ? 'todo' : 'current',
    },
  ]

  return (
    <ol className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="run-stepper">
      {steps.map((s, i) => (
        <li
          key={s.label}
          className={cn(
            'rounded-xl border px-3 py-2.5 flex items-start gap-2.5',
            s.state === 'done' && 'border-success/30 bg-success/5',
            s.state === 'current' && 'border-primary/40 bg-primary/5',
            s.state === 'todo' && 'border-border/60 bg-muted/20',
          )}
          aria-current={s.state === 'current' ? 'step' : undefined}
        >
          {s.state === 'done'
            ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-success" />
            : <Circle className={cn('w-4 h-4 mt-0.5 shrink-0', s.state === 'current' ? 'text-primary' : 'text-muted-foreground/50')} />}
          <div className="min-w-0">
            <p className={cn('text-sm font-medium', s.state === 'todo' && 'text-muted-foreground')}>
              <span className="text-muted-foreground tabular-nums mr-1">{i + 1}.</span>{s.label}
            </p>
            <p className="text-xs text-muted-foreground">{s.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function RunOutputsCard({ run, lines, showDownloads, downloadingFormat, onDownload }: {
  run: InvoiceRun
  lines: InvoiceLine[]
  showDownloads: boolean
  downloadingFormat: ExportFormat | null
  onDownload: (format: ExportFormat) => void
}) {
  const outputs = useMemo(
    () => summarizeRunOutputs(lines.map(toOutputLine), {
      invoiceDate: run.invoice_date,
      vendorInvoiceNumber: run.invoice_number,
      qboInvoiceNo: run.qbo_invoice_no,
      qboInvoiceNos: run.qbo_invoice_nos ?? null,
    }),
    [lines, run.invoice_date, run.invoice_number, run.qbo_invoice_no, run.qbo_invoice_nos],
  )
  const [open, setOpen] = useState<string | null>(null)
  const havenLinesFor = (month: string) =>
    lines
      .filter(l => {
        const o = toOutputLine(l)
        return isArLine(o, 'qbo_haven') && serviceMonth(o, run.invoice_date) === month
      })
      .sort((a, b) =>
        (a.service_date ?? a.raw_date_mentioned ?? '').localeCompare(b.service_date ?? b.raw_date_mentioned ?? '') || a.line_no - b.line_no)

  if (outputs.months.length === 0) return null

  const vendor = vendorNameOf(run)
  const showBillCom = outputs.months.some(m => m.billCom.lines > 0)
  const showQboClient = outputs.months.some(m => m.qboClient.lines > 0)
  const unrouted = outputs.months.reduce((n, m) => n + m.unrouted.lines, 0)
  const colCount = 3 + (showBillCom ? 1 : 0) + (showQboClient ? 1 : 0)
  const havenCount = outputs.months.filter(m => m.haven.lines > 0).length
  const rampCount = outputs.months.filter(m => m.ramp.lines > 0).length
  const lastMonth = fmtMonth(outputs.months[outputs.months.length - 1].month).split(' ')[0]

  return (
    <Card className="border-card-border shadow-sm" data-testid="run-outputs">
      <CardContent className="p-4 space-y-3">
        <div>
          <p className="text-sm font-medium">What this run creates</p>
          <p className="text-xs text-muted-foreground">
            {outputs.splitsHaven || outputs.splitsRamp
              ? `This run crosses into ${lastMonth}, so it becomes ${havenCount === 1 ? 'one Haven invoice' : `${havenCount} Haven invoices`} and ${rampCount === 1 ? 'one Ramp bill' : `${rampCount} Ramp bills`}, each dated in its own month so revenue and cleaner pay land in the month the work was done.`
              : "One month of work: one Haven QuickBooks invoice and one Ramp bill for the vendor's pay."}
          </p>
        </div>

        <div className="rounded-xl border border-border/60 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Month</th>
                <th className="px-3 py-2 font-medium">Haven (QuickBooks import)</th>
                {showBillCom && <th className="px-3 py-2 font-medium">bill.com clients</th>}
                {showQboClient && <th className="px-3 py-2 font-medium">QuickBooks clients</th>}
                <th className="px-3 py-2 font-medium">{vendor} pay (Ramp bill)</th>
              </tr>
            </thead>
            <tbody>
              {outputs.months.map(m => {
                const isOpen = open === m.month
                return (
                  <Fragment key={m.month}>
                    <tr className="border-t border-border/60 align-top">
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <p className="font-medium">{fmtMonth(m.month)}</p>
                        <p className="text-2xs text-muted-foreground">dated {fmtDay(m.documentDate)}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        {m.haven.lines === 0 ? <span className="text-muted-foreground">None</span> : (
                          <button
                            type="button"
                            className="text-left group"
                            onClick={() => setOpen(isOpen ? null : m.month)}
                            aria-expanded={isOpen}
                            data-testid={`run-outputs-haven-${m.month}`}
                          >
                            <p className="font-medium tabular-nums flex items-center gap-1">
                              {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              {fmtMoney(m.haven.total)}
                            </p>
                            <p className="text-2xs text-muted-foreground group-hover:text-foreground">
                              {m.haven.invoiceNo != null ? `Invoice #${m.haven.invoiceNo}` : 'Numbered on the first QuickBooks export'} · {m.haven.lines} line{m.haven.lines === 1 ? '' : 's'}
                            </p>
                          </button>
                        )}
                      </td>
                      {showBillCom && (
                        <td className="px-3 py-2.5 tabular-nums">
                          {m.billCom.lines === 0 ? <span className="text-muted-foreground">None</span> : <>
                            <p className="font-medium">{fmtMoney(m.billCom.total)}</p>
                            <p className="text-2xs text-muted-foreground">{m.billCom.lines} line{m.billCom.lines === 1 ? '' : 's'}, one invoice per client</p>
                          </>}
                        </td>
                      )}
                      {showQboClient && (
                        <td className="px-3 py-2.5 tabular-nums">
                          {m.qboClient.lines === 0 ? <span className="text-muted-foreground">None</span> : <>
                            <p className="font-medium">{fmtMoney(m.qboClient.total)}</p>
                            <p className="text-2xs text-muted-foreground">{m.qboClient.lines} line{m.qboClient.lines === 1 ? '' : 's'}, created by hand in QuickBooks</p>
                          </>}
                        </td>
                      )}
                      <td className="px-3 py-2.5 tabular-nums">
                        {m.ramp.lines === 0 ? <span className="text-muted-foreground">None</span> : <>
                          <p className="font-medium">{fmtMoney(m.ramp.total)}</p>
                          <p className="text-2xs text-muted-foreground">{m.ramp.billNumber ? `Bill ${m.ramp.billNumber}` : 'Bill'} · {m.ramp.lines} line{m.ramp.lines === 1 ? '' : 's'}</p>
                        </>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-muted/20">
                        <td colSpan={colCount} className="px-3 py-2">
                          <div className="max-h-80 overflow-y-auto">
                            <table className="w-full text-xs">
                              <tbody>
                                {havenLinesFor(m.month).map(l => (
                                  <tr key={l.id} className="border-t border-border/40 first:border-t-0">
                                    <td className="py-1 pr-3 whitespace-nowrap text-muted-foreground">{fmtDay(l.service_date ?? l.raw_date_mentioned)}</td>
                                    <td className="py-1 pr-3 truncate max-w-64">{propertyOf(l)?.name ?? l.raw_property_text ?? '-'}</td>
                                    <td className="py-1 pr-3 truncate max-w-48 text-muted-foreground">{l.service_type ?? '-'}</td>
                                    <td className="py-1 text-right tabular-nums">{fmtMoney(l.client_charge_amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {unrouted > 0 && (
          <p className="text-xs text-warning">
            {unrouted} billable line{unrouted === 1 ? ' has' : 's have'} no billing channel and will not reach any client invoice. Filter the lines by Issues to fix {unrouted === 1 ? 'it' : 'them'}.
          </p>
        )}

        {showDownloads && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs font-medium text-muted-foreground mr-1">Download</span>
            {EXPORT_FORMATS.map(f => (
              <Button
                key={f.id}
                size="sm"
                variant="outline"
                onClick={() => onDownload(f.id)}
                disabled={downloadingFormat === f.id}
                data-testid={`button-export-${f.id}`}
              >
                {downloadingFormat === f.id ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}
                {f.label}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
