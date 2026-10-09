import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, PauseCircle, PlayCircle, Send } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StatusBadge } from '@/components/StatusBadge'
import type { StatusTone } from '@/lib/status-colors'
import { invoicesApi, propertyOf, type InvoiceLine, type InvoiceRun } from '@/lib/invoices'
import {
  creditClientsByLine,
  groupBillComInvoices,
  isBillComArLine,
  isMissingSchemaError,
  lineClient,
  normalizeBillcomInvoiceNumber,
  normalizeHoldReason,
  runAllowsSendControl,
  stateMap,
  statusFor,
  type BillComGroup,
  type ClientInvoiceState,
  type ClientInvoiceStatus,
  type CreditClient,
} from '@shared/billcom-send'
import { MarkSentDialog } from './MarkSentDialog'

/**
 * bill.com send control on an approved run: one row per client invoice (a
 * client's bill.com lines for one service month), each held until someone
 * approves it. Only approved invoices go on the bill.com worksheet; once it
 * is entered in bill.com by hand, "Mark sent" records bill.com's invoice
 * number and takes it off the worksheet for good. Single lines can be held
 * back with a reason while the rest of that client's invoice goes out.
 *
 * Hidden entirely until migration 20261009c is applied (client_invoices
 * missing), and on runs that are not approved yet.
 */

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '-' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-'
const fmtMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return y && mo ? new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : m || '-'
}

const STATUS_TONE: Record<ClientInvoiceStatus, StatusTone> = { held: 'warning', approved: 'info', sent: 'success' }
const STATUS_LABEL: Record<ClientInvoiceStatus, string> = { held: 'Held', approved: 'Approved to send', sent: 'Sent' }

interface PropertyClient {
  id: number
  contact_id: string | null
  contacts: { full_name: string | null; company: string | null } | Array<{ full_name: string | null; company: string | null }> | null
}

type Prompt =
  | { kind: 'hold_invoice'; group: BillComGroup }
  | { kind: 'hold_line'; line: InvoiceLine }
  | { kind: 'mark_sent'; group: BillComGroup }

export function BillComSendPanel({ run, lines, onChanged }: {
  run: InvoiceRun
  lines: InvoiceLine[]
  onChanged: () => void
}) {
  const { toast } = useToast()
  const enabled = runAllowsSendControl(run.status)
  const billComLines = useMemo(
    () => lines.filter(l => isBillComArLine({
      lineKind: l.line_kind,
      reviewStatus: l.review_status,
      billingChannel: l.billing_channel,
      clientChargeAmount: l.client_charge_amount,
    })),
    [lines],
  )
  const propertyIds = useMemo(
    () => Array.from(new Set(billComLines.map(l => l.property_id).filter((id): id is number => id != null))).sort((a, b) => a - b),
    [billComLines],
  )

  // null = the table isn't there yet (migration pending): render nothing.
  const invoicesQuery = useQuery<ClientInvoiceState[] | null>({
    queryKey: ['invoicing-client-invoices', run.id],
    enabled: enabled && billComLines.length > 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_invoices')
        .select('contact_id, service_month, status, hold_reason, billcom_invoice_number, sent_at, sent_by, total')
        .eq('run_id', run.id)
        .eq('billing_channel', 'bill_com')
      if (error) {
        if (isMissingSchemaError(error)) return null
        throw error
      }
      return (data ?? []).map(r => ({
        contactId: r.contact_id,
        serviceMonth: r.service_month,
        status: r.status as ClientInvoiceStatus,
        holdReason: r.hold_reason,
        billcomInvoiceNumber: r.billcom_invoice_number,
        sentAt: r.sent_at,
        sentBy: r.sent_by,
        total: r.total,
      }))
    },
  })

  const clientsQuery = useQuery<PropertyClient[]>({
    queryKey: ['invoicing-property-clients', propertyIds],
    enabled: enabled && propertyIds.length > 0 && invoicesQuery.data != null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, contact_id, contacts:contact_id(full_name, company)')
        .in('id', propertyIds)
      if (error) throw error
      return (data ?? []) as unknown as PropertyClient[]
    },
  })

  // Client credits bill the client on their adjustment (usually no property),
  // so they join and net that client's invoice, same as the worksheet.
  const creditLineIds = useMemo(
    () => billComLines.filter(l => (l.flags ?? []).includes('credit')).map(l => l.id).sort(),
    [billComLines],
  )
  const creditsQuery = useQuery<Map<string, CreditClient>>({
    queryKey: ['invoicing-credit-clients', creditLineIds],
    enabled: enabled && creditLineIds.length > 0 && invoicesQuery.data != null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoice_adjustments')
        .select('applied_line_id, contact_id, contacts:contact_id(full_name, company)')
        .in('applied_line_id', creditLineIds)
      if (error) {
        if (isMissingSchemaError(error)) return new Map()
        throw error
      }
      return creditClientsByLine(data)
    },
  })

  const clientByProperty = useMemo(() => {
    const m = new Map<number, { contactId: string | null; name: string | null }>()
    for (const p of clientsQuery.data ?? []) {
      const c = Array.isArray(p.contacts) ? p.contacts[0] : p.contacts
      m.set(p.id, { contactId: p.contact_id, name: c?.full_name ?? c?.company ?? null })
    }
    return m
  }, [clientsQuery.data])

  const groups = useMemo(() => groupBillComInvoices(
    billComLines.map(l => {
      const prop = l.property_id != null ? clientByProperty.get(l.property_id) : undefined
      const client = lineClient({ id: l.id, propertyContactId: prop?.contactId, propertyClientName: prop?.name }, creditsQuery.data)
      return {
        lineNo: l.line_no,
        lineKind: l.line_kind,
        reviewStatus: l.review_status,
        billingChannel: l.billing_channel,
        clientChargeAmount: l.client_charge_amount,
        serviceDate: l.service_date ?? l.raw_date_mentioned,
        contactId: client.contactId,
        clientName: client.clientName,
        billHoldReason: l.bill_hold_reason ?? null,
      }
    }),
    run.invoice_date,
  ), [billComLines, clientByProperty, creditsQuery.data, run.invoice_date])

  const states = useMemo(() => stateMap(invoicesQuery.data ?? []), [invoicesQuery.data])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [promptText, setPromptText] = useState('')

  const actionMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => invoicesApi('billcom', { method: 'POST', body: { run_id: run.id, ...body } }),
    onSuccess: (_d, body) => {
      const titles: Record<string, string> = {
        hold_line: body.reason ? 'Line held from bill.com' : 'Line released',
        set_status: body.status === 'approved' ? 'Client invoice approved to send' : 'Client invoice held',
        mark_sent: 'Marked sent to bill.com',
      }
      toast({ title: titles[String(body.action)] ?? 'Saved' })
      setPrompt(null)
      setPromptText('')
      invoicesQuery.refetch()
      onChanged()
    },
    onError: (e: unknown) => toast({ title: 'bill.com update failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  })

  if (!enabled || billComLines.length === 0 || invoicesQuery.isLoading || invoicesQuery.data == null) return null

  const linesByNo = new Map<number, InvoiceLine[]>()
  for (const l of billComLines) linesByNo.set(l.line_no, [...(linesByNo.get(l.line_no) ?? []), l])
  const counts = { held: 0, approved: 0, sent: 0 }
  for (const g of groups) counts[statusFor(states, g.contactId, g.serviceMonth)] += 1

  // Mark sent has its own dialog (MarkSentDialog: pre-send check, recipient,
  // PDF fingerprint); this prompt only asks for hold reasons.
  const promptValue = normalizeHoldReason(promptText)
  const promptValid = prompt?.kind === 'hold_invoice' || !!promptValue
  function submitPrompt() {
    if (!prompt || !promptValid) return
    if (prompt.kind === 'hold_line') {
      actionMutation.mutate({ action: 'hold_line', line_no: prompt.line.line_no, reason: promptValue })
    } else if (prompt.kind === 'hold_invoice') {
      actionMutation.mutate({ action: 'set_status', contact_id: prompt.group.contactId, service_month: prompt.group.serviceMonth, status: 'held', hold_reason: promptValue })
    }
  }

  return (
    <Card className="border-card-border shadow-sm" data-testid="billcom-send-panel">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-medium">bill.com client invoices</p>
            <p className="text-xs text-muted-foreground">
              Only approved invoices appear on the bill.com manual-entry list. After entering one in bill.com, mark it sent with bill.com's invoice number.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-2xs">
            <StatusBadge tone="warning">{counts.held} held</StatusBadge>
            <StatusBadge tone="info">{counts.approved} to send</StatusBadge>
            <StatusBadge tone="success">{counts.sent} sent</StatusBadge>
          </div>
        </div>

        {clientsQuery.isLoading || creditsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading clients…</div>
        ) : (
          <div className="divide-y divide-border/60 rounded-xl border border-border/60">
            {groups.map(g => {
              const state = g.contactId ? states.get(g.key) : undefined
              const status = statusFor(states, g.contactId, g.serviceMonth)
              const isOpen = expanded.has(g.key)
              return (
                <div key={g.key} className="p-3 space-y-2" data-testid={`billcom-invoice-${g.key}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 min-w-0 text-left"
                      onClick={() => setExpanded(prev => {
                        const next = new Set(prev)
                        if (next.has(g.key)) next.delete(g.key)
                        else next.add(g.key)
                        return next
                      })}
                    >
                      {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                      <span className="font-medium truncate">{g.clientName ?? 'No client on the property'}</span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">· {fmtMonth(g.serviceMonth)} · {g.lineNos.length} line{g.lineNos.length === 1 ? '' : 's'}</span>
                    </button>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm tabular-nums font-medium">{fmtMoney(status === 'sent' && state?.total != null ? state.total : g.total)}</span>
                      <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>
                      {g.contactId && status === 'held' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={actionMutation.isPending || g.total <= 0}
                          title={g.total <= 0 ? 'Every line is held; release a line first' : 'Put this invoice on the bill.com manual-entry list'}
                          onClick={() => actionMutation.mutate({ action: 'set_status', contact_id: g.contactId, service_month: g.serviceMonth, status: 'approved' })}
                          data-testid={`button-billcom-approve-${g.key}`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Approve
                        </Button>
                      )}
                      {g.contactId && status === 'approved' && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            disabled={actionMutation.isPending}
                            onClick={() => { setPromptText(''); setPrompt({ kind: 'hold_invoice', group: g }) }}
                            data-testid={`button-billcom-hold-${g.key}`}
                          >
                            <PauseCircle className="w-3.5 h-3.5 mr-1.5" /> Hold
                          </Button>
                          <Button
                            size="sm"
                            className="h-7"
                            disabled={actionMutation.isPending}
                            onClick={() => { setPromptText(''); setPrompt({ kind: 'mark_sent', group: g }) }}
                            data-testid={`button-billcom-sent-${g.key}`}
                          >
                            <Send className="w-3.5 h-3.5 mr-1.5" /> Mark sent
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {!g.contactId && (
                    <p className="text-2xs text-destructive">These lines' property has no client, so they can't go to bill.com. Set the client on the property first.</p>
                  )}
                  {status === 'held' && state?.holdReason && (
                    <p className="text-2xs text-warning">Held: {state.holdReason}</p>
                  )}
                  {status === 'sent' && (
                    <p className="text-2xs text-muted-foreground">
                      bill.com invoice <span className="font-medium text-foreground">#{state?.billcomInvoiceNumber}</span>
                      {' · '}sent {fmtDateTime(state?.sentAt)}{state?.sentBy ? ` by ${state.sentBy}` : ''}
                    </p>
                  )}
                  {g.heldLineNos.length > 0 && (
                    <p className="text-2xs text-warning">
                      {g.heldLineNos.length} line{g.heldLineNos.length === 1 ? '' : 's'} held back ({fmtMoney(g.heldTotal)}), not on the bill.com list
                    </p>
                  )}

                  {isOpen && (
                    <ul className="text-xs space-y-1 pl-5">
                      {g.lineNos.map(no => {
                        const rows = linesByNo.get(no) ?? []
                        const base = rows.find(r => r.line_kind !== 'extra') ?? rows[0]
                        if (!base) return null
                        const charge = rows.reduce((a, r) => a + Number(r.client_charge_amount ?? 0), 0)
                        const hold = rows.map(r => r.bill_hold_reason).find(r => normalizeHoldReason(r)) ?? null
                        return (
                          <li key={no} className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="tabular-nums text-muted-foreground mr-1.5">#{no}</span>
                              <span>{propertyOf(base)?.name ?? base.raw_property_text ?? '-'}</span>
                              <span className="text-muted-foreground"> · {base.service_type ?? '-'} · {fmtMoney(charge)}</span>
                              {hold && <p className="text-2xs text-warning">Held from bill.com: {hold}</p>}
                            </div>
                            {status !== 'sent' && (
                              hold ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 shrink-0"
                                  disabled={actionMutation.isPending}
                                  onClick={() => actionMutation.mutate({ action: 'hold_line', line_no: no, reason: null })}
                                  data-testid={`button-billcom-release-line-${no}`}
                                >
                                  <PlayCircle className="w-3.5 h-3.5 mr-1" /> Release
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 shrink-0"
                                  disabled={actionMutation.isPending}
                                  onClick={() => { setPromptText(''); setPrompt({ kind: 'hold_line', line: base }) }}
                                  data-testid={`button-billcom-hold-line-${no}`}
                                >
                                  <PauseCircle className="w-3.5 h-3.5 mr-1" /> Hold line
                                </Button>
                              )
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={prompt != null && prompt.kind !== 'mark_sent'} onOpenChange={open => { if (!open) setPrompt(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {prompt?.kind === 'hold_line' ? `Hold line ${prompt.line.line_no}` : 'Hold this client invoice'}
            </DialogTitle>
            <DialogDescription>
              {prompt?.kind === 'hold_line'
                ? 'The line stays on the run but is left off the bill.com list until released. While it is held, its client invoice cannot be marked sent.'
                : 'It comes off the bill.com list until approved again. A reason is optional.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="billcom-prompt">Reason</Label>
            <Input
              id="billcom-prompt"
              autoFocus
              value={promptText}
              maxLength={500}
              placeholder="e.g. Client disputes the trip fee"
              onChange={e => setPromptText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitPrompt() }}
              data-testid="input-billcom-prompt"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrompt(null)}>Cancel</Button>
            <Button onClick={submitPrompt} disabled={!promptValid || actionMutation.isPending} data-testid="button-billcom-prompt-submit">
              {actionMutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MarkSentDialog
        run={run}
        group={prompt?.kind === 'mark_sent' ? prompt.group : null}
        onClose={() => setPrompt(null)}
        onSent={() => { invoicesQuery.refetch(); onChanged() }}
      />
    </Card>
  )
}
