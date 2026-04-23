import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'
import { useTaggableUsers } from '@/hooks/use-taggable-users'
import { MentionTextarea, MentionBody } from '@/components/MentionInput'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, MessageSquare } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface PropertyNote {
  id: string
  property_id: number
  content: string
  context: string | null
  created_at: string
  created_by: string | null
  created_by_user_id: number | null
}

interface Props {
  propertyId: number | string
  context?: string
  title?: string
  placeholder?: string
  compact?: boolean
}

export function PropertyNotesFeed({ propertyId, context, title, placeholder, compact }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { user } = useAuth()
  const [draft, setDraft] = useState('')

  const viewId = context === 'linen' ? 'linen-tracker' : 'property-list'
  const { data: taggable } = useTaggableUsers(viewId)

  const queryKey = ['/supabase/property-notes', String(propertyId), context ?? 'all']

  const { data: notes, isLoading } = useQuery<PropertyNote[]>({
    queryKey,
    queryFn: async () => {
      let q = supabase
        .from('property_notes')
        .select('*')
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false })
      if (context) q = q.eq('context', context)
      const { data, error } = await q
      if (error) throw error
      return (data || []) as PropertyNote[]
    },
    enabled: !!propertyId,
  })

  const { mutate: postNote, isPending: posting } = useMutation({
    mutationFn: async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) throw new Error('Empty')
      const { data: inserted, error } = await supabase
        .from('property_notes')
        .insert({
          property_id: propertyId,
          content: trimmed,
          context: context ?? null,
          created_by: user?.label ?? null,
          created_by_user_id: user?.id ? Number(user.id) : null,
        })
        .select()
        .single()
      if (error) throw error

      // Mirror latest note to the legacy column so list-view previews stay populated.
      // Only general notes map to properties.notes; linen context maps to linen_notes.
      const legacyCol = context === 'linen' ? 'linen_notes' : (context ? null : 'notes')
      if (legacyCol) {
        await supabase.from('properties').update({ [legacyCol]: trimmed }).eq('id', propertyId)
      }

      // Fire @-mention email notifications (best-effort — don't block the user)
      try {
        const { parseMentions, notify } = await import('@/lib/notify')
        const users = (taggable || []).map(u => ({ id: u.id, label: u.label }))
        const mentionedIds = parseMentions(trimmed, users).filter(id => String(id) !== String(user?.id))
        if (mentionedIds.length > 0) {
          const { data: prop } = await supabase
            .from('properties')
            .select('name')
            .eq('id', propertyId)
            .single()
          const propName = prop?.name || `#${propertyId}`
          const ctxLabel = context ? ` (${context})` : ''
          await notify({
            eventType: 'property_note_mention',
            subject: `${user?.label || 'Someone'} mentioned you on ${propName}${ctxLabel}`,
            bodyLines: [
              `${user?.label || 'A teammate'} mentioned you in a note on ${propName}${ctxLabel}.`,
            ],
            quoteText: trimmed,
            ctaUrl: `${window.location.origin}/property-list?property=${propertyId}`,
            ctaLabel: 'View property',
            targetUserIds: mentionedIds,
            meta: { propertyId, context: context ?? null },
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
      qc.invalidateQueries({ queryKey: ['/supabase/property-detail', String(propertyId)] })
      qc.invalidateQueries({ queryKey: ['/supabase/properties'] })
      qc.invalidateQueries({ queryKey: ['/supabase/master-list'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      qc.invalidateQueries({ queryKey: ['/supabase/quote-sheet'] })
    },
    onError: (e: any) => toast({ title: 'Failed to post note', description: e.message || '', variant: 'destructive' }),
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
          placeholder={placeholder ?? 'Write a note… use @ to tag someone'}
          rows={compact ? 2 : 3}
          dataTestId={`property-notes-composer${context ? '-' + context : ''}`}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => postNote(draft)}
            disabled={!draft.trim() || posting}
            data-testid={`property-notes-post${context ? '-' + context : ''}`}
          >
            {posting ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Posting…</> : 'Post'}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (notes || []).length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {(notes || []).map(n => (
            <li key={n.id} className="rounded-md border border-border bg-muted/30 p-2.5">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mb-1">
                <span className="font-medium text-foreground">{n.created_by || 'Unknown'}</span>
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
