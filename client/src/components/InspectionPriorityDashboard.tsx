import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, AlertTriangle, Calendar, ChevronRight, Sparkles, Clock } from 'lucide-react'
import { differenceInCalendarDays, format } from 'date-fns'

interface PropertyRow {
  id: number
  name: string
  address: string | null
  stage_id: number | null
  pipeline_stages?: { name: string | null } | null
}

interface InspectionRow {
  id: string
  property_id: number | null
  inspected_at: string
  scheduled_for: string | null
  status: 'scheduled' | 'completed' | 'skipped'
  overall_score: number | null
  cleanliness_score: number | null
  linens_score: number | null
  supplies_score: number | null
  exterior_score: number | null
}

interface PropertyAggregate {
  property: PropertyRow
  totalInspections: number
  completedInspections: number
  lastCompleted: InspectionRow | null
  hasScheduled: boolean
  avgOverall: number | null
  avgCleanliness: number | null
  avgLinens: number | null
  avgSupplies: number | null
  avgExterior: number | null
  daysSinceLast: number | null
  priority: number
  priorityReason: string
}

const ACTIVE_STAGE_ID = 4

function avg(nums: (number | null)[]): number | null {
  const filtered = nums.filter((n): n is number => n != null)
  if (!filtered.length) return null
  return filtered.reduce((a, b) => a + b, 0) / filtered.length
}

function computePriority(property: PropertyRow, inspections: InspectionRow[]): PropertyAggregate {
  const completed = inspections.filter(i => i.status === 'completed').sort((a, b) => (a.inspected_at < b.inspected_at ? 1 : -1))
  const hasScheduled = inspections.some(i => i.status === 'scheduled')
  const lastCompleted = completed[0] ?? null

  const avgOverall = avg(completed.map(i => i.overall_score))
  const avgCleanliness = avg(completed.map(i => i.cleanliness_score))
  const avgLinens = avg(completed.map(i => i.linens_score))
  const avgSupplies = avg(completed.map(i => i.supplies_score))
  const avgExterior = avg(completed.map(i => i.exterior_score))

  let priority = 0
  let priorityReason = ''
  let daysSinceLast: number | null = null

  if (!lastCompleted) {
    priority = 100
    priorityReason = 'Never inspected'
  } else {
    daysSinceLast = differenceInCalendarDays(new Date(), new Date(lastCompleted.inspected_at))
    const score = lastCompleted.overall_score ?? 3
    // Score component (0–80): a 1 → 80, a 5 → 0. Bad scores dominate the rank.
    const scoreComponent = (5 - score) * 20
    // Recency component (0–100): caps at 90 days. Longer ago → higher priority.
    const recencyComponent = Math.min(daysSinceLast / 90, 1) * 100
    // Bad-recent (~52) > good-old (~35) by design — score weight > recency weight.
    priority = 0.65 * scoreComponent + 0.35 * recencyComponent

    const tags: string[] = []
    if (score <= 2) tags.push(`Last score ${score.toFixed(1)}`)
    else if (score < 3.5) tags.push(`Last score ${score.toFixed(1)} (mediocre)`)
    if (daysSinceLast >= 90) tags.push(`${daysSinceLast}d since last`)
    else if (daysSinceLast >= 60) tags.push(`Overdue (${daysSinceLast}d)`)
    priorityReason = tags.join(' · ') || `Last score ${score.toFixed(1)}, ${daysSinceLast}d ago`
  }

  // De-prioritize properties already scheduled — visible, but lower in the list.
  if (hasScheduled && priority < 100) priority *= 0.5

  return {
    property,
    totalInspections: inspections.length,
    completedInspections: completed.length,
    lastCompleted,
    hasScheduled,
    avgOverall,
    avgCleanliness,
    avgLinens,
    avgSupplies,
    avgExterior,
    daysSinceLast,
    priority,
    priorityReason,
  }
}

function priorityColor(p: number): string {
  if (p >= 85) return 'bg-red-500'
  if (p >= 65) return 'bg-orange-500'
  if (p >= 40) return 'bg-amber-500'
  if (p >= 20) return 'bg-emerald-500'
  return 'bg-sky-500'
}

function priorityLabel(p: number): string {
  if (p >= 85) return 'Critical'
  if (p >= 65) return 'High'
  if (p >= 40) return 'Medium'
  if (p >= 20) return 'Low'
  return 'OK'
}

function scoreTextClass(n: number | null): string {
  if (n == null) return 'text-muted-foreground'
  if (n >= 4) return 'text-green-700 dark:text-green-400'
  if (n >= 3) return 'text-amber-700 dark:text-amber-400'
  return 'text-red-700 dark:text-red-400'
}

export function InspectionPriorityDashboard() {
  const { effectiveUser } = useAuth()
  const { openPropertyModal } = usePropertyModal()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canEdit = canEditView('inspections', effectiveUser)

  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<'active' | 'active_onboarding' | 'all'>('active')
  const [scheduleFor, setScheduleFor] = useState<Record<number, string>>({})
  const [working, setWorking] = useState<number | null>(null)

  const { data: properties, isLoading: propertiesLoading } = useQuery<PropertyRow[]>({
    queryKey: ['/supabase/inspection-priority/properties', stageFilter],
    queryFn: async () => {
      let q = supabase.from('properties').select('id, name, address, stage_id, pipeline_stages(name)').order('name').eq('exempt_from_inspections', false)
      if (stageFilter === 'active') q = q.eq('stage_id', ACTIVE_STAGE_ID)
      else if (stageFilter === 'active_onboarding') q = q.in('stage_id', [3, ACTIVE_STAGE_ID])
      else q = q.in('stage_id', [1, 2, 3, ACTIVE_STAGE_ID])
      const { data, error } = await q.limit(2000)
      if (error) throw error
      return (data ?? []) as unknown as PropertyRow[]
    },
  })

  const { data: inspections, isLoading: inspectionsLoading } = useQuery<InspectionRow[]>({
    queryKey: ['/supabase/inspection-priority/inspections'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspections')
        .select('id, property_id, inspected_at, scheduled_for, status, overall_score, cleanliness_score, linens_score, supplies_score, exterior_score')
        .order('inspected_at', { ascending: false })
        .limit(5000)
      if (error) throw error
      return (data ?? []) as unknown as InspectionRow[]
    },
  })

  const aggregates = useMemo<PropertyAggregate[]>(() => {
    if (!properties || !inspections) return []
    const byProperty = new Map<number, InspectionRow[]>()
    for (const i of inspections) {
      if (i.property_id == null) continue
      const arr = byProperty.get(i.property_id) ?? []
      arr.push(i)
      byProperty.set(i.property_id, arr)
    }
    return properties.map(p => computePriority(p, byProperty.get(p.id) ?? []))
      .sort((a, b) => b.priority - a.priority)
  }, [properties, inspections])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return aggregates
    return aggregates.filter(a =>
      a.property.name.toLowerCase().includes(q) ||
      (a.property.address ?? '').toLowerCase().includes(q),
    )
  }, [aggregates, search])

  const summary = useMemo(() => {
    const neverInspected = filtered.filter(a => !a.lastCompleted).length
    const critical = filtered.filter(a => a.priority >= 85).length
    const high = filtered.filter(a => a.priority >= 65 && a.priority < 85).length
    const overdue = filtered.filter(a => a.daysSinceLast != null && a.daysSinceLast >= 60).length
    return { neverInspected, critical, high, overdue, total: filtered.length }
  }, [filtered])

  const scheduleMut = useMutation({
    mutationFn: async ({ propertyId, date }: { propertyId: number; date: string }) => {
      setWorking(propertyId)
      const { error } = await supabase.from('inspections').insert({
        property_id: propertyId,
        status: 'scheduled',
        scheduled_for: date,
        inspected_at: date,
        reinspect_urgency: 'none',
      } as any)
      if (error) throw error
    },
    onSuccess: (_void, vars) => {
      toast({ title: 'Inspection scheduled', description: `For ${vars.date}` })
      setScheduleFor(prev => { const next = { ...prev }; delete next[vars.propertyId]; return next })
      qc.invalidateQueries({ queryKey: ['/supabase/inspection-priority/inspections'] })
      qc.invalidateQueries({ queryKey: ['/supabase/inspections-all'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-inspections'] })
      setWorking(null)
    },
    onError: (e: any) => {
      toast({ title: 'Schedule failed', description: e?.message || 'Try again.', variant: 'destructive' })
      setWorking(null)
    },
  })

  const isLoading = propertiesLoading || inspectionsLoading
  const tomorrow = format(new Date(Date.now() + 86400000), 'yyyy-MM-dd')

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <SummaryCard label="Critical" value={summary.critical} hint="Priority ≥ 85" tone="critical" icon={<AlertTriangle className="w-4 h-4" />} />
        <SummaryCard label="High" value={summary.high} hint="Priority 65–84" tone="high" icon={<Sparkles className="w-4 h-4" />} />
        <SummaryCard label="Overdue" value={summary.overdue} hint="60+ days since last" tone="medium" icon={<Clock className="w-4 h-4" />} />
        <SummaryCard label="Never inspected" value={summary.neverInspected} hint="No completed inspections" tone="info" icon={<Calendar className="w-4 h-4" />} />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search property or address…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <label className="text-muted-foreground ml-2">Show</label>
        <Select value={stageFilter} onValueChange={(v) => setStageFilter(v as typeof stageFilter)}>
          <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active" className="text-xs">Active only</SelectItem>
            <SelectItem value="active_onboarding" className="text-xs">Active + Onboarding</SelectItem>
            <SelectItem value="all" className="text-xs">All pre-offboard</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-muted-foreground ml-auto">{filtered.length} propert{filtered.length === 1 ? 'y' : 'ies'}</span>
      </div>

      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No properties match.</CardContent></Card>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          {filtered.map((a, idx) => {
            const isWorking = working === a.property.id
            const pickedDate = scheduleFor[a.property.id]
            return (
              <div key={a.property.id} className={`px-3 py-3 sm:px-4 border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors ${idx % 2 === 1 ? 'bg-muted/10' : ''}`}>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex flex-col items-center w-12 shrink-0" title={a.priorityReason}>
                    <div className={`w-9 h-9 rounded-md flex items-center justify-center text-white text-xs font-semibold ${priorityColor(a.priority)}`}>
                      {Math.round(a.priority)}
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-0.5">{priorityLabel(a.priority)}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => openPropertyModal(String(a.property.id))}
                    className="flex-1 min-w-[180px] text-left group"
                    data-testid={`button-open-property-${a.property.id}`}
                  >
                    <div className="font-medium text-sm flex items-center gap-1.5">
                      {a.property.name}
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{a.property.address || '—'}</div>
                    {a.priorityReason && (
                      <div className="text-xs text-muted-foreground/80 mt-0.5">{a.priorityReason}</div>
                    )}
                  </button>

                  <div className="flex flex-col items-end shrink-0 min-w-[120px]">
                    <div className="text-[11px] text-muted-foreground">Last inspected</div>
                    <div className="text-sm font-medium">
                      {a.lastCompleted ? format(new Date(a.lastCompleted.inspected_at), 'MMM d, yyyy') : <span className="text-muted-foreground italic">Never</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {a.completedInspections} completed{a.hasScheduled ? ' · 1 scheduled' : ''}
                    </div>
                  </div>

                  <div className="hidden md:flex items-center gap-2 text-[11px] shrink-0">
                    <ScoreCell label="Avg" v={a.avgOverall} bold />
                    <ScoreCell label="Clean" v={a.avgCleanliness} />
                    <ScoreCell label="Linens" v={a.avgLinens} />
                    <ScoreCell label="Suppl" v={a.avgSupplies} />
                    <ScoreCell label="Ext" v={a.avgExterior} />
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="date"
                        value={pickedDate ?? tomorrow}
                        onChange={e => setScheduleFor(prev => ({ ...prev, [a.property.id]: e.target.value }))}
                        className="h-8 text-xs border border-input rounded px-2 bg-background"
                        data-testid={`input-schedule-date-${a.property.id}`}
                      />
                      <Button
                        size="sm"
                        variant={a.hasScheduled ? 'outline' : 'default'}
                        onClick={() => scheduleMut.mutate({ propertyId: a.property.id, date: pickedDate || tomorrow })}
                        disabled={isWorking}
                        className="h-8 text-xs"
                        data-testid={`button-schedule-${a.property.id}`}
                      >
                        <Calendar className="w-3.5 h-3.5 mr-1" />
                        {a.hasScheduled ? 'Re-schedule' : 'Schedule'}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="md:hidden flex items-center gap-2 mt-2 text-[11px] pl-[60px]">
                  <ScoreCell label="Avg" v={a.avgOverall} bold />
                  <ScoreCell label="Clean" v={a.avgCleanliness} />
                  <ScoreCell label="Linens" v={a.avgLinens} />
                  <ScoreCell label="Suppl" v={a.avgSupplies} />
                  <ScoreCell label="Ext" v={a.avgExterior} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, hint, tone, icon }: { label: string; value: number; hint: string; tone: 'critical' | 'high' | 'medium' | 'info'; icon: React.ReactNode }) {
  const toneCls = {
    critical: 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400',
    high: 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900/50 text-orange-700 dark:text-orange-400',
    medium: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 text-amber-700 dark:text-amber-400',
    info: 'bg-sky-50 dark:bg-sky-950/20 border-sky-200 dark:border-sky-900/50 text-sky-700 dark:text-sky-400',
  }[tone]
  return (
    <div className={`rounded-lg border p-3 ${toneCls}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-medium opacity-80">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums mt-0.5">{value}</div>
      <div className="text-[11px] opacity-70 mt-0.5">{hint}</div>
    </div>
  )
}

function ScoreCell({ label, v, bold }: { label: string; v: number | null; bold?: boolean }) {
  return (
    <div className="flex flex-col items-center px-1.5 py-1 rounded bg-muted/40 min-w-[44px]">
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${bold ? 'font-semibold' : ''} ${scoreTextClass(v)}`}>{v != null ? v.toFixed(1) : '—'}</span>
    </div>
  )
}
