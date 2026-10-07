import { useState } from 'react'
import { useLocation } from 'wouter'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth, canAccessView, canEditView } from '@/lib/auth'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { useOnboardingProperties, type OnboardingPropertyRow } from '@/hooks/use-onboarding'
import { invalidateAllPropertyQueries } from '@/lib/query-invalidations'
import { ACTIVE_STAGE_ID, ONBOARDING_STAGE_ID, type ReadinessItem } from '@/lib/onboarding'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CheckCircle2, Circle, MinusCircle, Building2, Rocket, ListChecks, Clock } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import { TONE_TEXT } from '@/lib/status-colors'

interface Action {
  label: string
  onClick: () => void
}

/**
 * "Properties in onboarding": every Onboarding-stage property with the six
 * go-live checks, each linking straight to where it gets fixed. This replaces
 * knowing that agreements live in Settings > Agreements, portal logins in
 * Settings > Owners and the Trellis link in API Sync: the checklist says what
 * is missing and takes you there.
 */
export function PropertiesSection({ onReviewSubmissions }: { onReviewSubmissions: () => void }) {
  const { t } = useLocale('onboardingAdmin')
  const { format } = useDateFormat()
  const { effectiveUser } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const { openPropertyModal } = usePropertyModal()
  const { data: rows, isLoading, isError, refetch } = useOnboardingProperties()
  const [activate, setActivate] = useState<OnboardingPropertyRow | null>(null)

  // Where each fix lives is gated differently: portals, agreements and the
  // Trellis owner link are admin Settings; the property Trellis id is API Sync.
  const canSettings = canAccessView('settings', effectiveUser)
  const canSync = canAccessView('trellis-sync', effectiveUser)
  const canAccessTab = canAccessView('access-codes', effectiveUser)
  const canMove = canEditView('property-list', effectiveUser)

  const { mutate: moveToActive, isPending: moving } = useGuardedMutation('property-list', {
    mutationFn: async (row: OnboardingPropertyRow) => {
      // The same function every other stage move in the app calls, so the
      // stage_transitions row, activity entry and workflow tasks all happen.
      const { executeStageTransition } = await import('@/lib/stage-transition')
      const result = await executeStageTransition({
        propertyId: row.property.id,
        propertyName: row.property.name,
        fromStageId: ONBOARDING_STAGE_ID,
        fromStageName: 'Onboarding',
        toStageId: ACTIVE_STAGE_ID,
        toStageName: 'Active',
        changedBy: effectiveUser?.label || 'unknown',
      })
      if (!result.ok) throw new Error(result.error)
      return result
    },
    onSuccess: (result) => {
      invalidateAllPropertyQueries(qc)
      qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/tasks'] })
      if (result.warning) toast({ title: t('properties.movedTitle'), description: result.warning, variant: 'destructive' })
      else toast({ title: t('properties.movedTitle') })
      setActivate(null)
    },
    onError: (e: any) => {
      if (e?.message !== 'edit_blocked') toast({ title: t('properties.moveFailed'), description: e?.message, variant: 'destructive' })
      setActivate(null)
    },
  })

  const adminOnly: Action[] | 'admin' = 'admin'

  function actionsFor(row: OnboardingPropertyRow, item: ReadinessItem): Action[] | 'admin' {
    const p = row.property
    const settings = (tab: string, extra = '') => () => navigate(`/settings?tab=${tab}${extra}`)
    switch (item.id) {
      case 'portal':
        if (item.state === 'done') return []
        if (!canSettings) return adminOnly
        return [{
          label: item.code === 'inactive' ? t('actions.openOwners') : t('actions.setUpPortal'),
          onClick: settings('owners', item.code === 'none' && p.contact_id ? `&portalFor=${p.contact_id}` : ''),
        }]
      case 'agreement':
        if (item.state === 'done' || item.code === 'needs_portal') return []
        if (!canSettings) return adminOnly
        return [{ label: item.code === 'sent' ? t('actions.viewAgreements') : t('actions.sendAgreement'), onClick: settings('agreements') }]
      case 'intake':
        return item.code === 'pending' ? [{ label: t('actions.reviewSubmission'), onClick: onReviewSubmissions }] : []
      case 'access':
        if (item.state === 'done') return []
        return [{
          label: t('actions.addDoorCode'),
          onClick: () => openPropertyModal(String(p.id), 'onboarding-queue', ['door_code'], canAccessTab ? 'setup' : undefined),
        }]
      case 'calendar':
        if (item.state === 'done') return []
        return [{ label: t('actions.addIcal'), onClick: () => openPropertyModal(String(p.id), 'onboarding-queue', ['ical_url']) }]
      case 'trellis': {
        if (item.state === 'done') return []
        const out: Action[] = []
        if (item.code === 'missing_property' || item.code === 'missing_both') {
          if (!canSync) return adminOnly
          out.push({ label: t('actions.linkTrellis'), onClick: () => navigate('/api-sync') })
        }
        if (item.code === 'missing_owner' || item.code === 'missing_both') {
          if (!canSettings) return adminOnly
          out.push({ label: t('actions.addTrellisLink'), onClick: settings('owners') })
        }
        return out
      }
    }
  }

  function detailText(item: ReadinessItem): string {
    const date = item.date ? format(new Date(item.date), 'MMM d, yyyy') : ''
    return t(`readiness.detail.${item.id}.${item.code}`, { name: item.name ?? '', date, count: item.count ?? 0 })
  }

  const total = rows?.length ?? 0
  const ready = (rows ?? []).filter(r => r.result.ready).length
  const longest = (rows ?? []).reduce((m, r) => Math.max(m, r.days ?? 0), 0)

  if (isError) return <ErrorState onRetry={() => refetch()} />

  const openItems = activate ? activate.result.items.filter(i => i.state === 'todo').map(i => t(`readiness.items.${i.id}`)).join(', ') : ''

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title={t('properties.kpi.inOnboarding')} value={total} icon={Building2} loading={isLoading} />
        <StatCard title={t('properties.kpi.ready')} value={ready} icon={Rocket} tone="success" loading={isLoading} />
        <StatCard title={t('properties.kpi.needsWork')} value={total - ready} icon={ListChecks} tone={total - ready > 0 ? 'warning' : 'primary'} loading={isLoading} />
        <StatCard title={t('properties.kpi.longest')} value={longest} icon={Clock} loading={isLoading} />
      </div>

      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
      ) : total === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">{t('properties.empty')}</CardContent></Card>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{t('properties.legend')}</p>
          {rows!.map(row => (
            <Card key={row.property.id} data-testid={`onboarding-property-${row.property.id}`}>
              <CardHeader className="p-3 pb-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="text-sm font-semibold hover:underline text-left truncate max-w-full"
                      onClick={() => openPropertyModal(String(row.property.id), 'onboarding-queue')}
                      data-testid={`link-onboarding-property-${row.property.id}`}
                    >
                      {row.property.name}
                    </button>
                    <p className="text-xs text-muted-foreground truncate">
                      {[row.property.address, row.days != null ? t('properties.daysIn', { count: row.days }) : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge tone={row.result.ready ? 'success' : 'warning'}>
                      {row.result.ready ? t('properties.ready') : t('properties.toDo', { count: row.result.remaining })}
                    </StatusBadge>
                    {canMove && (
                      <Button
                        size="sm"
                        variant={row.result.ready ? 'default' : 'outline'}
                        onClick={() => setActivate(row)}
                        data-testid={`button-activate-${row.property.id}`}
                      >
                        {row.result.ready ? t('properties.moveToActive') : t('properties.activateAnyway')}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-1">
                <ul className="divide-y divide-border">
                  {row.result.items.map(item => {
                    const actions = actionsFor(row, item)
                    return (
                      <li key={item.id} className="flex items-center gap-3 py-2" data-testid={`check-${row.property.id}-${item.id}`}>
                        {item.state === 'done' ? (
                          <CheckCircle2 className={`w-4 h-4 shrink-0 ${TONE_TEXT.success}`} aria-label={t('properties.stateDone')} />
                        ) : item.state === 'optional' ? (
                          <MinusCircle className={`w-4 h-4 shrink-0 ${TONE_TEXT.neutral}`} aria-label={t('properties.stateOptional')} />
                        ) : (
                          <Circle className={`w-4 h-4 shrink-0 ${TONE_TEXT.warning}`} aria-label={t('properties.stateTodo')} />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{t(`readiness.items.${item.id}`)}</p>
                          <p className="text-xs text-muted-foreground break-words">{detailText(item)}</p>
                        </div>
                        {actions === 'admin' ? (
                          <span className="text-xs text-muted-foreground shrink-0">{t('actions.adminOnly')}</span>
                        ) : (
                          <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                            {actions.map(a => (
                              <Button key={a.label} size="sm" variant="outline" className="h-7 text-xs" onClick={a.onClick}>
                                {a.label}
                              </Button>
                            ))}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!activate} onOpenChange={(open) => { if (!open && !moving) setActivate(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('properties.confirm.title', { name: activate?.property.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {activate?.result.ready ? t('properties.confirm.ready') : t('properties.confirm.notReady', { items: openItems })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={moving}>{t('common.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={moving}
              onClick={(e) => { e.preventDefault(); if (activate) moveToActive(activate) }}
              data-testid="button-confirm-activate"
            >
              {t('properties.confirm.action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
