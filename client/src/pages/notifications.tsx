import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { sendTestEmail } from '@/lib/notify'
import { DEFAULT_NOTIF_PREFS, NOTIF_EVENT_DEFS } from '@/lib/notif-prefs'
import { Bell, Lock, Mail } from 'lucide-react'

// Self-service notification preferences for the signed-in staff member.
//
// This is a personal account page — every staff member can reach it regardless
// of which data views they've been granted (owners never load the staff shell,
// so they can't reach it at all). The individual notification *types* shown are
// gated by the user's own `resolvedViews`: an event whose required view the
// user lacks renders locked, matching the server-side filterRecipients rule so
// a user can only opt into notifications for areas they actually have access to.
//
// Admins additionally get the full cross-user matrix in Settings → Notifications;
// this page is the one place a non-admin (operations / cleaning / inspector /
// viewer) can manage their own.
export default function NotificationsPage() {
  usePageTitle('Notifications')
  const { user } = useAuth()
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
    onError: (e: any) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  })

  async function handleTestEmail() {
    setTesting(true)
    const r = await sendTestEmail()
    setTesting(false)
    if (r.ok) toast({ title: 'Test email sent', description: `Sent to ${r.sentTo}` })
    else toast({ title: 'Test failed', description: r.error, variant: 'destructive' })
  }

  // When email is disabled or frequency is Off, nothing sends — render the
  // per-event toggles inactive but keep their saved values.
  const emailActive = !!prefs.email_enabled && prefs.digest_frequency !== 'off'

  return (
    <PageContainer>
      <PageHeader
        title="Notifications"
        subtitle="Choose which email notifications you receive. You only see the events tied to areas you have access to."
        actions={
          <Button size="sm" variant="outline" onClick={handleTestEmail} disabled={testing}>
            <Mail className="w-4 h-4 mr-1.5" />
            {testing ? 'Sending…' : 'Send test email to me'}
          </Button>
        }
      />

      <div className="mt-4 max-w-2xl rounded-2xl border border-border shadow-sm p-5 space-y-5">
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
                <Bell className="w-4 h-4" /> Email notifications
              </label>
              <label className="flex items-center gap-2 text-sm">
                Frequency:
                <select
                  value={prefs.digest_frequency || 'instant'}
                  onChange={(e) => savePref.mutate({ digest_frequency: e.target.value })}
                  className="h-8 text-xs border border-input rounded-md px-2 bg-background"
                  data-testid="notif-frequency"
                >
                  <option value="instant">Instant</option>
                  <option value="daily">Daily digest (8am ET)</option>
                  <option value="off">Off</option>
                </select>
              </label>
            </div>

            {/* Per-event toggles */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Notify me about
              </p>
              {!emailActive && (
                <p className="text-2xs text-muted-foreground">
                  {prefs.email_enabled ? 'Frequency is set to Off' : 'Email is disabled'} - these events won’t send. Your selections are kept for when you re-enable.
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
                      title={!hasAccess ? `Requires ${ev.view} access` : (!emailActive ? 'Enable email to use' : '')}
                    >
                      <Checkbox
                        checked={active && checked}
                        disabled={!active}
                        onCheckedChange={(v) => savePref.mutate({ [ev.field]: !!v })}
                        data-testid={`notif-${ev.field}`}
                      />
                      <span className="flex-1">{ev.label}</span>
                      {!hasAccess && <Lock className="w-3 h-3 text-muted-foreground" />}
                    </label>
                  )
                })}
              </div>
              <p className="text-2xs text-muted-foreground pt-1">
                Locked events require access to a view you haven’t been granted. Ask an admin if you need one.
              </p>
            </div>
          </>
        )}
      </div>
    </PageContainer>
  )
}
