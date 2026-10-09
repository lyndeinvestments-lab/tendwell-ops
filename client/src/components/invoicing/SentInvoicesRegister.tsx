import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Search, Send } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { isMissingSchemaError } from '@shared/billcom-send'
import { shortHash } from '@shared/sent-invoice-register'

/**
 * Sent invoices: the append-only register of client invoices that went out
 * (public.sent_invoices, migration 20261009h), newest first. Read-only; rows
 * are written only by Mark sent. A void entry is shown next to what it voids.
 *
 * useSentInvoicesRegister() returns null data while the table does not exist
 * yet (migration pending); the page then hides the view entirely.
 */

export interface SentInvoiceRow {
  id: string
  invoice_number: string
  billing_channel: string
  client_name: string
  period_start: string
  period_end: string
  total: number
  recipient: string | null
  sent_at: string
  sent_by: string | null
  pdf_sha256: string | null
  run_source: string | null
  voids_id: string | null
  note: string | null
}

const REGISTER_LIMIT = 1000

export function useSentInvoicesRegister() {
  return useQuery<SentInvoiceRow[] | null>({
    queryKey: ['invoicing-sent-invoices'],
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sent_invoices')
        .select('id, invoice_number, billing_channel, client_name, period_start, period_end, total, recipient, sent_at, sent_by, pdf_sha256, run_source, voids_id, note')
        .order('sent_at', { ascending: false })
        .limit(REGISTER_LIMIT)
      if (error) {
        if (isMissingSchemaError(error)) return null
        throw error
      }
      return (data ?? []) as SentInvoiceRow[]
    },
  })
}

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '-' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number)
  return y && m && day ? new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : d
}
const fmtDateTime = (d: string) =>
  new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const CHANNEL_LABEL: Record<string, string> = { bill_com: 'bill.com', qbo_haven: 'QBO (Haven)' }
const SOURCE_LABEL: Record<string, string> = { vendor_portal: 'Vendor portal', vendor_csv: 'Vendor CSV', generated: 'Generated' }

export function SentInvoicesRegister() {
  const query = useSentInvoicesRegister()
  const [search, setSearch] = useState('')

  const rows = query.data ?? []
  const voided = useMemo(() => new Set(rows.filter(r => r.voids_id).map(r => r.voids_id as string)), [rows])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.invoice_number.toLowerCase().includes(q) ||
      r.client_name.toLowerCase().includes(q) ||
      (r.recipient ?? '').toLowerCase().includes(q))
  }, [rows, search])

  if (query.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground p-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading the register…</div>
  }
  if (query.error) {
    return <ErrorState title="Couldn't load sent invoices" onRetry={() => query.refetch()} />
  }

  return (
    <div className="space-y-3" data-testid="sent-invoices-register">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">
          Every client invoice marked sent, from vendor CSV, generated and vendor-portal runs alike. Entries can't be edited or deleted.
        </p>
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Number, client or recipient"
            className="h-8 pl-8 text-sm"
            data-testid="input-sent-invoices-search"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Send}
          title={rows.length === 0 ? 'No invoices recorded yet' : 'No matches'}
          description={rows.length === 0 ? 'Client invoices appear here once they are marked sent on an approved run.' : 'Try a different number, client or recipient.'}
        />
      ) : (
        <div className="rounded-2xl border border-card-border shadow-sm overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Number</th>
                  <th className="px-3 py-2 font-medium">Client</th>
                  <th className="px-3 py-2 font-medium">Period</th>
                  <th className="px-3 py-2 font-medium text-right">Total</th>
                  <th className="px-3 py-2 font-medium">Recipient</th>
                  <th className="px-3 py-2 font-medium">Sent</th>
                  <th className="px-3 py-2 font-medium">PDF hash</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-t border-border/60 hover:bg-muted/30" data-testid={`sent-invoice-${r.id}`}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <p className="font-medium tabular-nums">#{r.invoice_number}</p>
                      <p className="text-2xs text-muted-foreground">
                        {CHANNEL_LABEL[r.billing_channel] ?? r.billing_channel}
                        {r.run_source ? ` · ${SOURCE_LABEL[r.run_source] ?? r.run_source}` : ''}
                      </p>
                      {r.voids_id && <StatusBadge tone="destructive" className="mt-0.5">Void entry</StatusBadge>}
                      {voided.has(r.id) && <StatusBadge tone="warning" className="mt-0.5">Voided</StatusBadge>}
                    </td>
                    <td className="px-3 py-2 max-w-48">
                      <p className="truncate" title={r.client_name}>{r.client_name}</p>
                      {r.note && <p className="text-2xs text-muted-foreground truncate" title={r.note}>{r.note}</p>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(r.period_start)} to {fmtDate(r.period_end)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.total)}</td>
                    <td className="px-3 py-2 max-w-48 truncate" title={r.recipient ?? undefined}>{r.recipient ?? <span className="text-muted-foreground">-</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <p>{fmtDateTime(r.sent_at)}</p>
                      {r.sent_by && <p className="text-2xs text-muted-foreground">{r.sent_by}</p>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-2xs" title={r.pdf_sha256 ?? 'No PDF fingerprint recorded'}>
                      {r.pdf_sha256 ? shortHash(r.pdf_sha256) : <span className="text-muted-foreground font-sans">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length >= REGISTER_LIMIT && (
            <p className="px-3 py-2 text-2xs text-muted-foreground border-t border-border/60">Showing the latest {REGISTER_LIMIT} entries.</p>
          )}
        </div>
      )}
    </div>
  )
}
