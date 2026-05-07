import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
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
import { Search, Scale, Download, Trash2, Sparkles, Shirt, Camera } from 'lucide-react'
import { format, parseISO, subDays } from 'date-fns'
import Papa from 'papaparse'

type WeighIn = {
  id: string
  cleaner_name: string
  pounds: number
  laundry_type: 'clean' | 'dirty'
  photo_url: string | null
  photo_path: string | null
  language: string | null
  submitted_at: string
  created_at: string
}

type TypeFilter = 'all' | 'clean' | 'dirty'
type RangeFilter = '7d' | '30d' | '90d' | 'all'

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

  const { data: rows, isLoading, isError } = useQuery({
    queryKey: ['laundry-weigh-ins', rangeFilter],
    queryFn: async (): Promise<WeighIn[]> => {
      let query = supabase
        .from('laundry_weigh_ins')
        .select('id, cleaner_name, pounds, laundry_type, photo_url, photo_path, language, submitted_at, created_at')
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
      if (row.photo_path) {
        await supabase.storage.from('laundry-weigh-ins').remove([row.photo_path])
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
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center">
            <Scale className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-tight">Laundry Weigh-Ins</h1>
            <p className="text-xs text-muted-foreground">Daily cleaner submissions from the public form</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Submissions" value={stats.total.toLocaleString()} />
        <StatCard label="Clean lbs" value={stats.cleanLbs.toFixed(1)} accent="text-emerald-600 dark:text-emerald-400" />
        <StatCard label="Dirty lbs" value={stats.dirtyLbs.toFixed(1)} accent="text-amber-600 dark:text-amber-400" />
        <StatCard label="Unique cleaners" value={stats.cleaners.toLocaleString()} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search cleaner name…"
            className="pl-9 h-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={v => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="clean">Clean</SelectItem>
            <SelectItem value="dirty">Dirty</SelectItem>
          </SelectContent>
        </Select>
        <Select value={rangeFilter} onValueChange={v => setRangeFilter(v as RangeFilter)}>
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
        <EmptyState
          icon={Scale}
          title="Could not load weigh-ins"
          description="Refresh to try again."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No weigh-ins yet"
          description="Submissions from the public form will show up here."
        />
      ) : (
        <Card>
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
                  {filtered.map(row => (
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
                            <img src={row.photo_url} alt="Weigh-in" className="w-full h-full object-cover" loading="lazy" />
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
          </CardContent>
        </Card>
      )}

      <Dialog open={!!lightboxUrl} onOpenChange={open => !open && setLightboxUrl(null)}>
        <DialogContent className="max-w-3xl p-2 sm:p-4">
          {lightboxUrl && (
            <div className="relative">
              <img src={lightboxUrl} alt="Weigh-in photo" className="w-full h-auto max-h-[80vh] object-contain rounded-md" />
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
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold tabular-nums ${accent ?? ''}`}>{value}</div>
      </CardContent>
    </Card>
  )
}

function TypePill({ type }: { type: 'clean' | 'dirty' }) {
  if (type === 'clean') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        <Sparkles className="w-3 h-3" /> Clean
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
      <Shirt className="w-3 h-3" /> Dirty
    </span>
  )
}
