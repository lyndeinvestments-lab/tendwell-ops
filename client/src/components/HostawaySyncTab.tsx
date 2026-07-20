import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, logPropertyEdit } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { invalidateAllPropertyQueries } from '@/lib/query-invalidations'
import { StatCard } from '@/components/StatCard'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Home, Link2, AlertTriangle, HelpCircle, RefreshCw, Unlink, Clock, Check, X, CheckCircle2, Building2 } from 'lucide-react'
import { TONE_SOFT } from '@/lib/status-colors'

// Hostaway tab on the admin /api-sync page: verifies Hostaway listing details
// against Ops property records in BOTH directions and lets an admin act on
// every finding — apply the Hostaway value into Ops (audit-logged), accept a
// difference as intentional (persisted in hostaway_diff_dismissals; re-flags
// if either side changes), link unmatched listings, and see which Haven
// properties are missing from Hostaway entirely.

interface ReconRow {
  hostaway_id: number
  hostaway_name: string | null
  internal_name: string | null
  property_id: number | null
  property_name: string | null
  hostaway_address: string | null
  ops_address: string | null
  ha_bedrooms: number | null
  ops_bedrooms: number | null
  ha_bathrooms: number | null
  ops_full_baths: number | null
  ops_half_baths: number | null
  ha_beds: number | null
  ops_beds: number | null
  ha_guests: number | null
  ops_guests: number | null
  match_method: 'manual' | 'address' | null
  synced_at: string
  bedrooms_mismatch: boolean
  bathrooms_mismatch: boolean
  beds_mismatch: boolean
  guests_mismatch: boolean
  address_mismatch: boolean
}

interface SyncLogRow {
  id: string
  status: string
  trigger: string
  started_at: string | null
  finished_at: string | null
  counts: { listings?: number; removed?: number } | null
  error: string | null
}

interface DismissalRow {
  id: string
  hostaway_id: number
  field: string
  ha_value: string | null
  ops_value: string | null
  dismissed_by: string | null
  created_at: string
}

interface PropertyOption {
  id: number
  name: string
  address: string | null
  contacts: { full_name: string | null } | null
  pipeline_stages: { name: string | null } | null
}

// Hostaway decimal baths → Ops full/half split (2.5 → 2 full + 1 half).
function splitBaths(ha: number | null): PropertiesUpdate {
  const v = ha ?? 0
  return { full_baths: Math.floor(v), half_baths: Math.round((v - Math.floor(v)) / 0.5) }
}

// Ops columns the apply action is allowed to touch.
interface PropertiesUpdate {
  bedrooms?: number
  full_baths?: number
  half_baths?: number
  number_of_beds?: number
  guest_count?: number
}

interface DiffField {
  field: 'bedrooms' | 'bathrooms' | 'beds' | 'guests' | 'address'
  label: string
  flag: keyof ReconRow
  ha: (r: ReconRow) => string
  ops: (r: ReconRow) => string
  /** properties-table update payload; absent = accept-only (address: Ops
   *  addresses are Google-qualified, Hostaway's raw string would regress). */
  apply?: (r: ReconRow) => PropertiesUpdate
}

const DIFF_FIELDS: DiffField[] = [
  {
    field: 'bedrooms', label: 'Bedrooms', flag: 'bedrooms_mismatch',
    ha: (r) => String(r.ha_bedrooms ?? '—'), ops: (r) => String(r.ops_bedrooms ?? '—'),
    apply: (r) => ({ bedrooms: Number(r.ha_bedrooms) }),
  },
  {
    field: 'bathrooms', label: 'Baths', flag: 'bathrooms_mismatch',
    ha: (r) => String(r.ha_bathrooms ?? '—'),
    ops: (r) => `${r.ops_full_baths ?? 0}${r.ops_half_baths ? `+${r.ops_half_baths}h` : ''}`,
    apply: (r) => splitBaths(r.ha_bathrooms),
  },
  {
    field: 'beds', label: 'Beds', flag: 'beds_mismatch',
    ha: (r) => String(r.ha_beds ?? '—'), ops: (r) => String(r.ops_beds ?? '—'),
    apply: (r) => ({ number_of_beds: Number(r.ha_beds) }),
  },
  {
    field: 'guests', label: 'Guests', flag: 'guests_mismatch',
    ha: (r) => String(r.ha_guests ?? '—'), ops: (r) => String(r.ops_guests ?? '—'),
    apply: (r) => ({ guest_count: Number(r.ha_guests) }),
  },
  {
    field: 'address', label: 'Address', flag: 'address_mismatch',
    ha: (r) => r.hostaway_address ?? '—', ops: (r) => r.ops_address ?? '—',
  },
]

// Current Ops value per properties column, for the edit log's old_value.
function opsValueForColumn(r: ReconRow, column: string): number | null {
  switch (column) {
    case 'bedrooms': return r.ops_bedrooms
    case 'full_baths': return r.ops_full_baths
    case 'half_baths': return r.ops_half_baths
    case 'number_of_beds': return r.ops_beds
    case 'guest_count': return r.ops_guests
    default: return null
  }
}

const OPERATIONAL_STAGES = ['Onboarding', 'Active', 'Offboarding']
const isHavenClient = (name: string | null | undefined) => /haven/i.test(name ?? '')

export function HostawaySyncTab() {
  const { openPropertyModal } = usePropertyModal()
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const [linkOpenFor, setLinkOpenFor] = useState<number | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  const { data: rows, isLoading, isError, refetch } = useQuery({
    queryKey: ['/supabase/hostaway-reconciliation'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hostaway_reconciliation')
        .select('*')
        .order('hostaway_name')
      if (error) throw error
      return (data ?? []) as ReconRow[]
    },
  })

  const { data: lastSync } = useQuery({
    queryKey: ['/supabase/hostaway-sync-log'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hostaway_sync_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw error
      return ((data ?? [])[0] ?? null) as SyncLogRow | null
    },
  })

  const { data: dismissals } = useQuery({
    queryKey: ['/supabase/hostaway-diff-dismissals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hostaway_diff_dismissals')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as DismissalRow[]
    },
  })

  // Property options for manual matching + the inverse check (Ops → Hostaway).
  // Client matters: only Haven Vacation Rentals properties are expected to
  // have a Hostaway listing, so the gap panel shows the client per property.
  const { data: propertyOptions } = useQuery({
    queryKey: ['/supabase/hostaway-property-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, address, contacts(full_name), pipeline_stages!properties_stage_id_fkey(name)')
        .order('name')
      if (error) throw error
      return (data ?? []) as unknown as PropertyOption[]
    },
  })

  // A flagged field stays visible until its exact (hostaway, ops) value pair
  // is accepted; a later change on either side re-surfaces it.
  const isAccepted = (r: ReconRow, f: DiffField) =>
    (dismissals ?? []).some((d) =>
      d.hostaway_id === r.hostaway_id && d.field === f.field &&
      d.ha_value === f.ha(r) && d.ops_value === f.ops(r))

  const activeDiffs = (r: ReconRow) => DIFF_FIELDS.filter((f) => r[f.flag] && !isAccepted(r, f))

  const matched = useMemo(() => (rows ?? []).filter((r) => r.property_id != null), [rows])
  const unmatched = useMemo(() => (rows ?? []).filter((r) => r.property_id == null), [rows])
  const mismatched = useMemo(
    () => matched.filter((r) => activeDiffs(r).length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matched, dismissals],
  )

  // Accepted differences that are actively suppressing a live flag (stale
  // acceptances — value changed or flag cleared — aren't worth showing).
  const acceptedActive = useMemo(() => {
    const byId = new Map((rows ?? []).map((r) => [r.hostaway_id, r]))
    return (dismissals ?? []).flatMap((d) => {
      const r = byId.get(d.hostaway_id)
      const f = DIFF_FIELDS.find((x) => x.field === d.field)
      if (!r || !f || !r[f.flag] || d.ha_value !== f.ha(r) || d.ops_value !== f.ops(r)) return []
      return [{ dismissal: d, row: r, fieldDef: f }]
    })
  }, [rows, dismissals])

  // Ops properties (operational stages) with no Hostaway listing. Haven-client
  // properties should exist in Hostaway — those are the actionable gaps; other
  // clients aren't on Hostaway at all, so they're shown muted for context.
  const opsUnmatched = useMemo(() => {
    const matchedIds = new Set(matched.map((r) => r.property_id))
    return (propertyOptions ?? [])
      .filter((p) => OPERATIONAL_STAGES.includes(p.pipeline_stages?.name ?? '') && !matchedIds.has(p.id))
      .sort((a, b) => {
        const ah = isHavenClient(a.contacts?.full_name) ? 0 : 1
        const bh = isHavenClient(b.contacts?.full_name) ? 0 : 1
        return ah - bh || a.name.localeCompare(b.name)
      })
  }, [propertyOptions, matched])
  const opsUnmatchedHaven = useMemo(
    () => opsUnmatched.filter((p) => isHavenClient(p.contacts?.full_name)),
    [opsUnmatched],
  )

  async function syncNow() {
    setSyncing(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) throw new Error('Not signed in')
      const res = await fetch('/api/hostaway/sync-now', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Sync failed (${res.status})`)
      toast({
        title: json.already_running ? 'Sync already running' : 'Hostaway sync complete',
        description: json.counts ? `${json.counts.listings} listings synced` : undefined,
      })
      qc.invalidateQueries({ queryKey: ['/supabase/hostaway-reconciliation'] })
      qc.invalidateQueries({ queryKey: ['/supabase/hostaway-sync-log'] })
    } catch (e: any) {
      toast({ title: 'Hostaway sync failed', description: e?.message, variant: 'destructive' })
    } finally {
      setSyncing(false)
    }
  }

  async function setManualMatch(hostawayId: number, propertyId: number | null) {
    const { error } = await supabase
      .from('hostaway_listing_snapshot')
      .update({ matched_property_id: propertyId })
      .eq('hostaway_id', hostawayId)
    if (error) {
      toast({ title: 'Match update failed', description: error.message, variant: 'destructive' })
      return
    }
    setLinkOpenFor(null)
    toast({ title: propertyId ? 'Listing linked' : 'Listing unlinked' })
    qc.invalidateQueries({ queryKey: ['/supabase/hostaway-reconciliation'] })
  }

  // Write the Hostaway value into the Ops property (audit-logged per column).
  async function applyDiff(r: ReconRow, f: DiffField) {
    if (!f.apply || r.property_id == null) return
    const key = `apply-${r.hostaway_id}-${f.field}`
    setPendingAction(key)
    try {
      const updates = f.apply(r)
      const { error } = await supabase.from('properties').update(updates).eq('id', r.property_id)
      if (error) throw error
      for (const [column, next] of Object.entries(updates)) {
        await logPropertyEdit(r.property_id, column, opsValueForColumn(r, column), next, r.property_name, user?.label)
      }
      toast({ title: `${f.label} updated from Hostaway`, description: `${r.property_name}: ${f.ops(r)} → ${f.ha(r)}` })
      invalidateAllPropertyQueries(qc)
      qc.invalidateQueries({ queryKey: ['/supabase/hostaway-reconciliation'] })
    } catch (e: any) {
      toast({ title: 'Update failed', description: e?.message, variant: 'destructive' })
    } finally {
      setPendingAction(null)
    }
  }

  // Record the difference as intentional so it stops flagging (until either
  // side changes). Upsert: re-accepting after a change stores the new pair.
  async function acceptDiffs(r: ReconRow, fields: DiffField[]) {
    if (fields.length === 0) return
    const key = `accept-${r.hostaway_id}-${fields.map((f) => f.field).join(',')}`
    setPendingAction(key)
    try {
      const { error } = await supabase
        .from('hostaway_diff_dismissals')
        .upsert(
          fields.map((f) => ({
            hostaway_id: r.hostaway_id,
            field: f.field,
            ha_value: f.ha(r),
            ops_value: f.ops(r),
            dismissed_by: user?.label ?? null,
          })),
          { onConflict: 'hostaway_id,field' },
        )
      if (error) throw error
      toast({
        title: fields.length === 1 ? `${fields[0].label} difference accepted` : `${fields.length} differences accepted`,
        description: r.property_name ?? r.hostaway_name ?? undefined,
      })
      qc.invalidateQueries({ queryKey: ['/supabase/hostaway-diff-dismissals'] })
    } catch (e: any) {
      toast({ title: 'Accept failed', description: e?.message, variant: 'destructive' })
    } finally {
      setPendingAction(null)
    }
  }

  async function restoreDiff(d: DismissalRow) {
    setPendingAction(`restore-${d.id}`)
    try {
      const { error } = await supabase.from('hostaway_diff_dismissals').delete().eq('id', d.id)
      if (error) throw error
      toast({ title: 'Difference restored' })
      qc.invalidateQueries({ queryKey: ['/supabase/hostaway-diff-dismissals'] })
    } catch (e: any) {
      toast({ title: 'Restore failed', description: e?.message, variant: 'destructive' })
    } finally {
      setPendingAction(null)
    }
  }

  if (isError) {
    return <ErrorState onRetry={() => refetch()} title="Couldn't load Hostaway data" description="The hostaway_reconciliation view failed to load. Has the migration been applied?" />
  }

  const lastSyncLabel = lastSync?.finished_at
    ? new Date(lastSync.finished_at).toLocaleString()
    : lastSync?.status === 'running' ? 'running now…' : 'never'

  const allClear = !isLoading && (rows ?? []).length > 0 &&
    mismatched.length === 0 && unmatched.length === 0 && opsUnmatchedHaven.length === 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          Last sync: {lastSyncLabel}
          {lastSync?.status === 'error' && (
            <span className="text-destructive">- failed: {lastSync.error?.slice(0, 120)}</span>
          )}
        </p>
        <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing} data-testid="hostaway-sync-now">
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Refresh from Hostaway'}
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard title="Hostaway Listings" value={rows?.length ?? 0} icon={Home} loading={isLoading} />
        <StatCard title="Matched" value={matched.length} icon={Link2} loading={isLoading} />
        <StatCard title="Open Differences" value={mismatched.length} icon={AlertTriangle} tone={mismatched.length ? 'warning' : 'success'} loading={isLoading} />
        <StatCard title="Unmatched Listings" value={unmatched.length} icon={HelpCircle} tone={unmatched.length ? 'info' : undefined} loading={isLoading} />
        <StatCard title="Haven Props Missing" value={opsUnmatchedHaven.length} icon={Building2} tone={opsUnmatchedHaven.length ? 'destructive' : 'success'} loading={isLoading || !propertyOptions} />
      </div>

      {!isLoading && (rows ?? []).length === 0 && (
        <EmptyState
          icon={Home}
          title="No Hostaway data yet"
          description="Set HOSTAWAY_ACCOUNT_ID and HOSTAWAY_API_KEY in the Vercel env, then hit Refresh from Hostaway."
        />
      )}

      {allClear && (
        <EmptyState
          icon={CheckCircle2}
          title="Everything reconciled"
          description="No open differences, every listing is matched, and every Haven property has a Hostaway listing."
        />
      )}

      {/* ── Field differences — apply or accept each one ─────────────────── */}
      {mismatched.length > 0 && (
        <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              Differences - Hostaway vs Ops ({mismatched.length})
            </h3>
            <p className="text-2xs text-muted-foreground mt-0.5">
              Per difference: <Check className="w-3 h-3 inline -mt-0.5" /> applies the Hostaway value to the Ops property (audit-logged),
              {' '}<X className="w-3 h-3 inline -mt-0.5" /> accepts the difference as intentional (re-flags if either side changes).
              Address differences are accept-only - fix addresses on the property itself. Click a property name to open it.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left font-medium px-4 py-2">Property</th>
                  <th className="text-left font-medium px-4 py-2">Hostaway listing</th>
                  <th className="text-left font-medium px-4 py-2">Differences (Hostaway → Ops)</th>
                  <th className="text-right font-medium px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {mismatched.map((r) => {
                  const diffs = activeDiffs(r)
                  return (
                    <tr key={r.hostaway_id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2 whitespace-nowrap align-top">
                        <button
                          className="font-medium text-left hover:underline"
                          onClick={() => r.property_id != null && openPropertyModal(String(r.property_id), 'hostaway-sync')}
                          data-testid={`hostaway-open-property-${r.hostaway_id}`}
                        >
                          {r.property_name ?? '—'}
                        </button>
                        <div className="text-2xs text-muted-foreground max-w-[260px] truncate">{r.ops_address ?? ''}</div>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap align-top">
                        <div>{r.hostaway_name ?? r.internal_name ?? r.hostaway_id}</div>
                        <div className="text-2xs text-muted-foreground max-w-[260px] truncate">{r.hostaway_address ?? ''}</div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {diffs.map((f) => (
                            <span key={f.field} className={`inline-flex items-center gap-1 rounded border pl-1.5 pr-0.5 py-0.5 text-2xs ${TONE_SOFT.warning}`}>
                              {f.field === 'address' ? (
                                <span className="font-medium" title={`Hostaway: ${f.ha(r)}\nOps: ${f.ops(r)}`}>Address differs</span>
                              ) : (
                                <><span className="font-medium">{f.label}:</span> {f.ha(r)} → {f.ops(r)}</>
                              )}
                              {f.apply && (
                                <button
                                  className="rounded p-0.5 hover:bg-success/20 text-success disabled:opacity-40"
                                  title={`Set Ops ${f.label.toLowerCase()} to ${f.ha(r)} (Hostaway value)`}
                                  disabled={pendingAction === `apply-${r.hostaway_id}-${f.field}`}
                                  onClick={() => applyDiff(r, f)}
                                  data-testid={`hostaway-apply-${r.hostaway_id}-${f.field}`}
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                              )}
                              <button
                                className="rounded p-0.5 hover:bg-muted text-muted-foreground disabled:opacity-40"
                                title="Accept this difference (stops flagging until either side changes)"
                                disabled={pendingAction === `accept-${r.hostaway_id}-${f.field}`}
                                onClick={() => acceptDiffs(r, [f])}
                                data-testid={`hostaway-accept-${r.hostaway_id}-${f.field}`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right align-top">
                        {diffs.length > 1 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-2xs text-muted-foreground"
                            disabled={pendingAction?.startsWith(`accept-${r.hostaway_id}-`) ?? false}
                            onClick={() => acceptDiffs(r, diffs)}
                          >
                            Accept all
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Accepted differences (restorable) ────────────────────────────── */}
      {acceptedActive.length > 0 && (
        <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium">Accepted differences ({acceptedActive.length})</h3>
            <p className="text-2xs text-muted-foreground mt-0.5">
              Marked intentional - hidden from the differences list until Hostaway or Ops changes. Restore to flag again.
            </p>
          </div>
          <ul className="divide-y divide-border/60">
            {acceptedActive.map(({ dismissal: d, row: r, fieldDef: f }) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <div className="text-xs min-w-0">
                  <span className="font-medium">{r.property_name ?? r.hostaway_name}</span>
                  <span className="text-muted-foreground"> - {f.label}: {d.ha_value} → {d.ops_value}</span>
                  {d.dismissed_by && <span className="text-2xs text-muted-foreground/70"> · accepted by {d.dismissed_by}</span>}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-2xs text-muted-foreground"
                  disabled={pendingAction === `restore-${d.id}`}
                  onClick={() => restoreDiff(d)}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Ops properties with no Hostaway listing ──────────────────────── */}
      {opsUnmatched.length > 0 && (
        <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Building2 className="w-4 h-4 text-info" />
              Ops properties with no Hostaway listing ({opsUnmatched.length})
            </h3>
            <p className="text-2xs text-muted-foreground mt-0.5">
              Operational properties (Onboarding / Active / Offboarding) that no Hostaway listing matched.
              Haven Vacation Rentals properties are expected in Hostaway - those gaps need a look; other clients aren't on Hostaway.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left font-medium px-4 py-2">Property</th>
                  <th className="text-left font-medium px-4 py-2">Client</th>
                  <th className="text-left font-medium px-4 py-2">Stage</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {opsUnmatched.map((p) => {
                  const haven = isHavenClient(p.contacts?.full_name)
                  return (
                    <tr key={p.id} className={`border-b border-border/60 last:border-0 hover:bg-muted/40 ${haven ? '' : 'opacity-60'}`}>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <button
                          className="font-medium text-left hover:underline"
                          onClick={() => openPropertyModal(String(p.id), 'hostaway-sync')}
                        >
                          {p.name}
                        </button>
                        <div className="text-2xs text-muted-foreground max-w-[260px] truncate">{p.address ?? ''}</div>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">{p.contacts?.full_name ?? '—'}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{p.pipeline_stages?.name ?? '—'}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-2xs ${haven ? TONE_SOFT.destructive : TONE_SOFT.neutral}`}>
                          {haven ? 'Expected in Hostaway' : 'Not expected'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Unmatched listings ───────────────────────────────────────────── */}
      {unmatched.length > 0 && (
        <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-info" />
              Hostaway listings with no Ops property ({unmatched.length})
            </h3>
            <p className="text-2xs text-muted-foreground mt-0.5">
              No address match found. Link each one to its Tendwell property (the link survives future syncs), or ignore listings Tendwell doesn't service.
            </p>
          </div>
          <ul className="divide-y divide-border/60">
            {unmatched.map((r) => (
              <li key={r.hostaway_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{r.hostaway_name ?? r.internal_name ?? r.hostaway_id}</div>
                  <div className="text-2xs text-muted-foreground truncate">{r.hostaway_address ?? 'no address on listing'}</div>
                </div>
                <Popover open={linkOpenFor === r.hostaway_id} onOpenChange={(o) => setLinkOpenFor(o ? r.hostaway_id : null)}>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" className="h-7 text-xs" data-testid={`hostaway-link-${r.hostaway_id}`}>
                      <Link2 className="w-3 h-3 mr-1" /> Link property
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-80" align="end">
                    <Command>
                      <CommandInput placeholder="Search properties…" />
                      <CommandList>
                        <CommandEmpty>No properties found.</CommandEmpty>
                        <CommandGroup>
                          {(propertyOptions ?? []).map((p) => (
                            <CommandItem key={p.id} value={`${p.name} ${p.address ?? ''}`} onSelect={() => setManualMatch(r.hostaway_id, p.id)}>
                              <span className="truncate">{p.name}</span>
                              {p.address && <span className="ml-1 text-2xs text-muted-foreground truncate">{p.address}</span>}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Manually linked (allow unlink) ───────────────────────────────── */}
      {matched.some((r) => r.match_method === 'manual') && (
        <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium">Manually linked listings</h3>
          </div>
          <ul className="divide-y divide-border/60">
            {matched.filter((r) => r.match_method === 'manual').map((r) => (
              <li key={r.hostaway_id} className="flex items-center justify-between gap-2 px-4 py-2">
                <div className="text-xs min-w-0 truncate">
                  <span className="font-medium">{r.hostaway_name ?? r.hostaway_id}</span>
                  <span className="text-muted-foreground"> → {r.property_name}</span>
                </div>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setManualMatch(r.hostaway_id, null)}>
                  <Unlink className="w-3 h-3 mr-1" /> Unlink
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
