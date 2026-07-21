import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { es as dateFnsEs } from 'date-fns/locale'
import { Check, PartyPopper, UserCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { useIssueReads } from '@/hooks/use-issue-reads'
import { useIsMobile } from '@/hooks/use-mobile'
import { useToast } from '@/hooks/use-toast'
import { resizeImageFile } from '@/lib/resize-image'
import { catchUpQueue, STATUSES, categoryLabel, statusLabel, type Issue, type IssueComment, type IssuePhoto } from '@/lib/issues'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useIssueTranslations, type TranslatableCandidate } from '@/hooks/use-issue-translations'
import { triggerIssueTranslate } from '@/lib/issue-translate'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/EmptyState'
import { IssueBadges } from '@/components/issues/IssueBadges'
import { IssueCommentsList } from '@/components/issues/IssueCommentsList'
import { IssuePhotoGrid } from '@/components/issues/IssuePhotoGrid'
import { cn } from '@/lib/utils'

const INFO_ROWS: Array<{ key: keyof Issue; labelKey: 'common.assessment' | 'common.resolution' | 'common.coverage' | 'common.remarks' }> = [
  { key: 'assessment', labelKey: 'common.assessment' },
  { key: 'resolution', labelKey: 'common.resolution' },
  { key: 'coverage', labelKey: 'common.coverage' },
  { key: 'remarks', labelKey: 'common.remarks' },
]

/**
 * Slack-style Catch-up flow: steps through the frozen queue one issue at a
 * time — mark read, leave unread, or take the contextual quick action
 * (Acknowledge / Mark Complete), same info a full detail sheet would show
 * (badges, comments, photos) but tuned for fast triage.
 */
export function CatchUpFlow({
  open,
  onOpenChange,
  issues,
  canEdit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  issues: Issue[]
  canEdit: boolean
}) {
  const isMobile = useIsMobile()
  const { t, locale } = useLocale('issues')
  const { effectiveUser } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { markRead, invalidateAll } = useIssueReads()

  // Queue is frozen at open time — no mid-session reorder even as the
  // underlying issues array changes from other mutations.
  const [queue, setQueue] = useState<Issue[]>([])
  const [index, setIndex] = useState(0)
  // Local patches from this session's own mutations (acknowledge/status),
  // overlaid on the frozen queue rows so a step reflects its own change
  // immediately without refetching (which would defeat the freeze).
  const [overlays, setOverlays] = useState<Record<string, Partial<Issue>>>({})
  const [comment, setComment] = useState('')
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (open) {
      setQueue(catchUpQueue(issues))
      setIndex(0)
      setOverlays({})
    }
    // Deliberately only depends on `open` — freezing the queue means it
    // must NOT recompute if `issues` changes while the flow is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const total = queue.length
  const isDone = total === 0 || index >= total
  const rawCurrent = !isDone ? queue[index] : null
  const current = rawCurrent ? { ...rawCurrent, ...overlays[rawCurrent.id] } : null
  const issueId = current?.id

  useEffect(() => {
    setComment('')
    setDetailsExpanded(false)
  }, [issueId])

  const { data: comments, isLoading: commentsLoading } = useQuery({
    queryKey: ['/supabase/issue-comments', issueId],
    enabled: !!issueId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('issue_comments')
        .select('*').eq('issue_id', issueId).order('created_at', { ascending: true })
      if (error) throw error
      return (data || []) as IssueComment[]
    },
  })

  const { data: photos } = useQuery({
    queryKey: ['/supabase/issue-photos', issueId],
    enabled: !!issueId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('issue_photos')
        .select('*').eq('issue_id', issueId).order('created_at', { ascending: true })
      if (error) throw error
      return (data || []) as IssuePhoto[]
    },
  })

  // ES overlay for the current step: every translatable field + comment on
  // `current`. No-op when the UI isn't in Spanish. Only the current issue's
  // items are ever candidates — the frozen queue's other entries aren't
  // rendered, so there's nothing to overlay for them yet.
  const translationCandidates = useMemo<TranslatableCandidate[]>(() => {
    if (!current) return []
    const items: TranslatableCandidate[] = [
      { issueId: current.id, sourceId: current.id, field: 'details', text: current.details },
      ...INFO_ROWS.map(({ key }) => ({ issueId: current.id, sourceId: current.id, field: key as string, text: current[key] as string | null })),
    ]
    for (const c of comments || []) items.push({ issueId: current.id, sourceId: c.id, field: 'content', text: c.content })
    return items
  }, [current, comments])
  const { tr } = useIssueTranslations(translationCandidates)

  const displayComments = useMemo(() => {
    if (!comments) return comments
    return comments.map(c => ({ ...c, content: tr(c.id, 'content', c.content) ?? c.content }))
  }, [comments, tr])

  const addComment = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).from('issue_comments').insert({
        issue_id: issueId, content: comment.trim(),
        author_name: effectiveUser?.label || null, author_type: 'staff',
      }).select('id').single()
      if (error) throw error
      return data as { id: string }
    },
    onSuccess: (data) => {
      setComment('')
      qc.invalidateQueries({ queryKey: ['/supabase/issue-comments', issueId] })
      // Fire-and-forget: never awaited, doesn't block the flow's UI.
      if (issueId && data?.id) void triggerIssueTranslate(issueId, [{ id: `comment:${data.id}` }], 'es')
    },
    onError: (e: any) => toast({ title: t('detail.toastCommentFailed'), description: e?.message, variant: 'destructive' }),
  })

  // Mirrors IssueDetailSheet's acknowledge/status mutations exactly, but
  // permission-gated the same way the page's own mutations are (unlike the
  // detail sheet, which relies solely on the `canEdit`-gated button render).
  const acknowledge = useGuardedMutation('issues', {
    mutationFn: async (id: string) => {
      const acknowledged_at = new Date().toISOString()
      const acknowledged_by = effectiveUser?.label || null
      const { error } = await supabase.from('cleaning_issues').update({ acknowledged_at, acknowledged_by }).eq('id', id)
      if (error) throw error
      return { id, acknowledged_at, acknowledged_by }
    },
    onSuccess: ({ id, acknowledged_at, acknowledged_by }) => {
      setOverlays(o => ({ ...o, [id]: { ...o[id], acknowledged_at, acknowledged_by } }))
      toast({ title: t('detail.toastAcknowledged') })
    },
    onError: (e: any) => toast({ title: t('detail.toastAcknowledgeFailed'), description: e?.message, variant: 'destructive' }),
  })

  const setStatus = useGuardedMutation('issues', {
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('cleaning_issues').update({
        status,
        completed_at: status === 'Completed' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      if (error) throw error
      return { id, status }
    },
    onSuccess: ({ id, status }) => {
      setOverlays(o => ({ ...o, [id]: { ...o[id], status } }))
      toast({ title: t('detail.toastStatusUpdated') })
    },
    onError: (e: any) => toast({ title: t('detail.toastUpdateFailed'), description: e?.message, variant: 'destructive' }),
  })

  async function handleUpload(raw: File, phase: 'initial' | 'completion') {
    if (!issueId) return
    setUploading(true)
    try {
      const file = await resizeImageFile(raw)
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${issueId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await supabase.storage.from('issue-photos').upload(path, file, { contentType: file.type || 'image/jpeg' })
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from('issue-photos').getPublicUrl(path)
      const { error } = await (supabase as any).from('issue_photos').insert({
        issue_id: issueId, photo_url: urlData.publicUrl, photo_path: path, phase,
        uploaded_by: effectiveUser?.label || null, author_type: 'staff',
      })
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['/supabase/issue-photos', issueId] })
    } catch (e: any) {
      toast({ title: t('detail.toastPhotoFailed'), description: e?.message, variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }

  function advance() {
    setIndex(i => i + 1)
  }

  function handleMarkRead() {
    if (!current) return
    markRead(current.id)
    advance()
  }

  async function handleAcknowledge() {
    if (!current) return
    try {
      await acknowledge.mutateAsync(current.id)
      markRead(current.id)
      advance()
    } catch { /* toast already shown by the mutation */ }
  }

  async function handleMarkComplete() {
    if (!current) return
    try {
      await setStatus.mutateAsync({ id: current.id, status: 'Completed' })
      markRead(current.id)
      advance()
    } catch { /* toast already shown by the mutation */ }
  }

  function handleStatusSelect(status: string) {
    if (!current) return
    setStatus.mutate({ id: current.id, status })
  }

  // Any close path refreshes the list + issue_reads exactly once — no
  // per-step invalidation, so mid-flow stepping never refetches (which
  // could otherwise disturb the frozen queue).
  function handleOpenChange(next: boolean) {
    if (!next) invalidateAll()
    onOpenChange(next)
  }

  const body = (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-4">
      {isDone ? (
        <EmptyState
          icon={PartyPopper}
          title={t('catchUp.allCaughtUp')}
          description={total === 0 ? t('catchUp.noneRemaining') : t('catchUp.steppedThrough', { count: total })}
          action={{ label: t('catchUp.doneAction'), onClick: () => handleOpenChange(false) }}
        />
      ) : current && (
        <>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t('catchUp.progress', { index: index + 1, total })}</span>
            </div>
            <Progress value={((index + 1) / total) * 100} className="h-1" />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-base font-semibold truncate">{current.property_name || t('common.noProperty')}</h3>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
              <span>{categoryLabel(current.category, t)}</span>
              <span>·</span>
              <span>{format(new Date(current.report_date), 'MMM d, yyyy', { locale: locale === 'es' ? dateFnsEs : undefined })}</span>
              {current.last_touch && (<><span>·</span><span>{current.last_touch}</span></>)}
            </div>
            <IssueBadges issue={current} variant="full" />
          </div>

          {current.details && (
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">{t('common.details')}</span>
              <p className={cn('text-sm whitespace-pre-wrap', !detailsExpanded && 'line-clamp-3')}>{tr(current.id, 'details', current.details)}</p>
              {current.details.length > 160 && (
                <button type="button" className="text-xs text-primary hover:underline mt-1" onClick={() => setDetailsExpanded(v => !v)}>
                  {detailsExpanded ? t('catchUp.showLess') : t('catchUp.showMore')}
                </button>
              )}
            </div>
          )}

          {INFO_ROWS.map(({ key, labelKey }) => {
            const value = current[key] as string | null
            return value ? (
              <div key={key}>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">{t(labelKey)}</span>
                <p className="text-sm whitespace-pre-wrap">{tr(current.id, key as string, value)}</p>
              </div>
            ) : null
          })}

          <IssuePhotoGrid photos={photos} canEdit={canEdit} uploading={uploading} onUpload={handleUpload} />

          <IssueCommentsList
            comments={displayComments}
            isLoading={commentsLoading}
            canEdit={canEdit}
            comment={comment}
            onCommentChange={setComment}
            onSubmit={() => addComment.mutate()}
            submitting={addComment.isPending}
          />
        </>
      )}
    </div>
  )

  const footer = !isDone && current && (
    <div className="flex flex-col gap-2 p-4 border-t border-border">
      {canEdit && current.issue_type === 'guest_feedback' && !current.acknowledged_at && (
        <Button type="button" className="w-full h-9 gap-2" onClick={handleAcknowledge} disabled={acknowledge.isPending}>
          <UserCheck className="w-4 h-4" /> {acknowledge.isPending ? t('common.acknowledging') : t('common.acknowledge')}
        </Button>
      )}
      {canEdit && current.issue_type === 'needs_attention' && current.status !== 'Completed' && (
        <div className="flex items-center gap-2">
          <select
            value={current.status}
            onChange={e => handleStatusSelect(e.target.value)}
            className="h-9 text-sm border border-input rounded-md px-2 bg-background flex-1"
            disabled={setStatus.isPending}
          >
            {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s, t)}</option>)}
          </select>
          <Button type="button" size="sm" className="h-9 text-xs gap-1.5 flex-shrink-0" onClick={handleMarkComplete} disabled={setStatus.isPending}>
            <Check className="w-3.5 h-3.5" /> {t('common.markComplete')}
          </Button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" className="flex-1 h-9" onClick={advance}>{t('catchUp.leaveUnread')}</Button>
        <Button type="button" className="flex-1 h-9" onClick={handleMarkRead}>{t('catchUp.markAsRead')}</Button>
      </div>
    </div>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent className="h-[92dvh] max-h-[92dvh] mt-0 flex flex-col rounded-t-2xl overflow-hidden">
          <DrawerHeader className="text-left pb-2">
            <DrawerTitle>{t('catchUp.title')}</DrawerTitle>
          </DrawerHeader>
          {body}
          {footer}
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="text-left px-4 pt-4 pb-2">
          <DialogTitle>{t('catchUp.title')}</DialogTitle>
        </DialogHeader>
        {body}
        {footer}
      </DialogContent>
    </Dialog>
  )
}
