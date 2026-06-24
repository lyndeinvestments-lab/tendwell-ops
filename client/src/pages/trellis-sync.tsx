import { useEffect, useMemo, useState } from 'react'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { useAuth } from '@/lib/auth'
import { RefreshCw, Link2, CheckCircle2, AlertTriangle, HelpCircle, Unlink, Inbox, PackageSearch, Users2, Pencil, Check, Eye, EyeOff, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTrellisSync, fetchTasks, type TaskRow, type TrellisPropOption, type DismissalRow } from '@/hooks/use-trellis-sync'

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
          <p className="text-xs text-destructive">Failed to load exceptions — <button className="underline" onClick={() => exceptions.refetch()}>retry</button>.</p>
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
                      {r.match_status === 'unmatched' && <span className="text-muted-foreground/60">—</span>}
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

const WORKFLOWS: { id: string; label: string; description: string; run: () => Promise<TaskRow[]> }[] = [
  { id: 'today', label: "Today's Tendwell cleans", description: 'All Tendwell cleaning/inspection tasks scheduled today (A + B).',
    run: () => fetchTasks({ tendwellOnly: true, scheduledFrom: todayISO(), scheduledTo: todayISO() }) },
  { id: 'upcoming', label: 'Upcoming (next 7 days)', description: 'Scheduled Tendwell cleans/inspections in the next week.',
    run: () => fetchTasks({ tendwellOnly: true, scheduledFrom: todayISO(), scheduledTo: plusDaysISO(7) }) },
  { id: 'selfinspections', label: 'Cleaner self-inspections due', description: 'Open Cleaner Self-Inspection tasks.',
    run: () => fetchTasks({ tendwellOnly: true, titleILike: 'Self-Inspection', openOnly: true }) },
  { id: 'unassigned', label: 'Unassigned Tendwell work', description: 'B tasks still on "Tendwell Cleaning Co." — not yet dispatched to a person.',
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
        Workspace A members — the canonical "is this person Tendwell?" list used for task attribution.
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

export default function TrellisSyncPage() {
  usePageTitle('Trellis Sync')
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { recon, exceptions, roster, lastSync, trellisProps, dismissals, dismissRow, restoreRow, linkMatch, requestSync } = useTrellisSync()

  // When a sync finishes, the snapshot data has changed — refresh the
  // reconciliation/exceptions/roster queries so the tiles + tables stop
  // showing pre-sync counts without requiring a manual page reload.
  const syncStatus = lastSync.data?.status
  useEffect(() => {
    if (syncStatus === 'done') {
      qc.invalidateQueries({ queryKey: ['/supabase/trellis-sync', 'recon'] })
      qc.invalidateQueries({ queryKey: ['/supabase/trellis-sync', 'exceptions'] })
      qc.invalidateQueries({ queryKey: ['/supabase/trellis-sync', 'roster'] })
    }
  }, [syncStatus, qc])

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
    // Matched rows are never dismissable — always shown
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

  const syncing = lastSync.data?.status === 'requested' || lastSync.data?.status === 'running'

  const refresh = async () => {
    try {
      await requestSync.mutateAsync(user?.label || 'admin')
      toast({ title: 'Sync requested', description: 'The local runner will pick this up within a couple of minutes.' })
    } catch (e) {
      toast({ title: 'Could not request sync', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Trellis Sync"
        subtitle={
          <span>
            Last synced {timeAgo(lastSync.data?.finished_at ?? null)}
            {syncing && <span className="ml-2 text-warning">· sync {lastSync.data?.status}…</span>}
          </span>
        }
        actions={
          <Button size="sm" variant="outline" onClick={refresh} disabled={requestSync.isPending || syncing}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard title="Matched" value={tiles.matched} icon={CheckCircle2} tone="success" loading={recon.isLoading} />
        <StatCard title="Unmatched in Ops" value={tiles.unmatchedOps} icon={HelpCircle} tone="warning" loading={recon.isLoading} />
        <StatCard title="In Trellis, not in Ops" value={tiles.unmatchedTrellis} icon={AlertTriangle} tone="destructive" loading={exceptions.isLoading} />
        <StatCard title="Suggested" value={tiles.suggested} icon={Link2} tone="info" loading={recon.isLoading} />
        <StatCard title="Stale links" value={tiles.stale} icon={Unlink} tone="warning" loading={recon.isLoading} />
      </div>

      <Tabs defaultValue="reconciliation" className="w-full">
        <TabsList>
          <TabsTrigger value="reconciliation" data-testid="tab-reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="workflows" data-testid="tab-workflows">Workflows</TabsTrigger>
          <TabsTrigger value="roster" data-testid="tab-roster">Tendwell Roster</TabsTrigger>
        </TabsList>

        <TabsContent value="reconciliation" className="space-y-5">
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
        <TabsContent value="workflows">
          <WorkflowsTab />
        </TabsContent>
        <TabsContent value="roster">
          <RosterTab roster={roster} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
