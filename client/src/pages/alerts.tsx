import { useState, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth, canAccessView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useLocation } from 'wouter'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { StatusTone, TONE_TEXT } from '@/lib/status-colors'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  AlertTriangle, AlertCircle, Info, Building2, Wind, BedDouble, ClipboardCheck, Users,
  X, Clock, ExternalLink, CheckCircle2, ShieldAlert, Filter,
} from 'lucide-react'

interface Alert {
  id: string
  severity: 'critical' | 'warning' | 'info'
  category: string
  title: string
  description: string
  actionLabel?: string
  actionRoute?: string
  propertyId?: string
  requiredView?: string // view the user must have access to in order to see this alert
}

const SEVERITY_CONFIG: Record<'critical' | 'warning' | 'info', { icon: typeof AlertTriangle; tone: StatusTone; bg: string }> = {
  critical: { icon: AlertTriangle, tone: 'destructive', bg: 'bg-destructive/5 border-destructive/25' },
  warning: { icon: AlertCircle, tone: 'warning', bg: 'bg-warning/5 border-warning/25' },
  info: { icon: Info, tone: 'info', bg: 'bg-info/5 border-info/25' },
}

export function useAlerts() {
  const { effectiveUser } = useAuth()
  const { data: properties, isError, refetch } = useQuery({
    queryKey: ['/supabase/alerts-properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, stage_id, ce_charged, cleaner_pay, estimated_profit, profit_percentage, bedrooms, address, king_beds, queen_beds, full_beds, twin_beds, bath_towels, washcloths, hand_towels, bathmats, pool_towels, next_filter_due, pipeline_stages!properties_stage_id_fkey(name)')
        .not('pipeline_stages.name', 'in', '("Offboarded","Lead","Quote","Offboarding")')
      if (error) throw error
      return data || []
    },
    staleTime: 120_000,
  })

  const { data: onboardingTasks } = useQuery({
    queryKey: ['/supabase/alerts-onboarding'],
    queryFn: async () => {
      const { data, error } = await supabase.from('onboarding_tasks').select('property_id, is_complete, created_at')
      if (error) throw error
      return data || []
    },
    staleTime: 30_000,
  })

  const { data: contacts } = useQuery({
    queryKey: ['/supabase/alerts-contacts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('id, created_at, properties:properties(id)')
      if (error) throw error
      return data || []
    },
    staleTime: 30_000,
  })

  // In-app mirror of the two email-digest sections (api/notify/digest.ts) —
  // same filter contract: overdue needs_attention issues, unacked guest
  // feedback. Kept as separate lightweight queries (not the full-fat
  // `issue_catchup_feed` the Issues page reads) since alerts only need a
  // handful of display fields.
  const { data: overdueIssues } = useQuery({
    queryKey: ['/supabase/alerts-issues-overdue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cleaning_issues')
        .select('id, property_name, category, priority, due_date')
        .eq('issue_type', 'needs_attention')
        .neq('status', 'Completed')
        .lte('due_date', new Date().toISOString().split('T')[0])
        .order('due_date', { ascending: true })
        .limit(50)
      if (error) return []
      return data || []
    },
    staleTime: 60_000,
  })

  const { data: unackedFeedback } = useQuery({
    queryKey: ['/supabase/alerts-issues-unacked'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cleaning_issues')
        .select('id, property_name, category, report_date')
        .eq('issue_type', 'guest_feedback')
        .is('acknowledged_at', null)
        .order('report_date', { ascending: true })
        .limit(50)
      if (error) return []
      return data || []
    },
    staleTime: 60_000,
  })

  const { data: dismissals } = useQuery({
    queryKey: ['/supabase/alert-dismissals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alert_dismissals')
        .select('alert_key, snoozed_until')
      if (error) return []
      return data || []
    },
    staleTime: 30_000,
  })

  const alerts = useMemo(() => {
    if (!properties) return []
    const result: Alert[] = []
    const today = new Date().toISOString().split('T')[0]
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    for (const p of properties) {
      const stageName = (p.pipeline_stages as any)?.name
      if (stageName === 'Offboarded' || stageName === 'Lead' || stageName === 'Quote' || stageName === 'Offboarding') continue

      // Critical: Negative Profit — skip $0 CE properties (those are missing data, not truly negative)
      if ((p.profit_percentage || 0) < 0 && (p.ce_charged || 0) > 0) {
        result.push({
          id: `negative_profit_${p.id}`,
          severity: 'critical',
          category: 'Financial',
          title: `Negative Profit: ${p.name}`,
          description: `Profit is ${(p.profit_percentage || 0).toFixed(1)}% - losing money on this property.`,
          actionRoute: '/cost-tracking',
          propertyId: String(p.id),
          requiredView: 'cost-tracking',
        })
      }

      // Warning: Missing financial data ($0 CE for active properties)
      if (stageName === 'Active' && (p.ce_charged == null || p.ce_charged === 0)) {
        result.push({
          id: `missing_financial_${p.id}`,
          severity: 'warning',
          category: 'Data Quality',
          title: `Missing Financial Data: ${p.name}`,
          description: 'Client Charged is $0 - profit calculations are unreliable until this is set.',
          actionRoute: '/cost-tracking',
          propertyId: String(p.id),
          requiredView: 'cost-tracking',
        })
      }

      // Critical: Missing Critical Data
      if (!p.address || !p.bedrooms) {
        const missing = []
        if (!p.address) missing.push('address')
        if (!p.bedrooms) missing.push('bedrooms')
        result.push({
          id: `missing_data_${p.id}`,
          severity: 'critical',
          category: 'Data Quality',
          title: `Missing Data: ${p.name}`,
          description: `Missing: ${missing.join(', ')}`,
          propertyId: String(p.id),
          actionRoute: '/master-list',
          requiredView: 'master-list',
        })
      }

      // Warning: AC Filter Overdue
      if (p.next_filter_due && p.next_filter_due < today) {
        result.push({
          id: `ac_overdue_${p.id}`,
          severity: 'warning',
          category: 'Maintenance',
          title: `AC Filter Overdue: ${p.name}`,
          description: `Filter was due ${p.next_filter_due}`,
          actionRoute: '/ac-filters',
          propertyId: String(p.id),
          requiredView: 'ac-filters',
        })
      }

    }

    // Info: Onboarding Stalled
    if (onboardingTasks) {
      const byProperty: Record<string, { total: number; completed: number; oldest: string }> = {}
      for (const t of onboardingTasks) {
        if (t.property_id == null || t.created_at == null) continue
        const key = String(t.property_id)
        if (!byProperty[key]) byProperty[key] = { total: 0, completed: 0, oldest: t.created_at }
        byProperty[key].total++
        if (t.is_complete) byProperty[key].completed++
        if (t.created_at < byProperty[key].oldest) byProperty[key].oldest = t.created_at
      }
      for (const [pid, data] of Object.entries(byProperty)) {
        const pct = data.total > 0 ? data.completed / data.total : 1
        if (pct < 0.5 && data.oldest < fourteenDaysAgo) {
          const prop = properties.find((p: any) => String(p.id) === String(pid))
          if (prop) {
            result.push({
              id: `onboarding_stalled_${pid}`,
              severity: 'info',
              category: 'Onboarding',
              title: `Onboarding Stalled: ${prop.name}`,
              description: `Only ${Math.round(pct * 100)}% complete after 14+ days`,
              propertyId: pid,
              requiredView: 'pipeline',
            })
          }
        }
      }
    }

    // Warning/Critical: Overdue Needs-Attention issues (mirrors the email digest)
    for (const i of (overdueIssues || [])) {
      result.push({
        id: `issue-overdue-${i.id}`,
        severity: i.priority === 'urgent' ? 'critical' : 'warning',
        category: 'Issues',
        title: `Overdue Issue: ${i.property_name || '(no property)'}`,
        description: `${i.category || ''} - due ${i.due_date || '-'} (${i.priority || 'normal'})`,
        actionRoute: '/issues',
        requiredView: 'issues',
      })
    }

    // Info: Unacknowledged guest feedback (mirrors the email digest)
    for (const i of (unackedFeedback || [])) {
      result.push({
        id: `issue-feedback-${i.id}`,
        severity: 'info',
        category: 'Issues',
        title: `Unacknowledged Feedback: ${i.property_name || '(no property)'}`,
        description: `${i.category || ''} - reported ${i.report_date || '-'}`,
        actionRoute: '/issues',
        requiredView: 'issues',
      })
    }

    // Info: New Contact Unlinked
    if (contacts) {
      for (const c of contacts) {
        const props = (c as any).properties || []
        if (props.length === 0 && c.created_at != null && c.created_at < sevenDaysAgo) {
          result.push({
            id: `unlinked_contact_${c.id}`,
            severity: 'info',
            category: 'CRM',
            title: 'Unlinked Client',
            description: `Client created 7+ days ago with no properties linked`,
            actionRoute: '/contacts',
            requiredView: 'contacts',
          })
        }
      }
    }

    // Sort by severity
    const order = { critical: 0, warning: 1, info: 2 }
    result.sort((a, b) => order[a.severity] - order[b.severity])
    return result
  }, [properties, onboardingTasks, contacts, overdueIssues, unackedFeedback])

  const dismissedSet = useMemo(() => {
    const set = new Set<string>()
    for (const d of (dismissals || [])) {
      if (d.snoozed_until) {
        if (new Date(d.snoozed_until) > new Date()) set.add(d.alert_key)
      } else {
        set.add(d.alert_key)
      }
    }
    return set
  }, [dismissals])

  const activeAlerts = useMemo(() => {
    return alerts
      .filter(a => !dismissedSet.has(a.id))
      .filter(a => !a.requiredView || canAccessView(a.requiredView, effectiveUser))
  }, [alerts, dismissedSet, effectiveUser])

  const badgeCount = useMemo(() => {
    return activeAlerts.filter(a => a.severity === 'critical' || a.severity === 'warning').length
  }, [activeAlerts])

  return { alerts, activeAlerts, badgeCount, dismissedSet, isError, refetch }
}

type SeverityFilter = 'all' | 'critical' | 'warning' | 'info'

export default function AlertsPage() {
  usePageTitle('Alerts')
  const [, navigate] = useLocation()
  const { openPropertyModal } = usePropertyModal()
  const { alerts, dismissedSet, isError, refetch } = useAlerts()
  const qcAlerts = useQueryClient()
  const [showDismissed, setShowDismissed] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>('All')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const { effectiveUser } = useAuth()
  const canViewFinancials = canAccessView('cost-tracking', effectiveUser) || canAccessView('financial-dashboard', effectiveUser)

  const visibleAlerts = useMemo(() => {
    let base = showDismissed ? alerts : alerts.filter(a => !dismissedSet.has(a.id))
    if (!canViewFinancials) base = base.filter(a => a.category !== 'Financial')
    if (categoryFilter !== 'All') base = base.filter(a => a.category === categoryFilter)
    if (severityFilter !== 'all') base = base.filter(a => a.severity === severityFilter)
    return base
  }, [alerts, showDismissed, dismissedSet, categoryFilter, severityFilter, canViewFinancials])

  const categoryCounts = useMemo(() => {
    const base = showDismissed ? alerts : alerts.filter(a => !dismissedSet.has(a.id))
    const counts: Record<string, number> = { All: base.length }
    for (const a of base) {
      counts[a.category] = (counts[a.category] || 0) + 1
    }
    return counts
  }, [alerts, showDismissed, dismissedSet])

  const handleDismiss = useCallback(async (id: string) => {
    await supabase.from('alert_dismissals').upsert({ alert_key: id, dismissed_at: new Date().toISOString(), snoozed_until: null }, { onConflict: 'alert_key' })
    qcAlerts.invalidateQueries({ queryKey: ['/supabase/alert-dismissals'] })
  }, [qcAlerts])

  const handleSnooze = useCallback(async (id: string, days: number) => {
    const snoozedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    await supabase.from('alert_dismissals').upsert({ alert_key: id, snoozed_until: snoozedUntil }, { onConflict: 'alert_key' })
    qcAlerts.invalidateQueries({ queryKey: ['/supabase/alert-dismissals'] })
  }, [qcAlerts])

  const handleUndismiss = useCallback(async (id: string) => {
    await supabase.from('alert_dismissals').delete().eq('alert_key', id)
    qcAlerts.invalidateQueries({ queryKey: ['/supabase/alert-dismissals'] })
  }, [qcAlerts])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      const visibleIds = visibleAlerts.filter(a => !dismissedSet.has(a.id)).map(a => a.id)
      if (visibleIds.length > 0 && visibleIds.every(id => prev.has(id))) {
        return new Set()
      }
      return new Set(visibleIds)
    })
  }, [visibleAlerts, dismissedSet])

  const bulkDismiss = useCallback(async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    await Promise.all(ids.map(id =>
      supabase.from('alert_dismissals').upsert(
        { alert_key: id, dismissed_at: new Date().toISOString(), snoozed_until: null },
        { onConflict: 'alert_key' }
      )
    ))
    setSelectedIds(new Set())
    qcAlerts.invalidateQueries({ queryKey: ['/supabase/alert-dismissals'] })
  }, [selectedIds, qcAlerts])

  const bulkSnooze = useCallback(async (days: number) => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const snoozedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    await Promise.all(ids.map(id =>
      supabase.from('alert_dismissals').upsert(
        { alert_key: id, snoozed_until: snoozedUntil },
        { onConflict: 'alert_key' }
      )
    ))
    setSelectedIds(new Set())
    qcAlerts.invalidateQueries({ queryKey: ['/supabase/alert-dismissals'] })
  }, [selectedIds, qcAlerts])

  const criticalCount = alerts.filter(a => a.severity === 'critical' && !dismissedSet.has(a.id)).length
  const warningCount = alerts.filter(a => a.severity === 'warning' && !dismissedSet.has(a.id)).length
  const infoCount = alerts.filter(a => a.severity === 'info' && !dismissedSet.has(a.id)).length

  const selectableVisible = visibleAlerts.filter(a => !dismissedSet.has(a.id))
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every(a => selectedIds.has(a.id))
  const dismissedCount = alerts.filter(a => dismissedSet.has(a.id)).length

  const SEVERITY_PILLS: Array<{ value: SeverityFilter; label: string; count: number; cls: string }> = [
    { value: 'all', label: 'All', count: criticalCount + warningCount + infoCount, cls: 'border-border' },
    { value: 'critical', label: 'Critical', count: criticalCount, cls: `border-destructive/40 ${TONE_TEXT.destructive}` },
    { value: 'warning', label: 'Warning', count: warningCount, cls: `border-warning/40 ${TONE_TEXT.warning}` },
    { value: 'info', label: 'Info', count: infoCount, cls: `border-info/40 ${TONE_TEXT.info}` },
  ]

  if (isError) {
    return (
      <PageContainer>
        <PageHeader title="Alerts" />
        <ErrorState onRetry={() => refetch()} />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Alerts"
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-destructive" /> {criticalCount} critical</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning" /> {warningCount} warning</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-info" /> {infoCount} info</span>
            {dismissedCount > 0 && <span className="text-muted-foreground/70">· {dismissedCount} dismissed</span>}
          </span>
        }
        actions={
          <>
            {warningCount > 3 && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={async () => {
                const toDismiss = alerts.filter(a => a.severity === 'warning' && !dismissedSet.has(a.id))
                await Promise.all(toDismiss.map(a =>
                  supabase.from('alert_dismissals').upsert({ alert_key: a.id, dismissed_at: new Date().toISOString(), snoozed_until: null }, { onConflict: 'alert_key' })
                ))
                qcAlerts.invalidateQueries({ queryKey: ['/supabase/alert-dismissals'] })
              }}>
                Dismiss All Warnings ({warningCount})
              </Button>
            )}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={showDismissed} onCheckedChange={setShowDismissed} />
              Show dismissed ({dismissedCount})
            </label>
          </>
        }
      />

      {/* Severity filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground/70 mr-1">Severity</span>
        {SEVERITY_PILLS.map(p => (
          <button
            key={p.value}
            onClick={() => setSeverityFilter(p.value)}
            className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
              severityFilter === p.value
                ? 'bg-primary text-primary-foreground border-primary'
                : `bg-background ${p.cls} hover:bg-muted`
            }`}
          >
            {p.label}
            <span className="ml-1.5 tabular-nums opacity-80">{p.count}</span>
          </button>
        ))}
      </div>

      {/* Category filter tabs */}
      <div className="flex items-center gap-1.5 flex-wrap -mt-1">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground/70 mr-1">Category</span>
        {['All', 'Financial', 'Data Quality', 'Maintenance', 'Inventory', 'Onboarding', 'CRM', 'Issues']
          .filter(cat => cat === 'All' || (categoryCounts[cat] || 0) > 0)
          .map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                categoryFilter === cat
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {cat}
              <span className="ml-1.5 tabular-nums opacity-70">{categoryCounts[cat] || 0}</span>
            </button>
          ))}
      </div>

      {/* Bulk actions bar */}
      {selectableVisible.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border bg-muted/40">
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAll} aria-label="Select all visible alerts" />
            <span className="text-muted-foreground">
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : `Select all (${selectableVisible.length})`}
            </span>
          </label>
          <div className="flex items-center gap-1.5">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={selectedIds.size === 0}>
                  <Clock className="w-3 h-3" /> Snooze
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-36 p-1">
                {[{ label: '1 day', days: 1 }, { label: '3 days', days: 3 }, { label: '1 week', days: 7 }].map(opt => (
                  <button
                    key={opt.days}
                    onClick={() => bulkSnooze(opt.days)}
                    className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted"
                  >
                    {opt.label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={selectedIds.size === 0} onClick={bulkDismiss}>
              <X className="w-3 h-3" /> Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {visibleAlerts.length === 0 ? (
          <Card className="border-success/25 bg-success/5 shadow-xs">
            <CardContent className="p-8 text-center space-y-1">
              <CheckCircle2 className="w-7 h-7 text-success mx-auto" />
              <p className="text-sm text-success font-medium">All clear! No active alerts.</p>
              <p className="text-xs text-muted-foreground">
                {categoryFilter !== 'All' || severityFilter !== 'all'
                  ? 'Try clearing filters above to see alerts in other categories or severities.'
                  : 'New alerts surface automatically when issues are detected.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          visibleAlerts.map(alert => {
            const config = SEVERITY_CONFIG[alert.severity]
            const Icon = config.icon
            const dismissed = dismissedSet.has(alert.id)
            const isSelected = selectedIds.has(alert.id)
            return (
              <Card key={alert.id} className={`border shadow-xs ${config.bg} ${dismissed ? 'opacity-50' : ''} ${isSelected ? 'ring-2 ring-primary/40' : ''}`}>
                <CardContent className="p-3 flex items-start gap-3">
                  {!dismissed && (
                    <Checkbox
                      className="mt-0.5"
                      checked={isSelected}
                      onCheckedChange={() => toggleSelect(alert.id)}
                      aria-label={`Select alert: ${alert.title}`}
                    />
                  )}
                  <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${TONE_TEXT[config.tone]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm font-medium ${TONE_TEXT[config.tone]}`}>{alert.title}</p>
                      <StatusBadge tone="neutral" className="font-normal">
                        {alert.category}
                      </StatusBadge>
                      <StatusBadge tone={config.tone} className="font-normal capitalize">
                        {alert.severity}
                      </StatusBadge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{alert.description}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {alert.propertyId && (
                      <Button
                        variant="ghost" size="sm" className="h-6 w-6 p-0"
                        onClick={() => openPropertyModal(alert.propertyId!)}
                        aria-label={`View property: ${alert.title}`}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    )}
                    {alert.actionRoute && (
                      <Button
                        variant="ghost" size="sm" className="h-6 px-2 text-xs"
                        onClick={() => navigate(alert.actionRoute!)}
                      >
                        Go
                      </Button>
                    )}
                    {!dismissed && (
                      <>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label={`Snooze alert: ${alert.title}`}>
                              <Clock className="w-3 h-3" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-32 p-1">
                            {[{ label: '1 day', days: 1 }, { label: '3 days', days: 3 }, { label: '1 week', days: 7 }].map(opt => (
                              <button
                                key={opt.days}
                                onClick={() => handleSnooze(alert.id, opt.days)}
                                className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted"
                              >
                                Snooze {opt.label}
                              </button>
                            ))}
                          </PopoverContent>
                        </Popover>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleDismiss(alert.id)} aria-label={`Dismiss alert: ${alert.title}`}>
                          <X className="w-3 h-3" />
                        </Button>
                      </>
                    )}
                    {dismissed && (
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => handleUndismiss(alert.id)}>
                        Restore
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </PageContainer>
  )
}
