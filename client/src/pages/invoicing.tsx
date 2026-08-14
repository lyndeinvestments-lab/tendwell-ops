import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { SearchSelect } from '@/components/issues/SearchSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { StatusTone } from '@/lib/status-colors'
import {
  Receipt, Plus, Upload, Download, RefreshCw, CheckCircle2, AlertTriangle,
  ArrowLeft, Pencil, Ban, Loader2, FileText,
} from 'lucide-react'
import {
  BILLING_CHANNELS, EXPORT_FORMATS, LINE_KINDS, SERVICE_TYPES,
  downloadExport, flagLabel, invoicesApi, propertyOf, vendorNameOf,
  type BillingChannel, type ExportFormat, type InvoiceLine, type InvoiceRun,
  type LineKind, type ReviewStatus, type Vendor,
} from '@/lib/invoices'

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const parts = d.slice(0, 10).split('-').map(Number)
  if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return d
  const [y, m, day] = parts
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function sum(nums: Array<number | null | undefined>): number {
  return nums.reduce((acc: number, n) => acc + (n ?? 0), 0)
}

function runStatusTone(status: string): StatusTone {
  if (status === 'review_needed') return 'warning'
  if (status === 'approved' || status === 'exported') return 'success'
  if (status === 'void') return 'neutral'
  return 'info' // ingested | reconciled
}

function reviewStatusTone(status: ReviewStatus): StatusTone {
  if (status === 'needs_review') return 'warning'
  if (status === 'resolved') return 'success'
  if (status === 'excluded') return 'neutral'
  return 'neutral' // ok
}

function channelTone(channel: BillingChannel | null): StatusTone {
  if (channel === 'qbo_haven') return 'info'
  if (channel === 'bill_com') return 'primary'
  return 'neutral'
}

const SPLIT_ACCENTS = ['border-l-primary/50', 'border-l-info/50', 'border-l-warning/50', 'border-l-success/50']

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InvoicingPage() {
  usePageTitle('Invoicing')
  const { effectiveUser } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [reviewLine, setReviewLine] = useState<InvoiceLine | null>(null)

  const userLabel = effectiveUser?.label || 'Unknown'

  // ── Vendors (used by both dialogs) ─────────────────────────────────────────
  const vendorsQuery = useQuery<Vendor[]>({
    queryKey: ['invoicing-vendors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('id, name, active').eq('active', true).order('name')
      if (error) throw error
      return (data ?? []) as Vendor[]
    },
    staleTime: 60_000,
  })

  // ── Runs list ───────────────────────────────────────────────────────────────
  const runsQuery = useQuery<InvoiceRun[]>({
    queryKey: ['invoicing-runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoice_runs')
        .select('id, vendor_id, source, invoice_number, invoice_date, period_start, period_end, stated_subtotal, computed_subtotal, status, approved_by, approved_at, created_by, created_at, vendors(name)')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as unknown as InvoiceRun[]
    },
    staleTime: 15_000,
  })

  const invalidateRuns = () => qc.invalidateQueries({ queryKey: ['invoicing-runs'] })
  const invalidateRunDetail = (runId: string) => {
    qc.invalidateQueries({ queryKey: ['invoicing-run', runId] })
    qc.invalidateQueries({ queryKey: ['invoicing-lines', runId] })
  }

  const openRun = (runId: string) => setSelectedRunId(runId)
  const backToList = () => setSelectedRunId(null)

  // ── List KPIs ────────────────────────────────────────────────────────────────
  const runs = runsQuery.data ?? []
  const listStats = useMemo(() => {
    const needsReview = runs.filter(r => r.status === 'review_needed').length
    const now = new Date()
    const approvedThisMonth = runs.filter(r => {
      if (r.status !== 'approved' && r.status !== 'exported') return false
      if (!r.approved_at) return false
      const d = new Date(r.approved_at)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    }).length
    const lastRun = runs[0] ?? null
    const lastDiscrepancy = lastRun && lastRun.stated_subtotal != null && lastRun.computed_subtotal != null
      ? lastRun.computed_subtotal - lastRun.stated_subtotal
      : null
    return { needsReview, approvedThisMonth, lastRun, lastDiscrepancy }
  }, [runs])

  // ── Generate draft mutation ──────────────────────────────────────────────────
  const generateMutation = useMutation({
    mutationFn: async (vars: { vendorId: string; periodStart: string; periodEnd: string }) =>
      invoicesApi<{ ok: boolean; run_id?: string; status?: string; reason?: string; detail?: string }>('generate', {
        method: 'POST',
        body: { vendor_id: vars.vendorId, period_start: vars.periodStart, period_end: vars.periodEnd },
      }),
    onSuccess: (result) => {
      if (!result.ok || !result.run_id) {
        toast({ title: 'Nothing to generate', description: result.detail || result.reason || 'No matching tasks in that period.', variant: 'destructive' })
        return
      }
      toast({ title: 'Draft invoice generated', description: `Status: ${result.status}` })
      invalidateRuns()
      setGenerateOpen(false)
      setSelectedRunId(result.run_id)
    },
    onError: (e: unknown) => toast({ title: 'Generate failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  })

  // ── Upload CSV mutation ──────────────────────────────────────────────────────
  const uploadMutation = useMutation({
    mutationFn: async (vars: { vendorId: string; csv: string; invoiceNumber: string; invoiceDate: string; statedSubtotal: string }) => {
      const body: Record<string, unknown> = { vendor_id: vars.vendorId, csv: vars.csv }
      if (vars.invoiceNumber.trim()) body.invoice_number = vars.invoiceNumber.trim()
      if (vars.invoiceDate.trim()) body.invoice_date = vars.invoiceDate.trim()
      if (vars.statedSubtotal.trim()) {
        const n = Number(vars.statedSubtotal)
        if (Number.isFinite(n)) body.stated_subtotal = n
      }
      return invoicesApi<{ ok: boolean; run_id: string; status: string; subtotal_gate?: boolean; stated_subtotal?: number | null; computed_subtotal?: number | null }>('upload', { method: 'POST', body })
    },
    onSuccess: (result) => {
      if (result.subtotal_gate === false) {
        toast({
          title: 'Invoice ingested — subtotal mismatch',
          description: `Stated ${fmtMoney(result.stated_subtotal)} vs computed ${fmtMoney(result.computed_subtotal)}. Flagged for review.`,
          variant: 'destructive',
        })
      } else {
        toast({ title: 'Invoice uploaded', description: `Status: ${result.status}` })
      }
      invalidateRuns()
      setUploadOpen(false)
      setSelectedRunId(result.run_id)
    },
    onError: (e: unknown) => toast({ title: 'Upload failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  })

  return (
    <PageContainer className="md:h-full md:flex md:flex-col">
      {selectedRunId ? (
        <RunDetail
          runId={selectedRunId}
          userLabel={userLabel}
          onBack={backToList}
          onReview={setReviewLine}
          onRunsChanged={invalidateRuns}
          onDetailChanged={() => invalidateRunDetail(selectedRunId)}
        />
      ) : (
        <>
          <PageHeader
            title="Invoicing"
            subtitle="Reconcile vendor cleaning invoices, review flagged lines, and export to Ramp / QBO / bill.com."
            actions={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)} data-testid="button-upload-invoice">
                  <Upload className="w-4 h-4 mr-1.5" /> Upload vendor CSV
                </Button>
                <Button size="sm" onClick={() => setGenerateOpen(true)} data-testid="button-generate-invoice">
                  <Plus className="w-4 h-4 mr-1.5" /> Generate draft
                </Button>
              </div>
            }
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard
              title="Runs needing review"
              value={listStats.needsReview}
              icon={AlertTriangle}
              tone={listStats.needsReview > 0 ? 'warning' : 'success'}
              loading={runsQuery.isLoading}
              testId="stat-needs-review"
            />
            <StatCard
              title="Approved this month"
              value={listStats.approvedThisMonth}
              icon={CheckCircle2}
              tone="success"
              loading={runsQuery.isLoading}
              testId="stat-approved-month"
            />
            <StatCard
              title="Last run net discrepancy"
              value={listStats.lastDiscrepancy != null ? fmtMoney(listStats.lastDiscrepancy) : '—'}
              subtitle={listStats.lastRun ? `${vendorNameOf(listStats.lastRun)} · stated vs. computed` : 'No runs yet'}
              icon={Receipt}
              tone={listStats.lastDiscrepancy != null && Math.abs(listStats.lastDiscrepancy) > 0.005 ? 'destructive' : 'neutral'}
              loading={runsQuery.isLoading}
              testId="stat-last-discrepancy"
            />
          </div>

          {runsQuery.error ? (
            <ErrorState title="Couldn't load invoice runs" onRetry={() => runsQuery.refetch()} />
          ) : runsQuery.isLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : runs.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No invoice runs yet"
              description="Generate a draft from Trellis/Breezeway tasks or upload a vendor CSV to get started."
              action={{ label: 'Generate draft', onClick: () => setGenerateOpen(true) }}
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block rounded-2xl border border-card-border shadow-sm overflow-hidden md:flex-1 md:min-h-0">
                <div className="overflow-auto md:h-full">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                      <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Vendor</th>
                        <th className="px-3 py-2 font-medium">Source</th>
                        <th className="px-3 py-2 font-medium">Period</th>
                        <th className="px-3 py-2 font-medium">Invoice #</th>
                        <th className="px-3 py-2 font-medium text-right">Stated</th>
                        <th className="px-3 py-2 font-medium text-right">Computed</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map(run => (
                        <tr
                          key={run.id}
                          className="border-t border-border/60 hover:bg-muted/30 cursor-pointer"
                          onClick={() => openRun(run.id)}
                          data-testid={`row-run-${run.id}`}
                        >
                          <td className="px-3 py-2 font-medium max-w-56 truncate">{vendorNameOf(run)}</td>
                          <td className="px-3 py-2">
                            <StatusBadge tone={run.source === 'generated' ? 'primary' : 'neutral'}>
                              {run.source === 'generated' ? 'Generated' : 'Vendor CSV'}
                            </StatusBadge>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                            {fmtDate(run.period_start)} – {fmtDate(run.period_end)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{run.invoice_number ?? '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(run.stated_subtotal)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(run.computed_subtotal)}</td>
                          <td className="px-3 py-2">
                            <StatusBadge tone={runStatusTone(run.status)}>{run.status.replace(/_/g, ' ')}</StatusBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {runs.map(run => (
                  <Card
                    key={run.id}
                    className="border-card-border active:bg-muted/40 transition-colors cursor-pointer"
                    onClick={() => openRun(run.id)}
                    data-testid={`card-run-${run.id}`}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{vendorNameOf(run)}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {fmtDate(run.period_start)} – {fmtDate(run.period_end)}
                          </p>
                        </div>
                        <StatusBadge tone={runStatusTone(run.status)}>{run.status.replace(/_/g, ' ')}</StatusBadge>
                      </div>
                      <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground tabular-nums">
                        <span>Stated {fmtMoney(run.stated_subtotal)}</span>
                        <span>Computed {fmtMoney(run.computed_subtotal)}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <GenerateDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        vendors={vendorsQuery.data ?? []}
        pending={generateMutation.isPending}
        onSubmit={vars => generateMutation.mutate(vars)}
      />
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        vendors={vendorsQuery.data ?? []}
        pending={uploadMutation.isPending}
        onSubmit={vars => uploadMutation.mutate(vars)}
      />
      {reviewLine && selectedRunId && (
        <LineReviewDialogContainer
          line={reviewLine}
          runId={selectedRunId}
          userLabel={userLabel}
          onClose={() => setReviewLine(null)}
          onSaved={() => {
            setReviewLine(null)
            invalidateRunDetail(selectedRunId)
          }}
        />
      )}
    </PageContainer>
  )
}

// ── Generate draft dialog ─────────────────────────────────────────────────────

function GenerateDialog({ open, onOpenChange, vendors, pending, onSubmit }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  vendors: Vendor[]
  pending: boolean
  onSubmit: (vars: { vendorId: string; periodStart: string; periodEnd: string }) => void
}) {
  const [vendorId, setVendorId] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')

  const canSubmit = !!vendorId && !!periodStart && !!periodEnd && periodStart <= periodEnd

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate draft invoice</DialogTitle>
          <DialogDescription>
            Builds a draft from cleaning tasks in the period, then runs the same reconcile pipeline as a vendor upload. No LLM involved.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Vendor</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger data-testid="select-generate-vendor"><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Period start</Label>
              <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} data-testid="input-period-start" />
            </div>
            <div className="space-y-1.5">
              <Label>Period end</Label>
              <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} data-testid="input-period-end" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSubmit || pending}
            onClick={() => onSubmit({ vendorId, periodStart, periodEnd })}
            data-testid="button-submit-generate"
          >
            {pending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Upload CSV dialog ─────────────────────────────────────────────────────────

function UploadDialog({ open, onOpenChange, vendors, pending, onSubmit }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  vendors: Vendor[]
  pending: boolean
  onSubmit: (vars: { vendorId: string; csv: string; invoiceNumber: string; invoiceDate: string; statedSubtotal: string }) => void
}) {
  const { toast } = useToast()
  const [vendorId, setVendorId] = useState('')
  const [fileName, setFileName] = useState('')
  const [csv, setCsv] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [statedSubtotal, setStatedSubtotal] = useState('')

  const canSubmit = !!vendorId && !!csv

  function handleFile(file: File | null) {
    if (!file) { setFileName(''); setCsv(''); return }
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => setCsv(String(reader.result ?? ''))
    reader.onerror = () => toast({ title: 'Could not read file', variant: 'destructive' })
    reader.readAsText(file)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload vendor CSV</DialogTitle>
          <DialogDescription>
            Ingests a vendor's invoice CSV. If a stated subtotal doesn't match the line sum to the penny, the run is flagged for review.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Vendor</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger data-testid="select-upload-vendor"><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Invoice CSV file</Label>
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={e => handleFile(e.target.files?.[0] ?? null)}
              data-testid="input-invoice-csv"
            />
            {fileName && <p className="text-xs text-muted-foreground flex items-center gap-1"><FileText className="w-3 h-3" /> {fileName}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Invoice # (optional)</Label>
              <Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} data-testid="input-invoice-number" />
            </div>
            <div className="space-y-1.5">
              <Label>Invoice date (optional)</Label>
              <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} data-testid="input-invoice-date" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Stated subtotal (optional)</Label>
            <Input
              type="number"
              step="0.01"
              placeholder="Overrides any subtotal detected in the CSV"
              value={statedSubtotal}
              onChange={e => setStatedSubtotal(e.target.value)}
              data-testid="input-stated-subtotal"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSubmit || pending}
            onClick={() => onSubmit({ vendorId, csv, invoiceNumber, invoiceDate, statedSubtotal })}
            data-testid="button-submit-upload"
          >
            {pending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Run detail ────────────────────────────────────────────────────────────────

function RunDetail({ runId, userLabel, onBack, onReview, onRunsChanged, onDetailChanged }: {
  runId: string
  userLabel: string
  onBack: () => void
  onReview: (line: InvoiceLine) => void
  onRunsChanged: () => void
  onDetailChanged: () => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()

  const runQuery = useQuery<InvoiceRun>({
    queryKey: ['invoicing-run', runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoice_runs')
        .select('id, vendor_id, source, invoice_number, invoice_date, period_start, period_end, stated_subtotal, computed_subtotal, status, approved_by, approved_at, created_by, created_at, vendors(name)')
        .eq('id', runId)
        .single()
      if (error) throw error
      return data as unknown as InvoiceRun
    },
  })

  const linesQuery = useQuery<InvoiceLine[]>({
    queryKey: ['invoicing-lines', runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoice_lines')
        .select('*, properties(id, name)')
        .eq('run_id', runId)
        .order('line_no', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as InvoiceLine[]
    },
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['invoicing-run', runId] })
    qc.invalidateQueries({ queryKey: ['invoicing-lines', runId] })
    onRunsChanged()
  }

  const reconcileMutation = useMutation({
    mutationFn: async () => invoicesApi<{ ok: boolean; status: string }>('reconcile', { method: 'POST', body: { run_id: runId } }),
    onSuccess: (r) => {
      toast({ title: 'Reconcile complete', description: `Status: ${r.status}` })
      invalidate()
    },
    onError: (e: unknown) => toast({ title: 'Reconcile failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  })

  const approveMutation = useMutation({
    mutationFn: async () => invoicesApi<{ ok: boolean; status: string }>('approve', { method: 'POST', body: { run_id: runId } }),
    onSuccess: (r) => {
      toast({ title: 'Invoice approved', description: `Status: ${r.status}` })
      invalidate()
    },
    onError: (e: unknown) => toast({ title: 'Cannot approve', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  })

  const excludeMutation = useGuardedMutation<void, Error, InvoiceLine>('invoicing', {
    mutationFn: async (line: InvoiceLine) => {
      const { error } = await supabase
        .from('invoice_lines')
        .update({
          review_status: 'excluded',
          resolved_by: userLabel,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', line.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Line excluded' })
      invalidate()
    },
    onError: (e: Error) => {
      if (e.message === 'edit_blocked') return
      toast({ title: 'Failed to exclude line', description: e.message, variant: 'destructive' })
    },
  })

  const [downloadingFormat, setDownloadingFormat] = useState<ExportFormat | null>(null)
  async function handleDownload(format: ExportFormat) {
    setDownloadingFormat(format)
    try {
      await downloadExport(runId, format)
    } catch (e) {
      toast({ title: 'Export failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setDownloadingFormat(null)
    }
  }

  const run = runQuery.data
  const lines = linesQuery.data ?? []
  const activeLines = useMemo(() => lines.filter(l => l.review_status !== 'excluded'), [lines])
  const hasNeedsReview = lines.some(l => l.review_status === 'needs_review')

  const totals = useMemo(() => ({
    invoiced: sum(activeLines.map(l => l.raw_amount)),
    cleanerPay: sum(activeLines.map(l => l.cleaner_pay_amount)),
    clientCharge: sum(activeLines.map(l => l.client_charge_amount)),
  }), [activeLines])
  const netDiscrepancy = totals.invoiced - totals.cleanerPay

  const canApprove = !!run && !['approved', 'exported', 'void'].includes(run.status)
  const showDownloads = !!run && (run.status === 'approved' || run.status === 'exported')
  const subtotalMismatch = run?.stated_subtotal != null && run?.computed_subtotal != null
    && Math.abs(run.stated_subtotal - run.computed_subtotal) > 0.005

  // Split-group accent color assignment (stable per split_group value).
  const splitAccent = useMemo(() => {
    const map = new Map<number, string>()
    let i = 0
    for (const l of lines) {
      if (l.split_group != null && !map.has(l.split_group)) {
        map.set(l.split_group, SPLIT_ACCENTS[i % SPLIT_ACCENTS.length])
        i++
      }
    }
    return map
  }, [lines])

  if (runQuery.error) {
    return (
      <>
        <PageHeader title="Invoicing" actions={<Button size="sm" variant="outline" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1.5" /> Back</Button>} />
        <ErrorState title="Couldn't load this invoice run" onRetry={() => runQuery.refetch()} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={run ? vendorNameOf(run) : 'Loading…'}
        subtitle={run ? `${run.source === 'generated' ? 'Generated draft' : 'Vendor CSV'} · ${fmtDate(run.period_start)} – ${fmtDate(run.period_end)}` : undefined}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={onBack} data-testid="button-back-to-runs">
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => reconcileMutation.mutate()}
              disabled={reconcileMutation.isPending || run?.status === 'void'}
              title="Re-runs the deterministic reconcile engine. Rows already resolved by a human are preserved."
              data-testid="button-reconcile"
            >
              {reconcileMutation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
              Re-run reconcile
            </Button>
            {canApprove && (
              <Button
                size="sm"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending || hasNeedsReview}
                title={hasNeedsReview ? 'Resolve all needs-review lines before approving' : undefined}
                data-testid="button-approve"
              >
                {approveMutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                Approve
              </Button>
            )}
          </div>
        }
      />

      {run && (
        <Card className="border-card-border shadow-sm">
          <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">Invoice #</p>
              <p className="font-medium">{run.invoice_number ?? '—'}</p>
            </div>
            <div>
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">Invoice date</p>
              <p className="font-medium">{fmtDate(run.invoice_date)}</p>
            </div>
            <div>
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">Status</p>
              <StatusBadge tone={runStatusTone(run.status)}>{run.status.replace(/_/g, ' ')}</StatusBadge>
            </div>
            <div>
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">Stated vs. computed</p>
              <p className={cn('font-medium tabular-nums', subtotalMismatch && 'text-destructive')}>
                {fmtMoney(run.stated_subtotal)} / {fmtMoney(run.computed_subtotal)}
                {subtotalMismatch && <AlertTriangle className="inline w-3.5 h-3.5 ml-1.5" />}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Total invoiced" value={fmtMoney(totals.invoiced)} icon={Receipt} loading={linesQuery.isLoading} />
        <StatCard title="Cleaner pay (Ramp)" value={fmtMoney(totals.cleanerPay)} icon={Receipt} tone="info" loading={linesQuery.isLoading} />
        <StatCard title="Client charge" value={fmtMoney(totals.clientCharge)} icon={Receipt} tone="primary" loading={linesQuery.isLoading} />
        <StatCard
          title="Net discrepancy"
          value={fmtMoney(netDiscrepancy)}
          subtitle="Invoiced − cleaner pay"
          icon={AlertTriangle}
          tone={Math.abs(netDiscrepancy) > 0.005 ? 'warning' : 'neutral'}
          loading={linesQuery.isLoading}
        />
      </div>

      {showDownloads && (
        <Card className="border-card-border shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">Export</p>
            <div className="flex flex-wrap gap-2">
              {EXPORT_FORMATS.map(f => (
                <Button
                  key={f.id}
                  size="sm"
                  variant="outline"
                  onClick={() => handleDownload(f.id)}
                  disabled={downloadingFormat === f.id}
                  data-testid={`button-export-${f.id}`}
                >
                  {downloadingFormat === f.id ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}
                  {f.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {linesQuery.error ? (
        <ErrorState title="Couldn't load invoice lines" onRetry={() => linesQuery.refetch()} />
      ) : linesQuery.isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : lines.length === 0 ? (
        <EmptyState icon={Receipt} title="No lines" description="This run has no invoice lines." />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-2xl border border-card-border shadow-sm overflow-hidden md:flex-1 md:min-h-0">
            <div className="overflow-auto md:h-full">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                  <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Property</th>
                    <th className="px-3 py-2 font-medium">Service</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium text-right">Invoiced</th>
                    <th className="px-3 py-2 font-medium text-right">Cleaner pay</th>
                    <th className="px-3 py-2 font-medium text-right">Client charge</th>
                    <th className="px-3 py-2 font-medium">Channel</th>
                    <th className="px-3 py-2 font-medium">Flags</th>
                    <th className="px-3 py-2 font-medium">Review</th>
                    <th className="px-3 py-2 font-medium w-20" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => {
                    const prop = propertyOf(line)
                    const accent = line.split_group != null ? splitAccent.get(line.split_group) : undefined
                    return (
                      <tr
                        key={line.id}
                        className={cn(
                          'border-t border-border/60 hover:bg-muted/30',
                          line.review_status === 'needs_review' && 'bg-warning/5',
                          line.review_status === 'excluded' && 'opacity-50',
                          accent && `border-l-2 ${accent}`,
                        )}
                        data-testid={`row-line-${line.id}`}
                      >
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {line.line_no}
                          {line.split_group != null && <span className="ml-1 text-2xs">split</span>}
                        </td>
                        <td className="px-3 py-2 max-w-56">
                          <p className="truncate">{prop?.name ?? '—'}</p>
                          {line.raw_property_text && line.raw_property_text !== prop?.name && (
                            <p className="text-2xs text-muted-foreground truncate">raw: {line.raw_property_text}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 max-w-40 truncate">{line.service_type ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(line.raw_date_mentioned)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(line.raw_amount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(line.cleaner_pay_amount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(line.client_charge_amount)}</td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={channelTone(line.billing_channel)}>
                            {BILLING_CHANNELS.find(c => c.id === line.billing_channel)?.label ?? '—'}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1 max-w-48">
                            {line.flags.map(f => (
                              <StatusBadge key={f} tone="warning" className="text-2xs">{flagLabel(f)}</StatusBadge>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={reviewStatusTone(line.review_status)}>{line.review_status.replace(/_/g, ' ')}</StatusBadge>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onReview(line)} title="Review" data-testid={`button-review-${line.id}`}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            {line.review_status !== 'excluded' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-muted-foreground hover:text-destructive"
                                onClick={() => excludeMutation.mutate(line)}
                                title="Exclude line"
                                data-testid={`button-exclude-${line.id}`}
                              >
                                <Ban className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
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
            {lines.map(line => {
              const prop = propertyOf(line)
              return (
                <Card
                  key={line.id}
                  className={cn(
                    'border-card-border',
                    line.review_status === 'needs_review' && 'border-warning/40 bg-warning/5',
                    line.review_status === 'excluded' && 'opacity-50',
                  )}
                  data-testid={`card-line-${line.id}`}
                >
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{prop?.name ?? line.raw_property_text ?? '—'}</p>
                        <p className="text-xs text-muted-foreground truncate">{line.service_type ?? '—'} · {fmtDate(line.raw_date_mentioned)}</p>
                      </div>
                      <StatusBadge tone={reviewStatusTone(line.review_status)}>{line.review_status.replace(/_/g, ' ')}</StatusBadge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
                      <span>Inv {fmtMoney(line.raw_amount)}</span>
                      <span>Pay {fmtMoney(line.cleaner_pay_amount)}</span>
                      <span>Chg {fmtMoney(line.client_charge_amount)}</span>
                    </div>
                    {line.flags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {line.flags.map(f => <StatusBadge key={f} tone="warning" className="text-2xs">{flagLabel(f)}</StatusBadge>)}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <Button size="sm" variant="outline" className="h-7 flex-1" onClick={() => onReview(line)}>
                        <Pencil className="w-3.5 h-3.5 mr-1.5" /> Review
                      </Button>
                      {line.review_status !== 'excluded' && (
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => excludeMutation.mutate(line)}>
                          <Ban className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

// ── Line review dialog ────────────────────────────────────────────────────────

function LineReviewDialogContainer({ line, runId, userLabel, onClose, onSaved }: {
  line: InvoiceLine
  runId: string
  userLabel: string
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()

  const propertiesQuery = useQuery<Array<{ id: number; name: string | null }>>({
    queryKey: ['invoicing-properties'],
    queryFn: async () => {
      const { data, error } = await supabase.from('properties').select('id, name').is('deleted_at', null).order('name')
      if (error) throw error
      return (data ?? []) as Array<{ id: number; name: string | null }>
    },
    staleTime: 60_000,
  })

  const currentProperty = propertyOf(line)
  const [propertyId, setPropertyId] = useState<number | null>(currentProperty?.id ?? null)
  const [serviceType, setServiceType] = useState<string>(line.service_type ?? '')
  const [lineKind, setLineKind] = useState<LineKind>(line.line_kind)
  const [reviewNote, setReviewNote] = useState<string>(line.review_note ?? '')
  const [cleanerPay, setCleanerPay] = useState<string>(line.cleaner_pay_amount != null ? String(line.cleaner_pay_amount) : '')
  const [clientCharge, setClientCharge] = useState<string>(line.client_charge_amount != null ? String(line.client_charge_amount) : '')

  const propertyOptions = (propertiesQuery.data ?? []).map(p => ({ value: String(p.id), label: p.name ?? `Property #${p.id}` }))

  // Property changes need the run's vendor_id (not carried by the line) to
  // upsert a confirmed alias — looked up once inside the mutation rather than
  // threading it through as another prop.
  const saveMutation = useGuardedMutation<void, Error, void>('invoicing', {
    mutationFn: async () => {
      const propertyChanged = propertyId !== (currentProperty?.id ?? null)
      const cleanerPayNum = cleanerPay.trim() === '' ? null : Number(cleanerPay)
      const clientChargeNum = clientCharge.trim() === '' ? null : Number(clientCharge)

      const { error } = await supabase
        .from('invoice_lines')
        .update({
          property_id: propertyId,
          service_type: serviceType || null,
          line_kind: lineKind,
          review_note: reviewNote || null,
          cleaner_pay_amount: cleanerPayNum != null && Number.isFinite(cleanerPayNum) ? cleanerPayNum : null,
          client_charge_amount: clientChargeNum != null && Number.isFinite(clientChargeNum) ? clientChargeNum : null,
          review_status: 'resolved',
          resolved_by: userLabel,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', line.id)
      if (error) throw error

      if (propertyChanged && propertyId != null && line.raw_property_text) {
        const { data: runRow } = await supabase.from('invoice_runs').select('vendor_id').eq('id', runId).maybeSingle()
        const vendorId = runRow?.vendor_id ?? null
        if (vendorId) {
          const { error: aliasErr } = await supabase.from('vendor_property_aliases').insert({
            vendor_id: vendorId,
            alias_raw: line.raw_property_text,
            property_id: propertyId,
            confirmed_by: userLabel,
          })
          // Ignore duplicate-alias conflicts (unique constraint) — a
          // previously-confirmed alias for this text already exists.
          if (aliasErr && aliasErr.code !== '23505') {
            throw new Error(aliasErr.message)
          }
        }
      }
    },
    onSuccess: () => {
      toast({ title: 'Line updated' })
      onSaved()
    },
    onError: (e: Error) => {
      if (e.message === 'edit_blocked') return
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' })
    },
  })

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review line #{line.line_no}</DialogTitle>
          <DialogDescription>
            {line.raw_property_text ? `Raw: "${line.raw_property_text}"` : 'No raw property text'}
            {line.raw_note_text ? ` · ${line.raw_note_text}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Property</Label>
            <SearchSelect
              value={propertyId != null ? String(propertyId) : ''}
              onSelect={(value) => setPropertyId(value ? Number(value) : null)}
              options={propertyOptions}
              placeholder="Select property"
              searchPlaceholder="Search properties…"
              emptyText="No matching properties"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Service type</Label>
              <Select value={serviceType} onValueChange={setServiceType}>
                <SelectTrigger data-testid="select-service-type"><SelectValue placeholder="Select service" /></SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Line kind</Label>
              <Select value={lineKind} onValueChange={v => setLineKind(v as LineKind)}>
                <SelectTrigger data-testid="select-line-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LINE_KINDS.map(k => <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Cleaner pay</Label>
              <Input type="number" step="0.01" value={cleanerPay} onChange={e => setCleanerPay(e.target.value)} data-testid="input-cleaner-pay" />
            </div>
            <div className="space-y-1.5">
              <Label>Client charge</Label>
              <Input type="number" step="0.01" value={clientCharge} onChange={e => setClientCharge(e.target.value)} data-testid="input-client-charge" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Review note</Label>
            <Textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} rows={2} data-testid="textarea-review-note" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            data-testid="button-save-review"
          >
            {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
