import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { StatCard } from '@/components/StatCard'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Home, Link2, AlertTriangle, HelpCircle, RefreshCw, Unlink, Clock } from 'lucide-react'
import { TONE_SOFT } from '@/lib/status-colors'

// Hostaway tab on the admin /trellis-sync page: verifies Hostaway listing
// details against Ops property records and flags per-field differences.
// Data comes from the hostaway_reconciliation view (admin RLS); the sync
// itself runs nightly (Vercel cron) or via the Refresh button here.

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

const MISMATCH_FIELDS: Array<{ key: keyof ReconRow; label: string; ha: keyof ReconRow; ops: (r: ReconRow) => string }> = [
  { key: 'bedrooms_mismatch', label: 'Bedrooms', ha: 'ha_bedrooms', ops: (r) => String(r.ops_bedrooms ?? '—') },
  { key: 'bathrooms_mismatch', label: 'Baths', ha: 'ha_bathrooms', ops: (r) => `${r.ops_full_baths ?? 0}${r.ops_half_baths ? `+${r.ops_half_baths}h` : ''}` },
  { key: 'beds_mismatch', label: 'Beds', ha: 'ha_beds', ops: (r) => String(r.ops_beds ?? '—') },
  { key: 'guests_mismatch', label: 'Guests', ha: 'ha_guests', ops: (r) => String(r.ops_guests ?? '—') },
]

function mismatchCount(r: ReconRow): number {
  return MISMATCH_FIELDS.filter((f) => r[f.key]).length + (r.address_mismatch ? 1 : 0)
}

export function HostawaySyncTab() {
  const { openPropertyModal } = usePropertyModal()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const [linkOpenFor, setLinkOpenFor] = useState<number | null>(null)

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

  // Property options for manual matching
  const { data: propertyOptions } = useQuery({
    queryKey: ['/supabase/hostaway-property-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, address')
        .order('name')
      if (error) throw error
      return (data ?? []) as Array<{ id: number; name: string; address: string | null }>
    },
  })

  const matched = useMemo(() => (rows ?? []).filter((r) => r.property_id != null), [rows])
  const unmatched = useMemo(() => (rows ?? []).filter((r) => r.property_id == null), [rows])
  const mismatched = useMemo(() => matched.filter((r) => mismatchCount(r) > 0), [matched])

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

  if (isError) {
    return <ErrorState onRetry={() => refetch()} title="Couldn't load Hostaway data" description="The hostaway_reconciliation view failed to load. Has the migration been applied?" />
  }

  const lastSyncLabel = lastSync?.finished_at
    ? new Date(lastSync.finished_at).toLocaleString()
    : lastSync?.status === 'running' ? 'running now…' : 'never'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          Last sync: {lastSyncLabel}
          {lastSync?.status === 'error' && (
            <span className="text-destructive">— failed: {lastSync.error?.slice(0, 120)}</span>
          )}
        </p>
        <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing} data-testid="hostaway-sync-now">
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Refresh from Hostaway'}
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Hostaway Listings" value={rows?.length ?? 0} icon={Home} loading={isLoading} />
        <StatCard title="Matched" value={matched.length} icon={Link2} loading={isLoading} />
        <StatCard title="Field Mismatches" value={mismatched.length} icon={AlertTriangle} tone={mismatched.length ? 'warning' : undefined} loading={isLoading} />
        <StatCard title="Unmatched Listings" value={unmatched.length} icon={HelpCircle} tone={unmatched.length ? 'info' : undefined} loading={isLoading} />
      </div>

      {!isLoading && (rows ?? []).length === 0 && (
        <EmptyState
          icon={Home}
          title="No Hostaway data yet"
          description="Set HOSTAWAY_ACCOUNT_ID and HOSTAWAY_API_KEY in the Vercel env, then hit Refresh from Hostaway."
        />
      )}

      {/* ── Field mismatches ─────────────────────────────────────────────── */}
      {mismatched.length > 0 && (
        <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              Differences — Hostaway vs Ops
            </h3>
            <p className="text-2xs text-muted-foreground mt-0.5">
              Values that disagree between the Hostaway listing and the Tendwell property. Click a property to open it and fix whichever side is wrong.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left font-medium px-4 py-2">Property</th>
                  <th className="text-left font-medium px-4 py-2">Hostaway listing</th>
                  <th className="text-left font-medium px-4 py-2">Differences (Hostaway → Ops)</th>
                </tr>
              </thead>
              <tbody>
                {mismatched.map((r) => (
                  <tr key={r.hostaway_id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-2 whitespace-nowrap">
                      <button
                        className="font-medium text-left hover:underline"
                        onClick={() => r.property_id != null && openPropertyModal(String(r.property_id), 'hostaway-sync')}
                        data-testid={`hostaway-open-property-${r.hostaway_id}`}
                      >
                        {r.property_name ?? '—'}
                      </button>
                      <div className="text-2xs text-muted-foreground max-w-[260px] truncate">{r.ops_address ?? ''}</div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <div>{r.hostaway_name ?? r.internal_name ?? r.hostaway_id}</div>
                      <div className="text-2xs text-muted-foreground max-w-[260px] truncate">{r.hostaway_address ?? ''}</div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {MISMATCH_FIELDS.filter((f) => r[f.key]).map((f) => (
                          <span key={String(f.key)} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs ${TONE_SOFT.warning}`}>
                            <span className="font-medium">{f.label}:</span> {String(r[f.ha] ?? '—')} → {f.ops(r)}
                          </span>
                        ))}
                        {r.address_mismatch && (
                          <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-2xs ${TONE_SOFT.warning}`}>
                            <span className="font-medium">Address differs</span>
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
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
              Hostaway listings with no Ops property
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
