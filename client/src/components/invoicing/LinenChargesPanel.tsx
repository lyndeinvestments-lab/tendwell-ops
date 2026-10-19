// Linen onboarding charges (linen_charges + linen_charge_installments).
//
// Stocking a property for the linen program is a one-time charge to the
// client, locked here at the figure the client agreed to (or waived, with a
// reason). It is billed automatically: when a run that bills the property is
// approved, api/invoices/approve.ts adds the next payment as a client-only
// "Linen Onboarding" line (1 payment by default, or a plan spread one per
// month). A client-wide charge (Hostimo's portfolio deal) bills on any of the
// client's invoices. This panel lists what is scheduled, billed and waived,
// and which linen properties still have no decision.
//
// Client money: the tables are finance-only in the database (migration
// 20261019a), and the browser writes only through linen_charge_save /
// linen_charge_void, which run under the caller's own RLS.

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { useAppSettings } from '@/hooks/use-app-settings'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { ErrorState } from '@/components/ErrorState'
import { StatusBadge } from '@/components/StatusBadge'
import { SearchSelect } from '@/components/issues/SearchSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Ban, ChevronDown, ChevronRight, ExternalLink, Loader2, Pencil, Plus } from 'lucide-react'
import { linenCostsFromSettings, suggestedLinenFee } from '@/lib/linen-onboarding'
import {
  chargeTotals, linenChargeLabel, splitInstallments,
  type LinenChargeStatus, type LinenInstallmentStatus,
} from '@shared/linen-charges'

// The new tables are not in shared/database.types.ts yet.
const db = supabase as any

export const LINEN_CHARGES_KEY = ['invoicing', 'linen-charges'] as const

/** Stages where a linen property should have a decision. */
const DECISION_STAGES = new Set(['Onboarding', 'Active', 'Offboarding'])

interface ContactLite { id: string; full_name: string | null; company: string | null }

interface Installment {
  id: string
  seq: number
  amount: number | string
  bill_from: string | null
  status: LinenInstallmentStatus
  service_month: string | null
  external_ref: string | null
  invoice_runs: { invoice_number: string | null; qbo_invoice_no: number | null } | Array<{ invoice_number: string | null; qbo_invoice_no: number | null }> | null
}

interface LinenCharge {
  id: string
  contact_id: string | null
  property_id: number | null
  label: string | null
  sets: number | null
  suggested_amount: number | string | null
  amount: number | string
  payments: number
  status: LinenChargeStatus
  waive_reason: string | null
  note: string | null
  source_link: string | null
  created_by: string | null
  created_at: string
  contacts: ContactLite | ContactLite[] | null
  properties: { id: number; name: string | null } | Array<{ id: number; name: string | null }> | null
  linen_charge_installments: Installment[] | null
}

/** A linen-program property, with what the suggested fee needs. */
interface LinenProperty {
  id: number
  name: string | null
  contact_id: string | null
  king_beds: number | null
  queen_beds: number | null
  full_beds: number | null
  twin_beds: number | null
  number_of_beds: number | null
  full_baths: number | null
  half_baths: number | null
  hot_tub: boolean | null
  pool: boolean | null
  guest_count: number | null
  linen_onboarding_sets: number | null
  linen_onboarding_comforters: boolean | null
  linen_onboarding_fee: number | string | null
  pipeline_stages: { name: string } | Array<{ name: string }> | null
  contacts: ContactLite | ContactLite[] | null
}

const LINEN_PROPERTY_SELECT = 'id, name, contact_id, king_beds, queen_beds, full_beds, twin_beds, number_of_beds, full_baths, half_baths, hot_tub, pool, guest_count, linen_onboarding_sets, linen_onboarding_comforters, linen_onboarding_fee, pipeline_stages(name), contacts:contact_id(id, full_name, company)'

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

/** The table (or the function) is not there yet: migration 20261019a is not applied. */
function isMissingTable(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false
  return ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(e.code ?? '') ||
    /does not exist|could not find the (table|function)|schema cache/i.test(e.message ?? '')
}

class MissingTableError extends Error {}

/** Where each billed payment went: "$611.67 on QBO 1102" / the outside reference. */
function billedRefs(c: LinenCharge): string[] {
  return (c.linen_charge_installments ?? [])
    .filter(i => i.status !== 'pending')
    .sort((a, b) => a.seq - b.seq)
    .map(i => {
      const run = one(i.invoice_runs)
      const where = i.status === 'billed_external'
        ? (i.external_ref ?? 'outside Ops')
        : run?.qbo_invoice_no != null ? `QBO ${run.qbo_invoice_no}` : run?.invoice_number ? `run ${run.invoice_number}` : 'an approved run'
      return `${c.payments > 1 ? `#${i.seq} ` : ''}${fmtMoney(Number(i.amount))} on ${where}`
    })
}

export function LinenChargesPanel({ userLabel }: { userLabel: string }) {
  const [editing, setEditing] = useState<{ charge?: LinenCharge; propertyId?: number } | null>(null)
  const [voiding, setVoiding] = useState<LinenCharge | null>(null)
  const [showUndecided, setShowUndecided] = useState(false)

  // Deep link from the onboarding checklist: /invoicing?linen=<property id>.
  useEffect(() => {
    try {
      const id = Number(new URLSearchParams(window.location.search).get('linen'))
      if (Number.isInteger(id) && id > 0) setEditing({ propertyId: id })
    } catch { /* no URL params */ }
  }, [])

  const chargesQuery = useQuery<LinenCharge[]>({
    queryKey: [...LINEN_CHARGES_KEY, 'list'],
    queryFn: async () => {
      const { data, error } = await db
        .from('linen_charges')
        .select('id, contact_id, property_id, label, sets, suggested_amount, amount, payments, status, waive_reason, note, source_link, created_by, created_at, contacts:contact_id(id, full_name, company), properties:property_id(id, name), linen_charge_installments(id, seq, amount, bill_from, status, service_month, external_ref, invoice_runs:run_id(invoice_number, qbo_invoice_no))')
        .neq('status', 'void')
        .order('created_at')
        .range(0, 999)
      if (error) {
        if (isMissingTable(error)) throw new MissingTableError(error.message)
        throw new Error(error.message)
      }
      return (data ?? []) as LinenCharge[]
    },
    retry: (count, err) => !(err instanceof MissingTableError) && count < 2,
  })

  const propertiesQuery = useQuery<LinenProperty[]>({
    queryKey: [...LINEN_CHARGES_KEY, 'properties'],
    queryFn: async () => {
      const { data, error } = await db
        .from('properties')
        .select(LINEN_PROPERTY_SELECT)
        .eq('linen_program', true)
        .is('archived_at', null)
        .order('name')
        .range(0, 1999)
      if (error) throw new Error(error.message)
      return (data ?? []) as LinenProperty[]
    },
    staleTime: 60_000,
  })

  const firstCleanQuery = useQuery<Map<number, string>>({
    queryKey: [...LINEN_CHARGES_KEY, 'first-clean'],
    queryFn: async () => {
      const { data, error } = await db.from('property_first_tendwell_clean').select('property_id, first_clean_date').range(0, 4999)
      if (error) throw new Error(error.message)
      return new Map((data ?? []).map((r: { property_id: number; first_clean_date: string }) => [r.property_id, r.first_clean_date]))
    },
    staleTime: 300_000,
  })

  const charges = chargesQuery.data ?? []
  const totals = useMemo(() => {
    let owed = 0
    let billed = 0
    for (const c of charges) {
      if (c.status === 'waived') continue
      const t = chargeTotals(c.linen_charge_installments ?? [])
      owed += t.owed
      billed += t.billed
    }
    return { owed: Math.round(owed * 100) / 100, billed: Math.round(billed * 100) / 100 }
  }, [charges])

  // Linen properties in onboarding/live stages with no decision: no charge of
  // their own and no client-wide charge from their client.
  const undecided = useMemo(() => {
    const own = new Set(charges.filter(c => c.property_id != null).map(c => c.property_id as number))
    const clientWide = new Set(charges.filter(c => c.property_id == null && c.contact_id).map(c => c.contact_id as string))
    return (propertiesQuery.data ?? [])
      .filter(p => DECISION_STAGES.has(one(p.pipeline_stages)?.name ?? ''))
      .filter(p => !own.has(p.id) && !(p.contact_id && clientWide.has(p.contact_id)))
      .map(p => ({ p, firstClean: firstCleanQuery.data?.get(p.id) ?? null }))
      // Not cleaned yet first: those are the ones that will bill on a first invoice.
      .sort((a, b) => (a.firstClean ? 1 : 0) - (b.firstClean ? 1 : 0) || (a.p.name ?? '').localeCompare(b.p.name ?? ''))
  }, [charges, propertiesQuery.data, firstCleanQuery.data])

  const notSetUp = chargesQuery.error instanceof MissingTableError
  const live = charges.filter(c => c.status !== 'waived')
  const waived = charges.filter(c => c.status === 'waived')

  return (
    <Card className="border-card-border shadow-sm" data-testid="linen-charges-panel">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">
              Linen charges
              {live.length > 0 && (
                <span className="ml-2 text-muted-foreground font-normal tabular-nums" data-testid="linen-charges-totals">
                  {fmtMoney(totals.owed)} owed · {fmtMoney(totals.billed)} billed
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              One-time linen onboarding fees, locked at the agreed figure. Each payment goes on the client's next approved invoice that bills the property (a payment plan: one per month).
            </p>
          </div>
          {!notSetUp && (
            <Button size="sm" variant="outline" onClick={() => setEditing({})} data-testid="button-add-linen-charge">
              <Plus className="w-4 h-4 mr-1.5" /> Add linen charge
            </Button>
          )}
        </div>

        {notSetUp ? (
          <p className="text-sm text-muted-foreground py-1" data-testid="linen-charges-not-set-up">
            Linen charges are not set up yet: the database migration (20261019a_linen_charges) still needs to be applied.
          </p>
        ) : chargesQuery.error ? (
          <ErrorState title="Couldn't load linen charges" description={(chargesQuery.error as Error).message} onRetry={() => chargesQuery.refetch()} />
        ) : chargesQuery.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <>
            {charges.length === 0 ? (
              <p className="text-sm text-muted-foreground py-1">No linen charges recorded yet.</p>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">Client · property</th>
                      <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="px-2 py-1.5 font-medium">Billed</th>
                      <th className="px-2 py-1.5 w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {[...live, ...waived].map(c => {
                      const t = chargeTotals(c.linen_charge_installments ?? [])
                      const prop = one(c.properties)
                      const refs = billedRefs(c)
                      return (
                        <tr key={c.id} className="border-t border-border/60 align-top" data-testid={`linen-charge-${c.id}`}>
                          <td className="px-2 py-1.5">
                            <span className="font-medium">{clientName(one(c.contacts))}</span>
                            <span className="block text-2xs text-muted-foreground">
                              {prop?.name ?? 'All properties (client-wide)'}{c.label ? ` · ${c.label}` : ''}
                            </span>
                            {c.note && <span className="block text-2xs text-muted-foreground line-clamp-2" title={c.note}>{c.note}</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                            {c.status === 'waived' ? <span className="text-muted-foreground">-</span> : (
                              <>
                                {fmtMoney(Number(c.amount))}
                                {c.payments > 1 && <span className="block text-2xs text-muted-foreground">{c.payments} payments</span>}
                              </>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            {c.status === 'waived' ? (
                              <>
                                <StatusBadge tone="neutral">Waived</StatusBadge>
                                <span className="block text-2xs text-muted-foreground max-w-64">{c.waive_reason}</span>
                              </>
                            ) : t.next ? (
                              <>
                                <StatusBadge tone="info">Scheduled</StatusBadge>
                                <span className="block text-2xs text-muted-foreground">
                                  Next: {fmtMoney(t.next.amount)}{c.payments > 1 ? ` (payment ${t.next.seq} of ${c.payments})` : ''}
                                  {t.next.billFrom ? `, on the first invoice approved from ${fmtDate(t.next.billFrom)}` : ', on the next invoice'}
                                </span>
                              </>
                            ) : (
                              <StatusBadge tone="success">Billed</StatusBadge>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-2xs text-muted-foreground">
                            {refs.length === 0 ? '-' : refs.map(r => <span key={r} className="block whitespace-nowrap">{r}</span>)}
                            {c.source_link && isHttpUrl(c.source_link) && (
                              <a href={c.source_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                Agreement <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing({ charge: c })} aria-label="Edit linen charge" data-testid={`linen-charge-edit-${c.id}`}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setVoiding(c)} aria-label="Void linen charge" data-testid={`linen-charge-void-${c.id}`}>
                              <Ban className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {undecided.length > 0 && (
              <div className="rounded-lg border border-warning/40 bg-warning/5">
                <button
                  type="button"
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-sm text-left"
                  onClick={() => setShowUndecided(v => !v)}
                  data-testid="linen-undecided-toggle"
                >
                  {showUndecided ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="font-medium">{undecided.length} linen {undecided.length === 1 ? 'property has' : 'properties have'} no fee decision</span>
                  <span className="text-muted-foreground">({undecided.filter(u => !u.firstClean).length} not cleaned yet)</span>
                </button>
                {showUndecided && (
                  <ul className="px-3 pb-2 space-y-1">
                    {undecided.map(({ p, firstClean }) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 text-sm" data-testid={`linen-undecided-${p.id}`}>
                        <span>
                          {p.name}
                          <span className="text-2xs text-muted-foreground"> · {clientName(one(p.contacts))} · {one(p.pipeline_stages)?.name}
                            {firstClean ? ` · first clean ${fmtDate(firstClean)}` : ' · not cleaned yet'}</span>
                        </span>
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing({ propertyId: p.id })}>Set fee</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
      {editing && (
        <LinenChargeDialog
          userLabel={userLabel}
          charge={editing.charge}
          initialPropertyId={editing.propertyId}
          properties={propertiesQuery.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      {voiding && <VoidLinenChargeDialog charge={voiding} userLabel={userLabel} onClose={() => setVoiding(null)} />}
    </Card>
  )
}

function LinenChargeDialog({ userLabel, charge, initialPropertyId, properties, onClose }: {
  userLabel: string
  charge?: LinenCharge
  initialPropertyId?: number
  properties: LinenProperty[]
  onClose: () => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { getNumber } = useAppSettings()
  const costs = linenCostsFromSettings(getNumber)

  const locked = charge ? chargeTotals(charge.linen_charge_installments ?? []).billed > 0 : false
  const [clientWide, setClientWide] = useState(charge ? charge.property_id == null : false)
  const [propertyId, setPropertyId] = useState<number | null>(charge?.property_id ?? initialPropertyId ?? null)
  const [contactId, setContactId] = useState<string | null>(charge?.contact_id ?? null)
  const [waived, setWaived] = useState(charge?.status === 'waived')
  const [waiveReason, setWaiveReason] = useState(charge?.waive_reason ?? '')
  const [amount, setAmount] = useState(charge && charge.status !== 'waived' ? String(Number(charge.amount)) : '')
  const [payments, setPayments] = useState(String(charge && charge.payments > 0 ? charge.payments : 1))
  const firstPending = charge?.linen_charge_installments?.filter(i => i.status === 'pending').sort((a, b) => a.seq - b.seq)[0]
  const [billFrom, setBillFrom] = useState(firstPending?.bill_from ?? '')
  const [label, setLabel] = useState(charge?.label ?? '')
  const [note, setNote] = useState(charge?.note ?? '')
  const [sourceLink, setSourceLink] = useState(charge?.source_link ?? '')

  const property = properties.find(p => p.id === propertyId) ?? null
  const fee = property
    ? suggestedLinenFee(costs, property, {
      sets: property.linen_onboarding_sets ?? undefined,
      comforters: !!property.linen_onboarding_comforters,
      override: property.linen_onboarding_fee as number | string | null,
    })
    : null

  // Picking a property prefills its client, the figure on file (an override
  // when set, else the calculated suggestion) and what was stocked.
  useEffect(() => {
    if (charge || !property) return
    setContactId(property.contact_id)
    if (fee) {
      setAmount(fee.effective > 0 ? fee.effective.toFixed(2) : '')
      if (fee.isOverridden && fee.effective === 0) setWaived(true)
    }
    setLabel(linenChargeLabel(property.linen_onboarding_sets ?? 3, property.linen_onboarding_comforters))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, properties.length])

  const contactsQuery = useQuery<ContactLite[]>({
    queryKey: ['invoicing', 'credits', 'contacts'],
    enabled: clientWide && !charge,
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

  const propertyOptions = useMemo(
    () => properties.map(p => ({ value: String(p.id), label: `${p.name ?? `#${p.id}`} · ${clientName(one(p.contacts))}` })),
    [properties],
  )
  const contactOptions = useMemo(
    () => (contactsQuery.data ?? []).map(c => ({ value: c.id, label: clientName(c) })).sort((a, b) => a.label.localeCompare(b.label)),
    [contactsQuery.data],
  )

  const n = Number(amount)
  const k = Number(payments)
  const amountOk = waived || (amount.trim() !== '' && Number.isFinite(n) && n > 0 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6)
  const paymentsOk = waived || (Number.isInteger(k) && k >= 1 && k <= 12)
  const preview = !waived && amountOk && paymentsOk ? splitInstallments(n, k) : []

  const save = useGuardedMutation<void, Error, void>('invoicing', {
    mutationFn: async () => {
      if (!clientWide && !propertyId) throw new Error('Pick the property (or make it client-wide)')
      if (!contactId) throw new Error(clientWide ? 'Pick the client' : 'That property has no client: set its client first')
      if (waived && !waiveReason.trim()) throw new Error('Say why the fee is waived')
      if (!amountOk) throw new Error('Enter the amount in dollars and cents')
      if (!paymentsOk) throw new Error('Payments must be between 1 and 12')
      if (sourceLink.trim() && !isHttpUrl(sourceLink)) throw new Error('The link must start with http:// or https://')
      const { error } = await db.rpc('linen_charge_save', {
        p_id: charge?.id ?? null,
        p_contact_id: contactId,
        p_property_id: clientWide ? null : propertyId,
        p_amount: waived ? 0 : Math.round(n * 100) / 100,
        p_payments: waived ? 0 : k,
        p_waived: waived,
        p_waive_reason: waived ? waiveReason.trim() : null,
        p_label: label.trim() || null,
        p_sets: property?.linen_onboarding_sets ?? null,
        p_suggested: fee ? Math.round(fee.suggested * 100) / 100 : null,
        p_note: note.trim() || null,
        p_source_link: sourceLink.trim() || null,
        p_bill_from: waived || !billFrom ? null : billFrom,
        p_actor: userLabel,
      })
      if (error) {
        if (isMissingTable(error)) throw new Error('Linen charges are not set up yet (migration 20261019a is not applied).')
        if (error.code === '23505') throw new Error('That property already has a linen charge: edit it instead.')
        throw new Error(error.message)
      }
    },
    onSuccess: () => {
      toast({ title: waived ? 'Linen fee waived' : 'Linen charge saved', description: waived ? undefined : 'It goes on the next approved invoice that bills it.' })
      qc.invalidateQueries({ queryKey: LINEN_CHARGES_KEY })
      qc.invalidateQueries({ queryKey: ['/supabase/onboarding-readiness'] })
      onClose()
    },
    onError: (e) => { if (e.message !== 'edit_blocked') toast({ title: 'Save failed', description: e.message, variant: 'destructive' }) },
  })

  const chargeProp = charge ? one(charge.properties) : null

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{charge ? 'Edit linen charge' : 'Linen charge'}</DialogTitle>
          <DialogDescription>
            {locked
              ? 'Part of this charge is already billed, so only the notes can change. Void it to stop the rest.'
              : 'Lock the linen onboarding fee the client agreed to, or waive it. It bills on the next approved invoice that bills the property.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {charge ? (
            <p className="text-sm">
              <span className="font-medium">{clientName(one(charge.contacts))}</span>
              <span className="text-muted-foreground"> · {chargeProp?.name ?? 'All properties (client-wide)'}</span>
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="linen-client-wide" className="text-sm">Client-wide (one deal covering all of a client's properties)</Label>
                <Switch id="linen-client-wide" checked={clientWide} onCheckedChange={setClientWide} />
              </div>
              {clientWide ? (
                <div className="space-y-1">
                  <Label>Client</Label>
                  <SearchSelect
                    options={contactOptions}
                    value={contactId ?? ''}
                    onSelect={v => setContactId(v || null)}
                    placeholder={contactsQuery.isLoading ? 'Loading clients…' : 'Pick a client'}
                    searchPlaceholder="Search clients"
                    emptyText="No client found"
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label>Property</Label>
                  <SearchSelect
                    options={propertyOptions}
                    value={propertyId != null ? String(propertyId) : ''}
                    onSelect={v => setPropertyId(v ? Number(v) : null)}
                    placeholder="Pick a linen-program property"
                    searchPlaceholder="Search properties"
                    emptyText="No linen-program property found"
                  />
                </div>
              )}
            </>
          )}
          {fee && !clientWide && (
            <p className="text-2xs text-muted-foreground">
              Calculated today: {fmtMoney(fee.suggested)}{fee.isOverridden ? ` · quote override on file: ${fmtMoney(fee.effective)}` : ''}
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="linen-waive" className="text-sm">Waive the fee</Label>
            <Switch id="linen-waive" checked={waived} onCheckedChange={setWaived} disabled={locked} />
          </div>

          {waived ? (
            <div className="space-y-1">
              <Label>Why it is waived</Label>
              <Input value={waiveReason} onChange={e => setWaiveReason(e.target.value)} placeholder="e.g. owner keeps their own linens" disabled={locked} />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label>Amount</Label>
                <Input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} disabled={locked} data-testid="input-linen-amount" />
              </div>
              <div className="space-y-1">
                <Label>Payments</Label>
                <Input type="number" min="1" max="12" step="1" value={payments} onChange={e => setPayments(e.target.value)} disabled={locked} />
              </div>
              <div className="space-y-1">
                <Label>Not before</Label>
                <Input type="date" value={billFrom} onChange={e => setBillFrom(e.target.value)} disabled={locked} />
              </div>
              {preview.length > 1 && (
                <p className="col-span-3 text-2xs text-muted-foreground tabular-nums">
                  {preview.map(fmtMoney).join(' + ')}, one per month on the client's first invoice that month.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label>Shown on the invoice</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. 3 sets" />
          </div>
          <div className="space-y-1">
            <Label>Note (internal)</Label>
            <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="What was agreed, and when" />
          </div>
          <div className="space-y-1">
            <Label>Link to the agreement (optional)</Label>
            <Input value={sourceLink} onChange={e => setSourceLink(e.target.value)} placeholder="https://mail.google.com/…" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-linen-charge">
            {save.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            {waived ? 'Record waiver' : 'Save charge'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function VoidLinenChargeDialog({ charge, userLabel, onClose }: { charge: LinenCharge; userLabel: string; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const t = chargeTotals(charge.linen_charge_installments ?? [])

  const doVoid = useGuardedMutation<void, Error, void>('invoicing', {
    mutationFn: async () => {
      if (!reason.trim()) throw new Error('Say why the charge is being voided')
      const { error } = await db.rpc('linen_charge_void', { p_id: charge.id, p_reason: reason.trim(), p_actor: userLabel })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      toast({ title: 'Linen charge voided' })
      qc.invalidateQueries({ queryKey: LINEN_CHARGES_KEY })
      qc.invalidateQueries({ queryKey: ['/supabase/onboarding-readiness'] })
      onClose()
    },
    onError: (e) => { if (e.message !== 'edit_blocked') toast({ title: 'Void failed', description: e.message, variant: 'destructive' }) },
  })

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Void linen charge</DialogTitle>
          <DialogDescription>
            {t.billed > 0
              ? `${fmtMoney(t.billed)} is already billed and stays billed; the ${fmtMoney(t.owed)} still owed will not be billed.`
              : 'Nothing has been billed yet; the charge will not be billed.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Why</Label>
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. client cancelled before onboarding" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={() => doVoid.mutate()} disabled={doVoid.isPending}>
            {doVoid.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Void charge
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
