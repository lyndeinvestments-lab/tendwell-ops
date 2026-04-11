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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  AlertTriangle, AlertCircle, Info, Building2, Wind, BedDouble, ClipboardCheck, Users,
  X, Clock, ExternalLink
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
}

const SEVERITY_CONFIG = {
  critical: { icon: AlertTriangle, color: 'text-red-700 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', badge: 'bg-red-500' },
  warning: { icon: AlertCircle, color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800', badge: 'bg-amber-500' },
  info: { icon: Info, color: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800', badge: 'bg-blue-500' },
}

export function useAlerts() {
  const { data: properties } = useQuery({
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
          description: `Profit is ${(p.profit_percentage || 0).toFixed(1)}% — losing money on this property.`,
          actionRoute: '/cost-tracking',
          propertyId: p.id,
        })
      }

      // Warning: Missing financial data ($0 CE for active properties)
      if (stageName === 'Active' && (p.ce_charged == null || p.ce_charged === 0)) {
        result.push({
          id: `missing_financial_${p.id}`,
          severity: 'warning',
          category: 'Data Quality',
          title: `Missing Financial Data: ${p.name}`,
          description: 'Client Charged is $0 — profit calculations are unreliable until this is set.',
          actionRoute: '/cost-tracking',
          propertyId: p.id,
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
          propertyId: p.id,
          actionRoute: '/master-list',
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
          propertyId: p.id,
        })
      }

      // Warning: Low Profit
      if ((p.profit_percentage || 0) >= 0 && (p.profit_percentage || 0) < 10 && stageName === 'Active') {
        result.push({
          id: `low_profit_${p.id}`,
          severity: 'warning',
          category: 'Financial',
          title: `Low Profit: ${p.name}`,
          description: `Profit is only ${(p.profit_percentage || 0).toFixed(1)}%`,
          actionRoute: '/cost-tracking',
          propertyId: p.id,
        })
      }

    }

    // Info: Onboarding Stalled
    if (onboardingTasks) {
      const byProperty: Record<string, { total: number; completed: number; oldest: string }> = {}
      for (const t of onboardingTasks) {
        if (!byProperty[t.property_id]) byProperty[t.property_id] = { total: 0, completed: 0, oldest: t.created_at }
        byProperty[t.property_id].total++
        if (t.is_complete) byProperty[t.property_id].completed++
        if (t.created_at < byProperty[t.property_id].oldest) byProperty[t.property_id].oldest = t.created_at
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
            })
          }
        }
      }
    }

    // Info: New Contact Unlinked
    if (contacts) {
      for (const c of contacts) {
        const props = (c as any).properties || []
        if (props.length === 0 && c.created_at < sevenDaysAgo) {
          result.push({
            id: `unlinked_contact_${c.id}`,
            severity: 'info',
            category: 'CRM',
            title: 'Unlinked Client',
            description: `Client created 7+ days ago with no properties linked`,
            actionRoute: '/contacts',
          })
        }
      }
    }

    // Sort by severity
    const order = { critical: 0, warning: 1, info: 2 }
    result.sort((a, b) => order[a.severity] - order[b.severity])
    return result
  }, [properties, onboardingTasks, contacts])

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
    return alerts.filter(a => !dismissedSet.has(a.id))
  }, [alerts, dismissedSet])

  const badgeCount = useMemo(() => {
    return activeAlerts.filter(a => a.severity === 'critical' || a.severity === 'warning').length
  }, [activeAlerts])

  return { alerts, activeAlerts, badgeCount, dismissedSet }
}

export default function AlertsPage() {
  usePageTitle('Alerts')
  const [, navigate] = useLocation()
  const { openPropertyModal } = usePropertyModal()
  const { alerts, dismissedSet } = useAlerts()
  const qcAlerts = useQueryClient()
  const [showDismissed, setShowDismissed] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>('All')
  const { effectiveUser } = useAuth()
  const canViewFinancials = canAccessView('cost-tracking', effectiveUser) || canAccessView('financial-dashboard', effectiveUser)

  const visibleAlerts = useMemo(() => {
    let base = showDismissed ? alerts : alerts.filter(a => !dismissedSet.has(a.id))
    if (!canViewFinancials) base = base.filter(a => a.category !== 'Financial')
    if (categoryFilter !== 'All') base = base.filter(a => a.category === categoryFilter)
    return base
  }, [alerts, showDismissed, dismissedSet, categoryFilter, canViewFinancials])

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

  const criticalCount = alerts.filter(a => a.severity === 'critical' && !dismissedSet.has(a.id)).length
  const warningCount = alerts.filter(a => a.severity === 'warning' && !dismissedSet.has(a.id)).length
  const infoCount = alerts.filter(a => a.severity === 'info' && !dismissedSet.has(a.id)).length

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Alerts</h1>
          <p className="text-sm text-muted-foreground">
            {criticalCount} critical, {warningCount} warnings, {infoCount} info
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            Show dismissed ({alerts.filter(a => dismissedSet.has(a.id)).length})
          </label>
        </div>
      </div>

      {/* Category filter tabs */}
      <div className="flex items-center gap-1.5 flex-wrap -mt-1">
        {['All', 'Financial', 'Data Quality', 'Maintenance', 'Inventory', 'Onboarding', 'CRM']
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

      <div className="space-y-2">
        {visibleAlerts.length === 0 ? (
          <Card className="border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10">
            <CardContent className="p-6 text-center">
              <p className="text-sm text-green-700 dark:text-green-400 font-medium">All clear! No active alerts.</p>
            </CardContent>
          </Card>
        ) : (
          visibleAlerts.map(alert => {
            const config = SEVERITY_CONFIG[alert.severity]
            const Icon = config.icon
            const dismissed = dismissedSet.has(alert.id)
            return (
              <Card key={alert.id} className={`border ${config.bg} ${dismissed ? 'opacity-50' : ''}`}>
                <CardContent className="p-3 flex items-start gap-3">
                  <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${config.color}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${config.color}`}>{alert.title}</p>
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
    </div>
  )
}
