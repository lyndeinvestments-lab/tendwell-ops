import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { OnboardingReviewDialog } from '@/components/OnboardingReviewDialog'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Check, X, RefreshCw, ChevronDown, ChevronRight, ExternalLink, Image as ImageIcon, Link2, Search, Clock, Inbox, CheckCircle2, XCircle } from 'lucide-react'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { ErrorState } from '@/components/ErrorState'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { slugify } from '@/lib/issues'

interface OnboardingSubmission {
  id: string
  source: 'token' | 'public'
  status: 'pending' | 'approved' | 'rejected' | 'converted'
  token: string | null
  client_name: string | null
  contact_email: string | null
  contact_phone: string | null
  invoice_email: string | null
  property_name: string | null
  address: string | null
  bedrooms: number | null
  number_of_beds: number | null
  full_baths: number | null
  half_baths: number | null
  square_footage: number | null
  bed_sizes: string | null
  hot_tub: boolean | null
  pool: boolean | null
  linen_program: boolean | null
  onboarding_deep_clean: boolean | null
  door_code: string | null
  auto_code: string | null
  other_codes: string | null
  wifi_info: string | null
  filter_size: string | null
  ical_url: string | null
  api_client_id: string | null
  api_key: string | null
  check_in_time: string | null
  check_out_time: string | null
  notes: string | null
  photos: string[]
  submitted_at: string
  approved_at: string | null
  approved_by: string | null
  property_id: number | null
}

type Tab = 'pending' | 'converted' | 'rejected' | 'all'

function fmtBool(v: boolean | null, t: (key: string) => string) {
  if (v === null) return '—'
  return v ? t('common.actions.yes') : t('common.actions.no')
}

function fmtDate(iso: string | null, locale: string) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString(locale === 'es' ? 'es' : 'en-US') } catch { return iso }
}

export default function OnboardingQueuePage() {
  usePageTitle('Onboarding Queue')
  const { t, locale } = useLocale('onboarding')
  const { effectiveUser, user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()

  const [tab, setTab] = useState<Tab>('pending')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [mergeFor, setMergeFor] = useState<OnboardingSubmission | null>(null)
  const [createFor, setCreateFor] = useState<OnboardingSubmission | null>(null)
  const [mergeReview, setMergeReview] = useState<{ sub: OnboardingSubmission; propertyId: number } | null>(null)

  const { data: rows, isLoading, isError, isRefetching, refetch } = useQuery<OnboardingSubmission[]>({
    queryKey: ['/onboarding_submissions', tab],
    queryFn: async () => {
      let q = supabase.from('onboarding_submissions').select('*').order('submitted_at', { ascending: false }).limit(500)
      if (tab !== 'all') q = q.eq('status', tab)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as OnboardingSubmission[]
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const counts = useMemo(() => {
    const c = { pending: 0, converted: 0, rejected: 0, total: 0 }
    for (const r of rows ?? []) {
      if (r.status === 'pending') c.pending++
      else if (r.status === 'converted') c.converted++
      else if (r.status === 'rejected') c.rejected++
      c.total++
    }
    return c
  }, [rows])

  const { mutate: reject } = useMutation({
    mutationFn: async (sub: OnboardingSubmission) => {
      setWorking(sub.id)
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
      toast({ title: t('toasts.submissionRejected') })
      qc.invalidateQueries({ queryKey: ['/onboarding_submissions'] })
      setWorking(null)
    },
    onError: (e: any) => {
      toast({ title: t('toasts.rejectFailed'), description: e?.message, variant: 'destructive' })
      setWorking(null)
    },
  })

  function photoUrl(path: string) {
    const { data } = supabase.storage.from('onboarding-uploads').getPublicUrl(path)
    return data.publicUrl
  }

  if (!effectiveUser) return null

  return (
    <PageContainer width="lg">
      <PageHeader
        title={t('queue.header.title')}
        subtitle={<>{t('queue.header.subtitleBefore')} <code className="px-1 py-0.5 rounded bg-muted text-2xs">/onboarding</code>{t('queue.header.subtitleAfter')}</>}
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching} data-testid="button-refresh">
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRefetching ? 'animate-spin' : ''}`} /> {t('common.actions.refresh')}
          </Button>
        }
      />

      {rows && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-sm">
            <div className="flex items-center gap-1.5 mb-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{t('queue.kpi.pendingInView')}</p>
            </div>
            <p className="text-3xl font-bold tabular-nums leading-none">{counts.pending}</p>
          </div>
          <div className="rounded-2xl border border-card-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-1.5 mb-2">
              <Inbox className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{t('queue.kpi.totalInView')}</p>
            </div>
            <p className="text-3xl font-bold tabular-nums leading-none">{counts.total}</p>
          </div>
          <div className="rounded-2xl border border-card-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-1.5 mb-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{t('queue.kpi.convertedInView')}</p>
            </div>
            <p className="text-3xl font-bold tabular-nums leading-none">{counts.converted}</p>
          </div>
          <div className="rounded-2xl border border-card-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-1.5 mb-2">
              <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{t('queue.kpi.rejectedInView')}</p>
            </div>
            <p className="text-3xl font-bold tabular-nums leading-none">{counts.rejected}</p>
          </div>
        </div>
      )}

      <div className="flex gap-2 flex-wrap text-sm">
        {([
          { key: 'pending', label: t('queue.tabs.pending', { count: counts.pending }) },
          { key: 'converted', label: t('queue.tabs.converted', { count: counts.converted }) },
          { key: 'rejected', label: t('queue.tabs.rejected', { count: counts.rejected }) },
          { key: 'all', label: t('queue.tabs.all') },
        ] as { key: Tab; label: string }[]).map(opt => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setTab(opt.key)}
            data-testid={`tab-${opt.key}`}
            className={`px-3 h-8 rounded-md border transition-colors ${tab === opt.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted/50'}`}
          >{opt.label}</button>
        ))}
      </div>

      {isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : (rows?.length ?? 0) === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">{t('queue.empty')}</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {rows!.map(r => {
            const expanded = expandedId === r.id
            const isWorking = working === r.id
            const isPublic = r.source === 'public'
            return (
              <Card key={r.id} data-testid={`row-submission-${r.id}`}>
                <CardHeader className="cursor-pointer p-3" onClick={() => setExpandedId(expanded ? null : r.id)}>
                  <div className="flex items-center gap-3 flex-wrap">
                    {expanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm font-medium truncate">
                        {r.property_name || r.address || t('queue.row.noName')} <span className="text-muted-foreground font-normal">- {r.client_name || t('queue.row.unknownClient')}</span>
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(r.submitted_at, locale)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant={isPublic ? 'secondary' : 'outline'}>{isPublic ? t('queue.row.sourcePublic') : t('queue.row.sourceToken')}</Badge>
                      <Badge variant={r.status === 'pending' ? 'default' : r.status === 'converted' ? 'secondary' : 'outline'}>{t(`queue.status.${slugify(r.status)}`, undefined, r.status)}</Badge>
                      {r.photos.length > 0 && <Badge variant="outline"><ImageIcon className="w-3 h-3 mr-1" />{r.photos.length}</Badge>}
                      {r.api_key && <Badge variant="outline">{t('queue.row.apiKeyBadge')}</Badge>}
                      {r.ical_url && <Badge variant="outline">{t('queue.row.icalBadge')}</Badge>}
                    </div>
                  </div>
                </CardHeader>
                {expanded && (
                  <CardContent className="p-4 pt-0 space-y-3 text-sm border-t border-border">
                    <Section title={t('queue.sections.contact')}>
                      <KV k={t('queue.kv.name')} v={r.client_name} />
                      <KV k={t('queue.kv.email')} v={r.contact_email} />
                      <KV k={t('queue.kv.phone')} v={r.contact_phone} />
                      <KV k={t('queue.kv.invoiceEmail')} v={r.invoice_email && r.invoice_email !== r.contact_email ? r.invoice_email : (r.invoice_email ? t('queue.kv.sameAsPrimary', { email: r.invoice_email }) : '—')} wide />
                    </Section>
                    <Section title={t('queue.sections.property')}>
                      <KV k={t('queue.kv.address')} v={r.address} />
                      <KV k={t('queue.kv.bedrooms')} v={r.bedrooms} />
                      <KV k={t('queue.kv.beds')} v={r.number_of_beds} />
                      <KV k={t('queue.kv.fullHalfBaths')} v={`${r.full_baths ?? '—'} / ${r.half_baths ?? '—'}`} />
                      <KV k={t('queue.kv.sqFt')} v={r.square_footage} />
                      <KV k={t('queue.kv.bedSizes')} v={r.bed_sizes} wide />
                      <KV k={t('queue.kv.hotTub')} v={fmtBool(r.hot_tub, t)} />
                      <KV k={t('queue.kv.pool')} v={fmtBool(r.pool, t)} />
                      <KV k={t('queue.kv.linenProgram')} v={fmtBool(r.linen_program, t)} />
                      <KV k={t('queue.kv.onboardingDeepClean')} v={fmtBool(r.onboarding_deep_clean, t)} />
                    </Section>
                    <Section title={t('queue.sections.accessWifi')}>
                      <KV k={t('queue.kv.doorCode')} v={r.door_code} />
                      <KV k={t('queue.kv.autoCode')} v={r.auto_code} />
                      <KV k={t('queue.kv.otherCodes')} v={r.other_codes} wide />
                      <KV k={t('queue.kv.wifi')} v={r.wifi_info} wide />
                      <KV k={t('queue.kv.acFilter')} v={r.filter_size} />
                      <KV k={t('queue.kv.checkIn')} v={r.check_in_time} />
                      <KV k={t('queue.kv.checkOut')} v={r.check_out_time} />
                    </Section>
                    {(r.ical_url || r.api_key || r.api_client_id) && (
                      <Section title={t('queue.sections.bookingIntegration')}>
                        {r.ical_url && <KV k={t('queue.kv.icalUrl')} v={r.ical_url} wide />}
                        {r.api_client_id && <KV k={t('queue.kv.clientId')} v={r.api_client_id} wide secret />}
                        {r.api_key && <KV k={t('queue.kv.apiSecret')} v={r.api_key} wide secret />}
                      </Section>
                    )}
                    {r.notes && (
                      <Section title={t('queue.sections.notes')}>
                        <div className="col-span-full whitespace-pre-wrap text-sm bg-muted/30 rounded p-2">{r.notes}</div>
                      </Section>
                    )}
                    {r.photos.length > 0 && (
                      <Section title={t('queue.sections.photos', { count: r.photos.length })}>
                        <div className="col-span-full grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {r.photos.map(p => {
                            const url = photoUrl(p)
                            const isPdf = p.toLowerCase().endsWith('.pdf')
                            return (
                              <a key={p} href={url} target="_blank" rel="noreferrer" className="block aspect-square rounded-md border border-border overflow-hidden bg-muted/30 hover:opacity-80 transition-opacity">
                                {isPdf ? (
                                  <div className="w-full h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-1 p-2">
                                    <ExternalLink className="w-4 h-4" />
                                    <span className="truncate w-full text-center">PDF</span>
                                  </div>
                                ) : (
                                  <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                                )}
                              </a>
                            )
                          })}
                        </div>
                      </Section>
                    )}
                    {r.property_id && (
                      <p className="text-xs text-muted-foreground">{t('queue.row.linkedToProperty', { id: r.property_id, date: fmtDate(r.approved_at, locale), name: r.approved_by || '—' })}</p>
                    )}

                    {r.status === 'pending' && (
                      <div className="flex gap-2 pt-2 flex-wrap">
                        <Button size="sm" onClick={() => setCreateFor(r)} disabled={isWorking} data-testid={`button-approve-${r.id}`}>
                          <Check className="w-3.5 h-3.5 mr-1.5" /> {t('queue.actions.reviewCreate')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setMergeFor(r)} disabled={isWorking} data-testid={`button-merge-${r.id}`}>
                          <Link2 className="w-3.5 h-3.5 mr-1.5" /> {t('queue.actions.mergeExisting')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => reject(r)} disabled={isWorking} data-testid={`button-reject-${r.id}`}>
                          <X className="w-3.5 h-3.5 mr-1.5" /> {t('queue.actions.reject')}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <MergePropertyDialog
        submission={mergeFor}
        working={false}
        onClose={() => setMergeFor(null)}
        onPick={(propertyId) => { if (mergeFor) { setMergeReview({ sub: mergeFor, propertyId }); setMergeFor(null) } }}
      />

      <OnboardingReviewDialog
        submission={createFor}
        propertyId={null}
        onClose={() => setCreateFor(null)}
        onDone={() => setCreateFor(null)}
      />
      <OnboardingReviewDialog
        submission={mergeReview?.sub ?? null}
        propertyId={mergeReview?.propertyId ?? null}
        onClose={() => setMergeReview(null)}
        onDone={() => setMergeReview(null)}
      />
    </PageContainer>
  )
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
  working,
  onClose,
  onPick,
}: {
  submission: OnboardingSubmission | null
  working: boolean
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
        .map(t => t.trim())
        .filter(t => t.length >= 2)
        .slice(0, 4)

      const ors: string[] = []
      for (const t of tokens) {
        const safe = t.replace(/[,()%]/g, ' ')
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
    <Dialog open={!!submission} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl">
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
                    disabled={working}
                    className="w-full text-left px-3 py-2 rounded-md border border-border hover:bg-muted/50 transition-colors text-sm disabled:opacity-50"
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
          <Button variant="outline" onClick={onClose} disabled={working}>{t('common.actions.cancel')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">{children}</div>
    </div>
  )
}

function KV({ k, v, wide, secret }: { k: string; v: any; wide?: boolean; secret?: boolean }) {
  const display = v == null || v === '' ? '—' : String(v)
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <p className="text-2xs text-muted-foreground">{k}</p>
      <p className={`text-sm break-words ${secret ? 'font-mono' : ''}`}>{display}</p>
    </div>
  )
}
