import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, STAGE_COLORS, STAGE_ORDER } from '@/lib/supabase'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core'
import { useDroppable } from '@dnd-kit/core'
import { useDraggable } from '@dnd-kit/core'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { StageTransitionModal } from '@/components/StageTransitionModal'
import { PropertyEditDialog } from '@/components/PropertyEditDialog'
import { useToast } from '@/hooks/use-toast'
import { ChevronDown, ChevronRight, Eye, EyeOff, Minimize2 } from 'lucide-react'

// Droppable column
function StageColumn({ stage, properties, onCardClick, compact, collapsed, onToggleCollapse }: {
  stage: any
  properties: any[]
  onCardClick: (p: any) => void
  compact: boolean
  collapsed: boolean
  onToggleCollapse: () => void
}) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.id })
  const color = STAGE_COLORS[stage.name] || '#6b7280'
  const displayProps = collapsed ? [] : properties

  return (
    <div className={`flex flex-col ${collapsed ? 'min-w-[140px] max-w-[140px]' : 'min-w-[220px] max-w-[240px]'}`}>
      <div className="flex items-center gap-1.5 mb-2 px-1">
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
        className={`flex-1 min-h-[200px] rounded-lg p-2 space-y-1.5 transition-colors ${isOver ? 'bg-primary/5 ring-1 ring-primary/30' : 'bg-muted/40'}`}
      >
        {collapsed ? (
          <div className="flex items-center justify-center py-4">
            <span className="text-xs text-muted-foreground writing-mode-vertical" style={{ writingMode: 'vertical-lr', textOrientation: 'mixed' }}>
              {properties.length} properties
            </span>
          </div>
        ) : (
          displayProps.map(p => (
            <DraggableCard key={p.id} property={p} stageName={stage.name} stageColor={color} onClick={() => onCardClick(p)} compact={compact} />
          ))
        )}
      </div>
    </div>
  )
}

// Draggable card
function DraggableCard({ property, stageName, stageColor, onClick, compact }: {
  property: any; stageName: string; stageColor: string; onClick: () => void; compact: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: property.id })

  if (compact) {
    return (
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        data-testid={`card-property-${property.id}`}
        onClick={onClick}
        className={`bg-card border border-card-border rounded px-2 py-1 cursor-grab active:cursor-grabbing select-none transition-opacity hover:border-primary/30 flex items-center justify-between gap-1 ${isDragging ? 'opacity-30' : 'opacity-100'}`}
      >
        <p className="text-xs font-medium text-foreground truncate">{property.name}</p>
        {property.profit_percentage != null && (
          <span className={`text-xs font-medium tabular-nums flex-shrink-0 ${
            property.profit_percentage >= 30 ? 'text-green-600 dark:text-green-400' :
            property.profit_percentage >= 15 ? 'text-amber-600 dark:text-amber-400' :
            'text-destructive'
          }`}>
            {property.profit_percentage.toFixed(0)}%
          </span>
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
      onClick={onClick}
      className={`bg-card border border-card-border rounded-md p-2.5 cursor-grab active:cursor-grabbing select-none transition-opacity hover:border-primary/30 ${isDragging ? 'opacity-30' : 'opacity-100'}`}
    >
      <p className="text-xs font-semibold text-foreground leading-snug">{property.name}</p>
      {property.client_name && (
        <p className="text-xs text-muted-foreground mt-0.5">{property.client_name}</p>
      )}
      <div className="flex items-center justify-between mt-2 gap-1">
        {property.ce_charged != null ? (
          <span className="text-xs text-foreground/80">${property.ce_charged}</span>
        ) : <span className="text-xs text-muted-foreground">—</span>}
        {property.profit_percentage != null && (
          <span className={`text-xs font-medium tabular-nums ${
            property.profit_percentage >= 30 ? 'text-green-600 dark:text-green-400' :
            property.profit_percentage >= 15 ? 'text-amber-600 dark:text-amber-400' :
            'text-destructive'
          }`}>
            {property.profit_percentage.toFixed(1)}%
          </span>
        )}
      </div>
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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const [activeProperty, setActiveProperty] = useState<any>(null)
  const [editProperty, setEditProperty] = useState<any>(null)
  const [editStageName, setEditStageName] = useState('')
  const [compact, setCompact] = useState(false)
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set())
  const [hideEmpty, setHideEmpty] = useState(false)
  const [transition, setTransition] = useState<{
    property: any; fromStageId: string; toStageId: string; toStageName: string; missing: string[]
  } | null>(null)

  const { data: stages, isLoading: stagesLoading } = useQuery({
    queryKey: ['/supabase/pipeline_stages'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pipeline_stages').select('*').order('display_order')
      if (error) throw error
      return data || []
    },
  })

  const { data: properties, isLoading: propsLoading } = useQuery({
    queryKey: ['/supabase/pipeline'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, client, stage_id, ce_charged, profit_percentage, pipeline_stages!properties_stage_id_fkey(name, color, requires_fields)')
      if (error) throw error
      return (data || []).map((p: any) => ({ ...p, client_name: p.client }))
    },
  })

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      qc.invalidateQueries({ queryKey: ['/supabase/stage_transitions_recent'] })
      setTransition(null)
    },
    onError: () => toast({ title: 'Failed to move property', variant: 'destructive' }),
  })

  function toggleCollapse(stageId: string) {
    setCollapsedStages(prev => {
      const n = new Set(prev)
      n.has(stageId) ? n.delete(stageId) : n.add(stageId)
      return n
    })
  }

  const visibleStages = useMemo(() => {
    if (!stages || !properties) return []
    return stages.filter((s: any) => {
      if (!hideEmpty) return true
      const count = properties.filter((p: any) => p.stage_id === s.id).length
      return count > 0
    })
  }, [stages, properties, hideEmpty])

  function handleDragStart(e: DragStartEvent) {
    const prop = properties?.find((p: any) => p.id === e.active.id)
    setActiveProperty(prop || null)
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveProperty(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const prop = properties?.find((p: any) => p.id === active.id)
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

    if (missing.length > 0) {
      setTransition({ property: prop, fromStageId, toStageId, toStageName: toStage.name, missing })
    } else {
      moveProperty({ propId: prop.id, stageId: toStageId, fromStageId })
    }
  }

  function confirmTransition() {
    if (!transition) return
    moveProperty({
      propId: transition.property.id,
      stageId: transition.toStageId,
      fromStageId: transition.fromStageId,
    })
  }

  const isLoading = stagesLoading || propsLoading

  return (
    <div className="p-5 h-full flex flex-col">
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Pipeline</h1>
          <p className="text-sm text-muted-foreground">Drag properties between stages</p>
        </div>
        <div className="flex items-center gap-4">
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
        <div className="flex gap-4 overflow-x-auto pb-2">
          {STAGE_ORDER.map(name => (
            <div key={name} className="min-w-[220px]">
              <Skeleton className="h-5 w-24 mb-2" />
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-3 overflow-x-auto pb-4 flex-1">
            {visibleStages.map((stage: any) => {
              const stageProps = properties?.filter((p: any) => p.stage_id === stage.id) || []
              return (
                <StageColumn
                  key={stage.id}
                  stage={stage}
                  properties={stageProps}
                  onCardClick={(p) => {
                    setEditProperty(p)
                    setEditStageName(stage.name)
                  }}
                  compact={compact}
                  collapsed={collapsedStages.has(String(stage.id))}
                  onToggleCollapse={() => toggleCollapse(String(stage.id))}
                />
              )
            })}
          </div>
          <DragOverlay>
            {activeProperty ? <PropertyCardOverlay property={activeProperty} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {transition && (
        <StageTransitionModal
          open={true}
          onClose={() => setTransition(null)}
          onConfirm={confirmTransition}
          propertyName={transition.property.name}
          targetStage={transition.toStageName}
          missingFields={transition.missing}
          isPending={isMoving}
        />
      )}

      {editProperty && (
        <PropertyEditDialog
          property={editProperty}
          stageName={editStageName}
          open={true}
          onClose={() => setEditProperty(null)}
        />
      )}
    </div>
  )
}
