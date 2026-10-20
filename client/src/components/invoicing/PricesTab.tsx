// Prices tab: every price that drives what a client is billed, in one place.
//
//   - Standard prices + which auxiliary categories are billable (app_settings)
//   - Client prices: per-client fee overrides and accepted price agreements
//   - Special reservation rates (client_reservation_rates)
//
// Code moved from the old Task audit view without behaviour changes. Editing
// stays admin-only (the cards read `isAdmin`; RLS is the real gate). A change
// applies the next time a run is generated or reconciled.

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/hooks/use-toast'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { ErrorState } from '@/components/ErrorState'
import { SearchSelect } from '@/components/issues/SearchSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ReservationRatesCard } from './ReservationRatesCard'
import {
  clientName, db, fetchAll, one, pricedServiceTypes, useAuxSettings, useClientAgreements, useFeeOverrides,
  type ClientFeeOverride, type ClientPriceAgreement, type AgreementsData, type ContactLite,
} from './pricing-data'
import {
  AUX_CATEGORIES,
  APP_SETTING_AUX_BILLABLE,
  APP_SETTING_EXTRA_PRICING,
  BILLABLE_AUX_CATEGORIES,
  isBillableCategory,
  resolveAuxSettings,
  type AuxBillingSettings,
  type AuxCategory,
} from '@shared/aux-tasks'
import { parseSourceLink, isHttpsLink } from '@shared/price-agreements'
import {
  ExternalLink, Loader2, Pencil, Plus, Trash2,
} from 'lucide-react'

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return '-'
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function PricesTab({ userLabel, isAdmin }: { userLabel: string; isAdmin: boolean }) {
  const qc = useQueryClient()
  const settingsQuery = useAuxSettings()
  const overridesQuery = useFeeOverrides()
  const agreementsQuery = useClientAgreements()
  const settings = settingsQuery.data ?? resolveAuxSettings()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['task-audit'] })
    qc.invalidateQueries({ queryKey: ['invoicing-runs'] })
  }

  return (
    <div className="space-y-4" data-testid="prices-tab">
      {settingsQuery.error ? (
        <ErrorState title="Couldn't load prices" onRetry={() => settingsQuery.refetch()} />
      ) : (
        <PricingCard settings={settings} isAdmin={isAdmin} onSaved={invalidate} />
      )}
      <ClientOverridesCard
        overrides={overridesQuery.data?.rows ?? []}
        hasEvidence={overridesQuery.data?.hasEvidence ?? false}
        loading={overridesQuery.isLoading}
        error={overridesQuery.error as Error | null}
        onRetry={() => overridesQuery.refetch()}
        settings={settings}
        isAdmin={isAdmin}
        userLabel={userLabel}
        onSaved={invalidate}
      />
      <ClientAgreementsCard
        data={agreementsQuery.data ?? null}
        loading={agreementsQuery.isLoading}
        error={agreementsQuery.error as Error | null}
        onRetry={() => agreementsQuery.refetch()}
        isAdmin={isAdmin}
        userLabel={userLabel}
      />
      <ReservationRatesCard isAdmin={isAdmin} userLabel={userLabel} />
    </div>
  )
}

// ── Pricing / billability settings ────────────────────────────────────────────

function PricingCard({ settings, isAdmin, onSaved }: { settings: AuxBillingSettings; isAdmin: boolean; onSaved: () => void }) {
  const { toast } = useToast()
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(BILLABLE_AUX_CATEGORIES.map(c => {
      const st = AUX_CATEGORIES[c].serviceType!
      const v = settings.pricing[st]
      return [st, v == null ? '' : String(v)]
    })),
  )
  // Hot-tub price per type; blank = same price with or without a tub.
  const [hotPrices, setHotPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(BILLABLE_AUX_CATEGORIES.map(c => {
      const st = AUX_CATEGORIES[c].serviceType!
      const v = settings.hotTubPricing[st]
      return [st, v == null ? '' : String(v)]
    })),
  )
  const [billable, setBillable] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(BILLABLE_AUX_CATEGORIES.map(c => [c, isBillableCategory(c, settings)])),
  )

  const save = useGuardedMutation<void, Error, void>('invoicing', {
    mutationFn: async () => {
      // Stored as { charge, hot_tub_charge } so the hot-tub price survives a
      // save; a bare number would mean "one price either way".
      const pricing: Record<string, { charge: number; hot_tub_charge: number | null } | null> = {}
      for (const [st, v] of Object.entries(prices)) {
        if (v.trim() === '') { pricing[st] = null; continue }
        const n = Number(v)
        if (!Number.isFinite(n) || n < 0) throw new Error(`"${v}" is not a valid price for ${st}`)
        const hv = (hotPrices[st] ?? '').trim()
        const h = hv === '' ? null : Number(hv)
        if (h != null && (!Number.isFinite(h) || h < 0)) throw new Error(`"${hv}" is not a valid hot tub price for ${st}`)
        pricing[st] = { charge: n, hot_tub_charge: h }
      }
      const { error } = await db.from('app_settings').upsert([
        { key: APP_SETTING_EXTRA_PRICING, value: JSON.stringify(pricing) },
        { key: APP_SETTING_AUX_BILLABLE, value: JSON.stringify(billable) },
      ], { onConflict: 'key' })
      if (error) throw error
    },
    onSuccess: () => { toast({ title: 'Pricing saved', description: 'Applies the next time a run is generated or reconciled.' }); onSaved() },
    onError: (e) => { if (e.message !== 'edit_blocked') toast({ title: 'Save failed', description: e.message, variant: 'destructive' }) },
  })

  return (
    <Card className="border-card-border shadow-sm" data-testid="audit-pricing-card">
      <CardContent className="p-4 space-y-3">
        <div>
          <p className="text-sm font-medium">Billable task pricing</p>
          <p className="text-xs text-muted-foreground">
            What each kind of completed task bills the client. A blank price still adds the line but queues it for a price. The second box is the price on a hot tub property (blank = same price). Untick a kind to stop billing it automatically. Vendor-invoice extras use the built-in list, which matches these defaults.
            {!isAdmin && <span className="text-warning"> Only admins can change these.</span>}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
          {BILLABLE_AUX_CATEGORIES.map(c => {
            const def = AUX_CATEGORIES[c]
            const st = def.serviceType!
            return (
              <div key={c} className="flex items-center gap-3 py-1 border-b border-border/40">
                <Checkbox checked={billable[c] ?? true} onCheckedChange={v => setBillable(b => ({ ...b, [c]: v === true }))} disabled={!isAdmin} data-testid={`pricing-billable-${c}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{def.label} <span className="text-muted-foreground">→ {st}</span></p>
                  <p className="text-2xs text-muted-foreground truncate" title={def.blurb}>{def.blurb}</p>
                </div>
                <div className="relative w-24">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <Input type="number" step="1" min="0" className="h-8 pl-5" value={prices[st] ?? ''} onChange={e => setPrices(p => ({ ...p, [st]: e.target.value }))} disabled={!isAdmin} placeholder="none" aria-label={`${st} price`} data-testid={`pricing-${c}`} />
                </div>
                <div className="relative w-24" title="Price on a property with a hot tub (blank = same price)">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-2xs text-muted-foreground">HT $</span>
                  <Input type="number" step="1" min="0" className="h-8 pl-9" value={hotPrices[st] ?? ''} onChange={e => setHotPrices(p => ({ ...p, [st]: e.target.value }))} disabled={!isAdmin} placeholder="same" aria-label={`${st} hot tub price`} data-testid={`pricing-hottub-${c}`} />
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-2xs text-muted-foreground">
          Never billed: {(Object.keys(AUX_CATEGORIES) as AuxCategory[]).filter(c => !AUX_CATEGORIES[c].serviceType && c !== 'clean' && c !== 'no_clean' && c !== 'unclassified').map(c => AUX_CATEGORIES[c].label).join(', ')}. Cleans bill through the vendor invoice.
        </p>
        {isAdmin && (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="pricing-save">
              {save.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Save pricing
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Client fee overrides ──────────────────────────────────────────────────────
//
// A client's negotiated price for a fee beats the standard list on every one
// of their properties — on vendor-invoice extras and on billable task lines
// alike. Changes are audit-logged by a DB trigger into activity_log.

/** Accepted date + source link, compact. The link renders only when it passes
 *  the same https rule the DB enforces. */
function EvidenceCell({ date, link }: { date: string | null | undefined; link: string | null | undefined }) {
  if (!date && !link) return <span className="text-muted-foreground">not recorded</span>
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {date ? fmtDate(date) : <span className="text-muted-foreground">no date</span>}
      {link && isHttpsLink(link) && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5" title={link}>
          source <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </span>
  )
}

function ClientOverridesCard({ overrides, hasEvidence, loading, error, onRetry, settings, isAdmin, userLabel, onSaved }: {
  overrides: ClientFeeOverride[]
  hasEvidence: boolean
  loading: boolean
  error: Error | null
  onRetry: () => void
  settings: AuxBillingSettings
  isAdmin: boolean
  userLabel: string
  onSaved: () => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<ClientFeeOverride | 'new' | null>(null)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['task-audit', 'fee-overrides'] })
    onSaved()
  }

  const remove = useGuardedMutation<void, Error, ClientFeeOverride>('invoicing', {
    mutationFn: async (o) => {
      const { error: e } = await db.from('client_fee_overrides').delete().eq('id', o.id)
      if (e) throw e
    },
    onSuccess: () => { toast({ title: 'Client price removed', description: 'Their properties go back to the standard price on the next reconcile.' }); refresh() },
    onError: (e) => { if (e.message !== 'edit_blocked') toast({ title: 'Remove failed', description: e.message, variant: 'destructive' }) },
  })

  const sorted = [...overrides].sort((a, b) =>
    clientName(one(a.contacts)).localeCompare(clientName(one(b.contacts))) || a.service_type.localeCompare(b.service_type))

  return (
    <Card className="border-card-border shadow-sm" data-testid="audit-overrides-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Client fee overrides</p>
            <p className="text-xs text-muted-foreground">
              A client's agreed price for a fee, used instead of the standard price on all of their properties (vendor-invoice extras and billed tasks). Applies the next time a run is generated or reconciled; approved and exported runs are not changed.
              {!isAdmin && <span className="text-warning"> Only admins can change these.</span>}
            </p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => setEditing('new')} data-testid="button-add-override">
              <Plus className="w-4 h-4 mr-1.5" /> Add client price
            </Button>
          )}
        </div>
        {error ? (
          <ErrorState title="Couldn't load client prices" description={error.message} onRetry={onRetry} />
        ) : loading ? (
          <Skeleton className="h-16 w-full" />
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No client-specific prices. Every client pays the standard price.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">Client</th>
                  <th className="px-2 py-1.5 font-medium">Fee</th>
                  <th className="px-2 py-1.5 font-medium text-right">Price</th>
                  <th className="px-2 py-1.5 font-medium text-right">With hot tub</th>
                  <th className="px-2 py-1.5 font-medium">Standard</th>
                  {hasEvidence && <th className="px-2 py-1.5 font-medium">Accepted</th>}
                  <th className="px-2 py-1.5 font-medium">Note</th>
                  <th className="px-2 py-1.5 w-20" />
                </tr>
              </thead>
              <tbody>
                {sorted.map(o => {
                  const std = settings.pricing[o.service_type]
                  const stdHot = settings.hotTubPricing[o.service_type]
                  return (
                    <tr key={o.id} className="border-t border-border/60" data-testid={`override-${o.id}`}>
                      <td className="px-2 py-1.5">{clientName(one(o.contacts))}</td>
                      <td className="px-2 py-1.5">{o.service_type}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(Number(o.charge))}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{o.hot_tub_charge == null ? <span className="text-muted-foreground">same</span> : fmtMoney(Number(o.hot_tub_charge))}</td>
                      <td className="px-2 py-1.5 text-2xs text-muted-foreground whitespace-nowrap">
                        {std == null ? 'not on the list, override ignored' : `${fmtMoney(std)}${stdHot != null ? ` / ${fmtMoney(stdHot)} HT` : ''}`}
                      </td>
                      {hasEvidence && <td className="px-2 py-1.5 text-2xs"><EvidenceCell date={o.accepted_date} link={o.source_link} /></td>}
                      <td className="px-2 py-1.5 max-w-48 truncate text-muted-foreground" title={o.note ?? ''}>{o.note ?? ''}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        {isAdmin && (
                          <>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(o)} aria-label="Edit client price" data-testid={`override-edit-${o.id}`}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(o)} aria-label="Remove client price" data-testid={`override-delete-${o.id}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {editing && (
        <OverrideDialog
          existing={editing === 'new' ? null : editing}
          taken={overrides}
          hasEvidence={hasEvidence}
          settings={settings}
          userLabel={userLabel}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
        />
      )}
    </Card>
  )
}

// ── Agreed client prices ──────────────────────────────────────────────────────
//
// What a client accepted (clean price, linen fee, onboarding fee), with when
// and where. These never change a price: reconcile compares each billed line
// against them and sends a difference over $0.01 to review
// (price_mismatch_agreement). Audit-logged by a DB trigger.

function ClientAgreementsCard({ data, loading, error, onRetry, isAdmin, userLabel }: {
  data: AgreementsData | null
  loading: boolean
  error: Error | null
  onRetry: () => void
  isAdmin: boolean
  userLabel: string
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<ClientPriceAgreement | 'new' | null>(null)
  const rows = data?.rows ?? []

  const refresh = () => qc.invalidateQueries({ queryKey: ['task-audit', 'price-agreements'] })

  const remove = useGuardedMutation<void, Error, ClientPriceAgreement>('invoicing', {
    mutationFn: async (a) => {
      const { error: e } = await db.from('client_price_agreements').delete().eq('id', a.id)
      if (e) throw e
    },
    onSuccess: () => { toast({ title: 'Agreement removed', description: 'Their lines are no longer checked against it.' }); refresh() },
    onError: (e) => { if (e.message !== 'edit_blocked') toast({ title: 'Remove failed', description: e.message, variant: 'destructive' }) },
  })

  const sorted = [...rows].sort((a, b) => clientName(one(a.contacts)).localeCompare(clientName(one(b.contacts))))
  const money = (v: number | null) => v == null ? <span className="text-muted-foreground">not agreed</span> : fmtMoney(Number(v))

  return (
    <Card className="border-card-border shadow-sm" data-testid="audit-agreements-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Agreed client prices</p>
            <p className="text-xs text-muted-foreground">
              The clean price, linen fee and onboarding fee a client accepted. These don't change any price: on the next generate or reconcile, a line that bills that client something different (by more than a cent) is held for review.
              {!isAdmin && <span className="text-warning"> Only admins can change these.</span>}
            </p>
          </div>
          {isAdmin && data?.available && (
            <Button size="sm" onClick={() => setEditing('new')} data-testid="button-add-agreement">
              <Plus className="w-4 h-4 mr-1.5" /> Add agreement
            </Button>
          )}
        </div>
        {error ? (
          <ErrorState title="Couldn't load agreed prices" description={error.message} onRetry={onRetry} />
        ) : loading ? (
          <Skeleton className="h-16 w-full" />
        ) : !data?.available ? (
          <p className="text-sm text-muted-foreground py-2">Not set up yet: agreed prices need migration 20261009f_client_agreed_prices.sql to be applied.</p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No agreed prices recorded. Nothing is checked.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">Client</th>
                  <th className="px-2 py-1.5 font-medium text-right">Clean</th>
                  <th className="px-2 py-1.5 font-medium text-right">Linen fee</th>
                  <th className="px-2 py-1.5 font-medium text-right">Onboarding fee</th>
                  <th className="px-2 py-1.5 font-medium">Accepted</th>
                  <th className="px-2 py-1.5 font-medium">Note</th>
                  <th className="px-2 py-1.5 w-20" />
                </tr>
              </thead>
              <tbody>
                {sorted.map(a => (
                  <tr key={a.id} className="border-t border-border/60" data-testid={`agreement-${a.id}`}>
                    <td className="px-2 py-1.5">{clientName(one(a.contacts))}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(a.accepted_clean_price)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(a.linen_fee)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(a.onboarding_fee)}</td>
                    <td className="px-2 py-1.5 text-2xs"><EvidenceCell date={a.accepted_date} link={a.source_link} /></td>
                    <td className="px-2 py-1.5 max-w-48 truncate text-muted-foreground" title={a.note ?? ''}>{a.note ?? ''}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {isAdmin && (
                        <>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(a)} aria-label="Edit agreement" data-testid={`agreement-edit-${a.id}`}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(a)} aria-label="Remove agreement" data-testid={`agreement-delete-${a.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {editing && (
        <AgreementDialog
          existing={editing === 'new' ? null : editing}
          taken={rows}
          userLabel={userLabel}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
        />
      )}
    </Card>
  )
}

function AgreementDialog({ existing, taken, userLabel, onClose, onSaved }: {
  existing: ClientPriceAgreement | null
  taken: ClientPriceAgreement[]
  userLabel: string
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [contactId, setContactId] = useState<string | null>(existing?.contact_id ?? null)
  const asText = (v: number | null | undefined) => v == null ? '' : String(v)
  const [cleanPrice, setCleanPrice] = useState(asText(existing?.accepted_clean_price))
  const [linenFee, setLinenFee] = useState(asText(existing?.linen_fee))
  const [onboardingFee, setOnboardingFee] = useState(asText(existing?.onboarding_fee))
  const [acceptedDate, setAcceptedDate] = useState(existing?.accepted_date ?? '')
  const [sourceLink, setSourceLink] = useState(existing?.source_link ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const linkInvalid = !parseSourceLink(sourceLink).ok

  const contactsQuery = useQuery<ContactLite[]>({
    queryKey: ['task-audit', 'contacts'],
    queryFn: () => fetchAll<ContactLite>(() => db.from('contacts').select('id, full_name, company').order('id')),
    staleTime: 300_000,
  })
  const contactOptions = useMemo(
    () => (contactsQuery.data ?? [])
      .map(c => ({ value: c.id, label: clientName(c) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [contactsQuery.data],
  )
  const duplicate = !existing && contactId != null && taken.some(t => t.contact_id === contactId)

  const save = useGuardedMutation<void, Error, void>('invoicing', {
    mutationFn: async () => {
      if (!contactId) throw new Error('Pick a client')
      const price = (s: string, what: string): number | null => {
        if (s.trim() === '') return null
        const n = Number(s)
        if (!Number.isFinite(n) || n < 0) throw new Error(`Enter a valid ${what}, or leave it blank`)
        return Math.round(n * 100) / 100
      }
      const clean = price(cleanPrice, 'clean price')
      const linen = price(linenFee, 'linen fee')
      const onboarding = price(onboardingFee, 'onboarding fee')
      if (clean == null && linen == null && onboarding == null) throw new Error('Enter at least one agreed price')
      const link = parseSourceLink(sourceLink)
      if (!link.ok) throw new Error('The source link must be a full https:// link')
      const row = {
        contact_id: contactId,
        accepted_clean_price: clean,
        linen_fee: linen,
        onboarding_fee: onboarding,
        accepted_date: acceptedDate || null,
        source_link: link.value,
        note: note.trim() || null,
        updated_by: userLabel,
      }
      const { error } = existing
        ? await db.from('client_price_agreements').update(row).eq('id', existing.id)
        : await db.from('client_price_agreements').insert({ ...row, created_by: userLabel })
      if (error) {
        if (/duplicate key|unique/i.test(error.message)) throw new Error('This client already has an agreement. Edit that one instead.')
        throw error
      }
    },
    onSuccess: () => { toast({ title: existing ? 'Agreement updated' : 'Agreement added', description: 'Checked the next time a run is generated or reconciled.' }); onSaved() },
    onError: (e) => { if (e.message !== 'edit_blocked') toast({ title: 'Save failed', description: e.message, variant: 'destructive' }) },
  })

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit agreed prices' : 'Add agreed prices'}</DialogTitle>
          <DialogDescription>What this client accepted. Leave a price blank if it wasn't part of the agreement; blank prices are never checked.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Client</Label>
            {existing ? (
              <p className="text-sm py-1.5">{clientName(one(existing.contacts))}</p>
            ) : (
              <SearchSelect
                value={contactId ?? ''}
                onSelect={v => setContactId(v || null)}
                options={contactOptions}
                placeholder={contactsQuery.isLoading ? 'Loading clients…' : 'Pick a client'}
                searchPlaceholder="Search clients…"
                emptyText="No matching clients"
              />
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Clean price</Label>
              <Input type="number" step="0.01" min="0" value={cleanPrice} onChange={e => setCleanPrice(e.target.value)} data-testid="agreement-clean" />
            </div>
            <div className="space-y-1">
              <Label>Linen fee</Label>
              <Input type="number" step="0.01" min="0" value={linenFee} onChange={e => setLinenFee(e.target.value)} data-testid="agreement-linen" />
            </div>
            <div className="space-y-1">
              <Label>Onboarding fee</Label>
              <Input type="number" step="0.01" min="0" value={onboardingFee} onChange={e => setOnboardingFee(e.target.value)} data-testid="agreement-onboarding" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Accepted on</Label>
              <Input type="date" value={acceptedDate} onChange={e => setAcceptedDate(e.target.value)} data-testid="agreement-accepted-date" />
            </div>
            <div className="space-y-1">
              <Label>Source link</Label>
              <Input type="url" value={sourceLink} onChange={e => setSourceLink(e.target.value)} placeholder="https://" data-testid="agreement-source-link" />
            </div>
          </div>
          {linkInvalid && <p className="text-xs text-destructive">The source link must be a full https:// link (quote, email or Slack thread).</p>}
          <div className="space-y-1">
            <Label>Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. accepted the October quote" data-testid="agreement-note" />
          </div>
          {duplicate && <p className="text-xs text-warning">This client already has an agreement. Edit that one instead.</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || duplicate || linkInvalid} data-testid="agreement-save">
              {save.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function OverrideDialog({ existing, taken, hasEvidence, settings, userLabel, onClose, onSaved }: {
  existing: ClientFeeOverride | null
  taken: ClientFeeOverride[]
  hasEvidence: boolean
  settings: AuxBillingSettings
  userLabel: string
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [contactId, setContactId] = useState<string | null>(existing?.contact_id ?? null)
  const [serviceType, setServiceType] = useState<string>(existing?.service_type ?? pricedServiceTypes(settings)[0] ?? '')
  const [charge, setCharge] = useState(existing ? String(existing.charge) : '')
  const [hotCharge, setHotCharge] = useState(existing?.hot_tub_charge != null ? String(existing.hot_tub_charge) : '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [acceptedDate, setAcceptedDate] = useState(existing?.accepted_date ?? '')
  const [sourceLink, setSourceLink] = useState(existing?.source_link ?? '')
  const linkInvalid = !parseSourceLink(sourceLink).ok

  const contactsQuery = useQuery<ContactLite[]>({
    queryKey: ['task-audit', 'contacts'],
    queryFn: () => fetchAll<ContactLite>(() => db.from('contacts').select('id, full_name, company').order('id')),
    staleTime: 300_000,
  })
  const contactOptions = useMemo(
    () => (contactsQuery.data ?? [])
      .map(c => ({ value: c.id, label: clientName(c) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [contactsQuery.data],
  )
  const types = pricedServiceTypes(settings)
  const std = settings.pricing[serviceType]
  const stdHot = settings.hotTubPricing[serviceType]
  const duplicate = !existing && contactId != null && taken.some(t => t.contact_id === contactId && t.service_type === serviceType)

  const save = useGuardedMutation<void, Error, void>('invoicing', {
    mutationFn: async () => {
      if (!contactId) throw new Error('Pick a client')
      if (!serviceType) throw new Error('Pick a fee')
      const n = Number(charge)
      if (charge.trim() === '' || !Number.isFinite(n) || n < 0) throw new Error('Enter a valid price')
      const h = hotCharge.trim() === '' ? null : Number(hotCharge)
      if (h != null && (!Number.isFinite(h) || h < 0)) throw new Error('Enter a valid hot tub price, or leave it blank')
      const link = parseSourceLink(sourceLink)
      if (!link.ok) throw new Error('The source link must be a full https:// link')
      const row = {
        contact_id: contactId,
        service_type: serviceType,
        charge: n,
        hot_tub_charge: h,
        note: note.trim() || null,
        // Only sent once migration 20261009f has added the columns.
        ...(hasEvidence ? { accepted_date: acceptedDate || null, source_link: link.value } : {}),
        updated_by: userLabel,
      }
      const { error } = existing
        ? await db.from('client_fee_overrides').update(row).eq('id', existing.id)
        : await db.from('client_fee_overrides').insert({ ...row, created_by: userLabel })
      if (error) {
        if (/duplicate key|unique/i.test(error.message)) throw new Error('This client already has a price for that fee. Edit that one instead.')
        throw error
      }
    },
    onSuccess: () => { toast({ title: existing ? 'Client price updated' : 'Client price added', description: 'Applies the next time a run is generated or reconciled.' }); onSaved() },
    onError: (e) => { if (e.message !== 'edit_blocked') toast({ title: 'Save failed', description: e.message, variant: 'destructive' }) },
  })

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit client price' : 'Add client price'}</DialogTitle>
          <DialogDescription>Used instead of the standard price on every property this client has.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Client</Label>
            {existing ? (
              <p className="text-sm py-1.5">{clientName(one(existing.contacts))}</p>
            ) : (
              <SearchSelect
                value={contactId ?? ''}
                onSelect={v => setContactId(v || null)}
                options={contactOptions}
                placeholder={contactsQuery.isLoading ? 'Loading clients…' : 'Pick a client'}
                searchPlaceholder="Search clients…"
                emptyText="No matching clients"
              />
            )}
          </div>
          <div className="space-y-1">
            <Label>Fee</Label>
            <Select value={serviceType} onValueChange={setServiceType} disabled={!!existing}>
              <SelectTrigger data-testid="override-fee"><SelectValue placeholder="Pick a fee" /></SelectTrigger>
              <SelectContent>
                {types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            {std != null && (
              <p className="text-2xs text-muted-foreground">Standard: {fmtMoney(std)}{stdHot != null ? `, ${fmtMoney(stdHot)} with a hot tub` : ''}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Price</Label>
              <Input type="number" step="1" min="0" value={charge} onChange={e => setCharge(e.target.value)} placeholder={std != null ? String(std) : ''} data-testid="override-charge" />
            </div>
            <div className="space-y-1">
              <Label>With a hot tub</Label>
              <Input type="number" step="1" min="0" value={hotCharge} onChange={e => setHotCharge(e.target.value)} placeholder="same" data-testid="override-hot-charge" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. agreed on the 2026 contract" data-testid="override-note" />
          </div>
          {hasEvidence && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Accepted on <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input type="date" value={acceptedDate} onChange={e => setAcceptedDate(e.target.value)} data-testid="override-accepted-date" />
              </div>
              <div className="space-y-1">
                <Label>Source link <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input type="url" value={sourceLink} onChange={e => setSourceLink(e.target.value)} placeholder="https://" data-testid="override-source-link" />
              </div>
            </div>
          )}
          {hasEvidence && linkInvalid && <p className="text-xs text-destructive">The source link must be a full https:// link (quote, email or Slack thread).</p>}
          {duplicate && <p className="text-xs text-warning">This client already has a price for that fee. Edit that one instead.</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || duplicate || (hasEvidence && linkInvalid)} data-testid="override-save">
              {save.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
