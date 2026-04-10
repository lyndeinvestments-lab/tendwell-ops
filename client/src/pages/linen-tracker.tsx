import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, logPropertyEdit } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { InlineEdit } from '@/components/InlineEdit'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Search, AlertTriangle, Copy, Download, Upload, X, ArrowUp, ArrowDown, ArrowUpDown, BedDouble, Check } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
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
const TOWEL_KEYS = new Set(['bath_towels', 'washcloths', 'hand_towels', 'bathmats', 'pool_towels'])

// A property has incomplete data only if ALL numeric fields are zero/null
// Individual zeros are fine — a property may not have a certain bed type
function hasIncompleteData(p: any): boolean {
  return NUMERIC_KEYS.every(k => !p[k] || p[k] === 0)
}

export default function LinenTrackerPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { effectiveUser } = useAuth()
  const { openPropertyModal } = usePropertyModal()
  usePageTitle('Linen Requirements')
  const [search, setSearch] = useState('')
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false)
  const [copyTarget, setCopyTarget] = useState<any>(null)
  const [importData, setImportData] = useState<any[] | null>(null)
  const [importing, setImporting] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sortKey, setSortKey] = useState<string>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/linen-tracker'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, stage_name, bedrooms, king_beds, queen_beds, full_beds, twin_beds, bath_towels, washcloths, hand_towels, bathmats, pool_towels, linen_notes')
        .in('stage_name', ['Active', 'Onboarding'])
      if (error) throw error
      return data || []
    },
  })

  const { mutate: updateLinen } = useGuardedMutation('linen-tracker', {
    mutationFn: async ({ id, field, value, oldValue, propName }: { id: string; field: string; value: any; oldValue?: any; propName?: string }) => {
      const { error } = await supabase.from('properties').update({ [field]: value }).eq('id', id)
      if (error) throw error
      logPropertyEdit(id, field, oldValue, value, propName)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/linen-tracker'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
      toast({ title: 'Saved' })
    },
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  })

  const filtered = useMemo(() => {
    if (!properties) return []
    let result = properties.filter((p: any) => {
      const matchSearch = p.name?.toLowerCase().includes(search.toLowerCase())
      const matchIncomplete = !showIncompleteOnly || hasIncompleteData(p)
      return matchSearch && matchIncomplete
    })

    result = [...result].sort((a: any, b: any) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'name') return (a.name || '').localeCompare(b.name || '') * dir
      const av = a[sortKey] ?? 0
      const bv = b[sortKey] ?? 0
      return (av - bv) * dir
    })

    return result
  }, [properties, search, showIncompleteOnly, sortKey, sortDir])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  const companyTotals = useMemo(() => {
    if (!properties) return null
    const totals: Record<string, number> = {}
    for (const key of NUMERIC_KEYS) {
      totals[key] = properties.reduce((sum: number, p: any) => sum + (p[key] ?? 0), 0)
    }
    return totals
  }, [properties])

  const incompleteCount = useMemo(() => {
    if (!properties) return 0
    return properties.filter(hasIncompleteData).length
  }, [properties])

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
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
    a.href = url; a.download = 'linen-requirements.csv'; a.click()
    URL.revokeObjectURL(url)
    toast({ title: 'CSV exported', description: `${rows.length} rows exported` })
  }

  function ColSortIcon({ col }: { col: string }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-40" />
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
  }

  // CSV column name → DB field mapping (case-insensitive, flexible)
  const COL_MAP: Record<string, string> = {
    'property': '_name', 'name': '_name',
    'king': 'king_beds', 'king beds': 'king_beds', 'king_beds': 'king_beds',
    'queen': 'queen_beds', 'queen beds': 'queen_beds', 'queen_beds': 'queen_beds',
    'full': 'full_beds', 'full beds': 'full_beds', 'full_beds': 'full_beds',
    'twin': 'twin_beds', 'twin beds': 'twin_beds', 'twin_beds': 'twin_beds',
    'bath towels': 'bath_towels', 'bath_towels': 'bath_towels', 'bathtowels': 'bath_towels',
    'washcloths': 'washcloths', 'wash cloths': 'washcloths',
    'hand towels': 'hand_towels', 'hand_towels': 'hand_towels', 'handtowels': 'hand_towels',
    'bathmats': 'bathmats', 'bath mats': 'bathmats',
    'pool towels': 'pool_towels', 'pool_towels': 'pool_towels', 'pooltowels': 'pool_towels',
    'notes': 'linen_notes', 'linen_notes': 'linen_notes', 'linen notes': 'linen_notes',
  }

  function handleCsvFile(file: File) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (!result.data?.length || !properties) {
          toast({ title: 'No data found in CSV', variant: 'destructive' })
          return
        }
        // Map CSV headers to DB fields
        const csvHeaders = Object.keys(result.data[0] as any)
        const headerMap: Record<string, string> = {}
        for (const h of csvHeaders) {
          const mapped = COL_MAP[h.toLowerCase().trim()]
          if (mapped) headerMap[h] = mapped
        }
        const nameCol = csvHeaders.find(h => headerMap[h] === '_name')
        if (!nameCol) {
          toast({ title: 'CSV must have a "Property" or "Name" column', variant: 'destructive' })
          return
        }
        // Match CSV rows to existing properties by name (fuzzy)
        const rows: any[] = []
        for (const csvRow of result.data as any[]) {
          const csvName = (csvRow[nameCol] || '').trim()
          if (!csvName) continue
          // Find matching property by exact or partial name match
          const match = properties.find((p: any) =>
            p.name?.toLowerCase() === csvName.toLowerCase() ||
            p.name?.toLowerCase().startsWith(csvName.toLowerCase().split(' - ')[0]) ||
            csvName.toLowerCase().startsWith(p.name?.toLowerCase())
          )
          const updates: Record<string, any> = {}
          let changeCount = 0
          for (const [csvCol, dbField] of Object.entries(headerMap)) {
            if (dbField === '_name') continue
            const val = csvRow[csvCol]
            if (val == null || val === '') continue
            const isNumeric = dbField !== 'linen_notes'
            updates[dbField] = isNumeric ? parseInt(val) || 0 : val
            changeCount++
          }
          if (changeCount > 0) {
            rows.push({
              csvName,
              matchedProperty: match,
              updates,
              changeCount,
            })
          }
        }
        if (rows.length === 0) {
          toast({ title: 'No importable data found', variant: 'destructive' })
          return
        }
        setImportData(rows)
      },
      error: () => toast({ title: 'Failed to parse CSV', variant: 'destructive' }),
    })
  }

  async function executeImport() {
    if (!importData) return
    if (!canEditView('linen-tracker', effectiveUser)) {
      toast({ title: 'Edit access required', description: "You don't have edit access to this page.", variant: 'destructive' })
      return
    }
    setImporting(true)
    let updated = 0, skipped = 0
    for (const row of importData) {
      if (!row.matchedProperty) { skipped++; continue }
      const { error } = await supabase
        .from('properties')
        .update(row.updates)
        .eq('id', row.matchedProperty.id)
      if (!error) updated++
      else skipped++
    }
    qc.invalidateQueries({ queryKey: ['/supabase/linen-tracker'] })
    toast({ title: `Import complete`, description: `${updated} updated, ${skipped} skipped` })
    setImportData(null)
    setImporting(false)
  }

  return (
    <div className="p-5 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Linen Requirements</h1>
          <p className="text-sm text-muted-foreground">Active & onboarding properties — required quantities for one full set</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {incompleteCount > 0 && (
            <button
              onClick={() => { setShowIncompleteOnly(v => !v); setPage(1) }}
              className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md border transition-colors ${
                showIncompleteOnly
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
                  : 'border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
              }`}
            >
              <AlertTriangle className="w-3 h-3" />
              {incompleteCount} incomplete
            </button>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0} className="h-8 text-xs gap-1.5">
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
          {canEditView('linen-tracker', effectiveUser) && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = '.csv'
                input.onchange = e => {
                  const file = (e.target as HTMLInputElement).files?.[0]
                  if (file) handleCsvFile(file)
                }
                input.click()
              }}
            >
              <Upload className="w-3.5 h-3.5" />
              Import CSV
            </Button>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
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

      {incompleteCount > 0 && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground -mt-1 mb-1">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
            Empty fields (red = needs data)
          </span>
        </div>
      )}

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted border-b border-border z-10">
            <tr>
              <th
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[160px] cursor-pointer select-none hover:text-foreground sticky left-0 z-20 bg-muted"
                onClick={() => toggleSort('name')}
              >
                <span className="flex items-center gap-1">
                  Property
                  <ColSortIcon col="name" />
                </span>
              </th>
              {LINEN_COLS.map(c => (
                <th
                  key={c.key}
                  className={`text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap ${c.key !== 'linen_notes' ? 'cursor-pointer select-none hover:text-foreground' : ''}`}
                  onClick={c.key !== 'linen_notes' ? () => toggleSort(c.key) : undefined}
                >
                  <span className="flex items-center gap-1">
                    {c.label}
                    {c.key !== 'linen_notes' && <ColSortIcon col={c.key} />}
                  </span>
                </th>
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
                <td colSpan={LINEN_COLS.length + 1}>
                  <EmptyState
                    icon={BedDouble}
                    title={showIncompleteOnly ? 'All data complete' : 'No properties'}
                    description={showIncompleteOnly ? 'All properties have linen data filled in.' : 'No properties found matching your search.'}
                  />
                </td>
              </tr>
            ) : (
              paged.map((p: any) => {
                const incomplete = hasIncompleteData(p)
                return (
                  <tr key={p.id} className={`group border-b border-border/50 hover:bg-muted/20 transition-colors ${incomplete ? 'bg-red-50/30 dark:bg-red-900/5' : ''}`}>
                    <td className="py-2 px-3 font-medium text-xs sticky left-0 z-10 bg-background">
                      <div className="flex items-center gap-1.5">
                        {incomplete && (
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" title="No linen data — all fields are zero" />
                        )}
                        <button
                          onClick={() => openPropertyModal(p.id, 'linen-tracker')}
                          className="text-primary hover:underline text-left max-w-[200px] truncate"
                          title={p.name}
                        >
                          {p.name}
                        </button>
                        {canEditView('linen-tracker', effectiveUser) && (
                          <button
                            onClick={() => setCopyTarget(p)}
                            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                            aria-label="Copy linen data from another property"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                    {LINEN_COLS.map(c => {
                      const isNumeric = c.key !== 'linen_notes'
                      return (
                        <td key={c.key} className="py-2 px-3">
                          <InlineEdit
                            value={p[c.key]}
                            type={isNumeric ? 'number' : 'text'}
                            onSave={v => updateLinen({
                              id: p.id,
                              field: c.key,
                              value: isNumeric ? (v ? parseInt(v) : null) : v,
                              oldValue: p[c.key],
                              propName: p.name,
                            })}
                            testId={`inline-${c.key}-${p.id}`}
                          />
                        </td>
                      )
                    })}
                  </tr>
                )
              })
            )}
            {!isLoading && companyTotals && filtered.length > 0 && (
              <tr className="bg-muted/60 border-t-2 border-border font-semibold sticky bottom-0">
                <td className="py-2 px-3 text-xs uppercase tracking-wide sticky left-0 z-10 bg-muted/90">Company Totals ({properties?.length})</td>
                {LINEN_COLS.map(c => (
                  <td key={c.key} className="py-2 px-3 text-xs tabular-nums font-semibold">
                    {c.key === 'linen_notes' ? '' : companyTotals[c.key]?.toLocaleString() ?? 0}
                  </td>
                ))}
              </tr>
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
              .filter((s: any) => s.id !== copyTarget?.id && !hasIncompleteData(s))
              .map((s: any) => (
                <button
                  key={s.id}
                  className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
                  onClick={() => {
                    if (!canEditView('linen-tracker', effectiveUser)) {
                      toast({ title: 'Edit access required', description: "You don't have edit access to this page.", variant: 'destructive' })
                      return
                    }
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
                    {s.bedrooms}BR — {NUMERIC_KEYS.filter(k => s[k] > 0).length}/{NUMERIC_KEYS.length} fields
                  </span>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Import CSV Preview Dialog */}
      <Dialog open={!!importData} onOpenChange={v => !v && !importing && setImportData(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Import Linen Data — Preview</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {importData?.filter(r => r.matchedProperty).length} of {importData?.length} rows matched to existing properties.
            Unmatched rows will be skipped.
          </p>
          <div className="overflow-auto flex-1 rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border">
                <tr>
                  <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">CSV Name</th>
                  <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Matched To</th>
                  <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Fields</th>
                  <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {importData?.map((row, i) => (
                  <tr key={i} className={`border-b border-border/30 ${row.matchedProperty ? '' : 'opacity-50'}`}>
                    <td className="py-1.5 px-2">{row.csvName}</td>
                    <td className="py-1.5 px-2 font-medium">{row.matchedProperty?.name || '—'}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{row.changeCount} values</td>
                    <td className="py-1.5 px-2">
                      {row.matchedProperty ? (
                        <span className="text-green-600 dark:text-green-400 flex items-center gap-1"><Check className="w-3 h-3" /> Ready</span>
                      ) : (
                        <span className="text-muted-foreground">No match</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" size="sm" onClick={() => setImportData(null)} disabled={importing}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={executeImport}
              disabled={importing || !importData?.some(r => r.matchedProperty)}
            >
              {importing ? 'Importing…' : `Import ${importData?.filter(r => r.matchedProperty).length} Properties`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
