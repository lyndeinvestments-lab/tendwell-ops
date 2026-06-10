import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { StatusTone, TONE_TEXT } from '@/lib/status-colors'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Search, X, Plus, CheckSquare, Clock, AlertCircle, ChevronDown, ChevronUp,
  MessageSquare, Send, Download, ArrowUpDown, ArrowUp, ArrowDown,
  List, Eye, EyeOff, UserPlus, Users2, Palette, Settings2, Lock, Globe, Trash2,
  Layers, CornerDownRight,
} from 'lucide-react'
import { format, differenceInDays, isPast, isToday } from 'date-fns'
import Papa from 'papaparse'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, useDroppable, useDraggable } from '@dnd-kit/core'

const LIST_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#64748b']

type ViewMode = 'list' | 'board' | 'calendar'
type StatusFilter = 'all' | 'open' | 'To Do' | 'In Progress' | 'Done' | 'Blocked'
type SortKey = 'title' | 'status' | 'priority' | 'due_date' | 'assignee_name' | 'created_at'

const STATUSES = ['To Do', 'In Progress', 'Done', 'Blocked']
const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low']
const CATEGORIES = ['General', 'Cleaning', 'Maintenance', 'Onboarding', 'Client', 'Finance', 'Admin']

// ─── Mention input + comment renderer ──────────────────────────────────────
function MentionInput({
  value, onChange, users, onSubmit, placeholder,
}: {
  value: string
  onChange: (v: string) => void
  users: Array<{ id: number; label: string }>
  onSubmit: () => void
  placeholder?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [tokenStart, setTokenStart] = useState(-1)
  const [activeIdx, setActiveIdx] = useState(0)

  const matches = useMemo(() => {
    const q = query.toLowerCase()
    return users
      .filter(u => u.label && (q === '' || u.label.toLowerCase().includes(q)))
      .slice(0, 6)
  }, [users, query])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    onChange(v)
    const cursor = e.target.selectionStart ?? v.length
    // Find @ token immediately to the left of cursor
    const before = v.slice(0, cursor)
    const m = before.match(/(?:^|\s)@([\w' -]*)$/)
    if (m) {
      setOpen(true)
      setQuery(m[1])
      setTokenStart(cursor - m[1].length - 1) // position of @
      setActiveIdx(0)
    } else {
      setOpen(false)
    }
  }

  function pick(label: string) {
    if (tokenStart < 0) return
    const before = value.slice(0, tokenStart)
    const after = value.slice((inputRef.current?.selectionStart ?? value.length))
    const next = `${before}@${label} ${after}`
    onChange(next)
    setOpen(false)
    requestAnimationFrame(() => {
      const pos = (before + '@' + label + ' ').length
      inputRef.current?.setSelectionRange(pos, pos)
      inputRef.current?.focus()
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (open && matches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (i + 1) % matches.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => (i - 1 + matches.length) % matches.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[activeIdx].label); return }
      if (e.key === 'Escape') { setOpen(false); return }
    }
    if (e.key === 'Enter' && !open) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="h-10 sm:h-8 text-sm sm:text-xs"
      />
      {open && matches.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 sm:right-auto mb-1 z-50 bg-popover border border-border rounded-md shadow-md sm:min-w-[200px] max-h-56 overflow-y-auto py-1">
          {matches.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(u.label) }}
              onTouchStart={(e) => { e.preventDefault(); pick(u.label) }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full text-left px-3 py-2.5 sm:py-1.5 text-sm sm:text-xs ${i === activeIdx ? 'bg-accent text-accent-foreground' : ''}`}
            >
              {u.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CommentBody({ text, userLabels }: { text: string; userLabels: string[] }) {
  if (!text) return null
  if (userLabels.length === 0) return <>{text}</>
  const sorted = [...userLabels].sort((a, b) => b.length - a.length)
  const escaped = sorted.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`@(${escaped.join('|')})(?![a-zA-Z0-9])`, 'gi')
  const parts: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>)
    parts.push(<span key={key++} className="text-info font-medium">{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>)
  return <>{parts}</>
}

const TASK_STATUS_TONES: Record<string, StatusTone> = {
  'To Do': 'neutral',
  'In Progress': 'info',
  'Done': 'success',
  'Blocked': 'destructive',
}

function TaskStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status} tone={TASK_STATUS_TONES[status] ?? 'neutral'} />
}

function PriorityBadge({ priority }: { priority: string }) {
  const cls = {
    'Urgent': TONE_TEXT.destructive,
    'High': TONE_TEXT.warning,
    'Medium': TONE_TEXT.info,
    'Low': TONE_TEXT.neutral,
  }[priority] || ''
  const icon = priority === 'Urgent' ? '🔴' : priority === 'High' ? '🟠' : priority === 'Medium' ? '🔵' : '⚪'
  return <span className={`text-xs ${cls}`}>{icon} {priority}</span>
}

function DueDateLabel({ date }: { date: string | null }) {
  if (!date) return <span className="text-xs text-muted-foreground">No date</span>
  const d = new Date(date + 'T00:00:00')
  const overdue = isPast(d) && !isToday(d)
  const today = isToday(d)
  const daysUntil = differenceInDays(d, new Date())
  const label = today ? 'Today' : overdue ? `${Math.abs(daysUntil)}d overdue` : daysUntil <= 7 ? `${daysUntil}d` : format(d, 'MMM d')
  const cls = overdue ? 'text-destructive font-medium' : today ? 'text-warning font-medium' : 'text-muted-foreground'
  return <span className={`text-xs ${cls}`}>{label}</span>
}

function DroppableColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id })
  return <div ref={setNodeRef} className={`flex-1 space-y-2 overflow-y-auto min-h-[200px] rounded-md p-1 transition-colors ${isOver ? 'bg-primary/5' : ''}`}>{children}</div>
}

function DraggableCard({ task, children }: { task: any; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  return <div ref={setNodeRef} {...listeners} {...attributes} className={`transition-opacity ${isDragging ? 'opacity-30' : ''}`}>{children}</div>
}

function CalendarView({ tasks, onTaskClick }: { tasks: any[]; onTaskClick: (t: any) => void }) {
  const [monthOffset, setMonthOffset] = useState(0)
  const baseDate = new Date()
  baseDate.setMonth(baseDate.getMonth() + monthOffset)
  const year = baseDate.getFullYear()
  const month = baseDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const monthLabel = format(new Date(year, month, 1), 'MMMM yyyy')

  const days = Array.from({ length: 42 }, (_, i) => {
    const day = i - firstDay + 1
    if (day < 1 || day > daysInMonth) return null
    return day
  })

  const tasksByDate = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const t of tasks) {
      if (!t.due_date) continue
      const d = t.due_date // YYYY-MM-DD
      if (!map[d]) map[d] = []
      map[d].push(t)
    }
    return map
  }, [tasks])

  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="flex-1">
      <div className="flex items-center justify-between mb-3">
        <Button variant="outline" size="sm" onClick={() => setMonthOffset(m => m - 1)}>&lt;</Button>
        <span className="text-sm font-medium">{monthLabel}</span>
        <Button variant="outline" size="sm" onClick={() => setMonthOffset(m => m + 1)}>&gt;</Button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border border-border">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="bg-muted px-2 py-1.5 text-xs font-medium text-muted-foreground text-center">{d}</div>
        ))}
        {days.map((day, i) => {
          if (day === null) return <div key={i} className="bg-background min-h-[80px]" />
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const dayTasks = tasksByDate[dateStr] || []
          const isToday = dateStr === today
          return (
            <div key={i} className={`bg-background min-h-[80px] p-1 ${isToday ? 'ring-2 ring-primary ring-inset' : ''}`}>
              <span className={`text-xs ${isToday ? 'font-bold text-primary' : 'text-muted-foreground'}`}>{day}</span>
              <div className="mt-0.5 space-y-0.5">
                {dayTasks.slice(0, 3).map((t: any) => (
                  <button key={t.id} onClick={() => onTaskClick(t)}
                    className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${
                      t.status === 'Done' ? 'bg-success/10 text-success line-through' :
                      t.priority === 'Urgent' ? 'bg-destructive/10 text-destructive' :
                      'bg-primary/10 text-primary'
                    }`}>
                    {t.title}
                  </button>
                ))}
                {dayTasks.length > 3 && <span className="text-xs text-muted-foreground">+{dayTasks.length - 3} more</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ReparentPopover({
  open, onOpenChange, trigger, taskIds, candidates, onPickExisting, onCreateParent, align = 'start',
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  trigger: React.ReactNode
  taskIds: string[]
  candidates: any[]
  onPickExisting: (parentId: string) => void
  onCreateParent: (title: string) => void
  align?: 'start' | 'center' | 'end'
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [query, setQuery] = useState('')
  const [newTitle, setNewTitle] = useState('')

  useEffect(() => {
    if (!open) {
      setMode('existing')
      setQuery('')
      setNewTitle('')
    }
  }, [open])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = candidates.filter((t: any) => !taskIds.includes(t.id))
    if (!q) return pool.slice(0, 20)
    return pool.filter((t: any) => (t.title || '').toLowerCase().includes(q)).slice(0, 20)
  }, [candidates, taskIds, query])

  const countLabel = taskIds.length === 1 ? '1 task' : `${taskIds.length} tasks`

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-80 p-0" align={align}>
        <div className="flex border-b border-border">
          <button
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${mode === 'existing' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setMode('existing')}
          >Existing task</button>
          <button
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${mode === 'new' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setMode('new')}
          >New parent</button>
        </div>
        {mode === 'existing' ? (
          <div className="p-2">
            <Input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search tasks…"
              className="h-8 text-xs mb-2"
            />
            <div className="max-h-60 overflow-y-auto">
              {matches.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  {query ? 'No matching top-level tasks' : 'No eligible parents available'}
                </p>
              ) : matches.map((t: any) => (
                <button
                  key={t.id}
                  onClick={() => onPickExisting(t.id)}
                  className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent"
                >
                  <div className="font-medium truncate">{t.title}</div>
                  {t.property_name && <div className="text-muted-foreground text-2xs truncate">{t.property_name}</div>}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            <label className="text-xs font-medium text-muted-foreground block">Parent task title</label>
            <Input
              autoFocus
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="e.g. Onboarding — 123 Main St"
              className="h-8 text-xs"
              onKeyDown={e => { if (e.key === 'Enter' && newTitle.trim()) onCreateParent(newTitle.trim()) }}
            />
            <Button
              size="sm"
              className="w-full h-8 text-xs"
              disabled={!newTitle.trim()}
              onClick={() => onCreateParent(newTitle.trim())}
            >
              Create & move {countLabel}
            </Button>
            <p className="text-2xs text-muted-foreground">List, priority, and category inherit from the first selected task. You can edit details after creation.</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default function TasksPage() {
  usePageTitle('Tasks')
  const { toast } = useToast()
  const { effectiveUser } = useAuth()
  const qc = useQueryClient()
  const canEdit = canEditView('tasks', effectiveUser)

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'Urgent' | 'High' | 'Medium' | 'Low'>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all') // 'all' | 'unassigned' | <label>
  const [groupBy, setGroupBy] = useState<'none' | 'status' | 'priority' | 'assignee' | 'property'>('none')
  const [sortKey, setSortKey] = useState<SortKey>('due_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [addOpen, setAddOpen] = useState(false)
  const [detailTask, setDetailTask] = useState<any>(null)
  const [commentText, setCommentText] = useState('')
  const [activeListId, setActiveListId] = useState<string>('global')
  const [listDialogOpen, setListDialogOpen] = useState(false)
  const [manageList, setManageList] = useState<any>(null)
  const [newListName, setNewListName] = useState('')
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [reparentOpen, setReparentOpen] = useState(false)
  const [detailReparentOpen, setDetailReparentOpen] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  // New task form
  const [newForm, setNewForm] = useState({
    title: '', description: '', status: 'To Do', priority: 'Medium',
    due_date: '', assignee_name: '', property_name: '', category: 'General',
    list_id: '',
  })

  // ─── Users ────────────────────────────────────────────────────────────────
  const { data: users } = useQuery({
    queryKey: ['/supabase/task-users'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_users').select('id, label, role, google_email')
      if (error) throw error
      return data || []
    },
  })

  // ─── Lists ────────────────────────────────────────────────────────────────
  const { data: myMemberships } = useQuery({
    queryKey: ['/supabase/task-list-members', effectiveUser?.id],
    enabled: !!effectiveUser,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_list_members')
        .select('*, task_lists(*)')
        .eq('user_id', Number(effectiveUser!.id))
      if (error) throw error
      return data || []
    },
  })

  // Also fetch public lists the user can see (admins see type='public')
  const { data: publicLists } = useQuery({
    queryKey: ['/supabase/task-lists-public'],
    enabled: effectiveUser?.role === 'admin',
    queryFn: async () => {
      const { data, error } = await supabase.from('task_lists').select('*').eq('type', 'public')
      if (error) throw error
      return data || []
    },
  })

  // Merged list of lists the user can see
  const visibleLists = useMemo(() => {
    const byId = new Map<string, any>()
    for (const m of (myMemberships || [])) {
      if (m.task_lists) {
        byId.set(m.task_lists.id, { ...m.task_lists, membership: m })
      }
    }
    // Add public lists for admins if not already member
    if (effectiveUser?.role === 'admin') {
      for (const l of (publicLists || [])) {
        if (!byId.has(l.id)) byId.set(l.id, { ...l, membership: null })
      }
    }
    return Array.from(byId.values()).sort((a, b) => {
      // Private first, then public, then shared
      const order = { private: 0, public: 1, shared: 2 }
      return (order[a.type as keyof typeof order] ?? 3) - (order[b.type as keyof typeof order] ?? 3)
    })
  }, [myMemberships, publicLists, effectiveUser])

  // Auto-setup: ensure user has a private list
  useEffect(() => {
    if (!effectiveUser || !myMemberships) return
    const hasPrivate = myMemberships.some(m => m.task_lists?.type === 'private')
    if (!hasPrivate) {
      (async () => {
        const { data: list } = await supabase.from('task_lists').insert({ name: 'My Tasks', type: 'private', created_by: Number(effectiveUser.id) }).select().single()
        if (list) {
          await supabase.from('task_list_members').insert({ list_id: list.id, user_id: Number(effectiveUser.id), role: 'owner', color: '#6366f1' })
          qc.invalidateQueries({ queryKey: ['/supabase/task-list-members'] })
        }
      })()
    }
  }, [effectiveUser, myMemberships])

  // Active list ID for filtering (default to first visible list)
  const resolvedListId = activeListId === 'global' ? 'global' : activeListId
  const activeList = visibleLists.find(l => l.id === resolvedListId) || null

  // ─── Tasks query (filtered by list or global) ────────────────────────────
  const { data: tasks, isLoading, isError, refetch } = useQuery({
    queryKey: ['/supabase/tasks', resolvedListId, visibleLists.map(l => l.id).join(',')],
    queryFn: async () => {
      let query = supabase.from('tasks').select('*').order('created_at', { ascending: false })
      if (resolvedListId !== 'global') {
        query = query.eq('list_id', resolvedListId)
      } else {
        // Global: only tasks in lists the user is a member of
        const listIds = visibleLists.map(l => l.id)
        if (listIds.length === 0) return [] // no lists = no tasks visible
        query = query.in('list_id', listIds)
      }
      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    enabled: visibleLists.length > 0,
  })

  // ─── Task assignees + watchers for detail view ────────────────────────────
  const { data: taskAssignees } = useQuery({
    queryKey: ['/supabase/task-assignees', detailTask?.id],
    enabled: !!detailTask,
    queryFn: async () => {
      const { data } = await supabase
        .from('task_assignees')
        .select('*, user:app_users!task_assignees_user_id_fkey(label)')
        .eq('task_id', detailTask.id)
        .order('sort_order')
      return data || []
    },
  })

  const { data: taskWatchers } = useQuery({
    queryKey: ['/supabase/task-watchers', detailTask?.id],
    enabled: !!detailTask,
    queryFn: async () => {
      const { data } = await supabase
        .from('task_watchers')
        .select('*, user:app_users!task_watchers_user_id_fkey(label)')
        .eq('task_id', detailTask.id)
      return data || []
    },
  })

  // ─── List members for manage dialog ───────────────────────────────────────
  const { data: manageMembers, isLoading: membersLoading } = useQuery({
    queryKey: ['/supabase/list-members', manageList?.id],
    enabled: !!manageList,
    queryFn: async () => {
      const { data } = await supabase
        .from('task_list_members')
        .select('*, user:app_users!task_list_members_user_id_fkey(label, role)')
        .eq('list_id', manageList.id)
      return data || []
    },
  })

  const { data: comments, isLoading: commentsLoading } = useQuery({
    queryKey: ['/supabase/task-comments', detailTask?.id],
    enabled: !!detailTask,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_comments')
        .select('*')
        .eq('task_id', detailTask.id)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
  })

  // ─── Stats ────────────────────────────────────────────────────────────────
  // KPIs reflect top-level tasks only (matching the visible list). Counting
  // subtasks made the "In Progress" tile inflate vs the rendered table —
  // production QA flagged the mismatch.
  const stats = useMemo(() => {
    if (!tasks) return { total: 0, todo: 0, inProgress: 0, done: 0, overdue: 0 }
    const today = new Date().toISOString().split('T')[0]
    const topLevel = tasks.filter((t: any) => !t.parent_task_id)
    return {
      total: topLevel.length,
      todo: topLevel.filter((t: any) => t.status === 'To Do').length,
      inProgress: topLevel.filter((t: any) => t.status === 'In Progress').length,
      done: topLevel.filter((t: any) => t.status === 'Done').length,
      overdue: topLevel.filter((t: any) => t.due_date && t.due_date < today && t.status !== 'Done').length,
    }
  }, [tasks])

  // ─── Filtering & sorting ──────────────────────────────────────────────────
  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'created_at' ? 'desc' : 'asc') }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 inline ml-1 opacity-40" />
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3 inline ml-1" /> : <ArrowDown className="w-3 h-3 inline ml-1" />
  }

  // Build subtask lookup
  const subtasksByParent = useMemo(() => {
    if (!tasks) return new Map<string, any[]>()
    const map = new Map<string, any[]>()
    for (const t of tasks) {
      if (t.parent_task_id) {
        if (!map.has(t.parent_task_id)) map.set(t.parent_task_id, [])
        map.get(t.parent_task_id)!.push(t)
      }
    }
    return map
  }, [tasks])

  const filtered = useMemo(() => {
    if (!tasks) return []
    // Only show top-level tasks (no parent) in the main list
    let result = tasks.filter((t: any) => {
      if (t.parent_task_id) return false // subtasks shown inline
      const matchSearch = !search.trim() || [t.title, t.description, t.assignee_name, t.property_name].some(v => v?.toLowerCase().includes(search.toLowerCase()))
      // For parents with subtasks, also match if any subtask matches search
      const subs = subtasksByParent.get(t.id) || []
      const subMatchSearch = !search.trim() || subs.some((s: any) => [s.title, s.assignee_name].some(v => v?.toLowerCase().includes(search.toLowerCase())))
      const matchStatus = statusFilter === 'all' ? true : statusFilter === 'open' ? t.status !== 'Done' : t.status === statusFilter
      const matchPriority = priorityFilter === 'all' ? true : t.priority === priorityFilter
      const matchAssignee =
        assigneeFilter === 'all' ? true
        : assigneeFilter === 'unassigned' ? !t.assignee_name
        : t.assignee_name === assigneeFilter
      return (matchSearch || subMatchSearch) && matchStatus && matchPriority && matchAssignee
    })
    result = [...result].sort((a: any, b: any) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'priority') {
        const order = { Urgent: 0, High: 1, Medium: 2, Low: 3 }
        return (((order as any)[a.priority] ?? 2) - ((order as any)[b.priority] ?? 2)) * dir
      }
      const av = a[sortKey] || ''
      const bv = b[sortKey] || ''
      if (sortKey === 'due_date') {
        if (!av && !bv) return 0
        if (!av) return 1
        if (!bv) return -1
      }
      return av.localeCompare(bv) * dir
    })
    return result
  }, [tasks, search, statusFilter, priorityFilter, assigneeFilter, sortKey, sortDir, subtasksByParent])

  // Distinct assignee names from current task set (top-level only) for filter dropdown.
  const assigneeOptions = useMemo(() => {
    if (!tasks) return [] as string[]
    const set = new Set<string>()
    for (const t of tasks) {
      if (t.parent_task_id) continue
      if (t.assignee_name) set.add(t.assignee_name)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [tasks])

  // Group the filtered task list into buckets when groupBy is set. Each bucket
  // becomes a collapsible header in the list view. Sort order within each
  // bucket follows the existing sortKey/sortDir.
  const groupedFiltered = useMemo<Array<{ key: string; label: string; tasks: any[] }>>(() => {
    if (groupBy === 'none') return [{ key: 'all', label: '', tasks: filtered }]
    const buckets = new Map<string, { label: string; tasks: any[] }>()
    function bucketFor(t: any): { key: string; label: string } {
      if (groupBy === 'status') return { key: t.status || 'No Status', label: t.status || 'No Status' }
      if (groupBy === 'priority') return { key: t.priority || 'No Priority', label: t.priority || 'No Priority' }
      if (groupBy === 'assignee') return t.assignee_name ? { key: t.assignee_name, label: t.assignee_name } : { key: '__unassigned__', label: 'Unassigned' }
      if (groupBy === 'property') return t.property_name ? { key: t.property_name, label: t.property_name } : { key: '__no_property__', label: 'No Property' }
      return { key: 'all', label: '' }
    }
    for (const t of filtered) {
      const b = bucketFor(t)
      if (!buckets.has(b.key)) buckets.set(b.key, { label: b.label, tasks: [] })
      buckets.get(b.key)!.tasks.push(t)
    }
    // Stable, deterministic group ordering for status/priority — others sort alpha.
    const STATUS_ORDER = ['To Do', 'In Progress', 'Blocked', 'Done', 'No Status']
    const PRIORITY_ORDER = ['Urgent', 'High', 'Medium', 'Low', 'No Priority']
    const entries = Array.from(buckets.entries()).map(([key, v]) => ({ key, label: v.label, tasks: v.tasks }))
    if (groupBy === 'status') {
      entries.sort((a, b) => STATUS_ORDER.indexOf(a.key) - STATUS_ORDER.indexOf(b.key))
    } else if (groupBy === 'priority') {
      entries.sort((a, b) => PRIORITY_ORDER.indexOf(a.key) - PRIORITY_ORDER.indexOf(b.key))
    } else {
      entries.sort((a, b) => a.label.localeCompare(b.label))
    }
    return entries
  }, [filtered, groupBy])

  function toggleExpand(taskId: string) {
    setExpandedTasks(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  function getSubtaskProgress(taskId: string): { done: number; total: number } {
    const subs = subtasksByParent.get(taskId) || []
    return { done: subs.filter((s: any) => s.status === 'Done').length, total: subs.length }
  }

  // ─── Board view data ──────────────────────────────────────────────────────
  const boardData = useMemo(() => {
    if (!tasks) return {}
    const board: Record<string, any[]> = {}
    for (const s of STATUSES) board[s] = []
    for (const t of tasks) {
      const matchSearch = !search.trim() || [t.title, t.assignee_name].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
      if (matchSearch) (board[t.status] || board['To Do']).push(t)
    }
    return board
  }, [tasks, search])

  // ─── Mutations ────────────────────────────────────────────────────────────
  const { mutate: createTask, isPending: creating } = useGuardedMutation('tasks', {
    mutationFn: async () => {
      const targetListId = newForm.list_id || (resolvedListId !== 'global' ? resolvedListId : visibleLists.find(l => l.type === 'private')?.id || visibleLists[0]?.id || null)
      const { error } = await supabase.from('tasks').insert({
        ...newForm,
        due_date: newForm.due_date || null,
        assignee_name: newForm.assignee_name || null,
        property_name: newForm.property_name || null,
        created_by: effectiveUser?.label || null,
        list_id: targetListId,
      })
      if (error) throw error
      try {
        const { notify } = await import('@/lib/notify')
        const detailBits = [
          `Priority: ${newForm.priority}`,
          `Assigned to: ${newForm.assignee_name || 'Unassigned'}`,
          newForm.due_date ? `Due: ${newForm.due_date}` : null,
          newForm.property_name ? `Property: ${newForm.property_name}` : null,
        ].filter(Boolean) as string[]
        notify({
          eventType: 'task_assigned',
          subject: `New task: ${newForm.title}`,
          bodyLines: [
            newForm.title,
            ...(newForm.description ? [newForm.description] : []),
            detailBits.join(' · '),
          ],
          ctaUrl: 'https://www.tendwellcleaning.com/#/tasks',
          ctaLabel: 'Open Tasks',
          meta: { assignee: newForm.assignee_name, priority: newForm.priority },
        })
      } catch { /* ignore */ }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
      toast({ title: 'Task created' })
      setAddOpen(false)
      setNewForm({ title: '', description: '', status: 'To Do', priority: 'Medium', due_date: '', assignee_name: '', property_name: '', category: 'General', list_id: '' })
    },
    onError: (error: any) => toast({ title: 'Failed to create task', description: error?.message, variant: 'destructive' }),
  })

  const { mutate: updateTask } = useGuardedMutation('tasks', {
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase.from('tasks').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
      toast({ title: 'Task updated' })
    },
    onError: (error: any) => toast({ title: 'Update failed', description: error?.message, variant: 'destructive' }),
  })

  const { mutate: addComment, isPending: commenting } = useGuardedMutation('tasks', {
    mutationFn: async () => {
      const text = commentText.trim()
      const { error } = await supabase.from('task_comments').insert({
        task_id: detailTask.id,
        author: effectiveUser?.label || 'Unknown',
        content: text,
      })
      if (error) throw error
      // Parse mentions and notify
      try {
        const { parseMentions, notify } = await import('@/lib/notify')
        const mentionedIds = parseMentions(text, (users || []).map((u: any) => ({ id: u.id, label: u.label })))
        const myId = effectiveUser?.id
        const targets = mentionedIds.filter(id => String(id) !== String(myId))
        if (targets.length > 0) {
          notify({
            eventType: 'task_mention',
            subject: `${effectiveUser?.label || 'Someone'} mentioned you on "${detailTask.title}"`,
            bodyLines: [
              `${effectiveUser?.label || 'Someone'} mentioned you in a comment on "${detailTask.title}".`,
            ],
            quoteText: text,
            ctaUrl: 'https://www.tendwellcleaning.com/#/tasks',
            ctaLabel: 'Open Task',
            targetUserIds: targets as number[],
            meta: { task_id: detailTask.id },
          })
        }
      } catch { /* ignore */ }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/task-comments', detailTask?.id] })
      setCommentText('')
    },
    onError: (error: any) => toast({ title: 'Failed to add comment', description: error?.message, variant: 'destructive' }),
  })

  const { mutate: deleteTask } = useGuardedMutation('tasks', {
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
      toast({ title: 'Task deleted' })
      setDetailTask(null)
    },
    onError: (error: any) => toast({ title: 'Delete failed', description: error?.message, variant: 'destructive' }),
  })

  // ─── Reparenting: move tasks under an existing or new parent ──────────────
  const { mutate: reparentToExisting } = useGuardedMutation('tasks', {
    mutationFn: async ({ taskIds, parentId }: { taskIds: string[]; parentId: string }) => {
      const parent = tasks?.find((t: any) => t.id === parentId)
      if (!parent) throw new Error('Parent task not found')
      const { error } = await supabase
        .from('tasks')
        .update({ parent_task_id: parentId, list_id: parent.list_id, updated_at: new Date().toISOString() })
        .in('id', taskIds)
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
      setSelectedIds(new Set())
      setReparentOpen(false)
      setDetailReparentOpen(false)
      setExpandedTasks(prev => new Set(prev).add(vars.parentId))
      toast({ title: vars.taskIds.length > 1 ? `Moved ${vars.taskIds.length} tasks under parent` : 'Moved task under parent' })
    },
    onError: (err: any) => toast({ title: 'Reparent failed', description: err?.message, variant: 'destructive' }),
  })

  const { mutate: reparentToNew } = useGuardedMutation('tasks', {
    mutationFn: async ({ taskIds, title }: { taskIds: string[]; title: string }) => {
      if (!tasks) throw new Error('Tasks not loaded')
      const first = tasks.find((t: any) => taskIds.includes(t.id))
      if (!first) throw new Error('No selected task found')
      const { data: parent, error: insertErr } = await supabase
        .from('tasks')
        .insert({
          title: title.trim(),
          status: 'To Do',
          priority: first.priority || 'Medium',
          category: first.category || 'General',
          list_id: first.list_id,
          created_by: effectiveUser?.label || null,
        })
        .select()
        .single()
      if (insertErr || !parent) throw insertErr || new Error('Parent creation failed')
      const { error: updateErr } = await supabase
        .from('tasks')
        .update({ parent_task_id: parent.id, list_id: parent.list_id, updated_at: new Date().toISOString() })
        .in('id', taskIds)
      if (updateErr) throw updateErr
      return parent.id as string
    },
    onSuccess: (parentId, vars) => {
      qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
      setSelectedIds(new Set())
      setReparentOpen(false)
      setDetailReparentOpen(false)
      if (parentId) setExpandedTasks(prev => new Set(prev).add(parentId))
      toast({ title: `Created parent with ${vars.taskIds.length} ${vars.taskIds.length === 1 ? 'subtask' : 'subtasks'}` })
    },
    onError: (err: any) => toast({ title: 'Failed to create parent', description: err?.message, variant: 'destructive' }),
  })

  // A task is eligible to become a subtask if it's not already a subtask and has no children.
  const isEligibleSubtask = useCallback((task: any) => {
    if (!task) return false
    if (task.parent_task_id) return false
    const subs = subtasksByParent.get(task.id) || []
    return subs.length === 0
  }, [subtasksByParent])

  // Candidate parents for a given set of selected task IDs.
  const parentCandidates = useMemo(() => {
    if (!tasks) return []
    return tasks.filter((t: any) =>
      !t.parent_task_id && !selectedIds.has(t.id)
    )
  }, [tasks, selectedIds])

  // ─── List management ───────────────────────────────────────────────────────
  async function createList() {
    if (!newListName.trim()) return
    const { data: list } = await supabase.from('task_lists').insert({
      name: newListName.trim(), type: 'shared', created_by: effectiveUser?.id ? Number(effectiveUser.id) : null,
    }).select().single()
    if (list) {
      await supabase.from('task_list_members').insert({ list_id: list.id, user_id: Number(effectiveUser!.id), role: 'owner', color: LIST_COLORS[visibleLists.length % LIST_COLORS.length] })
      qc.invalidateQueries({ queryKey: ['/supabase/task-list-members'] })
      toast({ title: `List "${newListName.trim()}" created` })
      setNewListName('')
      setListDialogOpen(false)
      setActiveListId(list.id)
    }
  }

  async function addListMember(listId: string, userId: number) {
    const { error } = await supabase.from('task_list_members').upsert({ list_id: listId, user_id: userId, role: 'member', added_by: effectiveUser?.id ? Number(effectiveUser.id) : null }, { onConflict: 'list_id,user_id' })
    if (error) { toast({ title: 'Failed to add member', description: error.message, variant: 'destructive' }); return }
    await qc.invalidateQueries({ queryKey: ['/supabase/list-members', listId] })
    await qc.invalidateQueries({ queryKey: ['/supabase/task-list-members'] })
    // Notify added user
    try {
      const { notify } = await import('@/lib/notify')
      const addedUser = users?.find((u: any) => u.id === userId)
      if (addedUser) {
        const list = visibleLists.find(l => l.id === listId)
        notify({
          eventType: 'task_assigned',
          subject: `You've been added to "${list?.name || 'a task list'}"`,
          bodyLines: [
            `${effectiveUser?.label || 'Someone'} added you to the task list "${list?.name || 'Untitled'}".`,
          ],
          ctaUrl: 'https://www.tendwellcleaning.com/#/tasks',
          ctaLabel: 'Open Tasks',
          targetUserIds: [userId],
        })
      }
    } catch { /* ignore */ }
    toast({ title: 'Member added' })
  }

  async function removeListMember(listId: string, userId: number) {
    await supabase.from('task_list_members').delete().eq('list_id', listId).eq('user_id', userId)
    await qc.invalidateQueries({ queryKey: ['/supabase/list-members', listId] })
    await qc.invalidateQueries({ queryKey: ['/supabase/task-list-members'] })
    toast({ title: 'Member removed' })
  }

  async function updateListColor(listId: string, color: string) {
    await supabase.from('task_list_members').update({ color }).eq('list_id', listId).eq('user_id', Number(effectiveUser!.id))
    qc.invalidateQueries({ queryKey: ['/supabase/task-list-members'] })
  }

  async function deleteList(listId: string) {
    if (!confirm('Delete this list? Tasks in it will become unassigned.')) return
    await supabase.from('tasks').update({ list_id: null }).eq('list_id', listId)
    await supabase.from('task_lists').delete().eq('id', listId)
    qc.invalidateQueries({ queryKey: ['/supabase/task-list-members'] })
    qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
    setActiveListId('global')
    setManageList(null)
    toast({ title: 'List deleted' })
  }

  // ─── Assignees / watchers ─────────────────────────────────────────────────
  async function toggleAssignee(taskId: string, userId: number, isPrimary: boolean) {
    const existing = taskAssignees?.find((a: any) => a.user_id === userId)
    if (existing) {
      await supabase.from('task_assignees').delete().eq('id', existing.id)
    } else {
      if (isPrimary) {
        await supabase.from('task_assignees').update({ role: 'secondary' }).eq('task_id', taskId).eq('role', 'primary')
      }
      await supabase.from('task_assignees').insert({
        task_id: taskId, user_id: userId, role: isPrimary ? 'primary' : 'secondary',
        sort_order: isPrimary ? 0 : (taskAssignees?.length || 0) + 1,
      })
    }
    // Keep legacy tasks.assignee_name in sync with the current primary so the
    // list column matches what the detail panel shows.
    const { data: freshAssignees } = await supabase
      .from('task_assignees')
      .select('user_id, role, user:app_users!task_assignees_user_id_fkey(label)')
      .eq('task_id', taskId)
    const primary = (freshAssignees || []).find((a: any) => a.role === 'primary')
    const primaryLabel = (primary?.user as any)?.label ?? null
    await supabase.from('tasks').update({ assignee_name: primaryLabel }).eq('id', taskId)

    qc.invalidateQueries({ queryKey: ['/supabase/task-assignees', taskId] })
    qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
  }

  async function toggleWatcher(taskId: string, userId: number) {
    const existing = taskWatchers?.find((w: any) => w.user_id === userId)
    if (existing) {
      await supabase.from('task_watchers').delete().eq('id', existing.id)
    } else {
      await supabase.from('task_watchers').insert({ task_id: taskId, user_id: userId })
    }
    qc.invalidateQueries({ queryKey: ['/supabase/task-watchers', taskId] })
  }

  async function moveTaskToList(taskId: string, listId: string) {
    await supabase.from('tasks').update({ list_id: listId, updated_at: new Date().toISOString() }).eq('id', taskId)
    qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
    toast({ title: 'Task moved' })
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over) return
    const newStatus = String(over.id)
    if (!STATUSES.includes(newStatus)) return
    const taskId = String(active.id)
    updateTask({ id: taskId, updates: { status: newStatus, completed_at: newStatus === 'Done' ? new Date().toISOString() : null } })
  }

  function exportCsv() {
    if (!filtered.length) return
    const rows = filtered.map((t: any) => ({
      Title: t.title, Description: t.description || '', Status: t.status,
      Priority: t.priority, 'Due Date': t.due_date || '', Assignee: t.assignee_name || '',
      Property: t.property_name || '', Category: t.category || '', Created: t.created_at,
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `tasks-${new Date().toISOString().split('T')[0]}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const thCls = 'text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap'

  return (
    <PageContainer className="h-full flex flex-col">
      {/* List selector bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button onClick={() => setActiveListId('global')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap flex-shrink-0 ${
            resolvedListId === 'global' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-muted-foreground hover:bg-muted'
          }`}>
          <Globe className="w-3 h-3" /> All My Tasks
        </button>
        {visibleLists.map(l => {
          const color = l.membership?.color || '#6366f1'
          const isActive = resolvedListId === l.id
          const icon = l.type === 'private' ? <Lock className="w-3 h-3" /> : l.type === 'public' ? <Globe className="w-3 h-3" /> : <Users2 className="w-3 h-3" />
          return (
            <button key={l.id} onClick={() => setActiveListId(l.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap flex-shrink-0 ${
                isActive ? 'text-white border-transparent' : 'bg-background border-border text-muted-foreground hover:bg-muted'
              }`}
              style={isActive ? { backgroundColor: color, borderColor: color } : undefined}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: isActive ? '#fff' : color }} />
              {icon} {l.name}
              {l.membership && isActive && l.type !== 'private' && (
                <button onClick={(e) => { e.stopPropagation(); setManageList(l) }} className="ml-1 opacity-70 hover:opacity-100"><Settings2 className="w-3 h-3" /></button>
              )}
            </button>
          )
        })}
        <button onClick={() => setListDialogOpen(true)} className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md border border-dashed border-border hover:bg-muted flex-shrink-0">
          <Plus className="w-3 h-3" /> New List
        </button>
      </div>

      {/* Header */}
      <PageHeader
        title={resolvedListId === 'global' ? 'All My Tasks' : activeList?.name || 'Tasks'}
        subtitle={
          <>
            {stats.overdue > 0 && <span className="text-destructive font-medium">{stats.overdue} overdue</span>}
            {stats.overdue > 0 && ' · '}
            {stats.inProgress} in progress · {stats.todo} to do · {stats.done} done
          </>
        }
        actions={
          <>
            <div className="flex items-center border rounded-md overflow-hidden">
              {(['list', 'board', 'calendar'] as ViewMode[]).map(v => (
                <button key={v} onClick={() => setViewMode(v)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === v ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>
                  {v === 'list' ? 'List' : v === 'board' ? 'Board' : 'Calendar'}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={exportCsv} disabled={!filtered.length}>
              <Download className="w-3.5 h-3.5" /> Export
            </Button>
            {canEdit && (
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => {
                const defaultListId = resolvedListId !== 'global'
                  ? resolvedListId
                  : (visibleLists.find(l => l.type === 'private')?.id || visibleLists[0]?.id || '')
                setNewForm(f => ({ ...f, list_id: defaultListId }))
                setAddOpen(true)
              }}>
                <Plus className="w-3.5 h-3.5" /> New Task
              </Button>
            )}
          </>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'To Do', count: stats.todo, filter: 'To Do' as StatusFilter, cls: '' },
          { label: 'In Progress', count: stats.inProgress, filter: 'In Progress' as StatusFilter, cls: TONE_TEXT.info },
          { label: 'Overdue', count: stats.overdue, filter: 'all' as StatusFilter, cls: TONE_TEXT.destructive },
          { label: 'Done', count: stats.done, filter: 'Done' as StatusFilter, cls: TONE_TEXT.success },
        ].map(c => (
          <Card key={c.label} className="cursor-pointer shadow-xs hover:bg-muted/30 hover:shadow-sm transition-all" onClick={() => { setStatusFilter(c.filter) }}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className={`text-lg font-semibold ${c.cls}`}>{c.count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['open', 'all', ...STATUSES] as StatusFilter[]).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-muted-foreground hover:bg-muted'}`}>
            {s === 'open' ? `Open (${stats.total - stats.done})` : s === 'all' ? `All (${stats.total})` : s}
          </button>
        ))}
        <div className="h-5 w-px bg-border mx-1" />
        <select
          value={priorityFilter}
          onChange={e => setPriorityFilter(e.target.value as any)}
          className="h-7 px-2 text-xs rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
          aria-label="Filter by priority"
        >
          <option value="all">Priority: All</option>
          <option value="Urgent">Urgent</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
        <select
          value={assigneeFilter}
          onChange={e => setAssigneeFilter(e.target.value)}
          className="h-7 px-2 text-xs rounded-md border border-border bg-background text-muted-foreground hover:text-foreground max-w-[160px] truncate"
          aria-label="Filter by assignee"
        >
          <option value="all">Assignee: All</option>
          <option value="unassigned">Unassigned</option>
          {assigneeOptions.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select
          value={groupBy}
          onChange={e => setGroupBy(e.target.value as any)}
          className="h-7 px-2 text-xs rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
          aria-label="Group by"
        >
          <option value="none">Group: None</option>
          <option value="status">Status</option>
          <option value="priority">Priority</option>
          <option value="assignee">Assignee</option>
          <option value="property">Property</option>
        </select>
        {(priorityFilter !== 'all' || assigneeFilter !== 'all' || groupBy !== 'none') && (
          <button
            onClick={() => { setPriorityFilter('all'); setAssigneeFilter('all'); setGroupBy('none') }}
            className="text-2xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Reset
          </button>
        )}
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input type="search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 pr-7 h-8 w-full sm:w-56 text-sm" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>

      {/* ═══ LIST VIEW ═══ */}
      {isError && <ErrorState onRetry={() => refetch()} />}
      {!isError && viewMode === 'list' && (
        <div className="overflow-auto flex-1 rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted border-b border-border z-20">
              <tr>
                {canEdit && (
                  <th className="sticky left-0 z-20 bg-muted w-8 py-2 pl-3 pr-1">
                    {(() => {
                      const eligibleFiltered = filtered.filter((t: any) => isEligibleSubtask(t))
                      const allSelected = eligibleFiltered.length > 0 && eligibleFiltered.every((t: any) => selectedIds.has(t.id))
                      const someSelected = selectedIds.size > 0 && !allSelected
                      return (
                        <Checkbox
                          checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                          onCheckedChange={(v) => {
                            if (v) {
                              setSelectedIds(new Set(eligibleFiltered.map((t: any) => t.id)))
                            } else {
                              setSelectedIds(new Set())
                            }
                          }}
                          aria-label="Select all eligible tasks"
                        />
                      )
                    })()}
                  </th>
                )}
                <th className={`${thCls} ${canEdit ? '' : 'sticky left-0 z-20'} bg-muted`} onClick={() => toggleSort('title')}>Task <SortIcon col="title" /></th>
                <th className={thCls} onClick={() => toggleSort('status')}>Status <SortIcon col="status" /></th>
                <th className={thCls} onClick={() => toggleSort('priority')}>Priority <SortIcon col="priority" /></th>
                <th className={thCls} onClick={() => toggleSort('due_date')}>Due <SortIcon col="due_date" /></th>
                <th className={thCls} onClick={() => toggleSort('assignee_name')}>Assignee <SortIcon col="assignee_name" /></th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Category</th>
                {canEdit && <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Action</th>}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(6)].map((_, i) => <tr key={i} className="border-b border-border/50">{[...Array(canEdit ? 8 : 6)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}</tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={canEdit ? 8 : 6}><EmptyState icon={CheckSquare} title="No tasks" description={search || statusFilter !== 'all' ? 'No tasks match your filters.' : 'Create your first task to get started.'} action={canEdit ? { label: 'New Task', onClick: () => {
                  const defaultListId = resolvedListId !== 'global' ? resolvedListId : (visibleLists.find(l => l.type === 'private')?.id || visibleLists[0]?.id || '')
                  setNewForm(f => ({ ...f, list_id: defaultListId }))
                  setAddOpen(true)
                } } : undefined} /></td></tr>
              ) : (() => {
                // When a Group By is active we render a small header row
                // before each bucket. Tracks the previously emitted group key
                // across the iteration so headers only appear at transitions.
                let lastGroupKey: string | null = null
                function groupKeyOf(t: any): string | null {
                  if (groupBy === 'none') return null
                  if (groupBy === 'status') return t.status || 'No Status'
                  if (groupBy === 'priority') return t.priority || 'No Priority'
                  if (groupBy === 'assignee') return t.assignee_name || '__unassigned__'
                  if (groupBy === 'property') return t.property_name || '__no_property__'
                  return null
                }
                function groupLabelOf(key: string): string {
                  if (key === '__unassigned__') return 'Unassigned'
                  if (key === '__no_property__') return 'No Property'
                  return key
                }
                const colCount = canEdit ? 8 : 6
                return filtered.map((task: any) => {
                  const groupKey = groupKeyOf(task)
                  const showGroupHeader = groupKey !== null && groupKey !== lastGroupKey
                  if (showGroupHeader) lastGroupKey = groupKey
                  const groupHeader = showGroupHeader ? (
                    <tr key={`group-${groupKey}`} className="bg-muted/40 border-y border-border">
                      <td colSpan={colCount} className="py-1.5 px-3 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {groupLabelOf(groupKey!)}
                      </td>
                    </tr>
                  ) : null
                const overdue = task.due_date && isPast(new Date(task.due_date + 'T00:00:00')) && !isToday(new Date(task.due_date + 'T00:00:00')) && task.status !== 'Done'
                const subs = subtasksByParent.get(task.id) || []
                const hasSubs = subs.length > 0
                const isExpanded = expandedTasks.has(task.id)
                const progress = getSubtaskProgress(task.id)
                const eligible = isEligibleSubtask(task)
                const isSelected = selectedIds.has(task.id)
                return (
                  <React.Fragment key={task.id}>
                    {groupHeader}
                    <tr className={`border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer ${isSelected ? 'bg-primary/5' : overdue ? 'bg-destructive/5' : task.status === 'Done' ? 'opacity-60' : ''}`} onClick={() => setDetailTask(task)}>
                      {canEdit && (
                        <td className="py-2 pl-3 pr-1 sticky left-0 z-10 bg-background w-8" onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            disabled={!eligible}
                            onCheckedChange={(v) => {
                              setSelectedIds(prev => {
                                const next = new Set(prev)
                                if (v) next.add(task.id)
                                else next.delete(task.id)
                                return next
                              })
                            }}
                            aria-label={`Select ${task.title}`}
                            title={!eligible ? (hasSubs ? 'Has subtasks — cannot become a subtask' : 'Already a subtask') : undefined}
                          />
                        </td>
                      )}
                      <td className={`py-2 px-3 font-medium text-xs ${canEdit ? '' : 'sticky left-0 z-10'} bg-background`}>
                        <div className="flex items-center gap-1.5">
                          {hasSubs && (
                            <button onClick={e => { e.stopPropagation(); toggleExpand(task.id) }} className="text-muted-foreground hover:text-foreground flex-shrink-0">
                              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5 rotate-90" />}
                            </button>
                          )}
                          <span className={task.status === 'Done' ? 'line-through' : ''}>{task.title}</span>
                          {task.property_name && <span className="text-muted-foreground ml-1">· {task.property_name}</span>}
                          {hasSubs && (
                            <span className="text-2xs text-muted-foreground bg-muted rounded px-1.5 py-0.5 ml-1 flex-shrink-0">
                              {progress.done}/{progress.total}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3"><TaskStatusBadge status={task.status} /></td>
                      <td className="py-2 px-3"><PriorityBadge priority={task.priority} /></td>
                      <td className="py-2 px-3"><DueDateLabel date={task.due_date} /></td>
                      <td className="py-2 px-3 text-xs">{task.assignee_name || '—'}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{task.category || '—'}</td>
                      {canEdit && (
                        <td className="py-2 px-3" onClick={e => e.stopPropagation()}>
                          <select value={task.status} onChange={e => updateTask({ id: task.id, updates: { status: e.target.value, completed_at: e.target.value === 'Done' ? new Date().toISOString() : null } })}
                            className="h-6 text-xs border border-input rounded px-1 bg-background">
                            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                      )}
                    </tr>
                    {/* Subtask rows */}
                    {hasSubs && isExpanded && subs.map((sub: any) => {
                      const subOverdue = sub.due_date && isPast(new Date(sub.due_date + 'T00:00:00')) && !isToday(new Date(sub.due_date + 'T00:00:00')) && sub.status !== 'Done'
                      return (
                        <tr key={sub.id} className={`border-b border-border/30 hover:bg-muted/20 transition-colors cursor-pointer ${subOverdue ? 'bg-destructive/5' : sub.status === 'Done' ? 'opacity-50' : ''}`} onClick={() => setDetailTask(sub)}>
                          {canEdit && <td className="py-1.5 pl-3 pr-1 sticky left-0 z-10 bg-background w-8" />}
                          <td className={`py-1.5 px-3 text-xs ${canEdit ? '' : 'sticky left-0 z-10'} bg-background`}>
                            <div className="flex items-center gap-1.5 pl-6">
                              <span className="w-1 h-1 rounded-full bg-muted-foreground/40 flex-shrink-0" />
                              <span className={sub.status === 'Done' ? 'line-through text-muted-foreground' : ''}>{sub.title}</span>
                            </div>
                          </td>
                          <td className="py-1.5 px-3"><TaskStatusBadge status={sub.status} /></td>
                          <td className="py-1.5 px-3"><PriorityBadge priority={sub.priority} /></td>
                          <td className="py-1.5 px-3"><DueDateLabel date={sub.due_date} /></td>
                          <td className="py-1.5 px-3 text-xs">{sub.assignee_name || '—'}</td>
                          <td className="py-1.5 px-3 text-xs text-muted-foreground">{sub.category || '—'}</td>
                          {canEdit && (
                            <td className="py-1.5 px-3" onClick={e => e.stopPropagation()}>
                              <select value={sub.status} onChange={e => updateTask({ id: sub.id, updates: { status: e.target.value, completed_at: e.target.value === 'Done' ? new Date().toISOString() : null } })}
                                className="h-6 text-xs border border-input rounded px-1 bg-background">
                                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </React.Fragment>
                )
                })
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ BULK ACTION BAR ═══ */}
      {viewMode === 'list' && canEdit && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-border bg-background shadow-lg px-3 py-2">
          <span className="text-xs font-medium tabular-nums pl-1">
            {selectedIds.size} selected
          </span>
          <ReparentPopover
            open={reparentOpen}
            onOpenChange={setReparentOpen}
            align="center"
            taskIds={Array.from(selectedIds)}
            candidates={parentCandidates}
            onPickExisting={(parentId) => reparentToExisting({ taskIds: Array.from(selectedIds), parentId })}
            onCreateParent={(title) => reparentToNew({ taskIds: Array.from(selectedIds), title })}
            trigger={
              <Button size="sm" className="h-8 text-xs gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                Make subtasks of…
              </Button>
            }
          />
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* ═══ BOARD VIEW ═══ */}
      {!isError && viewMode === 'board' && (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex-1 overflow-x-auto">
            <div className="flex gap-3 min-w-[900px] h-full">
              {STATUSES.map(status => (
                <div key={status} className="flex-1 min-w-[220px] flex flex-col">
                  <div className="flex items-center justify-between px-2 py-1.5 mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{status}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{(boardData[status] || []).length}</span>
                  </div>
                  <DroppableColumn id={status}>
                    {(boardData[status] || []).map((task: any) => {
                      const overdue = task.due_date && isPast(new Date(task.due_date + 'T00:00:00')) && !isToday(new Date(task.due_date + 'T00:00:00')) && task.status !== 'Done'
                      return (
                        <DraggableCard key={task.id} task={task}>
                          <div onClick={() => setDetailTask(task)}
                            className={`rounded-lg border border-border p-3 cursor-pointer shadow-xs hover:bg-muted/30 hover:shadow-sm transition-all ${overdue ? 'border-destructive/40' : ''}`}>
                            <p className="text-xs font-medium mb-1">{task.title}</p>
                            {task.property_name && <p className="text-xs text-muted-foreground mb-1">{task.property_name}</p>}
                            <div className="flex items-center gap-2 flex-wrap">
                              <PriorityBadge priority={task.priority} />
                              <DueDateLabel date={task.due_date} />
                            </div>
                            {task.assignee_name && <p className="text-xs text-muted-foreground mt-1">{task.assignee_name}</p>}
                          </div>
                        </DraggableCard>
                      )
                    })}
                    {(boardData[status] || []).length === 0 && (
                      <div className="text-center py-8 text-xs text-muted-foreground">No tasks</div>
                    )}
                  </DroppableColumn>
                </div>
              ))}
            </div>
          </div>
        </DndContext>
      )}

      {/* ═══ CALENDAR VIEW ═══ */}
      {!isError && viewMode === 'calendar' && (
        <CalendarView tasks={filtered} onTaskClick={setDetailTask} />
      )}

      {/* ═══ TASK DETAIL SHEET ═══ */}
      <Sheet open={!!detailTask} onOpenChange={v => !v && setDetailTask(null)}>
        <SheetContent side="right" className="w-full sm:w-[520px] overflow-y-auto">
          {detailTask && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base pr-8">{detailTask.title}</SheetTitle>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <TaskStatusBadge status={detailTask.status} />
                  <PriorityBadge priority={detailTask.priority} />
                  <DueDateLabel date={detailTask.due_date} />
                </div>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                {/* Description */}
                {detailTask.description && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Description</span>
                    <p className="text-sm whitespace-pre-wrap">{detailTask.description}</p>
                  </div>
                )}

                {/* Subtasks */}
                {(() => {
                  const subs = subtasksByParent.get(detailTask.id) || []
                  const isParent = subs.length > 0 || !detailTask.parent_task_id
                  return isParent ? (
                    <div>
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-2">
                        Subtasks {subs.length > 0 && `(${subs.filter((s: any) => s.status === 'Done').length}/${subs.length})`}
                      </span>
                      {subs.length > 0 && (
                        <div className="space-y-1 mb-2">
                          {subs.map((sub: any) => (
                            <div key={sub.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-muted/30 hover:bg-muted/50 cursor-pointer" onClick={() => setDetailTask(sub)}>
                              <button onClick={e => { e.stopPropagation(); updateTask({ id: sub.id, updates: { status: sub.status === 'Done' ? 'To Do' : 'Done', completed_at: sub.status === 'Done' ? null : new Date().toISOString() } }) }}>
                                {sub.status === 'Done' ? <CheckSquare className="w-4 h-4 text-success" /> : <Clock className="w-4 h-4 text-muted-foreground" />}
                              </button>
                              <span className={`flex-1 ${sub.status === 'Done' ? 'line-through text-muted-foreground' : ''}`}>{sub.title}</span>
                              {sub.assignee_name && <span className="text-muted-foreground">{sub.assignee_name}</span>}
                              {sub.due_date && <DueDateLabel date={sub.due_date} />}
                            </div>
                          ))}
                        </div>
                      )}
                      {canEdit && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={async () => {
                            const title = prompt('Subtask title:')
                            if (!title?.trim()) return
                            await supabase.from('tasks').insert({
                              title: title.trim(),
                              status: 'To Do',
                              priority: detailTask.priority || 'Medium',
                              category: detailTask.category || 'General',
                              property_name: detailTask.property_name || null,
                              list_id: detailTask.list_id,
                              parent_task_id: detailTask.id,
                              created_by: effectiveUser?.label || null,
                            })
                            qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
                          }}>
                            <Plus className="w-3 h-3" /> Add subtask
                          </Button>
                          {isEligibleSubtask(detailTask) && (
                            <ReparentPopover
                              open={detailReparentOpen}
                              onOpenChange={setDetailReparentOpen}
                              align="start"
                              taskIds={[detailTask.id]}
                              candidates={parentCandidates.filter((c: any) => c.id !== detailTask.id)}
                              onPickExisting={(parentId) => reparentToExisting({ taskIds: [detailTask.id], parentId })}
                              onCreateParent={(title) => reparentToNew({ taskIds: [detailTask.id], title })}
                              trigger={
                                <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                                  <CornerDownRight className="w-3 h-3" /> Move under…
                                </Button>
                              }
                            />
                          )}
                        </div>
                      )}
                    </div>
                  ) : detailTask.parent_task_id ? (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Parent: </span>
                      <button className="text-primary hover:underline" onClick={() => {
                        const parent = tasks?.find((t: any) => t.id === detailTask.parent_task_id)
                        if (parent) setDetailTask(parent)
                      }}>
                        {tasks?.find((t: any) => t.id === detailTask.parent_task_id)?.title || 'Parent task'}
                      </button>
                    </div>
                  ) : null
                })()}

                {/* Details grid */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground block">Assignee</span>
                    {canEdit ? (
                      <select value={detailTask.assignee_name || ''} onChange={e => {
                        updateTask({ id: detailTask.id, updates: { assignee_name: e.target.value || null } })
                        setDetailTask({ ...detailTask, assignee_name: e.target.value })
                      }} className="h-7 w-full text-xs border border-input rounded px-1 bg-background mt-0.5">
                        <option value="">Unassigned</option>
                        {(users || []).map((u: any) => <option key={u.id} value={u.label}>{u.label}</option>)}
                      </select>
                    ) : <span className="font-medium">{detailTask.assignee_name || 'Unassigned'}</span>}
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Due Date</span>
                    {canEdit ? (
                      <Input type="date" value={detailTask.due_date || ''} onChange={e => {
                        updateTask({ id: detailTask.id, updates: { due_date: e.target.value || null } })
                        setDetailTask({ ...detailTask, due_date: e.target.value })
                      }} className="h-7 text-xs mt-0.5" />
                    ) : <span className="font-medium">{detailTask.due_date ? format(new Date(detailTask.due_date), 'MMM d, yyyy') : '—'}</span>}
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Status</span>
                    {canEdit ? (
                      <select value={detailTask.status} onChange={e => {
                        updateTask({ id: detailTask.id, updates: { status: e.target.value, completed_at: e.target.value === 'Done' ? new Date().toISOString() : null } })
                        setDetailTask({ ...detailTask, status: e.target.value })
                      }} className="h-7 w-full text-xs border border-input rounded px-1 bg-background mt-0.5">
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : <TaskStatusBadge status={detailTask.status} />}
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Priority</span>
                    {canEdit ? (
                      <select value={detailTask.priority} onChange={e => {
                        updateTask({ id: detailTask.id, updates: { priority: e.target.value } })
                        setDetailTask({ ...detailTask, priority: e.target.value })
                      }} className="h-7 w-full text-xs border border-input rounded px-1 bg-background mt-0.5">
                        {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    ) : <PriorityBadge priority={detailTask.priority} />}
                  </div>
                  {detailTask.property_name && (
                    <div>
                      <span className="text-muted-foreground block">Property</span>
                      <span className="font-medium">{detailTask.property_name}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground block">Category</span>
                    <span className="font-medium">{detailTask.category || 'General'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Created</span>
                    <span>{format(new Date(detailTask.created_at), 'MMM d, yyyy')}</span>
                  </div>
                  {detailTask.created_by && (
                    <div>
                      <span className="text-muted-foreground block">Created By</span>
                      <span>{detailTask.created_by}</span>
                    </div>
                  )}
                </div>

                {/* Comments */}
                <div className="border-t border-border pt-4">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" /> Comments
                  </h3>
                  {commentsLoading ? (
                    <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                  ) : (
                    <div className="space-y-3 mb-3">
                      {(comments || []).length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
                      {(comments || []).map((c: any) => (
                        <div key={c.id} className="rounded-md bg-muted/40 p-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium">{c.author}</span>
                            <span className="text-xs text-muted-foreground">{format(new Date(c.created_at), 'MMM d, h:mm a')}</span>
                          </div>
                          <p className="text-xs whitespace-pre-wrap">
                            <CommentBody text={c.content} userLabels={(users || []).map((u: any) => u.label)} />
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  {canEdit && (
                    <div className="flex gap-2 items-start">
                      <div className="flex-1">
                        <MentionInput
                          value={commentText}
                          onChange={setCommentText}
                          users={(users || []).map((u: any) => ({ id: u.id, label: u.label }))}
                          onSubmit={() => commentText.trim() && addComment()}
                          placeholder="Add a comment… use @ to mention"
                        />
                      </div>
                      <Button size="sm" className="h-10 sm:h-8 px-3 flex-shrink-0" disabled={!commentText.trim() || commenting} onClick={() => addComment()}>
                        <Send className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Assignees */}
                <div className="border-t border-border pt-4">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <UserPlus className="w-3.5 h-3.5" /> Assignees
                  </h3>
                  <div className="space-y-1 mb-2">
                    {(taskAssignees || []).map((a: any) => (
                      <div key={a.id} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className={a.role === 'primary' ? 'font-medium' : ''}>{a.user?.label}</span>
                          <span className={`text-2xs px-1 py-0.5 rounded ${a.role === 'primary' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{a.role}</span>
                        </div>
                        {canEdit && <button onClick={() => toggleAssignee(detailTask.id, a.user_id, false)} className="text-muted-foreground hover:text-destructive"><X className="w-3 h-3" /></button>}
                      </div>
                    ))}
                    {(taskAssignees || []).length === 0 && <p className="text-xs text-muted-foreground">No assignees</p>}
                  </div>
                  {canEdit && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><Plus className="w-3 h-3" /> Add assignee</Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-1" align="start">
                        <div className="max-h-48 overflow-y-auto">
                          {(users || []).filter((u: any) => !(taskAssignees || []).some((a: any) => a.user_id === u.id)).map((u: any) => (
                            <div key={u.id} className="flex items-center justify-between px-2 py-1.5 text-xs hover:bg-accent rounded">
                              <span>{u.label}</span>
                              <div className="flex gap-1">
                                <button onClick={() => toggleAssignee(detailTask.id, u.id, true)} className="text-primary text-2xs hover:underline">Primary</button>
                                <button onClick={() => toggleAssignee(detailTask.id, u.id, false)} className="text-muted-foreground text-2xs hover:underline">Secondary</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>

                {/* Watchers */}
                <div className="border-t border-border pt-4">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5" /> Watchers
                  </h3>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {(taskWatchers || []).map((w: any) => (
                      <span key={w.id} className="flex items-center gap-1 text-xs bg-muted rounded px-2 py-1">
                        {w.user?.label}
                        {canEdit && <button onClick={() => toggleWatcher(detailTask.id, w.user_id)} className="text-muted-foreground hover:text-destructive"><X className="w-3 h-3" /></button>}
                      </span>
                    ))}
                    {(taskWatchers || []).length === 0 && <p className="text-xs text-muted-foreground">No watchers</p>}
                  </div>
                  {canEdit && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><Plus className="w-3 h-3" /> Add watcher</Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-48 p-1" align="start">
                        <div className="max-h-48 overflow-y-auto">
                          {(users || []).filter((u: any) => !(taskWatchers || []).some((w: any) => w.user_id === u.id)).map((u: any) => (
                            <button key={u.id} onClick={() => toggleWatcher(detailTask.id, u.id)} className="w-full text-left px-2 py-1.5 text-xs hover:bg-accent rounded">
                              {u.label}
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>

                {/* Move to list */}
                {canEdit && visibleLists.length > 1 && (
                  <div className="border-t border-border pt-4">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                      <List className="w-3.5 h-3.5" /> List
                    </h3>
                    <select
                      value={detailTask.list_id || ''}
                      onChange={e => { moveTaskToList(detailTask.id, e.target.value); setDetailTask({ ...detailTask, list_id: e.target.value }) }}
                      className="h-7 w-full text-xs border border-input rounded px-1 bg-background"
                    >
                      {visibleLists.map(l => <option key={l.id} value={l.id}>{l.name}{l.type === 'private' ? ' (private)' : ''}</option>)}
                    </select>
                  </div>
                )}

                {/* Delete */}
                {canEdit && (
                  <div className="border-t border-border pt-4">
                    <Button variant="outline" size="sm" className="text-xs text-destructive hover:bg-destructive/10"
                      onClick={() => { if (confirm('Delete this task?')) deleteTask(detailTask.id) }}>
                      Delete Task
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ═══ NEW TASK SHEET ═══ */}
      <Sheet open={addOpen} onOpenChange={v => !v && setAddOpen(false)}>
        <SheetContent side="right" className="w-full sm:w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">New Task</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Title *</label>
              <Input value={newForm.title} onChange={e => setNewForm(f => ({ ...f, title: e.target.value }))} className="h-9 text-sm" placeholder="What needs to be done?" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">List *</label>
              <select
                value={newForm.list_id}
                onChange={e => setNewForm(f => ({ ...f, list_id: e.target.value }))}
                className="w-full h-9 text-sm border border-input rounded-md px-2 bg-background"
              >
                {visibleLists.length === 0 && <option value="">No lists available</option>}
                {visibleLists.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name}{l.type === 'private' ? ' (private)' : l.type === 'public' ? ' (public)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
              <textarea value={newForm.description} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))}
                className="w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" placeholder="Details…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
                <select value={newForm.status} onChange={e => setNewForm(f => ({ ...f, status: e.target.value }))} className="w-full h-9 text-sm border border-input rounded-md px-2 bg-background">
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Priority</label>
                <select value={newForm.priority} onChange={e => setNewForm(f => ({ ...f, priority: e.target.value }))} className="w-full h-9 text-sm border border-input rounded-md px-2 bg-background">
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Due Date</label>
                <Input type="date" value={newForm.due_date} onChange={e => setNewForm(f => ({ ...f, due_date: e.target.value }))} className="h-9 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Assignee</label>
                <select value={newForm.assignee_name} onChange={e => setNewForm(f => ({ ...f, assignee_name: e.target.value }))} className="w-full h-9 text-sm border border-input rounded-md px-2 bg-background">
                  <option value="">Unassigned</option>
                  {(users || []).map((u: any) => <option key={u.id} value={u.label}>{u.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Category</label>
                <select value={newForm.category} onChange={e => setNewForm(f => ({ ...f, category: e.target.value }))} className="w-full h-9 text-sm border border-input rounded-md px-2 bg-background">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Property</label>
                <Input value={newForm.property_name} onChange={e => setNewForm(f => ({ ...f, property_name: e.target.value }))} className="h-9 text-sm" placeholder="Optional" />
              </div>
            </div>
            <Button className="w-full h-10" disabled={!newForm.title.trim() || !newForm.list_id || creating} onClick={() => createTask()}>
              {creating ? 'Creating…' : 'Create Task'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ═══ CREATE LIST DIALOG ═══ */}
      <Dialog open={listDialogOpen} onOpenChange={setListDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create Task List</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <Input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="List name…" className="h-9 text-sm" onKeyDown={e => e.key === 'Enter' && createList()} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setListDialogOpen(false)}>Cancel</Button>
            <Button onClick={createList} disabled={!newListName.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ MANAGE LIST DIALOG ═══ */}
      <Dialog open={!!manageList} onOpenChange={v => !v && setManageList(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Manage: {manageList?.name}</DialogTitle></DialogHeader>
          {manageList && (
            <div className="space-y-4 mt-2">
              {/* Color picker */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Your color for this list</label>
                <div className="flex gap-2 flex-wrap">
                  {LIST_COLORS.map(c => {
                    const myColor = manageList.membership?.color || '#6366f1'
                    return (
                      <button key={c} onClick={() => updateListColor(manageList.id, c)}
                        className={`w-7 h-7 rounded-full border-2 transition-transform ${myColor === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: c }} />
                    )
                  })}
                </div>
              </div>

              {/* Members */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Members ({membersLoading ? '…' : (manageMembers || []).length})</label>
                {membersLoading ? (
                  <div className="space-y-1 mb-2">{[1,2].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
                ) : (
                  <div className="space-y-1 mb-2 max-h-48 overflow-y-auto">
                    {(manageMembers || []).map((m: any) => (
                      <div key={m.id} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{m.user?.label}</span>
                          <span className="text-muted-foreground">{m.role}</span>
                        </div>
                        {m.role !== 'owner' && (
                          <button onClick={() => removeListMember(manageList.id, m.user_id)} className="text-muted-foreground hover:text-destructive"><X className="w-3 h-3" /></button>
                        )}
                      </div>
                    ))}
                    {(manageMembers || []).length === 0 && <p className="text-xs text-muted-foreground">No members yet</p>}
                  </div>
                )}
                {!membersLoading && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><UserPlus className="w-3 h-3" /> Add member</Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-48 p-1" align="start">
                      <div className="max-h-48 overflow-y-auto">
                        {(users || []).filter((u: any) => !(manageMembers || []).some((m: any) => m.user_id === u.id)).map((u: any) => (
                          <button key={u.id} onClick={() => addListMember(manageList.id, u.id)} className="w-full text-left px-2 py-1.5 text-xs hover:bg-accent rounded">
                            {u.label}
                          </button>
                        ))}
                        {(users || []).filter((u: any) => !(manageMembers || []).some((m: any) => m.user_id === u.id)).length === 0 && (
                          <p className="text-xs text-muted-foreground text-center py-2">All users added</p>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>

              {/* Delete list */}
              {manageList.type !== 'public' && (
                <div className="border-t border-border pt-3">
                  <Button variant="outline" size="sm" className="text-xs text-destructive hover:bg-destructive/10 gap-1.5" onClick={() => deleteList(manageList.id)}>
                    <Trash2 className="w-3 h-3" /> Delete List
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
