import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { format, parseISO, differenceInCalendarDays } from 'date-fns'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { StatCard } from '@/components/StatCard'
import { MapPickerDialog } from '@/components/MapPickerDialog'
import { INSPECTION_SELECT, scoreColorClass, type Inspection } from '@/lib/inspections'
import { ClipboardCheck, MapPin, Camera, Star, ChevronRight, CalendarDays, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface Props {
  inspectorId: string
  onOpen: (inspection: Inspection) => void
}

/**
 * Inspector-facing "My Inspections" view: an auto-filtered, mobile-first work
 * queue for the logged-in inspector — overdue first, then today, then
 * upcoming, with their recently completed work below. Tapping a scheduled
 * card opens the form to complete it; tapping the address opens the maps
 * picker for directions.
 */
export function MyInspectionsTab({ inspectorId, onOpen }: Props) {
  const [mapAddress, setMapAddress] = useState<string | null>(null)
  const today = format(new Date(), 'yyyy-MM-dd')

  const { data: rows, isLoading, isError, refetch } = useQuery({
    queryKey: ['/supabase/inspections-all', 'mine', inspectorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspections')
        .select(INSPECTION_SELECT)
        .eq('inspector_id', inspectorId)
        .order('inspected_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as unknown as Inspection[]
    },
  })

  const groups = useMemo(() => {
    const scheduled = (rows ?? []).filter(i => i.status === 'scheduled')
    const byDate = (i: Inspection) => i.scheduled_for ?? i.inspected_at ?? ''
    const overdue = scheduled.filter(i => byDate(i) < today).sort((a, b) => byDate(a).localeCompare(byDate(b)))
    const dueToday = scheduled.filter(i => byDate(i) === today)
    const upcoming = scheduled.filter(i => byDate(i) > today).sort((a, b) => byDate(a).localeCompare(byDate(b)))
    const completed = (rows ?? []).filter(i => i.status === 'completed')
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const completed30d = completed.filter(i => i.inspected_at && parseISO(i.inspected_at) >= thirtyDaysAgo)
    return { overdue, dueToday, upcoming, completed, completed30d }
  }, [rows, today])

  if (isError) return <ErrorState onRetry={() => refetch()} />

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    )
  }

  const queueEmpty = groups.overdue.length === 0 && groups.dueToday.length === 0 && groups.upcoming.length === 0

  return (
    <div className="flex-1 overflow-y-auto space-y-5 pb-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Due Today" value={groups.dueToday.length} icon={CalendarDays} tone="info" />
        <StatCard
          title="Overdue"
          value={groups.overdue.length}
          icon={AlertTriangle}
          tone={groups.overdue.length > 0 ? 'destructive' : 'success'}
        />
        <StatCard title="Upcoming" value={groups.upcoming.length} icon={ClipboardCheck} tone="primary" />
        <StatCard title="Completed (30d)" value={groups.completed30d.length} icon={CheckCircle2} tone="success" />
      </div>

      {queueEmpty ? (
        <EmptyState
          icon={ClipboardCheck}
          title="You're all caught up"
          description="No inspections are assigned to you right now. New assignments will show up here."
        />
      ) : (
        <>
          {groups.overdue.length > 0 && (
            <QueueSection title="Overdue" tone="destructive">
              {groups.overdue.map(i => (
                <QueueCard key={i.id} inspection={i} today={today} overdue onOpen={onOpen} onMap={setMapAddress} />
              ))}
            </QueueSection>
          )}
          {groups.dueToday.length > 0 && (
            <QueueSection title="Today" tone="info">
              {groups.dueToday.map(i => (
                <QueueCard key={i.id} inspection={i} today={today} onOpen={onOpen} onMap={setMapAddress} />
              ))}
            </QueueSection>
          )}
          {groups.upcoming.length > 0 && (
            <QueueSection title="Upcoming" tone="muted">
              {groups.upcoming.map(i => (
                <QueueCard key={i.id} inspection={i} today={today} onOpen={onOpen} onMap={setMapAddress} />
              ))}
            </QueueSection>
          )}
        </>
      )}

      {/* Recently completed */}
      {groups.completed.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recently completed</h3>
          <div className="space-y-2">
            {groups.completed.slice(0, 10).map(i => (
              <button
                key={i.id}
                onClick={() => onOpen(i)}
                className="w-full text-left rounded-2xl border border-card-border bg-card shadow-sm p-3 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">
                      {i.properties?.name ?? <span className="text-muted-foreground">Deleted property</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {i.inspected_at ? format(parseISO(i.inspected_at), 'MMM d, yyyy') : '—'}
                      {(i.photos_url?.length ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-0.5 ml-2">
                          <Camera className="w-3 h-3" />{i.photos_url!.length}
                        </span>
                      )}
                    </div>
                  </div>
                  {i.overall_score != null && (
                    <span className={`shrink-0 inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded font-semibold tabular-nums ${scoreColorClass(i.overall_score)}`}>
                      <Star className="w-3 h-3 fill-current" /> {i.overall_score}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <MapPickerDialog
        open={!!mapAddress}
        onOpenChange={v => !v && setMapAddress(null)}
        address={mapAddress ?? ''}
      />
    </div>
  )
}

function QueueSection({ title, tone, children }: { title: string; tone: 'destructive' | 'info' | 'muted'; children: React.ReactNode }) {
  const toneCls = tone === 'destructive' ? 'text-destructive' : tone === 'info' ? 'text-info' : 'text-muted-foreground'
  return (
    <div className="space-y-2">
      <h3 className={`text-xs font-semibold uppercase tracking-wide ${toneCls}`}>{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function QueueCard({
  inspection: i,
  today,
  overdue,
  onOpen,
  onMap,
}: {
  inspection: Inspection
  today: string
  overdue?: boolean
  onOpen: (inspection: Inspection) => void
  onMap: (address: string) => void
}) {
  const dateStr = i.scheduled_for ?? i.inspected_at
  const daysOverdue = overdue && dateStr ? differenceInCalendarDays(parseISO(today), parseISO(dateStr)) : 0
  const address = i.properties?.address ?? null
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(i)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(i) } }}
      className={`w-full text-left rounded-2xl border shadow-sm p-4 cursor-pointer transition-colors hover:bg-muted/20 ${
        overdue ? 'border-destructive/30 bg-destructive/5' : 'border-card-border bg-card'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-semibold text-base truncate">
            {i.properties?.name ?? <span className="text-muted-foreground">Deleted property</span>}
          </div>
          {address && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onMap(address) }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground group max-w-full"
            >
              <MapPin className="w-3.5 h-3.5 shrink-0 text-primary group-hover:text-foreground" />
              <span className="truncate underline-offset-2 group-hover:underline">{address}</span>
            </button>
          )}
          <div className="text-xs text-muted-foreground">
            {dateStr ? format(parseISO(dateStr), 'EEE, MMM d') : 'No date'}
            {daysOverdue > 0 && (
              <span className="ml-2 text-destructive font-medium">
                {daysOverdue} day{daysOverdue === 1 ? '' : 's'} overdue
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1.5 text-primary text-sm font-medium mt-1">
          <span className="hidden sm:inline">Start</span>
          <ChevronRight className="w-4 h-4" />
        </div>
      </div>
    </div>
  )
}
