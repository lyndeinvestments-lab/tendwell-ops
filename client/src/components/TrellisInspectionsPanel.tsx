import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format as dfFormat, parseISO } from 'date-fns'
import { ClipboardCheck, Star, Sparkles, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { StatusBadge } from '@/components/StatusBadge'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { scoreColorClass } from '@/lib/inspections'
import {
  TRELLIS_INSPECTION_SELECT,
  taskCleanLabel,
  taskDate,
  trellisInspectionQueue,
  type TrellisInspectionTask,
} from '@/lib/trellis-inspections'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import type { TFunc } from '@/lib/i18n/t'

export const TRELLIS_INSPECTIONS_KEY = ['/supabase/trellis-inspection-tasks'] as const
const WINDOW_DAYS = 30

/**
 * Trellis inspection tasks (view `trellis_inspection_tasks`, staff-gated in
 * the DB) from the last 30 days. Shared by the tab badge and the panel.
 */
export function useTrellisInspectionQueue() {
  const today = dfFormat(new Date(), 'yyyy-MM-dd')
  const since = dfFormat(new Date(Date.now() - (WINDOW_DAYS + 1) * 86_400_000), 'yyyy-MM-dd')
  const query = useQuery({
    queryKey: [...TRELLIS_INSPECTIONS_KEY, since],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trellis_inspection_tasks')
        .select(TRELLIS_INSPECTION_SELECT)
        .or(`scheduled_date.gte.${since},completed_at.gte.${since}`)
        .order('scheduled_date', { ascending: false })
        .limit(1000)
      if (error) throw error
      return (data ?? []) as unknown as TrellisInspectionTask[]
    },
    staleTime: 60_000,
  })
  const queue = useMemo(() => trellisInspectionQueue(query.data ?? [], today, WINDOW_DAYS), [query.data, today])
  return { ...query, queue }
}

interface Props {
  canEdit: boolean
  onRate: (task: TrellisInspectionTask) => void
}

export function TrellisInspectionsPanel({ canEdit, onRate }: Props) {
  const { t } = useLocale('inspections')
  const { format } = useDateFormat()
  const { openPropertyModal } = usePropertyModal()
  const { queue, isLoading, isError, refetch } = useTrellisInspectionQueue()
  const [view, setView] = useState<'toRate' | 'rated'>('toRate')
  const rows = view === 'toRate' ? queue.toRate : queue.rated
  const fmt = (d: string | null) => (d ? format(parseISO(d), 'MMM d') : '-')

  return (
    <div className="flex flex-1 flex-col gap-3 min-h-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{t('trellis.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('trellis.subtitle')}</p>
        </div>
        <div className="inline-flex rounded-md border border-border p-0.5 text-xs" role="tablist">
          {(['toRate', 'rated'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'rounded px-2.5 py-1 font-medium transition-colors',
                view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
              data-testid={`trellis-view-${v}`}
            >
              {v === 'toRate' ? t('trellis.toRate', { count: queue.toRate.length }) : t('trellis.rated', { count: queue.rated.length })}
            </button>
          ))}
        </div>
      </div>

      {isError ? (
        <ErrorState title={t('trellis.errorTitle')} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={view === 'toRate' ? CheckCircle2 : ClipboardCheck}
          title={view === 'toRate' ? t('trellis.emptyToRateTitle') : t('trellis.emptyRatedTitle')}
          description={view === 'toRate' ? t('trellis.emptyToRateDesc') : t('trellis.emptyRatedDesc')}
        />
      ) : (
        <ul className="space-y-2 overflow-y-auto">
          {rows.map((task) => (
            <TaskRow
              key={task.trellis_task_id}
              task={task}
              t={t}
              fmt={fmt}
              canEdit={canEdit}
              onRate={onRate}
              onOpenProperty={(id) => openPropertyModal(String(id))}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function TaskRow({
  task,
  t,
  fmt,
  canEdit,
  onRate,
  onOpenProperty,
}: {
  task: TrellisInspectionTask
  t: TFunc
  fmt: (d: string | null) => string
  canEdit: boolean
  onRate: (task: TrellisInspectionTask) => void
  onOpenProperty: (id: number) => void
}) {
  const clean = taskCleanLabel(task)
  const cleanText =
    clean.kind === 'cleaner' ? t('trellis.cleanBy', { date: fmt(clean.date), name: clean.cleanerName ?? '' })
    : clean.kind === 'crew' ? t('trellis.cleanByCrew', { date: fmt(clean.date) })
    : clean.kind === 'not_tendwell' ? t('trellis.cleanNotTendwell', { date: fmt(clean.date) })
    : t('trellis.noClean')
  const rated = !!task.ops_inspection_id
  const status = (task.status ?? '').toLowerCase()

  return (
    <li
      className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
      data-testid={`trellis-task-${task.trellis_task_id}`}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {task.property_id != null ? (
            <button
              type="button"
              onClick={() => onOpenProperty(task.property_id as number)}
              className="truncate text-left text-sm font-medium text-primary hover:underline underline-offset-2"
            >
              {task.property_name ?? task.trellis_property_name}
            </button>
          ) : (
            <span className="truncate text-sm font-medium">{task.trellis_property_name}</span>
          )}
          <StatusBadge status={status} variant="soft">{fmt(taskDate(task))}</StatusBadge>
          <span className="text-2xs text-muted-foreground">
            {task.workspace === 'A' ? t('trellis.workspaceA') : t('trellis.workspaceB')} · {task.title}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5" />
            {t('trellis.previousClean')}: <span className={cn(clean.kind === 'cleaner' && 'text-foreground')}>{cleanText}</span>
          </span>
          {(task.inspector_name || task.assigned_to_name) && (
            <span>{t('trellis.inspector', { name: task.inspector_name ?? task.assigned_to_name ?? '' })}</span>
          )}
        </div>
      </div>
      {rated ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
          <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium tabular-nums', scoreColorClass(task.ops_overall_score))}>
            <Star className="h-3 w-3" />
            {t('trellis.overall', { score: task.ops_overall_score ?? '-' })}
          </span>
          {task.ops_cleanliness_score != null && (
            <span className={cn('rounded px-1.5 py-0.5 font-medium tabular-nums', scoreColorClass(task.ops_cleanliness_score))}>
              {t('trellis.cleanliness', { score: task.ops_cleanliness_score })}
            </span>
          )}
          {task.ops_inspected_at && (
            <span className="text-2xs text-muted-foreground">{t('trellis.ratedOn', { date: fmt(task.ops_inspected_at) })}</span>
          )}
        </div>
      ) : canEdit ? (
        <Button size="sm" className="h-9 shrink-0 gap-1.5 text-xs" onClick={() => onRate(task)} data-testid={`rate-trellis-${task.trellis_task_id}`}>
          <ClipboardCheck className="h-3.5 w-3.5" />
          {t('trellis.rate')}
        </Button>
      ) : null}
    </li>
  )
}
