import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ExternalLink, Check, AlertTriangle, Link2, UserCheck, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import { resizeImageFile } from '@/lib/resize-image'
import { PRIORITIES, STATUSES, type Issue, type IssueComment, type IssuePhoto } from '@/lib/issues'
import { IssueBadges } from '@/components/issues/IssueBadges'
import { IssueCommentsList } from '@/components/issues/IssueCommentsList'
import { IssuePhotoGrid } from '@/components/issues/IssuePhotoGrid'

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

  const addComment = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from('issue_comments').insert({
        issue_id: issueId, content: comment.trim(),
        author_name: effectiveUser?.label || null, author_type: 'staff',
      })
      if (error) throw error
    },
    onSuccess: () => { setComment(''); qc.invalidateQueries({ queryKey: ['/supabase/issue-comments', issueId] }) },
    onError: (e: any) => toast({ title: 'Comment failed', description: e?.message, variant: 'destructive' }),
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
    onSuccess: (status) => { setOverrides(o => ({ ...o, status })); toast({ title: 'Status updated' }); onChanged() },
    onError: (e: any) => toast({ title: 'Update failed', description: e?.message, variant: 'destructive' }),
  })

  const setPriority = useMutation({
    mutationFn: async (priority: string) => {
      const { error } = await supabase.from('cleaning_issues').update({
        priority, updated_at: new Date().toISOString(),
      }).eq('id', issueId as string)
      if (error) throw error
      return priority
    },
    onSuccess: (priority) => { setOverrides(o => ({ ...o, priority })); toast({ title: 'Priority updated' }); onChanged() },
    onError: (e: any) => toast({ title: 'Update failed', description: e?.message, variant: 'destructive' }),
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
    onSuccess: (due_date) => { setOverrides(o => ({ ...o, due_date })); toast({ title: 'Due date updated' }); onChanged() },
    onError: (e: any) => toast({ title: 'Update failed', description: e?.message, variant: 'destructive' }),
  })

  const acknowledge = useMutation({
    mutationFn: async () => {
      const acknowledged_at = new Date().toISOString()
      const acknowledged_by = effectiveUser?.label || null
      const { error } = await supabase.from('cleaning_issues').update({ acknowledged_at, acknowledged_by }).eq('id', issueId as string)
      if (error) throw error
      return { acknowledged_at, acknowledged_by }
    },
    onSuccess: (patch) => { setOverrides(o => ({ ...o, ...patch })); toast({ title: 'Acknowledged' }); onChanged() },
    onError: (e: any) => toast({ title: 'Acknowledge failed', description: e?.message, variant: 'destructive' }),
  })

  const toggleShareLinkDisabled = useMutation({
    mutationFn: async (share_link_disabled: boolean) => {
      const { error } = await supabase.from('cleaning_issues').update({ share_link_disabled }).eq('id', issueId as string)
      if (error) throw error
      return share_link_disabled
    },
    onSuccess: (share_link_disabled) => {
      setOverrides(o => ({ ...o, share_link_disabled }))
      toast({ title: share_link_disabled ? 'Share link disabled' : 'Share link enabled' })
      onChanged()
    },
    onError: (e: any) => toast({ title: 'Update failed', description: e?.message, variant: 'destructive' }),
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
      toast({ title: 'Share link regenerated', description: 'The old link no longer works.' })
      onChanged()
    },
    onError: (e: any) => toast({ title: 'Regenerate failed', description: e?.message, variant: 'destructive' }),
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
      toast({ title: 'Photo upload failed', description: e?.message, variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }

  const infoRows = view ? [
    { label: 'Category', value: view.category },
    { label: 'Person responsible (last touch)', value: view.last_touch },
    { label: 'Details', value: view.details },
    { label: 'Assessment', value: view.assessment },
    { label: 'Resolution', value: view.resolution },
    { label: 'Coverage', value: view.coverage },
    { label: 'Remarks', value: view.remarks },
    { label: 'Slack Link', value: view.slack_link, isLink: true },
  ] : []

  return (
    <Sheet open={!!issue} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[520px] overflow-y-auto">
        {issue && view && (
          <>
            <SheetHeader>
              <SheetTitle className="text-base">{view.property_name || '(no property)'}</SheetTitle>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${view.issue_type === 'guest_feedback' ? 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-900/20 dark:border-blue-800' : 'text-purple-700 bg-purple-50 border-purple-200 dark:text-purple-400 dark:bg-purple-900/20 dark:border-purple-800'}`}>
                  {view.issue_type === 'guest_feedback' ? 'Guest Feedback' : 'Needs Attention'}
                </span>
                {view.priority === 'urgent' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800">
                    <AlertTriangle className="w-3 h-3" /> Urgent
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{format(new Date(view.report_date), 'MMMM d, yyyy')}</span>
              </div>
              <IssueBadges issue={view} variant="full" className="mt-2" />
            </SheetHeader>

            <div className="mt-4 space-y-4">
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
                  <UserCheck className="w-4 h-4" /> {acknowledge.isPending ? 'Acknowledging…' : 'Acknowledge'}
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
                    {copied ? <><Check className="w-4 h-4" /> Link copied — send it to the cleaner</> : <><Link2 className="w-4 h-4" /> Copy cleaner share link</>}
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
                        {view.share_link_disabled ? <><Eye className="w-3.5 h-3.5" /> Enable link</> : <><EyeOff className="w-3.5 h-3.5" /> Disable link</>}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-xs gap-1.5"
                        onClick={() => {
                          if (window.confirm('Regenerate the share link? The old link will stop working immediately.')) {
                            regenerateLink.mutate()
                          }
                        }}
                        disabled={regenerateLink.isPending}
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Regenerate link
                      </Button>
                    </div>
                  )}
                  {view.share_link_disabled && (
                    <p className="text-2xs text-destructive">This link is disabled — cleaners can't open it until you re-enable it.</p>
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
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {view.status !== 'Completed' && (
                    <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setStatus.mutate('Completed')} disabled={setStatus.isPending}>
                      <Check className="w-3.5 h-3.5" /> Mark Complete
                    </Button>
                  )}
                </div>
              )}

              {/* Priority / due date — needs_attention only */}
              {canEdit && view.issue_type === 'needs_attention' && (
                <div className="grid grid-cols-2 gap-3 pb-3 border-b border-border">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Priority</label>
                    <select
                      value={view.priority}
                      onChange={e => setPriority.mutate(e.target.value)}
                      className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background capitalize"
                      disabled={setPriority.isPending}
                    >
                      {PRIORITIES.map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Due date</label>
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
                      <ExternalLink className="w-3.5 h-3.5" /> Open
                    </a>
                  ) : <p className="text-sm whitespace-pre-wrap">{row.value}</p>}
                </div>
              ) : null)}

              {/* Photos — initial (before) and completion (after) */}
              <IssuePhotoGrid photos={photos} canEdit={canEdit} uploading={uploading} onUpload={handleUpload} />

              {/* Comments */}
              <IssueCommentsList
                comments={comments}
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
