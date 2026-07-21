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
import { slugify } from '@/lib/issues'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { format as dfFormat } from 'date-fns'
import { es as dateFnsEs } from 'date-fns/locale'
import {
  AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, Clock,
  RefreshCw, Search, UserPlus, ExternalLink,
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
  assigned_to_id: string | null
  assigned_to_name: string | null
  scheduled_date: string | null
  completed_at: string | null
  synced_at: string
}

const VENDOR_ENTITY = 'Tendwell Cleaning Co.'

// Trellis's own Overdue tab only counts tasks assigned to a person; tasks
// held by the vendor entity or nobody sit in its "Unassigned" bucket. Mirror
// that so our Overdue number matches what Jordan sees in Trellis.
function isAssignedToPerson(t: SnapshotTask): boolean {
  return t.assigned_to_id != null && t.assigned_to_name !== VENDOR_ENTITY
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

// Deep-link to a task in the Trellis web app's authenticated task list, which
// opens the task's detail panel via the ?taskId query param. Confirmed with
// Jordan 2026-07-10: he operates in the Tendwell (vendor) workspace, which
// surfaces both Tendwell-direct and Haven-assigned cleaning tasks — a
// Haven-property task opened under /tendwell-cleaning/. `taskId` is the
// canonical task id we already store as trellis_task_id. (The /task/<id> path
// is Trellis's separate, expiring share-link feature and is NOT usable here.)
const TRELLIS_WORKSPACE_SLUG = 'tendwell-cleaning'
function trellisTaskUrl(id: string, status: string | null): string {
  const tab = status && ['SCHEDULED', 'OPEN', 'COMPLETED'].includes(status) ? status : 'SCHEDULED'
  return `https://app.trellistech.com/${TRELLIS_WORKSPACE_SLUG}/tasks/list/all?taskId=${id}&tab=${tab}`
}

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

function formatDay(d: string | null, locale: 'en' | 'es' = 'en'): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-').map(Number)
  return dfFormat(new Date(y, m - 1, day), 'MMM d', locale === 'es' ? { locale: dateFnsEs } : undefined)
}

function formatSyncedAt(value: string, locale: 'en' | 'es' = 'en'): string {
  return dfFormat(new Date(value), 'MMM d, h:mm a', locale === 'es' ? { locale: dateFnsEs } : undefined)
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TrellisTasksPage() {
  usePageTitle('Trellis Tasks')
  const { t, locale } = useLocale('trellisTasks')
  const { effectiveUser } = useAuth()
  const isAdmin = effectiveUser?.role === 'admin'
  const { toast } = useToast()
  const qc = useQueryClient()

  const today = todayInCentral()
  const [tab, setTab] = useState<TabId>('overdue')
  const [search, setSearch] = useState('')
  const [turnOnly, setTurnOnly] = useState(false)
  const [includeUnassigned, setIncludeUnassigned] = useState(false)
  const [showDismissed, setShowDismissed] = useState(false)

  // All tasks scheduled up to today within the snapshot window (-30d). Covers
  // overdue (open, < today), due today, and completed today in one query.
  const tasksQuery = useQuery<SnapshotTask[]>({
    queryKey: ['/supabase/trellis-tasks', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trellis_task_snapshot')
        .select('trellis_task_id, workspace, property_name, title, department_name, status, priority, assigned_to_id, assigned_to_name, scheduled_date, completed_at, synced_at')
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

  // Roster gap (admin only — trellis_roster RLS is admin-only). Returns both
  // the open gap list and the dismissed list so the panel can restore.
  const rosterGapQuery = useQuery<{ gap: RosterMember[]; dismissed: RosterMember[] }>({
    queryKey: ['/supabase/trellis-roster-gap'],
    enabled: isAdmin,
    queryFn: async () => {
      const [rosterRes, cleanersRes, usersRes, dismissRes] = await Promise.all([
        supabase.from('trellis_roster').select('user_id, name, email, role, workspace, is_active').eq('is_active', true),
        supabase.from('cleaners').select('email, alt_email'),
        supabase.from('app_users').select('google_email'),
        supabase.from('trellis_roster_dismissals').select('user_id'),
      ])
      if (rosterRes.error) throw rosterRes.error
      const known = new Set<string>()
      for (const c of (cleanersRes.data ?? []) as Array<{ email: string | null; alt_email: string | null }>) {
        if (c.email) known.add(c.email.toLowerCase())
        if (c.alt_email) known.add(c.alt_email.toLowerCase())
      }
      for (const u of (usersRes.data ?? []) as Array<{ google_email: string | null }>) {
        if (u.google_email) known.add(u.google_email.toLowerCase())
      }
      const dismissedIds = new Set(((dismissRes.data ?? []) as Array<{ user_id: string }>).map(d => d.user_id))
      const missing = ((rosterRes.data ?? []) as RosterMember[])
        .filter(m => !isIgnorableRosterMember(m))
        .filter(m => !m.email || !known.has(m.email.toLowerCase()))
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      return {
        gap: missing.filter(m => !dismissedIds.has(m.user_id)),
        dismissed: missing.filter(m => dismissedIds.has(m.user_id)),
      }
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  const invalidateRosterGap = () => qc.invalidateQueries({ queryKey: ['/supabase/trellis-roster-gap'] })

  // Add a roster member to the Ops cleaners list (matched back by email, so
  // they drop out of the gap list on the next refetch).
  const addCleaner = useMutation({
    mutationFn: async (m: RosterMember) => {
      const { error } = await supabase.from('cleaners').insert({
        full_name: m.name ?? m.email ?? 'Unknown',
        email: m.email,
        is_active: true,
      } as any)
      if (error) throw error
      return m
    },
    onSuccess: (m) => {
      toast({ title: t('toasts.addedTitle', { name: m.name ?? m.email ?? '' }), description: t('toasts.addedDescription') })
      invalidateRosterGap()
      qc.invalidateQueries({ queryKey: ['cleaners'] })
    },
    onError: (e: any) => toast({ title: t('toasts.addFailedTitle'), description: e?.message, variant: 'destructive' }),
  })

  const dismissMember = useMutation({
    mutationFn: async (m: RosterMember) => {
      const { error } = await supabase.from('trellis_roster_dismissals').insert({
        user_id: m.user_id, name: m.name, email: m.email, dismissed_by: effectiveUser?.label ?? null,
      } as any)
      if (error) throw error
      return m
    },
    onSuccess: (m) => { toast({ title: t('toasts.dismissedTitle', { name: m.name ?? m.email ?? '' }) }); invalidateRosterGap() },
    onError: (e: any) => toast({ title: t('toasts.dismissFailedTitle'), description: e?.message, variant: 'destructive' }),
  })

  const restoreMember = useMutation({
    mutationFn: async (m: RosterMember) => {
      const { error } = await supabase.from('trellis_roster_dismissals').delete().eq('user_id', m.user_id)
      if (error) throw error
      return m
    },
    onSuccess: (m) => { toast({ title: t('toasts.restoredTitle', { name: m.name ?? m.email ?? '' }) }); invalidateRosterGap() },
    onError: (e: any) => toast({ title: t('toasts.restoreFailedTitle'), description: e?.message, variant: 'destructive' }),
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
      toast({ title: t('toasts.syncStartedTitle'), description: t('toasts.syncStartedDescription') })
      // Re-pull after the sync has had time to finish.
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['/supabase/trellis-tasks'] })
        qc.invalidateQueries({ queryKey: ['/supabase/trellis-tasks-today'] })
      }, 90_000)
    },
    onError: (e: unknown) => toast({ title: t('toasts.syncFailedTitle'), description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  })

  // ── Derived buckets ────────────────────────────────────────────────────────
  const tasks = tasksQuery.data ?? []
  const buckets = useMemo(() => {
    const isOpen = (t: SnapshotTask) => OPEN_STATUSES.includes(t.status ?? '')
    const isTurn = (t: SnapshotTask) => (t.title ?? '').trim().toLowerCase() === TURN_CLEAN_TITLE
    const pastDue = tasks.filter(t => isOpen(t) && (t.scheduled_date ?? '') < today)
    // Overdue mirrors Trellis's Overdue tab: person-assigned only. The rest
    // (vendor-entity or nobody) is Trellis's "Unassigned" bucket.
    const overdue = pastDue.filter(isAssignedToPerson)
    const overdueUnassigned = pastDue.filter(t => !isAssignedToPerson(t))
    const dueToday = tasks.filter(t => isOpen(t) && t.scheduled_date === today)
    const completedToday = tasks.filter(t => t.status === 'COMPLETED' && t.scheduled_date === today)
    const turnToday = tasks.filter(t => isTurn(t) && t.scheduled_date === today)
    return { overdue, overdueUnassigned, dueToday, completedToday, turnToday, isTurn }
  }, [tasks, today])

  const visible = useMemo(() => {
    let rows: SnapshotTask[] =
      tab === 'overdue' ? (includeUnassigned ? [...buckets.overdue, ...buckets.overdueUnassigned] : buckets.overdue)
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
  }, [tab, tasks, buckets, turnOnly, search, includeUnassigned])

  const lastSynced = tileData?.syncedAt ?? tasks[0]?.synced_at ?? null

  const TABS: Array<{ id: TabId; label: string; count: number }> = [
    { id: 'overdue', label: t('filters.tabs.overdue'), count: buckets.overdue.length },
    { id: 'today', label: t('filters.tabs.today'), count: buckets.dueToday.length },
    { id: 'completed', label: t('filters.tabs.completed'), count: buckets.completedToday.length },
    { id: 'all', label: t('filters.tabs.all'), count: tasks.length },
  ]

  return (
    <PageContainer className="md:h-full md:flex md:flex-col">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {lastSynced ? t('page.syncedPrefix', { date: formatSyncedAt(lastSynced, locale) }) : t('page.notSyncedYet')}
            </span>
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={() => triggerSync.mutate()} disabled={triggerSync.isPending} data-testid="button-refresh-trellis-tasks">
                <RefreshCw className={cn('w-4 h-4 mr-1.5', triggerSync.isPending && 'animate-spin')} />
                {t('page.refresh')}
              </Button>
            )}
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title={t('tiles.overdue')}
          value={buckets.overdue.length}
          subtitle={buckets.overdueUnassigned.length > 0 ? t('tiles.overdueSubtitleUnassigned', { count: buckets.overdueUnassigned.length }) : t('tiles.overdueSubtitleDefault')}
          icon={AlertTriangle}
          tone={buckets.overdue.length > 0 ? 'destructive' : 'success'}
          loading={tasksQuery.isLoading}
          onClick={() => setTab('overdue')}
          testId="stat-overdue"
        />
        <StatCard
          title={t('tiles.dueToday')}
          value={buckets.dueToday.length}
          subtitle={today}
          icon={CalendarClock}
          tone="info"
          loading={tasksQuery.isLoading}
          onClick={() => setTab('today')}
          testId="stat-due-today"
        />
        <StatCard
          title={t('tiles.turnCleansToday')}
          value={buckets.turnToday.length}
          subtitle={t('tiles.turnCleansSubtitle', {
            done: buckets.turnToday.filter(t => t.status === 'COMPLETED').length,
            open: buckets.turnToday.filter(t => OPEN_STATUSES.includes(t.status ?? '')).length,
          })}
          icon={ClipboardCheck}
          tone="warning"
          loading={tasksQuery.isLoading}
          onClick={() => { setTab('today'); setTurnOnly(true) }}
          testId="stat-turn-cleans"
        />
        <StatCard
          title={t('tiles.completedToday')}
          value={buckets.completedToday.length}
          subtitle={t('tiles.completedTodaySubtitle')}
          icon={CheckCircle2}
          tone="success"
          loading={tasksQuery.isLoading}
          onClick={() => setTab('completed')}
          testId="stat-completed-today"
        />
      </div>

      {/* Roster gap — admin only */}
      {isAdmin && ((rosterGapQuery.data?.gap.length ?? 0) > 0 || (rosterGapQuery.data?.dismissed.length ?? 0) > 0) && (
        <Card className="rounded-2xl border-card-border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <UserPlus className="w-4 h-4 text-warning" />
              <span className="text-sm font-medium">{t('roster.heading')}</span>
              <span className="text-xs text-muted-foreground">{t('roster.peopleCount', { count: rosterGapQuery.data!.gap.length })}</span>
              {(rosterGapQuery.data?.dismissed.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDismissed(v => !v)}
                  className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline"
                  data-testid="toggle-show-dismissed"
                >
                  {showDismissed ? t('roster.hideDismissed') : t('roster.showDismissed', { count: rosterGapQuery.data!.dismissed.length })}
                </button>
              )}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {rosterGapQuery.data!.gap.map(m => (
                <div key={m.user_id} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 min-w-0" data-testid={`roster-gap-${m.user_id}`}>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{m.name ?? t('roster.noName')}</p>
                    <p className="text-2xs text-muted-foreground truncate">{m.email ?? t('roster.noEmail')} · {(m.role ?? '').toLowerCase()}</p>
                  </div>
                  <div className="ml-auto flex items-center gap-1 shrink-0">
                    {m.email && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-2xs"
                        disabled={addCleaner.isPending}
                        onClick={() => addCleaner.mutate(m)}
                        title={t('roster.addTitle')}
                        data-testid={`roster-add-${m.user_id}`}
                      >
                        <UserPlus className="w-3 h-3 mr-1" /> {t('roster.add')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-2xs text-muted-foreground"
                      disabled={dismissMember.isPending}
                      onClick={() => dismissMember.mutate(m)}
                      title={t('roster.dismissTitle')}
                      data-testid={`roster-dismiss-${m.user_id}`}
                    >
                      {t('roster.dismiss')}
                    </Button>
                  </div>
                </div>
              ))}
              {rosterGapQuery.data!.gap.length === 0 && (
                <p className="text-xs text-muted-foreground col-span-full">{t('roster.allDismissed')}</p>
              )}
            </div>
            {showDismissed && rosterGapQuery.data!.dismissed.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/60">
                <p className="text-2xs uppercase tracking-wide text-muted-foreground mb-1.5">{t('roster.dismissedHeading')}</p>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {rosterGapQuery.data!.dismissed.map(m => (
                    <div key={m.user_id} className="flex items-center gap-2 rounded-md border border-border/50 px-2.5 py-1.5 min-w-0 opacity-70" data-testid={`roster-dismissed-${m.user_id}`}>
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{m.name ?? t('roster.noName')}</p>
                        <p className="text-2xs text-muted-foreground truncate">{m.email ?? t('roster.noEmail')}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-6 px-2 text-2xs shrink-0"
                        disabled={restoreMember.isPending}
                        onClick={() => restoreMember.mutate(m)}
                        data-testid={`roster-restore-${m.user_id}`}
                      >
                        {t('roster.restore')}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border p-0.5 bg-muted/40">
          {TABS.map(tb => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              data-testid={`tab-${tb.id}`}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                tab === tb.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tb.label} <span className="tabular-nums text-muted-foreground">{tb.count}</span>
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
          {t('filters.turnCleansOnly')}
        </button>
        {tab === 'overdue' && (
          <button
            type="button"
            onClick={() => setIncludeUnassigned(v => !v)}
            data-testid="toggle-include-unassigned"
            title={t('filters.includeUnassignedTitle')}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
              includeUnassigned ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {t('filters.includeUnassigned', { count: buckets.overdueUnassigned.length })}
          </button>
        )}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('filters.searchPlaceholder')}
            className="pl-8 h-8 text-sm"
            data-testid="input-task-search"
          />
        </div>
      </div>

      {/* Table / cards */}
      {tasksQuery.error ? (
        <ErrorState title={t('page.errorTitle')} onRetry={() => tasksQuery.refetch()} />
      ) : tasksQuery.isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={t('table.emptyTitle')}
          description={tab === 'overdue' ? t('table.emptyOverdue') : t('table.emptyFiltered')}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-2xl border border-card-border shadow-sm overflow-hidden md:flex-1 md:min-h-0">
            <div className="overflow-auto md:h-full">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                  <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t('table.property')}</th>
                    <th className="px-3 py-2 font-medium">{t('table.task')}</th>
                    <th className="px-3 py-2 font-medium">{t('table.status')}</th>
                    <th className="px-3 py-2 font-medium">{t('table.due')}</th>
                    <th className="px-3 py-2 font-medium">{t('table.assignee')}</th>
                    <th className="px-3 py-2 font-medium">{t('table.source')}</th>
                    <th className="px-3 py-2 font-medium w-10" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map(t2 => {
                    const od = OPEN_STATUSES.includes(t2.status ?? '') ? daysOverdue(t2.scheduled_date, today) : 0
                    return (
                      <tr key={t2.trellis_task_id} className="border-t border-border/60 hover:bg-muted/30" data-testid={`row-task-${t2.trellis_task_id}`}>
                        <td className="px-3 py-2 font-medium max-w-56 truncate">
                          <a
                            href={trellisTaskUrl(t2.trellis_task_id, t2.status)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary hover:underline"
                            title={t('table.openInTrellis')}
                            data-testid={`link-task-${t2.trellis_task_id}`}
                          >
                            {t2.property_name ?? '—'}
                          </a>
                        </td>
                        <td className="px-3 py-2 max-w-64 truncate">{t2.title ?? '—'}</td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={t2.status === 'COMPLETED' ? 'success' : od > 0 ? 'destructive' : 'info'}>
                            {t(`status.${slugify(t2.status ?? 'unknown')}`, undefined, (t2.status ?? 'unknown').toLowerCase())}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="tabular-nums">{formatDay(t2.scheduled_date, locale)}</span>
                          {od > 0 && <span className="ml-1.5 text-2xs font-medium text-destructive">{t('table.daysLate', { count: od })}</span>}
                        </td>
                        <td className="px-3 py-2 max-w-44 truncate">{t2.assigned_to_name ?? '—'}</td>
                        <td className="px-3 py-2">
                          <StatusBadge tone="neutral">{t2.workspace === 'A' ? 'Tendwell' : 'Haven'}</StatusBadge>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <a
                            href={trellisTaskUrl(t2.trellis_task_id, t2.status)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex text-muted-foreground hover:text-primary transition-colors"
                            title={t('table.openInTrellis')}
                            aria-label={t('table.openInTrellisAria')}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
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
            {visible.map(t2 => {
              const od = OPEN_STATUSES.includes(t2.status ?? '') ? daysOverdue(t2.scheduled_date, today) : 0
              return (
                <a
                  key={t2.trellis_task_id}
                  href={trellisTaskUrl(t2.trellis_task_id, t2.status)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                  data-testid={`card-task-${t2.trellis_task_id}`}
                >
                  <Card className="border-card-border active:bg-muted/40 transition-colors">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate flex items-center gap-1">
                            {t2.property_name ?? '—'}
                            <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{t2.title ?? '—'} · {t2.assigned_to_name ?? t('table.unassignedFallback')}</p>
                        </div>
                        <StatusBadge tone={t2.status === 'COMPLETED' ? 'success' : od > 0 ? 'destructive' : 'info'}>
                          {t(`status.${slugify(t2.status ?? 'unknown')}`, undefined, (t2.status ?? 'unknown').toLowerCase())}
                        </StatusBadge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5 tabular-nums">
                        {t('table.dueDay', { date: formatDay(t2.scheduled_date, locale) })}
                        {od > 0 && <span className="ml-1.5 font-medium text-destructive">{t('table.daysLate', { count: od })}</span>}
                      </p>
                    </CardContent>
                  </Card>
                </a>
              )
            })}
          </div>
        </>
      )}
    </PageContainer>
  )
}
