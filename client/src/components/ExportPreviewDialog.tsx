import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Papa from 'papaparse'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { EXPORT_FORMATS, previewExport, type ExportFormat } from '@/lib/invoices'
import { Copy, Download, Info, Loader2 } from 'lucide-react'

/**
 * Shows what an export file will contain, before the run is approved.
 *
 * The rows come from the real exporter via `?preview=1` rather than a mock, so
 * what you read here is what the CSV will hold. The one intentional gap is the
 * AR invoice number on the QBO formats: previewing never allocates one (the
 * counter is shared with live QBO, so peeking would burn real numbers and leave
 * gaps), and the banner says so when that cell is still blank.
 */
export function ExportPreviewDialog({
  runId,
  runStatus,
  open,
  onOpenChange,
  onDownload,
  downloadingFormat,
}: {
  runId: string
  runStatus: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Runs the real export (side effects and all). Only offered once approved. */
  onDownload?: (format: ExportFormat) => void
  downloadingFormat?: ExportFormat | null
}) {
  const [format, setFormat] = useState<ExportFormat>('ramp')
  const { toast } = useToast()

  const previewQuery = useQuery({
    queryKey: ['/api/invoices/export-preview', runId, format],
    queryFn: () => previewExport(runId, format),
    enabled: open,
    staleTime: 30_000,
  })

  const parsed = useMemo(() => {
    const csv = previewQuery.data?.csv
    if (!csv) return null
    const out = Papa.parse<string[]>(csv.trim(), { skipEmptyLines: true })
    const rows = (out.data ?? []).filter(r => Array.isArray(r))
    if (rows.length === 0) return { headers: [] as string[], body: [] as string[][] }
    return { headers: rows[0], body: rows.slice(1) }
  }, [previewQuery.data?.csv])

  const approved = runStatus === 'approved' || runStatus === 'exported'

  async function copyCsv() {
    const csv = previewQuery.data?.csv
    if (!csv) return
    try {
      await navigator.clipboard.writeText(csv)
      toast({ title: 'CSV copied to clipboard' })
    } catch {
      toast({ title: "Couldn't copy", description: 'Clipboard access was blocked.', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Export preview</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {EXPORT_FORMATS.map(f => (
            <Button
              key={f.id}
              size="sm"
              variant={format === f.id ? 'default' : 'outline'}
              onClick={() => setFormat(f.id)}
              data-testid={`button-preview-format-${f.id}`}
            >
              {f.label}
            </Button>
          ))}
        </div>

        {/* The "not approved yet" spot: says what this run's state means for the
            file, rather than leaving the reader to guess whether it's final. */}
        <div
          className={cn(
            'flex items-start gap-2 rounded-lg border p-3 text-xs',
            approved ? 'border-info/25 bg-info/5' : 'border-warning/25 bg-warning/5',
          )}
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {approved ? 'Approved — this is the file you will get.' : 'Draft preview — this run is not approved yet.'}
              </span>
              <StatusBadge tone={approved ? 'info' : 'warning'}>{runStatus.replace(/_/g, ' ')}</StatusBadge>
            </div>
            <p className="text-muted-foreground">
              {approved
                ? 'Rendered by the same exporter the download uses.'
                : 'Rendered by the same exporter the download uses, so the rows are real — but lines can still change while the review queue is open. Nothing here has been saved or exported.'}
            </p>
            {previewQuery.data?.invoice_number_pending && (
              <p className="text-muted-foreground">
                The invoice-number column is blank on purpose: the next AR number is assigned when you actually
                export, so previewing never consumes one.
              </p>
            )}
            {previewQuery.data?.qbo_invoice_no != null && (
              <p className="text-muted-foreground">AR invoice number: {previewQuery.data.qbo_invoice_no}</p>
            )}
          </div>
        </div>

        {previewQuery.error ? (
          <ErrorState title="Couldn't build the preview" onRetry={() => previewQuery.refetch()} />
        ) : previewQuery.isLoading ? (
          <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : !parsed || parsed.body.length === 0 ? (
          <div className="rounded-lg border border-card-border p-6 text-center text-sm text-muted-foreground">
            This format produces no rows for this run.
            <span className="mt-1 block text-2xs">
              Expected for e.g. the bill.com worksheet when every line bills to Haven.
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {parsed.body.length} row{parsed.body.length === 1 ? '' : 's'} · {parsed.headers.length} columns
              </span>
              <span>{previewQuery.data?.line_count} invoice line(s) in this run</span>
            </div>
            {/* Wide CSVs scroll inside their own box so the dialog never does. */}
            <div className="max-h-[45vh] overflow-auto rounded-lg border border-card-border">
              <table className="w-full text-2xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    {parsed.headers.map((h, i) => (
                      <th key={i} className="whitespace-nowrap px-2 py-1.5 text-left font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.body.map((row, r) => (
                    <tr key={r} className="border-t border-card-border">
                      {parsed.headers.map((_, c) => (
                        <td key={c} className="whitespace-nowrap px-2 py-1 tabular-nums">{row[c] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={copyCsv} disabled={!previewQuery.data?.csv}>
            <Copy className="mr-1.5 h-4 w-4" />
            Copy CSV
          </Button>
          {approved && onDownload && (
            <Button
              size="sm"
              onClick={() => onDownload(format)}
              disabled={downloadingFormat === format}
              data-testid="button-preview-download"
            >
              {downloadingFormat === format
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                : <Download className="mr-1.5 h-4 w-4" />}
              Download this file
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
