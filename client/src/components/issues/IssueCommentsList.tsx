import { formatDistanceToNow } from 'date-fns'
import { es as dateFnsEs } from 'date-fns/locale'
import { MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { IssueComment } from '@/lib/issues'
import { useLocale } from '@/lib/i18n/LocaleProvider'

/**
 * Dumb presentational comments list, extracted from `IssueDetailSheet`.
 * All data fetching/mutation stays in the parent — no behavior change.
 */
export function IssueCommentsList({
  comments,
  isLoading,
  canEdit,
  comment,
  onCommentChange,
  onSubmit,
  submitting,
}: {
  comments: IssueComment[] | undefined
  isLoading: boolean
  canEdit: boolean
  comment: string
  onCommentChange: (value: string) => void
  onSubmit: () => void
  submitting: boolean
}) {
  const { t, locale } = useLocale('issues')
  return (
    <div className="pt-2 border-t border-border">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2"><MessageSquare className="w-3.5 h-3.5" /> {t('comments.title')}</span>
      {canEdit && (
        <div className="flex gap-2 mb-3">
          <textarea
            value={comment}
            onChange={e => onCommentChange(e.target.value)}
            placeholder={t('comments.placeholder')}
            className="flex-1 h-16 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button size="sm" className="h-8 self-end" disabled={!comment.trim() || submitting} onClick={onSubmit}>
            {submitting ? t('comments.posting') : t('comments.post')}
          </Button>
        </div>
      )}
      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
      ) : comments && comments.length > 0 ? (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border border-border bg-muted/20 p-2">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-xs font-medium">
                  {c.author_name || (c.author_type === 'cleaner' ? t('comments.cleaner') : t('comments.staff'))}
                  {c.author_type === 'cleaner' && <span className="ml-1 text-[10px] text-muted-foreground">{t('comments.viaLink')}</span>}
                </span>
                <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(c.created_at), { addSuffix: true, locale: locale === 'es' ? dateFnsEs : undefined })}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{c.content}</p>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted-foreground">{t('comments.empty')}</p>}
    </div>
  )
}
