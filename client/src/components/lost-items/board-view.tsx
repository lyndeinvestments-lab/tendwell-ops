import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { format } from 'date-fns'
import { Package, User as UserIcon } from 'lucide-react'
import {
  LOST_ITEM_PIPELINE,
  STATUS_LABELS,
  type LostItemAssignment,
  type LostItemCase,
  type LostItemStatus,
} from './shared'

interface Props {
  cases: LostItemCase[]
  assignmentsByCase: Map<string, LostItemAssignment>
  onCaseClick: (caseId: string) => void
  onStatusChange: (caseId: string, newStatus: LostItemStatus, prevStatus: LostItemStatus) => void
  canEdit: boolean
}

// Kanban-style board, ported from Haven-OS components/lost-items/lost-items-directory.tsx.
// Drag-drop status changes are optimistic — the parent runs the PATCH and rolls back on
// failure via the next data refetch.
export function LostItemsBoardView({
  cases,
  assignmentsByCase,
  onCaseClick,
  onStatusChange,
  canEdit,
}: Props) {
  const [board, setBoard] = useState<LostItemCase[]>(cases)
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => { setBoard(cases) }, [cases])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const grouped = useMemo(() => {
    const map = new Map<LostItemStatus, LostItemCase[]>()
    for (const s of LOST_ITEM_PIPELINE) map.set(s, [])
    for (const c of board) map.get(c.status)?.push(c)
    return map
  }, [board])

  const activeCase = activeId ? board.find(c => c.id === activeId) ?? null : null

  function handleDragStart(e: DragStartEvent) {
    if (!canEdit) return
    setActiveId(String(e.active.id))
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    if (!canEdit) return
    const caseId = String(e.active.id)
    const overId = e.over?.id ? String(e.over.id) : null
    if (!overId) return

    let targetCol: LostItemStatus | null = null
    if ((LOST_ITEM_PIPELINE as string[]).includes(overId)) {
      targetCol = overId as LostItemStatus
    } else {
      const overCase = board.find(c => c.id === overId)
      if (overCase) targetCol = overCase.status
    }
    if (!targetCol) return
    const c = board.find(x => x.id === caseId)
    if (!c || c.status === targetCol) return

    const prevStatus = c.status
    setBoard(curr => curr.map(x => (x.id === caseId ? { ...x, status: targetCol! } : x)))
    onStatusChange(caseId, targetCol, prevStatus)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {LOST_ITEM_PIPELINE.map(s => (
          <BoardColumn
            key={s}
            status={s}
            cases={grouped.get(s) ?? []}
            activeId={activeId}
            assignmentsByCase={assignmentsByCase}
            onCaseClick={onCaseClick}
            canEdit={canEdit}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeCase ? <BoardCard c={activeCase} assignment={assignmentsByCase.get(activeCase.id)} isDragging /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function BoardColumn({
  status, cases, activeId, assignmentsByCase, onCaseClick, canEdit,
}: {
  status: LostItemStatus
  cases: LostItemCase[]
  activeId: string | null
  assignmentsByCase: Map<string, LostItemAssignment>
  onCaseClick: (id: string) => void
  canEdit: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !canEdit })
  return (
    <div
      ref={setNodeRef}
      className={
        'flex flex-col gap-2 rounded-lg border bg-muted/30 p-2 min-h-[220px] transition-colors ' +
        (isOver ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border')
      }
    >
      <div className="flex items-center justify-between px-2 pt-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {STATUS_LABELS[status]}
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums">{cases.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {cases.map(c => (
          <DraggableBoardCard
            key={c.id}
            c={c}
            isOverlayActive={activeId === c.id}
            assignment={assignmentsByCase.get(c.id)}
            onCaseClick={onCaseClick}
            canEdit={canEdit}
          />
        ))}
        {cases.length === 0 ? (
          <div
            className={
              'px-2 py-4 text-center text-[11px] rounded-md border border-dashed ' +
              (isOver
                ? 'text-primary border-primary/50 bg-primary/5'
                : 'text-muted-foreground/70 border-border')
            }
          >
            {isOver ? 'Drop here' : 'No cases'}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function DraggableBoardCard({
  c, isOverlayActive, assignment, onCaseClick, canEdit,
}: {
  c: LostItemCase
  isOverlayActive: boolean
  assignment: LostItemAssignment | undefined
  onCaseClick: (id: string) => void
  canEdit: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: c.id, disabled: !canEdit })
  const open = () => onCaseClick(c.id)
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...(canEdit ? listeners : {})}
      onClick={open}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); open() } }}
      role="button"
      tabIndex={0}
      style={{ opacity: isDragging || isOverlayActive ? 0.4 : 1 }}
      className={
        'touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg ' +
        (canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer')
      }
      data-testid={`board-card-${c.id}`}
    >
      <BoardCard c={c} assignment={assignment} />
    </div>
  )
}

function BoardCard({
  c, assignment, isDragging,
}: {
  c: LostItemCase
  assignment?: LostItemAssignment
  isDragging?: boolean
}) {
  return (
    <div
      className={
        'group relative rounded-lg border border-border bg-card p-3 text-sm shadow-sm ' +
        (isDragging
          ? 'shadow-lg border-primary/50 rotate-1'
          : 'hover:shadow-md hover:border-foreground/30 transition-all')
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">{c.case_number}</span>
        {c.follow_up_date ? (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">
            FU {format(new Date(c.follow_up_date), 'MMM d')}
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex items-start gap-1.5">
        <Package className="w-3.5 h-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
        <p className="text-xs leading-snug line-clamp-2">{c.item_description}</p>
      </div>
      {(c.property?.name || c.property_name) ? (
        <p className="mt-1 text-[11px] text-muted-foreground truncate">
          {c.property?.name ?? c.property_name}
        </p>
      ) : null}
      {c.guest_name ? (
        <p className="text-[11px] text-muted-foreground truncate">{c.guest_name}</p>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {c.updated_at ? format(new Date(c.updated_at), 'MMM d') : ''}
        </span>
        {assignment?.assignee ? (
          <span
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 truncate max-w-[140px]"
            title={assignment.assignee.label}
          >
            <UserIcon className="w-2.5 h-2.5 flex-shrink-0" />
            <span className="truncate">{assignment.assignee.label}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <UserIcon className="w-2.5 h-2.5" /> Unassigned
          </span>
        )}
      </div>
    </div>
  )
}
