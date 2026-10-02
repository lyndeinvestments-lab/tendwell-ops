import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { slugify } from '@/lib/issues'
import type { StatusTone } from '@/lib/status-colors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'

/**
 * Leadership-only quarterly goals, shown on the North Star page for admins.
 * Backed by `quarterly_goals`, whose RLS is admin-only — the page hiding this
 * tab is a convenience, the database policy is the actual gate.
 */

const STATUSES = ['Not started', 'In progress', 'Blocked', 'Done'] as const
const STATUS_TONE: Record<string, StatusTone> = {
  'Not started': 'neutral',
  'In progress': 'info',
  'Blocked': 'destructive',
  'Done': 'success',
}

type Kind = 'goal' | 'measure'

interface QuarterlyGoal {
  id: string
  quarter: string
  kind: Kind
  title: string
  detail: string | null
  owner_name: string | null
  status: string
  sort_order: number
}

interface GoalForm {
  kind: Kind
  title: string
  detail: string
  owner_name: string
  status: string
}

const EMPTY_FORM: GoalForm = { kind: 'goal', title: '', detail: '', owner_name: '', status: 'Not started' }

function currentQuarter(): string {
  const now = new Date()
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`
}

export function QuarterlyGoals() {
  const { t } = useLocale('financials')
  const { toast } = useToast()
  const qc = useQueryClient()

  const [quarter, setQuarter] = useState(currentQuarter)
  const [dialog, setDialog] = useState<{ id: string | null } | null>(null)
  const [form, setForm] = useState<GoalForm>(EMPTY_FORM)

  const { data: goals, isLoading, isError, refetch } = useQuery({
    queryKey: ['/supabase/quarterly-goals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quarterly_goals' as any)
        .select('*')
        .order('sort_order')
      if (error) throw error
      return (data || []) as unknown as QuarterlyGoal[]
    },
  })

  // Every quarter that has rows, plus the current one so it can be started fresh.
  const quarterOptions = useMemo(() => {
    const set = new Set<string>([currentQuarter()])
    for (const g of goals || []) set.add(g.quarter)
    return Array.from(set).sort().reverse()
  }, [goals])

  const inQuarter = useMemo(() => (goals || []).filter(g => g.quarter === quarter), [goals, quarter])
  const bigRocks = inQuarter.filter(g => g.kind === 'goal')
  const measures = inQuarter.filter(g => g.kind === 'measure')

  const statusLabel = (s: string) => t(`northStar.quarterly.status.${slugify(s)}`, undefined, s)
  const invalidate = () => qc.invalidateQueries({ queryKey: ['/supabase/quarterly-goals'] })

  function openAdd(kind: Kind) {
    setForm({ ...EMPTY_FORM, kind })
    setDialog({ id: null })
  }

  function openEdit(g: QuarterlyGoal) {
    setForm({
      kind: g.kind,
      title: g.title,
      detail: g.detail || '',
      owner_name: g.owner_name || '',
      status: g.status,
    })
    setDialog({ id: g.id })
  }

  async function save() {
    const payload = {
      kind: form.kind,
      title: form.title.trim(),
      detail: form.detail.trim() || null,
      owner_name: form.owner_name.trim() || null,
      status: form.status,
      updated_at: new Date().toISOString(),
    }
    const q = supabase.from('quarterly_goals' as any)
    const { error } = dialog?.id
      ? await q.update(payload).eq('id', dialog.id)
      : await q.insert({
          ...payload,
          quarter,
          sort_order: (goals || []).filter(g => g.quarter === quarter && g.kind === form.kind).length + 1,
        })
    if (error) {
      toast({ title: t('northStar.quarterly.toasts.saveFailed'), description: error.message, variant: 'destructive' })
      return
    }
    toast({ title: dialog?.id ? t('northStar.quarterly.toasts.updated') : t('northStar.quarterly.toasts.added') })
    setDialog(null)
    invalidate()
  }

  async function setStatus(g: QuarterlyGoal, status: string) {
    const { error } = await supabase
      .from('quarterly_goals' as any)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', g.id)
    if (error) {
      toast({ title: t('northStar.quarterly.toasts.saveFailed'), description: error.message, variant: 'destructive' })
      return
    }
    invalidate()
  }

  async function remove(g: QuarterlyGoal) {
    if (!confirm(t('northStar.quarterly.deleteConfirm'))) return
    const { error } = await supabase.from('quarterly_goals' as any).delete().eq('id', g.id)
    if (error) {
      toast({ title: t('northStar.quarterly.toasts.saveFailed'), description: error.message, variant: 'destructive' })
      return
    }
    toast({ title: t('northStar.quarterly.toasts.removed') })
    invalidate()
  }

  function renderRow(g: QuarterlyGoal, index: number) {
    return (
      <li key={g.id} className="flex gap-3 p-4 border-b border-border last:border-b-0">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xs font-semibold text-primary tabular-nums">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">{g.title}</h3>
            <div className="flex items-center gap-2">
              <select
                value={g.status}
                onChange={e => setStatus(g, e.target.value)}
                aria-label={t('northStar.quarterly.statusLabel')}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs"
              >
                {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
              <button onClick={() => openEdit(g)} aria-label={t('common.actions.edit')} className="text-muted-foreground hover:text-foreground">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => remove(g)} aria-label={t('common.actions.delete')} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {g.detail && <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{g.detail}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge tone={STATUS_TONE[g.status] || 'neutral'}>{statusLabel(g.status)}</StatusBadge>
            {g.owner_name && <span className="text-2xs text-muted-foreground">{t('northStar.quarterly.ownerPrefix', { name: g.owner_name })}</span>}
          </div>
        </div>
      </li>
    )
  }

  function renderSection(kind: Kind, title: string, rows: QuarterlyGoal[]) {
    return (
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openAdd(kind)}>
            <Plus className="h-3 w-3" /> {t('northStar.quarterly.add')}
          </Button>
        </div>
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
            {t('northStar.quarterly.noneInSection')}
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            {rows.map((g, i) => renderRow(g, i))}
          </ul>
        )}
      </section>
    )
  }

  if (isError) {
    return <ErrorState title={t('northStar.quarterly.loadFailed')} onRetry={() => refetch()} />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          {t('northStar.quarterly.adminOnly')}
        </div>
        <select
          value={quarter}
          onChange={e => setQuarter(e.target.value)}
          aria-label={t('northStar.quarterly.quarterLabel')}
          className="h-8 min-w-[110px] rounded-md border border-input bg-background px-2 text-center text-sm font-medium"
        >
          {quarterOptions.map(q => <option key={q} value={q}>{q.replace('-', ' ')}</option>)}
        </select>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : inQuarter.length === 0 ? (
        <EmptyState
          icon={Target}
          title={t('northStar.quarterly.emptyTitle')}
          description={t('northStar.quarterly.emptyDescription')}
          action={{ label: t('northStar.quarterly.addGoal'), onClick: () => openAdd('goal') }}
        />
      ) : (
        <>
          {renderSection('goal', t('northStar.quarterly.goalsHeading'), bigRocks)}
          {renderSection('measure', t('northStar.quarterly.measuresHeading'), measures)}
        </>
      )}

      <Dialog open={!!dialog} onOpenChange={v => !v && setDialog(null)}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialog?.id ? t('northStar.quarterly.dialog.editTitle') : t('northStar.quarterly.dialog.addTitle')}</DialogTitle>
          </DialogHeader>
          <div className="mt-2 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('northStar.quarterly.dialog.title')}</label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('northStar.quarterly.dialog.detail')}</label>
              <Textarea value={form.detail} onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} rows={5} className="text-xs" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('northStar.quarterly.dialog.kind')}</label>
                <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as Kind }))} className="h-8 w-full rounded border border-input bg-background px-2 text-xs">
                  <option value="goal">{t('northStar.quarterly.kind.goal')}</option>
                  <option value="measure">{t('northStar.quarterly.kind.measure')}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('northStar.quarterly.statusLabel')}</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="h-8 w-full rounded border border-input bg-background px-2 text-xs">
                  {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('northStar.quarterly.dialog.owner')}</label>
              <Input value={form.owner_name} onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))} className="h-8 text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>{t('common.actions.cancel')}</Button>
            <Button onClick={save} disabled={!form.title.trim()}>
              {dialog?.id ? t('northStar.dialog.update') : t('northStar.dialog.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
