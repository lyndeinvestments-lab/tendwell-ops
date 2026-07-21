import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, STAGE_COLORS, STAGE_ORDER, logPropertyEdit, logActivity } from '@/lib/supabase'
import { profitTier, PROFIT_TIER_LABELS } from '@/lib/profit-colors'
import { useAuth, canAccessView } from '@/lib/auth'
import { invalidateAllPropertyQueries } from '@/lib/query-invalidations'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { usePipelineStages } from '@/hooks/use-pipeline-stages'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  pointerWithin,
} from '@dnd-kit/core'
import type { CollisionDetection } from '@dnd-kit/core'
import { useDroppable } from '@dnd-kit/core'
import { useDraggable } from '@dnd-kit/core'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { StageTransitionModal } from '@/components/StageTransitionModal'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChevronDown, ChevronRight, Eye, EyeOff, Minimize2, ArrowUp, CalendarDays, Search, Plus, X, GripVertical, AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import { slugify } from '@/lib/issues'

// Kanban-optimised collision: pointer-within first, fall back to closestCenter.
// closestCenter alone misfires on horizontal boards when card centers don't
// line up with column centers (e.g. tall columns, compact view).
const kanbanCollision: CollisionDetection = (args) => {
  const within = pointerWithin(args)
  if (within.length > 0) return within
  return closestCenter(args)
}

// Fields that should be present before moving to a given stage.
// Merged with any `requires_fields` value stored on the pipeline_stages row.
const STAGE_REQUIRED_FIELDS: Record<string, string[]> = {
  Quote:       ['ce_charged', 'total_estimated_cost'],
  Onboarding:  ['contact_id', 'ce_charged', 'total_estimated_cost'],
  Active:      ['contact_id', 'first_clean_date', 'ce_charged', 'total_estimated_cost'],
  Offboarding: ['contact_id'],
}

const FOLLOW_UP_STAGES = new Set(['Lead', 'Quote', 'Onboarding'])

// ── Profit badge ──────────────────────────────────────────────────────────────
function ProfitBadge({ pct, stageName }: { pct: number | null | undefined; stageName: string }) {
  const { t } = useLocale('pipeline')
  const isOnboarding = stageName === 'Onboarding'
  if (pct == null) {
    if (isOnboarding) {
      return <StatusBadge tone="neutral">{t('card.noData')}</StatusBadge>
    }
    return null
  }
  const tierValue = profitTier(pct)
  const tierLabel = tierValue === 'high' ? t('card.profitTier.high') : tierValue === 'mid' ? t('card.profitTier.mid') : t('card.profitTier.low')
  const tone = tierValue === 'high' ? 'success' : tierValue === 'mid' ? 'warning' : 'destructive'
  return (
    <StatusBadge tone={tone} className="tabular-nums">
      {pct.toFixed(0)}%<span className="sr-only"> ({tierLabel})</span>
    </StatusBadge>
  )
}

// ── Stage history tooltip ──────────────────────────────────────────────────────
function StageHistoryTooltip({ transitions, children }: { transitions: any[]; children: React.ReactNode }) {
  const { t } = useLocale('pipeline')
  const { format: formatDate } = useDateFormat()
  if (!transitions || transitions.length === 0) return <>{children}</>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="cursor-help">{children}</div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs p-2 space-y-1">
        <p className="text-xs font-medium mb-1">{t('card.stageHistory')}</p>
        {transitions.map((tr: any, i: number) => (
          <div key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span>{tr.pipeline_stages?.name ? t(`common.stage.${slugify(tr.pipeline_stages.name)}`, undefined, tr.pipeline_stages.name) : '—'}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>{formatDate(new Date(tr.created_at), 'MMM d, yyyy')}</span>
          </div>
        ))}
      </TooltipContent>
    </Tooltip>
  )
}

// ── Droppable column ──────────────────────────────────────────────────────────
function StageColumn({ stage, properties, onNameClick, compact, collapsed, onToggleCollapse, onFollowUpChange, onboardingProgress }: {
  stage: any
  properties: any[]
  onNameClick: (p: any) => void
  compact: boolean
  collapsed: boolean
  onToggleCollapse: () => void
  onFollowUpChange: (propId: string, date: string) => void
  transitionsByProperty?: Record<string, any[]>
  onboardingProgress?: Record<string, { completed: number; total: number }>
}) {
  const { t } = useLocale('pipeline')
  const { isOver, setNodeRef } = useDroppable({ id: stage.id })
  const color = STAGE_COLORS[stage.name] || '#6b7280'
  const displayProps = collapsed ? [] : properties
  const stageLabel = t(`common.stage.${slugify(stage.name)}`, undefined, stage.name)

  return (
    <div
      id={`col-${stage.name}`}
      className={`flex flex-col h-full ${collapsed ? 'min-w-[140px] max-w-[140px]' : 'min-w-[220px] max-w-[240px]'}`}
    >
      {/* Redesign: tinted stage-color header chip + count pill */}
      <div
        className="flex items-center gap-1.5 mb-2 px-2 py-1.5 rounded-xl flex-shrink-0 border border-border/40"
        style={{ backgroundColor: `${color}14` }}
      >
        <button
          onClick={onToggleCollapse}
          className="p-0.5 rounded-md hover:bg-background/60 transition-colors"
          data-testid={`toggle-collapse-${stage.name}`}
          aria-label={collapsed ? t('board.expandColumn', { stage: stageLabel }) : t('board.collapseColumn', { stage: stageLabel })}
        >
          {collapsed ? <ChevronRight className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
        </button>
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-background" style={{ backgroundColor: color }} />
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground/80 truncate">{stageLabel}</span>
        <span className="ml-auto text-2xs font-semibold tabular-nums bg-background/70 text-foreground rounded-full px-1.5 py-0.5 flex-shrink-0">{properties.length}</span>
      </div>
      <div
        ref={setNodeRef}
        data-testid={`column-${stage.name}`}
        className={`flex-1 rounded-2xl p-2 space-y-2 transition-colors ${isOver ? 'bg-primary/10 ring-2 ring-primary/40' : 'bg-muted/40'}`}
      >
        {collapsed ? (
          <div className="flex items-center justify-center py-4 h-full">
            <span className="text-xs text-muted-foreground" style={{ writingMode: 'vertical-lr', textOrientation: 'mixed' }}>
              {t('board.propertiesCount', { count: properties.length })}
            </span>
          </div>
        ) : (
          displayProps.map(p => (
            <DraggableCard
              key={p.id}
              property={p}
              stageName={stage.name}
              stageColor={color}
              onNameClick={() => onNameClick(p)}
              compact={compact}
              onFollowUpChange={(date) => onFollowUpChange(p.id, date)}
              onboardingProgress={stage.name === 'Onboarding' ? onboardingProgress?.[p.id] : undefined}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Draggable card ─────────────────────────────────────────────────────────────
function DraggableCard({ property, stageName, stageColor, onNameClick, compact, onFollowUpChange, onboardingProgress }: {
  property: any; stageName: string; stageColor: string; onNameClick: () => void; compact: boolean
  onFollowUpChange: (date: string) => void
  onboardingProgress?: { completed: number; total: number }
}) {
  const { t } = useLocale('pipeline')
  const { format: formatDate } = useDateFormat()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: property.id })
  const showFollowUp = FOLLOW_UP_STAGES.has(stageName)
  const transitions: any[] = property._transitions ?? []
  const stageLabel = t(`common.stage.${slugify(stageName)}`, undefined, stageName)

  const isStale = useMemo(() => {
    if (stageName !== 'Lead' && stageName !== 'Quote') return false
    if (property.follow_up_date) return false
    if (transitions.length === 0) return false
    const latestTransitionDate = new Date(transitions[0].created_at)
    const daysSince = (Date.now() - latestTransitionDate.getTime()) / (1000 * 60 * 60 * 24)
    return daysSince >= 14
  }, [stageName, property.follow_up_date, transitions])

  // Date the property entered its current stage (Quote / Onboarding only).
  // transitions are newest-first and carry the to-stage name, so the first
  // match is the most recent move into this stage. When no such transition was
  // logged (e.g. the property was created directly in this stage — true for all
  // current Quote properties), fall back to the property's creation date, which
  // is when it entered the stage.
  const enteredStageDate = useMemo(() => {
    if (stageName !== 'Quote' && stageName !== 'Onboarding') return null
    const match = transitions.find((t: any) => t?.pipeline_stages?.name === stageName)
    return match?.created_at ?? property.created_at ?? null
  }, [stageName, transitions, property.created_at])

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    e.stopPropagation()
    onFollowUpChange(e.target.value)
  }

  function handleDateClick(e: React.MouseEvent) { e.stopPropagation() }

  // Name click (stop drag-start propagation)
  function handleNameClick(e: React.MouseEvent) {
    e.stopPropagation()
    onNameClick()
  }

  if (compact) {
    return (
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        data-testid={`card-property-${property.id}`}
        data-property-id={property.id}
        onClick={handleNameClick}
        className={`bg-card border border-card-border rounded-lg px-2.5 py-1.5 shadow-sm cursor-grab active:cursor-grabbing select-none transition-all hover:shadow hover:border-primary/40 ${isDragging ? 'opacity-30' : 'opacity-100'}`}
      >
        <div className="flex items-center justify-between gap-1">
          <button
            onClick={handleNameClick}
            className="text-xs font-medium text-foreground truncate hover:underline text-left"
          >
            {property.name}
          </button>
          <div className="flex items-center gap-1 flex-shrink-0">
            {isStale && (
              <StatusBadge tone="warning">{t('card.stale')}</StatusBadge>
            )}
          </div>
        </div>
        {enteredStageDate && (
          <p className="text-2xs text-muted-foreground/70 mt-0.5">
            {t('card.inStageSince', { stage: stageLabel, date: formatDate(new Date(enteredStageDate), 'MMM d, yyyy') })}
          </p>
        )}
        {showFollowUp && (
          <div className="flex items-center gap-1 mt-0.5" onClick={handleDateClick}>
            <CalendarDays className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground/70 shrink-0">{t('card.followUp')}</span>
            <input
              type="date"
              value={property.follow_up_date || ''}
              onChange={handleDateChange}
              min={new Date().toISOString().split('T')[0]}
              className="text-xs text-muted-foreground bg-transparent border-none outline-none cursor-pointer w-full"
              aria-label={t('card.followUpAria', { name: property.name })}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-testid={`card-property-${property.id}`}
      data-property-id={property.id}
      onClick={handleNameClick}
      style={{ borderLeftColor: stageColor, borderLeftWidth: 3 }}
      className={`relative group bg-card border border-card-border rounded-xl p-3 pl-3.5 shadow-sm cursor-grab active:cursor-grabbing select-none transition-all hover:shadow-md hover:-translate-y-px hover:border-primary/40 ${isDragging ? 'opacity-30' : 'opacity-100'}`}
    >
      <GripVertical className="w-3 h-3 text-muted-foreground/40 absolute top-2.5 right-1.5 group-hover:text-muted-foreground transition-opacity" />
      <span className="text-xs font-semibold text-foreground leading-snug hover:underline text-left w-full block">
        {property.name}
      </span>
      {property.contacts?.full_name && (
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="text-xs text-primary/80 mt-0.5 truncate cursor-help">{property.contacts.full_name}</p>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs p-2 space-y-1">
            <p className="text-xs font-medium">{property.contacts.full_name}</p>
            {property.contacts.phone && <p className="text-xs text-muted-foreground">{property.contacts.phone}</p>}
            {property.contacts.email && <p className="text-xs text-muted-foreground">{property.contacts.email}</p>}
            {property.contacts.payment_method && <p className="text-xs text-muted-foreground">{t('card.payment', { method: property.contacts.payment_method })}</p>}
            {property.contacts.client_since && <p className="text-xs text-muted-foreground">{t('card.clientSince', { date: property.contacts.client_since })}</p>}
          </TooltipContent>
        </Tooltip>
      )}
      {/* Stage note — first line of notes field */}
      {property.notes && (
        <p className="text-xs text-muted-foreground/80 mt-1 truncate italic" title={property.notes.split('\n')[0]}>
          {property.notes.split('\n')[0].slice(0, 60)}{property.notes.split('\n')[0].length > 60 ? '…' : ''}
        </p>
      )}
      {enteredStageDate && (
        <p className="text-2xs text-muted-foreground/70 mt-1">
          {t('card.inStageSince', { stage: stageLabel, date: formatDate(new Date(enteredStageDate), 'MMM d, yyyy') })}
        </p>
      )}
      <div className="flex items-center justify-end mt-2 gap-1">
        <div className="flex items-center gap-1 flex-shrink-0">
          {isStale && (
            <span className="text-xs px-1 py-0.5 rounded bg-warning/15 text-warning font-medium">
              {t('card.stale')}
            </span>
          )}
        </div>
      </div>
      {showFollowUp && (
        <StageHistoryTooltip transitions={transitions}>
          <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-border/40" onClick={handleDateClick}>
            <CalendarDays className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground/70 shrink-0">{t('card.followUp')}</span>
            <input
              type="date"
              value={property.follow_up_date || ''}
              onChange={handleDateChange}
              min={new Date().toISOString().split('T')[0]}
              className="text-xs text-muted-foreground bg-transparent border-none outline-none cursor-pointer w-full"
              placeholder={t('card.addFollowUp')}
              aria-label={t('card.followUpAria', { name: property.name })}
            />
          </div>
        </StageHistoryTooltip>
      )}
      {(stageName === 'Active' || stageName === 'Onboarding') && property.cleaner_pay && (
        <span className="text-xs text-muted-foreground mt-1 block">{t('card.cleanerPay', { amount: `$${Number(property.cleaner_pay).toFixed(0)}` })}</span>
      )}
      {stageName === 'Onboarding' && (
        <div className="mt-1.5 pt-1.5 border-t border-border/40">
          {onboardingProgress && onboardingProgress.total > 0 ? (
            <>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    onboardingProgress.completed === onboardingProgress.total ? 'bg-green-500' :
                    onboardingProgress.completed / onboardingProgress.total >= 0.5 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${(onboardingProgress.completed / onboardingProgress.total) * 100}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground mt-0.5 block">{t('card.onboardingTasks', { completed: onboardingProgress.completed, total: onboardingProgress.total })}</span>
            </>
          ) : (
            <button onClick={handleNameClick} className="text-xs text-primary hover:underline">{t('card.setupChecklist')}</button>
          )}
        </div>
      )}
    </div>
  )
}

function PropertyCardOverlay({ property }: { property: any }) {
  return (
    <div className="bg-card border border-primary/40 rounded-xl p-3 shadow-xl w-[220px] cursor-grabbing rotate-2">
      <p className="text-xs font-semibold text-foreground">{property.name}</p>
      {property.contacts?.full_name && <p className="text-xs text-muted-foreground mt-0.5">{property.contacts.full_name}</p>}
    </div>
  )
}

export default function PipelinePage() {
  const { t } = useLocale('pipeline')
  const { toast } = useToast()
  const qc = useQueryClient()
  const { openPropertyModal } = usePropertyModal()
  const { user, effectiveUser } = useAuth()
  const canViewFinancials = canAccessView('cost-tracking', effectiveUser) || canAccessView('financial-dashboard', effectiveUser)
  usePageTitle('Pipeline')
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)

  const [activeProperty, setActiveProperty] = useState<any>(null)
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem('tendwell-pipeline-compact') === 'true' } catch { return false }
  })
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set())
  const [hideEmpty, setHideEmpty] = useState(() => {
    try { return localStorage.getItem('tendwell-pipeline-hide-empty') === 'true' } catch { return false }
  })
  const [transition, setTransition] = useState<{
    property: any; fromStageId: string; toStageId: string; toStageName: string; missing: string[]
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [localProperties, setLocalProperties] = useState<any[] | null>(null)
  const [search, setSearch] = useState('')
  const [addLeadOpen, setAddLeadOpen] = useState(false)
  const [newLeadName, setNewLeadName] = useState('')
  const [newLeadAddress, setNewLeadAddress] = useState('')
  const [newLeadEmail, setNewLeadEmail] = useState('')
  const [newLeadPhone, setNewLeadPhone] = useState('')
  const [newLeadBedrooms, setNewLeadBedrooms] = useState('')
  const [newLeadSource, setNewLeadSource] = useState('')
  const [newLeadNotes, setNewLeadNotes] = useState('')
  const [mobileStage, setMobileStage] = useState<string | null>(null)

  const { data: stages, isLoading: stagesLoading } = usePipelineStages()

  const { data: properties, isLoading: propsLoading, error: propsError } = useQuery({
    queryKey: ['/supabase/pipeline'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, stage_id, created_at, ce_charged, total_estimated_cost, cleaner_pay, profit_percentage, follow_up_date, first_clean_date, notes, contact_id, address, bedrooms, number_of_beds, full_baths, half_baths, kitchens, square_footage, guest_count, auto_code, door_code, wifi_info, contacts(full_name, phone, email, payment_method, client_since), pipeline_stages!properties_stage_id_fkey(name, color, requires_fields)')
        .is('archived_at', null)
        .is('deleted_at', null)
      if (error) {
        if (error.message?.includes('follow_up_date') || error.message?.includes('contact')) {
          const { data: fallback, error: fallbackError } = await supabase
            .from('properties')
            .select('id, name, stage_id, created_at, ce_charged, total_estimated_cost, cleaner_pay, profit_percentage, first_clean_date, notes, address, bedrooms, number_of_beds, full_baths, half_baths, kitchens, square_footage, guest_count, auto_code, door_code, wifi_info, pipeline_stages!properties_stage_id_fkey(name, color, requires_fields)')
            .is('archived_at', null)
            .is('deleted_at', null)
          if (fallbackError) throw fallbackError
          return (fallback || []).map((p: any) => ({ ...p, follow_up_date: null, contacts: null }))
        }
        throw error
      }
      return data || []
    },
  })

  // ── Stage history (single bulk query) ─────────────────────────────────────
  const pipelineIds = useMemo(() => (properties ?? []).map((p: any) => p.id), [properties])

  const { data: allTransitions } = useQuery({
    queryKey: ['/supabase/stage_transitions_bulk', pipelineIds.slice().sort().join(',')],
    enabled: pipelineIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('stage_transitions')
        .select('property_id, created_at, pipeline_stages!stage_transitions_to_stage_id_fkey(name)')
        .in('property_id', pipelineIds)
        .order('created_at', { ascending: false })
      return data ?? []
    },
    staleTime: 60_000,
  })

  const transitionsByProperty = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const t of (allTransitions ?? [])) {
      if (t.property_id == null) continue
      const key = String(t.property_id)
      if (!map[key]) map[key] = []
      if (map[key].length < 3) map[key].push(t)
    }
    return map
  }, [allTransitions])

  // Onboarding tasks progress
  const onboardingPropertyIds = useMemo(() => {
    if (!properties || !stages) return []
    const onboardingStageId = stages.find((s: any) => s.name === 'Onboarding')?.id
    return properties.filter((p: any) => p.stage_id === onboardingStageId).map((p: any) => p.id)
  }, [properties, stages])

  const { data: onboardingTasksData } = useQuery({
    queryKey: ['/supabase/onboarding-tasks-pipeline', onboardingPropertyIds.join(',')],
    enabled: onboardingPropertyIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('onboarding_tasks')
        .select('property_id, is_complete')
        .in('property_id', onboardingPropertyIds)
      return data ?? []
    },
    staleTime: 30_000,
  })

  const onboardingProgress = useMemo(() => {
    const map: Record<string, { completed: number; total: number }> = {}
    for (const t of (onboardingTasksData ?? [])) {
      if (!map[t.property_id]) map[t.property_id] = { completed: 0, total: 0 }
      map[t.property_id].total++
      if (t.is_complete) map[t.property_id].completed++
    }
    return map
  }, [onboardingTasksData])

  // Sync localProperties from server when not dragging
  useEffect(() => {
    if (!isDragging) setLocalProperties(properties ?? null)
  }, [properties, isDragging])

  const displayProperties = useMemo(() => {
    const base = localProperties ?? properties
    if (!base || !search.trim()) return base
    const q = search.trim().toLowerCase()
    return base.filter((p: any) =>
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.contacts?.full_name && p.contacts.full_name.toLowerCase().includes(q))
    )
  }, [localProperties, properties, search])

  const { mutate: moveProperty, isPending: isMoving } = useGuardedMutation('pipeline', {
    mutationFn: async ({ propId, stageId, fromStageId }: { propId: string; stageId: string; fromStageId: string }) => {
      const fromStage = stages?.find((s: any) => s.id === fromStageId)
      const toStage = stages?.find((s: any) => s.id === stageId)
      const prop = displayProperties?.find((p: any) => p.id === propId)
      const { executeStageTransition } = await import('@/lib/stage-transition')
      const result = await executeStageTransition({
        propertyId: Number(propId),
        propertyName: prop?.name || '',
        fromStageId: Number(fromStageId),
        fromStageName: fromStage?.name || '',
        toStageId: Number(stageId),
        toStageName: toStage?.name || '',
        changedBy: user?.label || '',
      })
      if (!result.ok) throw new Error(result.error)
    },
    onSuccess: (_data, variables) => {
      const toStage = stages?.find((s: any) => s.id === variables.stageId)
      // Stage transitions touch every property-derived cache (pipeline,
      // master list, all dashboard aggregates, pro-forma, revenue,
      // previous-properties when moving to Offboarded). Registry walks
      // all of them, including dashboard-velocity which was previously
      // missed — so the velocity widget now updates the moment a card
      // is dragged instead of waiting for its 5 min stale window.
      invalidateAllPropertyQueries(qc)
      // Non-property caches that also reflect the transition:
      qc.invalidateQueries({ queryKey: ['/supabase/stage_transitions_recent'] })
      qc.invalidateQueries({ queryKey: ['/supabase/transitions-period'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })

      if (toStage?.name === 'Onboarding') {
        const prop = displayProperties?.find((p: any) => p.id === variables.propId)
        if (prop && !prop.follow_up_date) {
          const sevenDaysFromNow = new Date()
          sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7)
          updateFollowUpDate({ propId: variables.propId, date: sevenDaysFromNow.toISOString().split('T')[0] })
        }
      }
      setTransition(null)
    },
    onError: (error: any) => {
      setLocalProperties(properties ?? null)
      toast({ title: t('toasts.moveFailed'), description: error?.message, variant: 'destructive' })
    },
  })

  const { mutate: updateFollowUpDate } = useGuardedMutation('pipeline', {
    mutationFn: async ({ propId, date }: { propId: string; date: string }) => {
      const { error } = await supabase.from('properties').update({ follow_up_date: date || null }).eq('id', Number(propId))
      if (error) throw error
    },
    onSuccess: () => {
      // follow_up_date drives the dashboard "Follow-Ups Due Today" widget
      // (queryKey /supabase/dashboard-followups). Without the registry
      // invalidation, changing a date here didn't surface on the
      // dashboard until the 60s default expired — silent staleness on
      // a high-visibility widget. Registry covers dashboard-followups,
      // master-list, pro-forma, etc.
      invalidateAllPropertyQueries(qc)
    },
    onError: (error: any) => toast({ title: t('toasts.followUpFailed'), description: error?.message, variant: 'destructive' }),
  })

  const leadStage = stages?.find((s: any) => s.name === 'Lead')

  function resetAddLeadForm() {
    setNewLeadName('')
    setNewLeadAddress('')
    setNewLeadEmail('')
    setNewLeadPhone('')
    setNewLeadBedrooms('')
    setNewLeadSource('')
    setNewLeadNotes('')
  }

  const { mutate: addLead, isPending: addLeadPending } = useGuardedMutation('pipeline', {
    mutationFn: async () => {
      if (!leadStage) throw new Error('No Lead stage found')
      // Build the notes field by combining contact info + free-form notes
      const contactLines: string[] = []
      if (newLeadEmail.trim()) contactLines.push(`Email: ${newLeadEmail.trim()}`)
      if (newLeadPhone.trim()) contactLines.push(`Phone: ${newLeadPhone.trim()}`)
      if (newLeadSource.trim()) contactLines.push(`Source: ${newLeadSource.trim()}`)
      if (newLeadNotes.trim()) contactLines.push(newLeadNotes.trim())
      const combinedNotes = contactLines.join('\n') || null

      const { error } = await supabase.from('properties').insert({
        name: newLeadName.trim(),
        stage_id: leadStage.id,
        address: newLeadAddress.trim() || null,
        bedrooms: newLeadBedrooms ? Number(newLeadBedrooms) : null,
        notes: combinedNotes,
      })
      if (error) throw error
    },
    onSuccess: () => {
      logActivity({
        entity_type: 'pipeline',
        entity_name: newLeadName.trim() || null,
        action: 'create',
        new_value: 'Lead',
        changed_by: user?.label ?? null,
        metadata: { address: newLeadAddress.trim() || null },
      })
      // New lead insert grows every property-derived count and list.
      // Without the registry walk, the dashboard "Active properties" and
      // unassigned counts both stayed stale until window-focus refetch.
      invalidateAllPropertyQueries(qc)
      toast({ title: t('toasts.leadAdded') })
      setAddLeadOpen(false)
      resetAddLeadForm()
    },
    onError: (e: any) => toast({ title: t('toasts.addLeadErrorPrefix') + (e.message || t('toasts.addLeadErrorFallback')), variant: 'destructive' }),
  })

  function handleFollowUpChange(propId: string, date: string) {
    setLocalProperties(prev => prev
      ? prev.map(p => p.id === propId ? { ...p, follow_up_date: date } : p)
      : prev
    )
    updateFollowUpDate({ propId, date })
  }

  function toggleCollapse(stageId: string) {
    setCollapsedStages(prev => {
      const n = new Set(prev)
      n.has(stageId) ? n.delete(stageId) : n.add(stageId)
      return n
    })
  }

  // Terminal stages (Offboarding / Offboarded) always render even when empty —
  // otherwise a clean board with hideEmpty on has no drop target for moves out
  // of Active. Other stages still respect the toggle.
  const ALWAYS_VISIBLE_STAGES = new Set(['Offboarding', 'Offboarded'])
  const visibleStages = useMemo(() => {
    if (!stages || !displayProperties) return []
    return stages.filter((s: any) => {
      if (!hideEmpty) return true
      if (ALWAYS_VISIBLE_STAGES.has(s.name)) return true
      return displayProperties.filter((p: any) => String(p.stage_id) === String(s.id)).length > 0
    })
  }, [stages, displayProperties, hideEmpty])

  function handleDragStart(e: DragStartEvent) {
    const prop = displayProperties?.find((p: any) => p.id === e.active.id)
    setActiveProperty(prop || null)
    setIsDragging(true)
  }

  function handleDragEnd(e: DragEndEvent) {
    setIsDragging(false)
    setActiveProperty(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const prop = displayProperties?.find((p: any) => p.id === active.id)
    if (!prop) return
    const fromStageId = prop.stage_id
    let toStageId = over.id as string

    // over.id is expected to be a stage column ID, but defensively handle the
    // rare case where the pointer exits all droppables and dnd-kit returns a
    // draggable card's ID instead.
    let toStage = stages?.find((s: any) => String(s.id) === String(toStageId))
    if (!toStage) {
      const overProp = displayProperties?.find((p: any) => String(p.id) === String(toStageId))
      if (overProp) {
        toStageId = overProp.stage_id
        toStage = stages?.find((s: any) => String(s.id) === String(toStageId))
      }
      if (!toStage) return
    }

    if (String(fromStageId) === String(toStageId)) return

    const dbReqFields: string[] = Array.isArray(toStage.requires_fields) ? toStage.requires_fields : []
    const codeReqFields: string[] = STAGE_REQUIRED_FIELDS[toStage.name] ?? []
    const reqFields = Array.from(new Set([...dbReqFields, ...codeReqFields]))
    const missing = reqFields.filter((f: string) => {
      const val = prop[f]
      return val === null || val === undefined || val === ''
    })

    setLocalProperties(prev => prev
      ? prev.map(p => p.id === prop.id ? { ...p, stage_id: toStageId } : p)
      : prev
    )

    if (missing.length > 0) {
      setTransition({ property: prop, fromStageId, toStageId, toStageName: toStage.name, missing })
    } else {
      moveProperty({ propId: prop.id, stageId: toStageId, fromStageId })
    }
  }

  function confirmTransition() {
    if (!transition) return
    moveProperty({ propId: transition.property.id, stageId: transition.toStageId, fromStageId: transition.fromStageId })
  }

  function cancelTransition() {
    if (!transition) return
    setLocalProperties(prev => prev
      ? prev.map(p => p.id === transition.property.id ? { ...p, stage_id: transition.fromStageId } : p)
      : prev
    )
    setTransition(null)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handleScroll = () => setShowScrollTop(el.scrollTop > 200)
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  const isLoading = stagesLoading || propsLoading

  return (
    <div className="p-5 h-full flex flex-col">
      <PageHeader
        title={t('page.title')}
        subtitle={
          <span>
            {t('page.subtitle')}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ml-1.5 text-xs text-muted-foreground/60 cursor-help underline decoration-dotted">{t('page.profitLegend')}</span>
              </TooltipTrigger>
              <TooltipContent className="text-xs space-y-1">
                <p><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5" />{PROFIT_TIER_LABELS.high}</p>
                <p><span className="inline-block w-2 h-2 rounded-full bg-yellow-500 mr-1.5" />{PROFIT_TIER_LABELS.mid}</p>
                <p><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5" />{PROFIT_TIER_LABELS.low}</p>
              </TooltipContent>
            </Tooltip>
          </span>
        }
        actions={<div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 sm:flex-none sm:w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder={t('page.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-8 h-8 text-sm w-full"
              data-testid="input-search-pipeline"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={t('page.clearSearch')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={() => setAddLeadOpen(true)} data-testid="button-add-lead">
            <Plus className="w-3.5 h-3.5 mr-1" /> {t('page.addLead')}
          </Button>
          <div className="flex items-center gap-2">
            <Switch id="compact-mode" checked={compact} onCheckedChange={v => { setCompact(v); try { localStorage.setItem('tendwell-pipeline-compact', String(v)) } catch {} }} data-testid="switch-compact" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Label htmlFor="compact-mode" className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
                  <Minimize2 className="w-3 h-3" /> {t('page.compact')}
                </Label>
              </TooltipTrigger>
              <TooltipContent>{t('page.compactTooltip')}</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="hide-empty" checked={hideEmpty} onCheckedChange={v => { setHideEmpty(v); try { localStorage.setItem('tendwell-pipeline-hide-empty', String(v)) } catch {} }} data-testid="switch-hide-empty" />
            <Label htmlFor="hide-empty" className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
              {hideEmpty ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />} {t('page.hideEmpty')}
            </Label>
          </div>
        </div>}
        className="mb-3 flex-shrink-0"
      />

      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-2 flex-1">
          {STAGE_ORDER.map(name => (
            <div key={name} className="min-w-[220px]">
              <Skeleton className="h-5 w-24 mb-2" />
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            </div>
          ))}
        </div>
      ) : propsError ? (
        <div className="flex-1 flex items-center justify-center">
          <ErrorState onRetry={() => {}} />
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-auto relative">
          {/* Mobile stage selector */}
          <div className="md:hidden mb-3 px-1">
            <select
              value={mobileStage || visibleStages[0]?.id || ''}
              onChange={e => setMobileStage(e.target.value)}
              className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background"
            >
              {visibleStages.map((stage: any) => {
                const count = displayProperties?.filter((p: any) => String(p.stage_id) === String(stage.id)).length ?? 0
                const stageLabel = t(`common.stage.${slugify(stage.name)}`, undefined, stage.name)
                return <option key={stage.id} value={stage.id}>{t('board.mobileStageOption', { stage: stageLabel, count })}</option>
              })}
            </select>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={kanbanCollision}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {/* Desktop: horizontal columns */}
            <div className="hidden md:flex gap-3 pb-4 items-stretch min-h-full">
              {visibleStages.map((stage: any) => {
                const stageProps = (displayProperties?.filter((p: any) => String(p.stage_id) === String(stage.id)) || [])
                  .map((p: any) => ({ ...p, _transitions: transitionsByProperty[p.id] ?? [] }))
                return (
                  <StageColumn
                    key={stage.id}
                    stage={stage}
                    properties={stageProps}
                    onNameClick={(p) => openPropertyModal(p.id, 'pipeline')}
                    compact={compact}
                    collapsed={collapsedStages.has(String(stage.id))}
                    onToggleCollapse={() => toggleCollapse(String(stage.id))}
                    onFollowUpChange={handleFollowUpChange}
                    onboardingProgress={onboardingProgress}
                  />
                )
              })}
            </div>
            {/* Mobile: single stage vertical list */}
            <div className="md:hidden pb-4">
              {visibleStages
                .filter((stage: any) => !mobileStage || stage.id === mobileStage || (!mobileStage && stage.id === visibleStages[0]?.id))
                .slice(0, 1)
                .map((stage: any) => {
                  const stageProps = (displayProperties?.filter((p: any) => String(p.stage_id) === String(stage.id)) || [])
                    .map((p: any) => ({ ...p, _transitions: transitionsByProperty[p.id] ?? [] }))
                  return (
                    <StageColumn
                      key={stage.id}
                      stage={stage}
                      properties={stageProps}
                      onNameClick={(p) => openPropertyModal(p.id, 'pipeline')}
                      compact={compact}
                      collapsed={false}
                      onToggleCollapse={() => {}}
                      onFollowUpChange={handleFollowUpChange}
                      onboardingProgress={onboardingProgress}
                    />
                  )
                })}
            </div>
            <DragOverlay>
              {activeProperty ? <PropertyCardOverlay property={activeProperty} /> : null}
            </DragOverlay>
          </DndContext>

          {showScrollTop && (
            <button
              onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              className="fixed bottom-6 right-6 w-8 h-8 rounded-full bg-primary text-primary-foreground shadow-md flex items-center justify-center hover:bg-primary/90 transition-colors z-50"
              aria-label={t('page.scrollToTop')}
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {transition && (
        <StageTransitionModal
          open={true}
          onClose={cancelTransition}
          onConfirm={confirmTransition}
          propertyName={transition.property.name}
          targetStage={transition.toStageName}
          missingFields={transition.missing}
          isPending={isMoving}
        />
      )}


      <Dialog open={addLeadOpen} onOpenChange={(open) => { setAddLeadOpen(open); if (!open) resetAddLeadForm() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('addLead.dialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Row 1: Property Name */}
            <div>
              <div className="space-y-2">
                <Label htmlFor="lead-name">{t('addLead.nameLabel')}</Label>
                <Input
                  id="lead-name"
                  placeholder={t('addLead.namePlaceholder')}
                  value={newLeadName}
                  onChange={(e) => setNewLeadName(e.target.value)}
                  data-testid="input-lead-name"
                />
                {newLeadName.trim().length >= 3 && (() => {
                  const q = newLeadName.trim().toLowerCase()
                  const match = properties?.find((p: any) => p.name?.toLowerCase().includes(q) || q.includes(p.name?.toLowerCase()))
                  return match ? (
                    <p className="text-xs text-warning flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {t('addLead.duplicateWarning', { name: match.name })}
                    </p>
                  ) : null
                })()}
              </div>
            </div>
            {/* Row 2: Property Address (full width) */}
            <div className="space-y-2">
              <Label htmlFor="lead-address">{t('addLead.addressLabel')}</Label>
              <AddressAutocomplete
                id="lead-address"
                placeholder={t('addLead.addressPlaceholder')}
                value={newLeadAddress}
                onChange={setNewLeadAddress}
                testId="input-lead-address"
              />
            </div>
            {/* Row 3: Email + Phone */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="lead-email">{t('addLead.emailLabel')}</Label>
                <Input
                  id="lead-email"
                  type="email"
                  placeholder={t('addLead.emailPlaceholder')}
                  value={newLeadEmail}
                  onChange={(e) => setNewLeadEmail(e.target.value)}
                  data-testid="input-lead-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lead-phone">{t('addLead.phoneLabel')}</Label>
                <Input
                  id="lead-phone"
                  type="tel"
                  placeholder={t('addLead.phonePlaceholder')}
                  value={newLeadPhone}
                  onChange={(e) => setNewLeadPhone(e.target.value)}
                  data-testid="input-lead-phone"
                />
              </div>
            </div>
            {/* Row 4: Estimated Bedrooms + Source */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="lead-bedrooms">{t('addLead.bedroomsLabel')}</Label>
                <Input
                  id="lead-bedrooms"
                  type="number"
                  min={0}
                  placeholder={t('addLead.bedroomsPlaceholder')}
                  value={newLeadBedrooms}
                  onChange={(e) => setNewLeadBedrooms(e.target.value)}
                  data-testid="input-lead-bedrooms"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lead-source">{t('addLead.sourceLabel')}</Label>
                <Select value={newLeadSource} onValueChange={setNewLeadSource}>
                  <SelectTrigger id="lead-source" data-testid="select-lead-source">
                    <SelectValue placeholder={t('addLead.sourcePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Values stay canonical English — they're written verbatim into the
                        lead's notes field (`Source: ${newLeadSource}`) as free-text audit data. */}
                    <SelectItem value="Referral">{t('addLead.sourceReferral')}</SelectItem>
                    <SelectItem value="Website">{t('addLead.sourceWebsite')}</SelectItem>
                    <SelectItem value="Cold Outreach">{t('addLead.sourceColdOutreach')}</SelectItem>
                    <SelectItem value="Word of Mouth">{t('addLead.sourceWordOfMouth')}</SelectItem>
                    <SelectItem value="Other">{t('addLead.sourceOther')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Row 5: Notes (full width) */}
            <div className="space-y-2">
              <Label htmlFor="lead-notes">{t('addLead.notesLabel')}</Label>
              <Textarea
                id="lead-notes"
                placeholder={t('addLead.notesPlaceholder')}
                rows={2}
                value={newLeadNotes}
                onChange={(e) => setNewLeadNotes(e.target.value)}
                data-testid="input-lead-notes"
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setAddLeadOpen(false); resetAddLeadForm() }}>{t('addLead.cancel')}</Button>
            <Button size="sm" onClick={() => addLead()} disabled={!newLeadName.trim() || addLeadPending} data-testid="button-save-lead">
              {addLeadPending ? t('addLead.saving') : t('addLead.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
