import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import { Loader2, Trash2, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { ErrorState } from '@/components/ErrorState'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { localISODate } from '@/lib/local-date'
import { readXlsxFirstSheet } from '@/lib/xlsx-lite'
import { isMissingSchemaError } from '@shared/billcom-send'
import { matchRateProperty, parseRateRows, type ImportProblem, type ImportedRateRow, type PropertyRef } from '@shared/reservation-rates'

/**
 * Special cleaning rates on specific guest reservations (client_reservation_rates).
 * The invoice engine bills the special rate on the clean after the listed
 * stay checks out, on every generate / reconcile. Imported from the client's
 * own list (.xlsx or .csv: listing, confirmation code, check-in, check-out,
 * address, normal rate, special rate).
 */

const db = supabase as any

interface RateRow {
  id: string
  property_id: number
  confirmation_code: string
  listing_nickname: string | null
  checkin_date: string
  checkout_date: string
  standard_charge: number | null
  special_charge: number
  properties: { name: string } | Array<{ name: string }> | null
}

interface PreviewRow { row: ImportedRateRow; property: PropertyRef | null; existing: boolean }

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '-' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtDay = (d: string) => {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const propName = (r: RateRow) => (Array.isArray(r.properties) ? r.properties[0]?.name : r.properties?.name) ?? `Property #${r.property_id}`

export function ReservationRatesCard({ isAdmin, userLabel }: { isAdmin: boolean; userLabel: string }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [showPast, setShowPast] = useState(false)
  const [preview, setPreview] = useState<{ fileName: string; rows: PreviewRow[]; problems: ImportProblem[] } | null>(null)
  const [reading, setReading] = useState(false)

  const ratesQuery = useQuery<{ available: boolean; rows: RateRow[] }>({
    queryKey: ['task-audit', 'reservation-rates'],
    queryFn: async () => {
      const { data, error } = await db
        .from('client_reservation_rates')
        .select('id, property_id, confirmation_code, listing_nickname, checkin_date, checkout_date, standard_charge, special_charge, properties(name)')
        .order('checkout_date', { ascending: true })
        .limit(2000)
      if (error) {
        if (isMissingSchemaError(error)) return { available: false, rows: [] }
        throw error
      }
      return { available: true, rows: (data ?? []) as RateRow[] }
    },
  })
  const propsQuery = useQuery<PropertyRef[]>({
    queryKey: ['task-audit', 'reservation-rate-properties'],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await db.from('properties').select('id, name, address').is('deleted_at', null).limit(5000)
      if (error) throw error
      return (data ?? []) as PropertyRef[]
    },
  })

  const today = localISODate()
  const rows = ratesQuery.data?.rows ?? []
  const shown = useMemo(() => rows.filter(r => showPast || r.checkout_date >= today), [rows, showPast, today])
  const pastCount = rows.length - rows.filter(r => r.checkout_date >= today).length

  async function onFile(file: File) {
    setReading(true)
    try {
      let table: unknown[][]
      if (/\.xlsx$/i.test(file.name)) {
        table = await readXlsxFirstSheet(file)
      } else {
        const text = await file.text()
        table = Papa.parse<unknown[]>(text, { skipEmptyLines: true }).data
      }
      const { rows: parsed, problems } = parseRateRows(table)
      const props = propsQuery.data ?? []
      const have = new Set(rows.map(r => `${r.property_id}|${r.confirmation_code.toLowerCase()}`))
      setPreview({
        fileName: file.name,
        problems,
        rows: parsed.map(row => {
          const property = matchRateProperty(row, props)
          return { row, property, existing: !!property && have.has(`${property.id}|${row.confirmationCode.toLowerCase()}`) }
        }),
      })
    } catch (e) {
      toast({ title: 'Could not read the file', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setReading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const importRows = useGuardedMutation<number, Error, PreviewRow[]>('invoicing', {
    mutationFn: async (items) => {
      const payload = items.filter(i => i.property).map(i => ({
        property_id: i.property!.id,
        confirmation_code: i.row.confirmationCode,
        listing_nickname: i.row.nickname,
        checkin_date: i.row.checkin,
        checkout_date: i.row.checkout,
        standard_charge: i.row.standardCharge,
        special_charge: i.row.specialCharge,
        created_by: userLabel,
        updated_by: userLabel,
      }))
      if (payload.length === 0) return 0
      const { error } = await db.from('client_reservation_rates').upsert(payload, { onConflict: 'property_id,confirmation_code' })
      if (error) throw error
      return payload.length
    },
    onSuccess: (n) => {
      toast({ title: `${n} special rate${n === 1 ? '' : 's'} saved`, description: 'They apply on the next generate or reconcile of an invoice covering those checkouts.' })
      setPreview(null)
      qc.invalidateQueries({ queryKey: ['task-audit', 'reservation-rates'] })
    },
    onError: (e) => { if (e.message !== 'edit_blocked') toast({ title: 'Import failed', description: e.message, variant: 'destructive' }) },
  })

  const remove = useGuardedMutation<void, Error, RateRow>('invoicing', {
    mutationFn: async (r) => {
      const { error } = await db.from('client_reservation_rates').delete().eq('id', r.id)
      if (error) throw error
    },
    onSuccess: () => { toast({ title: 'Special rate removed' }); qc.invalidateQueries({ queryKey: ['task-audit', 'reservation-rates'] }) },
    onError: (e) => { if (e.message !== 'edit_blocked') toast({ title: 'Remove failed', description: e.message, variant: 'destructive' }) },
  })

  const matched = preview?.rows.filter(r => r.property) ?? []
  const unmatched = preview?.rows.filter(r => !r.property) ?? []

  return (
    <Card className="border-card-border shadow-sm" data-testid="audit-reservation-rates-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-medium">Special reservation rates</p>
            <p className="text-xs text-muted-foreground">
              Discounted cleans for specific guest stays. The clean after the guest checks out (that day, or the next if none) is billed at the special rate on every generate or reconcile, and shows "Special rate" on the line. Cleaner pay does not change.
              {!isAdmin && <span className="text-warning"> Only admins can change these.</span>}
            </p>
          </div>
          {isAdmin && ratesQuery.data?.available && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f) }}
                data-testid="input-reservation-rates-file"
              />
              <Button size="sm" onClick={() => fileRef.current?.click()} disabled={reading || propsQuery.isLoading} data-testid="button-import-reservation-rates">
                {reading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />} Import list (.xlsx or .csv)
              </Button>
            </>
          )}
        </div>

        {ratesQuery.error ? (
          <ErrorState title="Couldn't load special rates" description={(ratesQuery.error as Error).message} onRetry={() => ratesQuery.refetch()} />
        ) : ratesQuery.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !ratesQuery.data?.available ? (
          <p className="text-sm text-muted-foreground py-2">Not set up yet: needs migration 20261012c_client_reservation_rates.sql.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No special rates. Every clean bills at the normal price.</p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{rows.length - pastCount} upcoming · {pastCount} past</span>
              {pastCount > 0 && (
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setShowPast(v => !v)}>
                  {showPast ? 'Hide past' : 'Show past'}
                </Button>
              )}
            </div>
            <div className="overflow-auto max-h-80">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1.5 pr-3 font-medium">Property</th>
                    <th className="py-1.5 pr-3 font-medium">Reservation</th>
                    <th className="py-1.5 pr-3 font-medium">Stay</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Normal</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Special</th>
                    {isAdmin && <th />}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(r => (
                    <tr key={r.id} className="border-t border-border/60">
                      <td className="py-1.5 pr-3">{propName(r)}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs">{r.confirmation_code}</td>
                      <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{fmtDay(r.checkin_date)} → <span className="font-medium">{fmtDay(r.checkout_date)}</span></td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{fmtMoney(r.standard_charge)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums font-medium">{fmtMoney(r.special_charge)}</td>
                      {isAdmin && (
                        <td className="py-1.5 text-right">
                          <Button size="sm" variant="ghost" className="h-6 px-1.5" title="Remove" disabled={remove.isPending} onClick={() => remove.mutate(r)} data-testid={`button-remove-reservation-rate-${r.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={preview != null} onOpenChange={open => { if (!open) setPreview(null) }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import special rates</DialogTitle>
            <DialogDescription>
              {preview?.fileName}: {matched.length} reservation{matched.length === 1 ? '' : 's'} ready
              {unmatched.length > 0 && `, ${unmatched.length} with no matching property (skipped)`}
              {preview?.problems.length ? `, ${preview.problems.length} row${preview.problems.length === 1 ? '' : 's'} not readable` : ''}.
              A reservation already on file is updated, not duplicated.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-auto text-xs space-y-2">
            {preview?.problems.map(p => (
              <p key={`p${p.row}`} className="text-destructive">Row {p.row}: {p.message}</p>
            ))}
            <table className="w-full">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-2 font-medium">Listing</th>
                  <th className="py-1 pr-2 font-medium">Ops property</th>
                  <th className="py-1 pr-2 font-medium">Reservation</th>
                  <th className="py-1 pr-2 font-medium">Checkout</th>
                  <th className="py-1 pr-2 font-medium text-right">Rate</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {preview?.rows.map(p => (
                  <tr key={`${p.row.row}`} className="border-t border-border/60">
                    <td className="py-1 pr-2">{p.row.nickname ?? p.row.address ?? '-'}</td>
                    <td className="py-1 pr-2">{p.property?.name ?? <span className="text-destructive">no match</span>}</td>
                    <td className="py-1 pr-2 font-mono">{p.row.confirmationCode}</td>
                    <td className="py-1 pr-2 whitespace-nowrap">{fmtDay(p.row.checkout)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{fmtMoney(p.row.standardCharge)} → {fmtMoney(p.row.specialCharge)}</td>
                    <td className="py-1">{p.property && <StatusBadge tone={p.existing ? 'neutral' : 'info'}>{p.existing ? 'update' : 'new'}</StatusBadge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>Cancel</Button>
            <Button disabled={matched.length === 0 || importRows.isPending} onClick={() => preview && importRows.mutate(preview.rows)} data-testid="button-confirm-reservation-rates">
              {importRows.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Save {matched.length} rate{matched.length === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
