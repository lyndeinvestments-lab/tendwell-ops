import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox, Loader2, Paperclip, Trash2, Undo2, UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusBadge } from '@/components/StatusBadge'
import { invoicesApi, type InvoiceLine, type InvoiceRun, type Vendor } from '@/lib/invoices'

/**
 * Admin side of the vendor invoicing portal (vendors build their own invoice
 * under Operations → Invoicing; see pages/vendor-invoicing.tsx). Everything a
 * reviewer needs to act on a vendor-built invoice lives here so the
 * reconciliation page itself only gains a few one-line hooks.
 */

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

const vendorName = (run: InvoiceRun) => (Array.isArray(run.vendors) ? run.vendors[0]?.name : run.vendors?.name) ?? 'Vendor'

/** Submitted, unapproved vendor-built invoices waiting on Tendwell. */
export function isAwaitingReview(run: InvoiceRun): boolean {
  return run.source === 'vendor_portal' && !run.archived_at && (run.status === 'review_needed' || run.status === 'reconciled')
}

export function SubmittedVendorInvoicesBanner({ runs, onOpen }: { runs: InvoiceRun[]; onOpen: (id: string) => void }) {
  const waiting = runs.filter(isAwaitingReview)
  if (waiting.length === 0) return null
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3" data-testid="banner-vendor-submitted">
      <p className="font-medium flex items-center gap-2">
        <Inbox className="w-4 h-4 text-primary" />
        {waiting.length === 1 ? 'A vendor invoice is waiting for review' : `${waiting.length} vendor invoices are waiting for review`}
      </p>
      <ul className="mt-2 space-y-1.5">
        {waiting.map(r => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-medium">{vendorName(r)}</span>
            <span className="text-muted-foreground">{fmtDate(r.period_start)} – {fmtDate(r.period_end)}</span>
            <span className="tabular-nums">{fmtMoney(r.vendor_total)}</span>
            <span className="text-xs text-muted-foreground">submitted {fmtDateTime(r.submitted_at)}{r.vendor_reference ? ` · #${r.vendor_reference}` : ''}</span>
            <Button size="sm" className="h-7 ml-auto" onClick={() => onOpen(r.id)} data-testid={`button-review-vendor-run-${r.id}`}>Review &amp; approve</Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function VendorRunBanner({ run, onChanged }: { run: InvoiceRun; onChanged: () => void }) {
  const { toast } = useToast()
  const [returning, setReturning] = useState(false)
  const [note, setNote] = useState('')
  const returnMutation = useMutation({
    mutationFn: () => invoicesApi('return', { method: 'POST', body: { run_id: run.id, note } }),
    onSuccess: () => {
      toast({ title: 'Returned to the vendor', description: 'They will see your note and can fix and re-submit.' })
      setReturning(false)
      setNote('')
      onChanged()
    },
    onError: (e: unknown) => toast({ title: 'Could not return it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  })
  if (run.source !== 'vendor_portal') return null

  const canReturn = run.status === 'review_needed' || run.status === 'reconciled'
  return (
    <>
      <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm flex flex-wrap items-start gap-3" data-testid="banner-vendor-run">
        <div className="min-w-0 flex-1">
          {run.status === 'draft' ? (
            <>
              <p className="font-medium">{vendorName(run)} is still building this invoice{run.returned_at ? ' (you returned it to them)' : ''}.</p>
              <p className="text-muted-foreground">It can be approved once they submit it.{run.returned_note ? ` Your note: “${run.returned_note}”` : ''}</p>
            </>
          ) : (
            <>
              <p className="font-medium">
                Built and submitted by {vendorName(run)}{run.submitted_by ? ` (${run.submitted_by})` : ''} · {fmtDateTime(run.submitted_at)}
              </p>
              <p className="text-muted-foreground">
                Vendor total {fmtMoney(run.vendor_total)}{run.vendor_reference ? ` · their invoice #${run.vendor_reference}` : ''}. Cleans come from completed Breezeway/Trellis tasks (one per property per day); every item the vendor added is in the review queue with their details and receipt.
              </p>
            </>
          )}
        </div>
        {canReturn && (
          <Button size="sm" variant="outline" onClick={() => setReturning(true)} data-testid="button-return-to-vendor">
            <Undo2 className="w-4 h-4 mr-1.5" /> Return to vendor
          </Button>
        )}
      </div>
      <Dialog open={returning} onOpenChange={o => { if (!returnMutation.isPending) setReturning(o) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Return this invoice to {vendorName(run)}?</DialogTitle>
            <DialogDescription>It goes back to a draft they can edit. Lines you already resolved or excluded stay that way. Tell them exactly what to fix — they see this note.</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={e => setNote(e.target.value)} rows={4} placeholder="e.g. Add the UPS receipt for the Lakeside reimbursement. Remove the 10/6 clean at Ridge View, Haven deleted that departure." data-testid="input-return-note" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturning(false)} disabled={returnMutation.isPending}>Cancel</Button>
            <Button onClick={() => returnMutation.mutate()} disabled={note.trim().length < 10 || returnMutation.isPending} data-testid="button-confirm-return">
              {returnMutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

const CATEGORY_LABEL: Record<string, string> = {
  clean: 'Clean (from tasks)',
  missing_clean: 'Missing clean (vendor)',
  extra: 'Extra (vendor)',
  reimbursement: 'Reimbursement (vendor)',
  inspection: 'Inspection hours (vendor)',
  labor: 'Labor hours (vendor)',
}

async function receiptUrl(lineId: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`/api/vendor-invoices/receipts?admin=1&line_id=${encodeURIComponent(lineId)}`, {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.url) throw new Error(json.error || `Request failed (${res.status})`)
  return json.url as string
}

/** What the vendor told us about a line they built: reason, who asked, hours,
 *  evidence link, receipt. Rendered under the property cell. */
export function VendorLineDetail({ line }: { line: InvoiceLine }) {
  const { toast } = useToast()
  const [opening, setOpening] = useState(false)
  if (!line.vendor_category) return null
  const d = line.vendor_detail ?? {}
  const taskIds: string[] = Array.isArray(d.task_ids) ? d.task_ids : []
  async function openReceipt() {
    setOpening(true)
    const tab = window.open('about:blank', '_blank')
    try {
      const url = await receiptUrl(line.id)
      if (tab) tab.location.href = url
      else window.location.href = url
    } catch (e) {
      tab?.close()
      toast({ title: 'Could not open the receipt', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setOpening(false)
    }
  }
  return (
    <div className="mt-1 space-y-0.5 text-2xs text-muted-foreground" data-testid={`vendor-detail-${line.id}`}>
      <StatusBadge tone={line.vendor_category === 'clean' ? 'neutral' : 'info'} className="text-2xs">{CATEGORY_LABEL[line.vendor_category] ?? line.vendor_category}</StatusBadge>
      {line.vendor_category === 'clean' && taskIds.length > 1 && <p className="text-warning">{taskIds.length} completed tasks that day — billed once</p>}
      {d.worker && <p>{d.worker}{d.hours != null ? ` · ${d.hours} h × ${fmtMoney(d.rate)}` : ''}</p>}
      {d.description && <p className="text-foreground/80 whitespace-normal">“{d.description}”</p>}
      {d.requested_by && <p className="whitespace-normal">Requested by: {d.requested_by}</p>}
      {d.removed_reason && <p className="whitespace-normal">Vendor removed it: “{d.removed_reason}”</p>}
      {(d.evidence_url || line.receipt_path) && (
        <div className="flex items-center gap-2">
          {d.evidence_url && <a href={d.evidence_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">evidence link</a>}
          {line.receipt_path && (
            <button type="button" onClick={openReceipt} className="inline-flex items-center gap-1 text-primary underline" disabled={opening} data-testid={`button-admin-receipt-${line.id}`}>
              <Paperclip className="w-3 h-3" /> receipt
            </button>
          )}
        </div>
      )}
    </div>
  )
}

interface VendorUserRow {
  id: string
  vendor_id: string
  email: string
  created_by: string | null
  created_at: string
}

interface StaffRow {
  google_email: string
  role: string
  label: string | null
}

/** Link staff logins to a cleaning company so they can use Operations →
 *  Invoicing. The login also needs the `vendor-invoicing` view (supervisors
 *  have it by default; grant others in Settings → Roles). */
export function VendorAccessDialog({ open, onOpenChange, vendors, userLabel }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  vendors: Vendor[]
  userLabel: string
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [vendorId, setVendorId] = useState('')

  const usersQ = useQuery({
    queryKey: ['vendor-users'],
    enabled: open,
    queryFn: async () => {
      // vendor_users isn't in the generated Database types yet (repo
      // convention for new tables — see TaskAudit's `supabase as any`).
      const [{ data: links, error }, { data: staff }] = await Promise.all([
        (supabase as any).from('vendor_users').select('id, vendor_id, email, created_by, created_at').order('email'),
        supabase.from('app_users').select('google_email, role, label'),
      ])
      if (error) throw error
      const staffRows = (staff ?? []) as StaffRow[]
      const byEmail = new Map(staffRows.map(s => [String(s.google_email).toLowerCase(), s]))
      return { links: (links ?? []) as VendorUserRow[], byEmail, staff: staffRows }
    },
  })

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from('vendor_users').insert({ vendor_id: vendorId, email: email.trim().toLowerCase(), created_by: userLabel })
      if (error) throw error
    },
    onSuccess: () => { setEmail(''); qc.invalidateQueries({ queryKey: ['vendor-users'] }); toast({ title: 'Login linked' }) },
    onError: (e: unknown) => toast({ title: 'Could not link', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('vendor_users').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendor-users'] }),
    onError: (e: unknown) => toast({ title: 'Could not unlink', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  })

  const vendorById = new Map(vendors.map(v => [v.id, v.name]))
  const typed = email.trim().toLowerCase()
  const staffHit = typed ? usersQ.data?.byEmail.get(typed) ?? null : null
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-vendor-access">
        <DialogHeader>
          <DialogTitle>Vendor access</DialogTitle>
          <DialogDescription>
            Logins linked here build and submit their company's invoice under Operations → Invoicing. They see their own cleans, their pay and Property List details only, never client charges. The login also needs the Invoicing view (Supervisor has it by default).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {usersQ.isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (usersQ.data?.links.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No logins linked yet.</p>
          ) : (
            usersQ.data!.links.map(l => {
              const s = usersQ.data!.byEmail.get(l.email)
              return (
                <div key={l.id} className="flex items-center gap-2 text-sm rounded-lg border border-card-border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s?.label ? `${s.label} · ` : ''}{l.email}</p>
                    <p className="text-2xs text-muted-foreground">{vendorById.get(l.vendor_id) ?? 'Vendor'} · {s ? `role: ${s.role}` : 'not a staff login yet'}</p>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => remove.mutate(l.id)} disabled={remove.isPending} title="Unlink">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )
            })
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end border-t border-border pt-3">
          <div className="space-y-2">
            <div>
              <Label>Login email</Label>
              <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" list="vendor-access-staff" data-testid="input-vendor-user-email" />
              <datalist id="vendor-access-staff">
                {(usersQ.data?.staff ?? []).filter(s => s.role !== 'admin').map(s => <option key={s.google_email} value={s.google_email}>{s.label ?? ''} ({s.role})</option>)}
              </datalist>
              {typed && validEmail && !staffHit && <p className="text-2xs text-warning mt-1">No staff login with this email yet — add it in Settings → Users first.</p>}
              {staffHit && <p className="text-2xs text-muted-foreground mt-1">{staffHit.label ?? ''} · role {staffHit.role}</p>}
            </div>
            <div>
              <Label>Company</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger data-testid="select-vendor-access-vendor"><SelectValue placeholder="Choose the vendor" /></SelectTrigger>
                <SelectContent>{vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={() => add.mutate()} disabled={!validEmail || !vendorId || add.isPending} data-testid="button-link-vendor-user">
            {add.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1.5" />} Link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
