// Task audit: billable work that is NOT on the vendor invoice.
//
// Busy Bee stopped billing auxiliary work (hot tub refreshes, trash pickups,
// deliveries, lockbox checks…) in September 2026, so it only reaches a client
// invoice if we bill it ourselves. Three feeds meet here:
//
//   1. Completed auxiliary TASKS from Breezeway + Trellis, classified with
//      shared/aux-tasks.ts, and whether each is on an invoice run. Reconcile
//      bills these automatically (api/invoices/_aux.ts); this view shows what
//      it did and what is still waiting for a run.
//   2. OBSERVATIONS — work someone SAW in Slack / Quo / email, logged by
//      Cowork's daily sweep (MCP tool ops_log_task_observation) or by hand
//      here. One with no task record is "untracked": nothing will bill it
//      unless a human does, which is the whole point of the audit.
//   3. UNCLASSIFIED completed tasks the classifier does not recognise, so a
//      human can bill real work in one click without it ever auto-billing.
//
// Plus the pricing / billability settings that drive the automatic lines
// (app_settings, admin-editable — a price change never needs a deploy).

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { SearchSelect } from '@/components/issues/SearchSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { localISODate } from '@/lib/local-date'
import type { StatusTone } from '@/lib/status-colors'
import { invoicesApi, type BillingChannel } from '@/lib/invoices'
import {
  APP_SETTING_AUX_BILLABLE,
  APP_SETTING_EXTRA_PRICING,
  AUX_CATEGORIES,
  BILLABLE_AUX_CATEGORIES,
  auxCharge,
  classifyAuxTask,
  isBillableCategory,
  isTaskCancelled,
  isTaskCompleted,
  matchObservationToTask,
  resolveAuxSettings,
  type AuxBillingSettings,
  type AuxCategory,
  type AuxTaskSource,
} from '@shared/aux-tasks'
import {
  AlertTriangle, Ban, CheckCircle2, ClipboardList, DollarSign, ExternalLink, Loader2, Pencil, Plus, Receipt,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PropertyLite { id: number; name: string | null; trellis_id: string | null }

interface TaskLineRow {
  id: string
  matched_task_id: string | null
  review_status: string
  line_kind: string
  client_charge_amount: number | null
  service_type: string | null
  run_id: string
  invoice_runs: { status: string } | { status: string }[] | null
}

interface Observation {
  id: string
  external_id: string
  source: string
  property_id: number | null
  property_text: string | null
  category: string
  service_type: string | null
  occurred_on: string
  summary: string
  evidence_url: string | null
  reported_by: string | null
  status: 'open' | 'matched' | 'billed' | 'dismissed'
  matched_task_id: string | null
  invoice_line_id: string | null
  note: string | null
  created_by: string | null
  created_at: string | null
  properties?: { name: string | null } | { name: string | null }[] | null
}

interface OpenRun {
  id: string
  period_start: string | null
  period_end: string | null
  status: string
  source: string
  vendors: { name: string } | { name: string }[] | null
}

interface TaskBilling {
  state: 'billed' | 'on_run' | 'needs_price' | 'dismissed'
  runStatus: string | null
  charge: number | null
  lineId: string
}

interface AuditTask {
  externalId: string
  source: AuxTaskSource
  propertyId: number | null
  propertyName: string | null
  date: string | null
  title: string
  department: string | null
  completed: boolean
  cancelled: boolean
  category: AuxCategory
  serviceType: string | null
  billable: boolean
  billing: TaskBilling | null
}

type Tab = 'untracked' | 'to_bill' | 'unclassified' | 'billed' | 'observations'

// The generated Database types (shared/database.types.ts) predate the
// task_audit_observations table; the audit queries go through this untyped
// handle so the feature does not have to wait on a types regeneration.
const db = supabase as any

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}
function categoryOf(c: string): AuxCategory {
  return (c in AUX_CATEGORIES ? c : 'unclassified') as AuxCategory
}

// PostgREST caps a response at 1000 rows and reports it only in a header —
// same trap as api/invoices/_lib.ts fetchAllRows. Page until a short page.
async function fetchAll<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> },
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    out.push(...page)
    if (page.length < PAGE || out.length > 50_000) return out
  }
}

async function billingChannelFor(propertyId: number): Promise<BillingChannel> {
  const { data: propRow } = await db.from('properties').select('contact_id').eq('id', propertyId).maybeSingle()
  if (!propRow?.contact_id) return 'none'
  const { data: c } = await db.from('contacts').select('billing_channel').eq('id', propRow.contact_id).maybeSingle()
  return (c?.billing_channel as BillingChannel) ?? 'none'
}

const obsTone: Record<Observation['status'], StatusTone> = {
  open: 'destructive',
  matched: 'info',
  billed: 'success',
  dismissed: 'neutral',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TaskAudit({ userLabel, isAdmin }: { userLabel: string; isAdmin: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const today = localISODate()
  const [from, setFrom] = useState(shiftDate(today, -14))
  const [to, setTo] = useState(today)
  const [tab, setTab] = useState<Tab>('untracked')
  const [billTarget, setBillTarget] = useState<BillPrefill | null>(null)
  const [obsDialog, setObsDialog] = useState<{ mode: 'create' } | { mode: 'edit'; obs: Observation } | null>(null)
  const [showPricing, setShowPricing] = useState(false)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['task-audit'] })
    qc.invalidateQueries({ queryKey: ['invoicing-runs'] })
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  const propertiesQuery = useQuery<PropertyLite[]>({
    queryKey: ['task-audit', 'properties'],
    queryFn: () => fetchAll<PropertyLite>(() => db.from('properties').select('id, name, trellis_id').is('deleted_at', null).order('id')),
    staleTime: 300_000,
  })
  const settingsQuery = useQuery<AuxBillingSettings>({
    queryKey: ['task-audit', 'settings'],
    queryFn: async () => {
      const { data, error } = await db.from('app_settings').select('key, value').in('key', [APP_SETTING_EXTRA_PRICING, APP_SETTING_AUX_BILLABLE])
      if (error) throw error
      const by = new Map<string, unknown>(((data ?? []) as Array<{ key: string; value: unknown }>).map(r => [r.key, r.value]))
      return resolveAuxSettings({ pricing: by.get(APP_SETTING_EXTRA_PRICING), billable: by.get(APP_SETTING_AUX_BILLABLE) })
    },
  })
  const bwQuery = useQuery({
    queryKey: ['task-audit', 'breezeway', from, to],
    queryFn: () => fetchAll<{ external_id: string; property_id: number | null; due_date: string | null; task_title: string; department: string | null; status: string | null; completed_date: string | null }>(
      () => db
        .from('breezeway_tasks')
        .select('external_id, property_id, due_date, task_title, department, status, completed_date')
        .gte('due_date', from).lte('due_date', to)
        .eq('is_clean', false)
        .or('is_deep_clean.is.null,is_deep_clean.eq.false')
        .order('external_id'),
    ),
  })
  const trQuery = useQuery({
    queryKey: ['task-audit', 'trellis', from, to],
    queryFn: () => fetchAll<{ trellis_task_id: string; trellis_property_id: string | null; title: string | null; department_name: string | null; status: string | null; scheduled_date: string | null; completed_at: string | null }>(
      () => db
        .from('trellis_task_snapshot')
        .select('trellis_task_id, trellis_property_id, title, department_name, status, scheduled_date, completed_at')
        .gte('scheduled_date', from).lte('scheduled_date', to)
        .order('trellis_task_id'),
    ),
  })
  const taskLinesQuery = useQuery<TaskLineRow[]>({
    queryKey: ['task-audit', 'task-lines', from, to],
    queryFn: () => fetchAll<TaskLineRow>(
      () => db
        .from('invoice_lines')
        .select('id, matched_task_id, review_status, line_kind, client_charge_amount, service_type, run_id, invoice_runs(status)')
        .eq('source', 'task')
        .gte('raw_date_mentioned', shiftDate(from, -1)).lte('raw_date_mentioned', shiftDate(to, 1))
        .order('id'),
    ),
  })
  const obsQuery = useQuery<Observation[]>({
    queryKey: ['task-audit', 'observations', from, to],
    queryFn: () => fetchAll<Observation>(
      () => db
        .from('task_audit_observations')
        .select('*, properties(name)')
        .gte('occurred_on', from).lte('occurred_on', to)
        .order('occurred_on', { ascending: false }),
    ),
  })
  const runsQuery = useQuery<OpenRun[]>({
    queryKey: ['task-audit', 'open-runs'],
    queryFn: async () => {
      const { data, error } = await db
        .from('invoice_runs')
        .select('id, period_start, period_end, status, source, vendors(name)')
        .in('status', ['ingested', 'reconciled', 'review_needed'])
        .is('archived_at', null)
        .order('period_end', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as OpenRun[]
    },
  })

  const settings = settingsQuery.data ?? resolveAuxSettings()
  const properties = propertiesQuery.data ?? []
  const propById = useMemo(() => new Map(properties.map(p => [p.id, p])), [properties])
  const propByTrellis = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of properties) if (p.trellis_id) m.set(p.trellis_id, p.id)
    return m
  }, [properties])

  // How each task id sits on invoice runs. A live line beats a dismissed one.
  const billingByTask = useMemo(() => {
    const m = new Map<string, TaskBilling>()
    for (const r of taskLinesQuery.data ?? []) {
      if (!r.matched_task_id) continue
      const runStatus = one(r.invoice_runs)?.status ?? null
      if (runStatus === 'void') continue
      const excluded = r.line_kind === 'excluded' || r.review_status === 'excluded'
      const next: TaskBilling = excluded
        ? { state: 'dismissed', runStatus, charge: null, lineId: r.id }
        : r.review_status === 'needs_review'
          ? { state: 'needs_price', runStatus, charge: r.client_charge_amount, lineId: r.id }
          : { state: runStatus === 'approved' || runStatus === 'exported' ? 'billed' : 'on_run', runStatus, charge: r.client_charge_amount, lineId: r.id }
      const prev = m.get(r.matched_task_id)
      if (!prev || prev.state === 'dismissed') m.set(r.matched_task_id, next)
    }
    return m
  }, [taskLinesQuery.data])

  const observations = obsQuery.data ?? []
  // Tasks dismissed from this view before any run covered them live as
  // dismissed observations pointing at the task (external_id 'task:<id>').
  const dismissedTaskIds = useMemo(
    () => new Set(observations.filter(o => o.status === 'dismissed' && o.matched_task_id).map(o => o.matched_task_id!)),
    [observations],
  )

  const tasks: AuditTask[] = useMemo(() => {
    const rows: AuditTask[] = []
    const push = (t: Omit<AuditTask, 'category' | 'serviceType' | 'billable' | 'billing' | 'propertyName'>) => {
      const category = classifyAuxTask(t.title)
      const billing = billingByTask.get(t.externalId) ?? (dismissedTaskIds.has(t.externalId) ? { state: 'dismissed' as const, runStatus: null, charge: null, lineId: '' } : null)
      rows.push({
        ...t,
        propertyName: t.propertyId != null ? propById.get(t.propertyId)?.name ?? `Property #${t.propertyId}` : null,
        category,
        serviceType: AUX_CATEGORIES[category].serviceType,
        billable: isBillableCategory(category, settings),
        billing,
      })
    }
    for (const t of bwQuery.data ?? []) {
      push({ externalId: t.external_id, source: 'breezeway', propertyId: t.property_id, date: t.due_date, title: t.task_title, department: t.department, completed: isTaskCompleted('breezeway', t.status, t.completed_date), cancelled: isTaskCancelled(t.status) })
    }
    for (const t of trQuery.data ?? []) {
      push({ externalId: `trellis:${t.trellis_task_id}`, source: 'trellis', propertyId: t.trellis_property_id ? propByTrellis.get(t.trellis_property_id) ?? null : null, date: t.scheduled_date, title: t.title ?? '', department: t.department_name, completed: isTaskCompleted('trellis', t.status, t.completed_at), cancelled: isTaskCancelled(t.status) })
    }
    // One row per (property, day, category) — Breezeway wins, like the invoice.
    rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (a.source === b.source ? 0 : a.source === 'breezeway' ? -1 : 1))
    const seen = new Set<string>()
    return rows.filter(r => {
      if (r.category === 'clean' || r.category === 'no_clean' || r.cancelled) return false
      if (r.propertyId == null) return true
      const k = `${r.propertyId}|${r.date}|${r.category}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }, [bwQuery.data, trQuery.data, billingByTask, dismissedTaskIds, propById, propByTrellis, settings])

  const lists = useMemo(() => {
    const done = tasks.filter(t => t.completed)
    const untracked = observations.filter(o => o.status === 'open')
    const toBill = done.filter(t => t.billable && (t.billing == null || t.billing.state === 'needs_price'))
    const unclassified = done.filter(t => t.category === 'unclassified')
    const billed = done.filter(t => t.billing?.state === 'billed' || t.billing?.state === 'on_run')
    return {
      untracked, toBill, unclassified, billed,
      billedTotal: billed.reduce((a, t) => a + (t.billing?.charge ?? 0), 0),
      toBillTotal: toBill.reduce((a, t) => a + (t.serviceType ? auxCharge(t.serviceType, settings) ?? 0 : 0), 0),
    }
  }, [tasks, observations, settings])

  const matchable = useMemo(() => tasks.map(t => ({ externalId: t.externalId, propertyId: t.propertyId, date: t.date, category: t.category })), [tasks])

  // ── Mutations ─────────────────────────────────────────────────────────────
  const dismissTask = useGuardedMutation<void, Error, AuditTask>('invoicing', {
    mutationFn: async (t) => {
      // On a run already → exclude that line (reconcile keeps it excluded).
      if (t.billing?.lineId) {
        const { error } = await db.from('invoice_lines')
          .update({ review_status: 'excluded', line_kind: 'excluded', resolved_by: userLabel, resolved_at: new Date().toISOString() })
          .eq('id', t.billing.lineId)
        if (error) throw error
      }
      // Always leave a dismissed observation so a future run skips it too.
      const { error } = await db.from('task_audit_observations').upsert({
        external_id: `task:${t.externalId}`,
        source: t.source,
        property_id: t.propertyId,
        property_text: t.propertyName,
        category: t.category,
        service_type: t.serviceType,
        occurred_on: t.date ?? today,
        summary: `Dismissed: ${t.title}`,
        status: 'dismissed',
        matched_task_id: t.externalId,
        resolved_by: userLabel,
        resolved_at: new Date().toISOString(),
        created_by: userLabel,
      }, { onConflict: 'external_id' })
      if (error) throw error
    },
    onSuccess: () => { toast({ title: 'Task dismissed', description: 'It will not be billed, now or on a future run.' }); invalidate() },
    onError: (e) => { if (e.message !== 'edit_blocked') toast({ title: 'Dismiss failed', description: e.message, variant: 'destructive' }) },
  })

  const setObsStatus = useGuardedMutation<void, Error, { obs: Observation; status: Observation['status']; matchedTaskId?: string | null }>('invoicing', {
    mutationFn: async ({ obs, status, matchedTaskId }) => {
      const { error } = await db.from('task_audit_observations')
        .update({ status, matched_task_id: matchedTaskId === undefined ? obs.matched_task_id : matchedTaskId, resolved_by: userLabel, resolved_at: new Date().toISOString() })
        .eq('id', obs.id)
      if (error) throw error
    },
    onSuccess: () => invalidate(),
    onError: (e) => { if (e.message !== 'edit_blocked') toast({ title: 'Update failed', description: e.message, variant: 'destructive' }) },
  })

  const loading = propertiesQuery.isLoading || bwQuery.isLoading || trQuery.isLoading || taskLinesQuery.isLoading || obsQuery.isLoading
  const error = propertiesQuery.error ?? bwQuery.error ?? trQuery.error ?? taskLinesQuery.error ?? obsQuery.error

  const tabs: Array<[Tab, string, number, StatusTone]> = [
    ['untracked', 'Untracked work', lists.untracked.length, lists.untracked.length > 0 ? 'destructive' : 'neutral'],
    ['to_bill', 'Tasks to bill', lists.toBill.length, lists.toBill.length > 0 ? 'warning' : 'neutral'],
    ['unclassified', 'Unclassified', lists.unclassified.length, 'neutral'],
    ['billed', 'Billed', lists.billed.length, 'success'],
    ['observations', 'All observations', observations.length, 'neutral'],
  ]

  return (
    <>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-2xs uppercase tracking-wide text-muted-foreground">From</Label>
            <Input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} className="h-8 w-40" data-testid="audit-from" />
          </div>
          <div className="space-y-1">
            <Label className="text-2xs uppercase tracking-wide text-muted-foreground">To</Label>
            <Input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} className="h-8 w-40" data-testid="audit-to" />
          </div>
          {([7, 14, 30] as const).map(n => (
            <Button key={n} size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground" onClick={() => { setFrom(shiftDate(today, -n)); setTo(today) }}>
              {n}d
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowPricing(v => !v)} data-testid="button-audit-pricing">
            <DollarSign className="w-4 h-4 mr-1.5" /> Pricing
          </Button>
          <Button size="sm" onClick={() => setObsDialog({ mode: 'create' })} data-testid="button-log-observation">
            <Plus className="w-4 h-4 mr-1.5" /> Log observation
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Untracked work" value={lists.untracked.length} subtitle="Seen in Slack / Quo, no task record" icon={AlertTriangle} tone={lists.untracked.length > 0 ? 'destructive' : 'success'} loading={loading} testId="stat-untracked" />
        <StatCard title="Tasks to bill" value={lists.toBill.length} subtitle={lists.toBill.length > 0 ? `≈ ${fmtMoney(lists.toBillTotal)} · bills on the next run` : 'Everything completed is on a run'} icon={ClipboardList} tone={lists.toBill.length > 0 ? 'warning' : 'success'} loading={loading} testId="stat-to-bill" />
        <StatCard title="Billed from tasks" value={fmtMoney(lists.billedTotal)} subtitle={`${lists.billed.length} task line${lists.billed.length === 1 ? '' : 's'} in the period`} icon={Receipt} tone="primary" loading={loading} testId="stat-billed" />
        <StatCard title="Unclassified" value={lists.unclassified.length} subtitle="Completed, not recognised — bill by hand if real" icon={Pencil} tone="neutral" loading={loading} testId="stat-unclassified" />
      </div>

      {showPricing && (
        <PricingCard settings={settings} isAdmin={isAdmin} onSaved={() => { invalidate(); setShowPricing(false) }} />
      )}

      <div className="flex items-center gap-1 flex-wrap">
        {tabs.map(([id, label, n, tone]) => (
          <Button key={id} size="sm" variant={tab === id ? 'secondary' : 'ghost'} className="h-7 px-2.5" onClick={() => setTab(id)} data-testid={`audit-tab-${id}`}>
            {label}
            <span className={cn('ml-1.5 text-2xs tabular-nums', n > 0 && tone === 'destructive' && 'text-destructive font-semibold', n > 0 && tone === 'warning' && 'text-warning font-semibold', (n === 0 || tone === 'neutral' || tone === 'success') && 'text-muted-foreground')}>{n}</span>
          </Button>
        ))}
      </div>

      {error ? (
        <ErrorState title="Couldn't load the task audit" onRetry={() => invalidate()} />
      ) : loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : tab === 'untracked' || tab === 'observations' ? (
        <ObservationList
          rows={tab === 'untracked' ? lists.untracked : observations}
          emptyTitle={tab === 'untracked' ? 'No untracked work' : 'No observations in this period'}
          emptyDescription={tab === 'untracked'
            ? 'Everything logged from Slack / Quo matched a Breezeway or Trellis task. Cowork logs observations daily; you can also log one by hand.'
            : "Observations are logged by Cowork's daily Slack / Quo sweep (MCP: ops_log_task_observation) or by hand."}
          candidateFor={(o) => {
            const m = matchObservationToTask({ propertyId: o.property_id, date: o.occurred_on, category: categoryOf(o.category) }, matchable)
            return m ? tasks.find(t => t.externalId === m.externalId) ?? null : null
          }}
          onBill={(o) => setBillTarget({
            propertyId: o.property_id,
            propertyName: one(o.properties)?.name ?? o.property_text,
            date: o.occurred_on,
            serviceType: o.service_type ?? AUX_CATEGORIES[categoryOf(o.category)].serviceType,
            charge: o.service_type ? auxCharge(o.service_type, settings) : null,
            note: o.summary,
            taskId: `obs:${o.id}`,
            observationId: o.id,
          })}
          onEdit={(o) => setObsDialog({ mode: 'edit', obs: o })}
          onDismiss={(o) => setObsStatus.mutate({ obs: o, status: 'dismissed' })}
          onMarkTracked={(o, task) => setObsStatus.mutate({ obs: o, status: 'matched', matchedTaskId: task?.externalId ?? o.matched_task_id })}
          onReopen={(o) => setObsStatus.mutate({ obs: o, status: 'open' })}
          pending={setObsStatus.isPending}
        />
      ) : (
        <TaskList
          rows={tab === 'to_bill' ? lists.toBill : tab === 'unclassified' ? lists.unclassified : lists.billed}
          mode={tab as 'to_bill' | 'unclassified' | 'billed'}
          settings={settings}
          openRuns={runsQuery.data ?? []}
          onBill={(t) => setBillTarget({
            propertyId: t.propertyId,
            propertyName: t.propertyName,
            date: t.date,
            serviceType: t.serviceType,
            charge: t.serviceType ? auxCharge(t.serviceType, settings) : null,
            note: t.title,
            taskId: t.externalId,
            observationId: null,
          })}
          onDismiss={(t) => dismissTask.mutate(t)}
          pending={dismissTask.isPending}
        />
      )}

      {billTarget && (
        <BillDialog
          prefill={billTarget}
          runs={runsQuery.data ?? []}
          properties={properties}
          userLabel={userLabel}
          onClose={() => setBillTarget(null)}
          onSaved={() => { setBillTarget(null); invalidate() }}
        />
      )}
      {obsDialog && (
        <ObservationDialog
          mode={obsDialog.mode}
          obs={obsDialog.mode === 'edit' ? obsDialog.obs : null}
          properties={properties}
          matchable={matchable}
          userLabel={userLabel}
          onClose={() => setObsDialog(null)}
          onSaved={() => { setObsDialog(null); invalidate() }}
        />
      )}
    </>
  )
}

// ── Task list ─────────────────────────────────────────────────────────────────

function billingLabel(t: AuditTask): { text: string; tone: StatusTone } {
  const b = t.billing
  if (!b) return { text: 'Not on a run yet', tone: 'warning' }
  switch (b.state) {
    case 'billed': return { text: `Billed ${fmtMoney(b.charge)} · ${b.runStatus}`, tone: 'success' }
    case 'on_run': return { text: `On run (${b.runStatus?.replace(/_/g, ' ')}) · ${fmtMoney(b.charge)}`, tone: 'info' }
    case 'needs_price': return { text: 'On run — needs a price', tone: 'warning' }
    case 'dismissed': return { text: 'Dismissed', tone: 'neutral' }
  }
}

function TaskList({ rows, mode, settings, openRuns, onBill, onDismiss, pending }: {
  rows: AuditTask[]
  mode: 'to_bill' | 'unclassified' | 'billed'
  settings: AuxBillingSettings
  openRuns: OpenRun[]
  onBill: (t: AuditTask) => void
  onDismiss: (t: AuditTask) => void
  pending: boolean
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={mode === 'billed' ? Receipt : CheckCircle2}
        title={mode === 'to_bill' ? 'Nothing waiting to bill' : mode === 'unclassified' ? 'No unclassified tasks' : 'Nothing billed from tasks yet'}
        description={mode === 'to_bill'
          ? 'Every completed billable task in this period is already on an invoice run.'
          : mode === 'unclassified'
            ? 'Every completed non-clean task in this period was recognised.'
            : 'Task lines appear here once a run covering the period has been reconciled.'}
      />
    )
  }
  const runCovering = (date: string | null) => openRuns.find(r => date && r.period_start && r.period_end && r.period_start <= date && date <= r.period_end)
  return (
    <div className="rounded-2xl border border-card-border shadow-sm overflow-hidden">
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/60 backdrop-blur">
            <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Property</th>
              <th className="px-3 py-2 font-medium">Task</th>
              <th className="px-3 py-2 font-medium">Bills as</th>
              <th className="px-3 py-2 font-medium text-right">Charge</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium w-24" />
            </tr>
          </thead>
          <tbody>
            {rows.map(t => {
              const charge = t.serviceType ? auxCharge(t.serviceType, settings) : null
              const status = billingLabel(t)
              const covering = runCovering(t.date)
              return (
                <tr key={t.externalId} className="border-t border-border/60 hover:bg-muted/30" data-testid={`audit-task-${t.externalId}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(t.date)}</td>
                  <td className="px-3 py-2 max-w-48">
                    <p className={cn('truncate', t.propertyName == null && 'italic text-destructive')}>{t.propertyName ?? 'No Ops property linked'}</p>
                  </td>
                  <td className="px-3 py-2 max-w-64">
                    <p className="truncate" title={t.title}>{t.title}</p>
                    <p className="text-2xs text-muted-foreground">{t.source === 'breezeway' ? 'Breezeway' : 'Trellis'}{t.department ? ` · ${t.department}` : ''} · {AUX_CATEGORIES[t.category].label}</p>
                  </td>
                  <td className="px-3 py-2 max-w-40 truncate">{t.serviceType ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.billing?.charge != null ? fmtMoney(t.billing.charge) : charge != null ? fmtMoney(charge) : <span className="text-warning">no price</span>}</td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={status.tone}>{status.text}</StatusBadge>
                    {mode === 'to_bill' && !t.billing && (
                      <p className="text-2xs text-muted-foreground mt-0.5">
                        {covering ? 'Re-run reconcile on the open run for this week to add it' : 'Added automatically when a run covering this date is generated or reconciled'}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {mode !== 'billed' && t.propertyId != null && (
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onBill(t)} title="Bill now into an open run" data-testid={`audit-bill-${t.externalId}`}>
                          <Receipt className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {mode !== 'billed' && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => onDismiss(t)} disabled={pending} title="Dismiss — never bill this task" data-testid={`audit-dismiss-${t.externalId}`}>
                          <Ban className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Observation list ──────────────────────────────────────────────────────────

function ObservationList({ rows, emptyTitle, emptyDescription, candidateFor, onBill, onEdit, onDismiss, onMarkTracked, onReopen, pending }: {
  rows: Observation[]
  emptyTitle: string
  emptyDescription: string
  candidateFor: (o: Observation) => AuditTask | null
  onBill: (o: Observation) => void
  onEdit: (o: Observation) => void
  onDismiss: (o: Observation) => void
  onMarkTracked: (o: Observation, task: AuditTask | null) => void
  onReopen: (o: Observation) => void
  pending: boolean
}) {
  if (rows.length === 0) return <EmptyState icon={CheckCircle2} title={emptyTitle} description={emptyDescription} />
  return (
    <div className="space-y-2">
      {rows.map(o => {
        const cat = categoryOf(o.category)
        const propName = one(o.properties)?.name ?? null
        const candidate = o.status === 'open' ? candidateFor(o) : null
        return (
          <Card key={o.id} className={cn('border-card-border', o.status === 'open' && 'border-destructive/40 bg-destructive/5', o.status === 'dismissed' && 'opacity-60')} data-testid={`audit-obs-${o.id}`}>
            <CardContent className="p-3 flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge tone={obsTone[o.status]}>{o.status === 'open' ? 'untracked' : o.status}</StatusBadge>
                  <span className="text-sm font-medium">{fmtDate(o.occurred_on)}</span>
                  <span className={cn('text-sm', propName == null && 'italic text-destructive')}>{propName ?? `"${o.property_text ?? '?'}" — no Ops property`}</span>
                  <span className="text-xs text-muted-foreground">· {AUX_CATEGORIES[cat].label}{o.service_type ? ` → ${o.service_type}` : ''}</span>
                </div>
                <p className="text-sm">{o.summary}</p>
                <p className="text-2xs text-muted-foreground">
                  via {o.source}{o.reported_by ? ` · ${o.reported_by}` : ''}{o.created_by ? ` · logged by ${o.created_by}` : ''}
                  {o.matched_task_id && <> · task <code className="text-2xs">{o.matched_task_id.slice(0, 20)}</code></>}
                  {o.evidence_url && <> · <a href={o.evidence_url} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-0.5">source <ExternalLink className="w-3 h-3" /></a></>}
                </p>
                {candidate && (
                  <p className="text-2xs text-info">
                    Possible match: {candidate.source} "{candidate.title}" on {fmtDate(candidate.date)}{candidate.completed ? ' (completed)' : ' (not completed)'}.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {o.status === 'open' && (
                  <>
                    {candidate && (
                      <Button size="sm" variant="outline" className="h-7" onClick={() => onMarkTracked(o, candidate)} disabled={pending} data-testid={`audit-obs-track-${o.id}`}>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> It's this task
                      </Button>
                    )}
                    <Button size="sm" className="h-7" onClick={() => onBill(o)} disabled={o.property_id == null} title={o.property_id == null ? 'Assign a property first (pencil)' : 'Bill into an open run'} data-testid={`audit-obs-bill-${o.id}`}>
                      <Receipt className="w-3.5 h-3.5 mr-1" /> Bill
                    </Button>
                  </>
                )}
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onEdit(o)} title="Edit" data-testid={`audit-obs-edit-${o.id}`}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                {o.status !== 'dismissed' && o.status !== 'billed' && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => onDismiss(o)} disabled={pending} title="Dismiss" data-testid={`audit-obs-dismiss-${o.id}`}>
                    <Ban className="w-3.5 h-3.5" />
                  </Button>
                )}
                {o.status === 'dismissed' && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={() => onReopen(o)} disabled={pending} title="Reopen">
                    Reopen
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ── Bill dialog ───────────────────────────────────────────────────────────────

interface BillPrefill {
  propertyId: number | null
  propertyName: string | null
  date: string | null
  serviceType: string | null
  charge: number | null
  note: string
  /** matched_task_id to write: the task's external id, or 'obs:<id>' for an observation. */
  taskId: string
  observationId: string | null
}

function BillDialog({ prefill, runs, properties, userLabel, onClose, onSaved }: {
  prefill: BillPrefill
  runs: OpenRun[]
  properties: PropertyLite[]
  userLabel: string
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const covering = runs.find(r => prefill.date && r.period_start && r.period_end && r.period_start <= prefill.date && prefill.date <= r.period_end)
  const [runId, setRunId] = useState<string>(covering?.id ?? runs[0]?.id ?? '')
  const [propertyId, setPropertyId] = useState<number | null>(prefill.propertyId)
  const [serviceType, setServiceType] = useState<string>(prefill.serviceType ?? '')
  const [charge, setCharge] = useState<string>(prefill.charge != null ? String(prefill.charge) : '')
  const [date, setDate] = useState<string>(prefill.date ?? '')
  const [note, setNote] = useState<string>(prefill.note)
  const serviceOptions = BILLABLE_AUX_CATEGORIES.map(c => AUX_CATEGORIES[c].serviceType!).filter((v, i, a) => a.indexOf(v) === i)

  const save = useGuardedMutation<void, Error, void>('invoicing', {
    mutationFn: async () => {
      if (!runId) throw new Error('Pick an invoice run — generate a draft for that week first if none is open')
      if (propertyId == null) throw new Error('Pick a property')
      if (!serviceType) throw new Error('Pick a service')
      const chargeNum = Number(charge)
      if (!Number.isFinite(chargeNum) || chargeNum <= 0) throw new Error('Enter the client charge')
      if (!date) throw new Error('Enter the service date')
      const { data: maxRow } = await db.from('invoice_lines').select('line_no').eq('run_id', runId).order('line_no', { ascending: false }).limit(1)
      const nextLineNo = Number(maxRow?.[0]?.line_no ?? 0) + 1
      const channel = await billingChannelFor(propertyId)
      const propName = properties.find(p => p.id === propertyId)?.name ?? null
      const { data: inserted, error } = await db.from('invoice_lines').insert({
        run_id: runId,
        line_no: nextLineNo,
        source: 'task',
        raw_property_text: propName,
        raw_note_text: note.trim() || null,
        raw_amount: 0,
        raw_date_mentioned: date,
        property_id: propertyId,
        matched_task_id: prefill.taskId,
        service_type: serviceType,
        line_kind: 'extra',
        cleaner_pay_amount: null,
        client_charge_amount: chargeNum,
        billing_channel: channel,
        flags: ['aux_task'],
        // Human-placed → preserved by reconcile (see isHumanTouchedTaskLine).
        review_status: 'resolved',
        resolved_by: userLabel,
        resolved_at: new Date().toISOString(),
        engine_note: `Billed by ${userLabel} from Task audit${prefill.observationId ? ' (untracked work — no task record)' : ''}.`,
      }).select('id').single()
      if (error) throw error
      if (prefill.observationId) {
        const { error: oErr } = await db.from('task_audit_observations')
          .update({ status: 'billed', invoice_line_id: inserted?.id ?? null, property_id: propertyId, service_type: serviceType, resolved_by: userLabel, resolved_at: new Date().toISOString() })
          .eq('id', prefill.observationId)
        if (oErr) throw oErr
      }
      await invoicesApi('reconcile', { method: 'POST', body: { run_id: runId } })
    },
    onSuccess: () => { toast({ title: 'Added to the invoice run', description: `${serviceType} · ${fmtMoney(Number(charge))}` }); onSaved() },
    onError: (e) => { if (e.message !== 'edit_blocked') toast({ title: 'Could not bill', description: e.message, variant: 'destructive' }) },
  })

  const runLabel = (r: OpenRun) => `${one(r.vendors)?.name ?? 'Run'} · ${fmtDate(r.period_start)} – ${fmtDate(r.period_end)} · ${r.status.replace(/_/g, ' ')}`

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bill to client</DialogTitle>
          <DialogDescription>
            Adds a client-only line to an open invoice run: charged to the client (QBO / bill.com), not paid to the vendor, and the vendor subtotal is unaffected.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Invoice run</Label>
            {runs.length === 0 ? (
              <p className="text-sm text-warning">No open run. Generate a draft for the week of {fmtDate(prefill.date)} first (Invoice runs → Generate draft); completed tasks are added to it automatically, and untracked work can be billed into it here.</p>
            ) : (
              <Select value={runId} onValueChange={setRunId}>
                <SelectTrigger data-testid="bill-run"><SelectValue placeholder="Pick a run" /></SelectTrigger>
                <SelectContent>
                  {runs.map(r => <SelectItem key={r.id} value={r.id}>{runLabel(r)}{r.id === covering?.id ? ' · covers this date' : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Property</Label>
            <SearchSelect
              value={propertyId != null ? String(propertyId) : ''}
              onSelect={(v) => setPropertyId(v ? Number(v) : null)}
              options={properties.map(p => ({ value: String(p.id), label: p.name ?? `Property #${p.id}` }))}
              placeholder="Select property"
              searchPlaceholder="Search properties…"
              emptyText="No matching properties"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label>Service</Label>
              <Select value={serviceType} onValueChange={setServiceType}>
                <SelectTrigger data-testid="bill-service"><SelectValue placeholder="Select service" /></SelectTrigger>
                <SelectContent>{serviceOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Client charge</Label>
              <Input type="number" step="0.01" value={charge} onChange={e => setCharge(e.target.value)} data-testid="bill-charge" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Service date</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} data-testid="bill-date" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Note / reason <span className="text-muted-foreground font-normal">(rides in the invoice title for Reimbursement, Trip Fee, Extra Cleaning, Pet Fee)</span></Label>
              <Input value={note} onChange={e => setNote(e.target.value)} data-testid="bill-note" />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || runs.length === 0} data-testid="bill-save">
            {save.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Add to run
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Observation dialog (create / edit) ────────────────────────────────────────

function ObservationDialog({ mode, obs, properties, matchable, userLabel, onClose, onSaved }: {
  mode: 'create' | 'edit'
  obs: Observation | null
  properties: PropertyLite[]
  matchable: Array<{ externalId: string; propertyId: number | null; date: string | null; category: AuxCategory }>
  userLabel: string
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [propertyId, setPropertyId] = useState<number | null>(obs?.property_id ?? null)
  const [date, setDate] = useState<string>(obs?.occurred_on ?? localISODate())
  const [category, setCategory] = useState<AuxCategory>(obs ? categoryOf(obs.category) : 'hot_tub')
  const [summary, setSummary] = useState<string>(obs?.summary ?? '')
  const [reportedBy, setReportedBy] = useState<string>(obs?.reported_by ?? '')
  const [evidenceUrl, setEvidenceUrl] = useState<string>(obs?.evidence_url ?? '')
  const [source, setSource] = useState<string>(obs?.source ?? 'manual')
  const categoryOptions = (Object.keys(AUX_CATEGORIES) as AuxCategory[]).filter(c => c !== 'clean' && c !== 'no_clean')

  const save = useGuardedMutation<void, Error, void>('invoicing', {
    mutationFn: async () => {
      if (!summary.trim()) throw new Error('Describe what was done')
      if (!date) throw new Error('Enter the date')
      const match = propertyId != null ? matchObservationToTask({ propertyId, date, category }, matchable) : null
      const row = {
        source,
        property_id: propertyId,
        property_text: propertyId != null ? properties.find(p => p.id === propertyId)?.name ?? null : obs?.property_text ?? null,
        category,
        service_type: AUX_CATEGORIES[category].serviceType,
        occurred_on: date,
        summary: summary.trim(),
        reported_by: reportedBy.trim() || null,
        evidence_url: evidenceUrl.trim() || null,
      }
      if (mode === 'create') {
        const { error } = await db.from('task_audit_observations').insert({
          ...row,
          external_id: `manual:${crypto.randomUUID()}`,
          status: match ? 'matched' : 'open',
          matched_task_id: match?.externalId ?? null,
          created_by: userLabel,
        })
        if (error) throw error
      } else if (obs) {
        // Re-match only while still open; never disturb a billed/dismissed row.
        const rematch = obs.status === 'open' || obs.status === 'matched'
        const { error } = await db.from('task_audit_observations').update({
          ...row,
          ...(rematch ? { status: match ? 'matched' : 'open', matched_task_id: match?.externalId ?? null } : {}),
        }).eq('id', obs.id)
        if (error) throw error
      }
    },
    onSuccess: () => { toast({ title: mode === 'create' ? 'Observation logged' : 'Observation updated' }); onSaved() },
    onError: (e) => { if (e.message !== 'edit_blocked') toast({ title: 'Save failed', description: e.message, variant: 'destructive' }) },
  })

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Log observed work' : 'Edit observation'}</DialogTitle>
          <DialogDescription>
            Work someone mentioned (Slack, a text, a call) that may not have a task. It is checked against Breezeway / Trellis tasks within a day; anything without one is untracked until billed or dismissed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Property</Label>
            <SearchSelect
              value={propertyId != null ? String(propertyId) : ''}
              onSelect={(v) => setPropertyId(v ? Number(v) : null)}
              options={properties.map(p => ({ value: String(p.id), label: p.name ?? `Property #${p.id}` }))}
              placeholder={obs?.property_text ? `Unresolved: "${obs.property_text}" — pick the Ops property` : 'Select property'}
              searchPlaceholder="Search properties…"
              emptyText="No matching properties"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} data-testid="obs-date" />
            </div>
            <div className="space-y-1.5">
              <Label>Kind of work</Label>
              <Select value={category} onValueChange={v => setCategory(v as AuxCategory)}>
                <SelectTrigger data-testid="obs-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categoryOptions.map(c => <SelectItem key={c} value={c}>{AUX_CATEGORIES[c].label}{AUX_CATEGORIES[c].serviceType ? '' : ' (not billable)'}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>What was done</Label>
            <Textarea value={summary} onChange={e => setSummary(e.target.value)} rows={2} placeholder="e.g. Norma refreshed the hot tub after the guest reported feathers" data-testid="obs-summary" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['manual', 'slack', 'quo', 'email', 'other'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reported by</Label>
              <Input value={reportedBy} onChange={e => setReportedBy(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Link</Label>
              <Input value={evidenceUrl} onChange={e => setEvidenceUrl(e.target.value)} placeholder="https://…" />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="obs-save">
            {save.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            {mode === 'create' ? 'Log it' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Pricing / billability settings ────────────────────────────────────────────

function PricingCard({ settings, isAdmin, onSaved }: { settings: AuxBillingSettings; isAdmin: boolean; onSaved: () => void }) {
  const { toast } = useToast()
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(BILLABLE_AUX_CATEGORIES.map(c => {
      const st = AUX_CATEGORIES[c].serviceType!
      const v = settings.pricing[st]
      return [st, v == null ? '' : String(v)]
    })),
  )
  const [billable, setBillable] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(BILLABLE_AUX_CATEGORIES.map(c => [c, isBillableCategory(c, settings)])),
  )

  const save = useGuardedMutation<void, Error, void>('invoicing', {
    mutationFn: async () => {
      const pricing: Record<string, number | null> = {}
      for (const [st, v] of Object.entries(prices)) {
        if (v.trim() === '') { pricing[st] = null; continue }
        const n = Number(v)
        if (!Number.isFinite(n) || n < 0) throw new Error(`"${v}" is not a valid price for ${st}`)
        pricing[st] = n
      }
      const { error } = await db.from('app_settings').upsert([
        { key: APP_SETTING_EXTRA_PRICING, value: JSON.stringify(pricing) },
        { key: APP_SETTING_AUX_BILLABLE, value: JSON.stringify(billable) },
      ], { onConflict: 'key' })
      if (error) throw error
    },
    onSuccess: () => { toast({ title: 'Pricing saved', description: 'Applies the next time a run is generated or reconciled.' }); onSaved() },
    onError: (e) => { if (e.message !== 'edit_blocked') toast({ title: 'Save failed', description: e.message, variant: 'destructive' }) },
  })

  return (
    <Card className="border-card-border shadow-sm" data-testid="audit-pricing-card">
      <CardContent className="p-4 space-y-3">
        <div>
          <p className="text-sm font-medium">Billable task pricing</p>
          <p className="text-xs text-muted-foreground">
            What each kind of completed task bills the client. A blank price still adds the line but queues it for a price. Untick a kind to stop billing it automatically.
            {!isAdmin && <span className="text-warning"> Only admins can change these.</span>}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
          {BILLABLE_AUX_CATEGORIES.map(c => {
            const def = AUX_CATEGORIES[c]
            const st = def.serviceType!
            return (
              <div key={c} className="flex items-center gap-3 py-1 border-b border-border/40">
                <Checkbox checked={billable[c] ?? true} onCheckedChange={v => setBillable(b => ({ ...b, [c]: v === true }))} disabled={!isAdmin} data-testid={`pricing-billable-${c}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{def.label} <span className="text-muted-foreground">→ {st}</span></p>
                  <p className="text-2xs text-muted-foreground truncate" title={def.blurb}>{def.blurb}</p>
                </div>
                <div className="relative w-28">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <Input type="number" step="1" min="0" className="h-8 pl-5" value={prices[st] ?? ''} onChange={e => setPrices(p => ({ ...p, [st]: e.target.value }))} disabled={!isAdmin} placeholder="none" data-testid={`pricing-${c}`} />
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-2xs text-muted-foreground">
          Never billed: {(Object.keys(AUX_CATEGORIES) as AuxCategory[]).filter(c => !AUX_CATEGORIES[c].serviceType && c !== 'clean' && c !== 'no_clean' && c !== 'unclassified').map(c => AUX_CATEGORIES[c].label).join(', ')}. Cleans bill through the vendor invoice.
        </p>
        {isAdmin && (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="pricing-save">
              {save.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Save pricing
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
