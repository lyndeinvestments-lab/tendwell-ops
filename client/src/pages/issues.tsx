import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { TablePagination } from '@/components/TablePagination'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Card, CardContent } from '@/components/ui/card'
import {
  Search, X, AlertTriangle, Plus, Download, Upload, ArrowUpDown, ArrowUp, ArrowDown, ExternalLink,
} from 'lucide-react'
import { format } from 'date-fns'
import Papa from 'papaparse'

const CATEGORIES = [
  'Cleaning Not As Expected',
  'Missed Clean',
  'Service Not As Expected',
  'Linen/Towel issue',
  'Foul Smell / Odor',
  'Damage/Loss',
  'Guest Related',
  'Other',
]

const STATUSES = ['In Progress', 'Completed', 'Just FYI', 'Disregard']

type SortKey = 'report_date' | 'property_name' | 'category' | 'status'

function StatusBadge({ status }: { status: string }) {
  const cls = {
    'Completed': 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800',
    'In Progress': 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-800',
    'Just FYI': 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-900/20 dark:border-blue-800',
    'Disregard': 'text-gray-600 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-900/20 dark:border-gray-800',
  }[status] || 'text-gray-600 bg-gray-50 border-gray-200'
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded border whitespace-nowrap ${cls}`}>{status}</span>
}

function CategoryBadge({ category }: { category: string }) {
  const short = category === 'Cleaning Not As Expected' ? 'Cleaning Quality' :
    category === 'Service Not As Expected' ? 'Service' :
    category === 'Foul Smell / Odor' ? 'Odor' :
    category === 'Linen/Towel issue' ? 'Linen/Towel' :
    category === 'Damage/Loss' ? 'Damage' :
    category
  return <span className="text-xs text-muted-foreground">{short}</span>
}

export default function IssuesPage() {
  usePageTitle('Issues')
  const { toast } = useToast()
  const { effectiveUser } = useAuth()
  const qc = useQueryClient()
  const canEdit = canEditView('issues', effectiveUser)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('report_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [detailIssue, setDetailIssue] = useState<any>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [importData, setImportData] = useState<any[] | null>(null)
  const [importRunning, setImportRunning] = useState(false)
  const [newForm, setNewForm] = useState({
    report_date: new Date().toISOString().split('T')[0],
    property_name: '',
    category: 'Cleaning Not As Expected',
    last_touch: '',
    details: '',
    assessment: '',
    resolution: '',
    coverage: '',
    status: 'In Progress',
    remarks: '',
    slack_link: '',
  })

  // ─── Queries ──────────────────────────────────────────────────────────────
  const { data: issues, isLoading } = useQuery({
    queryKey: ['/supabase/cleaning-issues'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cleaning_issues')
        .select('*')
        .order('report_date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: properties } = useQuery({
    queryKey: ['/supabase/issues-properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name')
        .order('name')
      if (error) throw error
      return data || []
    },
    enabled: addOpen,
  })

  // ─── Summary stats ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!issues) return { total: 0, inProgress: 0, completed: 0, byCategory: {} as Record<string, number> }
    const inProgress = issues.filter((i: any) => i.status === 'In Progress').length
    const completed = issues.filter((i: any) => i.status === 'Completed').length
    const byCategory: Record<string, number> = {}
    for (const i of issues) {
      byCategory[i.category] = (byCategory[i.category] || 0) + 1
    }
    return { total: issues.length, inProgress, completed, byCategory }
  }, [issues])

  // ─── Filtering & sorting ──────────────────────────────────────────────────
  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'report_date' ? 'desc' : 'asc') }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 inline ml-1 opacity-40" />
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3 inline ml-1" /> : <ArrowDown className="w-3 h-3 inline ml-1" />
  }

  const filtered = useMemo(() => {
    if (!issues) return []
    let result = issues.filter((i: any) => {
      const matchSearch = !search.trim() || [i.property_name, i.details, i.last_touch].some(v => v?.toLowerCase().includes(search.toLowerCase()))
      const matchStatus = statusFilter === 'all' || i.status === statusFilter
      const matchCategory = categoryFilter === 'all' || i.category === categoryFilter
      return matchSearch && matchStatus && matchCategory
    })
    result = [...result].sort((a: any, b: any) => {
      const dir = sortDir === 'asc' ? 1 : -1
      const av = a[sortKey] || ''
      const bv = b[sortKey] || ''
      return av.localeCompare(bv) * dir
    })
    return result
  }, [issues, search, statusFilter, categoryFilter, sortKey, sortDir])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  // ─── Mutations ────────────────────────────────────────────────────────────
  const { mutate: addIssue, isPending: adding } = useGuardedMutation('issues', {
    mutationFn: async () => {
      const { error } = await supabase.from('cleaning_issues').insert({
        report_date: newForm.report_date,
        property_name: newForm.property_name,
        category: newForm.category,
        last_touch: newForm.last_touch || null,
        details: newForm.details || null,
        assessment: newForm.assessment || null,
        resolution: newForm.resolution || null,
        coverage: newForm.coverage || null,
        status: newForm.status,
        remarks: newForm.remarks || null,
        slack_link: newForm.slack_link || null,
        created_by: effectiveUser?.label || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/cleaning-issues'] })
      toast({ title: 'Issue logged' })
      setAddOpen(false)
      setNewForm({ ...newForm, property_name: '', details: '', assessment: '', resolution: '', coverage: '', remarks: '', last_touch: '', slack_link: '' })
    },
    onError: () => toast({ title: 'Failed to save', variant: 'destructive' }),
  })

  const { mutate: updateStatus } = useGuardedMutation('issues', {
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('cleaning_issues').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/cleaning-issues'] })
      toast({ title: 'Status updated' })
    },
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  })

  function exportCsv() {
    if (!filtered.length) return
    const rows = filtered.map((i: any) => ({
      'Report Date': i.report_date,
      'Property': i.property_name,
      'Category': i.category,
      'Last Touch': i.last_touch || '',
      'Details': i.details || '',
      'Assessment': i.assessment || '',
      'Resolution': i.resolution || '',
      'Coverage': i.coverage || '',
      'Status': i.status,
      'Remarks': i.remarks || '',
      'Slack Link': i.slack_link || '',
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `cleaning-issues-${new Date().toISOString().split('T')[0]}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  function handleImportFile(file: File) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (!result.data?.length) {
          toast({ title: 'No data found in CSV', variant: 'destructive' })
          return
        }
        const rows = (result.data as any[]).map(row => {
          // Map common column names flexibly
          const get = (keys: string[]) => {
            for (const k of keys) {
              const val = row[k] || row[k.toLowerCase()] || row[k.toUpperCase()]
              if (val) return val.trim()
            }
            return ''
          }
          return {
            report_date: get(['Report Date', 'REPORT DATE', 'Date', 'date']) || new Date().toISOString().split('T')[0],
            property_name: get(['Property', 'PROPERTY NAME', 'Property Name', 'property_name']),
            category: get(['Category', 'CATEGORY', 'category']) || 'Other',
            last_touch: get(['Last Touch', 'LAST TOUCH', 'last_touch']),
            details: get(['Details', 'DETAILS', 'details']),
            assessment: get(['Assessment', 'ASSESSMENT', 'assessment']),
            resolution: get(['Resolution', 'RESOLUTION', 'resolution']),
            coverage: get(['Coverage', 'COVERAGE', 'coverage']),
            status: get(['Status', 'STATUS', 'status']) || 'In Progress',
            slack_link: get(['Slack Link', 'slack_link', 'Slack']),
            remarks: get(['Remarks', 'REMARKS', 'remarks']),
          }
        }).filter(r => r.property_name && r.details)

        if (rows.length === 0) {
          toast({ title: 'No valid issues found in CSV', variant: 'destructive' })
          return
        }
        setImportData(rows)
      },
      error: () => toast({ title: 'Failed to parse CSV', variant: 'destructive' }),
    })
  }

  async function executeImport() {
    if (!importData) return
    setImportRunning(true)
    let imported = 0
    for (const row of importData) {
      const { error } = await supabase.from('cleaning_issues').insert({
        ...row,
        created_by: effectiveUser?.label || null,
      })
      if (!error) imported++
    }
    qc.invalidateQueries({ queryKey: ['/supabase/cleaning-issues'] })
    toast({ title: `Imported ${imported} issues` })
    setImportData(null)
    setImportRunning(false)
  }

  const thCls = 'text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap'

  return (
    <div className="p-5 h-full flex flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Issues Tracker</h1>
          <p className="text-sm text-muted-foreground">
            {stats.total} total · <span className="text-amber-600 dark:text-amber-400">{stats.inProgress} in progress</span> · {stats.completed} completed
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
          {canEdit && (
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
                  if (file) handleImportFile(file)
                }
                input.click()
              }}
            >
              <Upload className="w-3.5 h-3.5" /> Import CSV
            </Button>
          )}
          {canEdit && (
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> Log Issue
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([cat, count]) => (
          <Card key={cat} className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => { setCategoryFilter(cat); setPage(1) }}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground truncate">{cat}</p>
              <p className="text-lg font-semibold">{count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} className="h-8 text-xs border border-input rounded-md px-2 bg-background">
          <option value="all">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }} className="h-8 text-xs border border-input rounded-md px-2 bg-background">
          <option value="all">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input type="search" placeholder="Search…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} className="pl-8 pr-7 h-8 w-full sm:w-56 text-sm" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted border-b border-border z-10">
            <tr>
              <th className={thCls} onClick={() => toggleSort('report_date')}>Date <SortIcon col="report_date" /></th>
              <th className={`${thCls} sticky left-0 z-20 bg-muted`} onClick={() => toggleSort('property_name')}>Property <SortIcon col="property_name" /></th>
              <th className={thCls} onClick={() => toggleSort('category')}>Category <SortIcon col="category" /></th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Last Touch</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap min-w-[250px]">Details</th>
              <th className={thCls} onClick={() => toggleSort('status')}>Status <SortIcon col="status" /></th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Slack</th>
              {canEdit && <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Action</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => <tr key={i} className="border-b border-border/50">{[...Array(canEdit ? 8 : 7)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}</tr>)
            ) : filtered.length === 0 ? (
              <tr><td colSpan={canEdit ? 8 : 7}><EmptyState icon={AlertTriangle} title="No issues" description={search || statusFilter !== 'all' || categoryFilter !== 'all' ? 'No issues match your filters.' : 'No cleaning issues logged yet.'} /></td></tr>
            ) : paged.map((issue: any) => (
              <tr
                key={issue.id}
                className={`border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer ${issue.status === 'In Progress' ? 'bg-amber-50/30 dark:bg-amber-900/5' : ''}`}
                onClick={() => setDetailIssue(issue)}
              >
                <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(issue.report_date), 'MMM d, yyyy')}</td>
                <td className="py-2 px-3 font-medium text-xs sticky left-0 z-10 bg-background">{issue.property_name}</td>
                <td className="py-2 px-3"><CategoryBadge category={issue.category} /></td>
                <td className="py-2 px-3 text-xs text-muted-foreground">{issue.last_touch || '—'}</td>
                <td className="py-2 px-3 text-xs max-w-[300px] truncate">{issue.details || '—'}</td>
                <td className="py-2 px-3"><StatusBadge status={issue.status} /></td>
                <td className="py-2 px-3" onClick={e => e.stopPropagation()}>
                  {issue.slack_link ? (
                    <a href={issue.slack_link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1 text-xs">
                      <ExternalLink className="w-3 h-3" /> Link
                    </a>
                  ) : <span className="text-muted-foreground text-xs">—</span>}
                </td>
                {canEdit && (
                  <td className="py-2 px-3" onClick={e => e.stopPropagation()}>
                    <select
                      value={issue.status}
                      onChange={e => updateStatus({ id: issue.id, status: e.target.value })}
                      className="h-6 text-xs border border-input rounded px-1 bg-background"
                    >
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      {/* Detail Sheet */}
      <Sheet open={!!detailIssue} onOpenChange={v => !v && setDetailIssue(null)}>
        <SheetContent side="right" className="w-full sm:w-[480px] overflow-y-auto">
          {detailIssue && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base">{detailIssue.property_name}</SheetTitle>
                <div className="flex items-center gap-2 mt-1">
                  <StatusBadge status={detailIssue.status} />
                  <span className="text-xs text-muted-foreground">{format(new Date(detailIssue.report_date), 'MMMM d, yyyy')}</span>
                </div>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                {[
                  { label: 'Category', value: detailIssue.category },
                  { label: 'Last Touch', value: detailIssue.last_touch },
                  { label: 'Details', value: detailIssue.details },
                  { label: 'Assessment', value: detailIssue.assessment },
                  { label: 'Resolution', value: detailIssue.resolution },
                  { label: 'Coverage', value: detailIssue.coverage },
                  { label: 'Remarks', value: detailIssue.remarks },
                  { label: 'Slack Link', value: detailIssue.slack_link, isLink: true },
                ].map((row: any) => row.value ? (
                  <div key={row.label}>
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">{row.label}</span>
                    {row.isLink ? (
                      <a href={row.value} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
                        <ExternalLink className="w-3.5 h-3.5" /> Open in Slack
                      </a>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{row.value}</p>
                    )}
                  </div>
                ) : null)}
                {canEdit && (
                  <div className="pt-2 border-t border-border">
                    <span className="text-xs font-medium text-muted-foreground block mb-1">Update Status</span>
                    <select
                      value={detailIssue.status}
                      onChange={e => {
                        updateStatus({ id: detailIssue.id, status: e.target.value })
                        setDetailIssue({ ...detailIssue, status: e.target.value })
                      }}
                      className="h-8 text-sm border border-input rounded-md px-2 bg-background w-full"
                    >
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Import Preview Sheet */}
      {importData && (
        <Sheet open={true} onOpenChange={v => !v && !importRunning && setImportData(null)}>
          <SheetContent side="right" className="w-full sm:w-[480px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Import {importData.length} Issues</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-2 max-h-[60vh] overflow-y-auto">
              {importData.map((row, i) => (
                <div key={i} className="rounded-md border border-border p-2 text-xs">
                  <div className="font-medium">{row.property_name}</div>
                  <div className="text-muted-foreground truncate">{row.details}</div>
                  <div className="flex gap-2 mt-1">
                    <StatusBadge status={row.status} />
                    <span className="text-muted-foreground">{row.category}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" onClick={() => setImportData(null)} disabled={importRunning}>Cancel</Button>
              <Button className="flex-1" onClick={executeImport} disabled={importRunning}>
                {importRunning ? 'Importing…' : `Import ${importData.length} Issues`}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Add Issue Sheet */}
      <Sheet open={addOpen} onOpenChange={v => !v && setAddOpen(false)}>
        <SheetContent side="right" className="w-full sm:w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Log New Issue</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Report Date</label>
                <Input type="date" value={newForm.report_date} onChange={e => setNewForm(f => ({ ...f, report_date: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
                <select value={newForm.status} onChange={e => setNewForm(f => ({ ...f, status: e.target.value }))} className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background">
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Property</label>
              <select value={newForm.property_name} onChange={e => setNewForm(f => ({ ...f, property_name: e.target.value }))} className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background">
                <option value="">Select property…</option>
                {(properties || []).map((p: any) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Category</label>
              <select value={newForm.category} onChange={e => setNewForm(f => ({ ...f, category: e.target.value }))} className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Last Touch (person responsible)</label>
              <Input value={newForm.last_touch} onChange={e => setNewForm(f => ({ ...f, last_touch: e.target.value }))} className="h-8 text-sm" placeholder="Name…" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Details</label>
              <textarea value={newForm.details} onChange={e => setNewForm(f => ({ ...f, details: e.target.value }))} className="w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" placeholder="Describe the issue…" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Assessment</label>
              <textarea value={newForm.assessment} onChange={e => setNewForm(f => ({ ...f, assessment: e.target.value }))} className="w-full h-16 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" placeholder="What was found…" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Resolution</label>
              <textarea value={newForm.resolution} onChange={e => setNewForm(f => ({ ...f, resolution: e.target.value }))} className="w-full h-16 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" placeholder="How was it resolved…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Coverage</label>
                <select value={newForm.coverage} onChange={e => setNewForm(f => ({ ...f, coverage: e.target.value }))} className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background">
                  <option value="">N/A</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Remarks</label>
                <Input value={newForm.remarks} onChange={e => setNewForm(f => ({ ...f, remarks: e.target.value }))} className="h-8 text-sm" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Slack Link</label>
              <Input value={newForm.slack_link} onChange={e => setNewForm(f => ({ ...f, slack_link: e.target.value }))} className="h-8 text-sm" placeholder="https://tendwell.slack.com/..." />
            </div>
            <Button className="w-full h-10" disabled={!newForm.property_name || !newForm.details || adding} onClick={() => addIssue()}>
              {adding ? 'Saving…' : 'Log Issue'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
