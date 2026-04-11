import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Card, CardContent } from '@/components/ui/card'
import {
  Search, X, Plus, CheckSquare, Clock, AlertCircle, ChevronDown, ChevronUp,
  MessageSquare, Send, Download, ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react'
import { format, differenceInDays, isPast, isToday } from 'date-fns'
import Papa from 'papaparse'

type ViewMode = 'list' | 'board'
type StatusFilter = 'all' | 'To Do' | 'In Progress' | 'Done' | 'Blocked'
type SortKey = 'title' | 'status' | 'priority' | 'due_date' | 'assignee_name' | 'created_at'

const STATUSES = ['To Do', 'In Progress', 'Done', 'Blocked']
const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low']
const CATEGORIES = ['General', 'Cleaning', 'Maintenance', 'Onboarding', 'Client', 'Finance', 'Admin']

function StatusBadge({ status }: { status: string }) {
  const cls = {
    'To Do': 'text-gray-700 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-900/20 dark:border-gray-800',
    'In Progress': 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-900/20 dark:border-blue-800',
    'Done': 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800',
    'Blocked': 'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800',
  }[status] || 'text-gray-600 bg-gray-50 border-gray-200'
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded border whitespace-nowrap ${cls}`}>{status}</span>
}

function PriorityBadge({ priority }: { priority: string }) {
  const cls = {
    'Urgent': 'text-red-700 dark:text-red-400',
    'High': 'text-amber-700 dark:text-amber-400',
    'Medium': 'text-blue-700 dark:text-blue-400',
    'Low': 'text-gray-500',
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
  const cls = overdue ? 'text-red-600 dark:text-red-400 font-medium' : today ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground'
  return <span className={`text-xs ${cls}`}>{label}</span>
}

export default function TasksPage() {
  usePageTitle('Tasks')
  const { toast } = useToast()
  const { effectiveUser } = useAuth()
  const qc = useQueryClient()
  const canEdit = canEditView('tasks', effectiveUser)

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('due_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [addOpen, setAddOpen] = useState(false)
  const [detailTask, setDetailTask] = useState<any>(null)
  const [commentText, setCommentText] = useState('')

  // New task form
  const [newForm, setNewForm] = useState({
    title: '', description: '', status: 'To Do', priority: 'Medium',
    due_date: '', assignee_name: '', property_name: '', category: 'General',
  })

  // ─── Queries ──────────────────────────────────────────────────────────────
  const { data: tasks, isLoading } = useQuery({
    queryKey: ['/supabase/tasks'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: users } = useQuery({
    queryKey: ['/supabase/task-users'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_users').select('id, label, role')
      if (error) throw error
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
  const stats = useMemo(() => {
    if (!tasks) return { total: 0, todo: 0, inProgress: 0, done: 0, overdue: 0 }
    const today = new Date().toISOString().split('T')[0]
    return {
      total: tasks.length,
      todo: tasks.filter((t: any) => t.status === 'To Do').length,
      inProgress: tasks.filter((t: any) => t.status === 'In Progress').length,
      done: tasks.filter((t: any) => t.status === 'Done').length,
      overdue: tasks.filter((t: any) => t.due_date && t.due_date < today && t.status !== 'Done').length,
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

  const filtered = useMemo(() => {
    if (!tasks) return []
    let result = tasks.filter((t: any) => {
      const matchSearch = !search.trim() || [t.title, t.description, t.assignee_name, t.property_name].some(v => v?.toLowerCase().includes(search.toLowerCase()))
      const matchStatus = statusFilter === 'all' || t.status === statusFilter
      return matchSearch && matchStatus
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
  }, [tasks, search, statusFilter, sortKey, sortDir])

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
      const { error } = await supabase.from('tasks').insert({
        ...newForm,
        due_date: newForm.due_date || null,
        assignee_name: newForm.assignee_name || null,
        property_name: newForm.property_name || null,
        created_by: effectiveUser?.label || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
      toast({ title: 'Task created' })
      setAddOpen(false)
      setNewForm({ title: '', description: '', status: 'To Do', priority: 'Medium', due_date: '', assignee_name: '', property_name: '', category: 'General' })
    },
    onError: () => toast({ title: 'Failed to create task', variant: 'destructive' }),
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
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  })

  const { mutate: addComment, isPending: commenting } = useGuardedMutation('tasks', {
    mutationFn: async () => {
      const { error } = await supabase.from('task_comments').insert({
        task_id: detailTask.id,
        author: effectiveUser?.label || 'Unknown',
        content: commentText.trim(),
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/task-comments', detailTask?.id] })
      setCommentText('')
    },
    onError: () => toast({ title: 'Failed to add comment', variant: 'destructive' }),
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
    onError: () => toast({ title: 'Delete failed', variant: 'destructive' }),
  })

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
    <div className="p-5 h-full flex flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            {stats.overdue > 0 && <span className="text-red-600 dark:text-red-400 font-medium">{stats.overdue} overdue</span>}
            {stats.overdue > 0 && ' · '}
            {stats.inProgress} in progress · {stats.todo} to do · {stats.done} done
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center border rounded-md overflow-hidden">
            {(['list', 'board'] as ViewMode[]).map(v => (
              <button key={v} onClick={() => setViewMode(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === v ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>
                {v === 'list' ? 'List' : 'Board'}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="w-3.5 h-3.5" /> Export
          </Button>
          {canEdit && (
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> New Task
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'To Do', count: stats.todo, filter: 'To Do' as StatusFilter, cls: '' },
          { label: 'In Progress', count: stats.inProgress, filter: 'In Progress' as StatusFilter, cls: 'text-blue-600 dark:text-blue-400' },
          { label: 'Overdue', count: stats.overdue, filter: 'all' as StatusFilter, cls: 'text-red-600 dark:text-red-400' },
          { label: 'Done', count: stats.done, filter: 'Done' as StatusFilter, cls: 'text-green-600 dark:text-green-400' },
        ].map(c => (
          <Card key={c.label} className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => { setStatusFilter(c.filter) }}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className={`text-lg font-semibold ${c.cls}`}>{c.count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['all', ...STATUSES] as StatusFilter[]).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-muted-foreground hover:bg-muted'}`}>
            {s === 'all' ? `All (${stats.total})` : s}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input type="search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 pr-7 h-8 w-full sm:w-56 text-sm" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>

      {/* ═══ LIST VIEW ═══ */}
      {viewMode === 'list' && (
        <div className="overflow-auto flex-1 rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted border-b border-border z-10">
              <tr>
                <th className={`${thCls} sticky left-0 z-20 bg-muted`} onClick={() => toggleSort('title')}>Task <SortIcon col="title" /></th>
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
                [...Array(6)].map((_, i) => <tr key={i} className="border-b border-border/50">{[...Array(canEdit ? 7 : 6)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}</tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={canEdit ? 7 : 6}><EmptyState icon={CheckSquare} title="No tasks" description={search || statusFilter !== 'all' ? 'No tasks match your filters.' : 'Create your first task to get started.'} action={canEdit ? { label: 'New Task', onClick: () => setAddOpen(true) } : undefined} /></td></tr>
              ) : filtered.map((task: any) => {
                const overdue = task.due_date && isPast(new Date(task.due_date + 'T00:00:00')) && !isToday(new Date(task.due_date + 'T00:00:00')) && task.status !== 'Done'
                return (
                  <tr key={task.id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer ${overdue ? 'bg-red-50/30 dark:bg-red-900/5' : task.status === 'Done' ? 'opacity-60' : ''}`} onClick={() => setDetailTask(task)}>
                    <td className="py-2 px-3 font-medium text-xs sticky left-0 z-10 bg-background">
                      <div>
                        <span className={task.status === 'Done' ? 'line-through' : ''}>{task.title}</span>
                        {task.property_name && <span className="text-muted-foreground ml-1.5">· {task.property_name}</span>}
                      </div>
                    </td>
                    <td className="py-2 px-3"><StatusBadge status={task.status} /></td>
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
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ BOARD VIEW ═══ */}
      {viewMode === 'board' && (
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-3 min-w-[900px] h-full">
            {STATUSES.map(status => (
              <div key={status} className="flex-1 min-w-[220px] flex flex-col">
                <div className="flex items-center justify-between px-2 py-1.5 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{status}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{(boardData[status] || []).length}</span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto">
                  {(boardData[status] || []).map((task: any) => {
                    const overdue = task.due_date && isPast(new Date(task.due_date + 'T00:00:00')) && !isToday(new Date(task.due_date + 'T00:00:00')) && task.status !== 'Done'
                    return (
                      <div key={task.id} onClick={() => setDetailTask(task)}
                        className={`rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/30 transition-colors ${overdue ? 'border-red-200 dark:border-red-800' : ''}`}>
                        <p className="text-xs font-medium mb-1">{task.title}</p>
                        {task.property_name && <p className="text-xs text-muted-foreground mb-1">{task.property_name}</p>}
                        <div className="flex items-center gap-2 flex-wrap">
                          <PriorityBadge priority={task.priority} />
                          <DueDateLabel date={task.due_date} />
                        </div>
                        {task.assignee_name && <p className="text-xs text-muted-foreground mt-1">{task.assignee_name}</p>}
                      </div>
                    )
                  })}
                  {(boardData[status] || []).length === 0 && (
                    <div className="text-center py-8 text-xs text-muted-foreground">No tasks</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ TASK DETAIL SHEET ═══ */}
      <Sheet open={!!detailTask} onOpenChange={v => !v && setDetailTask(null)}>
        <SheetContent side="right" className="w-full sm:w-[520px] overflow-y-auto">
          {detailTask && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base pr-8">{detailTask.title}</SheetTitle>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <StatusBadge status={detailTask.status} />
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
                    ) : <StatusBadge status={detailTask.status} />}
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
                          <p className="text-xs whitespace-pre-wrap">{c.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {canEdit && (
                    <div className="flex gap-2">
                      <Input value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Add a comment…" className="h-8 text-xs flex-1"
                        onKeyDown={e => { if (e.key === 'Enter' && commentText.trim()) addComment() }} />
                      <Button size="sm" className="h-8 px-3" disabled={!commentText.trim() || commenting} onClick={() => addComment()}>
                        <Send className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>

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
            <Button className="w-full h-10" disabled={!newForm.title.trim() || creating} onClick={() => createTask()}>
              {creating ? 'Creating…' : 'Create Task'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
