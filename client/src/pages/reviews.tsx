import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Star,
  Sparkles,
  KeyRound,
  MessageSquare,
  DollarSign,
  MapPin,
  BadgeCheck,
  Search,
  MessageSquareText,
  AlertCircle,
  Building2,
  type LucideIcon,
} from 'lucide-react'
import { usePageTitle } from '@/hooks/use-page-title'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types — mirror the Haven /api/reviews proxy payload
// ---------------------------------------------------------------------------

interface HostawayReviewCategory {
  category?: string | null
  categoryName?: string | null
  rating?: number | null
}

interface HostawayReview {
  id: number
  type: string
  status: string
  rating: number | null // Hostaway 0–10 scale
  publicReview: string | null
  privateFeedback?: string | null
  revieweeResponse?: string | null
  reviewCategory?: HostawayReviewCategory[] | null
  listingMapId: number | null
  listingName: string | null
  reservationId: number | null
  guestName: string | null
  arrivalDate: string | null
  departureDate: string | null
  insertedOn: string | null
  updatedOn: string | null
}

interface ReviewsResponse {
  reviews: HostawayReview[]
  count: number
  ratingScale: number
}

// ---------------------------------------------------------------------------
// Auth fetch — forwards the Supabase session token to the server proxy.
// (The default React Query fetcher doesn't attach the Bearer header, and the
// /api/reviews/list proxy requires it.)
// ---------------------------------------------------------------------------

async function authFetch<T>(path: string): Promise<T> {
  const { supabase } = await import('@/lib/supabase')
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')
  const r = await fetch(path, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const text = await r.text()
  if (!r.ok) {
    let body: any = text
    try {
      body = JSON.parse(text)
    } catch {
      /* keep raw text */
    }
    throw new Error(body?.hint || body?.error || `Request failed (${r.status})`)
  }
  return text ? (JSON.parse(text) as T) : ({} as T)
}

// ---------------------------------------------------------------------------
// Filter option models
// ---------------------------------------------------------------------------

const WINDOW_OPTIONS = [
  { value: '90d', label: 'Last 90 days', days: 90 },
  { value: '180d', label: 'Last 180 days', days: 180 },
  { value: '365d', label: 'Last 12 months', days: 365 },
  { value: '730d', label: 'Last 2 years', days: 730 },
  { value: 'all', label: 'All time', days: null },
] as const
type WindowValue = (typeof WINDOW_OPTIONS)[number]['value']

type RatingBand = 'all' | '5' | '4.5' | '4' | 'below4' | 'unrated'
type ResponseState = 'all' | 'responded' | 'needs_response'
type SortValue =
  | 'newest_departure'
  | 'oldest_departure'
  | 'highest_rating'
  | 'lowest_rating'
  | 'lowest_cleanliness'
  | 'listing'

// ---------------------------------------------------------------------------
// Rating + category helpers (ported from Haven's reviews page)
// ---------------------------------------------------------------------------

function ratingFive(rating: number | null): number {
  return typeof rating === 'number' ? rating / 2 : Number.NaN
}

function formatFiveStar(rating: number | null, digits = 1): string {
  return typeof rating === 'number' ? `${(rating / 2).toFixed(digits)}` : '—'
}

function formatTenPoint(rating: number | null, digits = 1): string {
  return typeof rating === 'number' ? rating.toFixed(digits) : '—'
}

function normalizeCategoryKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z]/g, '')
}

function parseReviewCategories(
  raw: HostawayReview['reviewCategory'],
): Array<{ key: string; rating: number }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ key: string; rating: number }> = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const name =
      typeof entry.category === 'string'
        ? entry.category
        : typeof entry.categoryName === 'string'
          ? entry.categoryName
          : null
    if (!name) continue
    // Read defensively: Hostaway sometimes sends category ratings as strings.
    const rawRating: unknown = (entry as Record<string, unknown>).rating
    const rating =
      typeof rawRating === 'number'
        ? rawRating
        : typeof rawRating === 'string' && rawRating.trim() !== ''
          ? Number(rawRating)
          : NaN
    if (!Number.isFinite(rating)) continue
    out.push({ key: normalizeCategoryKey(name), rating })
  }
  return out
}

const CATEGORY_DEFS: ReadonlyArray<{
  label: string
  icon: LucideIcon
  keys: readonly string[]
}> = [
  { label: 'Cleanliness', icon: Sparkles, keys: ['cleanliness'] },
  { label: 'Check-in', icon: KeyRound, keys: ['checkin'] },
  { label: 'Communication', icon: MessageSquare, keys: ['communication'] },
  { label: 'Value', icon: DollarSign, keys: ['value'] },
  { label: 'Location', icon: MapPin, keys: ['location'] },
  { label: 'Accuracy', icon: BadgeCheck, keys: ['accuracy'] },
]

function categoryRating(review: HostawayReview, keys: readonly string[]): number | null {
  const parsed = parseReviewCategories(review.reviewCategory)
  for (const { key, rating } of parsed) {
    if (keys.includes(key)) return rating
  }
  return null
}

function hasResponse(review: HostawayReview): boolean {
  return Boolean(review.revieweeResponse?.trim())
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReviewsPage() {
  usePageTitle('Reviews')

  const [search, setSearch] = useState('')
  const [windowValue, setWindowValue] = useState<WindowValue>('365d')
  const [ratingBand, setRatingBand] = useState<RatingBand>('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [responseFilter, setResponseFilter] = useState<ResponseState>('all')
  const [sort, setSort] = useState<SortValue>('newest_departure')
  const [selected, setSelected] = useState<HostawayReview | null>(null)

  const { data, isLoading, isError, error, refetch } = useQuery<ReviewsResponse>({
    queryKey: ['/api/reviews/list'],
    queryFn: () => authFetch<ReviewsResponse>('/api/reviews/list'),
  })

  const allReviews = data?.reviews ?? []

  // Status options derived from the loaded data (Hostaway statuses vary).
  const statusOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of allReviews) if (r.status) set.add(r.status)
    return Array.from(set).sort()
  }, [allReviews])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const win = WINDOW_OPTIONS.find((w) => w.value === windowValue)
    const start = win?.days ? isoDaysAgo(win.days) : undefined

    const rows = allReviews.filter((review) => {
      // Stay-window filter by departure date (Hostaway ignores the param
      // server-side, so enforce it here — ISO dates compare lexically).
      if (start) {
        const departed = review.departureDate?.slice(0, 10)
        if (!departed || departed < start) return false
      }

      if (needle) {
        const haystack = [
          review.listingName,
          review.listingMapId != null ? String(review.listingMapId) : null,
          review.guestName,
          review.publicReview,
          review.reservationId != null ? String(review.reservationId) : null,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(needle)) return false
      }

      if (statusFilter !== 'all' && review.status !== statusFilter) return false

      if (responseFilter === 'responded' && !hasResponse(review)) return false
      if (responseFilter === 'needs_response' && hasResponse(review)) return false

      const five = ratingFive(review.rating)
      switch (ratingBand) {
        case '5':
          if (!(five >= 5)) return false
          break
        case '4.5':
          if (!(five >= 4.5)) return false
          break
        case '4':
          if (!(five >= 4)) return false
          break
        case 'below4':
          if (!(five < 4)) return false
          break
        case 'unrated':
          if (typeof review.rating === 'number') return false
          break
      }
      return true
    })

    const cleanKeys = CATEGORY_DEFS[0].keys
    const num = (v: number | null, dir: 'asc' | 'desc') =>
      typeof v === 'number' ? v : dir === 'asc' ? Infinity : -Infinity
    const dateVal = (v: string | null) =>
      v ? Date.parse(`${v.slice(0, 10)}T00:00:00`) || 0 : 0

    return [...rows].sort((a, b) => {
      switch (sort) {
        case 'oldest_departure':
          return dateVal(a.departureDate) - dateVal(b.departureDate)
        case 'highest_rating':
          return num(b.rating, 'desc') - num(a.rating, 'desc')
        case 'lowest_rating':
          return num(a.rating, 'asc') - num(b.rating, 'asc')
        case 'lowest_cleanliness':
          return (
            num(categoryRating(a, cleanKeys), 'asc') -
            num(categoryRating(b, cleanKeys), 'asc')
          )
        case 'listing':
          return (a.listingName ?? '').localeCompare(b.listingName ?? '', 'en', {
            sensitivity: 'base',
          })
        case 'newest_departure':
        default:
          return dateVal(b.departureDate) - dateVal(a.departureDate)
      }
    })
  }, [allReviews, search, windowValue, ratingBand, statusFilter, responseFilter, sort])

  // Summary tiles computed over the filtered set.
  const summary = useMemo(() => {
    const rated = filtered.filter((r) => typeof r.rating === 'number')
    const avg =
      rated.length > 0
        ? rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length
        : null

    const cleanVals = filtered
      .map((r) => categoryRating(r, CATEGORY_DEFS[0].keys))
      .filter((v): v is number => typeof v === 'number')
    const cleanAvg =
      cleanVals.length > 0
        ? cleanVals.reduce((s, v) => s + v, 0) / cleanVals.length
        : null

    const listings = new Set(
      filtered.map((r) =>
        r.listingMapId ? `id:${r.listingMapId}` : `name:${r.listingName ?? '?'}`,
      ),
    )

    return {
      count: filtered.length,
      avg,
      cleanAvg,
      cleanCount: cleanVals.length,
      needsResponse: filtered.filter((r) => !hasResponse(r)).length,
      belowFour: filtered.filter((r) => ratingFive(r.rating) < 4).length,
      properties: listings.size,
    }
  }, [filtered])

  const categoryScores = useMemo(() => {
    return CATEGORY_DEFS.map((def) => {
      const vals = filtered
        .map((r) => categoryRating(r, def.keys))
        .filter((v): v is number => typeof v === 'number')
      return {
        label: def.label,
        icon: def.icon,
        average: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null,
        count: vals.length,
      }
    })
  }, [filtered])

  const showCategories = categoryScores.some((c) => c.count > 0)

  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      <PageHeader
        title="Reviews"
        subtitle="Live Hostaway guest feedback from Haven — cleanliness, ratings, and response status by property."
        actions={
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Property, guest, text…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-56 pl-8 text-sm"
                data-testid="input-reviews-search"
              />
            </div>
            <Select value={windowValue} onValueChange={(v) => setWindowValue(v as WindowValue)}>
              <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-reviews-window">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOW_OPTIONS.map((w) => (
                  <SelectItem key={w.value} value={w.value}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={ratingBand} onValueChange={(v) => setRatingBand(v as RatingBand)}>
              <SelectTrigger className="h-8 w-28 text-xs" data-testid="select-reviews-rating">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ratings</SelectItem>
                <SelectItem value="5">5.0 only</SelectItem>
                <SelectItem value="4.5">4.5+</SelectItem>
                <SelectItem value="4">4.0+</SelectItem>
                <SelectItem value="below4">Below 4.0</SelectItem>
                <SelectItem value="unrated">Unrated</SelectItem>
              </SelectContent>
            </Select>
            <Select value={responseFilter} onValueChange={(v) => setResponseFilter(v as ResponseState)}>
              <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-reviews-response">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All responses</SelectItem>
                <SelectItem value="responded">Responded</SelectItem>
                <SelectItem value="needs_response">Needs response</SelectItem>
              </SelectContent>
            </Select>
            {statusOptions.length > 0 && (
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-32 text-xs" data-testid="select-reviews-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {statusOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={sort} onValueChange={(v) => setSort(v as SortValue)}>
              <SelectTrigger className="h-8 w-44 text-xs" data-testid="select-reviews-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest_departure">Newest departure</SelectItem>
                <SelectItem value="oldest_departure">Oldest departure</SelectItem>
                <SelectItem value="lowest_rating">Lowest rating</SelectItem>
                <SelectItem value="highest_rating">Highest rating</SelectItem>
                <SelectItem value="lowest_cleanliness">Lowest cleanliness</SelectItem>
                <SelectItem value="listing">Property</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />

      {/* Summary strip — cleanliness leads for the cleaning-ops lens */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          title="Cleanliness"
          value={summary.cleanAvg != null ? `${formatFiveStar(summary.cleanAvg, 2)}` : '—'}
          subtitle={
            summary.cleanCount > 0
              ? `${formatTenPoint(summary.cleanAvg, 1)}/10 · ${summary.cleanCount} rated`
              : 'No category data'
          }
          icon={Sparkles}
          tone="success"
          loading={isLoading}
        />
        <StatCard
          title="Avg rating"
          value={summary.avg != null ? `${formatFiveStar(summary.avg, 2)}` : '—'}
          subtitle={summary.avg != null ? `${formatTenPoint(summary.avg, 1)}/10 raw` : undefined}
          icon={Star}
          tone="primary"
          loading={isLoading}
        />
        <StatCard
          title="Reviews"
          value={String(summary.count)}
          icon={MessageSquareText}
          tone="info"
          loading={isLoading}
        />
        <StatCard
          title="Needs response"
          value={String(summary.needsResponse)}
          icon={AlertCircle}
          tone="warning"
          loading={isLoading}
        />
        <StatCard
          title="Below 4.0"
          value={String(summary.belowFour)}
          icon={AlertCircle}
          tone="destructive"
          loading={isLoading}
        />
        <StatCard
          title="Properties"
          value={String(summary.properties)}
          icon={Building2}
          tone="neutral"
          loading={isLoading}
        />
      </div>

      {/* Category sub-scores */}
      {showCategories && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {categoryScores.map((c) => (
            <div
              key={c.label}
              className="rounded-2xl border border-border bg-card p-3 shadow-sm"
            >
              <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                <c.icon className="h-3.5 w-3.5" />
                {c.label}
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {c.average != null ? formatFiveStar(c.average, 2) : '—'}
              </div>
              <div className="text-2xs text-muted-foreground">
                {c.count > 0 ? `${formatTenPoint(c.average, 1)}/10 · ${c.count}` : 'No data'}
              </div>
            </div>
          ))}
        </div>
      )}

      {isError ? (
        <ErrorState
          title="Couldn't load reviews"
          description={error instanceof Error ? error.message : 'Something went wrong fetching reviews.'}
          onRetry={() => refetch()}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden flex-1 overflow-auto rounded-2xl border border-border shadow-sm md:block">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="sticky top-0 z-10 border-b border-border bg-muted/80 backdrop-blur">
                <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Departure</th>
                  <th className="px-3 py-2 font-medium">Property</th>
                  <th className="px-3 py-2 font-medium">Guest</th>
                  <th className="px-3 py-2 font-medium">Rating</th>
                  <th className="px-3 py-2 font-medium">Cleanliness</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Feedback</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(8)].map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {[...Array(7)].map((__, j) => (
                        <td key={j} className="px-3 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12">
                      <EmptyState
                        icon={MessageSquareText}
                        title="No matching reviews"
                        description="Try widening the date window or clearing filters."
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((review) => {
                    const clean = categoryRating(review, CATEGORY_DEFS[0].keys)
                    return (
                      <tr
                        key={review.id}
                        onClick={() => setSelected(review)}
                        className="cursor-pointer border-b border-border/50 align-top transition-colors hover:bg-muted/30"
                        data-testid={`row-review-${review.id}`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-2xs text-muted-foreground">
                          <div className="font-semibold text-foreground">
                            {formatDate(review.departureDate)}
                          </div>
                          <div>Arr {formatDate(review.arrivalDate)}</div>
                        </td>
                        <td className="max-w-[200px] px-3 py-3 font-medium">
                          <div className="line-clamp-2">
                            {review.listingName ||
                              `Listing ${review.listingMapId ?? 'unknown'}`}
                          </div>
                        </td>
                        <td className="px-3 py-3">{review.guestName || 'Unknown'}</td>
                        <td className="px-3 py-3">
                          <RatingCell rating={review.rating} />
                        </td>
                        <td className="px-3 py-3">
                          {clean != null ? (
                            <span className="inline-flex items-center gap-1 font-medium tabular-nums">
                              <Sparkles className="h-3.5 w-3.5 text-success" />
                              {formatFiveStar(clean)}
                            </span>
                          ) : (
                            <span className="text-2xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {review.status ? (
                            <StatusBadge status={review.status} variant="soft">
                              {review.status}
                            </StatusBadge>
                          ) : null}
                        </td>
                        <td className="max-w-[320px] px-4 py-3">
                          {review.publicReview ? (
                            <p className="line-clamp-2 text-sm text-foreground">
                              {review.publicReview}
                            </p>
                          ) : (
                            <span className="text-2xs text-muted-foreground">No public review</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {isLoading ? (
              [...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={MessageSquareText}
                title="No matching reviews"
                description="Try widening the date window or clearing filters."
              />
            ) : (
              filtered.map((review) => {
                const clean = categoryRating(review, CATEGORY_DEFS[0].keys)
                return (
                  <button
                    key={review.id}
                    onClick={() => setSelected(review)}
                    className="w-full rounded-2xl border border-border bg-card p-3 text-left shadow-sm"
                    data-testid={`card-review-${review.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium">
                        {review.listingName || `Listing ${review.listingMapId ?? '?'}`}
                      </div>
                      <RatingCell rating={review.rating} />
                    </div>
                    <div className="mt-1 text-2xs text-muted-foreground">
                      {review.guestName || 'Unknown'} · {formatDate(review.departureDate)}
                    </div>
                    {review.publicReview && (
                      <p className="mt-2 line-clamp-2 text-sm">{review.publicReview}</p>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      {review.status ? (
                        <StatusBadge status={review.status} variant="soft">
                          {review.status}
                        </StatusBadge>
                      ) : (
                        <span />
                      )}
                      {clean != null && (
                        <span className="inline-flex items-center gap-1 text-2xs font-medium text-success">
                          <Sparkles className="h-3 w-3" />
                          Clean {formatFiveStar(clean)}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </>
      )}

      <ReviewDrawer review={selected} onClose={() => setSelected(null)} />
    </PageContainer>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RatingCell({ rating }: { rating: number | null }) {
  return (
    <div className="flex flex-col gap-0.5 tabular-nums">
      <span className="inline-flex items-center gap-1 font-semibold">
        <Star className="h-3.5 w-3.5 fill-current text-amber-500" />
        {formatFiveStar(rating)}
      </span>
      <span className="text-2xs text-muted-foreground">{formatTenPoint(rating)}/10</span>
    </div>
  )
}

function ReviewDrawer({
  review,
  onClose,
}: {
  review: HostawayReview | null
  onClose: () => void
}) {
  return (
    <Sheet open={!!review} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {review && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-6">
                {review.listingName || `Listing ${review.listingMapId ?? 'unknown'}`}
              </SheetTitle>
            </SheetHeader>

            <div className="mt-4 space-y-5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {review.status && (
                  <StatusBadge status={review.status} variant="soft">
                    {review.status}
                  </StatusBadge>
                )}
                <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
                  <Star className="h-4 w-4 fill-current text-amber-500" />
                  {formatFiveStar(review.rating)}{' '}
                  <span className="text-2xs font-normal text-muted-foreground">
                    ({formatTenPoint(review.rating)}/10)
                  </span>
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/30 p-3 text-2xs">
                <Meta label="Guest" value={review.guestName || 'Unknown'} />
                <Meta label="Reservation" value={review.reservationId ? String(review.reservationId) : '—'} />
                <Meta label="Arrival" value={formatDate(review.arrivalDate)} />
                <Meta label="Departure" value={formatDate(review.departureDate)} />
                <Meta label="Received" value={formatDate(review.insertedOn)} />
                <Meta label="Listing ID" value={review.listingMapId ? String(review.listingMapId) : '—'} />
              </dl>

              {/* Category breakdown */}
              {(() => {
                const cats = CATEGORY_DEFS.map((def) => ({
                  label: def.label,
                  icon: def.icon,
                  value: categoryRating(review, def.keys),
                })).filter((c) => c.value != null)
                if (cats.length === 0) return null
                return (
                  <div>
                    <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Category scores
                    </h3>
                    <div className="space-y-2">
                      {cats.map((c) => (
                        <div key={c.label} className="flex items-center gap-2">
                          <c.icon
                            className={cn(
                              'h-3.5 w-3.5',
                              c.label === 'Cleanliness' ? 'text-success' : 'text-muted-foreground',
                            )}
                          />
                          <span className="w-28 text-xs">{c.label}</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                c.label === 'Cleanliness' ? 'bg-success' : 'bg-primary',
                              )}
                              style={{ width: `${((c.value as number) / 10) * 100}%` }}
                            />
                          </div>
                          <span className="w-16 text-right text-2xs tabular-nums text-muted-foreground">
                            {formatFiveStar(c.value)} · {formatTenPoint(c.value)}/10
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {review.publicReview && (
                <Section title="Public review">{review.publicReview}</Section>
              )}
              {review.privateFeedback && (
                <Section title="Private feedback">{review.privateFeedback}</Section>
              )}
              <Section title="Host response">
                {review.revieweeResponse ? (
                  review.revieweeResponse
                ) : (
                  <span className="text-muted-foreground">
                    No response yet — this review needs a reply on Hostaway.
                  </span>
                )}
              </Section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-xs text-foreground">{value}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{children}</p>
    </div>
  )
}
