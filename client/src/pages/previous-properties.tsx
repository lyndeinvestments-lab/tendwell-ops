import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { Search, Download, RotateCcw } from 'lucide-react'
import Papa from 'papaparse'
import { format } from 'date-fns'
import { TablePagination } from '@/components/TablePagination'

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function ProfitBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>
  const cls = pct >= 30
    ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
    : pct >= 15
    ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
    : 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${cls}`}>
      {pct.toFixed(1)}%
    </span>
  )
}

export default function PreviousPropertiesPage() {
  usePageTitle('Previous Properties')
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [reactivateProperty, setReactivateProperty] = useState<any>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const { data: stages } = useQuery({
    queryKey: ['/supabase/pipeline_stages'],
    queryFn: async () => {
      const { data } = await supabase.from('pipeline_stages').select('*').order('display_order')
      return data || []
    },
  })

  const { mutate: reactivate, isPending: reactivating } = useMutation({
    mutationFn: async (property: any) => {
      const activeStage = (stages || []).find((s: any) => s.name.toLowerCase() === 'active')
      if (!activeStage) throw new Error('Active stage not found')

      const { error: updateError } = await supabase
        .from('properties')
        .update({ stage_id: activeStage.id })
        .eq('id', property.id)
      if (updateError) throw updateError

      const offboardedStage = (stages || []).find((s: any) => s.name.toLowerCase() === 'offboarded')
      const { error: transitionError } = await supabase
        .from('stage_transitions')
        .insert({
          property_id: property.id,
          from_stage_id: offboardedStage?.id || property.stage_id,
          to_stage_id: activeStage.id,
        })
      if (transitionError) throw transitionError
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/supabase/previous-properties'] })
      queryClient.invalidateQueries({ queryKey: ['/supabase/offboard-dates'] })
      queryClient.invalidateQueries({ queryKey: ['/supabase/master-list'] })
      queryClient.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      queryClient.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      toast({ title: 'Property re-activated', description: `${reactivateProperty?.name} has been moved to Active.` })
      setReactivateProperty(null)
    },
    onError: () => {
      toast({ title: 'Re-activation failed', variant: 'destructive' })
      setReactivateProperty(null)
    },
  })

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/previous-properties'],
    queryFn: async () => {
      // Look up the offboarded stage id to avoid casing issues with the view
      const { data: stagesData } = await supabase
        .from('pipeline_stages')
        .select('id, name')

      const offboardedStage = (stagesData || []).find((s: any) =>
        s.name.toLowerCase() === 'offboarded'
      )

      if (offboardedStage) {
        const { data, error } = await supabase
          .from('properties')
          .select('id, name, client, address, bedrooms, full_baths, ce_charged, cleaner_pay, profit_percentage')
          .eq('stage_id', offboardedStage.id)
        if (error) throw error
        return (data || []).map((p: any) => ({ ...p, stage_name: 'Offboarded' }))
      }

      // Fallback: try the view
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, client, address, bedrooms, full_baths, ce_charged, cleaner_pay, profit_percentage, stage_name')
        .or('stage_name.eq.Offboarded,stage_name.eq.offboarded')
      if (error) throw error
      return data || []
    },
  })

  const { data: offboardDates, isLoading: datesLoading } = useQuery({
    queryKey: ['/supabase/offboard-dates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stage_transitions')
        .select('property_id, created_at, pipeline_stages!stage_transitions_to_stage_id_fkey(name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      const map: Record<string, string> = {}
      for (const t of data || []) {
        const stageName = (t as any).pipeline_stages?.name
        const propId = (t as any).property_id
        if (stageName?.toLowerCase() === 'offboarded' && !map[propId]) {
          map[propId] = (t as any).created_at
        }
      }
      return map
    },
  })

  function formatOffboardDate(propId: string) {
    const date = offboardDates?.[propId]
    if (!date) return '—'
    try { return format(new Date(date), 'MMM d, yyyy') } catch { return '—' }
  }

  const filtered = useMemo(() => {
    if (!properties) return []
    const q = search.toLowerCase()
    return [...properties]
      .filter((p: any) =>
        p.name?.toLowerCase().includes(q) ||
        p.client?.toLowerCase().includes(q) ||
        p.address?.toLowerCase().includes(q)
      )
      .sort((a: any, b: any) => {
        const dateA = offboardDates?.[a.id]
        const dateB = offboardDates?.[b.id]
        if (!dateA && !dateB) return (a.name || '').localeCompare(b.name || '')
        if (!dateA) return 1
        if (!dateB) return -1
        return new Date(dateB).getTime() - new Date(dateA).getTime()
      })
  }, [properties, search, offboardDates])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  function exportCsv() {
    const rows = filtered.map((p: any) => ({
      Property: p.name || '',
      Client: p.client || '',
      Address: p.address || '',
      Beds: p.bedrooms ?? '',
      Baths: p.full_baths ?? '',
      'CE/Clean': p.ce_charged != null ? `$${p.ce_charged.toFixed(2)}` : '',
      'Cleaner Pay': p.cleaner_pay != null ? `$${p.cleaner_pay.toFixed(2)}` : '',
      'Profit %': p.profit_percentage != null ? `${p.profit_percentage.toFixed(1)}%` : '',
      Status: 'Offboarded',
      'Date Offboarded': formatOffboardDate(p.id),
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'previous-properties.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-5 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Previous Properties</h1>
          <p className="text-sm text-muted-foreground">Archive of offboarded properties — read only</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              data-testid="input-search-previous"
              className="pl-8 h-8 w-56 text-sm"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            data-testid="button-export-csv"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[160px]">Property</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Client</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Address</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Beds</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Baths</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">CE/Clean</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Cleaner Pay</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Profit %</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Status</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Date Offboarded</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(11)].map((_, j) => (
                    <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-12 text-muted-foreground text-sm">
                  {search ? 'No properties match your search' : 'No offboarded properties'}
                </td>
              </tr>
            ) : (
              paged.map((p: any) => (
                <tr key={p.id} data-testid={`row-previous-${p.id}`} className="border-b border-border/50 hover:bg-muted/20 transition-colors opacity-80">
                  <td className="py-2 px-3 font-medium text-xs">{p.name}</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{p.client || '—'}</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{p.address || '—'}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">{p.bedrooms ?? '—'}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">{p.full_baths ?? '—'}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.ce_charged)}</td>
                  <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.cleaner_pay)}</td>
                  <td className="py-2 px-3"><ProfitBadge pct={p.profit_percentage} /></td>
                  <td className="py-2 px-3">
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded border" style={{ color: '#9ca3af', borderColor: '#d1d5db', backgroundColor: 'transparent' }}>
                      Offboarded
                    </span>
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                    {datesLoading ? <Skeleton className="h-3 w-20" /> : formatOffboardDate(p.id)}
                  </td>
                  <td className="py-2 px-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 gap-1 text-xs"
                      onClick={() => setReactivateProperty(p)}
                      data-testid={`button-reactivate-${p.id}`}
                    >
                      <RotateCcw className="w-3 h-3" />
                      Re-activate
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      <AlertDialog open={!!reactivateProperty} onOpenChange={v => !v && setReactivateProperty(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-activate Property</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to re-activate <strong>{reactivateProperty?.name}</strong>? This will move it back to the Active stage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reactivating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reactivating}
              onClick={() => reactivateProperty && reactivate(reactivateProperty)}
              data-testid="button-confirm-reactivate"
            >
              {reactivating ? 'Re-activating…' : 'Re-activate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
