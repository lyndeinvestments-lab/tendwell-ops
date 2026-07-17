import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { Issue } from '@/lib/issues'

/**
 * The issues page's list query key (`pages/issues.tsx`) — reads from the
 * `issue_catchup_feed` view. Shared here so `markRead`'s optimistic patch
 * updates the exact same cache entry the page renders from.
 */
export const ISSUES_QUERY_KEY = ['/supabase/cleaning-issues']

interface MarkReadContext {
  previous: Issue[] | undefined
}

/**
 * Per-user Catch-up read state (`issue_reads`, self-rows only under RLS).
 *
 * `markRead` optimistically flips the issue's `is_unread` in the cached
 * issues list so the badge/queue count updates instantly, then upserts the
 * read cursor. It deliberately does NOT invalidate on success/settle — the
 * Catch-up flow calls `invalidateAll()` once when it closes so mid-flow
 * stepping never triggers a refetch (which could reorder the frozen queue).
 */
export function useIssueReads() {
  const qc = useQueryClient()
  const { effectiveUser } = useAuth()

  const markReadMutation = useMutation<{ issueId: string; last_read_at: string }, Error, string, MarkReadContext>({
    mutationFn: async (issueId: string) => {
      if (!effectiveUser?.id) throw new Error('Not signed in')
      const nowIso = new Date().toISOString()
      const { error } = await supabase.from('issue_reads').upsert(
        {
          issue_id: issueId,
          user_id: Number(effectiveUser.id),
          last_read_at: nowIso,
          marked_unread: false,
          updated_at: nowIso,
        },
        { onConflict: 'issue_id,user_id' },
      )
      if (error) throw error
      return { issueId, last_read_at: nowIso }
    },
    onMutate: async (issueId: string) => {
      const nowIso = new Date().toISOString()
      const previous = qc.getQueryData<Issue[]>(ISSUES_QUERY_KEY)
      qc.setQueryData<Issue[]>(ISSUES_QUERY_KEY, (old) =>
        old?.map((issue) =>
          issue.id === issueId
            ? { ...issue, is_unread: false, last_read_at: nowIso, marked_unread: false }
            : issue,
        ) ?? old,
      )
      return { previous }
    },
    onError: (_error, _issueId, context) => {
      if (context?.previous) qc.setQueryData(ISSUES_QUERY_KEY, context.previous)
    },
  })

  /** Called once when the Catch-up flow closes — refreshes the list + issue_reads. */
  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ISSUES_QUERY_KEY })
  }

  return {
    markRead: markReadMutation.mutate,
    markReadAsync: markReadMutation.mutateAsync,
    isMarkingRead: markReadMutation.isPending,
    invalidateAll,
  }
}
