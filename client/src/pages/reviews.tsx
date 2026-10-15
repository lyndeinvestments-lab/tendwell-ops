import { useEffect, useMemo, useState } from 'react'
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
  Users,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react'
import { format as dfFormat } from 'date-fns'
import { es as dateFnsEs } from 'date-fns/locale'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { SearchSelect } from '@/components/issues/SearchSelect'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import type { TFunc } from '@/lib/i18n/t'
import {
  ATTRIBUTION_FILTERS,
  DEFAULT_REVIEW_FILTERS,
  REVIEW_SELECT,
  WINDOW_DAYS,
  attributionLabel,
  category5,
  filterReviews,
  isoDaysBefore,
  rating5,
  sortReviews,
  summarizeReviews,
  toReviewRow,
  type AttributionFilter,
  type RatingBand,
  type ReviewFilters,
  type ReviewRow,
  type ReviewSort,
  type WindowPreset,
} from '@/lib/reviews'

// ---------------------------------------------------------------------------
// Data: review_clean_attribution (gated in the DB on the `reviews` view grant).
// Paged past PostgREST's 1,000-row cap; only the date window goes to the
// server, every other filter runs client-side over the loaded window.
// ---------------------------------------------------------------------------

const PAGE = 1000
const RENDER_STEP = 100

async function fetchReviews(from: string, to: string): Promise<ReviewRow[]> {
  const out: ReviewRow[] = []
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    const { data, error } = await supabase
      .from('review_clean_attribution')
      .select(REVIEW_SELECT)
      .gte('review_date', from)
      .lt('review_date', nextDay(to))
      .order('review_date', { ascending: false })
      .order('trellis_review_id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as unknown as Record<string, unknown>[]
    for (const r of rows) out.push(toReviewRow(r))
    if (rows.length < PAGE) break
  }
  return out
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return isoDaysBefore(d, 0)
}

const CATEGORY_DEFS: ReadonlyArray<{ id: string; icon: LucideIcon }> = [
  { id: 'cleanliness', icon: Sparkles },
  { id: 'checkin', icon: KeyRound },
  { id: 'communication', icon: MessageSquare },
  { id: 'value', icon: DollarSign },
  { id: 'location', icon: MapPin },
  { id: 'accuracy', icon: BadgeCheck },
]

function fmt5(v: number | null, digits = 1): string {
  return v == null ? '-' : v.toFixed(digits)
}

function formatDate(value: string | null, locale: 'en' | 'es' = 'en'): string {
  if (!value) return '-'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return dfFormat(date, 'MMM d, yyyy', locale === 'es' ? { locale: dateFnsEs } : undefined)
}

function sourceLabel(t: TFunc, source: string | null): string {
  if (!source) return '-'
  return t(`sources.${source}`, undefined, source)
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReviewsPage() {
  usePageTitle('Reviews')
  const { t, locale } = useLocale('reviews')
  const { openPropertyModal } = usePropertyModal()

  const today = useMemo(() => new Date(), [])
  const [preset, setPreset] = useState<WindowPreset>('90d')
  const [customFrom, setCustomFrom] = useState(() => isoDaysBefore(today, 90))
  const [customTo, setCustomTo] = useState(() => isoDaysBefore(today, 0))
  const from = preset === 'custom' ? customFrom : isoDaysBefore(today, WINDOW_DAYS[preset])
  const to = preset === 'custom' ? customTo : isoDaysBefore(today, 0)

  const [filters, setFilters] = useState<ReviewFilters>(DEFAULT_REVIEW_FILTERS)
  const [sort, setSort] = useState<ReviewSort>('newest')
  const [visible, setVisible] = useState(RENDER_STEP)
  const [selected, setSelected] = useState<ReviewRow | null>(null)
  const patch = (p: Partial<ReviewFilters>) => setFilters((f) => ({ ...f, ...p }))

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['/supabase/review-clean-attribution', from, to],
    queryFn: () => fetchReviews(from, to),
    enabled: !!from && !!to && from <= to,
    staleTime: 5 * 60_000,
  })
  const all = data ?? []

  const propertyOptions = useMemo(() => {
    const m = new Map<number, string>()
    for (const r of all) if (r.property_id != null) m.set(r.property_id, r.property_name ?? `#${r.property_id}`)
    return Array.from(m, ([id, name]) => ({ value: String(id), label: name })).sort((a, b) =>
      a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }),
    )
  }, [all])

  const sourceOptions = useMemo(
    () => Array.from(new Set(all.map((r) => r.source).filter((s): s is string => !!s))).sort(),
    [all],
  )

  const filtered = useMemo(() => sortReviews(filterReviews(all, filters), sort), [all, filters, sort])
  const summary = useMemo(() => summarizeReviews(filtered), [filtered])

  useEffect(() => setVisible(RENDER_STEP), [filters, sort, from, to])

  const categoryScores = useMemo(
    () =>
      CATEGORY_DEFS.map((def) => {
        const vals = filtered.map((r) => category5(r, def.id)).filter((v): v is number => v != null)
        return { ...def, average: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null, count: vals.length }
      }),
    [filtered],
  )

  const filtersActive =
    filters.search !== '' ||
    filters.propertyId != null ||
    filters.source !== 'all' ||
    filters.rating !== 'all' ||
    filters.attribution !== DEFAULT_REVIEW_FILTERS.attribution ||
    filters.lowCleanlinessOnly

  const shown = filtered.slice(0, visible)
  const openProperty = (id: number | null) => {
    if (id != null) openPropertyModal(String(id))
  }

  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder={t('page.searchPlaceholder')}
              value={filters.search}
              onChange={(e) => patch({ search: e.target.value })}
              className="h-8 w-56 pl-8 text-sm"
              data-testid="input-reviews-search"
            />
          </div>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 text-xs shadow-sm">
        <Select value={preset} onValueChange={(v) => setPreset(v as WindowPreset)}>
          <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-reviews-window">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['30d', '90d', '180d', '365d', 'custom'] as const).map((p) => (
              <SelectItem key={p} value={p}>
                {t(`filters.window.${p === 'custom' ? 'custom' : `d${WINDOW_DAYS[p]}`}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {preset === 'custom' && (
          <>
            <Label className="sr-only" htmlFor="reviews-from">{t('filters.from')}</Label>
            <Input id="reviews-from" type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 w-36 text-xs" />
            <span className="text-muted-foreground">{t('filters.to')}</span>
            <Input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} className="h-8 w-36 text-xs" aria-label={t('filters.to')} />
          </>
        )}
        <div className="w-52">
          <SearchSelect
            value={filters.propertyId != null ? String(filters.propertyId) : ''}
            onSelect={(v) => patch({ propertyId: v ? Number(v) : null })}
            options={propertyOptions}
            placeholder={t('filters.property.placeholder')}
            searchPlaceholder={t('filters.property.search')}
            emptyText={t('filters.property.empty')}
          />
        </div>
        <Select value={filters.attribution} onValueChange={(v) => patch({ attribution: v as AttributionFilter })}>
          <SelectTrigger className="h-8 w-48 text-xs" data-testid="select-reviews-attribution">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ATTRIBUTION_FILTERS.map((a) => (
              <SelectItem key={a} value={a}>{t(`filters.attribution.${a}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.rating} onValueChange={(v) => patch({ rating: v as RatingBand })}>
          <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-reviews-rating">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['all', 'r5', 'r4plus', 'below4', 'below3'] as const).map((r) => (
              <SelectItem key={r} value={r}>{t(`filters.rating.${r}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.source} onValueChange={(v) => patch({ source: v })}>
          <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-reviews-source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filters.source.all')}</SelectItem>
            {sourceOptions.map((s) => (
              <SelectItem key={s} value={s}>{sourceLabel(t, s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as ReviewSort)}>
          <SelectTrigger className="h-8 w-40 text-xs" data-testid="select-reviews-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">{t('filters.sort.newest')}</SelectItem>
            <SelectItem value="oldest">{t('filters.sort.oldest')}</SelectItem>
            <SelectItem value="lowest_cleanliness">{t('filters.sort.lowestCleanliness')}</SelectItem>
            <SelectItem value="lowest_rating">{t('filters.sort.lowestRating')}</SelectItem>
            <SelectItem value="property">{t('filters.sort.property')}</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Switch
            id="reviews-low-clean"
            checked={filters.lowCleanlinessOnly}
            onCheckedChange={(v) => patch({ lowCleanlinessOnly: v })}
          />
          <Label htmlFor="reviews-low-clean" className="text-xs font-normal">{t('filters.lowCleanliness')}</Label>
        </div>
        {filtersActive && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setFilters(DEFAULT_REVIEW_FILTERS)}>
            {t('filters.clear')}
          </Button>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          title={t('tiles.reviews')}
          value={String(summary.count)}
          subtitle={t('tiles.reviewsSubtitle', { count: summary.properties })}
          icon={MessageSquareText}
          tone="info"
          loading={isLoading}
        />
        <StatCard
          title={t('tiles.avgRating')}
          value={summary.avgRating != null ? fmt5(summary.avgRating, 2) : '-'}
          subtitle={summary.ratedCount ? t('tiles.ratedSubtitle', { count: summary.ratedCount }) : t('tiles.noData')}
          icon={Star}
          tone="primary"
          loading={isLoading}
        />
        <StatCard
          title={t('tiles.cleanliness')}
          value={summary.avgCleanliness != null ? fmt5(summary.avgCleanliness, 2) : '-'}
          subtitle={summary.cleanlinessCount ? t('tiles.ratedSubtitle', { count: summary.cleanlinessCount }) : t('tiles.noData')}
          icon={Sparkles}
          tone="success"
          loading={isLoading}
        />
        <StatCard
          title={t('tiles.lowCleanliness')}
          value={summary.lowCleanlinessShare != null ? `${(summary.lowCleanlinessShare * 100).toFixed(1)}%` : '-'}
          subtitle={t('tiles.lowCleanlinessSubtitle', { count: summary.lowCleanlinessCount })}
          icon={AlertCircle}
          tone={summary.lowCleanlinessCount > 0 ? 'destructive' : 'neutral'}
          loading={isLoading}
          onClick={() => patch({ lowCleanlinessOnly: !filters.lowCleanlinessOnly })}
        />
        <StatCard
          title={t('tiles.tendwellCleaned')}
          value={String(summary.tendwellCount)}
          subtitle={t('tiles.tendwellSubtitle', { named: summary.namedCleanerCount })}
          icon={Users}
          tone="neutral"
          loading={isLoading}
          onClick={() => patch({ attribution: filters.attribution === 'tendwell' ? 'ops' : 'tendwell' })}
        />
      </div>

      {!isLoading && summary.tendwell.count > 0 && summary.notTendwell.count > 0 && (
        <p className="text-2xs text-muted-foreground" data-testid="reviews-compare">
          {t('compare.line', {
            tw: fmt5(summary.tendwell.avgCleanliness, 2),
            twCount: summary.tendwell.count,
            other: fmt5(summary.notTendwell.avgCleanliness, 2),
            otherCount: summary.notTendwell.count,
          })}
        </p>
      )}

      {categoryScores.some((c) => c.count > 0) && (
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          {categoryScores.map((c) => (
            <div key={c.id} className="rounded-2xl border border-border bg-card p-2.5 shadow-sm">
              <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                <c.icon className="h-3.5 w-3.5" />
                {t(`categories.${c.id}`)}
              </div>
              <div className="mt-0.5 text-base font-semibold tabular-nums">{fmt5(c.average, 2)}</div>
              <div className="text-2xs text-muted-foreground">{c.count ? t('tiles.ratedSubtitle', { count: c.count }) : t('tiles.noData')}</div>
            </div>
          ))}
        </div>
      )}

      <p className="text-2xs text-muted-foreground">{t('page.dataNote')}</p>

      {isError ? (
        <ErrorState
          title={t('page.errorTitle')}
          description={error instanceof Error ? error.message : t('page.errorDescriptionFallback')}
          onRetry={() => refetch()}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden flex-1 overflow-auto rounded-2xl border border-border shadow-sm md:block">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="sticky top-0 z-10 border-b border-border bg-muted/80 backdrop-blur">
                <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{t('table.reviewed')}</th>
                  <th className="px-3 py-2 font-medium">{t('table.property')}</th>
                  <th className="px-3 py-2 font-medium">{t('table.rating')}</th>
                  <th className="px-3 py-2 font-medium">{t('table.cleanliness')}</th>
                  <th className="px-3 py-2 font-medium">{t('table.preparedBy')}</th>
                  <th className="px-4 py-2 font-medium">{t('table.feedback')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(8)].map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {[...Array(6)].map((__, j) => (
                        <td key={j} className="px-3 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12">
                      <EmptyState icon={MessageSquareText} title={t('table.emptyTitle')} description={t('table.emptyDescription')} />
                    </td>
                  </tr>
                ) : (
                  shown.map((r) => (
                    <tr
                      key={r.trellis_review_id}
                      onClick={() => setSelected(r)}
                      className="cursor-pointer border-b border-border/50 align-top transition-colors hover:bg-muted/30"
                      data-testid={`row-review-${r.trellis_review_id}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-2xs text-muted-foreground">
                        <div className="font-semibold text-foreground">{formatDate(r.review_date, locale)}</div>
                        <div>{sourceLabel(t, r.source)}</div>
                      </td>
                      <td className="max-w-[220px] px-3 py-3">
                        <PropertyName row={r} onOpen={openProperty} />
                        <div className="text-2xs text-muted-foreground">
                          {r.guest_name || r.reviewer_name || t('table.unknownGuest')}
                          {r.checkin_date && ` · ${t('table.stay', { checkin: formatDate(r.checkin_date, locale), checkout: formatDate(r.checkout_date, locale) })}`}
                        </div>
                      </td>
                      <td className="px-3 py-3"><RatingCell value={rating5(r)} /></td>
                      <td className="px-3 py-3"><CleanCell value={r.cleanliness_5} /></td>
                      <td className="px-3 py-3"><AttributionBadge row={r} /></td>
                      <td className="max-w-[340px] px-4 py-3">
                        {r.content ? (
                          <p className="line-clamp-2 text-sm text-foreground">{r.content}</p>
                        ) : (
                          <span className="text-2xs text-muted-foreground">{t('table.noText')}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {isLoading ? (
              [...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
            ) : filtered.length === 0 ? (
              <EmptyState icon={MessageSquareText} title={t('table.emptyTitle')} description={t('table.emptyDescription')} />
            ) : (
              shown.map((r) => (
                <div
                  key={r.trellis_review_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(r)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setSelected(r) }}
                  className="w-full rounded-2xl border border-border bg-card p-3 text-left shadow-sm"
                  data-testid={`card-review-${r.trellis_review_id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <PropertyName row={r} onOpen={openProperty} />
                    <RatingCell value={rating5(r)} />
                  </div>
                  <div className="mt-1 text-2xs text-muted-foreground">
                    {r.guest_name || r.reviewer_name || t('table.unknownGuest')} · {formatDate(r.review_date, locale)} · {sourceLabel(t, r.source)}
                  </div>
                  {r.content && <p className="mt-2 line-clamp-3 text-sm">{r.content}</p>}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <AttributionBadge row={r} />
                    <CleanCell value={r.cleanliness_5} />
                  </div>
                </div>
              ))
            )}
          </div>

          {!isLoading && filtered.length > 0 && (
            <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
              <span>{t('table.showing', { shown: shown.length, total: filtered.length })}</span>
              {shown.length < filtered.length && (
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setVisible((v) => v + RENDER_STEP)}>
                  {t('table.showMore')}
                </Button>
              )}
            </div>
          )}
        </>
      )}

      <ReviewDrawer review={selected} onClose={() => setSelected(null)} onOpenProperty={openProperty} />
    </PageContainer>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PropertyName({ row, onOpen }: { row: ReviewRow; onOpen: (id: number | null) => void }) {
  const name = row.property_name ?? row.trellis_property_name ?? '-'
  if (row.property_id == null) return <div className="line-clamp-2 font-medium">{name}</div>
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(row.property_id) }}
      className="line-clamp-2 text-left font-medium text-primary hover:underline underline-offset-2"
    >
      {name}
    </button>
  )
}

function RatingCell({ value }: { value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
      <Star className="h-3.5 w-3.5 fill-current text-amber-500" />
      {fmt5(value)}
    </span>
  )
}

function CleanCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-2xs text-muted-foreground">-</span>
  return (
    <span className={cn('inline-flex items-center gap-1 font-medium tabular-nums', value < 4 ? 'text-destructive' : 'text-success')}>
      <Sparkles className="h-3.5 w-3.5" />
      {fmt5(value)}
    </span>
  )
}

function AttributionBadge({ row }: { row: ReviewRow }) {
  const { t, locale } = useLocale('reviews')
  const a = attributionLabel(row)
  return (
    <div className="space-y-0.5">
      <StatusBadge tone={a.tone} variant="soft">
        {a.key === 'cleaner' ? t('attribution.cleaner', { name: a.cleanerName ?? '' }) : t(`attribution.${a.key}`)}
      </StatusBadge>
      {a.cleanDate && (
        <div className="text-2xs text-muted-foreground">{t('attribution.cleanOn', { date: formatDate(a.cleanDate, locale) })}</div>
      )}
    </div>
  )
}

function ReviewDrawer({
  review,
  onClose,
  onOpenProperty,
}: {
  review: ReviewRow | null
  onClose: () => void
  onOpenProperty: (id: number | null) => void
}) {
  const { t, locale } = useLocale('reviews')
  return (
    <Sheet open={!!review} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {review && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-6">{review.property_name ?? review.trellis_property_name ?? '-'}</SheetTitle>
            </SheetHeader>

            <div className="mt-4 space-y-5 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <RatingCell value={rating5(review)} />
                <CleanCell value={review.cleanliness_5} />
                <StatusBadge tone="neutral" variant="soft">{sourceLabel(t, review.source)}</StatusBadge>
              </div>

              <div className="rounded-xl border border-border p-3">
                <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{t('detail.preparedBy')}</div>
                <AttributionBadge row={review} />
                {review.clean_title && (
                  <div className="mt-1 text-2xs text-muted-foreground">{review.clean_title}</div>
                )}
                <p className="mt-2 text-2xs text-muted-foreground">{t('detail.attributionHelp')}</p>
              </div>

              <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/30 p-3 text-2xs">
                <Meta label={t('detail.guest')} value={review.guest_name || review.reviewer_name || t('table.unknownGuest')} />
                <Meta label={t('detail.reservation')} value={review.reservation_id ?? '-'} />
                <Meta label={t('detail.checkin')} value={formatDate(review.checkin_date, locale)} />
                <Meta label={t('detail.checkout')} value={formatDate(review.checkout_date, locale)} />
                <Meta label={t('detail.reviewed')} value={formatDate(review.review_date, locale)} />
                <Meta
                  label={t('detail.hostResponse')}
                  value={review.host_response_status === 'responded' ? t('detail.responded') : t('detail.notResponded')}
                />
              </dl>

              {(() => {
                const cats = CATEGORY_DEFS.map((d) => ({ ...d, value: category5(review, d.id) })).filter((c) => c.value != null)
                if (!cats.length) return null
                return (
                  <div>
                    <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{t('detail.categoryScores')}</h3>
                    <div className="space-y-2">
                      {cats.map((c) => (
                        <div key={c.id} className="flex items-center gap-2">
                          <c.icon className={cn('h-3.5 w-3.5', c.id === 'cleanliness' ? 'text-success' : 'text-muted-foreground')} />
                          <span className="w-28 text-xs">{t(`categories.${c.id}`)}</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn('h-full rounded-full', c.id === 'cleanliness' ? 'bg-success' : 'bg-primary')}
                              style={{ width: `${((c.value as number) / 5) * 100}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-2xs tabular-nums text-muted-foreground">{fmt5(c.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {(review.title || review.content) && (
                <div>
                  <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{t('detail.review')}</h3>
                  {review.title && <p className="font-medium">{review.title}</p>}
                  {review.content && <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{review.content}</p>}
                </div>
              )}

              {review.property_id != null && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { onOpenProperty(review.property_id); onClose() }}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t('detail.openProperty')}
                </Button>
              )}
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
