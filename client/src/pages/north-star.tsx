import React, { useState, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Download } from 'lucide-react'
import { format, endOfMonth } from 'date-fns'
import Papa from 'papaparse'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'

const STATUS_COLORS: Record<string, string> = {
  'Green': 'bg-green-500',
  'Light Green': 'bg-green-300',
  'Yellow': 'bg-yellow-400',
  'Light Red': 'bg-orange-400',
  'Red': 'bg-red-500',
}

const STATUS_OPTIONS = ['Green', 'Light Green', 'Yellow', 'Light Red', 'Red']

function StatusDot({ status }: { status: string }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_COLORS[status] || 'bg-gray-300'}`} title={status} />
}

export default function NorthStarPage() {
  usePageTitle('North Star')
  const { effectiveUser } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canEdit = canEditView('north-star', effectiveUser)

  const [month, setMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [metricDialog, setMetricDialog] = useState<any>(null)
  const [metricForm, setMetricForm] = useState({ section: '', name: '', metric_type: 'Total', monthly_target: '', owner_name: '', source: 'manual' })

  // Parse month safely (avoid timezone issues with new Date('YYYY-MM-01'))
  const [mYear, mMonth] = month.split('-').map(Number)
  const monthDate = new Date(mYear, mMonth - 1, 1)
  const monthLabel = format(monthDate, 'MMMM yyyy')
  const MIN_MONTH = '2026-03'
  const maxMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  function prevMonth() {
    if (month <= MIN_MONTH) return
    const d = new Date(mYear, mMonth - 2, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  function nextMonth() {
    if (month >= maxMonth) return
    const d = new Date(mYear, mMonth, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // Build month options for dropdown (Mar 2026 → current month)
  const monthOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = []
    let d = new Date(2026, 2, 1) // March 2026
    const now = new Date()
    const endMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    while (d <= endMonth) {
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      opts.push({ value: val, label: format(d, 'MMMM yyyy') })
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    }
    return opts
  }, [])

  // ─── Queries ──────────────────────────────────────────────────────────────
  const { data: users } = useQuery({
    queryKey: ['/supabase/ns-users'],
    queryFn: async () => {
      const { data } = await supabase.from('app_users').select('id, label').order('label')
      return data || []
    },
  })

  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['/supabase/north-star-metrics'],
    queryFn: async () => {
      const { data } = await supabase.from('north_star_metrics').select('*').eq('enabled', true).order('section_order').order('sort_order')
      return data || []
    },
  })

  const { data: values } = useQuery({
    queryKey: ['/supabase/north-star-values', month],
    queryFn: async () => {
      const { data } = await supabase.from('north_star_values').select('*').eq('period', month)
      return data || []
    },
  })

  // Auto-source data for the month
  const monthStart = `${month}-01`
  const monthEnd = format(endOfMonth(monthDate), 'yyyy-MM-dd')

  const { data: autoIssues } = useQuery({
    queryKey: ['/supabase/ns-issues', month],
    queryFn: async () => {
      const { data } = await supabase.from('cleaning_issues').select('id, category, report_date').gte('report_date', monthStart).lte('report_date', monthEnd)
      return data || []
    },
  })

  const { data: autoTransitions } = useQuery({
    queryKey: ['/supabase/ns-transitions', month],
    queryFn: async () => {
      // Schema uses `created_at`, not `transitioned_at` — the previous query
      // silently returned null for the lifetime of the page.
      const { data } = await supabase
        .from('stage_transitions')
        .select('id, from_stage_id, to_stage_id, created_at, pipeline_stages!stage_transitions_to_stage_id_fkey(name)')
        .gte('created_at', monthStart)
        .lte('created_at', monthEnd + 'T23:59:59')
      return data || []
    },
  })

  const { data: autoCleans } = useQuery({
    queryKey: ['/supabase/ns-cleans', month],
    queryFn: async () => {
      const { data } = await supabase.from('cleaning_history').select('id').gte('clean_date', monthStart).lte('clean_date', monthEnd)
      return data || []
    },
  })

  const { data: autoVerifications } = useQuery({
    queryKey: ['/supabase/ns-verifications', month],
    queryFn: async () => {
      const { data } = await supabase.from('property_verifications').select('id, verified_at').not('verified_at', 'is', null).gte('verified_at', monthStart).lte('verified_at', monthEnd + 'T23:59:59')
      return data || []
    },
  })

  // Compute auto values
  function getAutoValue(source: string): number | null {
    if (!source || source === 'manual') return null
    if (source === 'issues:missed_cleans') return autoIssues?.filter(i => i.category === 'Missed Clean').length ?? null
    if (source === 'issues:general') return autoIssues?.filter(i => i.category !== 'Missed Clean').length ?? null
    if (source === 'pipeline:leads') {
      return autoTransitions?.filter((t: any) => (t.pipeline_stages as any)?.name === 'Lead').length ?? null
    }
    if (source === 'pipeline:quoted') {
      return autoTransitions?.filter((t: any) => (t.pipeline_stages as any)?.name === 'Quote').length ?? null
    }
    if (source === 'pipeline:closed') {
      return autoTransitions?.filter((t: any) => ['Onboarding', 'Active'].includes((t.pipeline_stages as any)?.name)).length ?? null
    }
    if (source === 'offboarded') {
      return autoTransitions?.filter((t: any) => (t.pipeline_stages as any)?.name === 'Offboarded').length ?? null
    }
    if (source === 'inspections') {
      const cleans = autoCleans?.length || 0
      const inspections = autoVerifications?.length || 0
      return cleans > 0 ? Math.round((inspections / cleans) * 10000) / 100 : 0
    }
    return null
  }

  // Group metrics by section
  const sections = useMemo(() => {
    if (!metrics) return []
    const map = new Map<string, any[]>()
    for (const m of metrics) {
      if (!map.has(m.section)) map.set(m.section, [])
      map.get(m.section)!.push(m)
    }
    return Array.from(map.entries())
  }, [metrics])

  const valuesByMetric = useMemo(() => {
    const map = new Map<string, any>()
    for (const v of (values || [])) map.set(v.metric_id, v)
    return map
  }, [values])

  // ─── Mutations ────────────────────────────────────────────────────────────
  async function saveValue(metricId: string, field: string, val: any) {
    const existing = valuesByMetric.get(metricId)
    if (existing) {
      await supabase.from('north_star_values').update({ [field]: val, updated_at: new Date().toISOString() }).eq('id', existing.id)
    } else {
      await supabase.from('north_star_values').insert({ metric_id: metricId, period: month, [field]: val })
    }
    qc.invalidateQueries({ queryKey: ['/supabase/north-star-values', month] })
  }

  async function saveMetric() {
    const payload = {
      section: metricForm.section,
      name: metricForm.name,
      metric_type: metricForm.metric_type,
      monthly_target: metricForm.monthly_target ? parseFloat(metricForm.monthly_target) : null,
      owner_name: metricForm.owner_name || null,
      source: metricForm.source,
    }
    if (metricDialog?.id) {
      await supabase.from('north_star_metrics').update(payload).eq('id', metricDialog.id)
    } else {
      const sectionMetrics = metrics?.filter(m => m.section === metricForm.section) || []
      await supabase.from('north_star_metrics').insert({
        ...payload,
        sort_order: sectionMetrics.length,
        section_order: metrics?.find(m => m.section === metricForm.section)?.section_order ?? sections.length,
      })
    }
    qc.invalidateQueries({ queryKey: ['/supabase/north-star-metrics'] })
    toast({ title: metricDialog?.id ? 'Metric updated' : 'Metric added' })
    setMetricDialog(null)
  }

  async function deleteMetric(id: string) {
    if (!confirm('Delete this metric?')) return
    await supabase.from('north_star_metrics').update({ enabled: false }).eq('id', id)
    qc.invalidateQueries({ queryKey: ['/supabase/north-star-metrics'] })
    toast({ title: 'Metric removed' })
  }

  function openEditMetric(m: any) {
    setMetricForm({
      section: m.section,
      name: m.name,
      metric_type: m.metric_type,
      monthly_target: m.monthly_target != null ? String(m.monthly_target) : '',
      owner_name: m.owner_name || '',
      source: m.source || 'manual',
    })
    setMetricDialog(m)
  }

  function openAddMetric(section?: string) {
    setMetricForm({ section: section || '', name: '', metric_type: 'Total', monthly_target: '', owner_name: '', source: 'manual' })
    setMetricDialog({ new: true })
  }

  function exportCsv() {
    const rows: any[] = []
    for (const [section, items] of sections) {
      rows.push({ Section: section, Metric: '', Week1: '', Week2: '', Week3: '', Week4: '', Target: '', Actual: '', Status: '', Owner: '', Source: '' })
      for (const m of items) {
        const v = valuesByMetric.get(m.id) || {}
        const auto = getAutoValue(m.source)
        rows.push({
          Section: '', Metric: m.name,
          Week1: v.week1 ?? '', Week2: v.week2 ?? '', Week3: v.week3 ?? '', Week4: v.week4 ?? '',
          Target: m.monthly_target ?? '', Actual: auto ?? v.monthly_actual ?? '',
          Status: v.status || 'Green', Owner: m.owner_name || '', Source: m.source || 'manual',
        })
      }
    }
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `north-star-${month}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const inputCls = 'h-7 text-xs text-center border border-transparent hover:border-input focus:border-input rounded px-1 bg-transparent focus:bg-background w-16 tabular-nums'

  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col md:overflow-auto">
      <PageHeader
        title="North Star"
        subtitle={`KPI scorecard — ${monthLabel}`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={prevMonth} disabled={month <= MIN_MONTH}><ChevronLeft className="w-4 h-4" /></Button>
              <select value={month} onChange={e => setMonth(e.target.value)} className="h-8 text-sm font-medium border border-input rounded-md px-2 bg-background min-w-[150px] text-center">
                {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={nextMonth} disabled={month >= maxMonth}><ChevronRight className="w-4 h-4" /></Button>
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={exportCsv}>
              <Download className="w-3.5 h-3.5" /> Export
            </Button>
            {canEdit && (
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => openAddMetric()}>
                <Plus className="w-3.5 h-3.5" /> Add Metric
              </Button>
            )}
          </div>
        }
      />

      {/* Scorecard table */}
      {metricsLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : sections.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No metrics configured. Click "Add Metric" to start.</div>
      ) : (
        <div className="overflow-auto rounded-2xl border border-border shadow-sm">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted border-b border-border z-20">
              <tr>
                <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[200px] sticky left-0 bg-muted z-20">Metric</th>
                <th className="text-center font-medium text-muted-foreground uppercase tracking-wide py-2 px-2 w-16">Wk 1</th>
                <th className="text-center font-medium text-muted-foreground uppercase tracking-wide py-2 px-2 w-16">Wk 2</th>
                <th className="text-center font-medium text-muted-foreground uppercase tracking-wide py-2 px-2 w-16">Wk 3</th>
                <th className="text-center font-medium text-muted-foreground uppercase tracking-wide py-2 px-2 w-16">Wk 4</th>
                <th className="text-center font-medium text-muted-foreground uppercase tracking-wide py-2 px-2 w-20">Target</th>
                <th className="text-center font-medium text-muted-foreground uppercase tracking-wide py-2 px-2 w-16">Type</th>
                <th className="text-center font-medium text-muted-foreground uppercase tracking-wide py-2 px-2 w-20">Actual</th>
                <th className="text-center font-medium text-muted-foreground uppercase tracking-wide py-2 px-2 w-14">Status</th>
                <th className="text-center font-medium text-muted-foreground uppercase tracking-wide py-2 px-2 w-20">Owner</th>
                <th className="text-center font-medium text-muted-foreground uppercase tracking-wide py-2 px-2 w-20">Source</th>
                {canEdit && <th className="w-16 py-2 px-2" />}
              </tr>
            </thead>
            <tbody>
              {sections.map(([section, items]) => (
                <React.Fragment key={section}>
                  <tr className="bg-muted/50">
                    <td colSpan={canEdit ? 12 : 11} className="py-2 px-3 font-semibold text-xs uppercase tracking-wide text-foreground sticky left-0 bg-muted/50 z-10">
                      {section}
                      {canEdit && (
                        <button onClick={() => openAddMetric(section)} className="ml-2 text-muted-foreground hover:text-foreground"><Plus className="w-3 h-3 inline" /></button>
                      )}
                    </td>
                  </tr>
                  {items.map((m: any) => {
                    const v = valuesByMetric.get(m.id) || {}
                    const autoVal = getAutoValue(m.source)
                    const actual = autoVal ?? v.monthly_actual
                    const isAuto = autoVal !== null
                    return (
                      <tr key={m.id} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="py-1.5 px-3 font-medium sticky left-0 bg-background z-10">{m.name}</td>
                        {(['week1', 'week2', 'week3', 'week4'] as const).map(wk => (
                          <td key={wk} className="py-1.5 px-1 text-center">
                            {canEdit ? (
                              <input
                                type="number"
                                defaultValue={v[wk] ?? ''}
                                onBlur={e => { const val = e.target.value ? parseFloat(e.target.value) : null; if (val !== (v[wk] ?? null)) saveValue(m.id, wk, val) }}
                                className={inputCls}
                              />
                            ) : (
                              <span className="tabular-nums">{v[wk] ?? '—'}</span>
                            )}
                          </td>
                        ))}
                        <td className="py-1.5 px-2 text-center tabular-nums font-medium">{m.monthly_target ?? '—'}</td>
                        <td className="py-1.5 px-2 text-center text-muted-foreground">{m.metric_type}</td>
                        <td className="py-1.5 px-1 text-center">
                          {isAuto ? (
                            <span className="tabular-nums font-medium" title="Auto-computed">{typeof actual === 'number' ? (actual % 1 === 0 ? actual : actual.toFixed(1)) : '—'}</span>
                          ) : canEdit ? (
                            <input
                              type="number"
                              defaultValue={v.monthly_actual ?? ''}
                              onBlur={e => { const val = e.target.value ? parseFloat(e.target.value) : null; if (val !== (v.monthly_actual ?? null)) saveValue(m.id, 'monthly_actual', val) }}
                              className={inputCls}
                            />
                          ) : (
                            <span className="tabular-nums">{v.monthly_actual ?? '—'}</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          {canEdit ? (
                            <select
                              value={v.status || 'Green'}
                              onChange={e => saveValue(m.id, 'status', e.target.value)}
                              className="h-6 text-2xs border-none bg-transparent cursor-pointer"
                            >
                              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          ) : (
                            <StatusDot status={v.status || 'Green'} />
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-center text-muted-foreground">{m.owner_name || '—'}</td>
                        <td className="py-1.5 px-2 text-center">
                          {isAuto ? (
                            <span className="text-2xs bg-info/10 text-info px-1.5 py-0.5 rounded">auto</span>
                          ) : (
                            <span className="text-muted-foreground">manual</span>
                          )}
                        </td>
                        {canEdit && (
                          <td className="py-1.5 px-1 text-center">
                            <div className="flex items-center gap-1 justify-center">
                              <button onClick={() => openEditMetric(m)} className="text-muted-foreground hover:text-foreground"><Pencil className="w-3 h-3" /></button>
                              <button onClick={() => deleteMetric(m.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Metric Dialog */}
      <Dialog open={!!metricDialog} onOpenChange={v => !v && setMetricDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{metricDialog?.id ? 'Edit Metric' : 'Add Metric'}</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Section</label>
              <Input value={metricForm.section} onChange={e => setMetricForm(f => ({ ...f, section: e.target.value }))} className="h-8 text-xs" placeholder="e.g. Finance" list="sections-list" />
              <datalist id="sections-list">
                {sections.map(([s]) => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Metric Name *</label>
              <Input value={metricForm.name} onChange={e => setMetricForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Type</label>
                <select value={metricForm.metric_type} onChange={e => setMetricForm(f => ({ ...f, metric_type: e.target.value }))} className="w-full h-8 text-xs border border-input rounded px-2 bg-background">
                  <option value="Total">Total</option>
                  <option value="Avg">Average</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Monthly Target</label>
                <Input type="number" value={metricForm.monthly_target} onChange={e => setMetricForm(f => ({ ...f, monthly_target: e.target.value }))} className="h-8 text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Owner</label>
                <select value={metricForm.owner_name} onChange={e => setMetricForm(f => ({ ...f, owner_name: e.target.value }))} className="w-full h-8 text-xs border border-input rounded px-2 bg-background">
                  <option value="">Unassigned</option>
                  {(users || []).map((u: any) => <option key={u.id} value={u.label}>{u.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Data Source</label>
                <select value={metricForm.source} onChange={e => setMetricForm(f => ({ ...f, source: e.target.value }))} className="w-full h-8 text-xs border border-input rounded px-2 bg-background">
                  <option value="manual">Manual</option>
                  <option value="issues:missed_cleans">Issues: Missed Cleans</option>
                  <option value="issues:general">Issues: General</option>
                  <option value="pipeline:leads">Pipeline: New Leads</option>
                  <option value="pipeline:quoted">Pipeline: Quoted</option>
                  <option value="pipeline:closed">Pipeline: Deals Closed</option>
                  <option value="offboarded">Offboarded Properties</option>
                  <option value="inspections">% Cleans Inspected</option>
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMetricDialog(null)}>Cancel</Button>
            <Button onClick={saveMetric} disabled={!metricForm.name.trim() || !metricForm.section.trim()}>
              {metricDialog?.id ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
