import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, FileCheck2, Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InvoiceApiError, invoicesApi, type InvoiceRun } from '@/lib/invoices'
import { normalizeBillcomInvoiceNumber, type BillComGroup } from '@shared/billcom-send'
import { normalizeRecipient, shortHash, type PreSendException } from '@shared/sent-invoice-register'

/**
 * Mark one client invoice sent to bill.com.
 *
 * With the sent-invoices register (migration 20261009h) the dialog first runs
 * the pre-send check and lists every exception; Mark sent stays disabled until
 * there are none, and the server re-checks inside the transaction that writes
 * the register row. The recipient defaults to the client's email and can be
 * changed. The bill.com PDF can be attached: the browser computes its SHA-256
 * and only that hash is sent and stored, the file never leaves this device.
 *
 * Without the register (migration pending) it is the plain #626 dialog: the
 * bill.com invoice number only.
 */

interface PreSendResult {
  ok: boolean
  register_available: boolean
  exceptions: PreSendException[]
  total: number
  period: { start: string; end: string } | null
  recipient_default: string | null
  run_source: string | null
}

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '-' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number)
  return y && m && day ? new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : d
}
const fmtMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return y && mo ? new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : m || '-'
}
const SOURCE_LABEL: Record<string, string> = { vendor_portal: 'vendor portal', vendor_csv: 'vendor CSV', generated: 'generated draft' }

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function MarkSentDialog({ run, group, onClose, onSent }: {
  run: InvoiceRun
  group: BillComGroup | null
  onClose: () => void
  onSent: () => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [number, setNumber] = useState('')
  const [recipient, setRecipient] = useState('')
  const [recipientTouched, setRecipientTouched] = useState(false)
  const [pdf, setPdf] = useState<{ name: string; hash: string } | null>(null)
  const [hashing, setHashing] = useState(false)
  const [serverExceptions, setServerExceptions] = useState<PreSendException[] | null>(null)

  useEffect(() => {
    setNumber('')
    setRecipient('')
    setRecipientTouched(false)
    setPdf(null)
    setServerExceptions(null)
  }, [group?.key])

  const check = useQuery<PreSendResult>({
    queryKey: ['invoicing-presend', run.id, group?.key],
    enabled: group != null && group.contactId != null,
    retry: false,
    staleTime: 0,
    queryFn: () => invoicesApi<PreSendResult>('billcom', {
      method: 'POST',
      body: { action: 'presend_check', run_id: run.id, contact_id: group!.contactId, service_month: group!.serviceMonth },
    }),
  })
  const result = check.data
  const registerOn = result?.register_available === true

  useEffect(() => {
    if (!recipientTouched && result?.recipient_default) setRecipient(result.recipient_default)
  }, [result?.recipient_default, recipientTouched])

  const send = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        action: 'mark_sent',
        run_id: run.id,
        contact_id: group!.contactId,
        service_month: group!.serviceMonth,
        billcom_invoice_number: normalizeBillcomInvoiceNumber(number),
      }
      if (registerOn) {
        body.total = result?.total ?? group!.total
        const r = normalizeRecipient(recipient)
        if (r) body.recipient = r
        if (pdf) body.pdf_sha256 = pdf.hash
      }
      return invoicesApi('billcom', { method: 'POST', body })
    },
    onSuccess: () => {
      toast({ title: registerOn ? 'Marked sent and recorded in the register' : 'Marked sent to bill.com' })
      qc.invalidateQueries({ queryKey: ['invoicing-sent-invoices'] })
      onSent()
      onClose()
    },
    onError: (e: unknown) => {
      const listed = e instanceof InvoiceApiError && Array.isArray(e.body?.exceptions) ? (e.body.exceptions as PreSendException[]) : null
      if (listed && listed.length > 0) {
        setServerExceptions(listed)
        return
      }
      toast({ title: 'bill.com update failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    },
  })

  async function onPickPdf(file: File | null) {
    if (!file) {
      setPdf(null)
      return
    }
    setHashing(true)
    try {
      setPdf({ name: file.name, hash: await sha256Hex(file) })
    } catch (e) {
      setPdf(null)
      toast({ title: "Couldn't read that file", description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setHashing(false)
    }
  }

  const exceptions = serverExceptions ?? (registerOn ? result?.exceptions ?? [] : [])
  const numberValue = normalizeBillcomInvoiceNumber(number)
  const blocked = registerOn && exceptions.length > 0
  const canSubmit = !!numberValue && !check.isLoading && !hashing && !blocked && !send.isPending

  return (
    <Dialog open={group != null} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mark sent to bill.com</DialogTitle>
          <DialogDescription>
            {group
              ? `${group.clientName ?? 'Client'}, ${fmtMonth(group.serviceMonth)}, ${fmtMoney(registerOn ? result?.total : group.total)}. Enter the invoice number bill.com gave it. This can't be undone.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        {check.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Running the pre-send check…</div>
        ) : check.error ? (
          <p className="text-xs text-destructive">Pre-send check failed: {check.error instanceof Error ? check.error.message : String(check.error)}</p>
        ) : registerOn && (
          <div className="space-y-2" data-testid="presend-check">
            {exceptions.length > 0 ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 space-y-1.5">
                <p className="text-sm font-medium text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" /> Fix {exceptions.length === 1 ? 'this' : `these ${exceptions.length}`} before sending
                </p>
                <ul className="text-xs space-y-1 list-disc pl-5" data-testid="presend-exceptions">
                  {exceptions.map((x, i) => <li key={`${x.code}-${x.lineNo ?? i}`}>{x.message}</li>)}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-success flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Pre-send check passed</p>
            )}
            {result?.period && (
              <p className="text-2xs text-muted-foreground">
                Register entry: {fmtDate(result.period.start)} to {fmtDate(result.period.end)}
                {result.run_source ? ` · from a ${SOURCE_LABEL[result.run_source] ?? result.run_source} run` : ''}
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mark-sent-number">bill.com invoice number</Label>
            <Input
              id="mark-sent-number"
              autoFocus
              value={number}
              maxLength={64}
              placeholder="e.g. 10452"
              onChange={e => { setNumber(e.target.value); setServerExceptions(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && canSubmit) send.mutate() }}
              data-testid="input-mark-sent-number"
            />
          </div>
          {registerOn && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="mark-sent-recipient">Sent to</Label>
                <Input
                  id="mark-sent-recipient"
                  value={recipient}
                  maxLength={320}
                  placeholder="Client's billing email"
                  onChange={e => { setRecipient(e.target.value); setRecipientTouched(true) }}
                  data-testid="input-mark-sent-recipient"
                />
                <p className="text-2xs text-muted-foreground">Defaults to the client's email on file. Change it if bill.com sent it elsewhere.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mark-sent-pdf">bill.com PDF (optional)</Label>
                <Input
                  id="mark-sent-pdf"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={e => onPickPdf(e.target.files?.[0] ?? null)}
                  data-testid="input-mark-sent-pdf"
                />
                <p className="text-2xs text-muted-foreground flex items-center gap-1">
                  {hashing ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Fingerprinting…</>
                  ) : pdf ? (
                    <><FileCheck2 className="w-3 h-3" /> {pdf.name}: SHA-256 {shortHash(pdf.hash)}</>
                  ) : (
                    'Only a fingerprint (SHA-256) of the file is recorded. The PDF is not uploaded.'
                  )}
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => send.mutate()} disabled={!canSubmit} data-testid="button-mark-sent-submit">
            {send.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Mark sent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
