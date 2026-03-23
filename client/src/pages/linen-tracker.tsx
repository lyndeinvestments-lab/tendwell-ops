import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { InlineEdit } from '@/components/InlineEdit'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useAppSettings } from '@/hooks/use-app-settings'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Search, AlertTriangle, Copy, Download, X, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { TablePagination } from '@/components/TablePagination'
import Papa from 'papaparse'

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
  const hasBeds = (p.bedrooms ?? 0) > 0
  if (!hasBeds) return false
  return NUMERIC_KEYS.every(k => !p[k] || p[k] === 0)
}

function isBelowThreshold(p: any, multiplier: number): boolean {
  if (!p.bedrooms || p.bedrooms === 0) return false
  const threshold = p.bedrooms * multiplier
  const totalBeds = (p.king_beds ?? 0) + (p.queen_beds ?? 0) + (p.full_beds ?? 0) + (p.twin_beds ?? 0)
  return totalBeds < threshold || (p.bath_towels ?? 0) < threshold
}

export default function LinenTrackerPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { openPropertyModal } = usePropertyModal()
  const { getNumber } = useAppSettings()
  const restockMultiplier = getNumber('linen_restock_multiplier', 2)
  usePageTitle('Linen Tracker')
  const [search, setSearch] = useState('')
  const [showZeroOnly, setShowZeroOnly] = useState(false)
  const [showRestockOnly, setShowRestockOnly] = useState(false)
  const [copyTarget, setCopyTarget] = useState<any>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null)

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/linen-tracker'] })
      toast({ title: 'Saved' })
    },
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  })

  const filtered = useMemo(() => {
    if (!properties) return []
    let result = properties.filter((p: any) => {
      const matchSearch = p.name?.toLowerCase().includes(search.toLowerCase())
      const matchZero = !showZeroOnly || isZeroInventory(p)
      const matchRestock = !showRestockOnly || isBelowThreshold(p, restockMultiplier)
      return matchSearch && matchZero && matchRestock
    })

    if (sortDir) {
      result = [...result].sort((a: any, b: any) => {
        const cmp = (a.name || '').localeCompare(b.name || '')
        return sortDir === 'asc' ? cmp : -cmp
      })
    }

    return result
  }, [properties, search, showZeroOnly, showRestockOnly, restockMultiplier, sortDir])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  const zeroCount = useMemo(() => {
    if (!properties) return 0
    return properties.filter(isZeroInventory).length
  }, [properties])

  const restockCount = useMemo(() => {
    if (!properties) return 0
    return properties.filter((p: any) => isBelowThreshold(p, restockMultiplier)).length
  }, [properties, restockMultiplier])

  function toggleSort() {
    setSortDir(prev => prev === null ? 'asc' : prev === 'asc' ? 'desc' : null)
  }

  function exportCsv() {
    const rows = filtered.map((p: any) => {
      const row: Record<string, any> = { 'Property': p.name || '' }
      LINEN_COLS.forEach(c => { row[c.label] = p[c.key] ?? '' })
      return row
    })
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'linen-tracker.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const SortIcon = () => {
    if (sortDir === 'asc') return <ArrowUp className="w-3 h-3" />
    if (sortDir === 'desc') return <ArrowDown className="w-3 h-3" />
    return <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
  }

  return (
    <div className="p-5 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Linen Tracker</h1>
          <p className="text-sm text-muted-foreground">Active properties — click to edit</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {restockCount > 0 && (
            <button
              onClick={() => { setShowRestockOnly(v => !v); setShowZeroOnly(false); setPage(1) }}
              className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md border transition-colors ${
                showRestockOnly
                  ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                  : 'border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
              }`}
              data-testid="button-filter-restock"
            >
              <AlertTriangle className="w-3 h-3" />
              {restockCount} need{restockCount === 1 ? 's' : ''} restock
            </button>
          )}
          {zeroCount > 0 && (
            <button
              onClick={() => { setShowZeroOnly(v => !v); setShowRestockOnly(false); setPage(1) }}
              className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md border transition-colors ${
                showZeroOnly
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
                  : 'border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
              }`}
              data-testid="button-filter-zero-inventory"
            >
              <AlertTriangle className="w-3 h-3" />
              {zeroCount} no linen data
            </button>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0} className="h-8 text-xs gap-1.5" data-testid="button-export-csv">
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              data-testid="input-search-linen"
              className="pl-8 pr-7 h-8 w-56 text-sm"
            />
            {search && (
              <button onClick={() => { setSearch(''); setPage(1) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[160px] cursor-pointer select-none hover:text-foreground group"
                onClick={toggleSort}
              >
                <span className="flex items-center gap-1">
                  Property
                  <SortIcon />
                </span>
              </th>
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
                  {showZeroOnly ? 'No properties with missing linen data' : showRestockOnly ? 'No properties need restock' : 'No active properties found'}
                </td>
              </tr>
            ) : (
              paged.map((p: any) => {
                const flaggedZero = isZeroInventory(p)
                const flaggedRestock = !flaggedZero && isBelowThreshold(p, restockMultiplier)
                return (
                  <tr key={p.id} data-testid={`row-linen-${p.id}`} className={`group border-b border-border/50 hover:bg-muted/20 transition-colors ${flaggedZero ? 'bg-red-50/40 dark:bg-red-900/10' : flaggedRestock ? 'bg-amber-50/40 dark:bg-amber-900/10' : ''}`}>
                    <td className="py-2 px-3 font-medium text-xs">
                      <div className="flex items-center gap-1.5">
                        {flaggedZero && <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" title="No linen data recorded" />}
                        {flaggedRestock && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" title="Below restock threshold" />}
                        <button
                          onClick={() => openPropertyModal(p.id, 'linen-tracker')}
                          className="text-primary hover:underline text-left"
                          data-testid={`link-property-${p.id}`}
                        >
                          {p.name}
                        </button>
                        <button
                          onClick={() => setCopyTarget(p)}
                          className="p-0.5 text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                          aria-label="Copy linen data from another property"
                          data-testid={`copy-linen-${p.id}`}
                        >
                          <Copy className="w-3 h-3" />
                        </button>
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

      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      <Dialog open={!!copyTarget} onOpenChange={v => !v && setCopyTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Copy linen data to {copyTarget?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Select a property to copy linen counts from:</p>
          <div className="max-h-64 overflow-auto space-y-1">
            {(properties || [])
              .filter((s: any) => s.id !== copyTarget?.id && !isZeroInventory(s))
              .map((s: any) => (
                <button
                  key={s.id}
                  className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
                  data-testid={`copy-source-${s.id}`}
                  onClick={() => {
                    const updates = NUMERIC_KEYS.map(k =>
                      supabase.from('properties').update({ [k]: s[k] ?? null }).eq('id', copyTarget.id)
                    )
                    Promise.all(updates).then(() => {
                      qc.invalidateQueries({ queryKey: ['/supabase/linen-tracker'] })
                      toast({ title: 'Linen data copied', description: `Copied from ${s.name} to ${copyTarget.name}` })
                      setCopyTarget(null)
                    }).catch(() => {
                      toast({ title: 'Copy failed', variant: 'destructive' })
                    })
                  }}
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {s.bedrooms}BR — {NUMERIC_KEYS.filter(k => s[k] > 0).length} fields set
                  </span>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
