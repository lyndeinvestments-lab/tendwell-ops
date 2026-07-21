import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { sendTestEmail } from '@/lib/notify'
import { DEFAULT_NOTIF_PREFS, NOTIF_EVENT_DEFS } from '@/lib/notif-prefs'
import { Bell, Lock, Mail } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'

// Self-service notification preferences for the signed-in staff member.
// Extracted from the old /notifications page so it can live on /account
// alongside language + security. Behavior and data-testids are unchanged:
// event types are gated by the user's own `resolvedViews` (locked rows mirror
// the server-side filterRecipients rule). Admins additionally get the full
// cross-user matrix in Settings → Notifications.
export function NotificationPrefs() {
  const { user } = useAuth()
  const { t } = useLocale('account')
  const { toast } = useToast()
  const qc = useQueryClient()
  const [testing, setTesting] = useState(false)

  // app_users.id is stored as a string on AuthUser but the DB column is INTEGER.
  // Owners (UUID id) never reach this route; guard against a non-numeric id
  // anyway so we never issue a query with NaN.
  const parsedId = user ? Number(user.id) : NaN
  const userId = Number.isInteger(parsedId) ? parsedId : null
  const allowedViews = user?.resolvedViews ?? []

  const { data: prefsRow, isLoading } = useQuery({
    queryKey: ['/supabase/my-notif-prefs', userId],
    enabled: userId != null,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId as number)
        .maybeSingle()
      return data
    },
  })

  // Effective prefs: the saved row, or the table defaults when no row exists yet
  // (mirrors how the server treats a user with no explicit row).
  const prefs = useMemo(
    () => prefsRow ?? { user_id: userId, ...DEFAULT_NOTIF_PREFS },
    [prefsRow, userId],
  )

  const savePref = useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      if (userId == null) throw new Error('Not signed in')
      const { error } = await supabase.from('notification_preferences').upsert({
        ...prefs,
        ...patch,
        user_id: userId,
        updated_at: new Date().toISOString(),
        updated_by: user?.label || null,
      }, { onConflict: 'user_id' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/supabase/my-notif-prefs', userId] }),
    onError: (e: any) => toast({ title: t('notifications.saveFailed'), description: e.message, variant: 'destructive' }),
  })

  async function handleTestEmail() {
    setTesting(true)
    const r = await sendTestEmail()
    setTesting(false)
    if (r.ok) toast({ title: t('notifications.testEmailSent'), description: t('notifications.testEmailSentTo', { email: r.sentTo ?? '' }) })
    else toast({ title: t('notifications.testEmailFailed'), description: r.error, variant: 'destructive' })
  }

  // When email is disabled or frequency is Off, nothing sends — render the
  // per-event toggles inactive but keep their saved values.
  const emailActive = !!prefs.email_enabled && prefs.digest_frequency !== 'off'

  return (
    <div className="rounded-2xl border border-border shadow-sm p-5 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">{t('notifications.title')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('notifications.subtitle')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={handleTestEmail} disabled={testing}>
          <Mail className="w-4 h-4 mr-1.5" />
          {testing ? t('notifications.testEmailSending') : t('notifications.testEmail')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <>
          {/* Master controls */}
          <div className="flex items-center gap-5 flex-wrap">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={!!prefs.email_enabled}
                onCheckedChange={(v) => savePref.mutate({ email_enabled: !!v })}
                data-testid="notif-email-enabled"
              />
              <Bell className="w-4 h-4" /> {t('notifications.emailNotifications')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              {t('notifications.frequency')}
              <select
                value={prefs.digest_frequency || 'instant'}
                onChange={(e) => savePref.mutate({ digest_frequency: e.target.value })}
                className="h-8 text-xs border border-input rounded-md px-2 bg-background"
                data-testid="notif-frequency"
              >
                <option value="instant">{t('notifications.freqInstant')}</option>
                <option value="daily">{t('notifications.freqDaily')}</option>
                <option value="off">{t('notifications.freqOff')}</option>
              </select>
            </label>
          </div>

          {/* Per-event toggles */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t('notifications.notifyMeAbout')}
            </p>
            {!emailActive && (
              <p className="text-2xs text-muted-foreground">
                {prefs.email_enabled ? t('notifications.frequencyOffNote') : t('notifications.emailDisabledNote')}
              </p>
            )}
            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${emailActive ? '' : 'opacity-50'}`}>
              {NOTIF_EVENT_DEFS.map(ev => {
                const hasAccess = allowedViews.includes(ev.view as any)
                const checked = !!(prefs as any)[ev.field]
                const active = emailActive && hasAccess
                return (
                  <label
                    key={ev.field}
                    className={`flex items-center gap-2 text-sm px-2.5 py-2 rounded-md border ${active ? 'border-border' : 'border-border/50 opacity-60'}`}
                    title={!hasAccess ? t('notifications.requiresAccess', { view: ev.view }) : (!emailActive ? t('notifications.enableEmailToUse') : '')}
                  >
                    <Checkbox
                      checked={active && checked}
                      disabled={!active}
                      onCheckedChange={(v) => savePref.mutate({ [ev.field]: !!v })}
                      data-testid={`notif-${ev.field}`}
                    />
                    <span className="flex-1">{t(`notifEvents.${ev.field}`, undefined, ev.label)}</span>
                    {!hasAccess && <Lock className="w-3 h-3 text-muted-foreground" />}
                  </label>
                )
              })}
            </div>
            <p className="text-2xs text-muted-foreground pt-1">
              {t('notifications.lockedNote')}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
