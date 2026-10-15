import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { CLEANERS_QUERY_KEY, type Cleaner } from '@/hooks/use-cleaners'
import type { RosterWithMeta } from '@/hooks/use-cleaner-trellis'
import { linkableRosterMembers } from '@/lib/cleaner-metrics'
import { SearchSelect } from '@/components/issues/SearchSelect'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** Admin-only: link a cleaner to (or unlink from) a Tendwell Trellis roster
 *  member via the cleaner_link_trellis RPC. The roster is admin-read. */
export function TrellisLinkDialog({
  cleaner,
  cleaners,
  roster,
  onClose,
}: {
  cleaner: Cleaner | null
  cleaners: Cleaner[]
  roster: RosterWithMeta[]
  onClose: () => void
}) {
  const { t } = useLocale('cleaners')
  const { toast } = useToast()
  const qc = useQueryClient()
  const [userId, setUserId] = useState('')

  useEffect(() => { setUserId(cleaner?.trellis_user_id ?? '') }, [cleaner?.id, cleaner?.trellis_user_id])

  const options = useMemo(() => {
    if (!cleaner) return []
    return linkableRosterMembers(roster, cleaners, cleaner.id).map(m => ({
      value: m.user_id,
      label: [
        m.name ?? '',
        m.email ?? t('trellis.noEmail'),
        m.is_active ? null : t('trellis.memberRemoved'),
      ].filter(Boolean).join(' · '),
    }))
  }, [cleaner, cleaners, roster, t])

  const current = cleaner?.trellis_user_id ? roster.find(m => m.user_id === cleaner.trellis_user_id) : null

  const { mutate, isPending } = useGuardedMutation('cleaners', {
    mutationFn: async (next: string | null) => {
      if (!cleaner) return next
      const { error } = await supabase.rpc('cleaner_link_trellis', { p_cleaner_id: cleaner.id, p_trellis_user_id: next })
      if (error) throw error
      return next
    },
    onSuccess: (next: string | null) => {
      qc.invalidateQueries({ queryKey: CLEANERS_QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['cleaner-metrics'] })
      toast({ title: next ? t('toasts.linkSaved') : t('toasts.unlinked') })
      onClose()
    },
    onError: (e: Error) => {
      if (e?.message === 'edit_blocked') return
      toast({ title: t('toasts.linkFailed'), description: e?.message, variant: 'destructive' })
    },
  })

  return (
    <Dialog open={!!cleaner} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('trellis.linkDialogTitle', { name: cleaner?.full_name ?? '' })}</DialogTitle>
          <DialogDescription>{t('trellis.linkDialogBody')}</DialogDescription>
        </DialogHeader>
        {cleaner?.trellis_user_id && (
          <p className="text-xs text-muted-foreground">
            {t('trellis.currentLink', { name: current?.name ?? cleaner.trellis_user_id })}
          </p>
        )}
        <SearchSelect
          value={userId}
          onSelect={v => setUserId(v)}
          options={options}
          placeholder={t('trellis.memberPlaceholder')}
          searchPlaceholder={t('trellis.memberSearch')}
          emptyText={t('trellis.memberEmpty')}
          allowClear={false}
        />
        {cleaner?.trellis_user_id && (
          <p className="text-2xs text-muted-foreground">{t('trellis.unlinkHint')}</p>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          {cleaner?.trellis_user_id && (
            <Button variant="outline" size="sm" className="sm:mr-auto" disabled={isPending} onClick={() => mutate(null)} data-testid="button-unlink-trellis">
              {t('trellis.unlink')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>{t('common.actions.cancel')}</Button>
          <Button
            size="sm"
            disabled={isPending || !userId || userId === cleaner?.trellis_user_id}
            onClick={() => mutate(userId)}
            data-testid="button-save-trellis-link"
          >
            {isPending ? t('trellis.saving') : t('trellis.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
