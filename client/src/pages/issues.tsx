import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { useCleaners } from '@/hooks/use-cleaners'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { TablePagination } from '@/components/TablePagination'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Card, CardContent } from '@/components/ui/card'
import { IssueDetailSheet } from '@/components/IssueDetailSheet'
import {
  Search, X, AlertTriangle, Plus, Download, Upload, ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, MessageSquare,
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
  'Trash Pick Up Request',
  'Hot Tub Servicing',
  'Touch-Up Clean',
  'Other',
]

const STATUSES = ['Needs Attention', 'In Progress', 'Completed']

type SortKey = 'report_date' | 'property_name' | 'category' | 'status'

function StatusBadge({ status }: { status: string }) {
  const cls = {
    'Needs Attention': 'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800',
    'Completed': 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800',
    'In Progress': 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-800',
  }[status] || 'text-gray-600 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-900/20 dark:border-gray-800'
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded border whitespace-nowrap ${cls}`}>{status}</span>
}

function CategoryBadge({ category }: { category: string }) {
  return <span className="text-xs text-muted-foreground">{category}</span>
}

export default function IssuesPage() {
  usePageTitle('Issues')
  const { toast } = useToast()
  const { effectiveUser } = useAuth()
  const qc = useQueryClient()
  const canEdit = canEditView('issues', effectiveUser)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [section, setSection] = useState<'needs_attention' | 'guest_feedback'>('needs_attention')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('report_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [detailIssue, setDetailIssue] = useState<any>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newPhoto, setNewPhoto] = useState<File | null>(null)
  const [importData, setImportData] = useState<any[] | null>(null)
  const [importRunning, setImportRunning] = useState(false)
  const [newForm, setNewForm] = useState({
    report_date: new Date().toISOString().split('T')[0],
    issue_type: 'needs_attention',
    priority: 'normal',
    property_id: '',
    property_name: '',
    category: 'Cleaning Not As Expected',
    last_touch: '',
    details: '',
    assessment: '',
    resolution: '',
    coverage: '',
    status: 'Needs Attention',
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

  const { data: cleaners } = useCleaners()

  const cleanerLookup = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of (cleaners || []) as Array<{ full_name: string | null }>) {
      if (c.full_name) m.set(c.full_name.trim().toLowerCase(), c.full_name)
    }
    return m
  }, [cleaners])

  // ─── Summary stats ────────────────────────────────────────────────────────
  // All counters derive from the same `issues` array so the header subtitle
  // reconciles with the category tiles. Every status is counted so the user
  // can see why total ≠ in_progress + completed.
  const stats = useMemo(() => {
    if (!issues) return {
      total: 0, inProgress: 0, completed: 0, fyi: 0, disregarded: 0,
      byCategory: {} as Record<string, number>,
    }
    const byStatus: Record<string, number> = {}
    const byCategory: Record<string, number> = {}
    for (const i of issues) {
      byStatus[i.status] = (byStatus[i.status] || 0) + 1
      byCategory[i.category] = (byCategory[i.category] || 0) + 1
    }
    return {
      total: issues.length,
      inProgress: byStatus['In Progress'] || 0,
      completed: byStatus['Completed'] || 0,
      fyi: byStatus['Just FYI'] || 0,
      disregarded: byStatus['Disregard'] || 0,
      byCategory,
    }
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
      const matchSection = (i.issue_type || 'needs_attention') === section
      const matchSearch = !search.trim() || [i.property_name, i.details, i.last_touch].some(v => v?.toLowerCase().includes(search.toLowerCase()))
      const matchStatus = statusFilter === 'all' || i.status === statusFilter
      const matchCategory = categoryFilter === 'all' || i.category === categoryFilter
      return matchSection && matchSearch && matchStatus && matchCategory
    })
    result = [...result].sort((a: any, b: any) => {
      // Open urgent issues float to the top of the list.
      const aU = a.priority === 'urgent' && a.status !== 'Completed' ? 0 : 1
      const bU = b.priority === 'urgent' && b.status !== 'Completed' ? 0 : 1
      if (aU !== bU) return aU - bU
      const dir = sortDir === 'asc' ? 1 : -1
      const av = a[sortKey] || ''
      const bv = b[sortKey] || ''
      return av.localeCompare(bv) * dir
    })
    return result
  }, [issues, search, statusFilter, categoryFilter, sortKey, sortDir, section])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  // ─── Mutations ────────────────────────────────────────────────────────────
  const { mutate: addIssue, isPending: adding } = useGuardedMutation('issues', {
    mutationFn: async () => {
      const { data: created, error } = await supabase.from('cleaning_issues').insert({
        report_date: newForm.report_date,
        issue_type: newForm.issue_type,
        priority: newForm.priority,
        property_id: newForm.property_id ? Number(newForm.property_id) : null,
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
      }).select('id').single()
      if (error) throw error
      // Optional initial photo attached at logging time (e.g. the dirty hot tub).
      if (newPhoto && created?.id) {
        try {
          const ext = (newPhoto.name.split('.').pop() || 'jpg').toLowerCase()
          const path = `${created.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
          const up = await supabase.storage.from('issue-photos').upload(path, newPhoto, { contentType: newPhoto.type || 'image/jpeg' })
          if (!up.error) {
            const { data: urlData } = supabase.storage.from('issue-photos').getPublicUrl(path)
            await (supabase as any).from('issue_photos').insert({ issue_id: created.id, photo_url: urlData.publicUrl, photo_path: path, phase: 'initial', uploaded_by: effectiveUser?.label || null, author_type: 'staff' })
          }
        } catch { /* photo is optional — don't fail the issue creation */ }
      }
      try {
        const { notify } = await import('@/lib/notify')
        const trailing = [
          `Status: ${newForm.status}`,
          newForm.last_touch ? `Last touch: ${newForm.last_touch}` : null,
          newForm.coverage ? `Coverage: ${newForm.coverage}` : null,
        ].filter(Boolean) as string[]
        notify({
          eventType: 'issue_logged',
          subject: `New issue: ${newForm.property_name} — ${newForm.category}`,
          bodyLines: [
            `${newForm.property_name} — ${newForm.category}`,
            ...(newForm.details ? [newForm.details] : []),
            trailing.join(' · '),
          ],
          ctaUrl: 'https://www.tendwellcleaning.com/#/issues',
          ctaLabel: 'View Issues',
          meta: { property: newForm.property_name, category: newForm.category },
        })
      } catch { /* ignore */ }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/cleaning-issues'] })
      toast({ title: newForm.issue_type === 'guest_feedback' ? 'Guest feedback logged' : 'Issue logged' })
      setSection(newForm.issue_type === 'guest_feedback' ? 'guest_feedback' : 'needs_attention')
      setAddOpen(false)
      setNewPhoto(null)
      setNewForm({ ...newForm, property_id: '', property_name: '', priority: 'normal', details: '', assessment: '', resolution: '', coverage: '', remarks: '', last_touch: '', slack_link: '' })
    },
    onError: (error: any) => toast({ title: 'Failed to save', description: error?.message, variant: 'destructive' }),
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
    onError: (error: any) => toast({ title: 'Update failed', description: error?.message, variant: 'destructive' }),
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
        const unmatchedCleaners = new Set<string>()
        const rows = (result.data as any[]).map(row => {
          // Map common column names flexibly
          const get = (keys: string[]) => {
            for (const k of keys) {
              const val = row[k] || row[k.toLowerCase()] || row[k.toUpperCase()]
              if (val) return val.trim()
            }
            return ''
          }
          const rawLastTouch = get(['Last Touch', 'LAST TOUCH', 'last_touch'])
          let last_touch = rawLastTouch
          if (rawLastTouch) {
            const canonical = cleanerLookup.get(rawLastTouch.trim().toLowerCase())
            if (canonical) last_touch = canonical
            else unmatchedCleaners.add(rawLastTouch)
          }
          return {
            report_date: get(['Report Date', 'REPORT DATE', 'Date', 'date']) || new Date().toISOString().split('T')[0],
            property_name: get(['Property', 'PROPERTY NAME', 'Property Name', 'property_name']),
            category: get(['Category', 'CATEGORY', 'category']) || 'Other',
            last_touch,
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
        if (unmatchedCleaners.size > 0) {
          const sample = Array.from(unmatchedCleaners).slice(0, 5).join(', ')
          toast({
            title: `${unmatchedCleaners.size} unmatched ${unmatchedCleaners.size === 1 ? 'cleaner' : 'cleaners'} in CSV`,
            description: `These names were preserved as-is: ${sample}${unmatchedCleaners.size > 5 ? '…' : ''}. Add them to the cleaners list so metrics count them.`,
          })
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
            {stats.fyi > 0 && <> · {stats.fyi} FYI</>}
            {stats.disregarded > 0 && <> · {stats.disregarded} disregarded</>}
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
            <>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => { setNewForm(f => ({ ...f, issue_type: 'guest_feedback', priority: 'normal' })); setAddOpen(true) }}>
                <MessageSquare className="w-3.5 h-3.5" /> Guest Feedback
              </Button>
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => { setNewForm(f => ({ ...f, issue_type: 'needs_attention' })); setAddOpen(true) }}>
                <AlertTriangle className="w-3.5 h-3.5" /> Log Issue
              </Button>
            </>
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

      {/* Section tabs — Guest Feedback vs Needs Attention */}
      <div className="flex gap-2">
        {([
          { key: 'needs_attention', label: 'Needs Attention' },
          { key: 'guest_feedback', label: 'Guest Feedback' },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => { setSection(t.key); setPage(1) }}
            className={`px-3 h-8 rounded-md border text-sm transition-colors ${section === t.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted/50'}`}
          >
            {t.label}
          </button>
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
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
            <tr>
              <th className={`${thCls} sticky left-0 top-0 z-30 bg-muted`} onClick={() => toggleSort('property_name')}>Property <SortIcon col="property_name" /></th>
              <th className={thCls} onClick={() => toggleSort('report_date')}>Date <SortIcon col="report_date" /></th>
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
                <td className="py-2 px-3 font-medium text-xs sticky left-0 z-10 bg-background">
                  {issue.priority === 'urgent' && issue.status !== 'Completed' && <span className="mr-1 text-[10px] font-semibold text-red-600 dark:text-red-400">⚠ URGENT</span>}
                  {issue.property_name}
                </td>
                <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(issue.report_date), 'MMM d, yyyy')}</td>
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

      {/* Detail Sheet — CRM: info, comments, photos, status */}
      <IssueDetailSheet
        issue={detailIssue}
        canEdit={canEdit}
        onClose={() => setDetailIssue(null)}
        onChanged={() => qc.invalidateQueries({ queryKey: ['/supabase/cleaning-issues'] })}
      />

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
            <SheetTitle className="text-base flex items-center gap-2">
              {newForm.issue_type === 'guest_feedback'
                ? <><MessageSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" /> Log Guest Feedback</>
                : <><AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" /> Log Issue</>}
            </SheetTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {newForm.issue_type === 'guest_feedback'
                ? 'Retroactive guest feedback for the record — document what was reported, found, and resolved.'
                : 'Something that needs fixing. After saving, copy the share link to send it to a cleaner.'}
            </p>
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
            {newForm.issue_type === 'needs_attention' && (
              <label className="flex items-center gap-2 text-sm rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-900/10 px-3 h-10 cursor-pointer">
                <input type="checkbox" checked={newForm.priority === 'urgent'} onChange={e => setNewForm(f => ({ ...f, priority: e.target.checked ? 'urgent' : 'normal' }))} className="h-4 w-4 rounded border-input" />
                <span className="font-medium">Mark urgent</span>
                <span className="text-xs text-muted-foreground">— needs fixing right away</span>
              </label>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Property</label>
              <select value={newForm.property_id} onChange={e => {
                const id = e.target.value
                const name = (properties || []).find((p: any) => String(p.id) === id)?.name || ''
                setNewForm(f => ({ ...f, property_id: id, property_name: name }))
              }} className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background">
                <option value="">Select property…</option>
                {(properties || []).map((p: any) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Category</label>
              <select value={newForm.category} onChange={e => setNewForm(f => ({ ...f, category: e.target.value }))} className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Last Touch (person responsible) — optional</label>
              <select
                value={newForm.last_touch}
                onChange={e => setNewForm(f => ({ ...f, last_touch: e.target.value }))}
                className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background"
              >
                <option value="">Select cleaner…</option>
                {(cleaners || []).map((c: any) => (
                  <option key={c.id} value={c.full_name}>{c.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Details</label>
              <textarea value={newForm.details} onChange={e => setNewForm(f => ({ ...f, details: e.target.value }))} className="w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" placeholder="Describe the issue…" />
            </div>
            {newForm.issue_type === 'guest_feedback' && (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Assessment</label>
                  <textarea value={newForm.assessment} onChange={e => setNewForm(f => ({ ...f, assessment: e.target.value }))} className="w-full h-16 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" placeholder="What was found…" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Resolution</label>
                  <textarea value={newForm.resolution} onChange={e => setNewForm(f => ({ ...f, resolution: e.target.value }))} className="w-full h-16 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" placeholder="How was it resolved…" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Coverage</label>
                  <select value={newForm.coverage} onChange={e => setNewForm(f => ({ ...f, coverage: e.target.value }))} className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background">
                    <option value="">N/A</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </div>
              </>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Remarks</label>
              <Input value={newForm.remarks} onChange={e => setNewForm(f => ({ ...f, remarks: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Slack Link</label>
              <Input value={newForm.slack_link} onChange={e => setNewForm(f => ({ ...f, slack_link: e.target.value }))} className="h-8 text-sm" placeholder="https://tendwell.slack.com/..." />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Initial photo (optional)</label>
              {newPhoto ? (
                <div className="flex items-center gap-2 text-sm rounded-md border border-border px-3 h-9">
                  <span className="truncate flex-1">{newPhoto.name}</span>
                  <button type="button" onClick={() => setNewPhoto(null)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" className="h-9 text-xs gap-1.5 w-full" onClick={() => {
                  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'
                  input.onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) setNewPhoto(f) }
                  input.click()
                }}>
                  <Upload className="w-3.5 h-3.5" /> Add a photo (e.g. the dirty hot tub)
                </Button>
              )}
            </div>
            <Button className="w-full h-10" disabled={!newForm.property_name || !newForm.details || adding} onClick={() => addIssue()}>
              {adding ? 'Saving…' : (newForm.issue_type === 'guest_feedback' ? 'Save Feedback' : 'Log Issue')}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
