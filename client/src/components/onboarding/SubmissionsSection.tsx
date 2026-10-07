import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { SUBMISSIONS_KEY, useSubmissionCounts, useSubmissionLookups, type LinkedProperty } from '@/hooks/use-onboarding'
import { OnboardingReviewDialog } from '@/components/OnboardingReviewDialog'
import { Section, KV, ExtrasList, IcalLinks } from '@/components/onboarding/shared'
import { onboardingPhotoUrl } from '@/lib/onboarding-apply'
import { extractIcalUrls, isImagePath, sourceLabel, statusLabel, type OnboardingSubmission } from '@/lib/onboarding'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { StatCard } from '@/components/StatCard'
import { Check, X, ChevronDown, ChevronRight, ExternalLink, Image as ImageIcon, Link2, Search, RotateCcw, Clock, CheckCircle2, XCircle, Inbox } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { slugify } from '@/lib/issues'

export type SubmissionFilter = 'pending' | 'converted' | 'rejected' | 'all'

function fmtBool(v: boolean | null, yes: string, no: string) {
  if (v === null) return '—'
  return v ? yes : no
}

function fmtDate(iso: string | null, locale: string) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString(locale === 'es' ? 'es' : 'en-US') } catch { return iso }
}

const STATUS_TONE = { new: 'info', applied: 'success', rejected: 'neutral' } as const

export function SubmissionsSection({
  filter,
  onFilterChange,
}: {
  filter: SubmissionFilter
  onFilterChange: (f: SubmissionFilter) => void
}) {
  const { t: to, locale } = useLocale('onboarding')
  const { t: ta } = useLocale('onboardingAdmin')
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { openPropertyModal } = usePropertyModal()

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [mergeFor, setMergeFor] = useState<OnboardingSubmission | null>(null)
  const [review, setReview] = useState<{ sub: OnboardingSubmission; propertyId: number | null } | null>(null)
  const [rejectFor, setRejectFor] = useState<OnboardingSubmission | null>(null)

  const { data: counts } = useSubmissionCounts()

  const { data: rows, isLoading, isError, refetch } = useQuery<OnboardingSubmission[]>({
    queryKey: [SUBMISSIONS_KEY, 'list', filter],
    queryFn: async () => {
      let q = supabase.from('onboarding_submissions').select('*').order('submitted_at', { ascending: false }).limit(500)
      if (filter === 'converted') q = q.in('status', ['converted', 'approved'])
      else if (filter !== 'all') q = q.eq('status', filter)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as OnboardingSubmission[]
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const { properties, owners } = useSubmissionLookups(rows)

  const { mutate: reject, isPending: rejecting } = useGuardedMutation('onboarding-queue', {
    mutationFn: async (sub: OnboardingSubmission) => {
      const { error } = await supabase
        .from('onboarding_submissions')
        .update({
          status: 'rejected',
          approved_at: new Date().toISOString(),
          approved_by: user?.label || (user as any)?.google_email || 'admin',
        })
        .eq('id', sub.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: to('toasts.submissionRejected') })
      qc.invalidateQueries({ queryKey: [SUBMISSIONS_KEY] })
      setRejectFor(null)
    },
    onError: (e: any) => {
      if (e?.message !== 'edit_blocked') toast({ title: to('toasts.rejectFailed'), description: e?.message, variant: 'destructive' })
      setRejectFor(null)
    },
  })

  const chips: { key: SubmissionFilter; label: string }[] = [
    { key: 'pending', label: ta('submissions.filters.new', { count: counts?.pending ?? 0 }) },
    { key: 'converted', label: ta('submissions.filters.applied', { count: counts?.applied ?? 0 }) },
    { key: 'rejected', label: ta('submissions.filters.rejected', { count: counts?.rejected ?? 0 }) },
    { key: 'all', label: ta('submissions.filters.all', { count: counts?.total ?? 0 }) },
  ]

  return (
    <>
      {/* Tiles count every submission, whichever filter is selected below. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title={ta('submissions.kpi.new')} value={counts?.pending ?? 0} icon={Clock} tone={(counts?.pending ?? 0) > 0 ? 'info' : 'primary'} loading={!counts} />
        <StatCard title={ta('submissions.kpi.applied')} value={counts?.applied ?? 0} icon={CheckCircle2} tone="success" loading={!counts} />
        <StatCard title={ta('submissions.kpi.rejected')} value={counts?.rejected ?? 0} icon={XCircle} tone="neutral" loading={!counts} />
        <StatCard title={ta('submissions.kpi.all')} value={counts?.total ?? 0} icon={Inbox} loading={!counts} />
      </div>

      <div className="flex gap-2 flex-wrap text-sm" role="tablist" aria-label={ta('submissions.filters.label')}>
        {chips.map(opt => (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={filter === opt.key}
            onClick={() => onFilterChange(opt.key)}
            data-testid={`tab-${opt.key}`}
            className={`px-3 h-8 rounded-md border transition-colors ${filter === opt.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted/50'}`}
          >{opt.label}</button>
        ))}
      </div>

      {isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : (rows?.length ?? 0) === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">{ta(`submissions.empty.${filter}`)}</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {rows!.map(r => (
            <SubmissionRow
              key={r.id}
              r={r}
              expanded={expandedId === r.id}
              onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
              property={r.property_id ? properties?.get(r.property_id) : undefined}
              ownerName={r.owner_id ? (owners?.get(r.owner_id)?.name || owners?.get(r.owner_id)?.email || null) : null}
              locale={locale}
              onReview={(propertyId) => setReview({ sub: r, propertyId })}
              onMerge={() => setMergeFor(r)}
              onReject={() => setRejectFor(r)}
              onOpenProperty={(id) => openPropertyModal(String(id), 'onboarding-queue')}
            />
          ))}
        </div>
      )}

      <MergePropertyDialog
        submission={mergeFor}
        onClose={() => setMergeFor(null)}
        onPick={(propertyId) => { if (mergeFor) { setReview({ sub: mergeFor, propertyId }); setMergeFor(null) } }}
      />

      <OnboardingReviewDialog
        submission={review?.sub ?? null}
        propertyId={review?.propertyId ?? null}
        onClose={() => setReview(null)}
        onDone={() => setReview(null)}
      />

      <AlertDialog open={!!rejectFor} onOpenChange={(open) => { if (!open && !rejecting) setRejectFor(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ta('submissions.reject.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {ta('submissions.reject.description', { name: rejectFor?.client_name || to('queue.row.unknownClient') })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rejecting}>{ta('common.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={rejecting}
              onClick={(e) => { e.preventDefault(); if (rejectFor) reject(rejectFor) }}
              data-testid="button-confirm-reject"
            >
              {ta('submissions.reject.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function SubmissionRow({
  r, expanded, onToggle, property, ownerName, locale, onReview, onMerge, onReject, onOpenProperty,
}: {
  r: OnboardingSubmission
  expanded: boolean
  onToggle: () => void
  property: LinkedProperty | undefined
  ownerName: string | null
  locale: string
  onReview: (propertyId: number | null) => void
  onMerge: () => void
  onReject: () => void
  onOpenProperty: (id: number) => void
}) {
  const { t: to } = useLocale('onboarding')
  const { t: ta } = useLocale('onboardingAdmin')
  const status = statusLabel(r.status)
  const noteIcalUrls = useMemo(() => extractIcalUrls(r.notes), [r.notes])
  const yes = ta('common.actions.yes')
  const no = ta('common.actions.no')
  const photoCount = (r.photos ?? []).length

  return (
    <Card data-testid={`row-submission-${r.id}`}>
      <CardHeader className="cursor-pointer p-3" onClick={onToggle}>
        <div className="flex items-center gap-3 flex-wrap">
          {expanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm font-medium truncate">
              {r.property_name || r.address || to('queue.row.noName')} <span className="text-muted-foreground font-normal">- {r.client_name || to('queue.row.unknownClient')}</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {fmtDate(r.submitted_at, locale)}
              {property && r.status === 'pending' && (
                <> · {ta('submissions.row.forProperty', { name: property.name })}</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant={r.source === 'owner' ? 'secondary' : 'outline'}>{ta(`submissions.source.${sourceLabel(r.source)}`)}</Badge>
            <StatusBadge tone={STATUS_TONE[status]}>{ta(`submissions.status.${status}`)}</StatusBadge>
            {photoCount > 0 && <Badge variant="outline"><ImageIcon className="w-3 h-3 mr-1" />{photoCount}</Badge>}
            {r.api_key && <Badge variant="outline">{to('queue.row.apiKeyBadge')}</Badge>}
            {r.ical_url && <Badge variant="outline">{to('queue.row.icalBadge')}</Badge>}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-4 pt-0 space-y-3 text-sm border-t border-border">
          <Section title={to('queue.sections.contact')}>
            <KV k={to('queue.kv.name')} v={r.client_name} />
            <KV k={to('queue.kv.email')} v={r.contact_email} />
            <KV k={to('queue.kv.phone')} v={r.contact_phone} />
            {r.owner_id && <KV k={ta('submissions.row.ownerLogin')} v={ownerName ?? '—'} />}
          </Section>
          <Section title={to('queue.sections.property')}>
            <KV k={to('queue.kv.address')} v={r.address} wide />
            <KV k={to('queue.kv.bedrooms')} v={r.bedrooms} />
            <KV k={to('queue.kv.beds')} v={r.number_of_beds} />
            <KV k={to('queue.kv.fullHalfBaths')} v={`${r.full_baths ?? '—'} / ${r.half_baths ?? '—'}`} />
            <KV k={to('queue.kv.sqFt')} v={r.square_footage} />
            <KV k={to('queue.kv.bedSizes')} v={r.bed_sizes} wide />
            <KV k={to('queue.kv.hotTub')} v={fmtBool(r.hot_tub, yes, no)} />
            <KV k={to('queue.kv.pool')} v={fmtBool(r.pool, yes, no)} />
            <KV k={to('queue.kv.linenProgram')} v={fmtBool(r.linen_program, yes, no)} />
            {r.guest_count != null && <KV k={ta('fields.guestCount')} v={r.guest_count} />}
            {r.kitchens != null && <KV k={ta('fields.kitchens')} v={r.kitchens} />}
            {r.pet_friendly && <KV k={ta('fields.petFriendly')} v={r.pet_friendly} />}
          </Section>
          <Section title={to('queue.sections.accessWifi')}>
            <KV k={to('queue.kv.doorCode')} v={r.door_code} />
            <KV k={to('queue.kv.autoCode')} v={r.auto_code} />
            <KV k={to('queue.kv.otherCodes')} v={r.other_codes} wide />
            <KV k={to('queue.kv.wifi')} v={r.wifi_info} wide />
            <KV k={to('queue.kv.acFilter')} v={r.filter_size} />
            <KV k={to('queue.kv.checkIn')} v={r.check_in_time} />
            <KV k={to('queue.kv.checkOut')} v={r.check_out_time} />
          </Section>
          <Section title={ta('submissions.sections.calendar')}>
            <div className="sm:col-span-2">
              <p className="text-2xs text-muted-foreground">{to('queue.kv.icalUrl')}</p>
              {r.ical_url ? (
                <a href={r.ical_url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline break-all">{r.ical_url}</a>
              ) : (
                <p className="text-sm">—</p>
              )}
            </div>
          </Section>
          {r.notes && (
            <Section title={to('queue.sections.notes')}>
              <div className="col-span-full whitespace-pre-wrap text-sm bg-muted/30 rounded p-2">{r.notes}</div>
              {noteIcalUrls.length > 0 && <div className="col-span-full"><IcalLinks urls={noteIcalUrls} /></div>}
            </Section>
          )}
          {photoCount > 0 && (
            <Section title={to('queue.sections.photos', { count: photoCount })}>
              <div className="col-span-full grid grid-cols-2 sm:grid-cols-3 gap-2">
                {r.photos.map(p => {
                  const url = onboardingPhotoUrl(p)
                  return (
                    <a key={p} href={url} target="_blank" rel="noreferrer" className="block aspect-square rounded-md border border-border overflow-hidden bg-muted/30 hover:opacity-80 transition-opacity">
                      {isImagePath(p) ? (
                        <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-1 p-2">
                          <ExternalLink className="w-4 h-4" />
                          <span className="truncate w-full text-center">PDF</span>
                        </div>
                      )}
                    </a>
                  )
                })}
              </div>
            </Section>
          )}
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{ta('extras.title')}</p>
            <ExtrasListOrNone r={r} noneLabel={ta('extras.none')} />
          </div>

          {r.status === 'pending' && (
            <div className="flex gap-2 pt-2 flex-wrap items-center">
              {property ? (
                <>
                  <Button size="sm" onClick={() => onReview(property.id)} data-testid={`button-apply-${r.id}`}>
                    <Check className="w-3.5 h-3.5 mr-1.5" /> {ta('submissions.actions.applyTo', { name: property.name })}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onReview(null)} data-testid={`button-approve-${r.id}`}>
                    {ta('submissions.actions.createInstead')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onMerge} data-testid={`button-merge-${r.id}`}>
                    <Link2 className="w-3.5 h-3.5 mr-1.5" /> {ta('submissions.actions.applyOther')}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" onClick={() => onReview(null)} data-testid={`button-approve-${r.id}`}>
                    <Check className="w-3.5 h-3.5 mr-1.5" /> {to('queue.actions.reviewCreate')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={onMerge} data-testid={`button-merge-${r.id}`}>
                    <Link2 className="w-3.5 h-3.5 mr-1.5" /> {ta('submissions.actions.applyExisting')}
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={onReject} data-testid={`button-reject-${r.id}`}>
                <X className="w-3.5 h-3.5 mr-1.5" /> {to('queue.actions.reject')}
              </Button>
            </div>
          )}

          {r.status === 'rejected' && (
            <p className="text-xs text-muted-foreground">{ta('submissions.row.rejectedOn', { date: fmtDate(r.approved_at, locale), name: r.approved_by || '—' })}</p>
          )}

          {r.property_id && r.status !== 'pending' && r.status !== 'rejected' && (
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <p className="text-xs text-muted-foreground">
                {ta('submissions.row.appliedTo')}{' '}
                <button
                  type="button"
                  className="text-primary hover:underline font-medium"
                  onClick={() => onOpenProperty(r.property_id!)}
                  data-testid={`link-property-${r.id}`}
                >
                  {property?.name ?? `#${r.property_id}`}
                </button>
                {' '}· {ta('submissions.row.appliedOn', { date: fmtDate(r.approved_at, locale), name: r.approved_by || '—' })}
              </p>
              {property && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onReview(property.id)} data-testid={`button-reapply-${r.id}`}>
                  <RotateCcw className="w-3 h-3 mr-1" /> {ta('submissions.actions.reapply')}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

/** The extras list, or a plain "nothing else" line so an empty section never looks like a missing one. */
function ExtrasListOrNone({ r, noneLabel }: { r: OnboardingSubmission; noneLabel: string }) {
  const hasAny =
    !!r.invoice_email?.trim() || r.onboarding_deep_clean != null || !!r.auto_code?.trim() ||
    !!r.api_client_id?.trim() || !!r.api_key?.trim() || (r.photos ?? []).some(p => !isImagePath(p))
  return hasAny ? <ExtrasList submission={r} /> : <p className="text-sm text-muted-foreground">{noneLabel}</p>
}

interface PropertyMatch {
  id: number
  name: string
  address: string | null
  stage_id: number | null
  pipeline_stages?: { name: string | null } | null
}

function MergePropertyDialog({
  submission,
  onClose,
  onPick,
}: {
  submission: OnboardingSubmission | null
  onClose: () => void
  onPick: (propertyId: number) => void
}) {
  const { t } = useLocale('onboarding')
  const [search, setSearch] = useState('')

  const initialQuery = useMemo(() => {
    if (!submission) return ''
    return submission.client_name || submission.address || submission.property_name || ''
  }, [submission])

  const effectiveQuery = search || initialQuery

  const { data: matches, isLoading } = useQuery<PropertyMatch[]>({
    queryKey: ['/onboarding_submissions/merge-candidates', submission?.id, effectiveQuery],
    enabled: !!submission,
    queryFn: async () => {
      const tokens = effectiveQuery
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(s => s.length >= 2)
        .slice(0, 4)

      const ors: string[] = []
      for (const tok of tokens) {
        const safe = tok.replace(/[,()%]/g, ' ')
        ors.push(`name.ilike.%${safe}%`)
        ors.push(`address.ilike.%${safe}%`)
      }
      let q = supabase
        .from('properties')
        .select('id,name,address,stage_id,pipeline_stages(name)')
        .order('id', { ascending: false })
        .limit(40)
      if (ors.length > 0) q = q.or(ors.join(','))
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as PropertyMatch[]
    },
    staleTime: 10_000,
  })

  return (
    <Dialog open={!!submission} onOpenChange={(open) => { if (!open) { onClose(); setSearch('') } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('queue.merge.title')}</DialogTitle>
          <DialogDescription>
            {t('queue.merge.description')}
          </DialogDescription>
        </DialogHeader>

        {submission && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-0.5">
            <p><span className="text-muted-foreground">{t('queue.merge.client')}</span> {submission.client_name || '—'}</p>
            <p><span className="text-muted-foreground">{t('queue.merge.address')}</span> {submission.address || '—'}</p>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={initialQuery ? t('queue.merge.searchingFor', { query: initialQuery }) : t('queue.merge.searchPlaceholder')}
            className="pl-8 h-9 text-sm"
            data-testid="input-merge-search"
          />
        </div>

        <div className="max-h-[360px] overflow-y-auto -mx-2">
          {isLoading ? (
            <div className="space-y-2 px-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
          ) : (matches?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t('queue.merge.noMatches')}</p>
          ) : (
            <ul className="space-y-1 px-2">
              {matches!.map(m => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onPick(m.id)}
                    className="w-full text-left px-3 py-2 rounded-md border border-border hover:bg-muted/50 transition-colors text-sm"
                    data-testid={`button-pick-property-${m.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{m.name}</span>
                      {m.pipeline_stages?.name && <Badge variant="outline" className="shrink-0">{t(`common.stage.${slugify(m.pipeline_stages.name)}`, undefined, m.pipeline_stages.name)}</Badge>}
                    </div>
                    {m.address && <p className="text-xs text-muted-foreground truncate mt-0.5">{m.address}</p>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.actions.cancel')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
