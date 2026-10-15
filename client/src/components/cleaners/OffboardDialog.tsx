import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase, logActivity } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { CLEANERS_QUERY_KEY, type Cleaner } from '@/hooks/use-cleaners'
import { CREW_LOGINS_QUERY_KEY, type LoginRow } from '@/hooks/use-cleaner-trellis'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertTriangle } from 'lucide-react'

/**
 * Offboard / reactivate one cleaner through the cleaner_set_status RPC (which
 * stamps offboarded_by with the signed-in staff member's name). Offboarding
 * can also remove the cleaner's crew app login: an explicit checkbox, default
 * OFF, admin only, using the same app_users delete + audit row as Settings >
 * Users. Staff/admin accounts are never offered (crewLoginsFor filters roles).
 */
export function OffboardDialog({
  cleaner,
  mode,
  logins,
  isAdmin,
  rosterRemoved,
  onClose,
}: {
  cleaner: Cleaner | null
  mode: 'offboard' | 'reactivate'
  /** Crew logins matching this cleaner's email(s). */
  logins: LoginRow[]
  isAdmin: boolean
  /** Trellis shows the linked roster member as removed (admin-only signal). */
  rosterRemoved: boolean
  onClose: () => void
}) {
  const { t } = useLocale('cleaners')
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [removeLogin, setRemoveLogin] = useState(false)

  useEffect(() => { setRemoveLogin(false) }, [cleaner?.id, mode])

  const loginList = logins.map(l => `${l.google_email} (${l.role})`).join(', ')

  const { mutate, isPending } = useGuardedMutation('cleaners', {
    mutationFn: async () => {
      if (!cleaner) return { loginError: null as string | null }
      const { error } = await supabase.rpc('cleaner_set_status', {
        p_cleaner_id: cleaner.id,
        p_status: mode === 'offboard' ? 'offboarded' : 'active',
      })
      if (error) throw error
      let loginError: string | null = null
      if (mode === 'offboard' && removeLogin && isAdmin) {
        for (const l of logins) {
          const { error: delErr } = await supabase.from('app_users').delete().eq('id', l.id)
          if (delErr) { loginError = delErr.message; continue }
          logActivity({
            entity_type: 'other',
            action: 'delete',
            entity_name: 'user_removed',
            field_name: l.label || l.google_email || String(l.id),
            old_value: `${l.role ?? 'unknown'} · ${l.google_email ?? ''}`.trim(),
            changed_by: user?.label ?? null,
            metadata: { email: l.google_email, label: l.label, role: l.role, reason: 'cleaner_offboarded', cleaner_id: cleaner.id },
          })
        }
      }
      return { loginError }
    },
    onSuccess: ({ loginError }) => {
      qc.invalidateQueries({ queryKey: CLEANERS_QUERY_KEY })
      qc.invalidateQueries({ queryKey: CREW_LOGINS_QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['/supabase/settings-users'] })
      const name = cleaner?.full_name ?? ''
      toast({ title: mode === 'offboard' ? t('toasts.statusOffboarded', { name }) : t('toasts.statusReactivated', { name }) })
      if (loginError) toast({ title: t('toasts.loginRemoveFailed'), description: loginError, variant: 'destructive' })
      else if (mode === 'offboard' && removeLogin && isAdmin && logins.length > 0) toast({ title: t('toasts.loginRemoved') })
      onClose()
    },
    onError: (e: Error) => {
      if (e?.message === 'edit_blocked') return
      toast({ title: t('toasts.statusFailed'), description: e?.message, variant: 'destructive' })
    },
  })

  const name = cleaner?.full_name ?? ''
  return (
    <Dialog open={!!cleaner} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'offboard' ? t('offboard.dialogTitle', { name }) : t('offboard.reactivateTitle', { name })}</DialogTitle>
          <DialogDescription>{mode === 'offboard' ? t('offboard.dialogBody') : t('offboard.reactivateBody')}</DialogDescription>
        </DialogHeader>

        {mode === 'offboard' && (
          logins.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('offboard.noLogin')}</p>
          ) : isAdmin ? (
            <label className="flex items-start gap-2 rounded-md border border-border p-3 cursor-pointer">
              <Checkbox
                checked={removeLogin}
                onCheckedChange={v => setRemoveLogin(v === true)}
                className="mt-0.5"
                data-testid="checkbox-remove-login"
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">{t('offboard.removeLogin')}</span>
                <span className="block text-xs text-muted-foreground">{t('offboard.removeLoginHint', { logins: loginList })}</span>
              </span>
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">{t('offboard.loginAdminOnly', { logins: loginList })}</p>
          )
        )}

        {mode === 'reactivate' && rosterRemoved && (
          <div className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/5 p-3 text-xs text-warning">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{t('trellis.rosterRemovedWarning')}</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>{t('common.actions.cancel')}</Button>
          <Button
            size="sm"
            variant={mode === 'offboard' ? 'destructive' : 'default'}
            disabled={isPending}
            onClick={() => mutate()}
            data-testid={`button-confirm-${mode}`}
          >
            {isPending ? t('offboard.confirming') : mode === 'offboard' ? t('offboard.confirm') : t('offboard.reactivateConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
