import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'
import { useIssueTranslations, type TranslatableCandidate } from '@/hooks/use-issue-translations'
import { triggerIssueTranslate } from '@/lib/issue-translate'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ExternalLink, Check, AlertTriangle, Languages, Link2, UserCheck, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import { es as dateFnsEs } from 'date-fns/locale'
import { resizeImageFile } from '@/lib/resize-image'
import { PRIORITIES, STATUSES, issueTypeLabel, priorityLabel, statusLabel, type Issue, type IssueComment, type IssuePhoto } from '@/lib/issues'
import { IssueBadges } from '@/components/issues/IssueBadges'
import { IssueCommentsList } from '@/components/issues/IssueCommentsList'
import { IssuePhotoGrid } from '@/components/issues/IssuePhotoGrid'

const TRANSLATABLE_ISSUE_FIELDS = ['details', 'assessment', 'resolution', 'remarks', 'coverage'] as const

export function IssueDetailSheet({
  issue,
  canEdit,
  onClose,
  onChanged,
}: {
  issue: Issue | null
  canEdit: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const { t, locale } = useLocale()
  const { effectiveUser } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [comment, setComment] = useState('')
  const [uploading, setUploading] = useState(false)
  const [copied, setCopied] = useState(false)
  const issueId = issue?.id

  // Local overlay for fields this sheet can mutate. The page's `issue` prop
  // is a snapshot from the list query at open time — after a mutation here,
  // `onChanged()` invalidates that query but doesn't hand the sheet a fresh
  // object, so without this overlay the Acknowledge line / priority / due
  // date / share-link controls would show stale values until the sheet is
  // closed and reopened. Reset whenever a different issue is opened.
  const [overrides, setOverrides] = useState<Partial<Issue>>({})
  useEffect(() => { setOverrides({}) }, [issueId])
  const view = issue ? { ...issue, ...overrides } : null

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

  // Candidates for the ES overlay: every translatable field on this issue +
  // every loaded comment. `useIssueTranslations` is a no-op when the UI
  // locale isn't Spanish (no query, `tr()` returns the original), so this
  // is always safe to build.
  const translationCandidates = useMemo<TranslatableCandidate[]>(() => {
    if (!view) return []
    const items: TranslatableCandidate[] = TRANSLATABLE_ISSUE_FIELDS.map(field => ({
      issueId: view.id, sourceId: view.id, field, text: view[field],
    }))
    for (const c of comments || []) items.push({ issueId: view.id, sourceId: c.id, field: 'content', text: c.content })
    return items
  }, [view, comments])

  const { tr, isSpanish } = useIssueTranslations(translationCandidates)
  const hasTranslatableContent = translationCandidates.some(c => c.text && c.text.trim())

  // "Ver original / Mostrar traducción" — spot-check toggle. Content is
  // auto-translated by default whenever the UI is in Spanish; this just lets
  // staff peek at the original. Resets whenever a different issue opens.
  const [showOriginal, setShowOriginal] = useState(false)
  useEffect(() => { setShowOriginal(false) }, [issueId])

  const displayComments = useMemo(() => {
    if (!comments) return comments
    return comments.map(c => ({ ...c, content: (showOriginal ? c.content : tr(c.id, 'content', c.content)) ?? c.content }))
  }, [comments, showOriginal, tr])

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
      // Fire-and-forget: warms the ES cache for this comment so the overlay
      // doesn't have to wait for the lazy backfill pass. Never awaited.
      if (issueId && data?.id) void triggerIssueTranslate(issueId, [{ id: `comment:${data.id}` }], 'es')
    },
    onError: (e: any) => toast({ title: t('detail.toastCommentFailed'), description: e?.message, variant: 'destructive' }),
  })

  const setStatus = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.from('cleaning_issues').update({
        status,
        completed_at: status === 'Completed' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('id', issueId as string)
      if (error) throw error
      return status
    },
    onSuccess: (status) => { setOverrides(o => ({ ...o, status })); toast({ title: t('detail.toastStatusUpdated') }); onChanged() },
    onError: (e: any) => toast({ title: t('detail.toastUpdateFailed'), description: e?.message, variant: 'destructive' }),
  })

  const setPriority = useMutation({
    mutationFn: async (priority: string) => {
      const { error } = await supabase.from('cleaning_issues').update({
        priority, updated_at: new Date().toISOString(),
      }).eq('id', issueId as string)
      if (error) throw error
      return priority
    },
    onSuccess: (priority) => { setOverrides(o => ({ ...o, priority })); toast({ title: t('detail.toastPriorityUpdated') }); onChanged() },
    onError: (e: any) => toast({ title: t('detail.toastUpdateFailed'), description: e?.message, variant: 'destructive' }),
  })

  const setDueDate = useMutation({
    mutationFn: async (dueDate: string) => {
      const due_date = dueDate || null
      const { error } = await supabase.from('cleaning_issues').update({
        due_date, updated_at: new Date().toISOString(),
      }).eq('id', issueId as string)
      if (error) throw error
      return due_date
    },
    onSuccess: (due_date) => { setOverrides(o => ({ ...o, due_date })); toast({ title: t('detail.toastDueDateUpdated') }); onChanged() },
    onError: (e: any) => toast({ title: t('detail.toastUpdateFailed'), description: e?.message, variant: 'destructive' }),
  })

  const acknowledge = useMutation({
    mutationFn: async () => {
      const acknowledged_at = new Date().toISOString()
      const acknowledged_by = effectiveUser?.label || null
      const { error } = await supabase.from('cleaning_issues').update({ acknowledged_at, acknowledged_by }).eq('id', issueId as string)
      if (error) throw error
      return { acknowledged_at, acknowledged_by }
    },
    onSuccess: (patch) => { setOverrides(o => ({ ...o, ...patch })); toast({ title: t('detail.toastAcknowledged') }); onChanged() },
    onError: (e: any) => toast({ title: t('detail.toastAcknowledgeFailed'), description: e?.message, variant: 'destructive' }),
  })

  const toggleShareLinkDisabled = useMutation({
    mutationFn: async (share_link_disabled: boolean) => {
      const { error } = await supabase.from('cleaning_issues').update({ share_link_disabled }).eq('id', issueId as string)
      if (error) throw error
      return share_link_disabled
    },
    onSuccess: (share_link_disabled) => {
      setOverrides(o => ({ ...o, share_link_disabled }))
      toast({ title: share_link_disabled ? t('detail.toastLinkDisabled') : t('detail.toastLinkEnabled') })
      onChanged()
    },
    onError: (e: any) => toast({ title: t('detail.toastUpdateFailed'), description: e?.message, variant: 'destructive' }),
  })

  const regenerateLink = useMutation({
    mutationFn: async () => {
      const share_token = crypto.randomUUID()
      const { error } = await supabase.from('cleaning_issues').update({ share_token }).eq('id', issueId as string)
      if (error) throw error
      return share_token
    },
    onSuccess: (share_token) => {
      setOverrides(o => ({ ...o, share_token }))
      toast({ title: t('detail.toastRegenerated'), description: t('detail.toastRegeneratedDescription') })
      onChanged()
    },
    onError: (e: any) => toast({ title: t('detail.toastRegenerateFailed'), description: e?.message, variant: 'destructive' }),
  })

  async function handleUpload(raw: File, phase: 'initial' | 'completion') {
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

  const trField = (field: typeof TRANSLATABLE_ISSUE_FIELDS[number], original: string | null) =>
    view ? ((showOriginal ? original : tr(view.id, field, original)) ?? original) : original

  const infoRows = view ? [
    { id: null, label: t('detail.category'), value: view.category },
    { id: null, label: t('detail.lastTouch'), value: view.last_touch },
    { id: 'details', label: t('detail.details'), value: trField('details', view.details) },
    { id: 'assessment', label: t('detail.assessment'), value: trField('assessment', view.assessment) },
    { id: 'resolution', label: t('detail.resolution'), value: trField('resolution', view.resolution) },
    { id: 'coverage', label: t('detail.coverage'), value: trField('coverage', view.coverage) },
    { id: 'remarks', label: t('detail.remarks'), value: trField('remarks', view.remarks) },
    { id: null, label: t('detail.slackLink'), value: view.slack_link, isLink: true },
  ] : []

  return (
    <Sheet open={!!issue} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[520px] overflow-y-auto">
        {issue && view && (
          <>
            <SheetHeader>
              <SheetTitle className="text-base">{view.property_name || t('common.noProperty')}</SheetTitle>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${view.issue_type === 'guest_feedback' ? 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-900/20 dark:border-blue-800' : 'text-purple-700 bg-purple-50 border-purple-200 dark:text-purple-400 dark:bg-purple-900/20 dark:border-purple-800'}`}>
                  {issueTypeLabel(view.issue_type, t)}
                </span>
                {view.priority === 'urgent' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800">
                    <AlertTriangle className="w-3 h-3" /> {t('badges.urgent')}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{format(new Date(view.report_date), 'MMMM d, yyyy', { locale: locale === 'es' ? dateFnsEs : undefined })}</span>
              </div>
              <IssueBadges issue={view} variant="full" className="mt-2" />
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {/* Content is auto-translated whenever the UI is in Spanish
                  (write-time + lazy-backfill cache, see use-issue-translations)
                  - this is just a spot-check toggle, not a translate trigger. */}
              {isSpanish && hasTranslatableContent && (
                <div className="flex items-center justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => setShowOriginal(v => !v)}
                  >
                    <Languages className="w-3.5 h-3.5" />
                    {showOriginal ? t('translate.showTranslation') : t('translate.showOriginal')}
                  </Button>
                  {!showOriginal && <span className="text-2xs text-muted-foreground italic">{t('translate.machineTranslated')}</span>}
                </div>
              )}

              {/* Acknowledge — same visual weight as the share-link button below,
                  prominent at the top since it's the primary action for an
                  unacknowledged guest-feedback item. */}
              {canEdit && view.issue_type === 'guest_feedback' && !view.acknowledged_at && (
                <Button
                  type="button"
                  className="w-full h-9 gap-2"
                  onClick={() => acknowledge.mutate()}
                  disabled={acknowledge.isPending}
                >
                  <UserCheck className="w-4 h-4" /> {acknowledge.isPending ? t('common.acknowledging') : t('common.acknowledge')}
                </Button>
              )}

              {/* Shareable cleaner link */}
              {view.share_token && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${window.location.origin}/issue/${view.share_token}`
                      navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
                    }}
                    className="w-full flex items-center justify-center gap-2 h-9 rounded-md border border-primary/40 bg-primary/5 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
                  >
                    {copied ? <><Check className="w-4 h-4" /> {t('detail.linkCopied')}</> : <><Link2 className="w-4 h-4" /> {t('detail.copyLink')}</>}
                  </button>
                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-xs gap-1.5"
                        onClick={() => toggleShareLinkDisabled.mutate(!view.share_link_disabled)}
                        disabled={toggleShareLinkDisabled.isPending}
                      >
                        {view.share_link_disabled ? <><Eye className="w-3.5 h-3.5" /> {t('detail.enableLink')}</> : <><EyeOff className="w-3.5 h-3.5" /> {t('detail.disableLink')}</>}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-xs gap-1.5"
                        onClick={() => {
                          if (window.confirm(t('detail.regenerateConfirm'))) {
                            regenerateLink.mutate()
                          }
                        }}
                        disabled={regenerateLink.isPending}
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> {t('detail.regenerateLink')}
                      </Button>
                    </div>
                  )}
                  {view.share_link_disabled && (
                    <p className="text-2xs text-destructive">{t('detail.linkDisabledNote')}</p>
                  )}
                </div>
              )}

              {/* Status / complete */}
              {canEdit && (
                <div className="flex items-center gap-2 pb-3 border-b border-border">
                  <select
                    value={view.status}
                    onChange={e => setStatus.mutate(e.target.value)}
                    className="h-8 text-sm border border-input rounded-md px-2 bg-background flex-1"
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s, t)}</option>)}
                  </select>
                  {view.status !== 'Completed' && (
                    <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setStatus.mutate('Completed')} disabled={setStatus.isPending}>
                      <Check className="w-3.5 h-3.5" /> {t('common.markComplete')}
                    </Button>
                  )}
                </div>
              )}

              {/* Priority / due date — needs_attention only */}
              {canEdit && view.issue_type === 'needs_attention' && (
                <div className="grid grid-cols-2 gap-3 pb-3 border-b border-border">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">{t('detail.priority')}</label>
                    <select
                      value={view.priority}
                      onChange={e => setPriority.mutate(e.target.value)}
                      className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background"
                      disabled={setPriority.isPending}
                    >
                      {PRIORITIES.map(p => <option key={p} value={p}>{priorityLabel(p, t)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">{t('detail.dueDate')}</label>
                    <Input
                      type="date"
                      value={view.due_date || ''}
                      onChange={e => setDueDate.mutate(e.target.value)}
                      className="h-8 text-sm"
                      disabled={setDueDate.isPending}
                    />
                  </div>
                </div>
              )}

              {/* Info */}
              {infoRows.map((row: any) => row.value ? (
                <div key={row.label}>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">{row.label}</span>
                  {row.isLink ? (
                    <a href={row.value} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
                      <ExternalLink className="w-3.5 h-3.5" /> {t('detail.open')}
                    </a>
                  ) : (
                    <>
                      <p className="text-sm whitespace-pre-wrap">{row.value}</p>
                      {isSpanish && !showOriginal && row.id && <p className="text-2xs text-muted-foreground italic mt-0.5">{t('translate.machineTranslated')}</p>}
                    </>
                  )}
                </div>
              ) : null)}

              {/* Photos — initial (before) and completion (after) */}
              <IssuePhotoGrid photos={photos} canEdit={canEdit} uploading={uploading} onUpload={handleUpload} />

              {/* Comments */}
              <IssueCommentsList
                comments={displayComments}
                isLoading={commentsLoading}
                canEdit={canEdit}
                comment={comment}
                onCommentChange={setComment}
                onSubmit={() => addComment.mutate()}
                submitting={addComment.isPending}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
