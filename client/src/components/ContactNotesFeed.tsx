import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'
import { useTaggableUsers } from '@/hooks/use-taggable-users'
import { CONTACTS_QUERY_KEY } from '@/hooks/use-contacts'
import { MentionTextarea, MentionBody } from '@/components/MentionInput'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, MessageSquare } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'

interface ContactNote {
  id: string
  contact_id: string
  content: string
  created_at: string
  created_by: string | null
}

interface Props {
  contactId: string
  title?: string
  placeholder?: string
  compact?: boolean
}

export function ContactNotesFeed({ contactId, title, placeholder, compact }: Props) {
  const { t } = useLocale('contacts')
  const { formatDistanceToNow } = useDateFormat()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { user } = useAuth()
  const [draft, setDraft] = useState('')

  const { data: taggable } = useTaggableUsers('contacts')

  const queryKey = ['/supabase/contact-notes', contactId]

  const { data: notes, isLoading } = useQuery<ContactNote[]>({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contact_notes')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []) as ContactNote[]
    },
    enabled: !!contactId,
  })

  const { mutate: postNote, isPending: posting } = useMutation({
    mutationFn: async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) throw new Error('Empty')
      const { data: inserted, error } = await supabase
        .from('contact_notes')
        .insert({
          contact_id: contactId,
          content: trimmed,
          created_by: user?.label ?? null,
        })
        .select()
        .single()
      if (error) throw error

      // Mirror latest note to contacts.notes for list-view previews
      await supabase.from('contacts').update({ notes: trimmed }).eq('id', contactId)

      // Fire mention notifications (best-effort)
      try {
        const { parseMentions, notify } = await import('@/lib/notify')
        const users = (taggable || []).map(u => ({ id: u.id, label: u.label }))
        const mentionedIds = parseMentions(trimmed, users).filter(id => String(id) !== String(user?.id))
        if (mentionedIds.length > 0) {
          const { data: contact } = await supabase
            .from('contacts')
            .select('full_name')
            .eq('id', contactId)
            .single()
          const contactName = contact?.full_name || 'a contact'
          await notify({
            eventType: 'contact_note_mention',
            subject: `${user?.label || 'Someone'} mentioned you on ${contactName}`,
            bodyLines: [
              `${user?.label || 'A teammate'} mentioned you in a note on ${contactName}.`,
            ],
            quoteText: trimmed,
            ctaUrl: `${window.location.origin}/contacts?contact=${contactId}`,
            ctaLabel: 'View contact',
            targetUserIds: mentionedIds,
            meta: { contactId },
          })
        }
      } catch (e) {
        console.warn('mention notify failed:', e)
      }

      return inserted
    },
    onSuccess: () => {
      setDraft('')
      qc.invalidateQueries({ queryKey })
      qc.invalidateQueries({ queryKey: ['/supabase/contact', contactId] })
      qc.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY })
    },
    onError: (e: any) => toast({ title: t('notes.toastPostFailed'), description: e.message || '', variant: 'destructive' }),
  })

  const userLabels = (taggable || []).map(u => u.label)

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {title && (
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5" /> {title}
        </h4>
      )}

      <div className="space-y-2">
        <MentionTextarea
          value={draft}
          onChange={setDraft}
          users={taggable || []}
          placeholder={placeholder ?? t('notes.composerPlaceholder')}
          rows={compact ? 2 : 3}
          dataTestId="contact-notes-composer"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => postNote(draft)}
            disabled={!draft.trim() || posting}
            data-testid="contact-notes-post"
          >
            {posting ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />{t('notes.posting')}</> : t('notes.postButton')}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (notes || []).length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{t('notes.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {(notes || []).map(n => (
            <li key={n.id} className="rounded-md border border-border bg-muted/30 p-2.5">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mb-1">
                <span className="font-medium text-foreground">{n.created_by || t('notes.unknownAuthor')}</span>
                <span>{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span>
              </div>
              <div className="text-sm whitespace-pre-wrap break-words">
                <MentionBody text={n.content} userLabels={userLabels} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
