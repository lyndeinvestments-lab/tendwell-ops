import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type {
  AttributedReviewRow, CleanTaskRow, IssueRow, RatedInspectionRow,
} from '@/lib/cleaner-metrics'

// Data for Cleaner Metrics (WS3). Every source is a staff-only view or table;
// PostgREST caps a response at 1,000 rows and reports the cut only in a
// header, so every list here pages until a short page arrives.

const PAGE = 1000
const MAX_ROWS = 50_000

async function fetchAllPages<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

const TASK_COLUMNS =
  'trellis_task_id, scheduled_date, status, cleaner_id, cleaner_ids, property_id, property_name, trellis_property_name, title, clean_kind'

/** Tendwell clean tasks (any status) scheduled in [from, upcomingTo]. */
export function useCleanerTasks(from: string, upcomingTo: string) {
  return useQuery<CleanTaskRow[]>({
    queryKey: ['cleaner-metrics', 'tasks', from, upcomingTo],
    queryFn: () => fetchAllPages<CleanTaskRow>((a, b) =>
      supabase.from('trellis_cleaner_tasks')
        .select(TASK_COLUMNS)
        .gte('scheduled_date', from)
        .lte('scheduled_date', upcomingTo)
        .order('scheduled_date', { ascending: true })
        .order('trellis_task_id', { ascending: true })
        .range(a, b)),
    staleTime: 5 * 60 * 1000,
  })
}

/** Completed inspections that rate a Trellis clean, inspected since `from`
 *  (a clean is inspected on or after the day it was done). */
export function useRatedInspections(from: string) {
  return useQuery<RatedInspectionRow[]>({
    queryKey: ['cleaner-metrics', 'inspections', from],
    queryFn: () => fetchAllPages<RatedInspectionRow>((a, b) =>
      supabase.from('inspections')
        .select('id, rated_clean_task_id, overall_score, cleanliness_score, inspected_at')
        .not('rated_clean_task_id', 'is', null)
        .eq('status', 'completed')
        .gte('inspected_at', from)
        .order('inspected_at', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b)),
    staleTime: 5 * 60 * 1000,
  })
}

/** Guest reviews attributed to a Tendwell clean in the window. Only fetched
 *  for users holding the Reviews grant (the view returns nothing otherwise). */
export function useAttributedReviews(from: string, enabled: boolean) {
  return useQuery<AttributedReviewRow[]>({
    queryKey: ['cleaner-metrics', 'reviews', from],
    queryFn: () => fetchAllPages<AttributedReviewRow>((a, b) =>
      supabase.from('review_clean_attribution')
        .select('trellis_review_id, rated_clean_task_id, cleanliness_5, normalized_rating')
        .in('attribution', ['cleaner', 'tendwell_crew'])
        .gte('clean_date', from)
        .order('trellis_review_id', { ascending: true })
        .range(a, b)),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  })
}

export interface ReviewDetail {
  trellis_review_id: string
  rated_clean_task_id: string | null
  overall_rating: number | null
  max_rating: number | null
  normalized_rating: number | null
  cleanliness_5: number | null
  content: string | null
  reviewer_name: string | null
  guest_name: string | null
  review_date: string | null
  source: string | null
}

/** Full review text for the drill-down (one cleaner's cleans only). */
export function useReviewDetails(taskIds: string[], enabled: boolean) {
  const key = [...taskIds].sort()
  return useQuery<ReviewDetail[]>({
    queryKey: ['cleaner-metrics', 'review-details', key],
    queryFn: async () => {
      const out: ReviewDetail[] = []
      // Keep each `in.(...)` filter well under URL length limits.
      for (let i = 0; i < key.length; i += 150) {
        const { data, error } = await supabase.from('review_clean_attribution')
          .select('trellis_review_id, rated_clean_task_id, overall_rating, max_rating, normalized_rating, cleanliness_5, content, reviewer_name, guest_name, review_date, source')
          .in('rated_clean_task_id', key.slice(i, i + 150))
        if (error) throw error
        out.push(...((data ?? []) as ReviewDetail[]))
      }
      return out
    },
    enabled: enabled && key.length > 0,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  })
}

/** Cleaning issues reported since `from` (matched to cleaners by last_touch). */
export function useMetricIssues(from: string) {
  return useQuery<IssueRow[]>({
    queryKey: ['cleaner-metrics', 'issues', from],
    queryFn: () => fetchAllPages<IssueRow>((a, b) =>
      supabase.from('cleaning_issues')
        .select('id, last_touch, category, status, report_date')
        .gte('report_date', from)
        .order('id', { ascending: true })
        .range(a, b)),
    staleTime: 5 * 60 * 1000,
  })
}
