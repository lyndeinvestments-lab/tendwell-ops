import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { InlineEdit } from '@/components/InlineEdit'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { Search, AlertTriangle } from 'lucide-react'

const LINEN_COLS = [
  { key: 'king_beds', label: 'King' },
  { key: 'queen_beds', label: 'Queen' },
  { key: 'full_beds', label: 'Full' },
  { key: 'twin_beds', label: 'Twin' },
  { key: 'bath_towels', label: 'Bath Towels' },
  { key: 'washcloths', label: 'Washcloths' },
  { key: 'hand_towels', label: 'Hand Towels' },
  { key: 'bathmats', label: 'Bathmats' },
  { key: 'pool_towels', label: 'Pool Towels' },
  { key: 'linen_notes', label: 'Notes' },
]

const NUMERIC_KEYS = LINEN_COLS.filter(c => c.key !== 'linen_notes').map(c => c.key)

function isZeroInventory(p: any): boolean {
  // Flag if property has beds but all numeric linen counts are 0 or null
  const hasBeds = (p.bedrooms ?? 0) > 0
  if (!hasBeds) return false
  return NUMERIC_KEYS.every(k => !p[k] || p[k] === 0)
}

export default function LinenTrackerPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showZeroOnly, setShowZeroOnly] = useState(false)

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/linen-tracker'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, stage_name, bedrooms, king_beds, queen_beds, full_beds, twin_beds, bath_towels, washcloths, hand_towels, bathmats, pool_towels, linen_notes')
        .eq('stage_name', 'Active')
      if (error) throw error
      return data || []
    },
  })

  const { mutate: updateLinen } = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: any }) => {
      const { error } = await supabase.from('properties').update({ [field]: value }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/supabase/linen-tracker'] }),
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  })

  const filtered = useMemo(() => {
    if (!properties) return []
    return properties.filter((p: any) => {
      const matchSearch = p.name?.toLowerCase().includes(search.toLowerCase())
      const matchZero = !showZeroOnly || isZeroInventory(p)
      return matchSearch && matchZero
    })
  }, [properties, search, showZeroOnly])

  const zeroCount = useMemo(() => {
    if (!properties) return 0
    return properties.filter(isZeroInventory).length
  }, [properties])

  return (
    <div className="p-5 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Linen Tracker</h1>
          <p className="text-sm text-muted-foreground">Active properties — click to edit</p>
        </div>
        <div className="flex items-center gap-2">
          {zeroCount > 0 && (
            <button
              onClick={() => setShowZeroOnly(v => !v)}
              className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md border transition-colors ${
                showZeroOnly
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
                  : 'border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
              }`}
              data-testid="button-filter-zero-inventory"
            >
              <AlertTriangle className="w-3 h-3" />
              {zeroCount} propert{zeroCount === 1 ? 'y has' : 'ies have'} no linen data
            </button>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-search-linen"
              className="pl-8 h-8 w-56 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[160px]">Property</th>
              {LINEN_COLS.map(c => (
                <th key={c.key} className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(LINEN_COLS.length + 1)].map((_, j) => (
                    <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={LINEN_COLS.length + 1} className="text-center py-12 text-muted-foreground text-sm">
                  {showZeroOnly ? 'No properties with missing linen data' : 'No active properties found'}
                </td>
              </tr>
            ) : (
              filtered.map((p: any) => {
                const flagged = isZeroInventory(p)
                return (
                  <tr key={p.id} data-testid={`row-linen-${p.id}`} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${flagged ? 'bg-red-50/40 dark:bg-red-900/10' : ''}`}>
                    <td className="py-2 px-3 font-medium text-xs">
                      <div className="flex items-center gap-1.5">
                        {flagged && <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" title="No linen data recorded" />}
                        {p.name}
                      </div>
                    </td>
                    {LINEN_COLS.map(c => (
                      <td key={c.key} className="py-2 px-3">
                        <InlineEdit
                          value={p[c.key]}
                          type={c.key === 'linen_notes' ? 'text' : 'number'}
                          onSave={v => updateLinen({
                            id: p.id,
                            field: c.key,
                            value: c.key === 'linen_notes' ? v : (v ? parseInt(v) : null)
                          })}
                          testId={`inline-${c.key}-${p.id}`}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
