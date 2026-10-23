import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { invoicesApi, type InvoiceRun } from '@/lib/invoices'
import type { BillComGroup } from '@shared/billcom-send'

/**
 * Create one approved client invoice in bill.com instead of typing it in.
 *
 * Shows exactly what will be created (same lines as the bill.com worksheet,
 * worded like the hand-made invoices), then creates it on confirm. It is not
 * emailed: send it from bill.com, then Mark sent here (the number is filled in).
 * The total shown is sent back with the request; if the lines changed in
 * between, nothing is created and the preview has to be reviewed again.
 */

interface Draft {
  invoiceNumber: string
  invoiceDate: string | null
  propertyName: string | null
  lines: Array<{ description: string; amount: number }>
  total: number
}
interface Preview {
  drafts: Draft[]
  total: number
  register_number: string
  client: { name: string | null; company: string | null; email: string | null }
  customer_linked: boolean
  created: Array<{ number: string }>
}

const fmtMoney = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtDate = (d: string | null) => {
  if (!d) return '-'
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function CreateInBillComDialog({ run, group, onClose, onCreated }: {
  run: InvoiceRun
  group: BillComGroup | null
  onClose: () => void
  onCreated: () => void
}) {
  const { toast } = useToast()
  const [createCustomer, setCreateCustomer] = useState(false)
  useEffect(() => setCreateCustomer(false), [group?.key])

  const target = group ? { run_id: run.id, contact_id: group.contactId, service_month: group.serviceMonth } : null
  const preview = useQuery<Preview>({
    queryKey: ['billcom-create-preview', run.id, group?.key],
    enabled: target != null && group?.contactId != null,
    retry: false,
    staleTime: 0,
    queryFn: () => invoicesApi<Preview>('billcom-create', { method: 'POST', body: { action: 'preview', ...target } }),
  })
  const p = preview.data

  const create = useMutation({
    mutationFn: () => invoicesApi<{ created: Array<{ number: string }> }>('billcom-create', {
      method: 'POST',
      body: { action: 'create', ...target, expected_total: p!.total, create_customer: createCustomer },
    }),
    onSuccess: (out) => {
      toast({ title: `Created in bill.com: ${out.created.map(c => `#${c.number}`).join(', ')}`, description: 'Not emailed yet. Send it from bill.com, then Mark sent here.' })
      onCreated()
      onClose()
    },
    onError: (e: unknown) => {
      toast({ title: "Couldn't create it in bill.com", description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
      preview.refetch()
      onCreated()
    },
  })

  const needsCustomer = p != null && !p.customer_linked
  const canCreate = p != null && p.created.length < p.drafts.length && (!needsCustomer || (createCustomer && !!p.client.email)) && !create.isPending

  return (
    <Dialog open={group != null} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create in bill.com</DialogTitle>
          <DialogDescription>
            {group?.clientName ?? 'Client'}: this is exactly what will be created. It won't be emailed until you send it from bill.com.
          </DialogDescription>
        </DialogHeader>

        {preview.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Building the invoice…</div>
        ) : preview.error ? (
          <p className="text-xs text-destructive">{preview.error instanceof Error ? preview.error.message : String(preview.error)}</p>
        ) : p && (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto" data-testid="billcom-create-preview">
            {p.drafts.map(d => (
              <div key={d.invoiceNumber} className="rounded-lg border border-border">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 border-b border-border">
                  <span className="text-sm font-semibold">#{d.invoiceNumber}</span>
                  {d.propertyName && <span className="text-xs text-muted-foreground">{d.propertyName}</span>}
                  <span className="text-xs text-muted-foreground">Dated and due {fmtDate(d.invoiceDate)}</span>
                  {p.created.some(c => c.number === d.invoiceNumber) && <span className="text-xs text-success">Already created</span>}
                  <span className="ml-auto text-sm font-semibold tabular-nums">{fmtMoney(d.total)}</span>
                </div>
                <ul className="divide-y divide-border">
                  {d.lines.map((l, i) => (
                    <li key={i} className="flex gap-3 px-3 py-1.5 text-xs">
                      <span className="flex-1">{l.description}</span>
                      <span className="tabular-nums">{fmtMoney(l.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {p.drafts.length > 1 && (
              <p className="text-xs text-muted-foreground">{p.drafts.length} invoices, {fmtMoney(p.total)} in all. Each line uses the "Cleaning Service" item.</p>
            )}
            {needsCustomer && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2">
                <p className="text-xs flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> This client isn't linked to a bill.com customer.</p>
                {p.client.email ? (
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox checked={createCustomer} onCheckedChange={v => setCreateCustomer(v === true)} data-testid="checkbox-create-customer" />
                    Create bill.com customer "{p.client.name || p.client.company}" ({p.client.email})
                  </label>
                ) : (
                  <p className="text-xs text-muted-foreground">Add an email to this client in Ops, or link them under Client invoices → bill.com customers.</p>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!canCreate} data-testid="button-billcom-create-submit">
            {create.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Create in bill.com{p ? ` (${fmtMoney(p.total)})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
