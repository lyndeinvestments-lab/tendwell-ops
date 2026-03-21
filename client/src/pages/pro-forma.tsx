import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { InlineEdit } from '@/components/InlineEdit'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/hooks/use-toast'
import { Search, AlertTriangle, Upload } from 'lucide-react'
import { CsvImportModal } from '@/components/CsvImportModal'

const FREQ_OPTIONS = [
  { value: 'weekly', label: 'Weekly', cleans: 4.33 },
  { value: 'biweekly', label: 'Biweekly', cleans: 2.17 },
  { value: 'monthly', label: 'Monthly', cleans: 1 },
  { value: 'as_needed', label: 'As Needed', cleans: 2 },
]

function fmt(n: number | null | undefined, prefix = '$') {
  if (n == null) return '—'
  return `${prefix}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function FrequencyCell({ id, value }: { id: string; value: string }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { mutate } = useMutation({
    mutationFn: async (freq: string) => {
      const { error } = await supabase.from('properties').update({ cleaning_frequency: freq }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/pro-forma'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
    },
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  })

  const labelColor = value === 'as_needed' ? 'text-amber-600 dark:text-amber-400' : ''

  return (
    <Select value={value || 'as_needed'} onValueChange={mutate}>
      <SelectTrigger data-testid={`select-freq-${id}`} className={`h-6 w-28 text-xs border-0 p-0 bg-transparent focus:ring-0 hover:bg-muted transition-colors ${labelColor}`}>
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {FREQ_OPTIONS.map(f => (
          <SelectItem key={f.value} value={f.value} className="text-xs">
            {f.label} ({f.cleans}/mo)
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default function ProFormaPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkFreq, setBulkFreq] = useState('')
  const [showImport, setShowImport] = useState(false)

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/pro-forma'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, ce_charged, total_estimated_cost, estimated_profit, profit_percentage, cleaning_frequency, first_clean_date, avg_cleans_per_month, monthly_revenue_estimate, monthly_cost_estimate, monthly_profit_estimate, stage_name')
        .eq('stage_name', 'Active')
      if (error) throw error
      return data || []
    },
  })

  const { mutate: updateDate } = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) => {
      const { error } = await supabase.from('properties').update({ first_clean_date: value || null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/supabase/pro-forma'] }),
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  })

  const { mutate: bulkSetFreq, isPending: bulkPending } = useMutation({
    mutationFn: async ({ ids, freq }: { ids: string[]; freq: string }) => {
      const { error } = await supabase
        .from('properties')
        .update({ cleaning_frequency: freq })
        .in('id', ids)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/pro-forma'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      const count = selected.size
      setSelected(new Set())
      setBulkFreq('')
      toast({ title: `Updated ${count} properties` })
    },
    onError: () => toast({ title: 'Bulk update failed', variant: 'destructive' }),
  })

  const filtered = useMemo(() => {
    if (!properties) return []
    if (!search) return properties
    return properties.filter((p: any) => p.name?.toLowerCase().includes(search.toLowerCase()))
  }, [properties, search])

  const totals = useMemo(() => {
    if (!filtered?.length) return null
    return {
      revenue: filtered.reduce((s: number, p: any) => s + (p.monthly_revenue_estimate || 0), 0),
      cost: filtered.reduce((s: number, p: any) => s + (p.monthly_cost_estimate || 0), 0),
      profit: filtered.reduce((s: number, p: any) => s + (p.monthly_profit_estimate || 0), 0),
    }
  }, [filtered])

  const asNeededCount = filtered?.filter((p: any) => p.cleaning_frequency === 'as_needed').length ?? 0

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (filtered.length > 0 && selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((p: any) => p.id)))
    }
  }

  const allSelected = filtered.length > 0 && selected.size === filtered.length
  const someSelected = selected.size > 0 && selected.size < filtered.length

  return (
    <div className="p-5 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Pro Forma</h1>
          <p className="text-sm text-muted-foreground">Financial projections for active properties</p>
        </div>
        <div className="flex items-center gap-3">
          {asNeededCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3 h-3" />
              <span>{asNeededCount} using default frequency (2/mo)</span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowImport(true)}
            className="h-8 text-xs gap-1.5"
            data-testid="button-import-csv"
          >
            <Upload className="w-3.5 h-3.5" />
            Import CSV
          </Button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-search-proforma"
              className="pl-8 h-8 w-48 text-sm"
            />
          </div>
        </div>
      </div>

      <div className={`overflow-auto flex-1 rounded-lg border border-border ${selected.size > 0 ? 'pb-16' : ''}`}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th className="py-2 px-3 w-8">
                <Checkbox
                  checked={allSelected}
                  data-state={someSelected ? 'indeterminate' : allSelected ? 'checked' : 'unchecked'}
                  onCheckedChange={toggleAll}
                  data-testid="checkbox-select-all"
                />
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[140px]">Property</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">CE/Clean</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Cost/Clean</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Profit/Clean</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Frequency</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Cleans/Mo</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">First Clean</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Mo Revenue</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Mo Cost</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Mo Profit</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(11)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}
                </tr>
              ))
            ) : !filtered || filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-12 text-muted-foreground text-sm">No active properties found</td>
              </tr>
            ) : (
              filtered.map((p: any) => {
                const profitNeg = (p.monthly_profit_estimate || 0) < 0
                return (
                  <tr key={p.id} data-testid={`row-proforma-${p.id}`} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${profitNeg ? 'bg-destructive/5' : ''}`}>
                    <td className="py-2 px-3">
                      <Checkbox
                        checked={selected.has(p.id)}
                        onCheckedChange={() => toggleSelect(p.id)}
                        data-testid={`checkbox-${p.id}`}
                      />
                    </td>
                    <td className="py-2 px-3 font-medium text-xs">{p.name}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.ce_charged)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.total_estimated_cost)}</td>
                    <td className={`py-2 px-3 text-xs tabular-nums font-medium ${(p.estimated_profit || 0) < 0 ? 'text-destructive' : ''}`}>{fmt(p.estimated_profit)}</td>
                    <td className="py-2 px-3">
                      <FrequencyCell id={p.id} value={p.cleaning_frequency} />
                    </td>
                    <td className="py-2 px-3 text-xs tabular-nums">{p.avg_cleans_per_month ?? '—'}</td>
                    <td className="py-2 px-3">
                      <InlineEdit
                        value={p.first_clean_date ? p.first_clean_date.slice(0, 10) : ''}
                        type="text"
                        onSave={v => updateDate({ id: p.id, value: v })}
                        testId={`inline-date-${p.id}`}
                        placeholder="yyyy-mm-dd"
                      />
                    </td>
                    <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.monthly_revenue_estimate)}</td>
                    <td className="py-2 px-3 text-xs tabular-nums">{fmt(p.monthly_cost_estimate)}</td>
                    <td className={`py-2 px-3 text-xs tabular-nums font-semibold ${profitNeg ? 'text-destructive' : 'text-primary'}`}>{fmt(p.monthly_profit_estimate)}</td>
                  </tr>
                )
              })
            )}
            {totals && !isLoading && (
              <tr className="bg-muted/60 border-t-2 border-border font-semibold">
                <td className="py-2 px-3" />
                <td className="py-2 px-3 text-xs uppercase tracking-wide" colSpan={7}>Monthly Totals ({filtered?.length})</td>
                <td className="py-2 px-3 text-xs tabular-nums">{fmt(totals.revenue)}</td>
                <td className="py-2 px-3 text-xs tabular-nums">{fmt(totals.cost)}</td>
                <td className={`py-2 px-3 text-xs tabular-nums ${totals.profit < 0 ? 'text-destructive' : 'text-primary'}`}>{fmt(totals.profit)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Sticky bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-3 px-5 py-3 bg-background border-t border-border shadow-lg">
          <span className="text-sm font-medium text-foreground">
            {selected.size} {selected.size === 1 ? 'property' : 'properties'} selected
          </span>
          <div className="flex items-center gap-2">
            <Select value={bulkFreq} onValueChange={setBulkFreq}>
              <SelectTrigger className="h-8 w-40 text-xs" data-testid="select-bulk-freq">
                <SelectValue placeholder="Set Frequency…" />
              </SelectTrigger>
              <SelectContent>
                {FREQ_OPTIONS.map(f => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">
                    {f.label} ({f.cleans}/mo)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!bulkFreq || bulkPending}
              onClick={() => bulkSetFreq({ ids: Array.from(selected), freq: bulkFreq })}
              data-testid="button-bulk-apply"
            >
              {bulkPending ? 'Applying…' : 'Apply'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setSelected(new Set()); setBulkFreq('') }}
              data-testid="button-clear-selection"
            >
              Clear Selection
            </Button>
          </div>
        </div>
      )}

      {showImport && (
        <CsvImportModal
          properties={properties || []}
          onClose={() => setShowImport(false)}
          onImportComplete={() => {
            qc.invalidateQueries({ queryKey: ['/supabase/pro-forma'] })
            qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
            setShowImport(false)
          }}
        />
      )}
    </div>
  )
}
