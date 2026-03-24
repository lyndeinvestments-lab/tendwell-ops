import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, STAGE_COLORS, STAGE_ORDER } from '@/lib/supabase'
import { usePropertyModal } from '@/hooks/use-property-modal'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core'
import { useDroppable } from '@dnd-kit/core'
import { useDraggable } from '@dnd-kit/core'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { StageTransitionModal } from '@/components/StageTransitionModal'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChevronDown, ChevronRight, Eye, EyeOff, Minimize2, ArrowUp, CalendarDays, Search, Plus, X } from 'lucide-react'
import { format } from 'date-fns'

const FOLLOW_UP_STAGES = new Set(['Lead', 'Quote', 'Onboarding'])

// ── Profit badge ──────────────────────────────────────────────────────────────
function ProfitBadge({ pct, stageName }: { pct: number | null | undefined; stageName: string }) {
  const isOnboarding = stageName === 'Onboarding'
  if (pct == null) {
    if (isOnboarding) {
      return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-medium">No data</span>
    }
    return null
  }
  const cls =
    pct >= 30 ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400' :
    pct >= 15 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400' :
    pct >= 0  ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-400' :
                'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium tabular-nums ${cls}`}>
      {pct.toFixed(0)}%
    </span>
  )
}

// ── Stage history tooltip ──────────────────────────────────────────────────────
function StageHistoryTooltip({ transitions, children }: { transitions: any[]; children: React.ReactNode }) {
  if (!transitions || transitions.length === 0) return <>{children}</>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="cursor-help">{children}</div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs p-2 space-y-1">
        <p className="text-xs font-medium mb-1">Stage History</p>
        {transitions.map((t: any, i: number) => (
          <div key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span>{t.pipeline_stages?.name ?? '—'}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>{format(new Date(t.created_at), 'MMM d, yyyy')}</span>
          </div>
        ))}
      </TooltipContent>
    </Tooltip>
  )
}

// ── Droppable column ──────────────────────────────────────────────────────────
function StageColumn({ stage, properties, onNameClick, compact, collapsed, onToggleCollapse, onFollowUpChange }: {
  stage: any
  properties: any[]
  onNameClick: (p: any) => void
  compact: boolean
  collapsed: boolean
  onToggleCollapse: () => void
  onFollowUpChange: (propId: string, date: string) => void
  transitionsByProperty?: Record<string, any[]>
}) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.id })
  const color = STAGE_COLORS[stage.name] || '#6b7280'
  const displayProps = collapsed ? [] : properties

  return (
    <div
      id={`col-${stage.name}`}
      className={`flex flex-col h-full ${collapsed ? 'min-w-[140px] max-w-[140px]' : 'min-w-[220px] max-w-[240px]'}`}
    >
      <div className="flex items-center gap-1.5 mb-2 px-1 flex-shrink-0">
        <button
          onClick={onToggleCollapse}
          className="p-0.5 rounded hover:bg-muted transition-colors"
          data-testid={`toggle-collapse-${stage.name}`}
        >
          {collapsed ? <ChevronRight className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
        </button>
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground truncate">{stage.name}</span>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums flex-shrink-0">{properties.length}</span>
      </div>
      <div
        ref={setNodeRef}
        data-testid={`column-${stage.name}`}
        className={`flex-1 rounded-lg p-2 space-y-1.5 transition-colors ${isOver ? 'bg-primary/5 ring-1 ring-primary/30' : 'bg-muted/40'}`}
      >
        {collapsed ? (
          <div className="flex items-center justify-center py-4 h-full">
            <span className="text-xs text-muted-foreground" style={{ writingMode: 'vertical-lr', textOrientation: 'mixed' }}>
              {properties.length} properties
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
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Draggable card ─────────────────────────────────────────────────────────────
function DraggableCard({ property, stageName, stageColor, onNameClick, compact, onFollowUpChange }: {
  property: any; stageName: string; stageColor: string; onNameClick: () => void; compact: boolean
  onFollowUpChange: (date: string) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: property.id })
  const showFollowUp = FOLLOW_UP_STAGES.has(stageName)
  const transitions: any[] = property._transitions ?? []

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
        className={`bg-card border border-card-border rounded px-2 py-1 cursor-grab active:cursor-grabbing select-none transition-opacity hover:border-primary/30 ${isDragging ? 'opacity-30' : 'opacity-100'}`}
      >
        <div className="flex items-center justify-between gap-1">
          <button
            onClick={handleNameClick}
            className="text-xs font-medium text-foreground truncate hover:underline text-left"
          >
            {property.name}
          </button>
          <ProfitBadge pct={property.profit_percentage} stageName={stageName} />
        </div>
        {showFollowUp && (
          <div className="flex items-center gap-1 mt-0.5" onClick={handleDateClick}>
            <CalendarDays className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            <input
              type="date"
              value={property.follow_up_date || ''}
              onChange={handleDateChange}
              className="text-xs text-muted-foreground bg-transparent border-none outline-none cursor-pointer w-full"
              title="Follow-up date"
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
      className={`bg-card border border-card-border rounded-md p-2.5 cursor-grab active:cursor-grabbing select-none transition-opacity hover:border-primary/30 ${isDragging ? 'opacity-30' : 'opacity-100'}`}
    >
      <span className="text-xs font-semibold text-foreground leading-snug hover:underline text-left w-full block">
        {property.name}
      </span>
      {property.client_name && (
        <p className="text-xs text-muted-foreground mt-0.5">{property.client_name}</p>
      )}
      {property.contacts?.full_name && (
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="text-xs text-primary/80 mt-0.5 truncate cursor-help">{property.contacts.full_name}</p>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs p-2 space-y-1">
            <p className="text-xs font-medium">{property.contacts.full_name}</p>
            {property.contacts.phone && <p className="text-xs text-muted-foreground">{property.contacts.phone}</p>}
            {property.contacts.email && <p className="text-xs text-muted-foreground">{property.contacts.email}</p>}
            {property.contacts.payment_method && <p className="text-xs text-muted-foreground">Payment: {property.contacts.payment_method}</p>}
            {property.contacts.client_since && <p className="text-xs text-muted-foreground">Client since {property.contacts.client_since}</p>}
          </TooltipContent>
        </Tooltip>
      )}
      <div className="flex items-center justify-between mt-2 gap-1">
        {property.ce_charged != null ? (
          <span className="text-xs text-foreground/80">${property.ce_charged}</span>
        ) : <span className="text-xs text-muted-foreground">—</span>}
        <ProfitBadge pct={property.profit_percentage} stageName={stageName} />
      </div>
      {showFollowUp && (
        <StageHistoryTooltip transitions={transitions}>
          <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-border/40" onClick={handleDateClick}>
            <CalendarDays className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            <input
              type="date"
              value={property.follow_up_date || ''}
              onChange={handleDateChange}
              className="text-xs text-muted-foreground bg-transparent border-none outline-none cursor-pointer w-full"
              placeholder="Add follow-up"
              title="Follow-up date"
            />
          </div>
        </StageHistoryTooltip>
      )}
    </div>
  )
}

function PropertyCardOverlay({ property }: { property: any }) {
  return (
    <div className="bg-card border border-primary/40 rounded-md p-2.5 shadow-lg w-[220px] cursor-grabbing">
      <p className="text-xs font-semibold text-foreground">{property.name}</p>
      {property.client_name && <p className="text-xs text-muted-foreground mt-0.5">{property.client_name}</p>}
    </div>
  )
}

export default function PipelinePage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { openPropertyModal } = usePropertyModal()
  usePageTitle('Pipeline')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)

  const [activeProperty, setActiveProperty] = useState<any>(null)
  const [compact, setCompact] = useState(false)
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set())
  const [hideEmpty, setHideEmpty] = useState(false)
  const [transition, setTransition] = useState<{
    property: any; fromStageId: string; toStageId: string; toStageName: string; missing: string[]
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [localProperties, setLocalProperties] = useState<any[] | null>(null)
  const [search, setSearch] = useState('')
  const [addLeadOpen, setAddLeadOpen] = useState(false)
  const [newLeadName, setNewLeadName] = useState('')
  const [newLeadClient, setNewLeadClient] = useState('')

  const { data: stages, isLoading: stagesLoading } = useQuery({
    queryKey: ['/supabase/pipeline_stages'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pipeline_stages').select('*').order('display_order')
      if (error) throw error
      return data || []
    },
  })

  const { data: properties, isLoading: propsLoading, error: propsError } = useQuery({
    queryKey: ['/supabase/pipeline'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, client, stage_id, ce_charged, profit_percentage, follow_up_date, contact_id, contacts(full_name, phone, email, payment_method, client_since), pipeline_stages!properties_stage_id_fkey(name, color, requires_fields)')
      if (error) {
        if (error.message?.includes('follow_up_date') || error.message?.includes('contact')) {
          const { data: fallback, error: fallbackError } = await supabase
            .from('properties')
            .select('id, name, client, stage_id, ce_charged, profit_percentage, pipeline_stages!properties_stage_id_fkey(name, color, requires_fields)')
          if (fallbackError) throw fallbackError
          return (fallback || []).map((p: any) => ({ ...p, client_name: p.client, follow_up_date: null, contacts: null }))
        }
        throw error
      }
      return (data || []).map((p: any) => ({ ...p, client_name: p.client }))
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
      if (!map[t.property_id]) map[t.property_id] = []
      if (map[t.property_id].length < 3) map[t.property_id].push(t)
    }
    return map
  }, [allTransitions])

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
      (p.client_name && p.client_name.toLowerCase().includes(q))
    )
  }, [localProperties, properties, search])

  const { mutate: moveProperty, isPending: isMoving } = useMutation({
    mutationFn: async ({ propId, stageId, fromStageId }: { propId: string; stageId: string; fromStageId: string }) => {
      const { error: updateErr } = await supabase.from('properties').update({ stage_id: stageId }).eq('id', propId)
      if (updateErr) throw updateErr
      await supabase.from('stage_transitions').insert({
        property_id: propId,
        from_stage_id: fromStageId || null,
        to_stage_id: stageId,
      })
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      qc.invalidateQueries({ queryKey: ['/supabase/stage_transitions_recent'] })
      qc.invalidateQueries({ queryKey: ['/supabase/transitions-period'] })

      const toStage = stages?.find((s: any) => s.id === variables.stageId)
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
    onError: () => {
      setLocalProperties(properties ?? null)
      toast({ title: 'Failed to move property', variant: 'destructive' })
    },
  })

  const { mutate: updateFollowUpDate } = useMutation({
    mutationFn: async ({ propId, date }: { propId: string; date: string }) => {
      const { error } = await supabase.from('properties').update({ follow_up_date: date || null }).eq('id', propId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] }),
    onError: () => toast({ title: 'Failed to save follow-up date', variant: 'destructive' }),
  })

  const leadStage = stages?.find((s: any) => s.name === 'Lead')

  const { mutate: addLead, isPending: addLeadPending } = useMutation({
    mutationFn: async () => {
      if (!leadStage) throw new Error('No Lead stage found')
      const { error } = await supabase.from('properties').insert({
        name: newLeadName.trim(),
        client: newLeadClient.trim() || null,
        stage_id: leadStage.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      toast({ title: 'Lead added to pipeline' })
      setAddLeadOpen(false)
      setNewLeadName('')
      setNewLeadClient('')
    },
    onError: (e: any) => toast({ title: 'Error: ' + (e.message || 'Failed to add lead'), variant: 'destructive' }),
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

  const visibleStages = useMemo(() => {
    if (!stages || !displayProperties) return []
    return stages.filter((s: any) => {
      if (!hideEmpty) return true
      return displayProperties.filter((p: any) => p.stage_id === s.id).length > 0
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
    const toStageId = over.id as string
    if (fromStageId === toStageId) return

    const toStage = stages?.find((s: any) => s.id === toStageId)
    if (!toStage) return

    const reqFields: string[] = Array.isArray(toStage.requires_fields) ? toStage.requires_fields : []
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
      <div className="mb-3 flex flex-col gap-2 flex-shrink-0 sm:flex-row sm:items-center sm:justify-between sm:flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Pipeline</h1>
          <p className="text-sm text-muted-foreground">Drag properties between stages</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 sm:flex-none sm:w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search properties..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-8 h-8 text-sm w-full"
              data-testid="input-search-pipeline"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={() => setAddLeadOpen(true)} data-testid="button-add-lead">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Lead
          </Button>
          <div className="flex items-center gap-2">
            <Switch id="compact-mode" checked={compact} onCheckedChange={setCompact} data-testid="switch-compact" />
            <Label htmlFor="compact-mode" className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
              <Minimize2 className="w-3 h-3" /> Compact
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="hide-empty" checked={hideEmpty} onCheckedChange={setHideEmpty} data-testid="switch-hide-empty" />
            <Label htmlFor="hide-empty" className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
              {hideEmpty ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />} Hide empty
            </Label>
          </div>
        </div>
      </div>

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
          <div className="text-center space-y-2">
            <p className="text-sm font-medium text-destructive">Failed to load pipeline</p>
            <p className="text-xs text-muted-foreground max-w-sm">{(propsError as any)?.message}</p>
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-auto relative">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-3 pb-4 items-stretch min-h-full">
              {visibleStages.map((stage: any) => {
                const stageProps = (displayProperties?.filter((p: any) => p.stage_id === stage.id) || [])
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
              title="Scroll to top"
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

      <Dialog open={addLeadOpen} onOpenChange={setAddLeadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="lead-name">Property Name *</Label>
              <Input
                id="lead-name"
                placeholder="Enter property name"
                value={newLeadName}
                onChange={(e) => setNewLeadName(e.target.value)}
                data-testid="input-lead-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-client">Client Name</Label>
              <Input
                id="lead-client"
                placeholder="Enter client name (optional)"
                value={newLeadClient}
                onChange={(e) => setNewLeadClient(e.target.value)}
                data-testid="input-lead-client"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddLeadOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => addLead()} disabled={!newLeadName.trim() || addLeadPending} data-testid="button-save-lead">
              {addLeadPending ? 'Saving...' : 'Add Lead'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
