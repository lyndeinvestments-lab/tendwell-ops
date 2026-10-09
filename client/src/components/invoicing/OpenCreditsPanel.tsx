// Open credits owed to clients (invoice_adjustments).
//
// A credit is money Tendwell owes a client back: a refund for a bad clean, a
// goodwill discount, an overcharge on an earlier invoice. It is recorded here
// once and stays OPEN until the client's next run is approved, when
// api/invoices/approve.ts puts it on that invoice as a negative "Credit" line
// (capped so the invoice never goes below zero; any rest stays open here).
// Applied credits are visible on the run they landed on.
//
// Client money: the table is finance-only in the database (the `invoicing`
// grant plus can_view_financials(), migration 20261009a), and the browser can
// only add an open credit or void one. Until that migration is applied the
// panel says so instead of failing.

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { ErrorState } from '@/components/ErrorState'
import { SearchSelect } from '@/components/issues/SearchSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Ban, ExternalLink, Loader2, Plus, Undo2 } from 'lucide-react'

// invoice_adjustments is in shared/database.types.ts, but the embedded joins
// below are easier to read untyped (same as TaskAudit).
const db = supabase as any

const CREDITS_KEY = ['invoicing', 'credits', 'open'] as const

interface ContactLite {
  id: string
  full_name: string | null
  company: string | null
}

interface OpenCredit {
  id: string
  contact_id: string | null // null: client permanently deleted
  amount: number | string
  reason: string
  evidence_url: string | null
  original_line_id: string | null
  parent_adjustment_id: string | null
  created_by: string | null
  created_at: string
  contacts: ContactLite | ContactLite[] | null
}

interface OriginalLineOption {
  id: string
  line_no: number
  service_type: string | null
  service_date: string | null
  raw_date_mentioned: string | null
  client_charge_amount: number | string | null
  properties: { name: string | null } | Array<{ name: string | null }> | null
  invoice_runs: { qbo_invoice_no: number | null; invoice_number: string | null } | Array<{ qbo_invoice_no: number | null; invoice_number: string | null }> | null
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

function clientName(c: { full_name: string | null; company: string | null } | null | undefined): string {
  return c?.company?.trim() || c?.full_name?.trim() || 'Unnamed client'
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return ''
  const dt = new Date(d.length === 10 ? `${d}T12:00:00` : d)
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function isHttpUrl(v: string): boolean {
  return /^https?:\/\/\S+$/i.test(v.trim())
}

/** The table (or a column) is not there yet: migration 20261009a is not applied. */
function isMissingTable(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(e.code ?? '') ||
    /does not exist|could not find the table|schema cache/i.test(e.message ?? '')
}

class MissingTableError extends Error {}

export function OpenCreditsPanel({ userLabel }: { userLabel: string }) {
  const [adding, setAdding] = useState(false)
  const [voiding, setVoiding] = useState<OpenCredit | null>(null)

  const creditsQuery = useQuery<OpenCredit[]>({
    queryKey: CREDITS_KEY,
    queryFn: async () => {
      const { data, error } = await db
        .from('invoice_adjustments')
        .select('id, contact_id, amount, reason, evidence_url, original_line_id, parent_adjustment_id, created_by, created_at, contacts:contact_id(id, full_name, company)')
        .eq('status', 'open')
        .order('created_at')
        .range(0, 999)
      if (error) {
        if (isMissingTable(error)) throw new MissingTableError(error.message)
        throw new Error(error.message)
      }
      return (data ?? []) as OpenCredit[]
    },
    retry: (count, err) => !(err instanceof MissingTableError) && count < 2,
  })

  const groups = useMemo(() => {
    const byClient = new Map<string, { name: string; credits: OpenCredit[]; total: number }>()
    // A credit whose client was permanently deleted keeps its history but can
    // never be applied; list it under its own heading.
    for (const c of creditsQuery.data ?? []) {
      const key = c.contact_id ?? '(deleted client)'
      const g = byClient.get(key) ?? { name: c.contact_id ? clientName(one(c.contacts)) : 'Deleted client (cannot be applied)', credits: [], total: 0 }
      g.credits.push(c)
      g.total = Math.round((g.total + Number(c.amount)) * 100) / 100
      byClient.set(key, g)
    }
    return Array.from(byClient.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [creditsQuery.data])
  const grandTotal = groups.reduce((a, g) => Math.round((a + g.total) * 100) / 100, 0)
  const count = creditsQuery.data?.length ?? 0

  const notSetUp = creditsQuery.error instanceof MissingTableError

  return (
    <Card className="border-card-border shadow-sm" data-testid="open-credits-panel">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">
              Open credits owed
              {count > 0 && (
                <span className="ml-2 text-muted-foreground font-normal tabular-nums" data-testid="open-credits-total">
                  {count} · {fmtMoney(grandTotal)}
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              Credits go on the client's next approved invoice as a negative line, never taking it below zero (any rest stays open here).
            </p>
          </div>
          {!notSetUp && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="button-add-credit">
              <Plus className="w-4 h-4 mr-1.5" /> Add credit
            </Button>
          )}
        </div>

        {notSetUp ? (
          <p className="text-sm text-muted-foreground py-1" data-testid="open-credits-not-set-up">
            Client credits are not set up yet: the database migration (20261009a_invoice_adjustments) still needs to be applied.
          </p>
        ) : creditsQuery.error ? (
          <ErrorState title="Couldn't load open credits" description={(creditsQuery.error as Error).message} onRetry={() => creditsQuery.refetch()} />
        ) : creditsQuery.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : count === 0 ? (
          <p className="text-sm text-muted-foreground py-1">No credits owed to any client.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">Client</th>
                  <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                  <th className="px-2 py-1.5 font-medium">Reason</th>
                  <th className="px-2 py-1.5 font-medium">Evidence</th>
                  <th className="px-2 py-1.5 font-medium">Created</th>
                  <th className="px-2 py-1.5 w-12" />
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  g.credits.map((c, i) => (
                    <tr key={c.id} className="border-t border-border/60 align-top" data-testid={`credit-${c.id}`}>
                      <td className="px-2 py-1.5">
                        {i === 0 ? (
                          <>
                            <span className="font-medium">{g.name}</span>
                            {g.credits.length > 1 && (
                              <span className="block text-2xs text-muted-foreground tabular-nums">total {fmtMoney(g.total)}</span>
                            )}
                          </>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-success whitespace-nowrap">{fmtMoney(Number(c.amount))}</td>
                      <td className="px-2 py-1.5 max-w-72">
                        <span className="line-clamp-2" title={c.reason}>{c.reason}</span>
                        {c.parent_adjustment_id && (
                          <span className="flex items-center gap-1 text-2xs text-muted-foreground">
                            <Undo2 className="w-3 h-3" /> rest of a credit partly applied to an earlier invoice
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {c.evidence_url && isHttpUrl(c.evidence_url) ? (
                          <a href={c.evidence_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            Link <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="px-2 py-1.5 text-2xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(c.created_at)}{c.created_by ? ` · ${c.created_by}` : ''}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setVoiding(c)} aria-label="Void credit" data-testid={`credit-void-${c.id}`}>
                          <Ban className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {adding && <AddCreditDialog userLabel={userLabel} onClose={() => setAdding(false)} />}
      {voiding && <VoidCreditDialog credit={voiding} userLabel={userLabel} onClose={() => setVoiding(null)} />}
    </Card>
  )
}

function AddCreditDialog({ userLabel, onClose }: { userLabel: string; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [contactId, setContactId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const [originalLineId, setOriginalLineId] = useState<string | null>(null)

  const contactsQuery = useQuery<ContactLite[]>({
    queryKey: ['invoicing', 'credits', 'contacts'],
    queryFn: async () => {
      const out: ContactLite[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from('contacts').select('id, full_name, company').order('id').range(from, from + 999)
        if (error) throw new Error(error.message)
        out.push(...(data ?? []))
        if ((data ?? []).length < 1000) return out
      }
    },
    staleTime: 300_000,
  })
  const contactOptions = useMemo(
    () => (contactsQuery.data ?? [])
      .map(c => ({ value: c.id, label: clientName(c) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [contactsQuery.data],
  )

  // Optional: the billed line this credit refunds, from the client's approved
  // or exported invoices. Its property rides onto the credit line.
  const linesQuery = useQuery<OriginalLineOption[]>({
    queryKey: ['invoicing', 'credits', 'original-lines', contactId],
    enabled: !!contactId,
    queryFn: async () => {
      const { data, error } = await db
        .from('invoice_lines')
        .select('id, line_no, service_type, service_date, raw_date_mentioned, client_charge_amount, properties!inner(name, contact_id), invoice_runs!inner(status, qbo_invoice_no, invoice_number)')
        .eq('properties.contact_id', contactId)
        .in('invoice_runs.status', ['approved', 'exported'])
        .gt('client_charge_amount', 0)
        .order('service_date', { ascending: false, nullsFirst: false })
        .limit(300)
      if (error) throw new Error(error.message)
      return (data ?? []) as OriginalLineOption[]
    },
  })
  const lineOptions = useMemo(
    () => (linesQuery.data ?? []).map(l => {
      const run = one(l.invoice_runs)
      const inv = run?.qbo_invoice_no != null ? `Inv ${run.qbo_invoice_no}` : run?.invoice_number ? `Vendor inv ${run.invoice_number}` : 'Invoice'
      const date = fmtDate(l.service_date ?? l.raw_date_mentioned)
      return {
        value: l.id,
        label: `${inv} · ${date} · ${one(l.properties)?.name ?? 'No property'} · ${l.service_type ?? 'Line'} · ${fmtMoney(Number(l.client_charge_amount))}`,
      }
    }),
    [linesQuery.data],
  )

  const n = Number(amount)
  const amountOk = amount.trim() !== '' && Number.isFinite(n) && n > 0 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6
  const evidenceOk = evidence.trim() === '' || isHttpUrl(evidence)

  const save = useGuardedMutation<void, Error, void>('invoicing', {
    mutationFn: async () => {
      if (!contactId) throw new Error('Pick a client')
      if (!amountOk) throw new Error('Enter the credit amount in dollars and cents (a positive number)')
      if (!reason.trim()) throw new Error('Say what the credit is for')
      if (!evidenceOk) throw new Error('The evidence link must start with http:// or https://')
      const { error } = await db.from('invoice_adjustments').insert({
        contact_id: contactId,
        amount: -Math.round(n * 100) / 100,
        reason: reason.trim(),
        evidence_url: evidence.trim() || null,
        original_line_id: originalLineId,
        created_by: userLabel,
      })
      if (error) throw new Error(isMissingTable(error) ? 'Client credits are not set up yet (migration 20261009a is not applied).' : error.message)
    },
    onSuccess: () => {
      toast({ title: 'Credit added', description: "It goes on the client's next approved invoice." })
      qc.invalidateQueries({ queryKey: CREDITS_KEY })
      onClose()
    },
    onError: (e) => { if (e.message !== 'edit_blocked') toast({ title: 'Add credit failed', description: e.message, variant: 'destructive' }) },
  })

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a client credit</DialogTitle>
          <DialogDescription>Applied automatically to this client's next approved invoice as a negative line.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Client</Label>
            <SearchSelect
              value={contactId ?? ''}
              onSelect={v => { setContactId(v || null); setOriginalLineId(null) }}
              options={contactOptions}
              placeholder={contactsQuery.isLoading ? 'Loading clients…' : 'Pick a client'}
              searchPlaceholder="Search clients…"
              emptyText="No matching clients"
            />
          </div>
          <div className="space-y-1">
            <Label>Credit amount</Label>
            <Input type="number" step="0.01" min="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 50.00" data-testid="credit-amount" />
            <p className="text-2xs text-muted-foreground">Enter what you owe the client; it is stored and invoiced as a negative amount.</p>
          </div>
          <div className="space-y-1">
            <Label>Reason</Label>
            <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Refund for the missed bathroom on the 9/14 turn clean" data-testid="credit-reason" />
          </div>
          <div className="space-y-1">
            <Label>Evidence link <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="https://… (Slack, Quo, email)" data-testid="credit-evidence" />
            {!evidenceOk && <p className="text-2xs text-destructive">Must start with http:// or https://</p>}
          </div>
          <div className="space-y-1">
            <Label>Original invoice line <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <SearchSelect
              value={originalLineId ?? ''}
              onSelect={v => setOriginalLineId(v || null)}
              options={lineOptions}
              placeholder={!contactId ? 'Pick a client first' : linesQuery.isLoading ? 'Loading lines…' : lineOptions.length === 0 ? 'No billed lines for this client' : 'The line this credit refunds'}
              searchPlaceholder="Search by invoice, property, service…"
              emptyText="No matching lines"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !contactId || !amountOk || !reason.trim() || !evidenceOk} data-testid="credit-save">
              {save.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Add credit
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function VoidCreditDialog({ credit, userLabel, onClose }: { credit: OpenCredit; userLabel: string; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [why, setWhy] = useState('')

  const voidCredit = useGuardedMutation<void, Error, void>('invoicing', {
    mutationFn: async () => {
      if (!why.trim()) throw new Error('Say why the credit is voided')
      // Only an OPEN credit can be voided (RLS enforces it too): one applied
      // meanwhile is already on an invoice and must be handled there.
      const { data, error } = await db
        .from('invoice_adjustments')
        .update({ status: 'void', void_reason: why.trim(), voided_by: userLabel })
        .eq('id', credit.id)
        .eq('status', 'open')
        .select('id')
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) throw new Error('This credit is no longer open (it was applied to an invoice or voided meanwhile).')
    },
    onSuccess: () => {
      toast({ title: 'Credit voided' })
      qc.invalidateQueries({ queryKey: CREDITS_KEY })
      onClose()
    },
    onError: (e) => {
      if (e.message !== 'edit_blocked') toast({ title: 'Void failed', description: e.message, variant: 'destructive' })
      qc.invalidateQueries({ queryKey: CREDITS_KEY })
    },
  })

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Void credit</DialogTitle>
          <DialogDescription>
            {clientName(one(credit.contacts))}: {fmtMoney(Number(credit.amount))} for "{credit.reason}". A voided credit is never applied; the record stays for the audit trail.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Why is it voided?</Label>
            <Textarea rows={2} value={why} onChange={e => setWhy(e.target.value)} placeholder="e.g. Entered twice / client declined / refunded by check instead" data-testid="credit-void-reason" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="destructive" onClick={() => voidCredit.mutate()} disabled={voidCredit.isPending || !why.trim()} data-testid="credit-void-confirm">
              {voidCredit.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Void credit
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
