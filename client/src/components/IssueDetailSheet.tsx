import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ExternalLink, Upload, Check, Loader2, MessageSquare, Image as ImageIcon, AlertTriangle, Link2 } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { resizeImageFile } from '@/lib/resize-image'

const STATUSES = ['Needs Attention', 'In Progress', 'Completed']

export function IssueDetailSheet({
  issue,
  canEdit,
  onClose,
  onChanged,
}: {
  issue: any | null
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
      return data || []
    },
  })

  const { data: photos } = useQuery({
    queryKey: ['/supabase/issue-photos', issueId],
    enabled: !!issueId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('issue_photos')
        .select('*').eq('issue_id', issueId).order('created_at', { ascending: true })
      if (error) throw error
      return data || []
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
      }).eq('id', issueId)
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
              <div className="pt-2 border-t border-border space-y-3">
                {([
                  { phase: 'initial' as const, label: 'Initial / before' },
                  { phase: 'completion' as const, label: 'Completion / after' },
                ]).map(group => {
                  const groupPhotos = (photos || []).filter((p: any) => (p.phase || 'initial') === group.phase)
                  return (
                    <div key={group.phase}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> {group.label} ({groupPhotos.length})</span>
                        {canEdit && (
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" disabled={uploading} onClick={() => {
                            const input = document.createElement('input')
                            input.type = 'file'; input.accept = 'image/*'
                            input.onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleUpload(f, group.phase) }
                            input.click()
                          }}>
                            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Add
                          </Button>
                        )}
                      </div>
                      {groupPhotos.length > 0 ? (
                        <div className="grid grid-cols-3 gap-2">
                          {groupPhotos.map((p: any) => (
                            <a key={p.id} href={p.photo_url} target="_blank" rel="noreferrer" className="block aspect-square rounded-md border border-border overflow-hidden bg-muted/30 hover:opacity-80">
                              <img src={p.photo_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                            </a>
                          ))}
                        </div>
                      ) : <p className="text-xs text-muted-foreground">{group.phase === 'initial' ? 'No initial photos.' : 'No completion photos yet.'}</p>}
                    </div>
                  )
                })}
              </div>

              {/* Comments */}
              <div className="pt-2 border-t border-border">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2"><MessageSquare className="w-3.5 h-3.5" /> Comments</span>
                {canEdit && (
                  <div className="flex gap-2 mb-3">
                    <textarea
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                      placeholder="Add a comment…"
                      className="flex-1 h-16 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <Button size="sm" className="h-8 self-end" disabled={!comment.trim() || addComment.isPending} onClick={() => addComment.mutate()}>
                      {addComment.isPending ? '…' : 'Post'}
                    </Button>
                  </div>
                )}
                {commentsLoading ? (
                  <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
                ) : comments && comments.length > 0 ? (
                  <ul className="space-y-2">
                    {comments.map((c: any) => (
                      <li key={c.id} className="rounded-md border border-border bg-muted/20 p-2">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-xs font-medium">
                            {c.author_name || (c.author_type === 'cleaner' ? 'Cleaner' : 'Staff')}
                            {c.author_type === 'cleaner' && <span className="ml-1 text-[10px] text-muted-foreground">(via link)</span>}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{c.content}</p>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-xs text-muted-foreground">No comments yet.</p>}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
