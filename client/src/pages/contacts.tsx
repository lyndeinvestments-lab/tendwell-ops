import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, logActivity } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { EmptyState } from '@/components/EmptyState'
import { ContactModal } from '@/components/ContactModal'
import { TablePagination } from '@/components/TablePagination'
import { Search, Plus, X, Download, BarChart3, Users, ArrowUpDown, ArrowUp, ArrowDown, Import, GitMerge } from 'lucide-react'
import Papa from 'papaparse'
import { format } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts'

const SOURCE_OPTIONS = ['Referral', 'Google', 'Cold Outreach', 'Trade Show', 'Social Media', 'Word of Mouth', 'Other']
const PAYMENT_OPTIONS = ['Ramp', 'Bill.com', 'QuickBooks', 'Check', 'ACH', 'Other']
const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6b7280', '#14b8a6']

type SortKey = 'full_name' | 'company' | 'email' | 'phone' | 'source' | 'payment_method' | 'client_since' | 'properties' | 'tags'
type SortDir = 'asc' | 'desc'

function SortHeader({ label, sortKey, currentSort, currentDir, onSort }: {
  label: string; sortKey: SortKey; currentSort: SortKey; currentDir: SortDir; onSort: (k: SortKey) => void
}) {
  const active = currentSort === sortKey
  return (
    <th
      className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors group"
      onClick={() => onSort(sortKey)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(sortKey) } }}
      tabIndex={0}
      role="columnheader"
      aria-sort={active ? (currentDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="flex items-center gap-1">
        {label}
        {active ? (
          currentDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
        )}
      </span>
    </th>
  )
}

export default function ContactsPage() {
  const { toast } = useToast()
  usePageTitle('Clients')
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState(() => {
    try { return localStorage.getItem('contacts_source_filter') || 'all' } catch { return 'all' }
  })
  const [paymentFilter, setPaymentFilter] = useState(() => {
    try { return localStorage.getItem('contacts_payment_filter') || 'all' } catch { return 'all' }
  })
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    try { return (localStorage.getItem('contacts_sort_key') as SortKey) || 'full_name' } catch { return 'full_name' }
  })
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    try { return (localStorage.getItem('contacts_sort_dir') as SortDir) || 'asc' } catch { return 'asc' }
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [modalContactId, setModalContactId] = useState<string | null>(null)
  const [modalMode, setModalMode] = useState<'view' | 'create'>('view')
  const [modalOpen, setModalOpen] = useState(false)
  const [sourceReportOpen, setSourceReportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)

  const { data: contacts, isLoading } = useQuery({
    queryKey: ['/supabase/contacts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('*, properties(id)')
      if (error) throw error
      return data || []
    },
  })

  function handleSort(key: SortKey) {
    const newDir = sortKey === key && sortDir === 'asc' ? 'desc' : 'asc'
    setSortKey(key)
    setSortDir(newDir)
    try {
      localStorage.setItem('contacts_sort_key', key)
      localStorage.setItem('contacts_sort_dir', newDir)
    } catch {}
  }

  const filtered = useMemo(() => {
    if (!contacts) return []
    let result = contacts.filter((c: any) => {
      const q = search.toLowerCase()
      const matchSearch = !q || (c.full_name?.toLowerCase().includes(q) || c.company?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q))
      const matchSource = sourceFilter === 'all' || c.source === sourceFilter
      const matchPayment = paymentFilter === 'all' || c.payment_method === paymentFilter
      return matchSearch && matchSource && matchPayment
    })

    result.sort((a: any, b: any) => {
      let cmp = 0
      if (sortKey === 'full_name') {
        cmp = (a.full_name || '').localeCompare(b.full_name || '')
      } else if (sortKey === 'company') {
        cmp = (a.company || '').localeCompare(b.company || '')
      } else if (sortKey === 'email') {
        cmp = (a.email || '').localeCompare(b.email || '')
      } else if (sortKey === 'phone') {
        cmp = (a.phone || '').localeCompare(b.phone || '')
      } else if (sortKey === 'source') {
        cmp = (a.source || '').localeCompare(b.source || '')
      } else if (sortKey === 'payment_method') {
        cmp = (a.payment_method || '').localeCompare(b.payment_method || '')
      } else if (sortKey === 'client_since') {
        cmp = (a.client_since || '').localeCompare(b.client_since || '')
      } else if (sortKey === 'properties') {
        cmp = (a.properties?.length || 0) - (b.properties?.length || 0)
      } else if (sortKey === 'tags') {
        const aLen = (a.tags || []).length
        const bLen = (b.tags || []).length
        if (aLen !== bLen) cmp = aLen - bLen
        else cmp = (a.tags?.[0] || '').localeCompare(b.tags?.[0] || '')
      }
      return sortDir === 'desc' ? -cmp : cmp
    })

    return result
  }, [contacts, search, sourceFilter, paymentFilter, sortKey, sortDir])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  function openContact(id: string) {
    setModalContactId(id)
    setModalMode('view')
    setModalOpen(true)
  }

  function openCreateContact() {
    setModalContactId(null)
    setModalMode('create')
    setModalOpen(true)
  }

  function exportCsv() {
    const rows = filtered.map((c: any) => ({
      Name: c.full_name || '',
      Company: c.company || '',
      Email: c.email || '',
      Phone: c.phone || '',
      Source: c.source || '',
      'Payment Method': c.payment_method || '',
      'Client Since': c.client_since || '',
      Properties: c.properties?.length || 0,
      Tags: (c.tags || []).join(', '),
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `contacts-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: `Exported ${rows.length} contacts` })
  }

  // Source report data
  const sourceReportData = useMemo(() => {
    if (!contacts) return []
    const map: Record<string, { total: number; withProperties: number }> = {}
    for (const c of contacts) {
      const src = c.source || 'Unknown'
      if (!map[src]) map[src] = { total: 0, withProperties: 0 }
      map[src].total++
      if (c.properties && c.properties.length > 0) map[src].withProperties++
    }
    return Object.entries(map)
      .map(([source, data]) => ({ source, ...data, conversion: data.total > 0 ? Math.round((data.withProperties / data.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total)
  }, [contacts])

  return (
    <div className="p-5 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Clients</h1>
          <p className="text-sm text-muted-foreground">Manage clients and relationships</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search name, company, email…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              data-testid="input-search-contacts"
              className="pl-8 pr-7 h-8 w-64 text-sm"
            />
            {search && (
              <button onClick={() => { setSearch(''); setPage(1) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Select value={sourceFilter} onValueChange={v => { setSourceFilter(v); setPage(1); try { localStorage.setItem('contacts_source_filter', v) } catch {} }}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="All Sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              {SOURCE_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={paymentFilter} onValueChange={v => { setPaymentFilter(v); setPage(1); try { localStorage.setItem('contacts_payment_filter', v) } catch {} }}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="All Payments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Payments</SelectItem>
              {PAYMENT_OPTIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => setSourceReportOpen(true)}>
                <BarChart3 className="w-3.5 h-3.5" /> Source Report
              </Button>
            </TooltipTrigger>
            <TooltipContent>View breakdown of how clients were sourced</TooltipContent>
          </Tooltip>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => setImportOpen(true)}>
            <Import className="w-3.5 h-3.5" /> Import from Properties
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => setDuplicateOpen(true)} disabled={filtered.length === 0}>
            <GitMerge className="w-3.5 h-3.5" /> Find Duplicates
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1" onClick={openCreateContact} data-testid="button-add-contact">
            <Plus className="w-3.5 h-3.5" /> Add Client
          </Button>
        </div>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <SortHeader label="Name" sortKey="full_name" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Company" sortKey="company" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Email" sortKey="email" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Phone" sortKey="phone" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Source" sortKey="source" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Payment" sortKey="payment_method" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Client Since" sortKey="client_since" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Properties" sortKey="properties" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Tags" sortKey="tags" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(9)].map((_, j) => (
                    <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : paged.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  {contacts && contacts.length === 0 ? (
                    <EmptyState
                      icon={Users}
                      title="No clients yet"
                      description="Import clients from your existing properties, or add one manually."
                      action={{ label: 'Import from Properties', onClick: () => setImportOpen(true) }}
                    />
                  ) : (
                    <div className="text-center py-12 text-muted-foreground text-sm">No clients match your filters</div>
                  )}
                </td>
              </tr>
            ) : (
              paged.map((c: any) => (
                <tr
                  key={c.id}
                  onClick={() => openContact(c.id)}
                  className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                  data-testid={`row-contact-${c.id}`}
                >
                  <td className="py-2 px-3 font-medium text-xs">{c.full_name}</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{c.company || '—'}</td>
                  <td className="py-2 px-3 text-xs">
                    {c.email ? (
                      <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()} className="text-primary hover:underline">{c.email}</a>
                    ) : '—'}
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{c.phone || '—'}</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{c.source || '—'}</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{c.payment_method || '—'}</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{c.client_since ? format(new Date(c.client_since + 'T00:00:00'), 'MMM d, yyyy') : '—'}</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{c.properties?.length || 0}</td>
                  <td className="py-2 px-3 text-xs">
                    {(c.tags || []).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((t: string) => (
                          <span key={t} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-xs">{t}</span>
                        ))}
                        {c.tags.length > 3 && <span className="text-xs text-muted-foreground">+{c.tags.length - 3}</span>}
                      </div>
                    ) : '—'}
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

      <ContactModal
        contactId={modalContactId}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        mode={modalMode}
      />

      {/* Source Report Modal */}
      <Dialog open={sourceReportOpen} onOpenChange={setSourceReportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Contact Source Report</DialogTitle>
          </DialogHeader>
          {sourceReportData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No contacts to report on</p>
          ) : (
            <div className="space-y-4">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sourceReportData} layout="vertical" margin={{ left: 80 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="source" tick={{ fontSize: 11 }} width={75} />
                    <RechartsTooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="total" name="Clients" radius={[0, 4, 4, 0]}>
                      {sourceReportData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Source</th>
                      <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Total</th>
                      <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">With Properties</th>
                      <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Conversion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceReportData.map(row => (
                      <tr key={row.source} className="border-t border-border/50">
                        <td className="py-1.5 px-2">{row.source}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{row.total}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{row.withProperties}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{row.conversion}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Import from Properties Modal */}
      <ImportFromPropertiesModal open={importOpen} onClose={() => setImportOpen(false)} />

      {/* Duplicate Detection Modal */}
      <DuplicateDetectionModal open={duplicateOpen} onClose={() => setDuplicateOpen(false)} contacts={contacts || []} />
    </div>
  )
}

// ── Import from Properties ──────────────────────────────────────────────
function ImportFromPropertiesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  const { data: unlinkedClients } = useQuery({
    queryKey: ['/supabase/unlinked-clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('client')
        .is('contact_id', null)
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const p of (data || [])) {
        const name = p.client?.trim()
        if (name) counts[name] = (counts[name] || 0) + 1
      }
      return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name))
    },
    enabled: open,
  })

  async function handleImport() {
    if (selected.size === 0) return
    setImporting(true)
    try {
      let imported = 0
      let linked = 0
      for (const name of Array.from(selected)) {
        const { data: inserted, error: insertErr } = await supabase
          .from('contacts')
          .insert({ full_name: name, company: name })
          .select('id')
          .single()
        if (insertErr || !inserted) continue
        imported++
        logActivity({
          entity_type: 'contact',
          entity_id: inserted.id,
          entity_name: name,
          action: 'create',
          new_value: name,
        })
        const { data: updated } = await supabase
          .from('properties')
          .update({ contact_id: inserted.id })
          .eq('client', name)
          .is('contact_id', null)
          .select('id')
        linked += updated?.length || 0
      }
      qc.invalidateQueries({ queryKey: ['/supabase/contacts'] })
      qc.invalidateQueries({ queryKey: ['/supabase/unlinked-clients'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      toast({ title: `${imported} contacts imported, ${linked} properties linked.` })
      onClose()
    } catch {
      toast({ title: 'Import failed', variant: 'destructive' })
    } finally {
      setImporting(false)
    }
  }

  const allSelected = unlinkedClients && unlinkedClients.length > 0 && selected.size === unlinkedClients.length

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[70vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Import Clients from Properties</DialogTitle></DialogHeader>
        {!unlinkedClients ? (
          <div className="space-y-2 py-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
        ) : unlinkedClients.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">All properties already have clients linked.</p>
        ) : (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => {
                  if (allSelected) setSelected(new Set())
                  else setSelected(new Set(unlinkedClients.map(c => c.name)))
                }}
                className="rounded"
              />
              Select All ({unlinkedClients.length})
            </label>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {unlinkedClients.map(c => (
                <label key={c.name} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(c.name)}
                    onChange={() => {
                      const next = new Set(selected)
                      if (next.has(c.name)) next.delete(c.name)
                      else next.add(c.name)
                      setSelected(next)
                    }}
                    className="rounded"
                  />
                  <span className="flex-1">{c.name}</span>
                  <span className="text-muted-foreground">{c.count} properties</span>
                </label>
              ))}
            </div>
            <Button size="sm" className="w-full text-xs" disabled={selected.size === 0 || importing} onClick={handleImport}>
              {importing ? 'Importing…' : `Import ${selected.size} Selected`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Duplicate Detection ──────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const an = a.length, bn = b.length
  if (an === 0) return bn
  if (bn === 0) return an
  const matrix = Array.from({ length: bn + 1 }, (_, i) => [i])
  for (let j = 0; j <= an; j++) matrix[0][j] = j
  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
    }
  }
  return matrix[bn][an]
}

function DuplicateDetectionModal({ open, onClose, contacts }: { open: boolean; onClose: () => void; contacts: any[] }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { effectiveUser } = useAuth()
  const [merging, setMerging] = useState(false)

  const duplicates = useMemo(() => {
    if (!contacts || contacts.length < 2) return []
    const pairs: { primary: any; secondary: any; reason: string }[] = []
    const seen = new Set<string>()
    for (let i = 0; i < contacts.length; i++) {
      for (let j = i + 1; j < contacts.length; j++) {
        const a = contacts[i], b = contacts[j]
        const key = [a.id, b.id].sort().join('_')
        if (seen.has(key)) continue
        // Check name similarity
        const nameA = (a.full_name || '').toLowerCase()
        const nameB = (b.full_name || '').toLowerCase()
        if (nameA && nameB && levenshtein(nameA, nameB) <= 2) {
          seen.add(key)
          pairs.push({ primary: a, secondary: b, reason: 'Similar name' })
          continue
        }
        // Check email match
        if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
          seen.add(key)
          pairs.push({ primary: a, secondary: b, reason: 'Same email' })
        }
      }
    }
    return pairs
  }, [contacts])

  async function handleMerge(primary: any, secondary: any) {
    if (!canEditView('contacts', effectiveUser)) {
      toast({ title: 'Edit access required', description: "You don't have edit access to this page.", variant: 'destructive' })
      return
    }
    setMerging(true)
    try {
      // Copy non-null fields from secondary to primary
      const updates: Record<string, any> = {}
      const fields = ['company', 'email', 'phone', 'secondary_phone', 'mailing_address', 'source', 'payment_method', 'client_since', 'notes']
      for (const f of fields) {
        if (!primary[f] && secondary[f]) updates[f] = secondary[f]
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('contacts').update(updates).eq('id', primary.id)
      }
      // Reassign properties
      await supabase.from('properties').update({ contact_id: primary.id }).eq('contact_id', secondary.id)
      // Reassign interactions
      await supabase.from('contact_interactions').update({ contact_id: primary.id }).eq('contact_id', secondary.id)
      // Delete secondary
      await supabase.from('contacts').delete().eq('id', secondary.id)
      logActivity({
        entity_type: 'contact',
        entity_id: primary.id,
        entity_name: primary.full_name,
        action: 'delete',
        field_name: 'merge',
        old_value: secondary.full_name,
        new_value: primary.full_name,
        metadata: { merged_from_id: secondary.id },
      })
      qc.invalidateQueries({ queryKey: ['/supabase/contacts'] })
      toast({ title: 'Clients merged successfully.' })
    } catch {
      toast({ title: 'Merge failed', variant: 'destructive' })
    } finally {
      setMerging(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Duplicate Review</DialogTitle></DialogHeader>
        {duplicates.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No duplicates detected.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{duplicates.length} potential duplicate pair(s) found</p>
            {duplicates.map(({ primary, secondary, reason }, i) => (
              <div key={i} className="border border-border rounded-md p-3">
                <p className="text-xs text-muted-foreground mb-2">{reason}</p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="font-medium">{primary.full_name}</p>
                    <p className="text-muted-foreground">{primary.email || '—'}</p>
                    <p className="text-muted-foreground">{primary.properties?.length || 0} properties</p>
                  </div>
                  <div>
                    <p className="font-medium">{secondary.full_name}</p>
                    <p className="text-muted-foreground">{secondary.email || '—'}</p>
                    <p className="text-muted-foreground">{secondary.properties?.length || 0} properties</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="mt-2 text-xs w-full" disabled={merging} onClick={() => handleMerge(primary, secondary)}>
                  Merge → Keep {primary.full_name}
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
