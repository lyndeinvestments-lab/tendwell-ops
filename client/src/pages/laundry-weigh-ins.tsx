import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { thumbUrl } from '@/lib/image'
import { useAuth, canEditView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { Search, Scale, Download, Trash2, Sparkles, Shirt, Camera, ExternalLink, Copy, Check, Users } from 'lucide-react'
import { format, parseISO, subDays } from 'date-fns'
import Papa from 'papaparse'

type WeighIn = {
  id: string
  cleaner_name: string
  pounds: number
  laundry_type: 'clean' | 'dirty'
  photo_url: string | null
  photo_path: string | null
  special_linen_photo_path: string | null
  language: string | null
  submitted_at: string
  created_at: string
}

type TypeFilter = 'all' | 'clean' | 'dirty'
type RangeFilter = '7d' | '30d' | '90d' | 'all'

// Page the table so we never mount hundreds of rows (and their lazy <img>
// nodes) at once — large all-time ranges can return up to 1,000 submissions.
const PAGE_SIZE = 50

const RANGE_DAYS: Record<RangeFilter, number | null> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  'all': null,
}

export default function LaundryWeighInsPage() {
  usePageTitle('Laundry Weigh-Ins')
  const { effectiveUser } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const canEdit = canEditView('laundry-weigh-ins', effectiveUser)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('30d')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [page, setPage] = useState(1)

  const FORM_URL = 'https://app.tendwellcleaningco.com/#/weigh-in'

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(FORM_URL)
      setCopied(true)
      toast({ title: 'Link copied', description: FORM_URL })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: 'Copy failed', description: 'Select and copy manually.', variant: 'destructive' })
    }
  }

  const { data: rows, isLoading, isError, refetch } = useQuery({
    queryKey: ['laundry-weigh-ins', rangeFilter],
    queryFn: async (): Promise<WeighIn[]> => {
      let query = supabase
        .from('laundry_weigh_ins')
        .select('id, cleaner_name, pounds, laundry_type, photo_url, photo_path, special_linen_photo_path, language, submitted_at, created_at')
        .order('submitted_at', { ascending: false })
        .limit(1000)
      const days = RANGE_DAYS[rangeFilter]
      if (days != null) {
        query = query.gte('submitted_at', subDays(new Date(), days).toISOString())
      }
      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as WeighIn[]
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (row: WeighIn) => {
      // Remove both the main weigh-in photo and any special-linen photo,
      // otherwise the special-linen file is orphaned in the bucket.
      const paths = [row.photo_path, row.special_linen_photo_path].filter(Boolean) as string[]
      if (paths.length) {
        await supabase.storage.from('laundry-weigh-ins').remove(paths)
      }
      const { error } = await supabase.from('laundry_weigh_ins').delete().eq('id', row.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Weigh-in deleted' })
      queryClient.invalidateQueries({ queryKey: ['laundry-weigh-ins'] })
    },
    onError: (e: Error) => {
      toast({ title: 'Could not delete', description: e.message, variant: 'destructive' })
    },
  })

  const filtered = useMemo(() => {
    const all = rows ?? []
    const term = search.trim().toLowerCase()
    return all.filter(r => {
      if (typeFilter !== 'all' && r.laundry_type !== typeFilter) return false
      if (term && !r.cleaner_name.toLowerCase().includes(term)) return false
      return true
    })
  }, [rows, search, typeFilter])

  const stats = useMemo(() => {
    const total = filtered.length
    const cleanLbs = filtered.filter(r => r.laundry_type === 'clean').reduce((s, r) => s + Number(r.pounds), 0)
    const dirtyLbs = filtered.filter(r => r.laundry_type === 'dirty').reduce((s, r) => s + Number(r.pounds), 0)
    const cleaners = new Set(filtered.map(r => r.cleaner_name.trim().toLowerCase())).size
    return { total, cleanLbs, dirtyLbs, cleaners }
  }, [filtered])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  )
  const firstShown = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const lastShown = Math.min(safePage * PAGE_SIZE, filtered.length)

  function handleExport() {
    const csv = Papa.unparse(filtered.map(r => ({
      submitted_at: r.submitted_at,
      cleaner_name: r.cleaner_name,
      pounds: r.pounds,
      type: r.laundry_type,
      photo_url: r.photo_url ?? '',
      language: r.language ?? '',
    })))
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `laundry-weigh-ins-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: 'Exported', description: `${filtered.length} rows downloaded.` })
  }

  return (
    <PageContainer width="xl">
      <PageHeader
        title="Laundry Weigh-Ins"
        subtitle="Daily cleaner submissions from the public form"
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <a href={FORM_URL} target="_blank" rel="noreferrer">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open form
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={handleCopyLink}>
              {copied ? <Check className="w-4 h-4 mr-2 text-success" /> : <Copy className="w-4 h-4 mr-2" />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Submissions" value={stats.total.toLocaleString()} icon={Scale} loading={isLoading} />
        <StatCard title="Clean lbs" value={stats.cleanLbs.toFixed(1)} icon={Sparkles} tone="success" loading={isLoading} />
        <StatCard title="Dirty lbs" value={stats.dirtyLbs.toFixed(1)} icon={Shirt} tone="warning" loading={isLoading} />
        <StatCard title="Unique cleaners" value={stats.cleaners.toLocaleString()} icon={Users} loading={isLoading} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search cleaner name…"
            className="pl-9 h-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={v => { setTypeFilter(v as TypeFilter); setPage(1) }}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="clean">Clean</SelectItem>
            <SelectItem value="dirty">Dirty</SelectItem>
          </SelectContent>
        </Select>
        <Select value={rangeFilter} onValueChange={v => { setRangeFilter(v as RangeFilter); setPage(1) }}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState title="Could not load weigh-ins" onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No weigh-ins yet"
          description="Submissions from the public form will show up here."
        />
      ) : (
        <Card className="shadow-xs">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Submitted</th>
                    <th className="px-3 py-2 text-left font-medium">Cleaner</th>
                    <th className="px-3 py-2 text-left font-medium">Type</th>
                    <th className="px-3 py-2 text-right font-medium">Pounds</th>
                    <th className="px-3 py-2 text-left font-medium">Photo</th>
                    {canEdit && <th className="px-3 py-2 w-10" />}
                  </tr>
                </thead>
                <tbody>
                  {paged.map(row => (
                    <tr key={row.id} className="border-t border-border/60 hover:bg-muted/30">
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {format(parseISO(row.submitted_at), 'MMM d, yyyy h:mm a')}
                      </td>
                      <td className="px-3 py-2 font-medium">{row.cleaner_name}</td>
                      <td className="px-3 py-2">
                        <TypePill type={row.laundry_type} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(row.pounds).toFixed(1)} <span className="text-xs text-muted-foreground">lbs</span>
                      </td>
                      <td className="px-3 py-2">
                        {row.photo_url ? (
                          <button
                            type="button"
                            onClick={() => setLightboxUrl(row.photo_url)}
                            className="group relative w-12 h-12 rounded-md overflow-hidden border border-border hover:border-primary"
                            aria-label="View photo"
                          >
                            <img src={thumbUrl(row.photo_url, { width: 96 })} alt="Weigh-in" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                          </button>
                        ) : (
                          <span className="inline-flex items-center text-xs text-muted-foreground">
                            <Camera className="w-3.5 h-3.5 mr-1 opacity-50" />
                            None
                          </span>
                        )}
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              if (confirm(`Delete weigh-in from ${row.cleaner_name}?`)) deleteMut.mutate(row)
                            }}
                            disabled={deleteMut.isPending}
                            aria-label="Delete weigh-in"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-3 border-t border-border/60 px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  Showing {firstShown.toLocaleString()}–{lastShown.toLocaleString()} of {filtered.length.toLocaleString()}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Page {safePage} of {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                    disabled={safePage >= pageCount}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!lightboxUrl} onOpenChange={open => !open && setLightboxUrl(null)}>
        <DialogContent className="max-w-3xl p-2 sm:p-4">
          {lightboxUrl && (
            <div className="relative">
              <img src={lightboxUrl} alt="Weigh-in photo" loading="lazy" decoding="async" className="w-full h-auto max-h-[80vh] object-contain rounded-md" />
              <a
                href={lightboxUrl}
                target="_blank"
                rel="noreferrer"
                className="absolute bottom-2 right-2 px-3 py-1.5 rounded-md bg-background/90 border border-border text-xs hover:bg-background"
              >
                Open original
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

function TypePill({ type }: { type: 'clean' | 'dirty' }) {
  if (type === 'clean') {
    return (
      <StatusBadge tone="success">
        <Sparkles className="w-3 h-3" /> Clean
      </StatusBadge>
    )
  }
  return (
    <StatusBadge tone="warning">
      <Shirt className="w-3 h-3" /> Dirty
    </StatusBadge>
  )
}
