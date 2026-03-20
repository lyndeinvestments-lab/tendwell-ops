import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { InlineEdit } from '@/components/InlineEdit'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { ArrowUpDown, Search } from 'lucide-react'

type SortKey = 'name' | 'ce_charged' | 'cleaner_pay' | 'est_laundry' | 'est_consumables' | 'total_estimated_cost' | 'estimated_profit' | 'profit_percentage'

function ProfitBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>
  const cls = pct >= 30 ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' :
              pct >= 15 ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' :
              'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
  return (
    <span data-testid={`badge-profit-${Math.round(pct)}`} className={`text-xs font-medium px-1.5 py-0.5 rounded border ${cls}`}>
      {pct.toFixed(1)}%
    </span>
  )
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function CostTrackingPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/operational_properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, ce_charged, cleaner_pay, est_laundry, est_consumables, inspection_cost, trash_cost, total_estimated_cost, estimated_profit, profit_percentage')
      if (error) throw error
      return data || []
    },
  })

  const { mutate: updateProperty } = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: number | null }) => {
      const { error } = await supabase.from('properties').update({ [field]: value }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/operational_properties'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
    },
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    if (!properties) return []
    let arr = properties.filter((p: any) =>
      p.name?.toLowerCase().includes(search.toLowerCase())
    )
    arr = [...arr].sort((a: any, b: any) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [properties, search, sortKey, sortDir])

  const totals = useMemo(() => {
    if (!filtered.length) return null
    return {
      ce: filtered.reduce((s: number, p: any) => s + (p.ce_charged || 0), 0),
      pay: filtered.reduce((s: number, p: any) => s + (p.cleaner_pay || 0), 0),
      laundry: filtered.reduce((s: number, p: any) => s + (p.est_laundry || 0), 0),
      consumables: filtered.reduce((s: number, p: any) => s + (p.est_consumables || 0), 0),
      total: filtered.reduce((s: number, p: any) => s + (p.total_estimated_cost || 0), 0),
      profit: filtered.reduce((s: number, p: any) => s + (p.estimated_profit || 0), 0),
    }
  }, [filtered])

  const thCls = 'text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap'

  function SortIcon({ col }: { col: SortKey }) {
    return <ArrowUpDown className={`w-3 h-3 inline ml-1 ${sortKey === col ? 'text-primary' : 'text-muted-foreground/40'}`} />
  }

  return (
    <div className="p-5 h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Cost Tracking</h1>
          <p className="text-sm text-muted-foreground">Operational properties — click cells to edit</p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-cost"
            className="pl-8 h-8 w-56 text-sm"
          />
        </div>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th className={thCls} onClick={() => toggleSort('name')}>Property <SortIcon col="name" /></th>
              <th className={thCls} onClick={() => toggleSort('ce_charged')}>CE Charged <SortIcon col="ce_charged" /></th>
              <th className={thCls} onClick={() => toggleSort('cleaner_pay')}>Cleaner Pay <SortIcon col="cleaner_pay" /></th>
              <th className={thCls} onClick={() => toggleSort('est_laundry')}>Laundry <SortIcon col="est_laundry" /></th>
              <th className={thCls} onClick={() => toggleSort('est_consumables')}>Consumables <SortIcon col="est_consumables" /></th>
              <th className={thCls}>Inspection</th>
              <th className={thCls}>Trash</th>
              <th className={thCls} onClick={() => toggleSort('total_estimated_cost')}>Total Cost <SortIcon col="total_estimated_cost" /></th>
              <th className={thCls} onClick={() => toggleSort('estimated_profit')}>Profit <SortIcon col="estimated_profit" /></th>
              <th className={thCls} onClick={() => toggleSort('profit_percentage')}>Profit % <SortIcon col="profit_percentage" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(10)].map((_, j) => (
                    <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-12 text-muted-foreground text-sm">No operational properties found</td>
              </tr>
            ) : (
              filtered.map((p: any) => (
                <tr key={p.id} data-testid={`row-property-${p.id}`} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="py-2 px-3 font-medium text-xs">{p.name}</td>
                  <td className="py-2 px-3">
                    <InlineEdit
                      value={p.ce_charged}
                      type="number"
                      onSave={v => updateProperty({ id: p.id, field: 'ce_charged', value: v ? parseFloat(v) : null })}
                      testId={`inline-ce-${p.id}`}
                    />
                  </td>
                  <td className="py-2 px-3">
                    <InlineEdit
                      value={p.cleaner_pay}
                      type="number"
                      onSave={v => updateProperty({ id: p.id, field: 'cleaner_pay', value: v ? parseFloat(v) : null })}
                      testId={`inline-pay-${p.id}`}
                    />
                  </td>
                  <td className="py-2 px-3 tabular-nums text-xs">{fmt(p.est_laundry)}</td>
                  <td className="py-2 px-3 tabular-nums text-xs">{fmt(p.est_consumables)}</td>
                  <td className="py-2 px-3 tabular-nums text-xs text-muted-foreground">$15.00</td>
                  <td className="py-2 px-3 tabular-nums text-xs text-muted-foreground">$5.00</td>
                  <td className="py-2 px-3 tabular-nums text-xs font-medium">{fmt(p.total_estimated_cost)}</td>
                  <td className="py-2 px-3 tabular-nums text-xs font-medium">{fmt(p.estimated_profit)}</td>
                  <td className="py-2 px-3"><ProfitBadge pct={p.profit_percentage} /></td>
                </tr>
              ))
            )}
            {totals && !isLoading && (
              <tr className="bg-muted/60 border-t-2 border-border font-semibold">
                <td className="py-2 px-3 text-xs uppercase tracking-wide">Totals ({filtered.length})</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.ce)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.pay)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.laundry)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.consumables)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(filtered.length * 15)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(filtered.length * 5)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.total)}</td>
                <td className="py-2 px-3 tabular-nums text-xs">{fmt(totals.profit)}</td>
                <td className="py-2 px-3 text-xs text-muted-foreground">
                  {totals.ce > 0 ? `${((totals.profit / totals.ce) * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
