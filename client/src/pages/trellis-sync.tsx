import { useMemo, useState } from 'react'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/lib/auth'
import { RefreshCw, Link2, CheckCircle2, AlertTriangle, HelpCircle, Unlink, Inbox, PackageSearch, Users2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useTrellisSync, fetchTasks, type TaskRow } from '@/hooks/use-trellis-sync'

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

function ReconciliationTab({ recon, exceptions, linkMatch }: {
  recon: ReturnType<typeof useTrellisSync>['recon']
  exceptions: ReturnType<typeof useTrellisSync>['exceptions']
  linkMatch: ReturnType<typeof useTrellisSync>['linkMatch']
}) {
  const { toast } = useToast()
  if (recon.error) return <ErrorState onRetry={() => recon.refetch()} />

  const rows = recon.data ?? []
  const exRows = exceptions.data ?? []

  const confirm = async (opsId: number, opsName: string, trellisId: string | null) => {
    try {
      await linkMatch.mutateAsync({ opsId, opsName, trellisId })
      toast({ title: trellisId ? 'Match linked' : 'Match cleared', description: opsName })
    } catch (e) {
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-5">
      {/* Exceptions panel — Tendwell work in Trellis with no Ops home */}
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <h2 className="text-sm font-semibold">In Trellis, not in Ops ({exRows.length})</h2>
        </div>
        {exceptions.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : exRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing unaccounted for. Every Tendwell-serviced Trellis property maps to an Ops property.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-2xs uppercase text-muted-foreground text-left">
                <th className="py-1 pr-3">Trellis property</th><th className="py-1 pr-3">Workspace</th><th className="py-1 pr-3">Tendwell tasks</th>
              </tr></thead>
              <tbody>
                {exRows.map(e => (
                  <tr key={e.trellis_id} className="border-t border-border/50">
                    <td className="py-1.5 pr-3">{e.name}</td>
                    <td className="py-1.5 pr-3">{workspaceBadge(e.workspace)}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{e.tendwell_task_count}</td>
                  </tr>
                ))}
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
              ) : rows.length === 0 ? (
                <tr><td colSpan={6}><EmptyState icon={Inbox} title="No properties" description="Run a sync to populate Trellis data." /></td></tr>
              ) : rows.map(r => (
                <tr key={r.ops_property_id} className="border-t border-border/50">
                  <td className="py-1.5 px-3 font-medium">{r.ops_name}</td>
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
                    {r.match_status === 'suggested' && (
                      <Button size="sm" variant="outline" onClick={() => confirm(r.ops_property_id, r.ops_name, r.suggested_trellis_id)} disabled={linkMatch.isPending}>
                        Confirm
                      </Button>
                    )}
                    {r.match_status === 'stale' && (
                      <Button size="sm" variant="ghost" onClick={() => confirm(r.ops_property_id, r.ops_name, null)} disabled={linkMatch.isPending}>
                        Clear link
                      </Button>
                    )}
                  </td>
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
  { id: 'unassigned', label: 'Unassigned Tendwell work', description: 'B tasks still on "Tendwell Cleaning Co." — not yet dispatched to a person.',
    run: () => fetchTasks({ unassignedTendwellCo: true, openOnly: true }) },
  { id: 'airfilters', label: 'Air-filter changes scheduled', description: 'Upcoming Air Filter Change tasks.',
    run: () => fetchTasks({ tendwellOnly: true, titleILike: 'Air Filter', scheduledFrom: todayISO(), scheduledTo: plusDaysISO(60) }) },
]

function WorkflowsTab() {
  const [active, setActive] = useState(WORKFLOWS[0].id)
  const wf = WORKFLOWS.find(w => w.id === active)!
  const q = useQuery({
    queryKey: ['/supabase/trellis-sync', 'workflow', active],
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
  const { user } = useAuth()
  const { toast } = useToast()
  const { recon, exceptions, roster, lastSync, linkMatch, requestSync } = useTrellisSync()

  const tiles = useMemo(() => {
    const rows = recon.data ?? []
    const by = (s: string) => rows.filter(r => r.match_status === s).length
    return {
      matched: by('matched'),
      suggested: by('suggested'),
      stale: by('stale'),
      unmatchedOps: by('unmatched'),
      unmatchedTrellis: exceptions.data?.length ?? 0,
    }
  }, [recon.data, exceptions.data])

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
          <ReconciliationTab recon={recon} exceptions={exceptions} linkMatch={linkMatch} />
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
