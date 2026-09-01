// The classic CRM view: a client-stage board, an attention queue, and a
// client-360 detail sheet.
//
// This is the CLIENT axis. /pipeline is the PROPERTY axis (Lead → Quote →
// Onboarding → Active → Offboarding → Offboarded) and the two never cascade —
// moving a client here does not move their properties, by design. The 360 sheet
// shows both side by side so a human decides.
//
// Reads come from crm_client_360 / crm_attention / crm_stale_quote_properties.
// Stage moves go through the crm_set_client_stage RPC rather than a direct
// update, so the client_stage_transitions audit row is written in the same
// statement.

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { supabase } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'
import {
  ACTIVE_CLIENT_STAGES,
  CLIENT_STAGES,
  TERMINAL_CLIENT_STAGES,
  attentionReasonLabel,
  attentionReasonTone,
  clientStageLabel,
  clientStageTone,
  type AttentionRow,
  type Client360,
  type ClientStage,
  type StaleQuoteProperty,
} from '@shared/crm'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/EmptyState'
import {
  AlertCircle,
  Building2,
  CalendarClock,
  ChevronRight,
  Clock,
  Loader2,
  MoveRight,
  Phone,
  Sparkles,
} from 'lucide-react'

const CLIENT_360_KEY = ['crm', 'client-360']
const ATTENTION_KEY = ['crm', 'attention']
const STALE_QUOTES_KEY = ['crm', 'stale-quotes']

const money = (n: number | null | undefined) =>
  typeof n === 'number' && n > 0
    ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : '—'

// ─── data ───────────────────────────────────────────────────────────────────

function useClients() {
  return useQuery<Client360[]>({
    queryKey: CLIENT_360_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_client_360')
        .select('*')
        .order('monthly_value', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Client360[]
    },
  })
}

function useAttention() {
  return useQuery<AttentionRow[]>({
    queryKey: ATTENTION_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_attention')
        .select('*')
        .order('priority', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as AttentionRow[]
    },
  })
}

function useStaleQuotes() {
  return useQuery<StaleQuoteProperty[]>({
    queryKey: STALE_QUOTES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_stale_quote_properties')
        .select('*')
        .order('days_stale', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as StaleQuoteProperty[]
    },
  })
}

// ─── client card ────────────────────────────────────────────────────────────

/** The visual card. Rendered both in a column and inside the DragOverlay. */
function CardBody({
  client,
  canEdit,
  onOpen,
  onMove,
  moving,
}: {
  client: Client360
  canEdit: boolean
  onOpen?: () => void
  onMove?: (to: ClientStage) => void
  moving?: boolean
}) {
  const overdue =
    client.next_action_date != null &&
    client.next_action_date < new Date().toISOString().slice(0, 10)

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={onOpen}
          onPointerDown={e => e.stopPropagation()}
          className="min-w-0 text-left group"
        >
          <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
            {client.full_name}
          </p>
          {client.company && client.company !== client.full_name && (
            <p className="text-2xs text-muted-foreground truncate">{client.company}</p>
          )}
        </button>
        {canEdit && onMove && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 shrink-0"
                onPointerDown={e => e.stopPropagation()}
                disabled={moving}
                aria-label={`Move ${client.full_name}`}
                data-testid={`crm-move-${client.id}`}
              >
                {moving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <MoveRight className="w-3.5 h-3.5" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-2xs">Move to</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {CLIENT_STAGES.filter(s => s.id !== client.client_stage).map(s => (
                <DropdownMenuItem key={s.id} onClick={() => onMove(s.id)}>
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground tabular-nums">
        <span className="inline-flex items-center gap-1">
          <Building2 className="w-3 h-3" />
          {client.property_count}
        </span>
        {client.monthly_value > 0 && (
          <span className="font-medium text-foreground">{money(client.monthly_value)}/mo</span>
        )}
        <span className="inline-flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {client.days_in_stage}d
        </span>
      </div>

      {client.next_action && (
        <p
          className={`mt-2 text-2xs flex items-start gap-1 ${
            overdue ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          <CalendarClock className="w-3 h-3 mt-0.5 shrink-0" />
          <span className="min-w-0">
            {client.next_action}
            {client.next_action_date && ` · ${client.next_action_date}`}
          </span>
        </p>
      )}
    </>
  )
}

function ClientCard({
  client,
  canEdit,
  onOpen,
  onMove,
  moving,
}: {
  client: Client360
  canEdit: boolean
  onOpen: () => void
  onMove: (to: ClientStage) => void
  moving: boolean
}) {
  // Drag is an editor affordance. A viewer still gets the card, just not the
  // grab handle — and the dropdown is likewise hidden for them.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: client.id,
    disabled: !canEdit || moving,
  })

  return (
    <div
      ref={setNodeRef}
      {...(canEdit ? listeners : {})}
      {...(canEdit ? attributes : {})}
      className={`rounded-xl border border-card-border bg-card p-3 shadow-sm transition-colors ${
        canEdit ? 'cursor-grab active:cursor-grabbing' : ''
      } ${isDragging ? 'opacity-40' : 'hover:border-primary/40'}`}
      data-testid={`crm-card-${client.id}`}
    >
      <CardBody
        client={client}
        canEdit={canEdit}
        onOpen={onOpen}
        onMove={onMove}
        moving={moving}
      />
    </div>
  )
}

// ─── board ──────────────────────────────────────────────────────────────────

function Board({
  clients,
  canEdit,
  onOpen,
  onMove,
  movingId,
  showTerminal,
}: {
  clients: Client360[]
  canEdit: boolean
  onOpen: (c: Client360) => void
  onMove: (c: Client360, to: ClientStage) => void
  movingId: string | null
  showTerminal: boolean
}) {
  const columns = showTerminal
    ? CLIENT_STAGES
    : CLIENT_STAGES.filter(s => ACTIVE_CLIENT_STAGES.includes(s.id))

  const byStage = useMemo(() => {
    const m = new Map<string, Client360[]>()
    for (const c of clients) {
      const list = m.get(c.client_stage) ?? []
      list.push(c)
      m.set(c.client_stage, list)
    }
    return m
  }, [clients])

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3 min-w-max">
        {columns.map(stage => (
          <BoardColumn
            key={stage.id}
            stage={stage}
            list={byStage.get(stage.id) ?? []}
            canEdit={canEdit}
            movingId={movingId}
            onOpen={onOpen}
            onMove={onMove}
          />
        ))}
      </div>
    </div>
  )
}

function BoardColumn({
  stage,
  list,
  canEdit,
  movingId,
  onOpen,
  onMove,
}: {
  stage: (typeof CLIENT_STAGES)[number]
  list: Client360[]
  canEdit: boolean
  movingId: string | null
  onOpen: (c: Client360) => void
  onMove: (c: Client360, to: ClientStage) => void
}) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.id })
  const value = list.reduce((s, c) => s + (c.monthly_value || 0), 0)
  return (
    <div className="w-64 shrink-0" data-testid={`crm-column-${stage.id}`}>
      <div className="mb-2 px-1">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge tone={stage.tone}>{stage.label}</StatusBadge>
          <span className="text-2xs text-muted-foreground tabular-nums">
            {list.length}
            {value > 0 && ` · ${money(value)}`}
          </span>
        </div>
        <p className="mt-1 text-2xs text-muted-foreground leading-snug">{stage.blurb}</p>
      </div>
      <div
        ref={setNodeRef}
        className={`space-y-2 rounded-xl p-1 -m-1 min-h-24 transition-colors ${
          isOver ? 'bg-primary/10 ring-1 ring-primary/40' : ''
        }`}
      >
        {list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-card-border p-3 text-2xs text-muted-foreground text-center">
            {isOver ? 'Drop here' : 'Empty'}
          </div>
        ) : (
          list.map(c => (
            <ClientCard
              key={c.id}
              client={c}
              canEdit={canEdit}
              moving={movingId === c.id}
              onOpen={() => onOpen(c)}
              onMove={to => onMove(c, to)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ─── attention queue ────────────────────────────────────────────────────────

function Attention({
  rows,
  stale,
  onOpen,
  clientsById,
}: {
  rows: AttentionRow[]
  stale: StaleQuoteProperty[]
  onOpen: (c: Client360) => void
  clientsById: Map<string, Client360>
}) {
  const grouped = useMemo(() => {
    const m = new Map<string, AttentionRow[]>()
    for (const r of rows) {
      const list = m.get(r.reason) ?? []
      list.push(r)
      m.set(r.reason, list)
    }
    return Array.from(m.entries()).sort(
      (a, b) => (a[1][0]?.priority ?? 9) - (b[1][0]?.priority ?? 9),
    )
  }, [rows])

  if (rows.length === 0 && stale.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Nothing needs attention"
        description="No stale prospects, overdue follow-ups, or unanswered quotes."
      />
    )
  }

  return (
    <div className="space-y-5">
      {grouped.map(([reason, list]) => (
        <div key={reason}>
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge tone={attentionReasonTone(reason)}>
              {attentionReasonLabel(reason)}
            </StatusBadge>
            <span className="text-2xs text-muted-foreground tabular-nums">{list.length}</span>
          </div>
          <div className="rounded-2xl border border-card-border overflow-hidden">
            {list.map((r, i) => {
              const client = clientsById.get(r.contact_id)
              return (
                <button
                  key={`${r.contact_id}-${r.reason}`}
                  onClick={() => client && onOpen(client)}
                  disabled={!client}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-muted/40 transition-colors ${
                    i > 0 ? 'border-t border-border/60' : ''
                  }`}
                  data-testid={`crm-attention-${r.contact_id}-${r.reason}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {r.full_name}
                      {r.company && r.company !== r.full_name && (
                        <span className="text-muted-foreground font-normal"> · {r.company}</span>
                      )}
                    </p>
                    <p className="text-2xs text-muted-foreground">{r.detail}</p>
                  </div>
                  {r.monthly_value > 0 && (
                    <span className="text-xs tabular-nums shrink-0">
                      {money(r.monthly_value)}/mo
                    </span>
                  )}
                  <StatusBadge tone={clientStageTone(r.client_stage)} className="shrink-0">
                    {clientStageLabel(r.client_stage)}
                  </StatusBadge>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {stale.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge tone="neutral">Properties parked in Quote</StatusBadge>
            <span className="text-2xs text-muted-foreground tabular-nums">{stale.length}</span>
          </div>
          {/* Property-level, so it stays out of the per-client grouping above.
              This is the Quote graveyard — 109 rows when this shipped. */}
          <div className="rounded-2xl border border-card-border overflow-hidden max-h-72 overflow-y-auto">
            {stale.map((p, i) => (
              <div
                key={p.property_id}
                className={`px-3 py-2 flex items-center gap-3 text-sm ${
                  i > 0 ? 'border-t border-border/60' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{p.property_name ?? p.property_id}</span>
                <span className="text-2xs text-muted-foreground truncate max-w-40">
                  {p.client_name ?? 'no client'}
                </span>
                <span className="text-2xs tabular-nums text-muted-foreground shrink-0">
                  {p.days_stale}d
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── client 360 sheet ───────────────────────────────────────────────────────

interface Interaction {
  id: string
  interaction_type: string
  summary: string | null
  occurred_at: string | null
  created_at: string
  created_by: string | null
  source: string | null
}

interface PropertyRow {
  id: number
  name: string | null
  monthly_revenue_estimate: number | null
  pipeline_stages: { name: string } | { name: string }[] | null
}

function ClientSheet({
  client,
  canEdit,
  onClose,
  onChanged,
}: {
  client: Client360 | null
  canEdit: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [note, setNote] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [nextDate, setNextDate] = useState('')

  const id = client?.id

  const props = useQuery<PropertyRow[]>({
    queryKey: ['crm', 'client-properties', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id,name,monthly_revenue_estimate,pipeline_stages(name)')
        .eq('contact_id', id!)
        .is('archived_at', null)
        .order('name')
      if (error) throw error
      return (data ?? []) as unknown as PropertyRow[]
    },
  })

  const interactions = useQuery<Interaction[]>({
    queryKey: ['crm', 'client-interactions', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contact_interactions')
        .select('id,interaction_type,summary,occurred_at,created_at,created_by,source')
        .eq('contact_id', id!)
        .order('occurred_at', { ascending: false, nullsFirst: false })
        .limit(25)
      if (error) throw error
      return (data ?? []) as unknown as Interaction[]
    },
  })

  const logNote = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('crm_log_interaction', {
        p_contact_id: id!,
        p_summary: note.trim(),
        p_interaction_type: 'note',
        p_next_action: nextAction.trim() || null,
        p_next_action_date: nextDate || null,
        p_source: 'ui',
      })
      if (error) throw error
    },
    onSuccess: () => {
      setNote('')
      setNextAction('')
      setNextDate('')
      interactions.refetch()
      onChanged()
      toast({ title: 'Logged' })
    },
    onError: (e: unknown) =>
      toast({
        title: 'Could not log',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      }),
  })

  if (!client) return null

  const stageOf = (p: PropertyRow) =>
    Array.isArray(p.pipeline_stages) ? p.pipeline_stages[0]?.name : p.pipeline_stages?.name

  return (
    <Sheet open={!!client} onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="pr-8">{client.full_name}</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={clientStageTone(client.client_stage)}>
              {clientStageLabel(client.client_stage)}
            </StatusBadge>
            <span className="text-2xs text-muted-foreground tabular-nums">
              {client.days_in_stage} days in stage
            </span>
            {client.client_since && (
              <span className="text-2xs text-muted-foreground">
                · client since {client.client_since}
              </span>
            )}
          </div>

          {(client.company || client.email || client.phone) && (
            <div className="text-sm space-y-0.5">
              {client.company && client.company !== client.full_name && (
                <p className="text-muted-foreground">{client.company}</p>
              )}
              {client.email && <p className="font-mono text-xs">{client.email}</p>}
              {client.phone && (
                <p className="text-xs inline-flex items-center gap-1">
                  <Phone className="w-3 h-3" />
                  {client.phone}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-card-border p-2">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">Properties</p>
              <p className="text-xl font-semibold tabular-nums">{client.property_count}</p>
            </div>
            <div className="rounded-xl border border-card-border p-2">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">Monthly</p>
              <p className="text-xl font-semibold tabular-nums">{money(client.monthly_value)}</p>
            </div>
            <div className="rounded-xl border border-card-border p-2">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">Touches</p>
              <p className="text-xl font-semibold tabular-nums">{client.interaction_count}</p>
            </div>
          </div>

          {client.next_action && (
            <div className="rounded-xl border border-warning/40 bg-warning/5 p-3">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">Next action</p>
              <p className="text-sm">
                {client.next_action}
                {client.next_action_date && (
                  <span className="text-muted-foreground"> · due {client.next_action_date}</span>
                )}
              </p>
            </div>
          )}

          {/* Both axes, side by side. Moving a client never moves these. */}
          <div>
            <p className="text-2xs uppercase tracking-wide text-muted-foreground mb-1.5">
              Properties &amp; their own pipeline stage
            </p>
            {props.isLoading ? (
              <Skeleton className="h-20 rounded-xl" />
            ) : (props.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                No properties yet — normal for a new lead.
              </p>
            ) : (
              <div className="rounded-xl border border-card-border overflow-hidden max-h-56 overflow-y-auto">
                {props.data!.map((p, i) => (
                  <div
                    key={p.id}
                    className={`px-3 py-1.5 flex items-center gap-2 text-sm ${
                      i > 0 ? 'border-t border-border/60' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="text-2xs text-muted-foreground shrink-0">
                      {stageOf(p) ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {canEdit && (
            <div className="rounded-xl border border-card-border p-3 space-y-2">
              <Label className="text-xs">Log a call, email, or note</Label>
              <Textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="What happened?"
                rows={2}
                data-testid="crm-note-input"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={nextAction}
                  onChange={e => setNextAction(e.target.value)}
                  placeholder="Next action (optional)"
                  className="h-8 text-sm"
                />
                <Input
                  type="date"
                  value={nextDate}
                  onChange={e => setNextDate(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={!note.trim() || logNote.isPending}
                onClick={() => logNote.mutate()}
                data-testid="crm-note-save"
              >
                {logNote.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                Log it
              </Button>
            </div>
          )}

          <div>
            <p className="text-2xs uppercase tracking-wide text-muted-foreground mb-1.5">History</p>
            {interactions.isLoading ? (
              <Skeleton className="h-20 rounded-xl" />
            ) : (interactions.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing recorded yet. Log a call above, or let Claude sweep your meeting notes in.
              </p>
            ) : (
              <div className="space-y-2">
                {interactions.data!.map(i => (
                  <div key={i.id} className="text-sm border-l-2 border-border pl-2.5">
                    <p className="text-2xs text-muted-foreground">
                      {(i.occurred_at ?? i.created_at).slice(0, 10)} · {i.interaction_type}
                      {i.source && i.source !== 'ui' && ` · via ${i.source}`}
                      {i.created_by && ` · ${i.created_by}`}
                    </p>
                    <p>{i.summary ?? '(no summary)'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── workspace ──────────────────────────────────────────────────────────────

export function CrmWorkspace() {
  const { effectiveUser } = useAuth()
  const canEdit = canEditView('contacts', effectiveUser)
  const { toast } = useToast()
  const qc = useQueryClient()

  const [tab, setTab] = useState<'board' | 'attention'>('board')
  const [showTerminal, setShowTerminal] = useState(false)
  const [openClient, setOpenClient] = useState<Client360 | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [dragging, setDragging] = useState<Client360 | null>(null)

  // 8px before a drag starts, so a plain click still opens the client rather
  // than being swallowed as a micro-drag. Keyboard sensor keeps the board
  // reachable without a pointer.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const clients = useClients()
  const attention = useAttention()
  const stale = useStaleQuotes()

  const clientsById = useMemo(
    () => new Map((clients.data ?? []).map(c => [c.id, c])),
    [clients.data],
  )

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: CLIENT_360_KEY })
    qc.invalidateQueries({ queryKey: ATTENTION_KEY })
  }

  const move = useMutation({
    mutationFn: async ({ client, to }: { client: Client360; to: ClientStage }) => {
      const { error } = await supabase.rpc('crm_set_client_stage', {
        p_contact_id: client.id,
        p_to_stage: to,
      })
      if (error) throw error
      return { client, to }
    },
    // Move the card in the cache immediately. Without this the card snaps back
    // to its old column and then jumps again when the refetch lands, which
    // reads as a failed drag.
    onMutate: async ({ client, to }) => {
      setMovingId(client.id)
      await qc.cancelQueries({ queryKey: CLIENT_360_KEY })
      const previous = qc.getQueryData<Client360[]>(CLIENT_360_KEY)
      qc.setQueryData<Client360[]>(CLIENT_360_KEY, old =>
        (old ?? []).map(c =>
          c.id === client.id ? { ...c, client_stage: to, days_in_stage: 0 } : c,
        ),
      )
      return { previous }
    },
    onSettled: () => setMovingId(null),
    onSuccess: ({ client, to }) => {
      refetchAll()
      // Keep the sheet in sync if it's showing the client that just moved.
      setOpenClient(p => (p && p.id === client.id ? { ...p, client_stage: to } : p))
      toast({ title: `${client.full_name} → ${clientStageLabel(to)}` })
    },
    onError: (e: unknown, _vars, ctx) => {
      // Put the card back where it came from.
      if (ctx?.previous) qc.setQueryData(CLIENT_360_KEY, ctx.previous)
      toast({
        title: 'Could not move',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    },
  })

  function handleDragStart(e: DragStartEvent) {
    const c = (clients.data ?? []).find(x => x.id === String(e.active.id))
    setDragging(c ?? null)
  }

  function handleDragEnd(e: DragEndEvent) {
    setDragging(null)
    const to = e.over?.id ? (String(e.over.id) as ClientStage) : null
    if (!to) return
    const client = (clients.data ?? []).find(x => x.id === String(e.active.id))
    if (!client || client.client_stage === to) return
    move.mutate({ client, to })
  }

  const attentionCount = attention.data?.length ?? 0
  const terminalCount = (clients.data ?? []).filter(c =>
    TERMINAL_CLIENT_STAGES.includes(c.client_stage),
  ).length

  if (clients.isLoading) {
    return (
      <div className="flex gap-3">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-64 w-64 rounded-xl shrink-0" />
        ))}
      </div>
    )
  }

  if (clients.error) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Could not load the CRM"
        description={clients.error instanceof Error ? clients.error.message : 'Unknown error'}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-card-border p-0.5">
          <button
            onClick={() => setTab('board')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              tab === 'board' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            }`}
            data-testid="crm-tab-board"
          >
            Board
          </button>
          <button
            onClick={() => setTab('attention')}
            className={`px-3 py-1 text-xs rounded-md transition-colors inline-flex items-center gap-1.5 ${
              tab === 'attention' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            }`}
            data-testid="crm-tab-attention"
          >
            Needs attention
            {attentionCount > 0 && (
              <span className="rounded-full bg-warning/20 text-warning px-1.5 text-2xs tabular-nums">
                {attentionCount}
              </span>
            )}
          </button>
        </div>

        {tab === 'board' && terminalCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-2xs"
            onClick={() => setShowTerminal(v => !v)}
            data-testid="crm-toggle-terminal"
          >
            {showTerminal ? 'Hide' : 'Show'} nurture / closed ({terminalCount})
          </Button>
        )}
      </div>

      {tab === 'board' ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <Board
            clients={clients.data ?? []}
            canEdit={canEdit}
            showTerminal={showTerminal}
            movingId={movingId}
            onOpen={setOpenClient}
            onMove={(client, to) => move.mutate({ client, to })}
          />
          <DragOverlay>
            {dragging ? (
              <div className="w-64 rounded-xl border border-primary/50 bg-card p-3 shadow-lg cursor-grabbing">
                <CardBody client={dragging} canEdit={false} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <Attention
          rows={attention.data ?? []}
          stale={stale.data ?? []}
          clientsById={clientsById}
          onOpen={setOpenClient}
        />
      )}

      <ClientSheet
        client={openClient}
        canEdit={canEdit}
        onClose={() => setOpenClient(null)}
        onChanged={refetchAll}
      />
    </div>
  )
}
