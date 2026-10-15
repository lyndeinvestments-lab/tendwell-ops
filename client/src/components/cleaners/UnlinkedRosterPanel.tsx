import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'
import { useAppSettings } from '@/hooks/use-app-settings'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import { CLEANERS_QUERY_KEY, type Cleaner } from '@/hooks/use-cleaners'
import { DISMISSALS_QUERY_KEY, type RosterWithMeta } from '@/hooks/use-cleaner-trellis'
import { unlinkedRosterMembers, type UnlinkedMember } from '@/lib/cleaner-metrics'
import { SearchSelect } from '@/components/issues/SearchSelect'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { UserPlus, Link2, EyeOff, RotateCcw } from 'lucide-react'

/**
 * Admin-only panel: active Tendwell Trellis roster members with no cleaner
 * (same exclusions as the sync). Create a cleaner (source 'trellis', no app
 * login), link to an existing cleaner, or ignore (trellis_roster_dismissals,
 * which also stops the sync from auto-creating them). Identity questions
 * (possible duplicates, shared emails) are flagged, never resolved here.
 */
export function UnlinkedRosterPanel({
  cleaners,
  roster,
  dismissed,
  isLoading,
  isError,
}: {
  cleaners: Cleaner[]
  roster: RosterWithMeta[]
  dismissed: Set<string>
  isLoading: boolean
  isError: boolean
}) {
  const { t } = useLocale('cleaners')
  const { format } = useDateFormat()
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { get } = useAppSettings()
  const autoCreate = get('trellis_cleaner_sync_enabled', 'false').trim().toLowerCase() === 'true'
  const [showIgnored, setShowIgnored] = useState(false)
  const [createFor, setCreateFor] = useState<UnlinkedMember | null>(null)
  const [linkFor, setLinkFor] = useState<UnlinkedMember | null>(null)
  const [linkCleanerId, setLinkCleanerId] = useState('')

  const members = useMemo(() => unlinkedRosterMembers(roster, cleaners, dismissed), [roster, cleaners, dismissed])
  const ignoredCount = members.filter(m => m.dismissed).length
  const visible = showIgnored ? members : members.filter(m => !m.dismissed)

  const unlinkedCleanerOptions = useMemo(() => cleaners
    .filter(c => !c.trellis_user_id)
    .map(c => ({ value: c.id, label: `${c.full_name}${c.email ? ` · ${c.email}` : ''}` })), [cleaners])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: CLEANERS_QUERY_KEY })
    qc.invalidateQueries({ queryKey: ['cleaner-metrics'] })
  }

  const createMut = useGuardedMutation('cleaners', {
    mutationFn: async (m: UnlinkedMember) => {
      const { error } = await supabase.rpc('cleaner_create_from_roster', { p_trellis_user_id: m.member.user_id })
      if (error) throw error
      return m
    },
    onSuccess: (m: UnlinkedMember) => {
      refresh()
      toast({ title: t('toasts.cleanerCreated', { name: m.member.name ?? '' }) })
      setCreateFor(null)
    },
    onError: (e: Error) => {
      if (e?.message === 'edit_blocked') return
      toast({ title: t('toasts.createFailed'), description: e?.message, variant: 'destructive' })
    },
  })

  const linkMut = useGuardedMutation('cleaners', {
    mutationFn: async ({ cleanerId, userId }: { cleanerId: string; userId: string }) => {
      const { error } = await supabase.rpc('cleaner_link_trellis', { p_cleaner_id: cleanerId, p_trellis_user_id: userId })
      if (error) throw error
    },
    onSuccess: () => {
      refresh()
      toast({ title: t('toasts.linkSaved') })
      setLinkFor(null)
      setLinkCleanerId('')
    },
    onError: (e: Error) => {
      if (e?.message === 'edit_blocked') return
      toast({ title: t('toasts.linkFailed'), description: e?.message, variant: 'destructive' })
    },
  })

  const ignoreMut = useGuardedMutation('cleaners', {
    mutationFn: async ({ m, ignore }: { m: UnlinkedMember; ignore: boolean }) => {
      if (ignore) {
        const { error } = await supabase.from('trellis_roster_dismissals').upsert({
          user_id: m.member.user_id,
          name: m.member.name,
          email: m.member.email,
          dismissed_by: user?.label ?? null,
        })
        if (error) throw error
      } else {
        const { error } = await supabase.from('trellis_roster_dismissals').delete().eq('user_id', m.member.user_id)
        if (error) throw error
      }
      return ignore
    },
    onSuccess: (ignore: boolean) => {
      qc.invalidateQueries({ queryKey: DISMISSALS_QUERY_KEY })
      toast({ title: ignore ? t('toasts.ignored') : t('toasts.restored') })
    },
    onError: (e: Error) => {
      if (e?.message === 'edit_blocked') return
      toast({ title: t('toasts.ignoreFailed'), description: e?.message, variant: 'destructive' })
    },
  })

  const seenDate = (iso: string | null | undefined) => {
    if (!iso) return '?'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '?' : format(d, 'MMM d')
  }

  return (
    <section className="rounded-2xl border border-border shadow-sm p-4 space-y-3" data-testid="panel-unlinked-roster">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">
            {t('roster.title')}
            {!isLoading && !isError && <span className="ml-2 text-muted-foreground font-normal">{members.length - ignoredCount}</span>}
          </h2>
          <p className="text-xs text-muted-foreground max-w-3xl">{t('roster.subtitle')}</p>
          <p className="text-2xs text-muted-foreground">{autoCreate ? t('roster.autoCreateOn') : t('roster.autoCreateOff')}</p>
        </div>
        {ignoredCount > 0 && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowIgnored(v => !v)}>
            {showIgnored ? t('roster.hideIgnored') : t('roster.showIgnored', { count: ignoredCount })}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : isError ? (
        <p className="text-xs text-destructive">{t('roster.loadFailed')}</p>
      ) : visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('roster.empty')}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {visible.map(m => (
            <li key={m.member.user_id} className="py-2 flex flex-col sm:flex-row sm:items-center gap-2 justify-between" data-testid={`roster-member-${m.member.user_id}`}>
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium truncate">
                  {m.member.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{m.member.email ?? t('trellis.noEmail')}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {m.dismissed && <StatusBadge tone="neutral">{t('roster.ignoredBadge')}</StatusBadge>}
                  {m.stale && (
                    <span title={t('roster.staleTooltip')}>
                      <StatusBadge tone="warning">{t('roster.staleBadge', { date: seenDate(m.member.last_seen_at) })}</StatusBadge>
                    </span>
                  )}
                  {m.possibleDuplicateOf && <StatusBadge tone="warning">{t('roster.duplicateBadge', { name: m.possibleDuplicateOf })}</StatusBadge>}
                  {m.similarCleaner && <StatusBadge tone="info">{t('roster.similarBadge', { name: m.similarCleaner })}</StatusBadge>}
                  {m.emailUsedBy && <StatusBadge tone="warning">{t('roster.emailBadge', { name: m.emailUsedBy })}</StatusBadge>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                {m.dismissed ? (
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" disabled={ignoreMut.isPending} onClick={() => ignoreMut.mutate({ m, ignore: false })}>
                    <RotateCcw className="w-3 h-3" /> {t('roster.restore')}
                  </Button>
                ) : (
                  <>
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setCreateFor(m)} data-testid={`button-create-from-roster-${m.member.user_id}`}>
                      <UserPlus className="w-3 h-3" /> {t('roster.create')}
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { setLinkFor(m); setLinkCleanerId('') }}>
                      <Link2 className="w-3 h-3" /> {t('roster.linkExisting')}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" disabled={ignoreMut.isPending} onClick={() => ignoreMut.mutate({ m, ignore: true })}>
                      <EyeOff className="w-3 h-3" /> {t('roster.ignore')}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!createFor} onOpenChange={v => !v && setCreateFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('roster.createConfirmTitle', { name: createFor?.member.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('roster.createConfirmBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateFor(null)}>{t('common.actions.cancel')}</Button>
            <Button size="sm" disabled={createMut.isPending} onClick={() => createFor && createMut.mutate(createFor)} data-testid="button-confirm-create-cleaner">
              {createMut.isPending ? t('roster.creating') : t('roster.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!linkFor} onOpenChange={v => !v && setLinkFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('roster.linkPickTitle', { name: linkFor?.member.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('trellis.linkDialogBody')}</DialogDescription>
          </DialogHeader>
          <SearchSelect
            value={linkCleanerId}
            onSelect={v => setLinkCleanerId(v)}
            options={unlinkedCleanerOptions}
            placeholder={t('roster.cleanerPlaceholder')}
            searchPlaceholder={t('roster.cleanerSearch')}
            emptyText={t('roster.cleanerEmpty')}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setLinkFor(null)}>{t('common.actions.cancel')}</Button>
            <Button
              size="sm"
              disabled={!linkCleanerId || linkMut.isPending}
              onClick={() => linkFor && linkMut.mutate({ cleanerId: linkCleanerId, userId: linkFor.member.user_id })}
            >
              {linkMut.isPending ? t('trellis.saving') : t('trellis.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
