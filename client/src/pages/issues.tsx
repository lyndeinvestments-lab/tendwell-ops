import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { supabase } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { useCleaners } from '@/hooks/use-cleaners'
import { resizeImageFile } from '@/lib/resize-image'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { TablePagination } from '@/components/TablePagination'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { IssueDetailSheet } from '@/components/IssueDetailSheet'
import { IssuesTable, type SortKey } from '@/components/issues/IssuesTable'
import { IssueCard } from '@/components/issues/IssueCard'
import { IssueFilters } from '@/components/issues/IssueFilters'
import { IssueSummaryStrip } from '@/components/issues/IssueSummaryStrip'
import { AddIssueSheet, type NewIssueForm } from '@/components/issues/AddIssueSheet'
import { ISSUE_STATUS_TONES, floatsToTop, type Issue } from '@/lib/issues'
import {
  AlertTriangle, Download, Upload, MessageSquare,
} from 'lucide-react'
import Papa from 'papaparse'

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
  const [detailIssue, setDetailIssue] = useState<Issue | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newPhoto, setNewPhoto] = useState<File | null>(null)
  const [importData, setImportData] = useState<any[] | null>(null)
  const [importRunning, setImportRunning] = useState(false)
  const [newForm, setNewForm] = useState<NewIssueForm>({
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
  // Reads go through the `issue_catchup_feed` view (same columns as
  // `cleaning_issues` + activity_at/is_unread/last_read_at/marked_unread).
  // Writes (insert/update below) still go to `cleaning_issues` directly.
  const { data: issues, isLoading, isError, refetch } = useQuery({
    queryKey: ['/supabase/cleaning-issues'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('issue_catchup_feed')
        .select('*')
        .order('report_date', { ascending: false })
      if (error) throw error
      return (data || []) as unknown as Issue[]
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
  // reconciles with the category tiles.
  const stats = useMemo(() => {
    if (!issues) return {
      total: 0, inProgress: 0, completed: 0,
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
      byCategory,
    }
  }, [issues])

  // ─── Filtering & sorting ──────────────────────────────────────────────────
  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'report_date' ? 'desc' : 'asc') }
  }

  const filtered = useMemo(() => {
    if (!issues) return []
    let result = issues.filter((i) => {
      const matchSection = (i.issue_type || 'needs_attention') === section
      const matchSearch = !search.trim() || [i.property_name, i.details, i.last_touch].some(v => v?.toLowerCase().includes(search.toLowerCase()))
      const matchStatus = statusFilter === 'all' || i.status === statusFilter
      const matchCategory = categoryFilter === 'all' || i.category === categoryFilter
      return matchSection && matchSearch && matchStatus && matchCategory
    })
    result = [...result].sort((a, b) => {
      // Open urgent/high issues float to the top of the list.
      const aTop = floatsToTop(a) ? 0 : 1
      const bTop = floatsToTop(b) ? 0 : 1
      if (aTop !== bTop) return aTop - bTop
      const dir = sortDir === 'asc' ? 1 : -1
      const av = (a as any)[sortKey] || ''
      const bv = (b as any)[sortKey] || ''
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
          const photoFile = await resizeImageFile(newPhoto)
          const ext = (photoFile.name.split('.').pop() || 'jpg').toLowerCase()
          const path = `${created.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
          const up = await supabase.storage.from('issue-photos').upload(path, photoFile, { contentType: photoFile.type || 'image/jpeg' })
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
          ctaUrl: 'https://app.tendwellcleaningco.com/#/issues',
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
      setNewForm(f => ({ ...f, property_id: '', property_name: '', priority: 'normal', details: '', assessment: '', resolution: '', coverage: '', remarks: '', last_touch: '', slack_link: '' }))
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
    const rows = filtered.map((i) => ({
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

  return (
    <PageContainer className="md:h-full md:flex md:flex-col">
      {/* Header */}
      <PageHeader
        title="Issues Tracker"
        subtitle={
          <>
            {stats.total} total · <span className="text-warning">{stats.inProgress} in progress</span> · {stats.completed} completed
          </>
        }
        actions={
          <>
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
          </>
        }
      />

      {/* Summary cards */}
      <IssueSummaryStrip byCategory={stats.byCategory} onSelectCategory={(cat) => { setCategoryFilter(cat); setPage(1) }} />

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
      <IssueFilters
        search={search}
        onSearchChange={v => { setSearch(v); setPage(1) }}
        statusFilter={statusFilter}
        onStatusChange={v => { setStatusFilter(v); setPage(1) }}
        categoryFilter={categoryFilter}
        onCategoryChange={v => { setCategoryFilter(v); setPage(1) }}
      />

      {/* Mobile/desktop dual render — same `filtered`/`paged` arrays, no useIsMobile branching. */}
      {isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <>
          <div className="md:hidden space-y-3">
            {isLoading ? (
              [...Array(6)].map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
            ) : filtered.length === 0 ? (
              <EmptyState icon={AlertTriangle} title="No issues" description={search || statusFilter !== 'all' || categoryFilter !== 'all' ? 'No issues match your filters.' : 'No cleaning issues logged yet.'} />
            ) : (
              paged.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  canEdit={canEdit}
                  onOpen={setDetailIssue}
                  onStatusChange={updateStatus}
                />
              ))
            )}
          </div>

          <div className="hidden md:flex md:flex-col md:flex-1 md:min-h-0">
            <IssuesTable
              issues={paged}
              isLoading={isLoading}
              canEdit={canEdit}
              search={search}
              statusFilter={statusFilter}
              categoryFilter={categoryFilter}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={toggleSort}
              onRowClick={setDetailIssue}
              onStatusChange={updateStatus}
            />
          </div>
        </>
      )}

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
                    <StatusBadge status={row.status} tone={ISSUE_STATUS_TONES[row.status] ?? 'neutral'} />
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
      <AddIssueSheet
        open={addOpen}
        onOpenChange={v => !v && setAddOpen(false)}
        newForm={newForm}
        setNewForm={setNewForm}
        properties={properties as any}
        cleaners={cleaners}
        newPhoto={newPhoto}
        setNewPhoto={setNewPhoto}
        adding={adding}
        onSubmit={() => addIssue()}
      />
    </PageContainer>
  )
}
