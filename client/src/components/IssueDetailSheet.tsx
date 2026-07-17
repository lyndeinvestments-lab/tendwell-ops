import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { ExternalLink, Check, AlertTriangle, Link2 } from 'lucide-react'
import { format } from 'date-fns'
import { resizeImageFile } from '@/lib/resize-image'
import { STATUSES, type Issue, type IssueComment, type IssuePhoto } from '@/lib/issues'
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
    onSuccess: () => { toast({ title: 'Status updated' }); onChanged() },
    onError: (e: any) => toast({ title: 'Update failed', description: e?.message, variant: 'destructive' }),
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

  const infoRows = issue ? [
    { label: 'Category', value: issue.category },
    { label: 'Person responsible (last touch)', value: issue.last_touch },
    { label: 'Details', value: issue.details },
    { label: 'Assessment', value: issue.assessment },
    { label: 'Resolution', value: issue.resolution },
    { label: 'Coverage', value: issue.coverage },
    { label: 'Remarks', value: issue.remarks },
    { label: 'Slack Link', value: issue.slack_link, isLink: true },
  ] : []

  return (
    <Sheet open={!!issue} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[520px] overflow-y-auto">
        {issue && (
          <>
            <SheetHeader>
              <SheetTitle className="text-base">{issue.property_name || '(no property)'}</SheetTitle>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${issue.issue_type === 'guest_feedback' ? 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-900/20 dark:border-blue-800' : 'text-purple-700 bg-purple-50 border-purple-200 dark:text-purple-400 dark:bg-purple-900/20 dark:border-purple-800'}`}>
                  {issue.issue_type === 'guest_feedback' ? 'Guest Feedback' : 'Needs Attention'}
                </span>
                {issue.priority === 'urgent' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800">
                    <AlertTriangle className="w-3 h-3" /> Urgent
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{format(new Date(issue.report_date), 'MMMM d, yyyy')}</span>
              </div>
              <IssueBadges issue={issue} variant="full" className="mt-2" />
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {/* Shareable cleaner link */}
              {issue.share_token && (
                <button
                  type="button"
                  onClick={() => {
                    const url = `${window.location.origin}/issue/${issue.share_token}`
                    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
                  }}
                  className="w-full flex items-center justify-center gap-2 h-9 rounded-md border border-primary/40 bg-primary/5 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
                >
                  {copied ? <><Check className="w-4 h-4" /> Link copied — send it to the cleaner</> : <><Link2 className="w-4 h-4" /> Copy cleaner share link</>}
                </button>
              )}

              {/* Status / complete */}
              {canEdit && (
                <div className="flex items-center gap-2 pb-3 border-b border-border">
                  <select
                    value={issue.status}
                    onChange={e => setStatus.mutate(e.target.value)}
                    className="h-8 text-sm border border-input rounded-md px-2 bg-background flex-1"
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {issue.status !== 'Completed' && (
                    <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setStatus.mutate('Completed')} disabled={setStatus.isPending}>
                      <Check className="w-3.5 h-3.5" /> Mark Complete
                    </Button>
                  )}
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
