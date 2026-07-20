import { useEffect, useMemo, useRef, useState } from 'react'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { useAuth } from '@/lib/auth'
import { RefreshCw, Link2, CheckCircle2, AlertTriangle, HelpCircle, Unlink, Inbox, PackageSearch, Users2, Pencil, Check, Eye, EyeOff, X, Square, History, Clock } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTrellisSync, fetchTasks, type TaskRow, type TrellisPropOption, type OpsPropertyOption, type DismissalRow, type SyncProgress, type SyncLogRow, type BreezewayCoverageRow, type BreezewayExceptionRow } from '@/hooks/use-trellis-sync'
import { HostawaySyncTab } from '@/components/HostawaySyncTab'

function formatEta(seconds: number): string {
  if (seconds <= 0) return ''
  if (seconds < 60) return `~${seconds}s left`
  return `~${Math.round(seconds / 60)}m left`
}

function SyncProgressBar({ progress }: { progress: SyncProgress | null }) {
  if (!progress) return null
  return (
    <div className="space-y-1.5 mt-1">
      <div className="flex items-center justify-between text-2xs text-muted-foreground">
        <span>{progress.message}</span>
        <span className="tabular-nums">
          {progress.current}/{progress.total}
          {progress.eta_seconds > 0 && <span className="ml-2 text-muted-foreground/70">{formatEta(progress.eta_seconds)} (approx.)</span>}
        </span>
      </div>
      <Progress value={progress.pct} className="h-1.5" />
    </div>
  )
}

function workspaceBadge(ws: 'A' | 'B' | null) {
  if (!ws) return null
  return <StatusBadge tone={ws === 'A' ? 'info' : 'primary'}>{ws === 'A' ? 'Tendwell' : 'Haven'}</StatusBadge>
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const plusDaysISO = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

// Searchable Trellis-property picker — lets an admin set, change, or clear the
// match on ANY row (matched / unmatched / suggested / stale), not just confirm
// a suggestion. Writes via the same linkMatch mutation.
function MatchPicker({ opsId, opsName, currentTrellisId, options, disabled, onApply }: {
  opsId: number
  opsName: string
  currentTrellisId: string | null
  options: TrellisPropOption[]
  disabled: boolean
  onApply: (opsId: number, opsName: string, trellisId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled} data-testid={`edit-match-${opsId}`}>
          <Pencil className="w-3.5 h-3.5 mr-1.5" />
          {currentTrellisId ? 'Change' : 'Set match'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command>
          <CommandInput placeholder="Search Trellis properties…" />
          <CommandList>
            <CommandEmpty>No Trellis property found.</CommandEmpty>
            {currentTrellisId && (
              <CommandGroup>
                <CommandItem value="__clear__ clear remove unlink" onSelect={() => { onApply(opsId, opsName, null); setOpen(false) }}>
                  <Unlink className="w-3.5 h-3.5 mr-2 text-warning" /> Clear match
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading="Trellis properties">
              {options.map(o => (
                <CommandItem
                  key={o.trellis_id}
                  value={`${o.name} ${o.workspace === 'A' ? 'Tendwell' : 'Haven'} ${o.trellis_id}`}
                  onSelect={() => { onApply(opsId, opsName, o.trellis_id); setOpen(false) }}
                >
                  <Check className={`w-3.5 h-3.5 mr-2 ${o.trellis_id === currentTrellisId ? 'opacity-100' : 'opacity-0'}`} />
                  <span className="flex-1 truncate">{o.name}</span>
                  <span className="ml-2 shrink-0">{workspaceBadge(o.workspace)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// Searchable Ops-property picker for resolving Breezeway orphans.
// Mirrors MatchPicker above but maps a Breezeway property_raw → Ops property id.
function BreezewayMatchPicker({ propertyRaw, options, disabled, onApply }: {
  propertyRaw: string
  options: OpsPropertyOption[]
  disabled: boolean
  onApply: (propertyRaw: string, propertyId: number) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled}>
          <Link2 className="w-3.5 h-3.5 mr-1.5" />
          Match
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command>
          <CommandInput placeholder="Search Ops properties…" />
          <CommandList>
            <CommandEmpty>No Ops property found.</CommandEmpty>
            <CommandGroup heading="Ops properties">
              {options.map(o => (
                <CommandItem
                  key={o.id}
                  value={`${o.name} ${o.id}`}
                  onSelect={() => { onApply(propertyRaw, o.id); setOpen(false) }}
                >
                  <span className="flex-1 truncate">{o.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ReconciliationTab({ recon, exceptions, trellisProps, linkMatch, dismissals, dismissRow, restoreRow, userLabel }: {
  recon: ReturnType<typeof useTrellisSync>['recon']
  exceptions: ReturnType<typeof useTrellisSync>['exceptions']
  trellisProps: ReturnType<typeof useTrellisSync>['trellisProps']
  linkMatch: ReturnType<typeof useTrellisSync>['linkMatch']
  dismissals: ReturnType<typeof useTrellisSync>['dismissals']
  dismissRow: ReturnType<typeof useTrellisSync>['dismissRow']
  restoreRow: ReturnType<typeof useTrellisSync>['restoreRow']
  userLabel: string
}) {
  const { toast } = useToast()
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [showDismissed, setShowDismissed] = useState(false)
  const [pendingDismiss, setPendingDismiss] = useState<string | null>(null)

  if (recon.error) return <ErrorState onRetry={() => recon.refetch()} />

  const rows = recon.data ?? []
  const exRows = exceptions.data ?? []
  const options = trellisProps.data ?? []
  const allDismissals: DismissalRow[] = dismissals.data ?? []

  // Build fast lookup sets
  const dismissedExSet = new Set(
    allDismissals
      .filter(d => d.kind === 'trellis_not_in_ops' && d.trellis_property_id != null)
      .map(d => d.trellis_property_id as string)
  )
  const dismissedReconSet = new Set(
    allDismissals
      .filter(d => d.kind === 'ops_not_in_trellis' && d.ops_property_id != null)
      .map(d => String(d.ops_property_id))
  )

  // Helper: find dismissal record for a given key (for restore)
  const findExDismissal = (trellisId: string) =>
    allDismissals.find(d => d.kind === 'trellis_not_in_ops' && d.trellis_property_id === trellisId)
  const findReconDismissal = (opsId: number) =>
    allDismissals.find(d => d.kind === 'ops_not_in_trellis' && d.ops_property_id === opsId)

  // Filtered rows based on show/hide toggle
  const visibleExRows = showDismissed
    ? exRows
    : exRows.filter(e => !dismissedExSet.has(e.trellis_id))

  const visibleReconRows = showDismissed
    ? rows
    : rows.filter(r => r.match_status === 'matched' || !dismissedReconSet.has(String(r.ops_property_id)))

  const applyLink = async (opsId: number, opsName: string, trellisId: string | null) => {
    setPendingId(opsId)
    try {
      await linkMatch.mutateAsync({ opsId, opsName, trellisId })
      toast({ title: trellisId ? 'Match linked' : 'Match cleared', description: opsName })
    } catch (e) {
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setPendingId(null)
    }
  }

  const handleDismissEx = async (trellisId: string, name: string) => {
    setPendingDismiss(`ex-${trellisId}`)
    try {
      await dismissRow.mutateAsync({
        kind: 'trellis_not_in_ops',
        trellis_property_id: trellisId,
        ops_property_id: null,
        dismissed_by: userLabel,
      })
      toast({ title: 'Dismissed', description: name })
    } catch (e) {
      toast({ title: 'Dismiss failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setPendingDismiss(null)
    }
  }

  const handleDismissRecon = async (opsId: number, opsName: string) => {
    setPendingDismiss(`recon-${opsId}`)
    try {
      await dismissRow.mutateAsync({
        kind: 'ops_not_in_trellis',
        trellis_property_id: null,
        ops_property_id: opsId,
        dismissed_by: userLabel,
      })
      toast({ title: 'Dismissed', description: opsName })
    } catch (e) {
      toast({ title: 'Dismiss failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setPendingDismiss(null)
    }
  }

  const handleRestore = async (dismissalId: string, label: string) => {
    setPendingDismiss(dismissalId)
    try {
      await restoreRow.mutateAsync(dismissalId)
      toast({ title: 'Restored', description: label })
    } catch (e) {
      toast({ title: 'Restore failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setPendingDismiss(null)
    }
  }

  const dismissedExCount = exRows.filter(e => dismissedExSet.has(e.trellis_id)).length
  const dismissedReconCount = rows.filter(r =>
    r.match_status !== 'matched' && dismissedReconSet.has(String(r.ops_property_id))
  ).length
  const totalDismissed = dismissedExCount + dismissedReconCount

  return (
    <div className="space-y-5">
      {/* Show dismissed toggle — shared for both panels */}
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowDismissed(v => !v)}
          className="text-muted-foreground gap-1.5"
          data-testid="toggle-show-dismissed"
        >
          {showDismissed ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          {showDismissed ? 'Hide dismissed' : `Show dismissed${totalDismissed > 0 ? ` (${totalDismissed})` : ''}`}
        </Button>
      </div>

      {/* Exceptions panel — Tendwell work in Trellis with no Ops home */}
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <h2 className="text-sm font-semibold">
            In Trellis, not in Ops ({exRows.filter(e => !dismissedExSet.has(e.trellis_id)).length})
          </h2>
        </div>
        {exceptions.error ? (
          <p className="text-xs text-destructive">Failed to load exceptions - <button className="underline" onClick={() => exceptions.refetch()}>retry</button>.</p>
        ) : exceptions.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : visibleExRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {dismissedExCount > 0 && !showDismissed
              ? `All ${dismissedExCount} exception(s) dismissed. Toggle "Show dismissed" to review.`
              : 'Nothing unaccounted for. Every Tendwell-serviced Trellis property maps to an Ops property.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-2xs uppercase text-muted-foreground text-left">
                <th className="py-1 pr-3">Trellis property</th>
                <th className="py-1 pr-3">Workspace</th>
                <th className="py-1 pr-3">Tendwell tasks</th>
                <th className="py-1 pr-3 text-right">Action</th>
              </tr></thead>
              <tbody>
                {visibleExRows.map(e => {
                  const isDismissed = dismissedExSet.has(e.trellis_id)
                  const dismissal = isDismissed ? findExDismissal(e.trellis_id) : undefined
                  return (
                    <tr key={e.trellis_id} className={`border-t border-border/50 ${isDismissed ? 'opacity-50' : ''}`}>
                      <td className={`py-1.5 pr-3 ${isDismissed ? 'line-through text-muted-foreground' : ''}`}>{e.name}</td>
                      <td className="py-1.5 pr-3">{workspaceBadge(e.workspace)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{e.tendwell_task_count}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {isDismissed && dismissal ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-2xs"
                            disabled={pendingDismiss === dismissal.id}
                            onClick={() => handleRestore(dismissal.id, e.name)}
                          >
                            Restore
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-2xs text-muted-foreground hover:text-foreground"
                            disabled={pendingDismiss === `ex-${e.trellis_id}`}
                            onClick={() => handleDismissEx(e.trellis_id, e.name)}
                            title="Dismiss this exception"
                          >
                            <X className="w-3 h-3 mr-1" />
                            Dismiss
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mapping table */}
      <div className="rounded-2xl border border-card-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-2xs uppercase text-muted-foreground text-left">
                <th className="py-2 px-3">Ops property</th>
                <th className="py-2 px-3">Trellis match</th>
                <th className="py-2 px-3">Workspace</th>
                <th className="py-2 px-3">Tendwell tasks</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {recon.isLoading ? (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground text-xs">Loading…</td></tr>
              ) : visibleReconRows.length === 0 ? (
                <tr><td colSpan={6}><EmptyState icon={Inbox} title="No properties" description="Run a sync to populate Trellis data." /></td></tr>
              ) : visibleReconRows.map(r => {
                const isDismissed = r.match_status !== 'matched' && dismissedReconSet.has(String(r.ops_property_id))
                const dismissal = isDismissed ? findReconDismissal(r.ops_property_id) : undefined
                const canDismiss = r.match_status !== 'matched'
                return (
                  <tr key={r.ops_property_id} className={`border-t border-border/50 ${isDismissed ? 'opacity-50' : ''}`}>
                    <td className={`py-1.5 px-3 font-medium ${isDismissed ? 'line-through text-muted-foreground' : ''}`}>{r.ops_name}</td>
                    <td className="py-1.5 px-3 text-muted-foreground">
                      {r.match_status === 'matched' && r.linked_trellis_name}
                      {r.match_status === 'stale' && <span className="text-warning">link no longer resolves</span>}
                      {r.match_status === 'suggested' && <span>{r.suggested_trellis_name}</span>}
                      {r.match_status === 'unmatched' && <span className="text-muted-foreground/60">-</span>}
                    </td>
                    <td className="py-1.5 px-3">{workspaceBadge(r.linked_workspace ?? r.suggested_workspace)}</td>
                    <td className="py-1.5 px-3 tabular-nums">{r.tendwell_task_count ?? 0}</td>
                    <td className="py-1.5 px-3">
                      <StatusBadge tone={r.match_status === 'matched' ? 'success' : r.match_status === 'suggested' ? 'info' : 'warning'}>
                        {r.match_status}
                      </StatusBadge>
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {isDismissed && dismissal ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-2xs"
                            disabled={pendingDismiss === dismissal.id}
                            onClick={() => handleRestore(dismissal.id, r.ops_name)}
                          >
                            Restore
                          </Button>
                        ) : (
                          <>
                            {r.match_status === 'suggested' && (
                              <Button size="sm" variant="outline" onClick={() => applyLink(r.ops_property_id, r.ops_name, r.suggested_trellis_id)} disabled={pendingId === r.ops_property_id}>
                                Confirm
                              </Button>
                            )}
                            <MatchPicker
                              opsId={r.ops_property_id}
                              opsName={r.ops_name}
                              currentTrellisId={r.linked_trellis_id}
                              options={options}
                              disabled={pendingId === r.ops_property_id}
                              onApply={applyLink}
                            />
                            {canDismiss && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-2xs text-muted-foreground hover:text-foreground"
                                disabled={pendingDismiss === `recon-${r.ops_property_id}`}
                                onClick={() => handleDismissRecon(r.ops_property_id, r.ops_name)}
                                title="Dismiss this row"
                              >
                                <X className="w-3 h-3 mr-1" />
                                Dismiss
                              </Button>
                            )}
                          </>
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
    </div>
  )
}

function BreezewayTab({ recon, breezewayCoverage, breezewayExceptions, opsProperties, matchBreezeway, dismissBreezeway, userLabel }: {
  recon: ReturnType<typeof useTrellisSync>['recon']
  breezewayCoverage: ReturnType<typeof useTrellisSync>['breezewayCoverage']
  breezewayExceptions: ReturnType<typeof useTrellisSync>['breezewayExceptions']
  opsProperties: ReturnType<typeof useTrellisSync>['opsProperties']
  matchBreezeway: ReturnType<typeof useTrellisSync>['matchBreezeway']
  dismissBreezeway: ReturnType<typeof useTrellisSync>['dismissBreezeway']
  userLabel: string
}) {
  const { toast } = useToast()
  const [pendingBzMatch, setPendingBzMatch] = useState<string | null>(null)
  const [pendingBzDismiss, setPendingBzDismiss] = useState<string | null>(null)

  if (breezewayCoverage.error) return <ErrorState onRetry={() => breezewayCoverage.refetch()} />

  const coverage: BreezewayCoverageRow[] = breezewayCoverage.data ?? []
  const bzExRows: BreezewayExceptionRow[] = breezewayExceptions.data ?? []
  const opsOptions: OpsPropertyOption[] = opsProperties.data ?? []
  const nameById = new Map<number, string>((recon.data ?? []).map(r => [r.ops_property_id, r.ops_name]))
  const totalCleans = coverage.reduce((a, r) => a + (r.clean_count ?? 0), 0)

  const handleMatchBreezeway = async (propertyRaw: string, propertyId: number) => {
    setPendingBzMatch(propertyRaw)
    const opsName = opsOptions.find(o => o.id === propertyId)?.name ?? String(propertyId)
    try {
      await matchBreezeway.mutateAsync({ propertyRaw, propertyId, resolvedBy: userLabel })
      toast({ title: 'Matched', description: `${propertyRaw} → ${opsName}` })
    } catch (e) {
      toast({ title: 'Match failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setPendingBzMatch(null)
    }
  }

  const handleDismissBreezeway = async (propertyRaw: string) => {
    setPendingBzDismiss(propertyRaw)
    try {
      await dismissBreezeway.mutateAsync({ propertyRaw, resolvedBy: userLabel })
      toast({ title: 'Dismissed', description: propertyRaw })
    } catch (e) {
      toast({ title: 'Dismiss failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setPendingBzDismiss(null)
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        Breezeway data comes from the weekly task import (system of record for Haven cleans).
        Matching fixes here apply immediately; new task data arrives with the next import.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard title="Properties with cleans" value={coverage.length} icon={CheckCircle2} tone="success" loading={breezewayCoverage.isLoading} />
        <StatCard title="Total cleans tracked" value={totalCleans.toLocaleString()} icon={Inbox} tone="info" loading={breezewayCoverage.isLoading} />
        <StatCard title="In Breezeway, not in Ops" value={bzExRows.length} icon={AlertTriangle} tone={bzExRows.length ? 'destructive' : 'success'} loading={breezewayExceptions.isLoading} />
      </div>

      {/* Breezeway exceptions panel — tasks in Breezeway with no matching Ops property */}
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <h2 className="text-sm font-semibold">
            In Breezeway, not in Ops ({bzExRows.length})
          </h2>
        </div>
        {breezewayExceptions.error ? (
          <p className="text-xs text-destructive">Failed to load Breezeway exceptions - <button className="underline" onClick={() => breezewayExceptions.refetch()}>retry</button>.</p>
        ) : breezewayExceptions.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : bzExRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No unmatched Breezeway properties. Every Breezeway task maps to an Ops property.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-2xs uppercase text-muted-foreground text-left">
                <th className="py-1 pr-3">Breezeway property</th>
                <th className="py-1 pr-3">Cleans</th>
                <th className="py-1 pr-3">Tasks</th>
                <th className="py-1 pr-3">Date range</th>
                <th className="py-1 pr-3 text-right">Action</th>
              </tr></thead>
              <tbody>
                {bzExRows.map(e => (
                  <tr key={e.property_raw} className="border-t border-border/50">
                    <td className="py-1.5 pr-3">{e.property_raw}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{e.clean_count}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{e.task_count}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">
                      {e.first_due && e.last_due ? `${e.first_due} - ${e.last_due}` : e.first_due ?? e.last_due ?? '-'}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <BreezewayMatchPicker
                          propertyRaw={e.property_raw}
                          options={opsOptions}
                          disabled={pendingBzMatch === e.property_raw || pendingBzDismiss === e.property_raw}
                          onApply={handleMatchBreezeway}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-2xs text-muted-foreground hover:text-foreground"
                          disabled={pendingBzDismiss === e.property_raw || pendingBzMatch === e.property_raw}
                          onClick={() => handleDismissBreezeway(e.property_raw)}
                          title="Dismiss this Breezeway property"
                        >
                          <X className="w-3 h-3 mr-1" />
                          Dismiss
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Coverage table — Ops properties with Breezeway clean history */}
      <div className="rounded-2xl border border-card-border shadow-sm overflow-hidden">
        <div className="px-4 py-2 text-2xs text-muted-foreground border-b border-border/50">
          Ops properties with Breezeway clean coverage.
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40"><tr className="text-2xs uppercase text-muted-foreground text-left">
              <th className="py-2 px-3">Ops property</th>
              <th className="py-2 px-3">Cleans</th>
              <th className="py-2 px-3">Last clean due</th>
            </tr></thead>
            <tbody>
              {breezewayCoverage.isLoading ? (
                <tr><td colSpan={3} className="py-6 text-center text-muted-foreground text-xs">Loading…</td></tr>
              ) : coverage.length === 0 ? (
                <tr><td colSpan={3}><EmptyState icon={Inbox} title="No coverage yet" description="Run the Breezeway import to populate clean history." /></td></tr>
              ) : [...coverage].sort((a, b) => (b.clean_count ?? 0) - (a.clean_count ?? 0)).map(r => (
                <tr key={r.property_id} className="border-t border-border/50">
                  <td className="py-1.5 px-3 font-medium">{nameById.get(r.property_id) ?? `#${r.property_id}`}</td>
                  <td className="py-1.5 px-3 tabular-nums">{r.clean_count}</td>
                  <td className="py-1.5 px-3 tabular-nums text-muted-foreground">{r.last_clean_due ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const WORKFLOWS: { id: string; label: string; description: string; run: () => Promise<TaskRow[]> }[] = [
  { id: 'today', label: "Today's Tendwell cleans", description: 'All Tendwell cleaning/inspection tasks scheduled today (A + B).',
    run: () => fetchTasks({ tendwellOnly: true, scheduledFrom: todayISO(), scheduledTo: todayISO() }) },
  { id: 'upcoming', label: 'Upcoming (next 7 days)', description: 'Scheduled Tendwell cleans/inspections in the next week.',
    run: () => fetchTasks({ tendwellOnly: true, scheduledFrom: todayISO(), scheduledTo: plusDaysISO(7) }) },
  { id: 'selfinspections', label: 'Cleaner self-inspections due', description: 'Open Cleaner Self-Inspection tasks.',
    run: () => fetchTasks({ tendwellOnly: true, titleILike: 'Self-Inspection', openOnly: true }) },
  { id: 'unassigned', label: 'Unassigned Tendwell work', description: 'B tasks still on "Tendwell Cleaning Co." - not yet dispatched to a person.',
    run: () => fetchTasks({ unassignedTendwellCo: true, openOnly: true }) },
  { id: 'airfilters', label: 'Air-filter changes scheduled', description: 'Upcoming Air Filter Change tasks.',
    run: () => fetchTasks({ tendwellOnly: true, titleILike: 'Air Filter', scheduledFrom: todayISO(), scheduledTo: plusDaysISO(60) }) },
]

function WorkflowsTab() {
  const [active, setActive] = useState(WORKFLOWS[0].id)
  const wf = WORKFLOWS.find(w => w.id === active)!
  const q = useQuery({
    queryKey: ['/supabase/trellis-sync', 'workflow', active, todayISO()],
    queryFn: wf.run,
    refetchOnWindowFocus: false,
  })

  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-4">
      <div className="space-y-1">
        {WORKFLOWS.map(w => (
          <button key={w.id} onClick={() => setActive(w.id)}
            className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${active === w.id ? 'bg-primary/10 text-foreground' : 'hover:bg-muted text-muted-foreground'}`}>
            <div className="font-medium">{w.label}</div>
            <div className="text-2xs text-muted-foreground">{w.description}</div>
          </button>
        ))}
      </div>
      <div className="rounded-2xl border border-card-border shadow-sm overflow-hidden">
        {q.error ? <ErrorState onRetry={() => q.refetch()} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr className="text-2xs uppercase text-muted-foreground text-left">
                <th className="py-2 px-3">Property</th><th className="py-2 px-3">Task</th><th className="py-2 px-3">Dept</th>
                <th className="py-2 px-3">Assignee</th><th className="py-2 px-3">Scheduled</th><th className="py-2 px-3">Status</th>
              </tr></thead>
              <tbody>
                {q.isLoading ? (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground text-xs">Loading…</td></tr>
                ) : (q.data ?? []).length === 0 ? (
                  <tr><td colSpan={6}><EmptyState icon={PackageSearch} title="Nothing here" description="No tasks match this workflow right now." /></td></tr>
                ) : (q.data ?? []).map(t => (
                  <tr key={t.trellis_task_id} className="border-t border-border/50">
                    <td className="py-1.5 px-3">{t.property_name}</td>
                    <td className="py-1.5 px-3">{t.title}</td>
                    <td className="py-1.5 px-3 text-muted-foreground">{t.department_name}</td>
                    <td className="py-1.5 px-3 text-muted-foreground">{t.assigned_to_name ?? '—'}</td>
                    <td className="py-1.5 px-3 tabular-nums">{t.scheduled_date ?? '—'}</td>
                    <td className="py-1.5 px-3"><StatusBadge status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function RosterTab({ roster }: { roster: ReturnType<typeof useTrellisSync>['roster'] }) {
  if (roster.error) return <ErrorState onRetry={() => roster.refetch()} />
  const rows = roster.data ?? []
  return (
    <div className="rounded-2xl border border-card-border shadow-sm overflow-hidden">
      <div className="px-4 py-2 text-2xs text-muted-foreground border-b border-border/50">
        Workspace A members - the canonical "is this person Tendwell?" list used for task attribution.
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40"><tr className="text-2xs uppercase text-muted-foreground text-left">
            <th className="py-2 px-3">Name</th><th className="py-2 px-3">Email</th><th className="py-2 px-3">Role</th><th className="py-2 px-3">Departments</th>
          </tr></thead>
          <tbody>
            {roster.isLoading ? (
              <tr><td colSpan={4} className="py-6 text-center text-muted-foreground text-xs">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4}><EmptyState icon={Users2} title="No roster" description="Run a sync to populate the Tendwell roster." /></td></tr>
            ) : rows.map(m => (
              <tr key={m.user_id} className="border-t border-border/50">
                <td className="py-1.5 px-3 font-medium">{m.name ?? '—'}</td>
                <td className="py-1.5 px-3 text-muted-foreground">{m.email ?? '—'}</td>
                <td className="py-1.5 px-3">{m.role && <StatusBadge tone={m.role === 'ADMIN' ? 'info' : 'primary'}>{m.role}</StatusBadge>}</td>
                <td className="py-1.5 px-3 text-muted-foreground">{m.departments.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Duration formatter ────────────────────────────────────────────────────────

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return '—'
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`
}

function formatCounts(counts: Record<string, number> | null): string {
  if (!counts) return '—'
  const tasks = (counts.tasks_a ?? 0) + (counts.tasks_b ?? 0)
  const props = (counts.props_a ?? 0) + (counts.props_b ?? 0)
  if (tasks === 0 && props === 0) return '—'
  const parts: string[] = []
  if (tasks > 0) parts.push(`${tasks.toLocaleString()} tasks`)
  if (props > 0) parts.push(`${props.toLocaleString()} props`)
  return parts.join(' · ')
}

type SyncStatusTone = 'success' | 'destructive' | 'warning' | 'info'

function syncStatusTone(status: SyncLogRow['status']): SyncStatusTone {
  if (status === 'done') return 'success'
  if (status === 'error') return 'destructive'
  if (status === 'canceled') return 'warning'
  return 'info'
}

function HistoryTab({ syncHistory }: { syncHistory: ReturnType<typeof useTrellisSync>['syncHistory'] }) {
  if (syncHistory.error) return <ErrorState onRetry={() => syncHistory.refetch()} />
  const rows = syncHistory.data ?? []

  return (
    <div className="rounded-2xl border border-card-border shadow-sm overflow-hidden">
      <div className="px-4 py-2 text-2xs text-muted-foreground border-b border-border/50">
        Trellis sync runs (nightly cron + on-demand). The Hostaway tab shows its own last-sync status.
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-2xs uppercase text-muted-foreground text-left">
              <th className="py-2 px-3">When</th>
              <th className="py-2 px-3">Trigger</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3">Duration</th>
              <th className="py-2 px-3">Counts</th>
              <th className="py-2 px-3">Requested by</th>
              <th className="py-2 px-3">Error</th>
            </tr>
          </thead>
          <tbody>
            {syncHistory.isLoading ? (
              <tr><td colSpan={7} className="py-6 text-center text-muted-foreground text-xs">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7}><EmptyState icon={History} title="No sync history" description="Run a sync to see history here." /></td></tr>
            ) : rows.map(row => (
              <tr key={row.id} className="border-t border-border/50">
                <td className="py-1.5 px-3 whitespace-nowrap tabular-nums" title={row.started_at ?? ''}>
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                    {timeAgo(row.started_at)}
                  </span>
                </td>
                <td className="py-1.5 px-3 capitalize text-muted-foreground">{row.trigger}</td>
                <td className="py-1.5 px-3">
                  <StatusBadge tone={syncStatusTone(row.status)}>
                    {row.status}
                  </StatusBadge>
                </td>
                <td className="py-1.5 px-3 tabular-nums text-muted-foreground">
                  {formatDuration(row.started_at, row.finished_at)}
                </td>
                <td className="py-1.5 px-3 text-muted-foreground text-2xs">
                  {formatCounts(row.counts)}
                </td>
                <td className="py-1.5 px-3 text-muted-foreground text-2xs truncate max-w-[140px]">
                  {row.requested_by ?? '—'}
                </td>
                <td className="py-1.5 px-3 text-2xs text-destructive/80 max-w-[200px] truncate" title={row.error ?? ''}>
                  {row.error ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function TrellisSyncPage() {
  usePageTitle('API Sync')
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { recon, exceptions, roster, lastSync, lastDoneSync, syncHistory, trellisProps, opsProperties, dismissals, breezewayCoverage, breezewayExceptions, dismissRow, restoreRow, linkMatch, matchBreezeway, dismissBreezeway, triggerSync, cancelSync } = useTrellisSync()

  // When a sync finishes (done or canceled), refresh snapshot-dependent queries.
  const syncStatus = lastSync.data?.status
  const prevSyncStatus = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (syncStatus === 'done') {
      qc.invalidateQueries({ queryKey: ['/supabase/trellis-sync', 'recon'] })
      qc.invalidateQueries({ queryKey: ['/supabase/trellis-sync', 'exceptions'] })
      qc.invalidateQueries({ queryKey: ['/supabase/trellis-sync', 'roster'] })
      qc.invalidateQueries({ queryKey: ['/supabase/trellis-sync', 'lastDoneSync'] })
      qc.invalidateQueries({ queryKey: ['/supabase/trellis-sync', 'history'] })
      qc.invalidateQueries({ queryKey: ['/supabase/trellis-sync', 'breezewayCoverage'] })
      qc.invalidateQueries({ queryKey: ['/supabase/trellis-sync', 'breezewayExceptions'] })
    }
    if (syncStatus === 'canceled' && prevSyncStatus.current !== 'canceled') {
      toast({ title: 'Sync canceled', description: 'The sync was stopped. Partial data is retained.' })
      qc.invalidateQueries({ queryKey: ['/supabase/trellis-sync', 'history'] })
    }
    prevSyncStatus.current = syncStatus
  }, [syncStatus, qc, toast])

  const tiles = useMemo(() => {
    const rows = recon.data ?? []
    const allDismissals = dismissals.data ?? []
    const dismissedReconIds = new Set(
      allDismissals
        .filter(d => d.kind === 'ops_not_in_trellis' && d.ops_property_id != null)
        .map(d => String(d.ops_property_id))
    )
    const dismissedExIds = new Set(
      allDismissals
        .filter(d => d.kind === 'trellis_not_in_ops' && d.trellis_property_id != null)
        .map(d => d.trellis_property_id as string)
    )
    const by = (s: string) => rows.filter(r =>
      r.match_status === s && (s === 'matched' || !dismissedReconIds.has(String(r.ops_property_id)))
    ).length
    return {
      matched: by('matched'),
      suggested: by('suggested'),
      stale: by('stale'),
      unmatchedOps: by('unmatched'),
      unmatchedTrellis: (exceptions.data ?? []).filter(e => !dismissedExIds.has(e.trellis_id)).length,
    }
  }, [recon.data, exceptions.data, dismissals.data])

  const liveStatus = lastSync.data?.status
  const syncing = liveStatus === 'requested' || liveStatus === 'running'
  // "Canceling" means we've sent the cancel request but the row hasn't flipped yet
  const canceling = cancelSync.isPending || (liveStatus === 'running' && lastSync.data?.cancel_requested === true)
  const liveProgress = lastSync.data?.progress ?? null

  const refresh = async () => {
    try {
      await triggerSync.mutateAsync()
      toast({ title: 'Sync started', description: 'Running server-side sync…' })
    } catch (e) {
      toast({ title: 'Could not start sync', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    }
  }

  const stopSync = async () => {
    try {
      await cancelSync.mutateAsync()
    } catch (e) {
      toast({ title: 'Could not cancel sync', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="API Sync"
        subtitle="Sync and reconcile external systems - Trellis, Breezeway, and Hostaway - against Ops property records."
      />

      <Tabs defaultValue="trellis" className="w-full">
        <TabsList>
          <TabsTrigger value="trellis" data-testid="tab-reconciliation">Trellis</TabsTrigger>
          <TabsTrigger value="breezeway" data-testid="tab-breezeway">Breezeway</TabsTrigger>
          <TabsTrigger value="hostaway" data-testid="tab-hostaway">Hostaway</TabsTrigger>
          <TabsTrigger value="workflows" data-testid="tab-workflows">Trellis Workflows</TabsTrigger>
          <TabsTrigger value="roster" data-testid="tab-roster">Tendwell Roster</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="trellis" className="space-y-5">
          {/* Trellis sync status + controls (nightly cron at 03:00 UTC + on-demand) */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground space-y-1 min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Last Trellis sync {timeAgo(lastDoneSync.data?.finished_at ?? null)}
                {syncing && (
                  <span className="text-warning">
                    · {liveStatus === 'running' ? 'syncing…' : 'sync queued…'}
                  </span>
                )}
              </span>
              {syncing && liveProgress && (
                <SyncProgressBar progress={liveProgress} />
              )}
            </div>
            <div className="flex items-center gap-2">
              {syncing && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={stopSync}
                  disabled={canceling}
                  className="text-warning border-warning/40 hover:bg-warning/10"
                >
                  <Square className="w-3.5 h-3.5 mr-1.5" />
                  {canceling ? 'Canceling…' : 'Stop'}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={refresh} disabled={triggerSync.isPending || syncing}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
                Refresh from Trellis
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard title="Matched" value={tiles.matched} icon={CheckCircle2} tone="success" loading={recon.isLoading} />
            <StatCard title="Unmatched in Ops" value={tiles.unmatchedOps} icon={HelpCircle} tone="warning" loading={recon.isLoading} />
            <StatCard title="In Trellis, not in Ops" value={tiles.unmatchedTrellis} icon={AlertTriangle} tone="destructive" loading={exceptions.isLoading} />
            <StatCard title="Suggested" value={tiles.suggested} icon={Link2} tone="info" loading={recon.isLoading} />
            <StatCard title="Stale links" value={tiles.stale} icon={Unlink} tone="warning" loading={recon.isLoading} />
          </div>

          <ReconciliationTab
            recon={recon}
            exceptions={exceptions}
            trellisProps={trellisProps}
            linkMatch={linkMatch}
            dismissals={dismissals}
            dismissRow={dismissRow}
            restoreRow={restoreRow}
            userLabel={user?.label || 'admin'}
          />
        </TabsContent>
        <TabsContent value="breezeway">
          <BreezewayTab
            recon={recon}
            breezewayCoverage={breezewayCoverage}
            breezewayExceptions={breezewayExceptions}
            opsProperties={opsProperties}
            matchBreezeway={matchBreezeway}
            dismissBreezeway={dismissBreezeway}
            userLabel={user?.label || 'admin'}
          />
        </TabsContent>
        <TabsContent value="hostaway">
          <HostawaySyncTab />
        </TabsContent>
        <TabsContent value="workflows">
          <WorkflowsTab />
        </TabsContent>
        <TabsContent value="roster">
          <RosterTab roster={roster} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab syncHistory={syncHistory} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
