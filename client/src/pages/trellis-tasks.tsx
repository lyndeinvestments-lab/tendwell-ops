import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useTrellisTasksToday, todayInCentral } from '@/hooks/use-trellis-tasks-today'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Link } from 'wouter'
import {
  AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, Clock,
  RefreshCw, Search, UserPlus,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SnapshotTask {
  trellis_task_id: string
  workspace: 'A' | 'B'
  property_name: string | null
  title: string | null
  department_name: string | null
  status: string | null
  priority: string | null
  assigned_to_name: string | null
  scheduled_date: string | null
  completed_at: string | null
  synced_at: string
}

interface RosterMember {
  user_id: string
  name: string | null
  email: string | null
  role: string | null
  workspace: string
  is_active: boolean
}

type TabId = 'overdue' | 'today' | 'completed' | 'all'

const OPEN_STATUSES = ['SCHEDULED', 'OPEN']
const TURN_CLEAN_TITLE = 'turn clean'

// Trellis-internal / test accounts that should never show as "missing from Ops".
function isIgnorableRosterMember(m: RosterMember): boolean {
  const email = (m.email ?? '').toLowerCase()
  return (
    email.endsWith('@trellistech.com') ||
    email.endsWith('.test') ||
    (m.name ?? '').trim() === 'Tendwell Cleaning Co.' ||
    (m.name ?? '').trim() === 'AI Agent'
  )
}

function daysOverdue(scheduled: string | null, today: string): number {
  if (!scheduled) return 0
  const ms = new Date(`${today}T00:00:00`).getTime() - new Date(`${scheduled}T00:00:00`).getTime()
  return Math.max(0, Math.round(ms / 86400000))
}

function formatDay(d: string | null): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TrellisTasksPage() {
  usePageTitle('Trellis Tasks')
  const { effectiveUser } = useAuth()
  const isAdmin = effectiveUser?.role === 'admin'
  const { toast } = useToast()
  const qc = useQueryClient()

  const today = todayInCentral()
  const [tab, setTab] = useState<TabId>('overdue')
  const [search, setSearch] = useState('')
  const [turnOnly, setTurnOnly] = useState(false)

  // All tasks scheduled up to today within the snapshot window (-30d). Covers
  // overdue (open, < today), due today, and completed today in one query.
  const tasksQuery = useQuery<SnapshotTask[]>({
    queryKey: ['/supabase/trellis-tasks', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trellis_task_snapshot')
        .select('trellis_task_id, workspace, property_name, title, department_name, status, priority, assigned_to_name, scheduled_date, completed_at, synced_at')
        .lte('scheduled_date', today)
        .order('scheduled_date', { ascending: true })
        .limit(2000)
      if (error) throw error
      return (data ?? []) as SnapshotTask[]
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const { data: tileData } = useTrellisTasksToday()

  // Roster gap (admin only — trellis_roster RLS is admin-only).
  const rosterGapQuery = useQuery<RosterMember[]>({
    queryKey: ['/supabase/trellis-roster-gap'],
    enabled: isAdmin,
    queryFn: async () => {
      const [rosterRes, cleanersRes, usersRes] = await Promise.all([
        supabase.from('trellis_roster').select('user_id, name, email, role, workspace, is_active').eq('is_active', true),
        supabase.from('cleaners').select('email'),
        supabase.from('app_users').select('google_email'),
      ])
      if (rosterRes.error) throw rosterRes.error
      const known = new Set<string>()
      for (const c of (cleanersRes.data ?? []) as Array<{ email: string | null }>) {
        if (c.email) known.add(c.email.toLowerCase())
      }
      for (const u of (usersRes.data ?? []) as Array<{ google_email: string | null }>) {
        if (u.google_email) known.add(u.google_email.toLowerCase())
      }
      return ((rosterRes.data ?? []) as RosterMember[])
        .filter(m => !isIgnorableRosterMember(m))
        .filter(m => !m.email || !known.has(m.email.toLowerCase()))
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  // Refresh: trigger the on-demand server-side sync (same endpoint as API Sync).
  const triggerSync = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/trellis/sync-now', {
        method: 'POST',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Sync failed (${res.status})`)
      }
      return res.json()
    },
    onSuccess: () => {
      toast({ title: 'Sync started', description: 'Tasks refresh in a minute or two — data updates automatically.' })
      // Re-pull after the sync has had time to finish.
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['/supabase/trellis-tasks'] })
        qc.invalidateQueries({ queryKey: ['/supabase/trellis-tasks-today'] })
      }, 90_000)
    },
    onError: (e: unknown) => toast({ title: 'Could not start sync', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  })

  // ── Derived buckets ────────────────────────────────────────────────────────
  const tasks = tasksQuery.data ?? []
  const buckets = useMemo(() => {
    const isOpen = (t: SnapshotTask) => OPEN_STATUSES.includes(t.status ?? '')
    const isTurn = (t: SnapshotTask) => (t.title ?? '').trim().toLowerCase() === TURN_CLEAN_TITLE
    const overdue = tasks.filter(t => isOpen(t) && (t.scheduled_date ?? '') < today)
    const dueToday = tasks.filter(t => isOpen(t) && t.scheduled_date === today)
    const completedToday = tasks.filter(t => t.status === 'COMPLETED' && t.scheduled_date === today)
    const turnToday = tasks.filter(t => isTurn(t) && t.scheduled_date === today)
    return { overdue, dueToday, completedToday, turnToday, isTurn }
  }, [tasks, today])

  const visible = useMemo(() => {
    let rows: SnapshotTask[] =
      tab === 'overdue' ? buckets.overdue
      : tab === 'today' ? [...buckets.dueToday, ...buckets.completedToday]
      : tab === 'completed' ? tasks.filter(t => t.status === 'COMPLETED')
      : tasks
    if (turnOnly) rows = rows.filter(buckets.isTurn)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(t =>
        (t.property_name ?? '').toLowerCase().includes(q) ||
        (t.title ?? '').toLowerCase().includes(q) ||
        (t.assigned_to_name ?? '').toLowerCase().includes(q),
      )
    }
    // Completed lists read best newest-first; open lists oldest-first (most overdue on top).
    if (tab === 'completed') rows = [...rows].reverse()
    return rows
  }, [tab, tasks, buckets, turnOnly, search])

  const lastSynced = tileData?.syncedAt ?? tasks[0]?.synced_at ?? null

  const TABS: Array<{ id: TabId; label: string; count: number }> = [
    { id: 'overdue', label: 'Overdue', count: buckets.overdue.length },
    { id: 'today', label: 'Due Today', count: buckets.dueToday.length },
    { id: 'completed', label: 'Completed', count: buckets.completedToday.length },
    { id: 'all', label: 'All', count: tasks.length },
  ]

  return (
    <PageContainer className="md:h-full md:flex md:flex-col">
      <PageHeader
        title="Trellis Tasks"
        subtitle="Cleaning and ops tasks from the Trellis snapshot — synced hourly."
        actions={
          <div className="flex items-center gap-2">
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {lastSynced ? `Synced ${new Date(lastSynced).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Not synced yet'}
            </span>
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={() => triggerSync.mutate()} disabled={triggerSync.isPending} data-testid="button-refresh-trellis-tasks">
                <RefreshCw className={cn('w-4 h-4 mr-1.5', triggerSync.isPending && 'animate-spin')} />
                Refresh
              </Button>
            )}
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title="Overdue"
          value={buckets.overdue.length}
          subtitle="open, past due date"
          icon={AlertTriangle}
          tone={buckets.overdue.length > 0 ? 'destructive' : 'success'}
          loading={tasksQuery.isLoading}
          onClick={() => setTab('overdue')}
          testId="stat-overdue"
        />
        <StatCard
          title="Due Today"
          value={buckets.dueToday.length}
          subtitle={today}
          icon={CalendarClock}
          tone="info"
          loading={tasksQuery.isLoading}
          onClick={() => setTab('today')}
          testId="stat-due-today"
        />
        <StatCard
          title="Turn Cleans Today"
          value={buckets.turnToday.length}
          subtitle={`${buckets.turnToday.filter(t => t.status === 'COMPLETED').length} done · ${buckets.turnToday.filter(t => OPEN_STATUSES.includes(t.status ?? '')).length} open`}
          icon={ClipboardCheck}
          tone="warning"
          loading={tasksQuery.isLoading}
          onClick={() => { setTab('today'); setTurnOnly(true) }}
          testId="stat-turn-cleans"
        />
        <StatCard
          title="Completed Today"
          value={buckets.completedToday.length}
          subtitle="of today's scheduled"
          icon={CheckCircle2}
          tone="success"
          loading={tasksQuery.isLoading}
          onClick={() => setTab('completed')}
          testId="stat-completed-today"
        />
      </div>

      {/* Roster gap — admin only */}
      {isAdmin && (rosterGapQuery.data?.length ?? 0) > 0 && (
        <Card className="rounded-2xl border-card-border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <UserPlus className="w-4 h-4 text-warning" />
              <span className="text-sm font-medium">In Trellis, not in Ops</span>
              <span className="text-xs text-muted-foreground">{rosterGapQuery.data!.length} people</span>
              <Link href="/cleaners" className="ml-auto text-xs text-primary hover:underline">Add on Cleaners page →</Link>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {rosterGapQuery.data!.map(m => (
                <div key={m.user_id} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 min-w-0" data-testid={`roster-gap-${m.user_id}`}>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{m.name ?? '(no name)'}</p>
                    <p className="text-2xs text-muted-foreground truncate">{m.email ?? 'no email'}</p>
                  </div>
                  <StatusBadge tone="neutral" className="ml-auto shrink-0">{(m.role ?? '').toLowerCase()}</StatusBadge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border p-0.5 bg-muted/40">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              data-testid={`tab-${t.id}`}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                tab === t.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label} <span className="tabular-nums text-muted-foreground">{t.count}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setTurnOnly(v => !v)}
          data-testid="toggle-turn-only"
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
            turnOnly ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          Turn cleans only
        </button>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search property, task, assignee…"
            className="pl-8 h-8 text-sm"
            data-testid="input-task-search"
          />
        </div>
      </div>

      {/* Table / cards */}
      {tasksQuery.error ? (
        <ErrorState title="Couldn't load Trellis tasks" onRetry={() => tasksQuery.refetch()} />
      ) : tasksQuery.isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No tasks here"
          description={tab === 'overdue' ? 'Nothing overdue — all caught up.' : 'No tasks match the current filters.'}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-2xl border border-card-border shadow-sm overflow-hidden md:flex-1 md:min-h-0">
            <div className="overflow-auto md:h-full">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                  <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Property</th>
                    <th className="px-3 py-2 font-medium">Task</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Due</th>
                    <th className="px-3 py-2 font-medium">Assignee</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(t => {
                    const od = OPEN_STATUSES.includes(t.status ?? '') ? daysOverdue(t.scheduled_date, today) : 0
                    return (
                      <tr key={t.trellis_task_id} className="border-t border-border/60 hover:bg-muted/30" data-testid={`row-task-${t.trellis_task_id}`}>
                        <td className="px-3 py-2 font-medium max-w-56 truncate">{t.property_name ?? '—'}</td>
                        <td className="px-3 py-2 max-w-64 truncate">{t.title ?? '—'}</td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={t.status === 'COMPLETED' ? 'success' : od > 0 ? 'destructive' : 'info'}>
                            {(t.status ?? 'unknown').toLowerCase()}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="tabular-nums">{formatDay(t.scheduled_date)}</span>
                          {od > 0 && <span className="ml-1.5 text-2xs font-medium text-destructive">{od}d late</span>}
                        </td>
                        <td className="px-3 py-2 max-w-44 truncate">{t.assigned_to_name ?? '—'}</td>
                        <td className="px-3 py-2">
                          <StatusBadge tone="neutral">{t.workspace === 'A' ? 'Tendwell' : 'Haven'}</StatusBadge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {visible.map(t => {
              const od = OPEN_STATUSES.includes(t.status ?? '') ? daysOverdue(t.scheduled_date, today) : 0
              return (
                <Card key={t.trellis_task_id} className="border-card-border">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{t.property_name ?? '—'}</p>
                        <p className="text-xs text-muted-foreground truncate">{t.title ?? '—'} · {t.assigned_to_name ?? 'unassigned'}</p>
                      </div>
                      <StatusBadge tone={t.status === 'COMPLETED' ? 'success' : od > 0 ? 'destructive' : 'info'}>
                        {(t.status ?? 'unknown').toLowerCase()}
                      </StatusBadge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5 tabular-nums">
                      Due {formatDay(t.scheduled_date)}
                      {od > 0 && <span className="ml-1.5 font-medium text-destructive">{od}d late</span>}
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </PageContainer>
  )
}
