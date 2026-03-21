import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Search } from 'lucide-react'

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
  const [search, setSearch] = useState('')

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/previous-properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, client, address, bedrooms, full_baths, ce_charged, cleaner_pay, profit_percentage, stage_name')
        .eq('stage_name', 'Offboarded')
      if (error) throw error
      return data || []
    },
  })

  const filtered = useMemo(() => {
    if (!properties) return []
    const q = search.toLowerCase()
    return [...properties]
      .filter((p: any) =>
        p.name?.toLowerCase().includes(q) ||
        p.client?.toLowerCase().includes(q) ||
        p.address?.toLowerCase().includes(q)
      )
      .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))
  }, [properties, search])

  return (
    <div className="p-5 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Previous Properties</h1>
          <p className="text-sm text-muted-foreground">Archive of offboarded properties — read only</p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-previous"
            className="pl-8 h-8 w-56 text-sm"
          />
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
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(9)].map((_, j) => (
                    <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-12 text-muted-foreground text-sm">
                  {search ? 'No properties match your search' : 'No offboarded properties'}
                </td>
              </tr>
            ) : (
              filtered.map((p: any) => (
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">{filtered.length} propert{filtered.length === 1 ? 'y' : 'ies'}</p>
      )}
    </div>
  )
}
